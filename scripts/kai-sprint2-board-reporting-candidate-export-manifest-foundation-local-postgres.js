import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_brcem_board_reporting_candidate_export_manifest_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-brcem-pg-"));
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
  "authority_decision_fk_pins_org_candidate_and_type_into_br_04_table",
  "board_reporting_candidate_export_manifests_table_present",
  "candidate_fk_is_tenant_safe_composite_into_br_02_table",
  "canonical_fingerprint_shape_check_present",
  "created_by_type_pinned_to_human",
  "decision_type_pinned_to_export_authority_granted",
  "export_manifests_p3_19_unaltered",
  "fingerprint_contract_version_pinned",
  "grant_response_packet_export_manifests_p14_08a_unaltered",
  "id_org_unique_present",
  "no_review_queue_item_or_audience_or_eligibility_snapshot_column",
  "append_only_trigger_present",
  "replay_convergence_unique_present",
];

function proveVerifierOutput(path, expectedChecks) {
  const csv = run(psql, ["-v", "ON_ERROR_STOP=1", "-q", "-d", dbName, "--csv", "-f", path], { capture: true }).stdout;
  const lines = csv.trim().split("\n").filter(Boolean);
  if (lines[0] !== "check_name,status,detail") {
    throw new Error(`board-reporting-candidate-export-manifest-foundation verifier output contract violated: ${lines[0]}`);
  }
  const dataRows = lines.slice(1);
  const seen = new Set();
  for (const row of dataRows) {
    const [checkName, status] = row.split(",");
    seen.add(checkName);
    if (status !== "PASS") throw new Error(`board-reporting-candidate-export-manifest-foundation verifier check ${checkName} is ${status}`);
  }
  for (const checkName of expectedChecks) {
    if (!seen.has(checkName)) throw new Error(`board-reporting-candidate-export-manifest-foundation verifier missing ${checkName}`);
  }
  console.log(`board-reporting-candidate-export-manifest-foundation verifier output contract proven: exactly ${dataRows.length} PASS rows (${path}).`);
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
    if (row.database_name !== dbName) throw new Error("board-reporting-candidate-export-manifest-foundation runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`board-reporting-candidate-export-manifest-foundation runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("board-reporting-candidate-export-manifest-foundation runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("board-reporting-candidate-export-manifest-foundation runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

function installRuntimeMigrationChain() {
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec("ALTER TABLE kai.engagements ADD CONSTRAINT kai_brcem_engagements_id_org_unique UNIQUE (engagement_id, organization_id);");
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
  psqlFile("migrations/kai_sprint2_br_04_board_reporting_candidate_human_authority_decision_ledger.sql");
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
  psqlFile("migrations/kai_sprint2_board_reporting_candidate_export_manifest_foundation.sql");
  proveVerifierOutput("scripts/kai-sprint2-board-reporting-candidate-export-manifest-foundation-verifier.sql", EXPECTED_CHECKS);

  // The manifest table is append-only (its own trigger rejects DELETE, so an
  // occupied table can never be emptied by this runner - only by rollback
  // itself). Prove the rollback succeeds while the table is still empty
  // (nothing persisted yet), before ever seeding a manifest row.
  const rollbackWhileEmpty = spawnSync(psql, [
    "-v", "ON_ERROR_STOP=1", "-d", dbName, "-f",
    "migrations/kai_sprint2_board_reporting_candidate_export_manifest_foundation.rollback.sql",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: sentinelUrl, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
  });
  if (rollbackWhileEmpty.status !== 0) {
    throw new Error(`board-reporting-candidate-export-manifest-foundation rollback incorrectly failed while the table was empty\n${rollbackWhileEmpty.stdout}\n${rollbackWhileEmpty.stderr}`);
  }
  const afterRollback = psqlExec("SELECT to_regclass('kai.board_reporting_candidate_export_manifests') IS NULL AS dropped;");
  if (!afterRollback.includes("t")) {
    throw new Error("board-reporting-candidate-export-manifest-foundation rollback did not drop kai.board_reporting_candidate_export_manifests once empty");
  }
  console.log("board-reporting-candidate-export-manifest-foundation rollback correctly succeeded while the table was empty.");

  // Re-apply forward, then seed real manifest rows and prove the full
  // smoke/failure suite, then prove rollback now fails closed because the
  // table is append-only and occupied - it can never be emptied again by
  // this runner, so this is the terminal state of the proof.
  psqlFile("migrations/kai_sprint2_board_reporting_candidate_export_manifest_foundation.sql");
  proveVerifierOutput("scripts/kai-sprint2-board-reporting-candidate-export-manifest-foundation-verifier.sql", EXPECTED_CHECKS);
  console.log("board-reporting-candidate-export-manifest-foundation forward -> rollback (empty succeeds) -> forward proof against synthetic local PostgreSQL passed.");

  psqlFile("scripts/kai-sprint2-board-reporting-candidate-export-manifest-foundation-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-board-reporting-candidate-export-manifest-foundation-smoke-verifier.sql");
  psqlFile("scripts/kai-sprint2-board-reporting-candidate-export-manifest-foundation-failure-checks.sql");

  // Real-DB runtime proof: drives the actual createBoardReportingCandidateExportManifest
  // service/repository (create/replay/negative/audit/immutability) against
  // this same runner-owned ephemeral database, using a synthetic id
  // namespace (16090000-...) distinct from the smoke-seed fixtures above
  // (15030000-...) so neither collides with the other.
  const manifestRealDbTestResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-board-reporting-candidate-export-manifest-real-db.integration.spec.js",
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
      KAI_BRCEM_REAL_DB_DATABASE_URL: targetUrl,
    },
  });
  if (manifestRealDbTestResult.status !== 0) {
    throw new Error("Board Reporting candidate export-manifest real-DB runtime proof failed");
  }
  console.log("TOOL_VERIFIED Board Reporting candidate export-manifest real-DB runtime proof passed.");

  const rollbackWhileManifestsExist = spawnSync(psql, [
    "-v", "ON_ERROR_STOP=1", "-d", dbName, "-f",
    "migrations/kai_sprint2_board_reporting_candidate_export_manifest_foundation.rollback.sql",
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: sentinelUrl, PGHOST: "127.0.0.1", PGPORT: port, PGDATABASE: dbName, PGUSER: user },
  });
  if (rollbackWhileManifestsExist.status === 0) {
    throw new Error("board-reporting-candidate-export-manifest-foundation rollback incorrectly succeeded while persisted manifest rows exist");
  }
  console.log("board-reporting-candidate-export-manifest-foundation rollback correctly failed closed while persisted manifest rows exist (append-only, cannot be emptied - terminal proof state).");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`board-reporting-candidate-export-manifest-foundation ephemeral PostgreSQL workdir removed: ${workDir}`);
}
