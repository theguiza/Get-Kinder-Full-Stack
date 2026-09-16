// P14-C2 Grant Response Packet execution-bounds proof, against a REAL
// ephemeral local PostgreSQL instance - no mocked transaction, no mocked
// claim-traceability evaluator.
//
// Proves, using the real exported production functions:
//   - Backend/kai/dictionary/postgresGeneratedContentRepository.js
//       createPostgresGeneratedContentRepository(...).getGrantResponsePacket
//       (which internally wires GRANT_RESPONSE_PACKET_MAX_CANDIDATE_DRAFTS /
//       GRANT_RESPONSE_PACKET_MAX_DISTINCT_CLAIMS into
//       evaluateGrantResponsePacketMembershipInTransaction)
//   - Backend/kai/dictionary/postgresClaimTraceabilityRepository.js
//       evaluateClaimTraceabilityInTransaction (the real P2-06 evaluator,
//       wrapped only by a call-counting pass-through for the packet-read
//       calls under test - never faked, never given a scripted result)
//
// four cases:
//   CASE 1: 50 candidate drafts, 1 distinct (fully governed, funder-eligible)
//           claim -> PASS, all 50 resolved drafts appear as packet members.
//   CASE 2: 51 candidate drafts -> BLOCK on the candidate-drafts bound,
//           before any batched structural read and before the evaluator is
//           ever reached (0 invocations), no partial packet.
//   CASE 3: 50 candidate drafts citing 100 distinct claims -> PASS (within
//           the distinct-claims bound).
//   CASE 4: <=50 candidate drafts citing 101 distinct claims -> BLOCK on the
//           distinct-claims bound, derived from already-batched citation
//           state, before the evaluator is ever reached (0 invocations), no
//           partial packet.
//
// Every candidate draft/citation is built through real, schema-legal rows
// (matching the exact production INSERT shapes in
// postgresGeneratedContentRepository.js) so the READ side under test
// (the real repository + real evaluator) is exercised against genuine
// database state. CASE 1's 50 members are built entirely through the real
// production service chain (createEvidenceSummaryDraft ->
// startGeneratedContentReview -> completeGeneratedContentReview) against one
// real, fully governed funder-eligible claim (built through the real
// evidence-extraction/claim-proposal/gap-followup/human-review/coverage/
// client-followup service chain, the same recipe
// __tests__/kai-sprint2-p14-09-funder-authority-source-repair.integration.spec.js
// already proves against a real database) - because createEvidenceSummaryDraft
// itself refuses to admit any claim that is not currently funder-eligible
// (P14-09 repair), and a packet member additionally requires currentUseEligible
// === true at read time. CASE 3/4's many extra distinct claims never need to
// be currently funder-eligible: for CASE 3, the real evaluator DOES run for
// each (memoized per claim) and is expected to return eligible=false (no
// packet members, but the packet read itself still succeeds - the bound
// under test cares about distinct-claims COUNT, not per-claim eligibility);
// for CASE 4, the evaluator provably never runs at all. Those claims are
// still built through the real, unmocked evidence-extraction/claim-proposal/
// claim-gap-followup service chain (never a hand-seeded claims-table row),
// only omitting the claim-review/coverage/client-followup resolution steps
// that are irrelevant to what is being proven for those two cases.

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { Client } from "pg";

process.env.DATABASE_URL = "postgres://127.0.0.1:9/kai_sentinel";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const dbName = "kai_p14_c2_execution_bounds_synthetic";
const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
const fallbackBin = "/opt/homebrew/opt/libpq/bin";
const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
const initdb = join(binDir, "initdb");
const pgCtl = join(binDir, "pg_ctl");
const psql = join(binDir, "psql");
const createdb = join(binDir, "createdb");
const workDir = mkdtempSync(join(tmpdir(), "kai-p14-c2-bounds-pg-"));
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
    throw new Error("P14-C2 execution-bounds runner refused a non-loopback target before connection");
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
    if (row.database_name !== dbName) throw new Error("P14-C2 execution-bounds runner refused non-synthetic database name");
    if (!["127.0.0.1", "127.0.0.1/32", "::1", "::ffff:127.0.0.1"].includes(row.server_addr)) {
      throw new Error(`P14-C2 execution-bounds runner refused non-loopback server address: ${row.server_addr}`);
    }
    if (row.server_port !== port) throw new Error("P14-C2 execution-bounds runner refused unexpected PostgreSQL port");
    if (row.listen_addresses !== "127.0.0.1") throw new Error("P14-C2 execution-bounds runner refused non-loopback listen_addresses");
  } finally {
    await client.end();
  }
}

