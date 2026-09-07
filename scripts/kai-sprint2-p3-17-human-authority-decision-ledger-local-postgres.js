import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p3_17_human_authority_decision_ledger_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p3-17-pg-"));
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

const P3_17_EXPECTED_VERIFIER_CHECKS = [
  "human_authority_decisions_table_present",
  "decision_type_check_present",
  "decision_action_check_present",
  "role_by_type_check_present",
  "root_is_grant_check_present",
  "candidate_binding_fk_present",
  "audience_compatibility_trigger_present",
  "no_forward_pointer_column_present",
  "supersedes_decision_id_backward_pointer_present",
  "predecessor_scoped_to_org_candidate_type",
  "root_per_lineage_unique_index_present",
  "single_successor_unique_index_present",
  "append_only_trigger_present",
  "no_export_authority_or_final_gate_state",
  "no_export_manifest_or_event_tables",
  "p3_16_candidate_and_snapshot_tables_unchanged",
];

function psqlFileAndProveP3_17VerifierOutputContract(path) {
  const csv = run(psql, ["-v", "ON_ERROR_STOP=1", "-q", "-d", dbName, "--csv", "-f", path], { capture: true }).stdout;
  const lines = csv.trim().split("\n").filter((line) => line.length > 0);
  const header = lines[0];
  if (header !== "check_name,status,detail") {
    throw new Error(`P3-17 verifier output contract violated: unexpected final result header "${header}"`);
  }
  const dataRows = lines.slice(1);
  if (dataRows.length !== P3_17_EXPECTED_VERIFIER_CHECKS.length) {
    throw new Error(`P3-17 verifier output contract violated: expected ${P3_17_EXPECTED_VERIFIER_CHECKS.length} rows, got ${dataRows.length}`);
  }
  const seenCheckNames = new Set();
  for (const row of dataRows) {
    const [checkName, status] = row.split(",");
    if (seenCheckNames.has(checkName)) {
      throw new Error(`P3-17 verifier output contract violated: duplicate check_name "${checkName}"`);
    }
    seenCheckNames.add(checkName);
    if (status !== "PASS") {
      throw new Error(`P3-17 verifier output contract violated: check "${checkName}" is not PASS (${status})`);
    }
  }
  for (const expectedCheckName of P3_17_EXPECTED_VERIFIER_CHECKS) {
    if (!seenCheckNames.has(expectedCheckName)) {
      throw new Error(`P3-17 verifier output contract violated: missing expected check "${expectedCheckName}"`);
    }
  }
  for (const checkName of seenCheckNames) {
    if (!P3_17_EXPECTED_VERIFIER_CHECKS.includes(checkName)) {
      throw new Error(`P3-17 verifier output contract violated: unexpected check "${checkName}"`);
    }
  }
  console.log(`P3-17 verifier output contract proven: exactly ${dataRows.length} PASS rows, exact expected check-name set, no duplicates.`);
  return csv;
}

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("P3-17 runner refused non-loopback target before connection");
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
    if (row.database_name !== dbName) throw new Error("P3-17 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P3-17 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P3-17 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P3-17 runner refused non-loopback listen_addresses");
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
  psqlFile("migrations/kai_sprint2_p3_04_generated_content_review_completion.sql");
  psqlFile("migrations/kai_sprint2_p3_05_export_review_request.sql");
  psqlFile("migrations/kai_sprint2_p3_09_export_review_start.sql");
  psqlFile("migrations/kai_sprint2_p3_13_export_review_completion.sql");
  psqlFile("migrations/kai_sprint2_p3_16_export_candidate_foundation.sql");
  psqlFile("migrations/kai_sprint2_p3_17_human_authority_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_p3_17_authority_audit_gate_a_operation_repair.sql");
  psqlFile("scripts/kai-sprint2-p3-04-generated-content-review-completion-verifier.sql");
  // As with P3-13's/P3-16's own runners, the earlier two-state verifiers this
  // package's prerequisites already superseded are not re-run; each
  // superseding package's own verifier asserts that replacement.
  psqlFile("scripts/kai-sprint2-p3-13-export-review-completion-verifier.sql");
  psqlFile("scripts/kai-sprint2-p3-16-export-candidate-foundation-verifier.sql");
  psqlFileAndProveP3_17VerifierOutputContract("scripts/kai-sprint2-p3-17-human-authority-decision-ledger-verifier.sql");
  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-04-data-dictionary-quality-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-06-review-queue-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-07-source-candidate-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-08-source-promotion-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p2-01-evidence-lineage-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p2-03-claim-proposal-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p3-16-export-candidate-foundation-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p3-16-export-candidate-foundation-smoke-verifier.sql");
  psqlFile("scripts/kai-sprint2-p3-16-export-candidate-foundation-failure-checks.sql");
  psqlFile("scripts/kai-sprint2-p3-17-human-authority-decision-ledger-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p3-17-human-authority-decision-ledger-smoke-verifier.sql");
  psqlFile("scripts/kai-sprint2-p3-17-human-authority-decision-ledger-failure-checks.sql");

  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-p3-17-human-authority-decision-ledger.integration.spec.js",
    "__tests__/kai-sprint2-p3-17-human-authority-decision-ledger-boundary.spec.js",
    "__tests__/kai-sprint2-p3-17-human-final-release-authority-write.spec.js",
    "__tests__/kai-sprint2-p3-17-real-authority-write.integration.spec.js",
    "__tests__/kai-sprint2-p3-16-export-candidate-foundation.integration.spec.js",
    "__tests__/kai-sprint2-p3-16-export-candidate-foundation-boundary.spec.js",
    "__tests__/kai-sprint2-p3-13-export-review-completion.integration.spec.js",
    "__tests__/kai-sprint2-p3-13-export-review-completion-boundary.spec.js",
    "__tests__/kai-sprint2-p3-09-export-review-start.integration.spec.js",
    "__tests__/kai-sprint2-p3-09-export-review-start-boundary.spec.js",
    "__tests__/kai-sprint2-p3-05-export-review-request-boundary.spec.js",
    "__tests__/kai-sprint2-p3-06-export-review-packet-boundary.spec.js",
    "__tests__/kai-sprint2-p3-04-generated-content-review-completion-boundary.spec.js",
    "__tests__/kai-sprint2-p3-03-export-manifest-eligibility-boundary.spec.js",
    "__tests__/kai-sprint2-p3-02-generated-draft-review-packet-boundary.spec.js",
    "__tests__/kai-sprint2-p3-01-generated-content-drafts-boundary.spec.js",
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
      KAI_P3_17_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL: targetUrl,
      KAI_P3_16_EXPORT_CANDIDATE_FOUNDATION_DATABASE_URL: targetUrl,
      KAI_P3_13_EXPORT_REVIEW_COMPLETION_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("P3-17 human-authority-decision-ledger tests failed");
  console.log("P3-17 human-authority-decision-ledger focused tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P3-17 human-authority-decision-ledger ephemeral PostgreSQL workdir removed: ${workDir}`);
}
