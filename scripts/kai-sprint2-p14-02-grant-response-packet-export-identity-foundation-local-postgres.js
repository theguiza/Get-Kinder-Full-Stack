import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p14_02_grant_packet_export_identity_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p14-02-pg-"));
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

function psqlExec(sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", sql], { capture: true }).stdout;
}

const P14_02_EXPECTED_VERIFIER_CHECKS = [
  "grant_response_packet_export_identities_table_present",
  "id_org_unique_present",
  "engagement_fk_is_tenant_safe_composite",
  "audience_check_present",
  "created_by_type_check_present",
  "identity_replay_convergence_unique_present",
  "append_only_trigger_present",
  "no_export_candidate_or_manifest_column",
  "export_candidates_and_manifests_not_altered",
];

function psqlFileAndProveP14_02VerifierOutputContract(path) {
  const csv = run(psql, ["-v", "ON_ERROR_STOP=1", "-q", "-d", dbName, "--csv", "-f", path], { capture: true }).stdout;
  const lines = csv.trim().split("\n").filter((line) => line.length > 0);
  const header = lines[0];
  if (header !== "check_name,status,detail") {
    throw new Error(`P14-02 verifier output contract violated: unexpected final result header "${header}"`);
  }
  const dataRows = lines.slice(1);
  if (dataRows.length !== P14_02_EXPECTED_VERIFIER_CHECKS.length) {
    throw new Error(`P14-02 verifier output contract violated: expected ${P14_02_EXPECTED_VERIFIER_CHECKS.length} rows, got ${dataRows.length}`);
  }
  const seenCheckNames = new Set();
  for (const row of dataRows) {
    const [checkName, status] = row.split(",");
    if (seenCheckNames.has(checkName)) {
      throw new Error(`P14-02 verifier output contract violated: duplicate check_name "${checkName}"`);
    }
    seenCheckNames.add(checkName);
    if (status !== "PASS") {
      throw new Error(`P14-02 verifier output contract violated: check "${checkName}" is not PASS (${status})`);
    }
  }
  for (const expectedCheckName of P14_02_EXPECTED_VERIFIER_CHECKS) {
    if (!seenCheckNames.has(expectedCheckName)) {
      throw new Error(`P14-02 verifier output contract violated: missing expected check "${expectedCheckName}"`);
    }
  }
  console.log(`P14-02 verifier output contract proven: exactly ${dataRows.length} PASS rows, exact expected check-name set, no duplicates.`);
  return csv;
}

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("P14-02 grant-response-packet-export-identity-foundation runner refused non-loopback target before connection");
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
    if (row.database_name !== dbName) throw new Error("P14-02 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P14-02 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P14-02 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P14-02 runner refused non-loopback listen_addresses");
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

  // This table's only real dependency is kai.engagements (composite FK) and
  // the P14-01 kai.generation_runs.engagement_id column (asserted by this
  // migration's own preflight, not exercised at runtime by this table). This
  // runner bootstraps only the minimal kai.organizations/kai.engagements/
  // kai.generation_runs shape needed to satisfy that preflight and the
  // composite FK - not the full Gate A-through-P3-19 chain another package's
  // runner exercises - because no export-candidate, export-manifest, or
  // authority-decision table is read or written by this migration or its
  // repository.
  psqlExec(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE SCHEMA IF NOT EXISTS kai;
    CREATE TYPE kai.engagement_status_enum AS ENUM ('active', 'draft');
    CREATE TABLE kai.organizations (
      organization_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name              text NOT NULL CHECK (length(trim(name)) > 0),
      organization_code text UNIQUE,
      status            kai.engagement_status_enum NOT NULL DEFAULT 'active'
    );
    CREATE TABLE kai.engagements (
      engagement_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id   uuid NOT NULL REFERENCES kai.organizations (organization_id),
      engagement_code   text NOT NULL,
      engagement_status kai.engagement_status_enum NOT NULL DEFAULT 'draft',
      UNIQUE (organization_id, engagement_code),
      UNIQUE (engagement_id, organization_id)
    );
    CREATE TABLE kai.generation_runs (
      generation_run_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id     uuid NOT NULL,
      engagement_id       uuid
    );
  `);

  psqlFile("migrations/kai_sprint2_p14_02_grant_response_packet_export_identity_foundation.sql");
  psqlFileAndProveP14_02VerifierOutputContract(
    "scripts/kai-sprint2-p14-02-grant-response-packet-export-identity-foundation-verifier.sql",
  );
  psqlFile("scripts/kai-sprint2-p14-02-grant-response-packet-export-identity-foundation-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p14-02-grant-response-packet-export-identity-foundation-smoke-verifier.sql");
  psqlFile("scripts/kai-sprint2-p14-02-grant-response-packet-export-identity-foundation-failure-checks.sql");

  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-p14-02-grant-response-packet-export-identity-foundation.integration.spec.js",
    "__tests__/kai-grant-response-packet-export-identity-boundary.spec.js",
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
      DB_HOST: "127.0.0.1",
      DB_PORT: port,
      DB_NAME: dbName,
      DB_USER: user,
      DB_PASSWORD: "",
      KAI_P14_02_GRANT_RESPONSE_PACKET_EXPORT_IDENTITY_FOUNDATION_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("P14-02 grant-response-packet-export-identity-foundation tests failed");
  console.log("P14-02 grant-response-packet-export-identity-foundation focused tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P14-02 grant-response-packet-export-identity-foundation ephemeral PostgreSQL workdir removed: ${workDir}`);
}
