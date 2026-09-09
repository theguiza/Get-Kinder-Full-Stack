import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p3_16_export_candidate_foundation_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p3-16-pg-"));
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

const P3_16_EXPECTED_VERIFIER_CHECKS = [
  "limitation_snapshots_table_present",
  "limitation_snapshot_entries_table_present",
  "export_candidates_table_present",
  "root_snapshot_per_draft_unique_index_present",
  "single_successor_unique_index_present",
  "no_forward_pointer_column_present",
  "supersedes_snapshot_id_backward_pointer_present",
  "predecessor_scoped_to_org_and_draft",
  "limitation_snapshots_append_only_trigger_present",
  "limitation_snapshot_entries_append_only_trigger_present",
  "export_candidate_snapshot_binding_scoped_to_draft",
  "limitation_snapshot_entries_identity_unique_present",
  "limitation_snapshot_entries_codes_check_present",
  "export_candidates_replay_convergence_unique_present",
  "export_candidates_fingerprint_contract_pinned",
  "export_candidates_does_not_reuse_generation_runs_fingerprint_column",
  "audit_operations_present",
  "limitation_snapshot_audit_metadata_safe_contract",
  "export_candidate_audit_metadata_safe_contract",
  "audit_metadata_forbids_content_and_authority_keys",
  "no_export_authority_or_final_gate_state",
  "draft_status_review_status_columns_unchanged",
  "no_client_reviewed_or_finalize_export_tables",
];

function psqlFileAndProveP3_16VerifierOutputContract(path) {
  const csv = run(psql, ["-v", "ON_ERROR_STOP=1", "-q", "-d", dbName, "--csv", "-f", path], { capture: true }).stdout;
  const lines = csv.trim().split("\n").filter((line) => line.length > 0);
  const header = lines[0];
  if (header !== "check_name,status,detail") {
    throw new Error(`P3-16 verifier output contract violated: unexpected final result header "${header}"`);
  }
  const dataRows = lines.slice(1);
  if (dataRows.length !== P3_16_EXPECTED_VERIFIER_CHECKS.length) {
    throw new Error(`P3-16 verifier output contract violated: expected ${P3_16_EXPECTED_VERIFIER_CHECKS.length} rows, got ${dataRows.length}`);
  }
  const seenCheckNames = new Set();
  for (const row of dataRows) {
    const [checkName, status] = row.split(",");
    if (seenCheckNames.has(checkName)) {
      throw new Error(`P3-16 verifier output contract violated: duplicate check_name "${checkName}"`);
    }
    seenCheckNames.add(checkName);
    if (status !== "PASS") {
      throw new Error(`P3-16 verifier output contract violated: check "${checkName}" is not PASS (${status})`);
    }
  }
  for (const expectedCheckName of P3_16_EXPECTED_VERIFIER_CHECKS) {
    if (!seenCheckNames.has(expectedCheckName)) {
      throw new Error(`P3-16 verifier output contract violated: missing expected check "${expectedCheckName}"`);
    }
  }
  for (const checkName of seenCheckNames) {
    if (!P3_16_EXPECTED_VERIFIER_CHECKS.includes(checkName)) {
      throw new Error(`P3-16 verifier output contract violated: unexpected check "${checkName}"`);
    }
  }
  console.log(`P3-16 verifier output contract proven: exactly ${dataRows.length} PASS rows, exact expected check-name set, no duplicates.`);
  return csv;
}

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("P3-16 runner refused non-loopback target before connection");
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
    if (row.database_name !== dbName) throw new Error("P3-16 runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P3-16 runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P3-16 runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P3-16 runner refused non-loopback listen_addresses");
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

  // P14-01 hard precondition: kai.generation_runs.engagement_id FK's to
  // kai.engagements(engagement_id, organization_id), so the organization/
  // engagement foundation (shared by the existing organization-enablement
  // local-Postgres runner) must exist before the P3-01/P14-01 migrations
  // below create/extend kai.generation_runs. Mirrors the P3-01 runner's own
  // precedent byte-for-byte.
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  // Runner-local accommodation only (never a modification of the shared
  // bootstrap SQL file itself): the P14-01 engagement-side FK targets
  // kai.engagements (engagement_id, organization_id), a composite unique
  // constraint the organization-enablement bootstrap schema does not itself
  // declare - the same runner-local accommodation the P3-01 runner applies
  // for this identical composite FK shape.
  psqlExec(
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_p3_16_engagements_id_org_unique UNIQUE (engagement_id, organization_id);",
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
  psqlFile("scripts/kai-sprint2-p3-04-generated-content-review-completion-verifier.sql");
  // As with P3-13's own runner, the P3-05/P3-09 two-state verifiers are not
  // re-run once P3-13 has replaced their contract check with the three-state
  // one; the P3-13 verifier itself asserts that replacement.
  psqlFile("scripts/kai-sprint2-p3-13-export-review-completion-verifier.sql");
  psqlFileAndProveP3_16VerifierOutputContract("scripts/kai-sprint2-p3-16-export-candidate-foundation-verifier.sql");
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

  // Real kai.organizations/kai.engagements rows the cross-run P3-13/P3-09
  // integration suites' createEvidenceSummaryDraft/createImpactNarrativeDraft
  // calls now require as the requested engagementId (P14-01 write contract),
  // reusing the exact UUID constants
  // __tests__/kai-sprint2-p3-13-export-review-completion.integration.spec.js
  // and __tests__/kai-sprint2-p3-09-export-review-start.integration.spec.js
  // each hardcode.
  psqlExec(
    "INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ('00000000-0000-4000-8000-000000000001', 'P3-16 Smoke Org', 'p3-16-smoke-org') ON CONFLICT (organization_id) DO NOTHING;",
  );
  psqlExec(
    "INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ('00000000-0000-4000-8000-000000000913', '00000000-0000-4000-8000-000000000001', 'p3-13-smoke-engagement') ON CONFLICT (engagement_id) DO NOTHING;",
  );
  psqlExec(
    "INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ('00000000-0000-4000-8000-000000000909', '00000000-0000-4000-8000-000000000001', 'p3-09-smoke-engagement') ON CONFLICT (engagement_id) DO NOTHING;",
  );

  const testResult = spawnSync("node", [
    "--test",
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
      KAI_P3_16_EXPORT_CANDIDATE_FOUNDATION_DATABASE_URL: targetUrl,
      KAI_P3_13_EXPORT_REVIEW_COMPLETION_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("P3-16 export-candidate-foundation tests failed");
  console.log("P3-16 export-candidate-foundation focused tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P3-16 export-candidate-foundation ephemeral PostgreSQL workdir removed: ${workDir}`);
}
