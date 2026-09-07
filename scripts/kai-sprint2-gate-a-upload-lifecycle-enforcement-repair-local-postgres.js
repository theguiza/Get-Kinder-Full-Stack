import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_gate_a_upload_lifecycle_enforcement_repair_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-gate-a-enforcement-repair-pg-"));
const dataDir = join(workDir, "data");
const socketDir = "/tmp";
const logFile = join(workDir, "postgres.log");
const port = String(56000 + Math.floor(Math.random() * 1000));
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
  if (result.status !== 0 && !options.allowFailure) {
    const postgresLog = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
    const detail = [result.stdout, result.stderr, postgresLog].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(path, options = {}) {
  const result = run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], {
    capture: true,
    allowFailure: options.allowFailure,
  });
  return result;
}

function assertNoFail(label, output) {
  if (/\|\s*FAIL\s*\|/.test(output) || /\sFAIL\s/.test(output)) {
    throw new Error(`${label} reported FAIL\n${output}`);
  }
}

function assertPsqlPass(label, path) {
  const result = psqlFile(path);
  assertNoFail(label, result.stdout);
  console.log(`${label}: PASS`);
  return result.stdout;
}

function assertPsqlFails(label, path) {
  const result = psqlFile(path, { allowFailure: true });
  if (result.status === 0) {
    throw new Error(`${label} unexpectedly passed\n${result.stdout}`);
  }
  console.log(`${label}: PASS`);
  return [result.stdout, result.stderr].filter(Boolean).join("\n");
}

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Gate A enforcement repair runner refused non-loopback target before connection");
  }
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
    if (row.database_name !== dbName) throw new Error("Gate A enforcement repair runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`Gate A enforcement repair runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("Gate A enforcement repair runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("Gate A enforcement repair runner refused non-loopback listen_addresses");
    if (row.version_num < 160000 || row.version_num >= 170000) throw new Error("Gate A enforcement repair runner requires PostgreSQL 16");
  } finally {
    await client.end();
  }
}

async function catalogFingerprint() {
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const result = await client.query(`
      WITH objects AS (
        SELECT 'column' AS object_type,
               table_schema || '.' || table_name || '.' || column_name AS object_name,
               data_type || ':' || udt_name || ':' || is_nullable || ':' || COALESCE(column_default, '') AS object_def
          FROM information_schema.columns
         WHERE table_schema = 'kai'
        UNION ALL
        SELECT 'constraint',
               n.nspname || '.' || r.relname || '.' || c.conname,
               pg_get_constraintdef(c.oid)
          FROM pg_constraint c
          JOIN pg_class r ON r.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
         WHERE n.nspname = 'kai'
        UNION ALL
        SELECT 'index',
               schemaname || '.' || indexname,
               indexdef
          FROM pg_indexes
         WHERE schemaname = 'kai'
        UNION ALL
        SELECT 'trigger',
               nt.nspname || '.' || rt.relname || '.' || t.tgname,
               pg_get_triggerdef(t.oid)
          FROM pg_trigger t
          JOIN pg_class rt ON rt.oid = t.tgrelid
          JOIN pg_namespace nt ON nt.oid = rt.relnamespace
         WHERE nt.nspname = 'kai'
           AND NOT t.tgisinternal
           AND t.tgname <> 'trg_gate_a_p0_upload_lifecycle'
        UNION ALL
        SELECT 'function',
               n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
               pg_get_functiondef(p.oid)
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'kai'
           AND p.proname <> 'enforce_gate_a_p0_upload_lifecycle'
      )
      SELECT encode(digest(string_agg(object_type || ':' || object_name || ':' || object_def, E'\n' ORDER BY object_type, object_name), 'sha256'), 'hex') AS fingerprint
        FROM objects
    `);
    return result.rows[0].fingerprint;
  } finally {
    await client.end();
  }
}

let started = false;
try {
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  console.log(`Gate A enforcement repair ephemeral database created: ${dbName}`);
  console.log(`Gate A enforcement repair ephemeral PostgreSQL loopback: 127.0.0.1:${port}`);

  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  psqlFile("migrations/kai_sprint2_gate_c1_gcs_generation_binding.sql");

  assertPsqlPass("Existing Gate A verifier before synthetic drift", "scripts/kai-sprint2-gate-a-verifier.sql");
  assertPsqlPass("Gate C-1 verifier before synthetic drift", "scripts/kai-sprint2-gate-c1-gcs-generation-binding-verifier.sql");

  psqlFile("scripts/kai-sprint2-gate-a-upload-lifecycle-enforcement-repair-drift-fixture.sql");
  console.log("Simulated production drift reproduced: PASS");

  assertPsqlFails("Pre-repair focused verifier failure detection", "scripts/kai-sprint2-gate-a-upload-lifecycle-enforcement-repair-verifier.sql");

  const beforeRepairFingerprint = await catalogFingerprint();
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle_enforcement_forward_repair.sql");
  console.log("Local forward repair application: PASS");
  const afterRepairFingerprint = await catalogFingerprint();
  if (beforeRepairFingerprint !== afterRepairFingerprint) {
    throw new Error("repair changed schema objects outside the repaired Gate A function/trigger");
  }
  console.log("No unrelated schema object changed by repair: PASS");

  assertPsqlPass("Focused repair verifier", "scripts/kai-sprint2-gate-a-upload-lifecycle-enforcement-repair-verifier.sql");
  assertPsqlPass("Repair failure checks", "scripts/kai-sprint2-gate-a-upload-lifecycle-enforcement-repair-failure-checks.sql");
  assertPsqlPass("Existing Gate A verifier", "scripts/kai-sprint2-gate-a-verifier.sql");
  assertPsqlPass("Existing Gate A failure checks", "scripts/kai-sprint2-gate-a-failure-checks.sql");
  assertPsqlPass("Gate C-1 verifier", "scripts/kai-sprint2-gate-c1-gcs-generation-binding-verifier.sql");

  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");
  assertPsqlPass("Focused repair smoke verifier", "scripts/kai-sprint2-gate-a-upload-lifecycle-enforcement-repair-smoke-verifier.sql");
  assertPsqlPass("Existing Gate A smoke verifier", "scripts/kai-sprint2-gate-a-smoke-verifier.sql");
  assertPsqlPass("Gate C-1 smoke seed", "scripts/kai-sprint2-gate-c1-gcs-generation-binding-smoke-seed.sql");
  assertPsqlPass("Gate C-1 smoke verifier", "scripts/kai-sprint2-gate-c1-gcs-generation-binding-smoke-verifier.sql");

  const beforeReplayFingerprint = await catalogFingerprint();
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle_enforcement_forward_repair.sql");
  const afterReplayFingerprint = await catalogFingerprint();
  if (beforeReplayFingerprint !== afterReplayFingerprint) {
    throw new Error("repair replay changed preserved schema object fingerprint");
  }
  assertPsqlPass("Focused repair verifier after replay", "scripts/kai-sprint2-gate-a-upload-lifecycle-enforcement-repair-verifier.sql");
  console.log("Replay / idempotency: PASS");

  console.log("Gate A upload-lifecycle enforcement forward repair proof passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Gate A enforcement repair ephemeral PostgreSQL workdir removed: ${workDir}`);
}
