import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { assertNoFail } from "./kai-sprint2-p1-05-intake-sensitivity-profile-runner-assertions.js";

// Runner-owned, loopback-only PostgreSQL 16 proof for the P1 worker: the
// additive downstream recovery-state migration pack (catalog verifier,
// read-only failure checks, smoke seed/verifier, rollback and re-apply), the
// actionable-candidate sweep, and the shared file-scoped P1-03 -> P1-04 ->
// P1-05 operation with immediate dispatch and scheduled recovery. Each part
// gets its own freshly migrated synthetic database on one ephemeral server,
// which is removed afterwards.
const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p1-worker-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(56000 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";

const SCHEMA_FILES = [
  "scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql",
  "migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql",
  "migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql",
  "scripts/kai-sprint2-confirm-upload-metadata-boundary-schema-extension.sql",
  "migrations/kai_sprint2_p1_parser_run_and_file_profile.sql",
  "migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql",
  "migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql",
  "migrations/kai_sprint2_p1_downstream_recovery_state.sql",
];
const RECOVERY_MIGRATION = "migrations/kai_sprint2_p1_downstream_recovery_state.sql";
const RECOVERY_ROLLBACK = "migrations/kai_sprint2_p1_downstream_recovery_state.rollback.sql";
const RECOVERY_VERIFIER = "scripts/kai-sprint2-p1-downstream-recovery-state-verifier.sql";
const RECOVERY_FAILURE_CHECKS = "scripts/kai-sprint2-p1-downstream-recovery-state-failure-checks.sql";
const RECOVERY_SMOKE_SEED = "scripts/kai-sprint2-p1-downstream-recovery-state-smoke-seed.sql";
const RECOVERY_SMOKE_VERIFIER = "scripts/kai-sprint2-p1-downstream-recovery-state-smoke-verifier.sql";
const MIGRATION_PACK_DB = "kai_p1_worker_recovery_migration_synthetic";

const SUITES = [
  {
    dbName: "kai_p1_worker_candidate_discovery_synthetic",
    urlVariable: "KAI_P1_WORKER_CANDIDATE_DISCOVERY_DATABASE_URL",
    spec: "__tests__/kai-sprint2-p1-worker-actionable-candidate-discovery.integration.spec.js",
  },
  {
    dbName: "kai_p1_worker_file_processing_synthetic",
    urlVariable: "KAI_P1_WORKER_FILE_PROCESSING_DATABASE_URL",
    spec: "__tests__/kai-sprint2-p1-worker-file-processing.integration.spec.js",
  },
];

function targetUrlFor(dbName) {
  return `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGUSER: user,
    },
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(dbName, path) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", port, "-d", dbName, "-f", path], { capture: true }).stdout;
}

async function proveRunnerOwnedTarget(dbName) {
  const client = new Client({ connectionString: targetUrlFor(dbName), ssl: false });
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
    if (row.database_name !== dbName) throw new Error("P1 worker runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P1 worker runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P1 worker runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P1 worker runner refused non-loopback listen_addresses");
    if (row.version_num < 160000 || row.version_num >= 170000) throw new Error("P1 worker runner requires PostgreSQL 16");
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
  console.log(`P1 worker ephemeral PostgreSQL loopback: 127.0.0.1:${port}`);

  // Migration verification pack, in its own disposable database.
  run(createdb, ["-h", "127.0.0.1", "-p", port, MIGRATION_PACK_DB], { capture: true });
  await proveRunnerOwnedTarget(MIGRATION_PACK_DB);
  for (const file of SCHEMA_FILES) psqlFile(MIGRATION_PACK_DB, file);
  const packSteps = [
    ["catalog verifier", RECOVERY_VERIFIER],
    ["read-only failure checks (empty)", RECOVERY_FAILURE_CHECKS],
    ["smoke seed", RECOVERY_SMOKE_SEED],
    ["smoke verifier", RECOVERY_SMOKE_VERIFIER],
    ["read-only failure checks (seeded)", RECOVERY_FAILURE_CHECKS],
  ];
  for (const [label, file] of packSteps) {
    const output = psqlFile(MIGRATION_PACK_DB, file);
    if (file !== RECOVERY_SMOKE_SEED) {
      assertNoFail(`P1 downstream recovery ${label}`, output);
      const passCount = (output.match(/\|\s*PASS\s*\|/g) || []).length;
      if (passCount === 0) throw new Error(`P1 downstream recovery ${label} returned no PASS rows`);
      console.log(`P1 downstream recovery ${label}: ${passCount} PASS, 0 FAIL`);
    }
  }
  // Rollback draft in this disposable database only, then re-apply forward.
  psqlFile(MIGRATION_PACK_DB, RECOVERY_ROLLBACK);
  const afterRollback = run(psql, ["-At", "-h", "127.0.0.1", "-p", port, "-d", MIGRATION_PACK_DB, "-c",
    "SELECT to_regclass('kai.intake_p1_downstream_attempts') IS NULL AND to_regclass('kai.intake_file_profiles') IS NOT NULL AND (SELECT count(*) FROM kai.intake_file_profiles) = 2"], { capture: true }).stdout.trim();
  if (afterRollback !== "t") throw new Error("P1 downstream recovery rollback did not drop exactly the recovery table");
  console.log("P1 downstream recovery rollback draft: table dropped, earlier-package rows intact");
  psqlFile(MIGRATION_PACK_DB, RECOVERY_MIGRATION);
  psqlFile(MIGRATION_PACK_DB, RECOVERY_MIGRATION);
  assertNoFail("P1 downstream recovery catalog verifier (re-applied twice)", psqlFile(MIGRATION_PACK_DB, RECOVERY_VERIFIER));
  console.log("P1 downstream recovery forward migration re-applied idempotently: catalog verifier PASS");

  for (const suite of SUITES) {
    run(createdb, ["-h", "127.0.0.1", "-p", port, suite.dbName], { capture: true });
    await proveRunnerOwnedTarget(suite.dbName);
    console.log(`P1 worker ephemeral database created: ${suite.dbName}`);
    for (const file of SCHEMA_FILES) psqlFile(suite.dbName, file);

    const testResult = spawnSync("node", ["--test", suite.spec], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: "",
        DATABASE_URL_LOCAL: "",
        PGURL_LOCAL: "",
        RENDER_DATABASE_URL: "",
        PROD_DATABASE_URL: "",
        DB_HOST: "127.0.0.1",
        DB_PORT: port,
        DB_NAME: suite.dbName,
        DB_USER: user,
        DB_PASSWORD: "",
        [suite.urlVariable]: targetUrlFor(suite.dbName),
      },
    });
    if (testResult.status !== 0) throw new Error(`P1 worker integration tests failed: ${suite.spec}`);
  }
  console.log("P1 worker integration tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P1 worker ephemeral PostgreSQL workdir removed: ${workDir}`);
}
