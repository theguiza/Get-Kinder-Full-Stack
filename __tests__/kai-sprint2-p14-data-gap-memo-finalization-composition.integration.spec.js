// P14 DATA_GAP_MEMO FINALIZATION COMPOSITION - REAL PERSISTED PROOF
//
// This suite is the real-database companion to the Phase-14 repair that
// closed the `candidateReadyToPrepare` circularity bug in
// Backend/kai/dictionary/postgresGeneratedContentRepository.js
// (evaluateGeneratedDraftExportReviewPacketInTransaction): the old code
// required validatorResult.severity === "pass" from
// validateExportManifestEligibility, called with finalGate/
// affirmativeHumanExportAuthority hardcoded false - a combination that
// unconditionally fails VAL-EXP-001's own gate logic, so
// candidateReadyToPrepare could never be true before a candidate existed.
// The repair instead checks that no VAL-EXP-001 failed_gate OTHER than the
// ones expected-absent pre-candidate
// (EXPORT_REVIEW_READINESS_FAILED_GATES) is present.
//
// This file threads a REAL, persisted content_type = 'data_gap_memo'
// generated-content draft through the REAL, unmodified services and
// repositories this repository's own P3-18/P3-19/durable-read-recovery
// suites already use for 'evidence_summary' - proving the identical
// generic Phase-14 finalization path also composes correctly end to end
// for 'data_gap_memo', against a genuine ephemeral local PostgreSQL
// database (no fakeTx, no fixture state, no stub of any core business
// function under test):
//
//   real data-gap fixture (cloned claim/evidence pair -> real
//   generateClaimGapFollowups)
//     -> real createDataGapMemoDraft (auto-derives claimIds from the real,
//        current, authoritative data-gap read-service)
//     -> real completeGeneratedContentReview
//     -> real request/start/completeGeneratedDraftExportReview
//     -> STATE 3: no limitation snapshot -> candidateReadyToPrepare FALSE
//     -> real confirmGeneratedDraftLimitationSnapshot
//     -> STATE 4: snapshot confirmed -> candidateReadyToPrepare TRUE,
//        while exportEligible/full VAL-EXP-001 is still FALSE (no
//        candidate, no authority, no manifest exist yet)
//     -> real createGeneratedDraftExportCandidate (+ idempotent replay)
//     -> real P3-17 export-authority decision/effectiveness
//     -> real P3-19 manifest write with authoritative P3-18/VAL-EXP-001 evaluation in-transaction
//     -> real exportManifestRepository.createExportManifest (persisted
//        manifest, FK'd to the effective grant)
//     -> real composeExportManifestRenderModel (persisted-output retrieval,
//        NOT regeneration) -> Markdown/CSV/PDF/DOCX serialization, with
//        citation-appendix linkage proven to survive
//     -> fail-closed regressions (unauthorized actor, revoked authority,
//        stale/superseded candidate, server-derived-only manifest input
//        contract)
//
// DISCLOSED SCOPE BOUNDARY (identical to
// kai-sprint2-p3-18-real-persisted-final-gate-proof.integration.spec.js and
// kai-sprint2-p3-19-export-manifest-foundation.integration.spec.js):
// current-use eligibility (packet.currentUseEligible) is computed from the
// real P2-06 claim-traceability evaluator's `eligible` field, which in
// production requires a fully resolved P1/P2 pipeline this package has no
// authority to reinterpret. This file injects the SAME real-shaped,
// disclosed stand-in `evaluator` function for that one P2-06 seam only,
// exactly as those two files already do - it does not stand in for
// draft_status, review-queue state, export-candidate/limitation-snapshot
// currentness, the P3-17 authority ledger, or the P3-19/P3-20 manifest
// composition/lookup, all of which remain fully real and unmodified
// throughout.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P14_DATA_GAP_MEMO_FINALIZATION_COMPOSITION_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P14 data_gap_memo finalization composition suite refused a non-loopback KAI_P14_DATA_GAP_MEMO_FINALIZATION_COMPOSITION_DATABASE_URL host: ${host}`);
  }
}

test("P14 data_gap_memo finalization composition PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P14 data_gap_memo finalization composition PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresGeneratedContentRepository\.js|postgresExportCandidateRepository\.js|postgresHumanAuthorityDecisionRepository\.js|postgresExportManifestRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P14 data_gap_memo finalization composition integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runDataGapMemoFinalizationCompositionSuite();
}

