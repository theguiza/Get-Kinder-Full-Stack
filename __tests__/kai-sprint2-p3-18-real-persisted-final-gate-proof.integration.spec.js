// P3-18 REAL PERSISTED FINAL-GATE PROOF
//
// Threads ONE real, persisted generated-content-draft/export-candidate
// identity through the REAL, unmodified services and repositories, against a
// genuine ephemeral local PostgreSQL database (no fakeTx, no fixture state):
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
// SECOND DISCLOSED BOUNDARY (a genuine finding, not repaired here): this
// file's own "DISCOVERED DEFECT" test, below, proves that the real,
// unmodified recordHumanFinalReleaseAuthorityDecision cannot persist a
// grant/revoke against this package's real, fully migrated schema today -
// migrations/kai_sprint2_p3_17_human_authority_decision_ledger.sql never
// extended the shared upload_lifecycle_audit_gate_a_operation_check CHECK
// constraint to admit the 'human_authority_decision_recorded' audit
// operation its own repository unconditionally writes, unlike every other
// package migration that adds a new audit operation value. That is a
// pre-existing P3-17 migration gap, not attributable to the VAL-EXP-001
// source-draft semantic correction; per this package's explicit scope it is
// not repaired here. STATE B, D, and C (each of which requires a real
// persisted grant as their starting point) are consequently skipped, not
// deleted or faked - see the DISCOVERED DEFECT test for the full
// reproduction and exact evidence.

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
  const CLAIM = "10000000-0000-4000-8000-000000000970";
  const NOW = "2026-08-06T10:00:00.000Z";
  const LATER = "2026-08-06T10:05:00.000Z";
  const EVEN_LATER = "2026-08-06T10:10:00.000Z";
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

  test("P3-18 REAL PERSISTED FINAL-GATE PROOF: generated draft -> review -> export review -> candidate -> P3-17 authority -> real, unmodified final-gate composition -> VAL-EXP-001", async (t2) => {
    let draftId = null;
    let generatedContentQueueId = null;
    let exportReviewQueueId = null;
    let evidenceId = null;
    let exportCandidateId = null;

    await t2.test("0. seed a real claim/evidence pair from the shared template chain (substrate outside this proof's own service list, same technique as P3-06/P3-16/P3-17)", async () => {
      const templateRows = await query(
        `SELECT evidence_item_id::text AS evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id ASC LIMIT 1`,
        [ORG],
      );
      const templateEvidenceId = templateRows[0].evidence_item_id;
      evidenceId = "10000000-0000-4000-8000-000000000980";
      await query(
        `INSERT INTO kai.evidence_items (
           evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
           evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type
         )
         SELECT $1::uuid, organization_id, source_id, source_version_id, source_locator_id,
                evidence_type, data_class, sensitivity_level, support_strength,
                'Synthetic P3-18 real-persisted-final-gate-proof evidence item.', repeat('9', 64), created_by_type
           FROM kai.evidence_items WHERE evidence_item_id = $2::uuid`,
        [evidenceId, templateEvidenceId],
      );
      await query(
        `INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
         VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review','unassessed','Synthetic P3-18 real-persisted-final-gate-proof claim.',repeat('8',64),'system')`,
        [CLAIM, ORG, evidenceId],
      );
      await query(
        `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type) VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
        [ORG, CLAIM, evidenceId],
      );
    });

    await t2.test("1. generated draft is created (real createEvidenceSummaryDraft)", async () => {
      const result = await createEvidenceSummaryDraft(
        {
          organizationId: ORG,
          requestedAudience: "internal",
          claimIds: [CLAIM],
          idempotencyKey: "p3-18-real-persisted-final-gate-proof-0001",
          actorContext: gkReviewerActorContext,
          now: NOW,
        },
        {
          env: enabledEnv,
          generatedContentRepository: generatedContentRepository(creationEvaluator()),
          draftGenerator: draftGenerator(),
          metadataOnlyAudit: auditRecorder(),
        },
      );
      assert.equal(result.ok, true);
      draftId = result.data.generatedContentDraftId;
      generatedContentQueueId = result.data.reviewQueueItemId;
    });

    await t2.test("2. generated-content review resolves (real completeGeneratedContentReview)", async () => {
      await query(`UPDATE kai.review_queue_items SET queue_status = 'in_progress' WHERE review_queue_item_id = $1::uuid`, [generatedContentQueueId]);
      const updatedAtRows = await query(`SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [generatedContentQueueId]);
      const result = await completeGeneratedContentReview(
        {
          organizationId: ORG,
          generatedContentDraftId: draftId,
          reviewQueueItemId: generatedContentQueueId,
          expectedUpdatedAt: updatedAtRows[0].updated_at.toISOString(),
          actorContext: gkReviewerActorContext,
          now: NOW,
        },
        { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, true);
      assert.equal(result.data.queueStatus, "resolved");
      assert.equal(result.data.reviewStatus, "resolved");
    });

    await t2.test("3. export review is requested, started, and resolved (real request/start/completeGeneratedDraftExportReview)", async () => {
      const requested = await requestGeneratedDraftExportReview(
        { organizationId: ORG, generatedContentDraftId: draftId, requestedExportAudience: "internal", actorContext: gkAdminActorContext, now: NOW },
        { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(requested.ok, true);
      exportReviewQueueId = requested.data.reviewQueueItemId;

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
    });

    await t2.test("4. limitation snapshot is confirmed (real confirmGeneratedDraftLimitationSnapshot)", async () => {
      const result = await confirmGeneratedDraftLimitationSnapshot(
        {
          organizationId: ORG,
          generatedContentDraftId: draftId,
          entries: [{ claimId: CLAIM, evidenceItemId: evidenceId, limitationCodes: [] }],
          actorContext: gkReviewerActorContext,
          now: NOW,
        },
        { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, true);
      assert.equal(result.data.replayed, false);
    });

    await t2.test("5. export candidate is created (real createGeneratedDraftExportCandidate)", async () => {
      const result = await createGeneratedDraftExportCandidate(
        { organizationId: ORG, generatedContentDraftId: draftId, actorContext: gkAdminActorContext, now: NOW },
        { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, true);
      exportCandidateId = result.data.exportCandidateId;
    });

    // ------------------------------------------------------------------
    // STATE A - real persisted draft, reviews resolved, candidate current,
    // no effective P3-17 export authority -> BLOCKED
    // ------------------------------------------------------------------
    await t2.test("STATE A: no effective P3-17 authority -> BLOCKED", async () => {
      const draftBefore = await query(`SELECT draft_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid`, [draftId]);
      assert.equal(draftBefore[0].draft_status, "draft");

      const result = await evaluateFinalExportEligibility(
        { organizationId: ORG, exportCandidateId, exportReviewQueueItemId: exportReviewQueueId, actorContext: gkAdminActorContext },
        finalGateDependencies(evidenceId, { eligible: true }),
      );
      assert.equal(result.ok, true);
      assert.equal(result.data.effectiveHumanExportAuthority, false);
      assert.equal(result.data.effectivenessReason, "no_decision");
      assert.equal(result.data.validatorResult.severity, "blocker");
      assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
      assert.equal(result.data.finalExportEligible, false);
    });

    // ------------------------------------------------------------------
    // DISCOVERED, PRE-EXISTING, OUT-OF-SCOPE DEFECT (not attributable to
    // the VAL-EXP-001 source-draft semantic correction; NOT repaired here
    // per this package's explicit instruction not to reopen P3-16/P3-17
    // semantics and not to touch schema/migrations):
    //
    // Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js's
    // real, unmodified recordDecision() unconditionally inserts an audit row
    // with operation = 'human_authority_decision_recorded' into
    // kai.upload_lifecycle_audit. Every OTHER package migration that adds a
    // new audit operation value (P1-04 through P3-16, all found via `grep
    // upload_lifecycle_audit_gate_a_operation_check migrations/*.sql`)
    // DROP/ADD-extends the shared
    // upload_lifecycle_audit_gate_a_operation_check CHECK constraint to admit
    // its own new operation value. migrations/kai_sprint2_p3_17_human_authority_decision_ledger.sql
    // is the one exception: it adds the human_authority_decisions table and
    // ledger constraints, but never extends that shared CHECK constraint to
    // admit 'human_authority_decision_recorded'. Against a real, fully
    // migrated schema (proven here, not asserted from reading the SQL) this
    // makes recordDecision's INSERT fail with a 23514 check-constraint
    // violation on every call, which the repository's own catch block maps
    // to validation_blocker - so recordHumanFinalReleaseAuthorityDecision can
    // never succeed for real. No committed test discovered this before now
    // because every existing P3-17 test either uses a fakeTx/mocked
    // repository or (kai-sprint2-p3-17-human-authority-decision-ledger.integration.spec.js)
    // only exercises the read-only evaluateEffectiveness path against
    // directly-seeded ledger rows, never recordDecision, against real
    // Postgres.
    // ------------------------------------------------------------------
    await t2.test("DISCOVERED DEFECT: real recordHumanFinalReleaseAuthorityDecision cannot succeed against a real, fully migrated schema (pre-existing P3-17 migration gap, not attributable to VAL-EXP-001, not repaired here)", async () => {
      const grant = await recordHumanFinalReleaseAuthorityDecision(
        { organizationId: ORG, exportCandidateId, requestedAudience: "internal", decisionAction: "grant", actorContext: gkAdminActorContext, now: NOW },
        { env: enabledEnv, humanAuthorityDecisionRepository: humanAuthorityDecisionRepository(), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(grant.ok, false);
      assert.equal(grant.error.code, "validation_blocker");

      const headRows = await query(
        `SELECT count(*)::int AS count FROM kai.human_authority_decisions WHERE organization_id = $1::uuid AND export_candidate_id = $2::uuid`,
        [ORG, exportCandidateId],
      );
      assert.equal(headRows[0].count, 0, "the failed transaction must leave zero persisted decision rows");

      const constraintRows = await query(
        `SELECT pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'kai.upload_lifecycle_audit'::regclass
            AND conname = 'upload_lifecycle_audit_gate_a_operation_check'`,
      );
      assert.equal(
        constraintRows[0].definition.includes("human_authority_decision_recorded"),
        false,
        "this assertion is the reproduction: if a future migration extends the constraint, this test starts failing and STATE B/C/D below must be un-skipped",
      );
    });

    // ------------------------------------------------------------------
    // STATE B / STATE D / STATE C all require a real, persisted P3-17
    // grant (and, for D, a subsequent supersede + re-evaluation, and for C
    // a subsequent revoke) as their starting point. The DISCOVERED DEFECT
    // test immediately above proves that a real
    // recordHumanFinalReleaseAuthorityDecision call cannot succeed against
    // this package's real, fully migrated schema today. Per this package's
    // explicit scope (repair only defects attributable to the VAL-EXP-001
    // correction; do not reopen P3-16/P3-17 semantics; do not touch
    // schema/migrations), that gap is not repaired here, so STATE B/D/C
    // cannot be exercised with a real persisted grant in this proof. They
    // remain skipped, not deleted, so they are the first thing to un-skip
    // once a separately authorized P3-17 migration fix lands.
    // ------------------------------------------------------------------
    await t2.test(
      "STATE B: real P3-17 grant + real everything else -> PASS, source draft_status untouched",
      { skip: "blocked by the DISCOVERED DEFECT above: real recordHumanFinalReleaseAuthorityDecision cannot persist a grant against the real schema today" },
      () => {},
    );
    await t2.test(
      "STATE D: limitation snapshot superseded -> candidate stale under real P3-16 rules -> BLOCKED",
      { skip: "requires the real granted lifecycle from STATE B, currently blocked by the DISCOVERED DEFECT above" },
      () => {},
    );
    await t2.test(
      "STATE C: P3-17 authority revoked -> BLOCKED",
      { skip: "requires the real granted lifecycle from STATE B, currently blocked by the DISCOVERED DEFECT above" },
      () => {},
    );
  });
}
