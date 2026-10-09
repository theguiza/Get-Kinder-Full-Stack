import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

/**
 * Real-PostgreSQL proof of the duplicate-upload resolution workflow
 * (kai_intake_duplicate_resolution_v1) for CSV, XLSX, MD, TXT and PDF.
 *
 * - An ephemeral, loopback-only PostgreSQL 16 cluster owned by this runner,
 *   with the synthetic organization/auth bootstraps, a production-shaped
 *   kai.intake_batches / kai.intake_files mirror of the 2026-09-16 capture
 *   (both partial declared-checksum indexes, the lineage self-FKs), and the
 *   repository's Gate A lifecycle, policy-decision replay, and Gate C-1
 *   migrations. Removed afterwards.
 * - A child Node process (the integration spec) whose ambient pool
 *   (Backend/db/pg.js) points only at that cluster: every URL-style database
 *   variable is cleared, so .env can never redirect it.
 * - The spec drives the real mounted router, real actor resolution, real
 *   intake service and SQL, the real Postgres upload-lifecycle repository,
 *   the real bounded per-type security detectors, and (for the dialog) the
 *   real KaiWebIntake component in a headless Chrome. Only object storage and
 *   the malware scanner are synthetic.
 */

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_intake_duplicate_resolution_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-dup-resolution-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(58600 + Math.floor(Math.random() * 100));
const user = process.env.USER || "postgres";
const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
const sentinelUrl = "postgres://127.0.0.1:9/kai_sentinel";
const chromePath = process.env.KAI_BROWSER_ACCEPTANCE_CHROME
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const spec = "__tests__/kai-sprint2-intake-duplicate-resolution.integration.spec.js";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, DATABASE_URL: sentinelUrl, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
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

function psqlExec(sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", sql], { capture: true }).stdout;
}

async function proveRunnerOwnedTarget() {
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT current_database() AS database_name, inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port, current_setting('listen_addresses') AS listen_addresses,
             current_setting('server_version_num')::integer AS version_num`);
    const row = rows[0];
    if (row.database_name !== dbName) throw new Error("duplicate-resolution runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`duplicate-resolution runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("duplicate-resolution runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("duplicate-resolution runner refused non-loopback listen_addresses");
    if (row.version_num < 160000 || row.version_num >= 170000) throw new Error("duplicate-resolution runner requires PostgreSQL 16");
  } finally {
    await client.end();
  }
}

if (!existsSync(chromePath)) {
  throw new Error(`duplicate-resolution runner requires a local Chrome binary (set KAI_BROWSER_ACCEPTANCE_CHROME); not found: ${chromePath}`);
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();
  console.log(`Duplicate-resolution ephemeral PostgreSQL loopback: 127.0.0.1:${port}/${dbName}`);

  psqlExec("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec("ALTER TABLE kai.engagements ADD CONSTRAINT kai_dup_resolution_engagements_id_org_unique UNIQUE (engagement_id, organization_id);");
  psqlFile("scripts/kai-sprint2-package-4-impact-library-engagement-funder-requirements-auth-bootstrap-synthetic-schema.sql");
  psqlExec("INSERT INTO kai.roles (role_name) VALUES ('client_admin'), ('client_contributor') ON CONFLICT (role_name) DO NOTHING;");
  psqlExec("ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS status text;");
  psqlFile("migrations/kai_sprint2_gk_organization_tenant_binding.sql");
  psqlFile("scripts/kai-sprint2-intake-duplicate-resolution-production-shape-synthetic-schema.sql");
  for (const migration of [
    "kai_sprint2_gate_a_p0_upload_lifecycle",
    "kai_sprint2_gate_a_p0_policy_decision_replay",
    "kai_sprint2_gate_c1_gcs_generation_binding",
  ]) {
    psqlFile(`migrations/${migration}.sql`);
  }

  const testResult = spawnSync("node", ["--test", "--test-timeout=240000", spec], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: {
      ...process.env,
      // No URL-style variable may reach the ambient pool (and dotenv never
      // overrides a key that is already set, even to "").
      DATABASE_URL: "",
      DATABASE_URL_LOCAL: "",
      PGURL_LOCAL: "",
      RENDER_DATABASE_URL: "",
      PROD_DATABASE_URL: "",
      NODE_ENV: "development",
      DB_HOST: "127.0.0.1",
      DB_PORT: port,
      DB_NAME: dbName,
      DB_USER: user,
      DB_PASSWORD: "",
      KAI_SPRINT2_ENABLED: "true",
      KAI_FILE_UPLOAD_ENABLED: "true",
      KAI_INTAKE_DUPLICATE_RESOLUTION_DATABASE_URL: targetUrl,
      KAI_INTAKE_DUPLICATE_RESOLUTION_DATABASE_NAME: dbName,
      KAI_INTAKE_DUPLICATE_RESOLUTION_CHROME: chromePath,
      KAI_INTAKE_DUPLICATE_RESOLUTION_WORKDIR: workDir,
    },
  });
  if (testResult.status !== 0) throw new Error(`duplicate-resolution real-PostgreSQL proof failed: ${spec}`);
  console.log(`Duplicate-resolution real-PostgreSQL proof passed: ${spec}`);
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Duplicate-resolution ephemeral workdir removed: ${workDir}`);
}
