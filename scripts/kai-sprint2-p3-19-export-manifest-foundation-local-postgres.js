import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p3_19_export_manifest_foundation_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p3-19-pg-"));
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

const P3_19_EXPECTED_VERIFIER_CHECKS = [
  "export_manifests_table_present",
  "candidate_fk_present",
  "authority_decision_fk_present",
  "decision_type_check_present",
  "fingerprint_contract_version_check_present",
  "canonical_fingerprint_check_present",
  "created_by_type_check_present",
  "replay_convergence_unique_present",
  "append_only_trigger_present",
  "no_requested_audience_or_draft_id_column",
  "no_artifact_or_storage_columns",
  "generated_content_draft_status_locked_column_unchanged",
  "upload_lifecycle_audit_operation_allowlist_unchanged",
];

function psqlFileAndProveP3_19VerifierOutputContract(path) {
  const csv = run(psql, ["-v", "ON_ERROR_STOP=1", "-q", "-d", dbName, "--csv", "-f", path], { capture: true }).stdout;
  const lines = csv.trim().split("\n").filter((line) => line.length > 0);
  const header = lines[0];
  if (header !== "check_name,status,detail") {
    throw new Error(`P3-19 verifier output contract violated: unexpected final result header "${header}"`);
  }
  const dataRows = lines.slice(1);
  if (dataRows.length !== P3_19_EXPECTED_VERIFIER_CHECKS.length) {
    throw new Error(`P3-19 verifier output contract violated: expected ${P3_19_EXPECTED_VERIFIER_CHECKS.length} rows, got ${dataRows.length}`);
  }
  const seenCheckNames = new Set();
  for (const row of dataRows) {
    const [checkName, status] = row.split(",");
    if (seenCheckNames.has(checkName)) {
      throw new Error(`P3-19 verifier output contract violated: duplicate check_name "${checkName}"`);
    }
    seenCheckNames.add(checkName);
    if (status !== "PASS") {
      throw new Error(`P3-19 verifier output contract violated: check "${checkName}" is not PASS (${status})`);
    }
  }
  for (const expectedCheckName of P3_19_EXPECTED_VERIFIER_CHECKS) {
    if (!seenCheckNames.has(expectedCheckName)) {
      throw new Error(`P3-19 verifier output contract violated: missing expected check "${expectedCheckName}"`);
    }
  }
  for (const checkName of seenCheckNames) {
    if (!P3_19_EXPECTED_VERIFIER_CHECKS.includes(checkName)) {
      throw new Error(`P3-19 verifier output contract violated: unexpected check "${checkName}"`);
    }
  }
  console.log(`P3-19 verifier output contract proven: exactly ${dataRows.length} PASS rows, exact expected check-name set, no duplicates.`);
  return csv;
}

const P3_20_EXPECTED_VERIFIER_CHECKS = [
  "export_review_queue_item_id_column_present",
  "export_review_queue_item_id_not_null",
  "review_queue_item_fk_present",
  "review_queue_items_id_org_unique_present",
  "no_unique_constraint_on_review_queue_item_id_alone",
  "lookup_index_present",
  "append_only_trigger_still_present",
  "replay_convergence_key_unchanged",
  "no_latest_or_current_column",
];

