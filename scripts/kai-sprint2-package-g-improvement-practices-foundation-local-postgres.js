import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_package_g_improvement_practices_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-package-g-pg-"));
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

const EXPECTED_CHECKS = [
  "created_by_type_check_present",
  "engagement_fk_is_tenant_safe",
  "gap_log_item_fk_is_tenant_safe",
  "id_org_unique_present",
  "improvement_practices_table_present",
  "organization_fk_present",
  "status_check_present",
  "cadence_check_present",
  "title_rationale_checks_present",
  "touch_updated_at_trigger_present",
  "supporting_indexes_present",
  "table_is_mutable_not_append_only",
];

function proveVerifierOutput(path) {
  const csv = run(psql, ["-v", "ON_ERROR_STOP=1", "-q", "-d", dbName, "--csv", "-f", path], { capture: true }).stdout;
  const lines = csv.trim().split("\n").filter(Boolean);
  if (lines[0] !== "check_name,status,detail") {
    throw new Error(`Package G verifier output contract violated: ${lines[0]}`);
  }
  const dataRows = lines.slice(1);
  if (dataRows.length !== EXPECTED_CHECKS.length) {
    throw new Error(`Package G verifier expected ${EXPECTED_CHECKS.length} rows, got ${dataRows.length}`);
  }
  const seen = new Set();
  for (const row of dataRows) {
    const [checkName, status] = row.split(",");
    if (seen.has(checkName)) throw new Error(`Package G duplicate verifier check ${checkName}`);
    seen.add(checkName);
    if (status !== "PASS") throw new Error(`Package G verifier check ${checkName} is ${status}`);
  }
  for (const checkName of EXPECTED_CHECKS) {
    if (!seen.has(checkName)) throw new Error(`Package G verifier missing ${checkName}`);
  }
  console.log(`Package G verifier output contract proven: exactly ${dataRows.length} PASS rows.`);
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
    if (row.database_name !== dbName) throw new Error("Package G runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`Package G runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("Package G runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("Package G runner refused non-loopback listen_addresses");
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

  // Dependency chain required to reach kai.gap_log_items (Package G's one
  // optional origin FK), then the Package G migration itself.
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-converge.sql");
  psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
  psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
  psqlFile("migrations/kai_sprint2_p1_parser_run_and_file_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql");
  psqlFile("migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql");
  psqlFile("migrations/kai_sprint2_p1_06_review_queue.sql");
  psqlFile("migrations/kai_sprint2_p1_07_intake_source_candidate.sql");
  psqlFile("migrations/kai_sprint2_p1_08_source_promotion.sql");
  psqlFile("migrations/kai_sprint2_p2_01_evidence_lineage.sql");
  psqlFile("migrations/kai_sprint2_p2_03_claim_proposal.sql");
  psqlFile("migrations/kai_sprint2_p2_04_claim_gap_followup.sql");
  psqlFile("migrations/kai_sprint2_package_g_improvement_practices_foundation.sql");

  proveVerifierOutput("scripts/kai-sprint2-package-g-improvement-practices-foundation-verifier.sql");
  psqlFile("scripts/kai-sprint2-package-g-improvement-practices-foundation-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-package-g-improvement-practices-foundation-smoke-verifier.sql");
  psqlFile("scripts/kai-sprint2-package-g-improvement-practices-foundation-failure-checks.sql");

  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-package-g-improvement-practices-foundation-schema-contract.spec.js",
    "__tests__/kai-package-g-improvement-practice-service.spec.js",
    "__tests__/kai-package-g-improvement-practice-routes.spec.js",
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
      KAI_PACKAGE_G_IMPROVEMENT_PRACTICES_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("Package G improvement-practices tests failed");
  console.log("Package G improvement-practices focused tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`Package G improvement-practices ephemeral PostgreSQL workdir removed: ${workDir}`);
}
