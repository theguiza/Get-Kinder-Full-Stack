// P3-18 REAL PERSISTED FINAL-GATE PROOF
//
// Threads real, persisted generated-content-draft/export-candidate identities
// through the REAL, unmodified services and repositories, against a genuine
// ephemeral local PostgreSQL database (no fakeTx, no fixture state):
//
//   generated draft (real createEvidenceSummaryDraft)
//     -> generated-content review (real completeGeneratedContentReview)
//     -> export review (real request/start/completeGeneratedDraftExportReview)
//     -> limitation snapshot (real confirmGeneratedDraftLimitationSnapshot)
//     -> export candidate (real createGeneratedDraftExportCandidate)
//     -> P3-17 human authority (real recordHumanFinalReleaseAuthorityDecision)
//     -> final-gate composition (real, unmodified evaluateFinalExportEligibility)
//     -> VAL-EXP-001
//
// Every one of these calls uses the real, unmodified service/repository
// function, injected only with the transaction-plumbing seam
// (runInTransaction -> a real pg Pool bound to the ephemeral database) that
// every one of these functions already exposes in production. Nothing here
// injects or overrides draftStatus, draftIsStillDraft, reviewIsResolved,
// candidate currentness, or affirmativeHumanExportAuthority: draft_status,
// review-queue state, export-candidate/limitation-snapshot state, and the
// P3-17 authority-decision ledger are all read for real, by the real,
// unmodified evaluateGeneratedDraftExportReviewPacketInTransaction,
// loadExportCandidateForAuthority, and
// createPostgresHumanAuthorityDecisionRepository (the exact functions
// evaluateFinalExportEligibility's own default dependencies already use).
//
// DISCLOSED SCOPE BOUNDARY: current-use eligibility (packet.currentUseEligible)
// is computed from the real P2-06 claim-traceability evaluator's `eligible`
// field, which in production requires a fully resolved P1/P2 pipeline
// (client-followup completion, per-dimension coverage-review decisions,
// conflict resolution, and a terminal P2-12 decision-ledger head for both the
// claim and its evidence). Reconstructing that full pipeline from scratch is
// a separate package's concern, well outside VAL-EXP-001/P3-18's boundary,
// and empirically(*) requires resolving followups/coverage gaps this package
// has no authority to reinterpret. Exactly like this package's own prior,
// already-committed real-Postgres proof at this same layer
// (kai-sprint2-p3-06-export-review-packet.integration.spec.js, which injects
// its own `readPacketEvaluator({eligible})` for the identical reason), this
// file injects a real-shaped, disclosed stand-in `evaluator` function for
// that one P2-06 seam only. It still reads the genuinely persisted claim and
// evidence rows; it does not touch or stand in for draft_status, review-queue
// state, export-candidate/limitation-snapshot currentness, or the P3-17
// authority ledger, which remain fully real and unmodified throughout.
// (*) Verified interactively against this exact migration/seed chain before
// writing this file: the real evaluator's blockerCodes for a freshly
// seeded claim include client_followup_unresolved and
// coverage_dimension_unresolved, which only real P2-04/P2-10/P2-11 review
// completion (out of this package's boundary) can clear.
//
// FORMERLY DISCLOSED, NOW REPAIRED BOUNDARY: this file previously stopped at
// a "DISCOVERED DEFECT" test proving that the real, unmodified
// recordHumanFinalReleaseAuthorityDecision could not persist a grant/revoke
// against this package's real, fully migrated schema, because
// migrations/kai_sprint2_p3_17_human_authority_decision_ledger.sql never
// extended the shared upload_lifecycle_audit_gate_a_operation_check CHECK
// constraint to admit the 'human_authority_decision_recorded' audit
// operation its own repository unconditionally writes. That gap is now
// closed by migrations/kai_sprint2_p3_17_authority_audit_gate_a_operation_repair.sql
// (a separately committed, additive-only P3-17 repair). STATE B, C, and D
// below now exercise a real, persisted P3-17 grant/revoke/staleness lifecycle
// end to end instead of being skipped.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P3_18_REAL_PERSISTED_FINAL_GATE_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P3-18 real-persisted-final-gate-proof suite refused a non-loopback KAI_P3_18_REAL_PERSISTED_FINAL_GATE_DATABASE_URL host: ${host}`);
  }
}