const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT_CASE1 = "00000000-0000-4000-8000-000000000601";
const ENGAGEMENT_CASE2 = "00000000-0000-4000-8000-000000000602";
const ENGAGEMENT_CASE3 = "00000000-0000-4000-8000-000000000603";
const ENGAGEMENT_CASE4 = "00000000-0000-4000-8000-000000000604";
const NOW = "2026-08-06T10:00:00.000Z";
const LATER = "2026-08-06T10:05:00.000Z";
const LATEST = "2026-08-06T10:10:00.000Z";
const DICTIONARY_ID = "60000000-0000-4000-8000-000000000001";
const FILE_PROFILE_ID = "50000000-0000-4000-8000-000000000001";
const EXTRA_FIELD_COUNT = 230; // buffer over the 1 + 100 + 101 = 202 distinct claims needed

let started = false;
try {
  mkdirSync(socketDir, { recursive: true });
  run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { capture: true });
  run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], { capture: true });
  started = true;
  run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { capture: true });
  await proveRunnerOwnedTarget();

  // Exact migration/smoke-seed chain proven by
  // scripts/kai-sprint2-p14-09-funder-authority-source-repair-local-postgres.js
  // - the closest existing runner already exercising the real
  // evaluateClaimTraceabilityInTransaction (P2-06) against a real database,
  // including the Phase-5 allowed-use decision ledger and claim-review
  // decision ledger this proof's one fully governed funder-eligible claim
  // (CASE 1/2) needs.
  psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
  // Runner-local accommodation only (never a modification of the shared
  // bootstrap SQL file itself) - same precedent as the P3-02/P14-09 runners:
  // the P14-01 engagement-side FK targets kai.engagements
  // (engagement_id, organization_id), a composite unique constraint the
  // organization-enablement bootstrap schema does not itself declare.
  psqlExec("ALTER TABLE kai.engagements ADD CONSTRAINT kai_p14_c2_bounds_engagements_id_org_unique UNIQUE (engagement_id, organization_id);");
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
  psqlFile("migrations/kai_sprint2_p2_09_human_review_internal_approval.sql");
  psqlFile("migrations/kai_sprint2_p3_01_generated_content_drafts.sql");
  // CASE 1 (below) exercises the real startGeneratedContentReview/
  // completeGeneratedContentReview lifecycle (P3-02 review-packet runners
  // never do, so they never needed this) - P3-01 alone only admits the
  // open/needs_gk_review generated_content_review shape. P3-04 relaxes that
  // contract to the full open/in_progress/resolved lifecycle matrix and this
  // start-audit-contract migration adds the missing
  // 'generated_content_review_started' audit-operation vocabulary entry
  // startGeneratedContentReview's own audit write already always required.
  psqlFile("migrations/kai_sprint2_p3_04_generated_content_review_completion.sql");
  // P3-01 (further above) overwrites
  // upload_lifecycle_audit_gate_a_operation_check with a literal list that
  // drops the P2-09 audit operations added above. P2-10/P2-11 below each
  // restate the same shared CHECK from their own literal (superset) list,
  // which re-admits the P2-09 operations but still drops P3-01's - exactly
  // the defect kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql
  // exists to fix, so it must run directly after P2-11 - same precedent as
  // the P14-09 runner.
  psqlFile("migrations/kai_sprint2_p2_10_coverage_review_decision.sql");
  psqlFile("migrations/kai_sprint2_p2_11_client_followup_completion.sql");
  psqlFile("migrations/kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql");
  // Runs AFTER the forward-reconciliation pass above (which does not track a
  // marker for this specific audit-operation addition and would otherwise
  // recompute upload_lifecycle_audit_gate_a_operation_check from a required-
  // operations list that omits it).
  psqlFile("migrations/kai_sprint2_generated_content_review_start_audit_contract.sql");
  psqlFile("migrations/kai_sprint2_p14_01_generation_run_engagement_binding.sql");
  psqlFile("migrations/kai_sprint2_b1a_02_phase5_allowed_use_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql");
  psqlFile("migrations/kai_sprint2_p2_10_funder_coverage_authority.sql");

  psqlFile("scripts/kai-sprint2-gate-a-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-04-data-dictionary-quality-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-06-review-queue-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-07-source-candidate-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p1-08-source-promotion-smoke-seed.sql");
  psqlFile("scripts/kai-sprint2-p2-01-evidence-lineage-smoke-seed.sql");

  // Real kai.organizations/kai.engagements rows for the 4 distinct
  // engagements this proof's 4 cases each read an independent packet
  // against (never sharing candidate-draft state across cases).
  psqlExec(`INSERT INTO kai.organizations (organization_id, name) VALUES ('${ORG}', 'P14-C2 Execution Bounds Org') ON CONFLICT (organization_id) DO NOTHING;`);
  for (const eng of [ENGAGEMENT_CASE1, ENGAGEMENT_CASE2, ENGAGEMENT_CASE3, ENGAGEMENT_CASE4]) {
    psqlExec(`INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ('${eng}', '${ORG}', 'p14-c2-${eng.slice(-4)}') ON CONFLICT (engagement_id) DO NOTHING;`);
  }

  // Extra data_dictionary_fields rows under the exact same dictionary/file
  // profile the P1-04/P2-01 smoke seeds already committed (org 000...0001,
  // dictionary 60000000...0001, file_profile 50000000...0001) - the same
  // runner-local extension technique
  // __tests__/kai-sprint2-p14-09-funder-authority-source-repair.integration.spec.js's
  // own seedOrganization() uses (there, 4 extra fields; here, enough extra
  // fields for 202 distinct evidence items/claims across all 4 cases).
  // extractEvidenceFromSourceVersion mints exactly one evidence item per
  // field, idempotently, so each field committed here becomes exactly one
  // future distinct claim.
  psqlExec(
    `INSERT INTO kai.data_dictionary_fields (
       data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id,
       profile_field_key, field_label_safe, data_type, created_at
     )
     SELECT gen_random_uuid(), '${DICTIONARY_ID}', '${ORG}', '${FILE_PROFILE_ID}',
            'field_p14_c2_extra_' || g, 'field_p14_c2_extra_' || g, 'number', now()
       FROM generate_series(1, ${EXTRA_FIELD_COUNT}) AS g;`,
  );

  console.log(`P14-C2 execution-bounds ephemeral PostgreSQL ready on 127.0.0.1 (synthetic database ${dbName}).`);

  await runProof();
  console.log("P14-C2 Grant Response Packet execution-bounds real-PostgreSQL proof PASSED all 4 cases.");
} finally {
  if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
  rmSync(workDir, { recursive: true, force: true });
  console.log(`P14-C2 execution-bounds ephemeral PostgreSQL workdir removed: ${workDir}`);
}

