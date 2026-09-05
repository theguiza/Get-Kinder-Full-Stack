import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_package_2a_engagement_requirement_sets_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p2a-ers-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(59100 + Math.floor(Math.random() * 1000));
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

function psqlExec(sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", sql], { capture: true }).stdout;
}

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Package 2A runner refused a non-loopback target before connecting");
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
    if (row.database_name !== dbName) throw new Error("Package 2A runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`Package 2A runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("Package 2A runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("Package 2A runner refused non-loopback listen_addresses");
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

  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec(
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_package_2a_engagements_id_org_unique UNIQUE (engagement_id, organization_id);",
  );
  psqlFile("migrations/kai_sprint2_b1_1_baseline_impact_requirements.sql");
  psqlFile("migrations/kai_sprint2_package_2a_engagement_requirement_sets_authority.sql");

  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-package-2a-engagement-requirement-sets-authority.integration.spec.js",
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
      KAI_PACKAGE_2A_ENGAGEMENT_REQUIREMENT_SETS_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("Package 2A engagement-requirement-sets integration tests failed");
  console.log("Package 2A engagement-requirement-sets local PostgreSQL proof passed.");

  psqlExec("TRUNCATE kai.engagement_requirement_sets;");
  psqlFile("migrations/kai_sprint2_package_2a_engagement_requirement_sets_authority.rollback.sql");
  const rollbackClient = new Client({ connectionString: targetUrl, ssl: false });
  await rollbackClient.connect();
  try {
    const removedColumns = await rollbackClient.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'kai'
        AND table_name = 'engagement_requirement_sets'
        AND column_name IN (
          'reviewed_by',
          'reviewed_by_role',
          'reviewed_at',
          'applicability_effective_state',
          'supersedes_engagement_requirement_set_id',
          'target_context_identity'
        )
    `);
    if (removedColumns.rows.length !== 0) {
      throw new Error(`Package 2A rollback left columns behind: ${removedColumns.rows.map((r) => r.column_name).join(", ")}`);
    }
    const restoredIdentity = await rollbackClient.query(`
      SELECT 1
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai'
         AND r.relname = 'engagement_requirement_sets'
         AND c.conname = 'engagement_requirement_sets_b1_1_identity_unique'
    `);
    if (restoredIdentity.rows.length !== 1) {
      throw new Error("Package 2A rollback did not restore the B1.1 engagement_requirement_sets identity constraint");
    }
  } finally {
    await rollbackClient.end();
  }
  console.log("Package 2A engagement-requirement-sets rollback proof passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Package 2A engagement-requirement-sets ephemeral PostgreSQL workdir removed: ${workDir}`);
}