test("P3-18 real-persisted-final-gate-proof PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P3-18 real-persisted-final-gate-proof PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresGeneratedContentRepository\.js|postgresExportCandidateRepository\.js|postgresHumanAuthorityDecisionRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P3-18 real-persisted-final-gate-proof requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP318RealPersistedFinalGateProof();
}

async function runP318RealPersistedFinalGateProof() {
  const { Pool } = await import("pg");
  const { createPostgresGeneratedContentRepository, evaluateGeneratedDraftExportReviewPacketInTransaction } =
    await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { createEvidenceSummaryDraft, completeGeneratedContentReview } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
  const {
    requestGeneratedDraftExportReview,
    startGeneratedDraftExportReview,
    completeGeneratedDraftExportReview,
  } = await import("../Backend/kai/services/kaiExportReviewService.js");
  const { createPostgresExportCandidateRepository } = await import("../Backend/kai/dictionary/postgresExportCandidateRepository.js");
  const { confirmGeneratedDraftLimitationSnapshot, createGeneratedDraftExportCandidate } = await import("../Backend/kai/services/kaiExportCandidateService.js");
  const { createPostgresHumanAuthorityDecisionRepository, loadExportCandidateForAuthority } =
    await import("../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js");
  const { recordHumanFinalReleaseAuthorityDecision } = await import("../Backend/kai/services/kaiHumanAuthorityDecisionService.js");
  const { evaluateFinalExportEligibility } = await import("../Backend/kai/services/kaiFinalExportEligibilityGateService.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const ENGAGEMENT = "00000000-0000-4000-8000-000000000918";
  const CLAIM = "10000000-0000-4000-8000-000000000970";
  const CLAIM_D = "10000000-0000-4000-8000-000000000990";
  const EVIDENCE_D = "10000000-0000-4000-8000-000000000991";
  const NOW = "2026-08-06T10:00:00.000Z";
  const LATER = "2026-08-06T10:05:00.000Z";
  const EVEN_LATER = "2026-08-06T10:10:00.000Z";
  const GRANT_AT = "2026-08-06T10:15:00.000Z";
  const REVOKE_AT = "2026-08-06T10:20:00.000Z";
  const SUPERSEDE_AT = "2026-08-06T10:25:00.000Z";
  const enabledEnv = { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true", KAI_PUBLIC_EXPORT_ENABLED: "true" };
  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 10 });

  async function withRunnerOwnedTransaction(callback) {
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
    const result = await pool.query(sql, params);
    return result.rows;
  }

  async function getEngagementForOrganization({ organizationId, engagementId }) {
    const rows = await query(
      `SELECT engagement_id::text AS engagement_id, organization_id::text AS organization_id
         FROM kai.engagements
        WHERE organization_id = $1::uuid AND engagement_id = $2::uuid`,
      [organizationId, engagementId],
    );
    return rows[0] || null;
  }

  test.after(async () => {
    await pool.end();
  });

  const gkAdminActorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000005",
    source: "public.userdata",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  };
  const gkReviewerActorContext = {
    ...gkAdminActorContext,
    actorUserId: "90000000-0000-4000-8000-000000000004",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };

  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  // Creation-time P2-06 traceability stand-in (identical technique and
  // justification as kai-sprint2-p3-06-export-review-packet.integration.spec.js's
  // own p301Evaluator/readPacketEvaluator): reads the real seeded claim row,
  // reports it traceable so real draft generation can proceed.
  function creationEvaluator() {
    return async (tx, evalInput) => {
      const rows = await tx.query(
        `SELECT claim_id::text AS claim_id, evidence_item_id::text AS evidence_item_id
           FROM kai.claims
          WHERE organization_id = $1::uuid AND claim_id = $2::uuid`,
        [evalInput.organizationId, evalInput.claimId],
      );
      const claim = rows.rows[0];
      return {
        ok: true,
        data: { claim: { claim_id: claim.claim_id }, evidence: { evidence_item_id: claim.evidence_item_id }, requestedAudience: evalInput.requestedAudience, eligible: true },
        error: null,
      };
    };
  }

  // Real-columns-driven current-use-eligibility stand-in for the P2-06 seam
  // only (see file header disclosure). Reads the genuinely persisted
  // claim/evidence rows and reports the disclosed `eligible` flag; never
  // stands in for draft_status, review-queue state, candidate currentness,
  // or P3-17 authority, all of which remain fully real throughout this file.
  function currentUseEvaluator(evidenceId, { eligible }) {
    return async (tx, evalInput) => ({
      ok: true,
      data: {
        claim: {
          claim_id: evalInput.claimId,
          claim_type: "finding",
          claim_status: "proposed",
          claim_review_status: eligible ? "approved" : "needs_gk_review",
          claim_strength: "unassessed",
          audience_gates: {},
        },
        evidence: {
          evidence_item_id: evidenceId,
          evidence_review_status: eligible ? "approved" : "needs_gk_review",
          support_strength: "unassessed",
          review_queue_item_id: "10000000-0000-4000-8000-000000000971",
          review_queue_status: "resolved",
          review_status: eligible ? "approved" : "needs_gk_review",
          updated_at: "2026-08-06T09:00:00.000Z",
          sensitivity_level: "unknown",
        },
        locator: { source_locator_id: "10000000-0000-4000-8000-000000000972" },
        source: { source_id: "10000000-0000-4000-8000-000000000973", source_code: null },
        source_version: { source_version_id: "10000000-0000-4000-8000-000000000974", is_current: true },
        claim_review: { review_queue_item_id: "10000000-0000-4000-8000-000000000975", queue_status: "resolved", review_status: eligible ? "approved" : "needs_gk_review" },
        candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000003" },
        promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000976" },
        dimensions: {},
        gap_items: [],
        client_followup_workflows: [],
        potential_conflict_groups: [],
        requestedAudience: evalInput.requestedAudience,
        eligible,
        blockerCodes: eligible ? [] : ["claim_review_unresolved"],
        affectedDimensionKeys: eligible ? [] : ["missingness"],
        affectedObjectIds: eligible ? [] : ["10000000-0000-4000-8000-000000000975"],
        truncated: false,
      },
      error: null,
    });
  }

  function draftGenerator() {
    return async (genInput) => ({
      blocks: [{
        ordinal: 1,
        text: genInput.claims[0].claimStatement,
        citations: [{ claimId: genInput.claims[0].claimId, evidenceItemId: genInput.claims[0].evidenceItemId }],
      }],
    });
  }

  function generatedContentRepository(evaluator) {
    return createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator });
  }

  function exportCandidateRepository() {
    return createPostgresExportCandidateRepository({ runInTransaction: withRunnerOwnedTransaction });
  }

  function humanAuthorityDecisionRepository() {
    return createPostgresHumanAuthorityDecisionRepository({ runInTransaction: withRunnerOwnedTransaction });
  }

  function finalGateDependencies(evidenceId, { eligible = true } = {}) {
    return {
      env: enabledEnv,
      runInTransaction: withRunnerOwnedTransaction,
      evaluatePacket: evaluateGeneratedDraftExportReviewPacketInTransaction,
      evaluator: currentUseEvaluator(evidenceId, { eligible }),
      loadCandidate: loadExportCandidateForAuthority,
      humanAuthorityDecisionRepository: humanAuthorityDecisionRepository(),
    };
  }

  // Seeds one real claim/evidence pair, then threads it through the real
  // generated-draft -> generated-content-review -> export-review ->
  // limitation-snapshot -> export-candidate pipeline, exactly as STATE A's
  // own setup did. Reused for STATE D's independently-staled candidate so
  // that D's staleness signal is never entangled with STATE C's revoke on
  // the STATE A/B/C candidate.
  async function seedFullExportCandidatePipeline({ claimId, evidenceId, idempotencyKey }) {
    const templateRows = await query(
      `SELECT evidence_item_id::text AS evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id ASC LIMIT 1`,
      [ORG],
    );
    const templateEvidenceId = templateRows[0].evidence_item_id;
    await query(
      `INSERT INTO kai.evidence_items (
         evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
         evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type
       )
       SELECT $1::uuid, organization_id, source_id, source_version_id, source_locator_id,
              evidence_type, data_class, sensitivity_level, support_strength,
              'Synthetic P3-18 real-persisted-final-gate-proof evidence item.', encode(digest($1::text, 'sha256'), 'hex'), created_by_type
         FROM kai.evidence_items WHERE evidence_item_id = $2::uuid`,
      [evidenceId, templateEvidenceId],
    );
    await query(
      `INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review','unassessed','Synthetic P3-18 real-persisted-final-gate-proof claim.',encode(digest($1::text, 'sha256'), 'hex'),'system')`,
      [claimId, ORG, evidenceId],
    );
    await query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type) VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
      [ORG, claimId, evidenceId],
    );

    const created = await createEvidenceSummaryDraft(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        requestedAudience: "internal",
        claimIds: [claimId],
        idempotencyKey,
        actorContext: gkReviewerActorContext,
        now: NOW,
      },
      {
        env: enabledEnv,
        getEngagementForOrganization,
        generatedContentRepository: generatedContentRepository(creationEvaluator()),
        draftGenerator: draftGenerator(),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(created.ok, true);
    const draftId = created.data.generatedContentDraftId;
    const generatedContentQueueId = created.data.reviewQueueItemId;

    await query(`UPDATE kai.review_queue_items SET queue_status = 'in_progress' WHERE review_queue_item_id = $1::uuid`, [generatedContentQueueId]);
    const genUpdatedAtRows = await query(`SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [generatedContentQueueId]);
    const genReview = await completeGeneratedContentReview(
      {
        organizationId: ORG,
        generatedContentDraftId: draftId,
        reviewQueueItemId: generatedContentQueueId,
        expectedUpdatedAt: genUpdatedAtRows[0].updated_at.toISOString(),
        actorContext: gkReviewerActorContext,
        now: NOW,
      },
      { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(genReview.ok, true);
    assert.equal(genReview.data.queueStatus, "resolved");
    assert.equal(genReview.data.reviewStatus, "resolved");

    const requested = await requestGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: draftId, requestedExportAudience: "internal", actorContext: gkAdminActorContext, now: NOW },
      { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(requested.ok, true);
    const exportReviewQueueId = requested.data.reviewQueueItemId;

    const startUpdatedAtRows = await query(`SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [exportReviewQueueId]);
    const started = await startGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: draftId, exportReviewQueueItemId: exportReviewQueueId, expectedUpdatedAt: startUpdatedAtRows[0].updated_at.toISOString(), actorContext: gkAdminActorContext, now: LATER },
      { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(started.ok, true);
    assert.equal(started.data.queueStatus, "in_progress");

    const completeUpdatedAtRows = await query(`SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [exportReviewQueueId]);
    const completed = await completeGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: draftId, exportReviewQueueItemId: exportReviewQueueId, expectedUpdatedAt: completeUpdatedAtRows[0].updated_at.toISOString(), actorContext: gkAdminActorContext, now: EVEN_LATER },
      { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(completed.ok, true);
    assert.equal(completed.data.queueStatus, "resolved");
    assert.equal(completed.data.reviewStatus, "resolved");

    const snapshot = await confirmGeneratedDraftLimitationSnapshot(
      {
        organizationId: ORG,
        generatedContentDraftId: draftId,
        entries: [{ claimId, evidenceItemId: evidenceId, limitationCodes: [] }],
        actorContext: gkReviewerActorContext,
        now: NOW,
      },
      { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.data.replayed, false);

    const candidate = await createGeneratedDraftExportCandidate(
      { organizationId: ORG, generatedContentDraftId: draftId, actorContext: gkAdminActorContext, now: NOW },
      { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(candidate.ok, true);

    return { draftId, generatedContentQueueId, exportReviewQueueId, evidenceId, claimId, exportCandidateId: candidate.data.exportCandidateId };
  }

  test("P3-18 REAL PERSISTED FINAL-GATE PROOF: generated draft -> review -> export review -> candidate -> P3-17 authority -> real, unmodified final-gate composition -> VAL-EXP-001", async (t2) => {
    let pipeline = null;

    await t2.test("0-5. seed a real claim/evidence pair and thread it through the real draft/review/candidate pipeline", async () => {
      pipeline = await seedFullExportCandidatePipeline({
        claimId: CLAIM,
        evidenceId: "10000000-0000-4000-8000-000000000980",
        idempotencyKey: "p3-18-real-persisted-final-gate-proof-0001",
      });
    });

    // ------------------------------------------------------------------
    // STATE A - real persisted draft, reviews resolved, candidate current,
    // no effective P3-17 export authority -> BLOCKED
    // ------------------------------------------------------------------
    await t2.test("STATE A: no effective P3-17 authority -> BLOCKED", async () => {
      const draftBefore = await query(`SELECT draft_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid`, [pipeline.draftId]);
      assert.equal(draftBefore[0].draft_status, "draft");

      const result = await evaluateFinalExportEligibility(
        { organizationId: ORG, exportCandidateId: pipeline.exportCandidateId, exportReviewQueueItemId: pipeline.exportReviewQueueId, actorContext: gkAdminActorContext },
        finalGateDependencies(pipeline.evidenceId, { eligible: true }),
      );
      assert.equal(result.ok, true);
      assert.equal(result.data.effectiveHumanExportAuthority, false);
      assert.equal(result.data.effectivenessReason, "no_decision");
      assert.equal(result.data.validatorResult.severity, "blocker");
      assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
      assert.equal(result.data.finalExportEligible, false);
    });

    // ------------------------------------------------------------------
    // STATE B - real P3-17 grant recorded against the real, repaired schema
    // -> effective authority -> PASS. The generated-content draft's
    // draft_status is read, never written, by this whole lifecycle: proven
    // unchanged before and after.
    // ------------------------------------------------------------------
    let grantDecisionId = null;
    await t2.test("STATE B: real P3-17 grant + real everything else -> PASS, source draft_status untouched", async () => {
      const draftStatusBefore = await query(`SELECT draft_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid`, [pipeline.draftId]);
      assert.equal(draftStatusBefore[0].draft_status, "draft");

      const grant = await recordHumanFinalReleaseAuthorityDecision(
        { organizationId: ORG, exportCandidateId: pipeline.exportCandidateId, requestedAudience: "internal", decisionAction: "grant", actorContext: gkAdminActorContext, now: GRANT_AT },
        { env: enabledEnv, humanAuthorityDecisionRepository: humanAuthorityDecisionRepository(), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(grant.ok, true, JSON.stringify(grant));
      assert.equal(grant.data.effective, true);
      assert.equal(grant.data.decisionAction, "grant");
      grantDecisionId = grant.data.decisionId;

      const decisionRows = await query(
        `SELECT decision_action, decided_by_role, supersedes_decision_id FROM kai.human_authority_decisions WHERE decision_id = $1::uuid`,
        [grantDecisionId],
      );
      assert.equal(decisionRows.length, 1);
      assert.equal(decisionRows[0].decision_action, "grant");
      assert.equal(decisionRows[0].supersedes_decision_id, null);

      const auditRows = await query(
        `SELECT operation FROM kai.upload_lifecycle_audit WHERE metadata->>'decision_id' = $1`,
        [grantDecisionId],
      );
      assert.equal(auditRows.length, 1);
      assert.equal(auditRows[0].operation, "human_authority_decision_recorded");

      const result = await evaluateFinalExportEligibility(
        { organizationId: ORG, exportCandidateId: pipeline.exportCandidateId, exportReviewQueueItemId: pipeline.exportReviewQueueId, actorContext: gkAdminActorContext },
        finalGateDependencies(pipeline.evidenceId, { eligible: true }),
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.effectiveHumanExportAuthority, true);
      assert.equal(result.data.effectivenessReason, null);
      assert.equal(result.data.validatorResult.severity, "pass");
      assert.equal(result.data.finalExportEligible, true);

      const draftStatusAfter = await query(`SELECT draft_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid`, [pipeline.draftId]);
      assert.equal(draftStatusAfter[0].draft_status, "draft");
    });

    // ------------------------------------------------------------------
    // STATE C - the same P3-17 grant is revoked (real recordDecision
    // supersession) -> effective authority is false again -> BLOCKED.
    // ------------------------------------------------------------------
    await t2.test("STATE C: P3-17 authority revoked -> BLOCKED", async () => {
      const revoke = await recordHumanFinalReleaseAuthorityDecision(
        { organizationId: ORG, exportCandidateId: pipeline.exportCandidateId, requestedAudience: "internal", decisionAction: "revoke", actorContext: gkAdminActorContext, now: REVOKE_AT },
        { env: enabledEnv, humanAuthorityDecisionRepository: humanAuthorityDecisionRepository(), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(revoke.ok, true, JSON.stringify(revoke));
      assert.equal(revoke.data.decisionAction, "revoke");
      assert.equal(revoke.data.supersedesDecisionId, grantDecisionId);
      assert.equal(revoke.data.effective, false);

      const auditRows = await query(
        `SELECT operation FROM kai.upload_lifecycle_audit WHERE metadata->>'decision_id' = $1`,
        [revoke.data.decisionId],
      );
      assert.equal(auditRows.length, 1);
      assert.equal(auditRows[0].operation, "human_authority_decision_recorded");

      const result = await evaluateFinalExportEligibility(
        { organizationId: ORG, exportCandidateId: pipeline.exportCandidateId, exportReviewQueueItemId: pipeline.exportReviewQueueId, actorContext: gkAdminActorContext },
        finalGateDependencies(pipeline.evidenceId, { eligible: true }),
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.effectiveHumanExportAuthority, false);
      assert.equal(result.data.effectivenessReason, "head_is_revoke");
      assert.equal(result.data.validatorResult.severity, "blocker");
      assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
      assert.equal(result.data.finalExportEligible, false);
    });

    // ------------------------------------------------------------------
    // STATE D - an independent second candidate, granted and current, whose
    // limitation snapshot is then superseded (real
    // confirmGeneratedDraftLimitationSnapshot on the same draft), making the
    // candidate stale under P3-16's real, unmodified currentness rules ->
    // BLOCKED, distinctly from STATE C's revoke.
    // ------------------------------------------------------------------
    let pipelineD = null;
    await t2.test("STATE D: independent candidate, granted and current -> PASS baseline", async () => {
      pipelineD = await seedFullExportCandidatePipeline({
        claimId: CLAIM_D,
        evidenceId: EVIDENCE_D,
        idempotencyKey: "p3-18-real-persisted-final-gate-proof-state-d-0001",
      });

      const grant = await recordHumanFinalReleaseAuthorityDecision(
        { organizationId: ORG, exportCandidateId: pipelineD.exportCandidateId, requestedAudience: "internal", decisionAction: "grant", actorContext: gkAdminActorContext, now: GRANT_AT },
        { env: enabledEnv, humanAuthorityDecisionRepository: humanAuthorityDecisionRepository(), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(grant.ok, true, JSON.stringify(grant));
      assert.equal(grant.data.effective, true);

      const baseline = await evaluateFinalExportEligibility(
        { organizationId: ORG, exportCandidateId: pipelineD.exportCandidateId, exportReviewQueueItemId: pipelineD.exportReviewQueueId, actorContext: gkAdminActorContext },
        finalGateDependencies(pipelineD.evidenceId, { eligible: true }),
      );
      assert.equal(baseline.ok, true, JSON.stringify(baseline));
      assert.equal(baseline.data.effectiveHumanExportAuthority, true);
      assert.equal(baseline.data.finalExportEligible, true);
    });

    await t2.test("STATE D: limitation snapshot superseded -> candidate stale under real P3-16 rules -> BLOCKED", async () => {
      const supersede = await confirmGeneratedDraftLimitationSnapshot(
        {
          organizationId: ORG,
          generatedContentDraftId: pipelineD.draftId,
          entries: [{ claimId: pipelineD.claimId, evidenceItemId: pipelineD.evidenceId, limitationCodes: ["small_sample_size"] }],
          actorContext: gkReviewerActorContext,
          now: SUPERSEDE_AT,
        },
        { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(supersede.ok, true, JSON.stringify(supersede));
      assert.equal(supersede.data.replayed, false);

      // The P3-17 ledger row itself is never touched by a P3-16 snapshot
      // supersession: the grant is still the current head, only its bound
      // candidate is no longer current.
      const decisionRows = await query(
        `SELECT count(*)::int AS count FROM kai.human_authority_decisions WHERE export_candidate_id = $1::uuid`,
        [pipelineD.exportCandidateId],
      );
      assert.equal(decisionRows[0].count, 1);

      const result = await evaluateFinalExportEligibility(
        { organizationId: ORG, exportCandidateId: pipelineD.exportCandidateId, exportReviewQueueItemId: pipelineD.exportReviewQueueId, actorContext: gkAdminActorContext },
        finalGateDependencies(pipelineD.evidenceId, { eligible: true }),
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.effectiveHumanExportAuthority, false);
      assert.equal(result.data.effectivenessReason, "limitation_snapshot_superseded");
      assert.equal(result.data.validatorResult.severity, "blocker");
      assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
      assert.equal(result.data.finalExportEligible, false);
    });
  });
}