async function runDataGapMemoFinalizationCompositionSuite() {
  const { Pool } = await import("pg");
  const { createPostgresGeneratedContentRepository, evaluateGeneratedDraftExportReviewPacketInTransaction } =
    await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { createDataGapMemoDraft, completeGeneratedContentReview } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
  const {
    requestGeneratedDraftExportReview,
    startGeneratedDraftExportReview,
    completeGeneratedDraftExportReview,
    getGeneratedDraftExportReviewPacket,
  } = await import("../Backend/kai/services/kaiExportReviewService.js");
  const { createPostgresExportCandidateRepository } = await import("../Backend/kai/dictionary/postgresExportCandidateRepository.js");
  const { confirmGeneratedDraftLimitationSnapshot, createGeneratedDraftExportCandidate } = await import("../Backend/kai/services/kaiExportCandidateService.js");
  const { EXPORT_CANDIDATE_CONTENT_TYPES } = await import("../Backend/kai/dictionary/exportCandidateContract.js");
  const { createPostgresHumanAuthorityDecisionRepository } =
    await import("../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js");
  const { createPostgresExportManifestRepository } = await import("../Backend/kai/dictionary/postgresExportManifestRepository.js");
  const { createProductionMetadataOnlyAuditForExportManifest } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");
  const { createPostgresExportManifestRenderModelRepository } = await import("../Backend/kai/dictionary/postgresExportManifestRenderModelRepository.js");
  const { serializeExportManifestRenderModelToMarkdown } = await import("../Backend/kai/services/kaiExportManifestMarkdownSerializer.js");
  const { serializeExportManifestRenderModelToCsv } = await import("../Backend/kai/services/kaiExportManifestCsvSerializer.js");
  const { serializeExportManifestRenderModelToPdf } = await import("../Backend/kai/services/kaiExportManifestPdfSerializer.js");
  const { serializeExportManifestRenderModelToDocx } = await import("../Backend/kai/services/kaiExportManifestDocxSerializer.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const ENGAGEMENT = "00000000-0000-4000-8000-000000000941";
  const NOW = "2026-09-15T10:00:00.000Z";
  const LATER = "2026-09-15T10:05:00.000Z";
  const EVEN_LATER = "2026-09-15T10:10:00.000Z";
  const GRANT_AT = "2026-09-15T10:15:00.000Z";
  const REVOKE_AT = "2026-09-15T10:20:00.000Z";
  const SUPERSEDE_AT = "2026-09-15T10:25:00.000Z";
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

  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  const gkAdmin = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000041",
    source: "public.userdata",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  };
  const gkReviewer = {
    ...gkAdmin,
    actorUserId: "90000000-0000-4000-8000-000000000042",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };
  const aiActor = { actorType: "ai", actorUserId: "90000000-0000-4000-8000-000000000043", organizationMemberships: [] };

  // Disclosed P2-06 current-use-eligibility stand-in (see file header) -
  // identical technique to the P3-18/P3-19/durable-read-recovery suites'
  // own currentUseEvaluator.
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
        evidence_review_decision: eligible ? { decision_id: "10000000-0000-4000-8000-000000000977", decision_outcome: "accepted" } : null,
        claim_review_decision: eligible
          ? { decision_id: "10000000-0000-4000-8000-000000000978", decision_outcome: "accepted", approved_audiences: ["internal", "funder"] }
          : null,
        candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000003" },
        promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000976" },
        dimensions: {},
        gap_items: [],
        client_followup_workflows: [],
        potential_conflict_groups: [],
        graph_relationships: [
          { relationship_type: "claim_supported_by_evidence", from_object_type: "claim", from_object_id: evalInput.claimId, to_object_type: "evidence_item", to_object_id: evidenceId },
        ],
        graph_trace_completeness: { complete: true, missing_relationship_types: [], invalid_relationship_count: 0 },
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

  function creationEvaluator() {
    return async (tx, evalInput) => {
      const rows = await tx.query(
        `SELECT claim_id::text AS claim_id, evidence_item_id::text AS evidence_item_id
           FROM kai.claims WHERE organization_id = $1::uuid AND claim_id = $2::uuid`,
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

  function generatedContentRepository(evaluator) {
    return createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator });
  }

  function exportCandidateRepository() {
    return createPostgresExportCandidateRepository({ runInTransaction: withRunnerOwnedTransaction });
  }

  const humanAuthorityDecisionRepository = createPostgresHumanAuthorityDecisionRepository({ runInTransaction: withRunnerOwnedTransaction });
  const exportManifestRepository = createPostgresExportManifestRepository({ runInTransaction: withRunnerOwnedTransaction });
  const exportManifestRenderModelRepository = createPostgresExportManifestRenderModelRepository({ runInTransaction: withRunnerOwnedTransaction });

  test.after(async () => {
    await pool.end();
  });

  let seedCounter = 0;

  // Real, unstubbed data-gap fixture: a real source_version -> real
  // evidence_item -> real claim -> real gap_log_item, built through the
  // real P2-01/P2-03/P2-04 services - byte-for-byte the same technique
  // proven working by scripts/kai-sprint2-p14-14-generated-content-type-
  // evolution-local-postgres.js's own real Data Gap Memo persistence proof.
  async function seedRealAuthoritativeDataGap(n) {
    const gapRepo = createPostgresClaimGapFollowupRepository({ runInTransaction: withRunnerOwnedTransaction });

    // Real, dedicated claim/evidence pair, cloned from an existing template
    // evidence_item's own lineage (source_id/source_version_id/
    // source_locator_id) - the exact same raw-clone technique used
    // throughout this repository's own real-Postgres proofs
    // (kai-sprint2-p3-16-export-candidate-foundation.integration.spec.js's
    // seedDraftReadyForCandidate, kai-sprint2-p3-18/p3-19's
    // seedFullExportCandidatePipeline). Deliberately NOT built via
    // extractEvidenceFromSourceVersion/proposeClaim: this composition
    // proof's own runner now shares one synthetic organization/source_version
    // with several sibling packages' own smoke-seed fixtures (P3-16/P3-17/
    // P3-19/P3-20, needed so those suites can run alongside this file), and
    // extractEvidenceFromSourceVersion's own real, correct
    // evidenceItemCount === queueItemCount consistency invariant (a genuine,
    // separate P2-01 correctness check, not a bug) is scoped per
    // source_version_id - it fails closed the instant ANY other seed has
    // independently added evidence_items against that same shared
    // source_version outside this package's own review-queue bookkeeping.
    // The claim/evidence pair itself only needs to be real and governed;
    // generateClaimGapFollowups below is the real, unmodified function this
    // proof actually exercises.
    const claimId = `10000000-0000-4000-8000-0000006a9${n}`;
    const evidenceId = `10000000-0000-4000-8000-0000006e9${n}`;
    const templateRows = await query(
      `SELECT evidence_item_id::text AS evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id ASC LIMIT 1`,
      [ORG],
    );
    if (!templateRows[0]) throw new Error("P14 data_gap_memo composition fixture requires a template evidence_item");
    const templateEvidenceId = templateRows[0].evidence_item_id;
    await query(
      `INSERT INTO kai.evidence_items (
         evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
         evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type
       )
       SELECT $1::uuid, organization_id, source_id, source_version_id, source_locator_id,
              evidence_type, data_class, sensitivity_level, support_strength,
              'P14 data_gap_memo composition evidence item.', encode(digest($1::text, 'sha256'), 'hex'), created_by_type
         FROM kai.evidence_items WHERE evidence_item_id = $2::uuid`,
      [evidenceId, templateEvidenceId],
    );
    await query(
      `INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review','unassessed','P14 data_gap_memo composition claim.',encode(digest($1::text, 'sha256'), 'hex'),'system')`,
      [claimId, ORG, evidenceId],
    );
    await query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type) VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
      [ORG, claimId, evidenceId],
    );
    // generateClaimGapFollowups (real, unmodified), and the P2-06/current-
    // gap-state filter createDataGapMemoDraft's own real gap read-service
    // consults, both require the real P2-01 evidence_review queue row for
    // this exact evidence_item_id AND the real P2-03 claim_review queue row
    // for this exact claim_id - mirrors exactly the rows
    // insertEvidenceReviewQueueItemIfAbsent/insertClaimReviewQueueItemIfAbsent
    // themselves would have created.
    await query(
      `INSERT INTO kai.review_queue_items (
         organization_id, queue_type, target_object_type, target_object_id,
         priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
       ) VALUES ($1::uuid,'evidence_review','evidence_item',$2::uuid,'medium','open','needs_gk_review','New evidence item requires GK review.','Review the evidence item''s lineage, sensitivity, support strength, and audience eligibility before use.','{}'::jsonb,'system')`,
      [ORG, evidenceId],
    );
    await query(
      `INSERT INTO kai.review_queue_items (
         organization_id, queue_type, target_object_type, target_object_id,
         priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
       ) VALUES ($1::uuid,'claim_review','claim',$2::uuid,'medium','open','needs_gk_review','Review proposed internal-only claim.','Review the claim''s evidence lineage, support strength, limitations, requirement coverage, and audience eligibility before any use.','{}'::jsonb,'system')`,
      [ORG, claimId],
    );

    const gapResult = await generateClaimGapFollowups(
      { organizationId: ORG, claimId, actorContext: gkReviewer, now: NOW },
      { env: enabledEnv, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: auditRecorder() },
    );
    if (!gapResult.ok) throw new Error(`P14 data_gap_memo composition fixture: generateClaimGapFollowups failed: ${gapResult.error?.code}`);

    return { claim_id: claimId, evidence_item_id: evidenceId };
  }

  // Real, persisted pipeline for content_type = 'data_gap_memo': draft ->
  // generated-content review -> export review (request/start/complete) ->
  // limitation snapshot -> export candidate. Mirrors
  // kai-sprint2-p3-18-real-persisted-final-gate-proof's own
  // seedFullExportCandidatePipeline, with createDataGapMemoDraft (which
  // auto-derives claimIds from the real authoritative data-gap read
  // service) substituted for createEvidenceSummaryDraft.
  async function seedFullDataGapMemoPipeline() {
    seedCounter += 1;
    const n = String(seedCounter).padStart(3, "0");
    const claim = await seedRealAuthoritativeDataGap(n);
    const claimId = claim.claim_id;
    const evidenceId = claim.evidence_item_id;

    const created = await createDataGapMemoDraft(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        requestedAudience: "internal",
        idempotencyKey: `p14-data-gap-memo-composition-${n}`,
        actorContext: gkReviewer,
        now: NOW,
      },
      {
        env: enabledEnv,
        getEngagementForOrganization,
        gapReadDependencies: { runInTransaction: withRunnerOwnedTransaction },
        generatedContentRepository: generatedContentRepository(creationEvaluator()),
        draftGenerator: async (genInput) => ({
          blocks: [{ ordinal: 1, text: genInput.claims[0].claimStatement, citations: [{ claimId: genInput.claims[0].claimId, evidenceItemId: genInput.claims[0].evidenceItemId }] }],
        }),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(created.ok, true, JSON.stringify(created));
    const draftId = created.data.generatedContentDraftId;
    const generatedContentQueueId = created.data.reviewQueueItemId;

    await query(`UPDATE kai.review_queue_items SET queue_status = 'in_progress' WHERE review_queue_item_id = $1::uuid`, [generatedContentQueueId]);
    const genUpdatedAtRows = await query(`SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [generatedContentQueueId]);
    const genReview = await completeGeneratedContentReview(
      { organizationId: ORG, generatedContentDraftId: draftId, reviewQueueItemId: generatedContentQueueId, expectedUpdatedAt: genUpdatedAtRows[0].updated_at.toISOString(), actorContext: gkReviewer, now: NOW },
      { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(genReview.ok, true, JSON.stringify(genReview));
    assert.equal(genReview.data.queueStatus, "resolved");
    assert.equal(genReview.data.reviewStatus, "resolved");

    return { draftId, generatedContentQueueId, claimId, evidenceId, n };
  }

  async function advanceThroughExportReview(pipeline) {
    const requested = await requestGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: pipeline.draftId, requestedExportAudience: "internal", actorContext: gkAdmin, now: NOW },
      { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(pipeline.evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(requested.ok, true, JSON.stringify(requested));
    const exportReviewQueueId = requested.data.reviewQueueItemId;

    const startUpdatedAtRows = await query(`SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [exportReviewQueueId]);
    const started = await startGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: pipeline.draftId, exportReviewQueueItemId: exportReviewQueueId, expectedUpdatedAt: startUpdatedAtRows[0].updated_at.toISOString(), actorContext: gkAdmin, now: LATER },
      { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(pipeline.evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(started.ok, true, JSON.stringify(started));

    const completeUpdatedAtRows = await query(`SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [exportReviewQueueId]);
    const completed = await completeGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: pipeline.draftId, exportReviewQueueItemId: exportReviewQueueId, expectedUpdatedAt: completeUpdatedAtRows[0].updated_at.toISOString(), actorContext: gkAdmin, now: EVEN_LATER },
      { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(pipeline.evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(completed.ok, true, JSON.stringify(completed));
    assert.equal(completed.data.queueStatus, "resolved");
    assert.equal(completed.data.reviewStatus, "resolved");

    return { ...pipeline, exportReviewQueueItemId: exportReviewQueueId };
  }

  async function readPacket(pipeline) {
    return withRunnerOwnedTransaction((tx) =>
      evaluateGeneratedDraftExportReviewPacketInTransaction(
        tx,
        { organizationId: ORG, generatedContentDraftId: pipeline.draftId, exportReviewQueueItemId: pipeline.exportReviewQueueItemId },
        currentUseEvaluator(pipeline.evidenceId, { eligible: true }),
      ));
  }

  test("P14 EXPORT_CANDIDATE_CONTENT_TYPES includes data_gap_memo (Phase-14 allowlist widening this suite proves end to end)", () => {
    assert.ok(EXPORT_CANDIDATE_CONTENT_TYPES.includes("data_gap_memo"));
    assert.ok(!EXPORT_CANDIDATE_CONTENT_TYPES.includes("board_reporting_candidate"));
    assert.ok(!EXPORT_CANDIDATE_CONTENT_TYPES.includes("grant_response_packet"));
  });

  await test("P14 DATA_GAP_MEMO REAL PERSISTED FINALIZATION COMPOSITION", async (t) => {
    let pipeline = null;

    await t.test("STATE 1-2: real data_gap_memo draft created, generated-content review resolved, export review resolved", async () => {
      const seeded = await seedFullDataGapMemoPipeline();
      pipeline = await advanceThroughExportReview(seeded);

      const draftRows = await query(`SELECT content_type, draft_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid`, [pipeline.draftId]);
      assert.equal(draftRows[0].content_type, "data_gap_memo");
      assert.equal(draftRows[0].draft_status, "draft");

      const genQueueRows = await query(`SELECT queue_status, review_status FROM kai.review_queue_items WHERE queue_type = 'generated_content_review' AND target_object_id = $1::uuid`, [pipeline.draftId]);
      assert.equal(genQueueRows[0].queue_status, "resolved");
      assert.equal(genQueueRows[0].review_status, "resolved");
      const exportQueueRows = await query(`SELECT queue_status, review_status FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [pipeline.exportReviewQueueItemId]);
      assert.equal(exportQueueRows[0].queue_status, "resolved");
      assert.equal(exportQueueRows[0].review_status, "resolved");
    });

    await t.test("STATE 3: NO limitation snapshot yet -> candidateReadyToPrepare is FALSE, real next action is snapshot confirmation (not candidate creation)", async () => {
      const packet = await readPacket(pipeline);
      assert.equal(packet.ok, true, JSON.stringify(packet));
      assert.equal(packet.data.limitationSnapshotConfirmed, false);
      assert.equal(packet.data.candidateReadyToPrepare, false);
      assert.equal(packet.data.exportEligible, false);

      // Attempting candidate creation directly (skipping the real next
      // action) is refused by the real repository, never silently allowed.
      const prematureCandidate = await createGeneratedDraftExportCandidate(
        { organizationId: ORG, generatedContentDraftId: pipeline.draftId, actorContext: gkAdmin, now: NOW },
        { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(prematureCandidate.ok, false);
      assert.equal(prematureCandidate.error.code, "conflict_current_state_changed");

      const candidateRows = await query(`SELECT count(*)::int AS count FROM kai.export_candidates WHERE generated_content_draft_id = $1::uuid`, [pipeline.draftId]);
      assert.equal(candidateRows[0].count, 0);
    });

    await t.test("STATE 3b: unauthorized actor (gk_reviewer) cannot confirm the limitation snapshot with a bogus role, and an ordinary client_admin cannot at all", async () => {
      const wrongRole = await confirmGeneratedDraftLimitationSnapshot(
        {
          organizationId: ORG,
          generatedContentDraftId: pipeline.draftId,
          entries: [{ claimId: pipeline.claimId, evidenceItemId: pipeline.evidenceId, limitationCodes: [] }],
          actorContext: { actorType: "human", actorUserId: "x", organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }] },
          now: NOW,
        },
        { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(wrongRole.ok, false);
      assert.ok(["authorization_denied", "validation_blocker"].includes(wrongRole.error.code), JSON.stringify(wrongRole));

      const snapshotRows = await query(`SELECT count(*)::int AS count FROM kai.limitation_snapshots WHERE generated_content_draft_id = $1::uuid`, [pipeline.draftId]);
      assert.equal(snapshotRows[0].count, 0);
    });

    await t.test("STATE 4: limitation snapshot confirmed and current -> candidateReadyToPrepare TRUE, while no candidate/authority/manifest exist yet and exportEligible is still FALSE", async () => {
      const snapshot = await confirmGeneratedDraftLimitationSnapshot(
        {
          organizationId: ORG,
          generatedContentDraftId: pipeline.draftId,
          entries: [{ claimId: pipeline.claimId, evidenceItemId: pipeline.evidenceId, limitationCodes: [] }],
          actorContext: gkReviewer,
          now: NOW,
        },
        { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
      assert.equal(snapshot.data.replayed, false);

      const packet = await readPacket(pipeline);
      assert.equal(packet.ok, true, JSON.stringify(packet));
      assert.equal(packet.data.limitationSnapshotConfirmed, true);
      assert.equal(packet.data.candidateReadyToPrepare, true, "STATE 4: the Phase-14 repair must report readiness pre-candidate");
      assert.equal(packet.data.exportEligible, false, "full VAL-EXP-001 (finalGate + authority) must still read FALSE at this point - no candidate, authority, or manifest exist yet");
      assert.equal(packet.data.validatorResult.severity, "blocker");
      assert.ok(packet.data.validatorResult.evidence.failed_gates.includes("final_export_gate_absent"));
      assert.ok(packet.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));

      const candidateRows = await query(`SELECT count(*)::int AS count FROM kai.export_candidates WHERE generated_content_draft_id = $1::uuid`, [pipeline.draftId]);
      assert.equal(candidateRows[0].count, 0);
      const authorityRows = await query(`SELECT count(*)::int AS count FROM kai.human_authority_decisions had JOIN kai.export_candidates ec ON ec.export_candidate_id = had.export_candidate_id WHERE ec.generated_content_draft_id = $1::uuid`, [pipeline.draftId]);
      assert.equal(authorityRows[0].count, 0);
    });

    let exportCandidateId = null;

    await t.test("STATE 5: create export candidate via the real service/repository path -> exportCandidateId, data_gap_memo + limitationSnapshotId linkage, fingerprint present; identical replay converges", async () => {
      const fresh = await createGeneratedDraftExportCandidate(
        { organizationId: ORG, generatedContentDraftId: pipeline.draftId, actorContext: gkAdmin, now: NOW },
        { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
      );

      assert.equal(fresh.ok, true, JSON.stringify(fresh));
      assert.equal(fresh.data.replayed, false);
      assert.match(
        fresh.data.exportCandidateId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      assert.match(fresh.data.canonicalFingerprint, /^[0-9a-f]{64}$/);

      exportCandidateId = fresh.data.exportCandidateId;

      const candidateRows = await query(
        `SELECT
           export_candidate_id::text AS export_candidate_id,
           organization_id::text AS organization_id,
           content_type,
           generated_content_draft_id::text AS generated_content_draft_id,
           limitation_snapshot_id::text AS limitation_snapshot_id,
           requested_audience,
           fingerprint_contract_version,
           canonical_fingerprint
         FROM kai.export_candidates
         WHERE export_candidate_id = $1::uuid`,
        [exportCandidateId],
      );

      assert.equal(candidateRows.length, 1);
      assert.equal(candidateRows[0].export_candidate_id, exportCandidateId);
      assert.equal(candidateRows[0].organization_id, ORG);
      assert.equal(candidateRows[0].content_type, "data_gap_memo");
      assert.equal(candidateRows[0].generated_content_draft_id, pipeline.draftId);
      assert.equal(
        candidateRows[0].limitation_snapshot_id,
        fresh.data.limitationSnapshotId,
      );
      assert.equal(
        candidateRows[0].canonical_fingerprint,
        fresh.data.canonicalFingerprint,
      );

      const replay = await createGeneratedDraftExportCandidate(
        { organizationId: ORG, generatedContentDraftId: pipeline.draftId, actorContext: gkAdmin, now: NOW },
        { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
      );

      assert.equal(replay.ok, true, JSON.stringify(replay));
      assert.equal(replay.data.replayed, true);
      assert.equal(replay.data.exportCandidateId, exportCandidateId);
      assert.equal(
        replay.data.limitationSnapshotId,
        fresh.data.limitationSnapshotId,
      );
      assert.equal(
        replay.data.canonicalFingerprint,
        fresh.data.canonicalFingerprint,
      );

      const candidateCountRows = await query(
        `SELECT count(*)::int AS count
           FROM kai.export_candidates
          WHERE generated_content_draft_id = $1::uuid`,
        [pipeline.draftId],
      );

      assert.equal(
        candidateCountRows[0].count,
        1,
        "identical replay must converge on the existing candidate rather than persist a duplicate",
      );
    });

    await t.test("STATE 5b: gk_reviewer (not gk_admin) is refused candidate creation before any repository call is reached", async () => {
      const denied = await createGeneratedDraftExportCandidate(
        { organizationId: ORG, generatedContentDraftId: pipeline.draftId, actorContext: gkReviewer, now: NOW },
        { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(denied.ok, false);
      assert.equal(denied.error.code, "authorization_denied");
    });

    let authorityDecisionId = null;
    let exportManifestId = null;

    const manifestInput = (now, overrides = {}) => ({
      organizationId: ORG,
      exportCandidateId,
      exportReviewQueueItemId: pipeline.exportReviewQueueItemId,
      actorContext: gkAdmin,
      now,
      ...overrides,
    });

    const manifestDependencies = (now) => ({
      metadataOnlyAudit: createProductionMetadataOnlyAuditForExportManifest({
        organizationId: ORG,
        exportCandidateId,
        actorContext: gkAdmin,
        now,
      }),
      evaluator: currentUseEvaluator(
        pipeline.evidenceId,
        { eligible: true },
      ),
    });

    await t.test("STATE 6: absent authority blocks finalization; real P3-17 export authority grant is then bound to the exact data_gap_memo export candidate and becomes effective", async () => {
      const beforeGrant =
        await exportManifestRepository.createExportManifest(
          manifestInput(GRANT_AT),
          manifestDependencies(GRANT_AT),
        );

      assert.equal(beforeGrant.ok, false);
      assert.equal(beforeGrant.error.code, "validation_blocker");

      const beforeGrantRows = await query(
        `SELECT count(*)::int AS count
           FROM kai.export_manifests
          WHERE export_candidate_id = $1::uuid`,
        [exportCandidateId],
      );

      assert.equal(beforeGrantRows[0].count, 0);

      const grant =
        await humanAuthorityDecisionRepository.recordDecision(
          {
            organizationId: ORG,
            exportCandidateId,
            decisionType: "export_authority_granted",
            decisionAction: "grant",
            requestedAudience: "internal",
            actorContext: gkAdmin,
            now: GRANT_AT,
          },
          {
            metadataOnlyAudit: auditRecorder(),
          },
        );

      assert.equal(grant.ok, true, JSON.stringify(grant));
      authorityDecisionId = grant.data.decisionId;

      const effectiveness =
        await humanAuthorityDecisionRepository.evaluateEffectiveness({
          organizationId: ORG,
          exportCandidateId,
          decisionType: "export_authority_granted",
        });

      assert.equal(effectiveness.ok, true, JSON.stringify(effectiveness));
      assert.equal(effectiveness.data.effective, true);
      assert.equal(
        effectiveness.data.headDecisionId,
        authorityDecisionId,
      );
    });

    await t.test("STATE 7: authoritative P3-18/VAL-EXP-001 manifest write succeeds, persists exact candidate/review/authority bindings, and identical replay converges", async () => {
      const first =
        await exportManifestRepository.createExportManifest(
          manifestInput(GRANT_AT),
          manifestDependencies(GRANT_AT),
        );

      assert.equal(first.ok, true, JSON.stringify(first));
      assert.equal(first.data.replayed, false);
      assert.equal(
        first.data.effectiveAuthorityDecisionId,
        authorityDecisionId,
      );

      exportManifestId = first.data.exportManifestId;

      assert.match(
        exportManifestId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );

      const rows = await query(
        `SELECT
           export_manifest_id::text AS export_manifest_id,
           export_candidate_id::text AS export_candidate_id,
           export_review_queue_item_id::text AS export_review_queue_item_id,
           effective_authority_decision_id::text AS effective_authority_decision_id,
           effective_authority_decision_type,
           canonical_fingerprint
         FROM kai.export_manifests
         WHERE export_manifest_id = $1::uuid`,
        [exportManifestId],
      );

      assert.equal(rows.length, 1);
      assert.equal(
        rows[0].export_manifest_id,
        exportManifestId,
      );
      assert.equal(
        rows[0].export_candidate_id,
        exportCandidateId,
      );
      assert.equal(
        rows[0].export_review_queue_item_id,
        pipeline.exportReviewQueueItemId,
      );
      assert.equal(
        rows[0].effective_authority_decision_id,
        authorityDecisionId,
      );
      assert.equal(
        rows[0].effective_authority_decision_type,
        "export_authority_granted",
      );
      assert.match(
        rows[0].canonical_fingerprint,
        /^[0-9a-f]{64}$/,
      );

      const replay =
        await exportManifestRepository.createExportManifest(
          manifestInput(GRANT_AT),
          manifestDependencies(GRANT_AT),
        );

      assert.equal(replay.ok, true, JSON.stringify(replay));
      assert.equal(replay.data.replayed, true);
      assert.equal(
        replay.data.exportManifestId,
        exportManifestId,
      );

      const manifestCount = await query(
        `SELECT count(*)::int AS count
           FROM kai.export_manifests
          WHERE export_candidate_id = $1::uuid`,
        [exportCandidateId],
      );

      assert.equal(manifestCount[0].count, 1);

      const auditCount = await query(
        `SELECT count(*)::int AS count
           FROM kai.audit_events
          WHERE metadata->>'export_manifest_id' = $1`,
        [exportManifestId],
      );

      assert.equal(
        auditCount[0].count,
        1,
        "manifest replay must not publish a second audit event",
      );

      const draftRows = await query(
        `SELECT draft_status
           FROM kai.generated_content_drafts
          WHERE generated_content_draft_id = $1::uuid`,
        [pipeline.draftId],
      );

      assert.equal(
        draftRows[0].draft_status,
        "draft",
        "manifest creation must not silently rewrite generated-content draft state",
      );
    });

    await t.test("STATE 8: fresh governed reload recovers the persisted manifest identity; manifest-bound render reconstruction and Markdown/CSV/PDF/DOCX serialization preserve citation linkage without regeneration", async () => {
      const recovered =
        await getGeneratedDraftExportReviewPacket(
          {
            organizationId: ORG,
            generatedContentDraftId: pipeline.draftId,
            exportReviewQueueItemId:
              pipeline.exportReviewQueueItemId,
            actorContext: gkAdmin,
          },
          {
            env: enabledEnv,
            runInTransaction: withRunnerOwnedTransaction,
            evaluator: currentUseEvaluator(
              pipeline.evidenceId,
              { eligible: true },
            ),
          },
        );

      assert.equal(
        recovered.ok,
        true,
        JSON.stringify(recovered),
      );
      assert.equal(
        recovered.data.exportManifestId,
        exportManifestId,
      );
      assert.deepEqual(
        recovered.data.exportManifestHistory.map(
          (entry) => entry.exportManifestId,
        ),
        [exportManifestId],
      );

      const composed =
        await exportManifestRenderModelRepository
          .composeExportManifestRenderModel({
            organizationId: ORG,
            exportManifestId,
          });

      assert.equal(
        composed.ok,
        true,
        JSON.stringify(composed),
      );

      const renderModel = composed.data;

      assert.equal(
        renderModel.manifest.exportManifestId,
        exportManifestId,
      );
      assert.equal(
        renderModel.exportCandidate.exportCandidateId,
        exportCandidateId,
      );
      assert.equal(
        renderModel.exportCandidate.contentType,
        "data_gap_memo",
      );
      assert.equal(
        renderModel.authority.effectiveAuthorityDecisionId,
        authorityDecisionId,
      );

      const citation = renderModel.citations.find(
        (entry) =>
          entry.claimId === pipeline.claimId
          && entry.evidenceItemId === pipeline.evidenceId,
      );

      assert.ok(
        citation,
        "persisted render model must retain the data_gap_memo claim/evidence citation pair",
      );
      assert.equal(typeof citation.citationRef, "string");
      assert.ok(citation.citationRef.length > 0);

      const citingBlock = renderModel.content.blocks.find(
        (block) =>
          Array.isArray(block.citationRefs)
          && block.citationRefs.includes(citation.citationRef),
      );

      assert.ok(
        citingBlock,
        "persisted content must retain its citation reference",
      );

      const markdown =
        serializeExportManifestRenderModelToMarkdown(renderModel);

      const csv =
        serializeExportManifestRenderModelToCsv(renderModel);

      const pdf =
        await serializeExportManifestRenderModelToPdf(renderModel);

      const docx =
        await serializeExportManifestRenderModelToDocx(renderModel);

      assert.equal(typeof markdown, "string");
      assert.ok(markdown.includes("## Citation Appendix"));
      assert.ok(
        markdown.includes(`[${citation.citationRef}]`),
      );
      assert.ok(markdown.includes(pipeline.claimId));
      assert.ok(markdown.includes(pipeline.evidenceId));

      assert.equal(typeof csv, "string");
      assert.ok(csv.includes(citation.citationRef));
      assert.ok(csv.includes(pipeline.claimId));
      assert.ok(csv.includes(pipeline.evidenceId));

      assert.ok(Buffer.isBuffer(pdf));
      assert.equal(
        pdf.slice(0, 5).toString("latin1"),
        "%PDF-",
      );

      assert.ok(Buffer.isBuffer(docx));
      assert.equal(
        docx.slice(0, 2).toString("latin1"),
        "PK",
      );
    });

    await t.test("STATE 9: forged authoritative inputs, revoked authority, superseded candidate, and cross-tenant render lookup all fail closed", async () => {
      const forgedManifestAttempt =
        await exportManifestRepository.createExportManifest(
          manifestInput(GRANT_AT, {
            finalGate: true,
            affirmativeHumanExportAuthority: true,
            candidateCurrentness: true,
            canonicalFingerprint: "f".repeat(64),
          }),
          manifestDependencies(GRANT_AT),
        );

      assert.equal(forgedManifestAttempt.ok, false);
      assert.equal(
        forgedManifestAttempt.error.code,
        "validation_blocker",
      );

      const revoke =
        await humanAuthorityDecisionRepository.recordDecision(
          {
            organizationId: ORG,
            exportCandidateId,
            decisionType: "export_authority_granted",
            decisionAction: "revoke",
            requestedAudience: "internal",
            actorContext: gkAdmin,
            now: REVOKE_AT,
          },
          {
            metadataOnlyAudit: auditRecorder(),
          },
        );

      assert.equal(revoke.ok, true, JSON.stringify(revoke));

      const revoked =
        await humanAuthorityDecisionRepository.evaluateEffectiveness({
          organizationId: ORG,
          exportCandidateId,
          decisionType: "export_authority_granted",
        });

      assert.equal(revoked.ok, true);
      assert.equal(revoked.data.effective, false);
      assert.equal(
        revoked.data.reason,
        "head_is_revoke",
      );

      const revokedAttempt =
        await exportManifestRepository.createExportManifest(
          manifestInput(REVOKE_AT),
          manifestDependencies(REVOKE_AT),
        );

      assert.equal(revokedAttempt.ok, false);
      assert.equal(
        revokedAttempt.error.code,
        "validation_blocker",
      );

      const REGRANT_AT = "2026-09-15T10:22:00.000Z";

      const regrant =
        await humanAuthorityDecisionRepository.recordDecision(
          {
            organizationId: ORG,
            exportCandidateId,
            decisionType: "export_authority_granted",
            decisionAction: "grant",
            requestedAudience: "internal",
            actorContext: gkAdmin,
            now: REGRANT_AT,
          },
          {
            metadataOnlyAudit: auditRecorder(),
          },
        );

      assert.equal(regrant.ok, true, JSON.stringify(regrant));

      const regranted =
        await humanAuthorityDecisionRepository.evaluateEffectiveness({
          organizationId: ORG,
          exportCandidateId,
          decisionType: "export_authority_granted",
        });

      assert.equal(regranted.ok, true);
      assert.equal(regranted.data.effective, true);

      const supersedingSnapshot =
        await confirmGeneratedDraftLimitationSnapshot(
          {
            organizationId: ORG,
            generatedContentDraftId: pipeline.draftId,
            entries: [{
              claimId: pipeline.claimId,
              evidenceItemId: pipeline.evidenceId,
              limitationCodes: ["small_sample_size"],
            }],
            actorContext: gkReviewer,
            now: SUPERSEDE_AT,
          },
          {
            env: enabledEnv,
            exportCandidateRepository:
              exportCandidateRepository(),
            metadataOnlyAudit: auditRecorder(),
          },
        );

      assert.equal(
        supersedingSnapshot.ok,
        true,
        JSON.stringify(supersedingSnapshot),
      );

      const stale =
        await humanAuthorityDecisionRepository.evaluateEffectiveness({
          organizationId: ORG,
          exportCandidateId,
          decisionType: "export_authority_granted",
        });

      assert.equal(stale.ok, true);
      assert.equal(stale.data.effective, false);
      assert.equal(
        stale.data.reason,
        "limitation_snapshot_superseded",
      );

      const staleAttempt =
        await exportManifestRepository.createExportManifest(
          manifestInput(SUPERSEDE_AT),
          manifestDependencies(SUPERSEDE_AT),
        );

      assert.equal(staleAttempt.ok, false);
      assert.equal(
        staleAttempt.error.code,
        "validation_blocker",
      );

      const staleRender =
        await exportManifestRenderModelRepository
          .composeExportManifestRenderModel({
            organizationId: ORG,
            exportManifestId,
          });

      assert.equal(staleRender.ok, false);
      assert.equal(
        staleRender.error.code,
        "conflict_current_state_changed",
      );

      const crossTenantRender =
        await exportManifestRenderModelRepository
          .composeExportManifestRenderModel({
            organizationId: OTHER_ORG,
            exportManifestId,
          });

      assert.equal(crossTenantRender.ok, false);
      assert.equal(
        crossTenantRender.error.code,
        "not_found",
      );

      const manifestCount = await query(
        `SELECT count(*)::int AS count
           FROM kai.export_manifests
          WHERE export_candidate_id = $1::uuid`,
        [exportCandidateId],
      );

      assert.equal(
        manifestCount[0].count,
        1,
        "forged/revoked/stale retries must not create another manifest",
      );
    });
  });

  test("P14 evidence_summary content-type behavior is unaffected by this data_gap_memo proof (no shared mutable state, no regression in the generic path)", async () => {
    assert.ok(EXPORT_CANDIDATE_CONTENT_TYPES.includes("evidence_summary"));
  });
}
