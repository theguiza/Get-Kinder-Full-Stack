import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p14_07b1_grant_packet_human_authority_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p14-07b1-pg-"));
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

const P14_07B1_EXPECTED_VERIFIER_CHECKS = [
  "append_only_trigger_present",
  "candidate_fk_is_tenant_safe_composite_into_p14_03_table",
  "created_by_type_pinned_to_human",
  "decision_action_vocabulary_check_present",
  "decision_type_pinned_to_export_authority_granted",
  "grant_response_packet_human_authority_decisions_table_present",
  "human_authority_decisions_p3_17_unaltered",
  "id_org_candidate_type_unique_present",
  "id_org_unique_present",
  "no_requested_audience_column",
  "not_self_superseding_check_present",
  "role_pinned_to_gk_admin",
  "root_is_grant_check_present",
  "root_per_lineage_unique_index_present",
  "single_successor_unique_index_present",
  "supersedes_fk_pins_org_candidate_and_type",
];

function psqlFileAndProveVerifierOutputContract(path) {
  const csv = run(psql, ["-v", "ON_ERROR_STOP=1", "-q", "-d", dbName, "--csv", "-f", path], { capture: true }).stdout;
  const lines = csv.trim().split("\n").filter((line) => line.length > 0);
  const header = lines[0];
  if (header !== "check_name,status,detail") {
    throw new Error(`P14-07B1 verifier output contract violated: unexpected final result header "${header}"`);
  }
  const dataRows = lines.slice(1);
  if (dataRows.length !== P14_07B1_EXPECTED_VERIFIER_CHECKS.length) {
    throw new Error(`P14-07B1 verifier output contract violated: expected ${P14_07B1_EXPECTED_VERIFIER_CHECKS.length} rows, got ${dataRows.length}`);
  }
  const seenCheckNames = new Set();
  for (const row of dataRows) {
    const [checkName, status] = row.split(",");
    if (seenCheckNames.has(checkName)) {
      throw new Error(`P14-07B1 verifier output contract violated: duplicate check_name "${checkName}"`);
    }
    seenCheckNames.add(checkName);
    if (status !== "PASS") {
      throw new Error(`P14-07B1 verifier output contract violated: check "${checkName}" is not PASS (${status})`);
    }
  }
  for (const expectedCheckName of P14_07B1_EXPECTED_VERIFIER_CHECKS) {
    if (!seenCheckNames.has(expectedCheckName)) {
      throw new Error(`P14-07B1 verifier output contract violated: missing expected check "${expectedCheckName}"`);
    }
  }
  console.log(`P14-07B1 verifier output contract proven: exactly ${dataRows.length} PASS rows, exact expected check-name set, no duplicates.`);
  return csv;
}

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("P14-07B1 runner refused non-loopback target before connection");
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
    if (row.database_name !== dbName) throw new Error("P14-07B1 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P14-07B1 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P14-07B1 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P14-07B1 runner refused non-loopback listen_addresses");
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

  // Full real chain through P14-03 is required because this package's FK
  // targets the real kai.grant_response_packet_export_candidates table,
  // which itself FKs through P14-02/generated_content_drafts/generation_runs/
  // engagements. P3-16/P3-17/P3-19 are additionally applied (schema-only,
  // nothing seeded/exercised) so this package's own "kai.human_authority_
  // decisions is completely unaltered" and "no manifest table" proofs query
  // real tables rather than a to_regclass no-op.
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec(
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_p14_07b1_engagements_id_org_unique UNIQUE (engagement_id, organization_id);",
  );
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
  psqlFile("migrations/kai_sprint2_p14_01_generation_run_engagement_binding.sql");
  psqlFile("migrations/kai_sprint2_p3_04_generated_content_review_completion.sql");
  psqlFile("migrations/kai_sprint2_p3_05_export_review_request.sql");
  psqlFile("migrations/kai_sprint2_p3_09_export_review_start.sql");
  psqlFile("migrations/kai_sprint2_p3_13_export_review_completion.sql");
  psqlFile("migrations/kai_sprint2_p3_16_export_candidate_foundation.sql");
  psqlFile("migrations/kai_sprint2_p3_17_human_authority_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_p3_19_export_manifest_foundation.sql");
  psqlFile("migrations/kai_sprint2_p14_02_grant_response_packet_export_identity_foundation.sql");
  psqlFile("migrations/kai_sprint2_p14_03_grant_response_packet_export_candidate_foundation.sql");
  psqlFile("migrations/kai_sprint2_p14_05_grant_response_packet_export_review_binding.sql");
  psqlFile("migrations/kai_sprint2_p14_07_b1_grant_response_packet_human_authority_decision_ledger.sql");

  psqlFileAndProveVerifierOutputContract(
    "scripts/kai-sprint2-p14-07-b1-grant-response-packet-human-authority-decision-ledger-verifier.sql",
  );
  psqlFile("scripts/kai-sprint2-p14-07-b1-grant-response-packet-human-authority-decision-ledger-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p14-07-b1-grant-response-packet-human-authority-decision-ledger-smoke-verifier.sql");
  psqlFile("scripts/kai-sprint2-p14-07-b1-grant-response-packet-human-authority-decision-ledger-failure-checks.sql");

  // Standalone rollback/reapply proof against a throwaway copy of the same
  // migration chain state: forward (already applied above) -> rollback ->
  // reapply -> re-verify, all against this same ephemeral instance.
  psqlFile("migrations/kai_sprint2_p14_07_b1_grant_response_packet_human_authority_decision_ledger.rollback.sql");
  psqlExec(
    "DO $$ BEGIN IF to_regclass('kai.grant_response_packet_human_authority_decisions') IS NOT NULL THEN RAISE EXCEPTION 'P14-07B1 rollback did not remove kai.grant_response_packet_human_authority_decisions'; END IF; END $$;",
  );
  psqlFile("migrations/kai_sprint2_p14_07_b1_grant_response_packet_human_authority_decision_ledger.sql");
  psqlFile("scripts/kai-sprint2-p14-07-b1-grant-response-packet-human-authority-decision-ledger-verifier.sql");
  psqlFile("scripts/kai-sprint2-p14-07-b1-grant-response-packet-human-authority-decision-ledger-smoke-seed.sql");

  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-p14-07-b1-grant-response-packet-human-authority-decision-ledger.integration.spec.js",
    "__tests__/kai-sprint2-p14-07-b1-grant-response-packet-human-authority-decision-ledger-boundary.spec.js",
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
      KAI_P14_07B1_GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("P14-07B1 grant-response-packet-human-authority-decision-ledger tests failed");
  console.log("P14-07B1 grant-response-packet-human-authority-decision-ledger focused tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P14-07B1 grant-response-packet-human-authority-decision-ledger ephemeral PostgreSQL workdir removed: ${workDir}`);
}
