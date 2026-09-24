import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { Client } from "pg";

// JOIN-1/JOIN-2 ephemeral real-PostgreSQL proof: initdb a throwaway
// loopback-only cluster, apply the synthetic prerequisites + the JOIN-1
// migration, prove rollback and idempotent re-apply, then run the JOIN-1
// and JOIN-2 specs against it. Synthetic data only; the cluster and its
// workdir are always removed.
const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_join_1_organization_join_requests_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-join-1-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");

async function reserveFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selectedPort = String(address.port);
      server.close(() => resolve(selectedPort));
    });
    server.on("error", reject);
  });
}

const port = await reserveFreeLoopbackPort();
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
    const logDetail = command === pgCtl && existsSync(logFile)
      ? readFileSync(logFile, "utf8")
      : "";
    const detail = [result.stdout, result.stderr, logDetail].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function psqlFile(path) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], { capture: true }).stdout;
}

function psqlScalar(sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-At", "-d", dbName, "-c", sql], { capture: true }).stdout.trim();
}

async function proveRunnerOwnedTarget() {
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
    if (row.database_name !== dbName) throw new Error("JOIN-1 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`JOIN-1 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("JOIN-1 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("JOIN-1 runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

const MIGRATION = "migrations/kai_sprint2_join_1_organization_join_requests.sql";
const ROLLBACK = "migrations/kai_sprint2_join_1_organization_join_requests.rollback.sql";
const TABLE_PRESENT_SQL = "SELECT to_regclass('kai.organization_join_requests') IS NOT NULL";
const OBJECT_COUNT_SQL = `
  SELECT (SELECT count(*) FROM pg_indexes WHERE schemaname = 'kai' AND tablename = 'organization_join_requests')
       || ':' || (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('kai.organization_join_requests'))
       || ':' || (SELECT count(*) FROM pg_trigger WHERE tgrelid = to_regclass('kai.organization_join_requests') AND NOT tgisinternal)`;

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlFile("scripts/kai-sprint2-join-1-organization-join-requests-bootstrap-synthetic-schema.sql");
  psqlFile("scripts/kai-sprint2-join-2-organization-join-requests-bootstrap-synthetic-schema.sql");

  psqlFile(MIGRATION);
  if (psqlScalar(TABLE_PRESENT_SQL) !== "t") throw new Error("JOIN-1 migration did not create kai.organization_join_requests");
  const objectCounts = psqlScalar(OBJECT_COUNT_SQL);
  // indexes (pkey, id_org_unique, one_pending, tenant_status_created,
  // requester_created) : constraints (pk, unique, 3 FK, 4 CHECK) : triggers.
  if (objectCounts !== "5:9:1") throw new Error(`JOIN-1 unexpected index:constraint:trigger counts ${objectCounts}`);
  console.log(`JOIN-1 migration applied (index:constraint:trigger = ${objectCounts}).`);

  psqlFile(MIGRATION);
  if (psqlScalar(OBJECT_COUNT_SQL) !== objectCounts) throw new Error("JOIN-1 migration re-apply is not idempotent");
  console.log("JOIN-1 migration re-apply is idempotent.");

  psqlFile(ROLLBACK);
  if (psqlScalar(TABLE_PRESENT_SQL) !== "f") throw new Error("JOIN-1 rollback did not drop kai.organization_join_requests");
  if (psqlScalar("SELECT to_regprocedure('kai.guard_organization_join_requests_update()') IS NULL") !== "t") {
    throw new Error("JOIN-1 rollback did not drop the guard function");
  }
  if (psqlScalar("SELECT to_regclass('kai.organizations') IS NOT NULL AND to_regclass('kai.users') IS NOT NULL") !== "t") {
    throw new Error("JOIN-1 rollback removed an externally owned prerequisite");
  }
  console.log("JOIN-1 rollback removed only JOIN-1 objects.");

  psqlFile(MIGRATION);
  if (psqlScalar(OBJECT_COUNT_SQL) !== objectCounts) throw new Error("JOIN-1 migration re-apply after rollback differs");
  console.log("JOIN-1 migration re-applied after rollback.");

  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-join-1-organization-join-requests-schema-contract.spec.js",
    "__tests__/kai-sprint2-join-1-organization-join-request-queries.spec.js",
    "__tests__/kai-sprint2-join-1-organization-join-requests.integration.spec.js",
    "__tests__/kai-sprint2-join-2-organization-join-request-service.spec.js",
    "__tests__/kai-sprint2-join-2-organization-join-request-routes.spec.js",
    "__tests__/kai-sprint2-join-2-organization-join-requests.integration.spec.js",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: sentinelUrl,
      DATABASE_URL_LOCAL: "",
      PGURL_LOCAL: "",
      RENDER_DATABASE_URL: "",
      PROD_DATABASE_URL: "",
      KAI_JOIN_1_ORGANIZATION_JOIN_REQUESTS_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("JOIN-1/JOIN-2 organization join requests tests failed");
  if (psqlScalar("SELECT count(*) FROM kai.organization_join_requests") !== "0") {
    throw new Error("JOIN-1/JOIN-2 integration tests left synthetic rows behind");
  }
  console.log("JOIN-1/JOIN-2 organization join requests focused tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`JOIN-1 ephemeral PostgreSQL workdir removed: ${workDir}`);
}
