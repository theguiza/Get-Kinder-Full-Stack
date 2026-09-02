import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_b1_3_accepted_catalogue_persistence_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-b1-3-catalogue-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(59000 + Math.floor(Math.random() * 1000));
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
    throw new Error("B1.3 accepted-catalogue-persistence runner refused a non-loopback target before connecting");
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
    if (row.database_name !== dbName) throw new Error("B1.3 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`B1.3 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("B1.3 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("B1.3 runner refused non-loopback listen_addresses");
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

  // Organization/engagement foundation, then the B1.1 canonical requirements
  // model this package persists into - both are prerequisites B1.3 does not
  // own and never modifies.
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");

  // Same runner-local accommodation the B1.1 runner applies: B1.1's own
  // engagement_requirement_sets table declares a composite FK to
  // kai.engagements (engagement_id, organization_id), which the
  // organization-enablement bootstrap schema does not itself declare as a
  // unique constraint.
  psqlExec(
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_b1_3_engagements_id_org_unique UNIQUE (engagement_id, organization_id);",
  );

  psqlFile("migrations/kai_sprint2_b1_1_baseline_impact_requirements.sql");

  // B1.3 forward migration: persists the owner-accepted catalogue into the
  // existing B1.1 model.
  psqlFile("migrations/kai_sprint2_b1_3_accepted_catalogue_persistence.sql");

  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-b1-3-accepted-catalogue-persistence.integration.spec.js",
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
      KAI_B1_3_ACCEPTED_CATALOGUE_PERSISTENCE_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("B1.3 accepted-catalogue-persistence integration tests failed");
  console.log("B1.3 accepted-catalogue-persistence local PostgreSQL catalogue proof passed.");

  // Rollback proof: removes exactly the B1.3-persisted catalogue rows and
  // leaves the B1.1 tables (and the organization/engagement prerequisites)
  // fully intact.
  psqlFile("migrations/kai_sprint2_b1_3_accepted_catalogue_persistence.rollback.sql");
  const rollbackClient = new Client({ connectionString: targetUrl, ssl: false });
  await rollbackClient.connect();
  try {
    const remaining = await rollbackClient.query(`
      SELECT
        (SELECT count(*)::int FROM kai.requirement_sources WHERE source_type = 'kai_standard' AND source_code = 'kai_baseline_impact_requirements') AS sources,
        (SELECT count(*)::int FROM kai.requirement_framework_versions WHERE framework_code = 'kai_baseline_impact_v1' AND version_label = 'v1') AS framework_versions,
        (SELECT count(*)::int FROM kai.requirement_sets) AS sets,
        (SELECT count(*)::int FROM kai.requirements) AS requirements
    `);
    const row = remaining.rows[0];
    if (row.sources !== 0 || row.framework_versions !== 0 || row.sets !== 0 || row.requirements !== 0) {
      throw new Error(`B1.3 rollback left catalogue rows behind: ${JSON.stringify(row)}`);
    }
    const b11Tables = await rollbackClient.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'kai' AND table_name IN
      ('requirement_sources', 'requirement_framework_versions', 'requirement_sets', 'requirements', 'engagement_requirement_sets')
    `);
    if (b11Tables.rows.length !== 5) {
      throw new Error("B1.3 rollback removed a B1.1 table it does not own");
    }
    const prerequisites = await rollbackClient.query(`
      SELECT to_regclass('kai.organizations') AS organizations, to_regclass('kai.engagements') AS engagements
    `);
    if (!prerequisites.rows[0].organizations || !prerequisites.rows[0].engagements) {
      throw new Error("B1.3 rollback removed a prerequisite object it does not own");
    }
  } finally {
    await rollbackClient.end();
  }
  console.log("B1.3 accepted-catalogue-persistence rollback proof passed: B1.1 tables and prerequisites remain intact.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`B1.3 accepted-catalogue-persistence ephemeral PostgreSQL workdir removed: ${workDir}`);
}