function psqlFileAndProveP3_20VerifierOutputContract(path) {
  const csv = run(psql, ["-v", "ON_ERROR_STOP=1", "-q", "-d", dbName, "--csv", "-f", path], { capture: true }).stdout;
  const lines = csv.trim().split("\n").filter((line) => line.length > 0);
  const header = lines[0];
  if (header !== "check_name,status,detail") {
    throw new Error(`P3-20 verifier output contract violated: unexpected final result header "${header}"`);
  }
  const dataRows = lines.slice(1);
  if (dataRows.length !== P3_20_EXPECTED_VERIFIER_CHECKS.length) {
    throw new Error(`P3-20 verifier output contract violated: expected ${P3_20_EXPECTED_VERIFIER_CHECKS.length} rows, got ${dataRows.length}`);
  }
  const seenCheckNames = new Set();
  for (const row of dataRows) {
    const [checkName, status] = row.split(",");
    if (seenCheckNames.has(checkName)) {
      throw new Error(`P3-20 verifier output contract violated: duplicate check_name "${checkName}"`);
    }
    seenCheckNames.add(checkName);
    if (status !== "PASS") {
      throw new Error(`P3-20 verifier output contract violated: check "${checkName}" is not PASS (${status})`);
    }
  }
  for (const expectedCheckName of P3_20_EXPECTED_VERIFIER_CHECKS) {
    if (!seenCheckNames.has(expectedCheckName)) {
      throw new Error(`P3-20 verifier output contract violated: missing expected check "${expectedCheckName}"`);
    }
  }
  for (const checkName of seenCheckNames) {
    if (!P3_20_EXPECTED_VERIFIER_CHECKS.includes(checkName)) {
      throw new Error(`P3-20 verifier output contract violated: unexpected check "${checkName}"`);
    }
  }
  console.log(`P3-20 verifier output contract proven: exactly ${dataRows.length} PASS rows, exact expected check-name set, no duplicates.`);
  return csv;
}

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("P3-19 export-manifest-foundation runner refused non-loopback target before connection");
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
    if (row.database_name !== dbName) throw new Error("P3-19 export-manifest-foundation runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P3-19 export-manifest-foundation runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P3-19 export-manifest-foundation runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P3-19 export-manifest-foundation runner refused non-loopback listen_addresses");
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
  // Issue 3 (P3-19 audit-sink real-persistence proof): test-only synthetic
  // mirror of the externally-owned kai.audit_events/kai.object_type_enum
  // required-audit target, copied byte-for-byte from the existing
  // organization-enablement precedent. Applied only by this runner, never by
  // any product migration.
  psqlFile("scripts/kai-sprint2-p3-19-export-manifest-foundation-audit-events-bootstrap-synthetic-schema.sql");
  // P14-01 hard precondition: kai.generation_runs.engagement_id FK's to
  // kai.engagements(engagement_id, organization_id). This runner already
  // bootstraps its own kai.audit_events/kai.object_type_enum mirror above
  // (byte-for-byte the organization-enablement precedent's audit slice), so
  // the full organization-enablement bootstrap SQL file is not reapplied
  // here (it would recreate that same audit_events/object_type_enum shape
  // and collide) - only the missing kai.organizations/kai.engagements
  // minimal mirror this runner does not otherwise have is added, inline,
  // reusing the exact same column shapes the organization-enablement
  // bootstrap declares.
  psqlExec(`
    CREATE TYPE kai.engagement_status_enum AS ENUM ('active', 'draft');
    CREATE TABLE kai.organizations (
      organization_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name             text NOT NULL CHECK (length(trim(name)) > 0),
      organization_code text UNIQUE,
      status           kai.engagement_status_enum NOT NULL DEFAULT 'active'
    );
    CREATE TABLE kai.engagements (
      engagement_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id   uuid NOT NULL REFERENCES kai.organizations (organization_id),
      engagement_code   text NOT NULL,
      engagement_status kai.engagement_status_enum NOT NULL DEFAULT 'draft',
      UNIQUE (organization_id, engagement_code),
      UNIQUE (engagement_id, organization_id)
    );
  `);
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
  psqlFile("migrations/kai_sprint2_p3_17_authority_audit_gate_a_operation_repair.sql");
  psqlFile("migrations/kai_sprint2_p3_19_export_manifest_foundation.sql");
  psqlFile("scripts/kai-sprint2-p3-04-generated-content-review-completion-verifier.sql");
  psqlFile("scripts/kai-sprint2-p3-13-export-review-completion-verifier.sql");
  // As with every prior package's own runner, an earlier verifier this
  // package's own migration supersedes is not re-run - here, P3-16's and
  // P3-17's own verifiers each assert "no export_manifests table exists",
  // which P3-19's migration makes false. This package's own verifier
  // (kai-sprint2-p3-19-export-manifest-foundation-verifier.sql) asserts that
  // exact replacement instead, exactly as the P3-13/P3-16/P3-17 exclusions
  // already established this pattern.
  psqlFileAndProveP3_19VerifierOutputContract("scripts/kai-sprint2-p3-19-export-manifest-foundation-verifier.sql");
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
  psqlFile("scripts/kai-sprint2-p3-19-export-manifest-foundation-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p3-19-export-manifest-foundation-smoke-verifier.sql");
  psqlFile("scripts/kai-sprint2-p3-19-export-manifest-foundation-failure-checks.sql");

  // P3-20 (kai_sprint2_p3_20_export_manifest_review_binding.sql) is applied
  // here, after every P3-19 step above has already run against the
  // pre-P3-20 schema. This means kai-sprint2-p3-19-export-manifest-
  // foundation-smoke-verifier.sql's own manifest1 row (inserted above,
  // before this migration existed in this runner's timeline) is a genuine
  // pre-P3-20 legacy row - P3-20's own deterministic backfill is proven
  // against it directly, not against a fabricated fixture. Because this
  // runner is the one place that exercises
  // Backend/kai/dictionary/postgresExportManifestRepository.js#createExportManifest
  // against a real database, and that repository now always writes the P3-20
  // column, this runner - exactly as it already folded in
  // kai_sprint2_p3_17_authority_audit_gate_a_operation_repair.sql for the
  // same reason - must apply P3-20 too for its own P3-19 integration suite
  // below to keep passing.
  psqlFile("migrations/kai_sprint2_p3_20_export_manifest_review_binding.sql");
  psqlFileAndProveP3_20VerifierOutputContract("scripts/kai-sprint2-p3-20-export-manifest-review-binding-verifier.sql");
  psqlFile("scripts/kai-sprint2-p3-20-export-manifest-review-binding-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p3-20-export-manifest-review-binding-smoke-verifier.sql");
  psqlFile("scripts/kai-sprint2-p3-20-export-manifest-review-binding-failure-checks.sql");

  // Real kai.organizations/kai.engagements rows the durable-export-manifest-
  // read-recovery/P3-20/P3-19/P3-18/P3-13 integration suites'
  // createEvidenceSummaryDraft/createImpactNarrativeDraft calls now require
  // as the requested engagementId (P14-01 write contract), reusing the exact
  // UUID constants each of those integration spec files hardcodes.
  psqlExec(
    "INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ('00000000-0000-4000-8000-000000000001', 'P3-19 Smoke Org', 'p3-19-smoke-org') ON CONFLICT (organization_id) DO NOTHING;",
  );
  for (const [engagementId, engagementCode] of [
    ["00000000-0000-4000-8000-000000000920", "p3-durable-manifest-read-recovery-smoke-engagement"],
    ["00000000-0000-4000-8000-000000000921", "p3-20-smoke-engagement"],
    ["00000000-0000-4000-8000-000000000919", "p3-19-smoke-engagement"],
    ["00000000-0000-4000-8000-000000000918", "p3-18-smoke-engagement"],
    ["00000000-0000-4000-8000-000000000913", "p3-13-smoke-engagement"],
  ]) {
    psqlExec(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ('${engagementId}', '00000000-0000-4000-8000-000000000001', '${engagementCode}') ON CONFLICT (engagement_id) DO NOTHING;`,
    );
  }

  const testResult = spawnSync("node", [
    "--test",
    "__tests__/kai-sprint2-durable-export-manifest-read-recovery.integration.spec.js",
    "__tests__/kai-sprint2-durable-export-manifest-read-recovery-boundary.spec.js",
    "__tests__/kai-sprint2-p3-20-export-manifest-review-binding.integration.spec.js",
    "__tests__/kai-sprint2-p3-20-export-manifest-review-binding-boundary.spec.js",
    "__tests__/kai-sprint2-p3-19-export-manifest-foundation.integration.spec.js",
    "__tests__/kai-sprint2-p3-19-export-manifest-foundation-boundary.spec.js",
    "__tests__/kai-sprint2-p3-18-real-persisted-final-gate-proof.integration.spec.js",
    "__tests__/kai-sprint2-p3-18-final-export-eligibility-gate-authority-state-proof.spec.js",
    "__tests__/kai-sprint2-p3-18-final-export-eligibility-gate-boundary.spec.js",
    "__tests__/kai-sprint2-p3-18-assembled-pre-artifact-release-proof.spec.js",
    "__tests__/kai-sprint2-p3-17-human-authority-decision-ledger.integration.spec.js",
    "__tests__/kai-sprint2-p3-17-human-authority-decision-ledger-boundary.spec.js",
    "__tests__/kai-sprint2-p3-17-human-final-release-authority-write.spec.js",
    "__tests__/kai-sprint2-p3-17-real-authority-write.integration.spec.js",
    "__tests__/kai-sprint2-p3-16-export-candidate-foundation.integration.spec.js",
    "__tests__/kai-sprint2-p3-16-export-candidate-foundation-boundary.spec.js",
    "__tests__/kai-sprint2-p3-13-export-review-completion.integration.spec.js",
    "__tests__/kai-sprint2-p3-13-export-review-completion-boundary.spec.js",
    "__tests__/kai-sprint2-p3-09-export-review-start-boundary.spec.js",
    "__tests__/kai-sprint2-p3-06-export-review-packet-boundary.spec.js",
    "__tests__/kai-sprint2-p3-05-export-review-request-boundary.spec.js",
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
      KAI_P3_20_EXPORT_MANIFEST_REVIEW_BINDING_DATABASE_URL: targetUrl,
      KAI_P3_19_EXPORT_MANIFEST_FOUNDATION_DATABASE_URL: targetUrl,
      KAI_P3_18_REAL_PERSISTED_FINAL_GATE_DATABASE_URL: targetUrl,
      KAI_P3_17_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL: targetUrl,
      KAI_P3_16_EXPORT_CANDIDATE_FOUNDATION_DATABASE_URL: targetUrl,
      KAI_P3_13_EXPORT_REVIEW_COMPLETION_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("P3-19/P3-20 export-manifest tests failed");
  console.log("P3-19/P3-20 export-manifest focused tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P3-19 export-manifest-foundation ephemeral PostgreSQL workdir removed: ${workDir}`);
}
