import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p14_12_review_queue_type_check_legacy_repair_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p14-12-rqr-pg-"));
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
    const logDetail = command === pgCtl && existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
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

function runTests(phase) {
  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-p14-12-review-queue-type-check-legacy-repair.integration.spec.js",
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
      KAI_P14_12_REVIEW_QUEUE_TYPE_CHECK_REPAIR_DATABASE_URL: targetUrl,
      KAI_P14_12_REVIEW_QUEUE_TYPE_CHECK_REPAIR_PHASE: phase,
    },
  });
  if (testResult.status !== 0) throw new Error(`P14-12 review-queue queue_type legacy-constraint repair ${phase}-migration tests failed`);
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
    if (row.database_name !== dbName) throw new Error("P14-12 review-queue queue_type legacy-constraint repair runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P14-12 review-queue queue_type legacy-constraint repair runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P14-12 review-queue queue_type legacy-constraint repair runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P14-12 review-queue queue_type legacy-constraint repair runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

function installRuntimeMigrationChain() {
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec("ALTER TABLE kai.engagements ADD CONSTRAINT kai_p14_12_engagements_id_org_unique UNIQUE (engagement_id, organization_id);");
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
  psqlFile("migrations/kai_sprint2_br_03b_board_reporting_candidate_review_lifecycle.sql");
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

  console.log("=== P14-12: reproducing USER_CONFIRMED production drift (obsolete legacy queue_type allowlist alongside canonical BR-03A/BR-03B contracts) ===");
  psqlFile("scripts/kai-sprint2-p14-12-review-queue-type-check-legacy-repair-reproduce-production-drift.sql");

  console.log("=== P14-12: PRE-MIGRATION proof (stale production-drift schema must reject the real transaction) ===");
  runTests("pre");
  console.log("P14-12 pre-migration reproduction confirmed: the real transaction is rejected under the drifted schema.");

  console.log("=== P14-12: applying repair migration ===");
  psqlFile("migrations/kai_sprint2_p14_12_review_queue_type_check_legacy_repair.sql");
  // Re-applying the migration must be a safe no-op against an
  // already-repaired database.
  psqlFile("migrations/kai_sprint2_p14_12_review_queue_type_check_legacy_repair.sql");

  console.log("=== P14-12: migration verifier ===");
  psqlFile("scripts/kai-sprint2-p14-12-review-queue-type-check-legacy-repair-verifier.sql");

  console.log("=== P14-12: BR-03A / BR-03B verifiers still pass, unmodified ===");
  psqlFile("scripts/kai-sprint2-br-03a-board-reporting-candidate-review-request-verifier.sql");
  psqlFile("scripts/kai-sprint2-br-03b-board-reporting-candidate-review-lifecycle-verifier.sql");

  console.log("=== P14-12: POST-MIGRATION proof (the same real transaction must now commit) ===");
  runTests("post");
  console.log("P14-12 post-migration repair confirmed: the real transaction now commits with the expected durable shape.");

  console.log("=== P14-12: rollback refuses once a real board_reporting_candidate_review row exists ===");
  const rollbackWithRealRow = spawnSync(psql, [
    "-v", "ON_ERROR_STOP=1", "-d", dbName, "-f",
    "migrations/kai_sprint2_p14_12_review_queue_type_check_legacy_repair.rollback.sql",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: sentinelUrl, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
  });
  if (rollbackWithRealRow.status === 0) {
    throw new Error("P14-12 rollback incorrectly succeeded while a real board_reporting_candidate_review row exists");
  }
  console.log("P14-12 rollback correctly refused while a real board_reporting_candidate_review row exists.");

  console.log("P14-12 review-queue queue_type legacy-constraint schema-repair regression passed end to end.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P14-12 review-queue queue_type legacy-constraint repair ephemeral PostgreSQL workdir removed: ${workDir}`);
}