async function runProof() {
  const { Pool } = await import("pg");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { completeClientFollowup } = await import("../Backend/kai/services/kaiClientFollowupCompletionService.js");
  const { acceptFunderCoverageLimitation } = await import("../Backend/kai/services/kaiCoverageReviewDecisionService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { createPostgresHumanReviewRepository } = await import("../Backend/kai/dictionary/postgresHumanReviewRepository.js");
  const { evaluateClaimTraceabilityInTransaction, createPostgresClaimTraceabilityRepository } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");
  const { createPostgresCoverageReviewDecisionRepository } = await import("../Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js");
  const { createPostgresClientFollowupCompletionRepository } = await import("../Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js");
  const {
    createPostgresGeneratedContentRepository,
  } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");

  const pool = new Pool({ connectionString: targetUrl, ssl: false, max: 10 });

  async function withTx(callback) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async function query(sql, params = []) {
    return (await pool.query(sql, params)).rows;
  }

  const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
  const reviewerActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };
  const clientReviewerActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000007",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_reviewer" }],
  };
  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  const evidenceRepo = createPostgresEvidenceLineageRepository({ runInTransaction: withTx });
  const claimRepo = createPostgresClaimProposalRepository({ runInTransaction: withTx });
  const gapRepo = createPostgresClaimGapFollowupRepository({ runInTransaction: withTx });
  const humanReviewRepo = createPostgresHumanReviewRepository({ runInTransaction: withTx });
  const traceRepo = createPostgresClaimTraceabilityRepository({ runInTransaction: withTx });
  const coverageRepo = createPostgresCoverageReviewDecisionRepository({ runInTransaction: withTx });
  const clientFollowupRepo = createPostgresClientFollowupCompletionRepository({ runInTransaction: withTx });

  // The one real, unmocked writer-side repository used for every creation/
  // review-lifecycle call in this proof (default real evaluator, uncounted -
  // counting is scoped only to the packet-READ calls under test below).
  const repoWrite = createPostgresGeneratedContentRepository({ runInTransaction: withTx });

  async function trace(claimId, requestedAudience) {
    return getClaimTraceabilitySummary(
      { organizationId: ORG, claimId, requestedAudience, actorContext: reviewerActor },
      { env: enabledEnv, claimTraceabilityRepository: traceRepo },
    );
  }

  // Ported unmodified in spirit from
  // __tests__/kai-sprint2-p14-09-funder-authority-source-repair.integration.spec.js's
  // own buildClaim() helper (same real service/repository chain, same
  // already-proven "cheap" override shape for a structurally real but not
  // fully governance-resolved claim) - each call consumes one of the extra
  // data_dictionary_fields rows seeded above, via extractEvidenceFromSourceVersion's
  // real idempotent-per-field extraction.
  async function buildClaim({
    phase5FunderAllowed = true,
    claimReviewApprovedAudiences = ["internal", "funder"],
    resolveCoverageAndFollowups = true,
  } = {}) {
    const [sourceVersion] = await query(
      `SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1`,
      [ORG],
    );
    const evidenceResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersion.source_version_id, actorContext: reviewerActor, now: NOW },
      { env: enabledEnv, evidenceLineageRepository: evidenceRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceResult.ok, true, JSON.stringify(evidenceResult));
    const [evidenceRow] = await query(
      `SELECT evidence_item_id FROM kai.evidence_items
        WHERE organization_id = $1::uuid
          AND NOT EXISTS (
                SELECT 1 FROM kai.claims c
                 WHERE c.organization_id = kai.evidence_items.organization_id
                   AND c.evidence_item_id = kai.evidence_items.evidence_item_id
              )
        ORDER BY evidence_item_id ASC LIMIT 1`,
      [ORG],
    );
    assert.ok(evidenceRow, "an unclaimed evidence item must be available - increase EXTRA_FIELD_COUNT if this fails");
    const claimResult = await proposeClaim(
      { organizationId: ORG, evidenceItemId: evidenceRow.evidence_item_id, actorContext: reviewerActor, now: NOW },
      { env: enabledEnv, claimProposalRepository: claimRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimResult.ok, true, JSON.stringify(claimResult));
    const claimId = claimResult.data.claim.claim_id;
    const claimStatement = claimResult.data.claim.claim_statement;
    const gapResult = await generateClaimGapFollowups(
      { organizationId: ORG, claimId, actorContext: reviewerActor, now: NOW },
      { env: enabledEnv, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(gapResult.ok, true, JSON.stringify(gapResult));

    const [evidenceQueue] = await query(
      `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_type = 'evidence_item' AND target_object_id = $2::uuid`,
      [ORG, evidenceRow.evidence_item_id],
    );
    const evidenceReviewResult = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId: evidenceRow.evidence_item_id, reviewQueueItemId: evidenceQueue.review_queue_item_id,
        expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported", actorContext: reviewerActor, now: NOW,
      },
      { env: enabledEnv, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceReviewResult.ok, true, JSON.stringify(evidenceReviewResult));

    const [lineage] = await query(
      `SELECT sv.intake_sensitivity_profile_id
         FROM kai.claims c
         JOIN kai.evidence_items e ON e.organization_id = c.organization_id AND e.evidence_item_id = c.evidence_item_id
         JOIN kai.source_versions sv ON sv.organization_id = e.organization_id AND sv.source_version_id = e.source_version_id
        WHERE c.organization_id = $1::uuid AND c.claim_id = $2::uuid`,
      [ORG, claimId],
    );

    let [sensitivityQueue] = await query(
      `SELECT review_queue_item_id FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_type = 'intake_sensitivity_profile' AND target_object_id = $2::uuid`,
      [ORG, lineage.intake_sensitivity_profile_id],
    );
    if (!sensitivityQueue) {
      [sensitivityQueue] = await query(
        `INSERT INTO kai.review_queue_items (
           organization_id, queue_type, target_object_type, target_object_id,
           priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
         ) VALUES ($1::uuid, 'sensitivity_review', 'intake_sensitivity_profile', $2::uuid, 'medium', 'open', 'needs_gk_review',
           'Review sensitivity and allowed-use metadata.', 'Review sensitivity and allowed-use metadata before governed use.', '{}'::jsonb, 'human')
         RETURNING review_queue_item_id`,
        [ORG, lineage.intake_sensitivity_profile_id],
      );
    }
    const [currentHead] = await query(
      `SELECT d.decision_id
         FROM kai.intake_sensitivity_review_decisions d
        WHERE d.organization_id = $1::uuid
          AND d.intake_sensitivity_profile_id = $2::uuid
          AND NOT EXISTS (
                SELECT 1 FROM kai.intake_sensitivity_review_decisions s
                 WHERE s.supersedes_decision_id = d.decision_id
              )`,
      [ORG, lineage.intake_sensitivity_profile_id],
    );
    await pool.query(
      `INSERT INTO kai.intake_sensitivity_review_decisions (
         organization_id, intake_sensitivity_profile_id, review_queue_item_id,
         decision_outcome, reviewed_personal_data_status, reviewed_minor_data_status,
         reviewed_health_housing_justice_immigration_status, reviewed_indigenous_governance_status,
         reviewed_staff_notes_status, reviewed_story_testimonial_status, reviewed_small_cell_risk_status,
         reviewed_financial_records_status, reviewed_consent_basis_status, reviewed_allowed_use_status,
         reviewed_llm_processing_allowed, reviewed_product_learning_allowed, reviewed_public_use_allowed,
         reviewed_funder_use_allowed, decided_by, decided_by_role, target_updated_at,
         supersedes_decision_id, created_by_type, created_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid,
         'reviewed', 'unknown', 'unknown',
         'unknown', 'unknown',
         'unknown', 'unknown', 'unknown',
         'unknown', 'present', 'allowed',
         false, false, false,
         $4, $5::uuid, 'gk_reviewer', $6::timestamptz,
         $7, 'human', now()
       )`,
      [ORG, lineage.intake_sensitivity_profile_id, sensitivityQueue.review_queue_item_id, phase5FunderAllowed, reviewerActor.actorUserId, NOW, currentHead?.decision_id ?? null],
    );

    if (claimReviewApprovedAudiences) {
      const [claimQueue] = await query(
        `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_type = 'claim' AND target_object_id = $2::uuid`,
        [ORG, claimId],
      );
      const claimReviewResult = await recordClaimReviewDecision(
        {
          organizationId: ORG, claimId, reviewQueueItemId: claimQueue.review_queue_item_id,
          expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved",
          approvedAudiences: claimReviewApprovedAudiences, actorContext: reviewerActor, now: NOW,
        },
        { env: enabledEnv, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(claimReviewResult.ok, true, JSON.stringify(claimReviewResult));
    }

    if (resolveCoverageAndFollowups) {
      const traced = await trace(claimId, "funder");
      const unresolved = Object.entries(traced.data.dimensions).filter(([, v]) => v.assessment_status === "unresolved").map(([k]) => k);
      for (const dimensionKey of unresolved) {
        const acceptResult = await acceptFunderCoverageLimitation(
          { organizationId: ORG, claimId, dimensionKey, actorContext: reviewerActor, now: NOW },
          { env: enabledEnv, coverageReviewDecisionRepository: coverageRepo, metadataOnlyAudit: auditRecorder() },
        );
        assert.equal(acceptResult.ok, true, JSON.stringify(acceptResult));
      }
      const followupRows = await query(
        `SELECT cfi.client_followup_item_id, rq.updated_at
           FROM kai.client_followup_items cfi
           JOIN kai.review_queue_items rq ON rq.organization_id = cfi.organization_id AND rq.queue_type = 'client_followup'
            AND rq.target_object_type = 'client_followup_item' AND rq.target_object_id = cfi.client_followup_item_id
          WHERE cfi.organization_id = $1::uuid AND cfi.claim_id = $2::uuid ORDER BY cfi.dimension_key`,
        [ORG, claimId],
      );
      for (const row of followupRows) {
        const completeResult = await completeClientFollowup(
          { organizationId: ORG, claimId, clientFollowupItemId: row.client_followup_item_id, expectedUpdatedAt: new Date(row.updated_at).toISOString(), actorContext: clientReviewerActor, now: NOW },
          { env: enabledEnv, clientFollowupCompletionRepository: clientFollowupRepo, metadataOnlyAudit: auditRecorder() },
        );
        assert.equal(completeResult.ok, true, JSON.stringify(completeResult));
      }
    }

    return { claimId, evidenceItemId: evidenceRow.evidence_item_id, claimStatement };
  }

  function singleClaimDraftGenerator() {
    return async (input) => ({
      blocks: [{ ordinal: 1, text: input.claims[0].claimStatement || "Statement.", citations: [{ claimId: input.claims[0].claimId, evidenceItemId: input.claims[0].evidenceItemId }] }],
    });
  }

  function makeCountingEvaluator() {
    const state = { count: 0 };
    async function fn(tx, args) {
      state.count += 1;
      return evaluateClaimTraceabilityInTransaction(tx, args);
    }
    return { fn, state };
  }

  // --- Direct-SQL structural helpers (mirroring the exact production INSERT
  // shapes in Backend/kai/dictionary/postgresGeneratedContentRepository.js)
  // for the two negative/overflow cases (CASE 2/CASE 4), whose citing claims
  // never need to be currently funder-eligible (CASE 2 needs no citations at
  // all; CASE 4's evaluator provably never runs), so bypassing
  // createEvidenceSummaryDraft's own funder-eligibility creation gate here is
  // scoped only to building that non-evaluated structural state - the READ
  // side under test is always the real, unmodified repository/evaluator. ---

  async function insertBareGenerationRunAndDraft({ engagementId, idempotencyKey }) {
    const fingerprint = (await pool.query(`SELECT encode(digest($1, 'sha256'), 'hex') AS fp`, [idempotencyKey])).rows[0].fp;
    const [{ generation_run_id: runId }] = await query(
      `INSERT INTO kai.generation_runs (organization_id, engagement_id, idempotency_key, request_fingerprint, content_type, requested_audience, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'evidence_summary', 'funder', 'system')
       RETURNING generation_run_id`,
      [ORG, engagementId, idempotencyKey, fingerprint],
    );
    const [{ generated_content_draft_id: draftId }] = await query(
      `INSERT INTO kai.generated_content_drafts (generation_run_id, organization_id, content_type, requested_audience, draft_status, review_status, validator_results, created_by_type)
       VALUES ($1::uuid, $2::uuid, 'evidence_summary', 'funder', 'draft', 'needs_gk_review', '[]'::jsonb, 'system')
       RETURNING generated_content_draft_id`,
      [runId, ORG],
    );
    return { runId, draftId };
  }

  async function insertBlockAndCitation({ draftId, ordinal, claimId, evidenceItemId }) {
    const [{ generated_content_block_id: blockId }] = await query(
      `INSERT INTO kai.generated_content_blocks (generated_content_draft_id, organization_id, ordinal, text)
       VALUES ($1::uuid, $2::uuid, $3::int, $4)
       RETURNING generated_content_block_id`,
      [draftId, ORG, ordinal, `Structural citation block ${ordinal}.`],
    );
    await pool.query(
      `INSERT INTO kai.generated_content_citations (generated_content_block_id, organization_id, claim_id, evidence_item_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)`,
      [blockId, ORG, claimId, evidenceItemId],
    );
  }

  async function insertOpenReviewQueueItem({ draftId }) {
    await pool.query(
      `INSERT INTO kai.review_queue_items (
         organization_id, queue_type, target_object_type, target_object_id,
         priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
       ) VALUES (
         $1::uuid, 'generated_content_review', 'generated_content_draft', $2::uuid,
         'medium', 'open', 'needs_gk_review',
         'Generated draft requires human review.',
         'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.',
         '{}'::jsonb, 'system'
       )`,
      [ORG, draftId],
    );
  }

  const results = {};

  // ==========================================================================
  // CASE 1: 50 candidate drafts, 1 distinct claim -> PASS, all 50 members.
  // ==========================================================================
  console.log("CASE 1: building one fully governed funder-eligible claim through the real service chain...");
  const case1Claim = await buildClaim();

  for (let i = 1; i <= 50; i += 1) {
    const createResult = await repoWrite.createEvidenceSummaryDraft(
      {
        organizationId: ORG, engagementId: ENGAGEMENT_CASE1, requestedAudience: "funder",
        claimIds: [case1Claim.claimId], idempotencyKey: `p14-c2-case1-draft-${i}`, actorContext: reviewerActor, now: NOW,
      },
      { draftGenerator: singleClaimDraftGenerator(), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(createResult.ok, true, JSON.stringify(createResult));
    const reviewQueueItemId = createResult.data.reviewQueueItemId;
    const [openRow] = await query(`SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [reviewQueueItemId]);
    const startResult = await repoWrite.startGeneratedContentReview({
      organizationId: ORG, generatedContentDraftId: createResult.data.generatedContentDraftId,
      reviewQueueItemId, expectedUpdatedAt: new Date(openRow.updated_at).toISOString(),
      actorContext: reviewerActor, now: LATER,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(startResult.ok, true, JSON.stringify(startResult));
    const [inProgressRow] = await query(`SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [reviewQueueItemId]);
    const completeResult = await repoWrite.completeGeneratedContentReview({
      organizationId: ORG, generatedContentDraftId: createResult.data.generatedContentDraftId,
      reviewQueueItemId, expectedUpdatedAt: new Date(inProgressRow.updated_at).toISOString(),
      actorContext: reviewerActor, now: LATEST,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(completeResult.ok, true, JSON.stringify(completeResult));
  }
  console.log("CASE 1: 50 drafts created and resolved. Reading the real Grant Response Packet...");
  const case1Evaluator = makeCountingEvaluator();
  const repoReadCase1 = createPostgresGeneratedContentRepository({ runInTransaction: withTx, evaluator: case1Evaluator.fn });
  const packet1 = await repoReadCase1.getGrantResponsePacket({ organizationId: ORG, engagementId: ENGAGEMENT_CASE1 });
  assert.equal(packet1.ok, true, JSON.stringify(packet1));
  assert.equal(packet1.data.drafts.length, 50, `expected all 50 drafts as members, got ${packet1.data.drafts.length}`);
  results.case1 = { ok: packet1.ok, memberCount: packet1.data.drafts.length, evaluatorCallCount: case1Evaluator.state.count, dataNull: packet1.data === null };
  console.log(`CASE 1 result: ok=${packet1.ok} members=${packet1.data.drafts.length} evaluatorCalls=${case1Evaluator.state.count}`);

  // ==========================================================================
  // CASE 2: 51 candidate drafts -> BLOCK on candidate-drafts bound, 0
  // evaluator invocations, no citations/claims needed at all (the bound
  // check runs before any batched structural read).
  // ==========================================================================
  console.log("CASE 2: inserting 51 bare candidate drafts (structural only, no citations needed)...");
  for (let i = 1; i <= 51; i += 1) {
    await insertBareGenerationRunAndDraft({ engagementId: ENGAGEMENT_CASE2, idempotencyKey: `p14-c2-case2-draft-${i}` });
  }
  const case2Evaluator = makeCountingEvaluator();
  const repoReadCase2 = createPostgresGeneratedContentRepository({ runInTransaction: withTx, evaluator: case2Evaluator.fn });
  const packet2 = await repoReadCase2.getGrantResponsePacket({ organizationId: ORG, engagementId: ENGAGEMENT_CASE2 });
  assert.equal(packet2.ok, false, JSON.stringify(packet2));
  assert.equal(packet2.data, null);
  assert.equal(packet2.error.code, "validation_blocker");
  assert.equal(packet2.blockers?.[0]?.blocking_reason, "candidate_drafts_execution_bound_exceeded");
  assert.equal(case2Evaluator.state.count, 0, "evaluator must never be invoked when the candidate-drafts bound is exceeded");
  results.case2 = { ok: packet2.ok, dataNull: packet2.data === null, blockingReason: packet2.blockers?.[0]?.blocking_reason, evaluatorCallCount: case2Evaluator.state.count };
  console.log(`CASE 2 result: ok=${packet2.ok} blockingReason=${packet2.blockers?.[0]?.blocking_reason} evaluatorCalls=${case2Evaluator.state.count} dataNull=${packet2.data === null}`);

  // ==========================================================================
  // CASE 3: 50 candidate drafts citing 100 distinct claims -> PASS (within
  // the distinct-claims bound). The evaluator DOES run for these claims
  // (memoized per distinct claim id) and is expected to return
  // eligible=false for each (none were taken through claim-review/coverage
  // resolution) - the packet read itself must still succeed; this proves
  // the bound is about COUNT, not per-claim eligibility.
  // ==========================================================================
  console.log("CASE 3: building 100 cheap (structurally real, non-fully-governed) distinct claims...");
  const case3Claims = [];
  for (let i = 0; i < 100; i += 1) {
    case3Claims.push(await buildClaim({ claimReviewApprovedAudiences: null, resolveCoverageAndFollowups: false }));
  }
  console.log("CASE 3: inserting 50 candidate drafts, 2 distinct-claim citations each...");
  for (let i = 0; i < 50; i += 1) {
    const { draftId } = await insertBareGenerationRunAndDraft({ engagementId: ENGAGEMENT_CASE3, idempotencyKey: `p14-c2-case3-draft-${i + 1}` });
    const claimA = case3Claims[i * 2];
    const claimB = case3Claims[i * 2 + 1];
    await insertBlockAndCitation({ draftId, ordinal: 1, claimId: claimA.claimId, evidenceItemId: claimA.evidenceItemId });
    await insertBlockAndCitation({ draftId, ordinal: 2, claimId: claimB.claimId, evidenceItemId: claimB.evidenceItemId });
    await insertOpenReviewQueueItem({ draftId });
  }
  const case3Evaluator = makeCountingEvaluator();
  const repoReadCase3 = createPostgresGeneratedContentRepository({ runInTransaction: withTx, evaluator: case3Evaluator.fn });
  const packet3 = await repoReadCase3.getGrantResponsePacket({ organizationId: ORG, engagementId: ENGAGEMENT_CASE3 });
  assert.equal(packet3.ok, true, JSON.stringify(packet3));
  results.case3 = { ok: packet3.ok, memberCount: packet3.data.drafts.length, evaluatorCallCount: case3Evaluator.state.count, dataNull: packet3.data === null };
  console.log(`CASE 3 result: ok=${packet3.ok} members=${packet3.data.drafts.length} evaluatorCalls=${case3Evaluator.state.count}`);

  // ==========================================================================
  // CASE 4: <=50 candidate drafts citing 101 distinct claims -> BLOCK on the
  // distinct-claims bound, derived from already-batched citation state,
  // before the evaluator is ever reached (0 invocations).
  // ==========================================================================
  console.log("CASE 4: building 101 cheap distinct claims...");
  const case4Claims = [];
  for (let i = 0; i < 101; i += 1) {
    case4Claims.push(await buildClaim({ claimReviewApprovedAudiences: null, resolveCoverageAndFollowups: false }));
  }
  console.log("CASE 4: inserting candidate drafts (<=20 citations each, ordinal CHECK bound) totalling 101 distinct-claim citations...");
  let claimCursor = 0;
  let case4DraftCount = 0;
  while (claimCursor < case4Claims.length) {
    const batch = case4Claims.slice(claimCursor, claimCursor + 20);
    const { draftId } = await insertBareGenerationRunAndDraft({ engagementId: ENGAGEMENT_CASE4, idempotencyKey: `p14-c2-case4-draft-${case4DraftCount + 1}` });
    for (let ordinal = 1; ordinal <= batch.length; ordinal += 1) {
      const claim = batch[ordinal - 1];
      await insertBlockAndCitation({ draftId, ordinal, claimId: claim.claimId, evidenceItemId: claim.evidenceItemId });
    }
    claimCursor += batch.length;
    case4DraftCount += 1;
  }
  assert.ok(case4DraftCount <= 50, `CASE 4 candidate-draft count must itself stay within the candidate-drafts bound so the distinct-claims bound is what trips, got ${case4DraftCount}`);
  const case4Evaluator = makeCountingEvaluator();
  const repoReadCase4 = createPostgresGeneratedContentRepository({ runInTransaction: withTx, evaluator: case4Evaluator.fn });
  const packet4 = await repoReadCase4.getGrantResponsePacket({ organizationId: ORG, engagementId: ENGAGEMENT_CASE4 });
  assert.equal(packet4.ok, false, JSON.stringify(packet4));
  assert.equal(packet4.data, null);
  assert.equal(packet4.error.code, "validation_blocker");
  assert.equal(packet4.blockers?.[0]?.blocking_reason, "distinct_claims_execution_bound_exceeded");
  assert.equal(case4Evaluator.state.count, 0, "evaluator must never be invoked when the distinct-claims bound is exceeded");
  results.case4 = {
    ok: packet4.ok, dataNull: packet4.data === null, blockingReason: packet4.blockers?.[0]?.blocking_reason,
    evaluatorCallCount: case4Evaluator.state.count, candidateDraftCount: case4DraftCount,
  };
  console.log(`CASE 4 result: ok=${packet4.ok} blockingReason=${packet4.blockers?.[0]?.blocking_reason} evaluatorCalls=${case4Evaluator.state.count} candidateDrafts=${case4DraftCount} dataNull=${packet4.data === null}`);

  await pool.end();

  console.log("--- P14-C2 execution-bounds proof summary ---");
  console.log(JSON.stringify(results, null, 2));
}
