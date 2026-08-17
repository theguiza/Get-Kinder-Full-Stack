import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { assertNoFail } from "./kai-sprint2-p1-07-source-candidate-runner-assertions.js";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_legacy_cutover_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-legacy-cutover-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(59000 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(path, { allowFail = false } = {}) {
  const result = spawnSync(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
  });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`psql -f ${path} failed\n${[result.stdout, result.stderr].filter(Boolean).join("\n")}`);
  }
  return result;
}

async function proveRunnerOwnedTarget() {
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses,
             current_setting('server_version_num')::integer AS version_num
    `);
    const row = result.rows[0];
    if (row.database_name !== dbName) throw new Error("legacy-cutover runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`legacy-cutover runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("legacy-cutover runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("legacy-cutover runner refused non-loopback listen_addresses");
    if (row.version_num < 160000 || row.version_num >= 170000) throw new Error("legacy-cutover runner requires PostgreSQL 16");
  } finally {
    await client.end();
  }
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  console.log(`legacy-cutover ephemeral database created: ${dbName}`);
  console.log(`legacy-cutover ephemeral PostgreSQL loopback: 127.0.0.1:${port}`);

  // 1. Stand up a production-shaped starting state: Gate A canonical
  //    intake_files/upload_lifecycle_audit, then the exact legacy shape proven
  //    by the supplied production catalog for the 7 incompatible tables plus
  //    the shared/live review_queue_items table, plus one synthetic legacy
  //    candidate row.
  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-legacy-cutover-legacy-shape-seed.sql");

  // 2. Prove the actual production collision reproduces here, using the real,
  //    unmodified getScopedSourceCandidateByIdentity query against the legacy
  //    shape, BEFORE the cutover migration runs.
  {
    const preEnv = {
      ...process.env,
      DATABASE_URL: "",
      DATABASE_URL_LOCAL: targetUrl,
      PGURL_LOCAL: "",
      RENDER_DATABASE_URL: "",
      PROD_DATABASE_URL: "",
      KAI_LEGACY_CUTOVER_PRE_DATABASE_URL: targetUrl,
    };
    const preResult = spawnSync("node", ["--test", "__tests__/kai-sprint2-legacy-cutover-pre-collision.spec.js"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "inherit",
      env: preEnv,
    });
    if (preResult.status !== 0) throw new Error("legacy-cutover pre-collision proof failed");
  }

  // 3. Cutover.
  psqlFile("migrations/kai_sprint2_legacy_generation_cutover_20260817.sql");

  // At this point only the relocation + review_queue_items indexes exist;
  // canonical tables are installed next. Check relocation directly rather than
  // via the full post-migration verifier (which assumes canonical tables
  // already exist).
  const relocationCheck = run(psql, [
    "-v", "ON_ERROR_STOP=1", "-d", dbName, "-t", "-A", "-c",
    "SELECT to_regclass('kai_legacy_20260817.intake_source_candidates') IS NOT NULL AND to_regclass('kai.intake_source_candidates') IS NULL",
  ], { capture: true });
  if (relocationCheck.stdout.trim() !== "t") {
    throw new Error(`expected legacy relocation to have happened\n${relocationCheck.stdout}\n${relocationCheck.stderr}`);
  }

  // 4. Install the canonical P1 tables via the existing, unmodified, accepted
  //    migrations, exactly as they would run against any fresh database.
  psqlFile("migrations/kai_sprint2_p1_parser_run_and_file_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql");
  psqlFile("migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_06_review_queue.sql");
  psqlFile("migrations/kai_sprint2_p1_07_intake_source_candidate.sql");
  psqlFile("migrations/kai_sprint2_p1_08_source_promotion.sql");

  const verifierOutput = psqlFile("scripts/kai-sprint2-legacy-cutover-verifier.sql").stdout;
  console.log(verifierOutput);
  assertNoFail("legacy-cutover post-migration verifier", verifierOutput);

  // 5. Idempotency proof: re-running the cutover migration after the full
  //    canonical install must be a clean no-op, not a second relocation
  //    attempt or a failure, and the verifier must still pass unchanged.
  psqlFile("migrations/kai_sprint2_legacy_generation_cutover_20260817.sql");
  const verifierOutputAfterRerun = psqlFile("scripts/kai-sprint2-legacy-cutover-verifier.sql").stdout;
  assertNoFail("legacy-cutover post-migration verifier (after idempotent rerun)", verifierOutputAfterRerun);

  const preflightOutput = psqlFile("scripts/kai-sprint2-legacy-cutover-preflight.sql").stdout;
  console.log(preflightOutput);
  assertNoFail("legacy-cutover preflight (post-state sanity)", preflightOutput);

  const testEnv = {
    ...process.env,
    DATABASE_URL: "",
    DATABASE_URL_LOCAL: targetUrl,
    PGURL_LOCAL: "",
    RENDER_DATABASE_URL: "",
    PROD_DATABASE_URL: "",
    KAI_SPRINT2_ENABLED: "true",
    KAI_LEGACY_CUTOVER_DATABASE_URL: targetUrl,
  };
  for (const spec of ["__tests__/kai-sprint2-legacy-cutover.integration.spec.js"]) {
    const testResult = spawnSync("node", ["--test", spec], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "inherit",
      env: testEnv,
    });
    if (testResult.status !== 0) throw new Error(`legacy-cutover integration tests failed: ${spec}`);
  }
  console.log("legacy-cutover integration tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`legacy-cutover ephemeral PostgreSQL workdir removed: ${workDir}`);
}
