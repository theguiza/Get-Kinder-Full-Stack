import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p14_data_gap_memo_finalization_composition_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p14-dgm-pg-"));
const dataDir = join(workDir, "data");
const socketDir = join(workDir, "socket");
const logFile = join(workDir, "postgres.log");
const port = String(63000 + Math.floor(Math.random() * 1000));
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

async function proveRunnerOwnedTarget() {
  const parsed = new URL(targetUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("P14 data_gap_memo finalization composition runner refused non-loopback target before connection");
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
    if (row.database_name !== dbName) throw new Error("P14 data_gap_memo finalization composition runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P14 data_gap_memo finalization composition runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P14 data_gap_memo finalization composition runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P14 data_gap_memo finalization composition runner refused non-loopback listen_addresses");
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

  // Same organization/engagement foundation the existing P3-16/P3-19
  // runners establish, required transitively by P14-01's generation_runs FK.
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  psqlExec(
    "ALTER TABLE kai.engagements ADD CONSTRAINT kai_p14_dgm_engagements_id_org_unique UNIQUE (engagement_id, organization_id);",
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
  // Additional prerequisite chain (mirrors
  // scripts/kai-sprint2-p14-14-generated-content-type-evolution-local-postgres.js's
  // own proven ordering) required only for the real, unstubbed
  // createDataGapMemoDraft -> listOrganizationEvidenceGapsForImpactLibrary
  // read path this composition proof exercises for real.
  psqlFile("migrations/kai_sprint2_a1_1_impact_outcome_context.sql");
  psqlFile("migrations/kai_sprint2_a1_2_impact_evaluation_framework_and_criteria.sql");
  psqlFile("migrations/kai_sprint2_a1_3_impact_evaluations_and_results.sql");
  psqlFile("migrations/kai_sprint2_a1_4_impact_evaluation_result_provenance_links.sql");
  psqlFile("migrations/kai_sprint2_b1_1_baseline_impact_requirements.sql");
  psqlFile("migrations/kai_sprint2_c2_1_requirement_assessment_persistence.sql");
  psqlFile("migrations/kai_sprint2_p2_04_claim_gap_followup.sql");
  psqlFile("migrations/kai_sprint2_p2_05_conflict_review_candidate.sql");
  psqlFile("migrations/kai_sprint2_p2_09_human_review_internal_approval.sql");
  psqlFile("migrations/kai_sprint2_p2_10_coverage_review_decision.sql");
  psqlFile("migrations/kai_sprint2_p2_11_client_followup_completion.sql");
  psqlFile("migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_c3_a3_requirement_assessment_decision_gap_provenance.sql");
  psqlFile("migrations/kai_sprint2_c3_a4_requirement_assessment_provenance_extension.sql");
  psqlFile("migrations/kai_sprint2_p3_01_generated_content_drafts.sql");
  psqlFile("migrations/kai_sprint2_p14_01_generation_run_engagement_binding.sql");
  psqlFile("migrations/kai_sprint2_p13_01_impact_narrative_content_type.sql");
  // Widens the generation_runs/generated_content_drafts content_type CHECK
  // constraints to admit 'data_gap_memo' (and 'readiness_assessment') -
  // without this migration, every real createDataGapMemoDraft insert below
  // fails closed with a real PostgreSQL 23514 on
  // generation_runs_p3_01_content_type_check, exactly as
  // scripts/kai-sprint2-p14-14-generated-content-type-evolution-local-postgres.js
  // itself first proves before applying it.
  psqlFile("migrations/kai_sprint2_p14_14_generated_content_type_evolution.sql");
  psqlFile("migrations/kai_sprint2_p3_04_generated_content_review_completion.sql");
  psqlFile("migrations/kai_sprint2_p3_05_export_review_request.sql");
  psqlFile("migrations/kai_sprint2_p3_09_export_review_start.sql");
  psqlFile("migrations/kai_sprint2_p3_13_export_review_completion.sql");
  psqlFile("migrations/kai_sprint2_p3_16_export_candidate_foundation.sql");
  psqlFile("migrations/kai_sprint2_p3_17_human_authority_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_p3_17_authority_audit_gate_a_operation_repair.sql");
  psqlFile("migrations/kai_sprint2_p3_19_export_manifest_foundation.sql");
  console.log("P14 data_gap_memo finalization composition: predecessor migration chain through P3-19 (plus the Data-Gap-Memo real-persistence prerequisite chain and P14-14 content-type evolution) applied.");

  // As with every prior package's own runner (see
  // scripts/kai-sprint2-p3-19-export-manifest-foundation-local-postgres.js's
  // own comment), an earlier verifier a later package's own migration
  // supersedes is not re-run here: P3-16's and P3-17's own verifiers each
  // assert "no export_manifests table exists", which P3-19's migration
  // (already applied above) makes false. Only the verifiers whose own
  // contract remains valid against the final, fully-migrated schema are run.
  psqlFile("scripts/kai-sprint2-p3-04-generated-content-review-completion-verifier.sql");
  psqlFile("scripts/kai-sprint2-p3-13-export-review-completion-verifier.sql");
  psqlFile("scripts/kai-sprint2-p3-19-export-manifest-foundation-verifier.sql");

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
  // pre-P3-20 schema - mirrors
  // scripts/kai-sprint2-p3-19-export-manifest-foundation-local-postgres.js's
  // own ordering exactly (its own P3-19 smoke-verifier inserts a legacy
  // pre-P3-20 manifest row with no export_review_queue_item_id, which only
  // remains valid before this migration adds the NOT NULL column).
  psqlFile("migrations/kai_sprint2_p3_20_export_manifest_review_binding.sql");
  psqlFile("scripts/kai-sprint2-p3-20-export-manifest-review-binding-verifier.sql");
  psqlFile("scripts/kai-sprint2-p3-20-export-manifest-review-binding-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p3-20-export-manifest-review-binding-smoke-verifier.sql");
  psqlFile("scripts/kai-sprint2-p3-20-export-manifest-review-binding-failure-checks.sql");

  // Real kai.organizations/kai.engagements rows this new suite's
  // createDataGapMemoDraft call requires as the requested engagementId
  // (P14-01 write contract), reusing the same ORG constant every sibling
  // P3-16/P3-18/P3-19/P3-20/durable-read-recovery suite already hardcodes,
  // plus a fresh, dedicated engagement id owned only by this suite.
  psqlExec(
    "INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ('00000000-0000-4000-8000-000000000001', 'P14 Data-Gap-Memo Composition Smoke Org', 'p14-dgm-composition-smoke-org') ON CONFLICT (organization_id) DO NOTHING;",
  );
  psqlExec(
    "INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ('00000000-0000-4000-8000-000000000002', 'P14 Data-Gap-Memo Composition Other Org', 'p14-dgm-composition-other-org') ON CONFLICT (organization_id) DO NOTHING;",
  );
  for (const [engagementId, engagementCode] of [
    ["00000000-0000-4000-8000-000000000941", "p14-dgm-composition-smoke-engagement"],
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
    "__tests__/kai-sprint2-p14-data-gap-memo-finalization-composition.integration.spec.js",
    "__tests__/kai-sprint2-p14-export-candidate-data-gap-memo-content-type-gap.spec.js",
    "__tests__/kai-sprint2-p3-16-export-candidate-foundation.integration.spec.js",
    "__tests__/kai-sprint2-p3-16-export-candidate-foundation-boundary.spec.js",
    "__tests__/kai-sprint2-p3-17-human-authority-decision-ledger.integration.spec.js",
    "__tests__/kai-sprint2-p3-17-human-authority-decision-ledger-boundary.spec.js",
    "__tests__/kai-sprint2-p3-17-human-final-release-authority-write.spec.js",
    "__tests__/kai-sprint2-p3-17-real-authority-write.integration.spec.js",
    "__tests__/kai-sprint2-p3-18-real-persisted-final-gate-proof.integration.spec.js",
    "__tests__/kai-sprint2-p3-18-final-export-eligibility-gate-authority-state-proof.spec.js",
    "__tests__/kai-sprint2-p3-18-final-export-eligibility-gate-boundary.spec.js",
    "__tests__/kai-sprint2-p3-18-assembled-pre-artifact-release-proof.spec.js",
    "__tests__/kai-sprint2-p3-19-export-manifest-foundation.integration.spec.js",
    "__tests__/kai-sprint2-p3-19-export-manifest-foundation-boundary.spec.js",
    "__tests__/kai-sprint2-p3-20-export-manifest-review-binding.integration.spec.js",
    "__tests__/kai-sprint2-p3-20-export-manifest-review-binding-boundary.spec.js",
    "__tests__/kai-sprint2-durable-export-manifest-read-recovery.integration.spec.js",
    "__tests__/kai-sprint2-durable-export-manifest-read-recovery-boundary.spec.js",
    "__tests__/kai-sprint2-p3-06-export-review-packet.integration.spec.js",
    "__tests__/kai-sprint2-p3-06-export-review-packet-boundary.spec.js",
    "__tests__/kai-sprint2-gk-export-review-governed-finalization-control.spec.js",
    "__tests__/kai-sprint2-p3-08-gk-export-review-detail.spec.js",
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
      KAI_P14_DATA_GAP_MEMO_FINALIZATION_COMPOSITION_DATABASE_URL: targetUrl,
      KAI_P3_16_EXPORT_CANDIDATE_FOUNDATION_DATABASE_URL: targetUrl,
      KAI_P3_17_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL: targetUrl,
      KAI_P3_18_REAL_PERSISTED_FINAL_GATE_DATABASE_URL: targetUrl,
      KAI_P3_19_EXPORT_MANIFEST_FOUNDATION_DATABASE_URL: targetUrl,
      KAI_P3_20_EXPORT_MANIFEST_REVIEW_BINDING_DATABASE_URL: targetUrl,
    },
  });
  if (testResult.status !== 0) throw new Error("P14 data_gap_memo finalization composition tests failed");
  console.log("P14 data_gap_memo finalization composition focused tests passed.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P14 data_gap_memo finalization composition ephemeral PostgreSQL workdir removed: ${workDir}`);
}
