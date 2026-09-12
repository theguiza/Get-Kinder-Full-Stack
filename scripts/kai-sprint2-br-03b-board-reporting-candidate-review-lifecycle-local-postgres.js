import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_br_03b_board_reporting_candidate_review_lifecycle_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-br-03b-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");

async function reserveFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(String(address.port)));
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

function psqlExec(sql) {
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-c", sql], { capture: true }).stdout;
}

const EXPECTED_CHECKS = [
  "board_candidate_tables_still_present",
  "board_review_identity_unique_index_present",
  "br_03a_contract_check_absent",
  "br_03b_lifecycle_contract_check_present",
  "queue_type_permits_board_reporting_candidate_review",
];

function proveVerifierOutput(path, expectedChecks) {
  const csv = run(psql, ["-v", "ON_ERROR_STOP=1", "-q", "-d", dbName, "--csv", "-f", path], { capture: true }).stdout;
  const lines = csv.trim().split("\n").filter(Boolean);
  if (lines[0] !== "check_name,status,detail") {
    throw new Error(`BR-03B verifier output contract violated: ${lines[0]}`);
  }
  const dataRows = lines.slice(1);
  const seen = new Set();
  for (const row of dataRows) {
    const [checkName, status] = row.split(",");
    seen.add(checkName);
    if (status !== "PASS") throw new Error(`BR-03B verifier check ${checkName} is ${status}`);
  }
  for (const checkName of expectedChecks) {
    if (!seen.has(checkName)) throw new Error(`BR-03B verifier missing ${checkName}`);
  }
  console.log(`BR-03B verifier output contract proven: exactly ${dataRows.length} PASS rows (${path}).`);
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
    if (row.database_name !== dbName) throw new Error("BR-03B runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`BR-03B runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("BR-03B runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("BR-03B runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

function installRuntimeMigrationChain() {
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec("ALTER TABLE kai.engagements ADD CONSTRAINT kai_br_03b_engagements_id_org_unique UNIQUE (engagement_id, organization_id);");
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
  psqlFile("migrations/kai_sprint2_p2_05_conflict_review_candidate.sql");
  psqlFile("migrations/kai_sprint2_p3_01_generated_content_drafts.sql");
  psqlFile("migrations/kai_sprint2_p13_01_impact_narrative_content_type.sql");
  psqlFile("migrations/kai_sprint2_p14_01_generation_run_engagement_binding.sql");
  psqlFile("migrations/kai_sprint2_p3_04_generated_content_review_completion.sql");
  psqlFile("migrations/kai_sprint2_p3_05_export_review_request.sql");
  psqlFile("migrations/kai_sprint2_p3_09_export_review_start.sql");
  psqlFile("migrations/kai_sprint2_p3_13_export_review_completion.sql");
  psqlFile("migrations/kai_sprint2_p14_10_review_queue_target_object_type_repair.sql");
  psqlFile("migrations/kai_sprint2_p3_16_export_candidate_foundation.sql");
  psqlFile("migrations/kai_sprint2_p3_17_human_authority_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_p3_19_export_manifest_foundation.sql");
  psqlFile("migrations/kai_sprint2_br_02_board_reporting_candidate_foundation.sql");
  psqlFile("migrations/kai_sprint2_br_03a_board_reporting_candidate_review_request.sql");
}

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  installRuntimeMigrationChain();
  psqlFile("migrations/kai_sprint2_br_03b_board_reporting_candidate_review_lifecycle.sql");
  proveVerifierOutput("scripts/kai-sprint2-br-03b-board-reporting-candidate-review-lifecycle-verifier.sql", EXPECTED_CHECKS);

  psqlFile("scripts/kai-sprint2-br-03b-board-reporting-candidate-review-lifecycle-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-br-03b-board-reporting-candidate-review-lifecycle-smoke-verifier.sql");
  psqlFile("scripts/kai-sprint2-br-03b-board-reporting-candidate-review-lifecycle-failure-checks.sql");

  // Rollback must fail closed while START/COMPLETE-state rows exist (proven
  // by the smoke seed above), then succeed once every board_reporting_
  // candidate_review row is back in the BR-03A REQUEST state.
  const rollbackWhileStarted = spawnSync(psql, [
    "-v", "ON_ERROR_STOP=1", "-d", dbName, "-f",
    "migrations/kai_sprint2_br_03b_board_reporting_candidate_review_lifecycle.rollback.sql",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: sentinelUrl, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
  });
  if (rollbackWhileStarted.status === 0) {
    throw new Error("BR-03B rollback incorrectly succeeded while START/COMPLETE rows exist");
  }
  console.log("BR-03B rollback correctly failed closed while START/COMPLETE-state rows exist.");

  psqlExec("DELETE FROM kai.review_queue_items WHERE queue_type = 'board_reporting_candidate_review';");
  psqlFile("migrations/kai_sprint2_br_03b_board_reporting_candidate_review_lifecycle.rollback.sql");
  const afterRollback = psqlExec("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'kai.review_queue_items'::regclass AND conname = 'review_queue_items_br_03a_board_reporting_candidate_review_contract_check';");
  if (!afterRollback.includes("board_reporting_candidate_review")) {
    throw new Error("BR-03B rollback did not restore the BR-03A REQUEST-only contract check");
  }
  psqlFile("migrations/kai_sprint2_br_03b_board_reporting_candidate_review_lifecycle.sql");
  proveVerifierOutput("scripts/kai-sprint2-br-03b-board-reporting-candidate-review-lifecycle-verifier.sql", EXPECTED_CHECKS);
  console.log("BR-03B forward -> rollback -> forward proof against synthetic local PostgreSQL passed.");

  // Re-seed synthetic Board inputs and prove REQUEST -> START end to end
  // through the real repository, not just direct SQL.
  psqlFile("scripts/kai-sprint2-br-03a-board-reporting-candidate-review-request-smoke-seed.sql");

  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-board-reporting-candidate-review-request-boundary.spec.js",
    "__tests__/kai-board-reporting-candidate-review-start-boundary.spec.js",
    "__tests__/kai-sprint2-br-03a-board-reporting-candidate-review-request.integration.spec.js",
    "__tests__/kai-sprint2-br-03b-board-reporting-candidate-review-lifecycle.integration.spec.js",
    "__tests__/kai-board-reporting-candidate-boundary.spec.js",
    "__tests__/kai-sprint2-p14-05-grant-response-packet-export-review-binding.spec.js",
    "__tests__/kai-sprint2-api-contract.spec.js",
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
      KAI_BR_03B_BOARD_REPORTING_CANDIDATE_REVIEW_LIFECYCLE_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("BR-03B board-reporting-candidate-review-lifecycle tests failed");
  console.log("BR-03B board-reporting-candidate-review-lifecycle focused tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`BR-03B board-reporting-candidate-review-lifecycle ephemeral PostgreSQL workdir removed: ${workDir}`);
}
