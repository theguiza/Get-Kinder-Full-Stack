import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_gate_c1_gcs_generation_binding_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-gate-c1-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(64000 + Math.floor(Math.random() * 1000));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      DATABASE_URL: sentinelUrl,
      PGHOST: "127.0.0.1",
      PGPORT: port,
      PGDATABASE: dbName,
      PGUSER: user,
    },
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(path) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], { capture: true }).stdout;
}

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Gate C-1 runner refused non-loopback target before connection");
  }
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses
    `);
    const row = result.rows[0];
    if (row.database_name !== dbName) throw new Error("Gate C-1 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`Gate C-1 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("Gate C-1 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("Gate C-1 runner refused non-loopback listen_addresses");
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

  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  psqlFile("migrations/kai_sprint2_gate_c1_gcs_generation_binding.sql");

  psqlFile("scripts/kai-sprint2-gate-a-verifier.sql");
  psqlFile("scripts/kai-sprint2-gate-c1-gcs-generation-binding-verifier.sql");

  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-gate-a-smoke-verifier.sql");
  psqlFile("scripts/kai-sprint2-gate-a-failure-checks.sql");
  psqlFile("scripts/kai-sprint2-gate-c1-gcs-generation-binding-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-gate-c1-gcs-generation-binding-smoke-verifier.sql");
  psqlFile("scripts/kai-sprint2-gate-c1-gcs-generation-binding-failure-checks.sql");

  // Prove rollback restores the prior schema, then reapply cleanly.
  psqlFile("migrations/kai_sprint2_gate_c1_gcs_generation_binding.rollback.sql");
  const columnsAfterRollback = run(psql, [
    "-v", "ON_ERROR_STOP=1", "-d", dbName, "-t", "-A", "-c",
    "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'kai' AND table_name = 'intake_files' AND column_name = 'gcs_generation'",
  ], { capture: true }).stdout.trim();
  if (columnsAfterRollback !== "0") throw new Error("Gate C-1 rollback did not remove gcs_generation column");
  psqlFile("scripts/kai-sprint2-gate-a-verifier.sql");
  psqlFile("migrations/kai_sprint2_gate_c1_gcs_generation_binding.sql");
  psqlFile("scripts/kai-sprint2-gate-c1-gcs-generation-binding-verifier.sql");

  const testResult = spawnSync("node", [
    "--test",
    // --test-concurrency=1: this run mixes multiple PostgreSQL-integration
    // spec files that each TRUNCATE the same shared kai.intake_files/
    // kai.upload_lifecycle_audit tables against one ephemeral database.
    // Node's default test runner concurrency runs separate files
    // concurrently, which races those TRUNCATEs against other files'
    // in-flight inserts/assertions. Forcing sequential file execution here
    // avoids that race without changing any test's own logic.
    "--test-concurrency=1",
    "__tests__/kai-sprint2-gate-c1-gcs-generation-binding.integration.spec.js",
    "__tests__/kai-sprint2-p0-postgres-upload-lifecycle-repository.integration.spec.js",
    "__tests__/kai-sprint2-p0-upload-lifecycle-repository.spec.js",
    "__tests__/kai-sprint2-p0-upload-lifecycle-cross-implementation-parity.spec.js",
  ], {
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
      DB_NAME: dbName,
      DB_USER: user,
      DB_PASSWORD: "",
      KAI_P0_POSTGRES_ADAPTER_DATABASE_URL: targetUrl,
      KAI_GATE_C1_GCS_GENERATION_BINDING_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("Gate C-1 gcs-generation-binding tests failed");
  console.log("Gate C-1 gcs-generation-binding focused tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Gate C-1 ephemeral PostgreSQL workdir removed: ${workDir}`);
}
