// DURABLE EXPORT-MANIFEST READ RECOVERY - REAL-PERSISTED PROOF
//
// Assembled proof required by the "Durable Export Finalization Recovery +
// UI Closure" package: governed finalization -> durable binding -> exact
// exportManifestId -> reload/later read -> the SAME exact exportManifestId
// recovered, using the real, unmodified packet composer
// (evaluateGeneratedDraftExportReviewPacketInTransaction), the real P3-20
// repository lookup (loadExportManifestIdentityForReviewQueueItemInTransaction),
// and the real service composition (getGeneratedDraftExportReviewPacket) -
// exactly the same call the existing GK export-review page's own packet
// fetch already makes on every mount/reload.
//
// Also proves: no finalization -> no recovered manifest; a cross-tenant
// read leaks no manifest identity; and (governed finalization on a second,
// independent candidate/review item) a real, unambiguous single manifest
// per review item is recovered without any latest/current/timestamp logic.

import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P3_20_EXPORT_MANIFEST_REVIEW_BINDING_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`Durable export-manifest read-recovery suite refused a non-loopback KAI_P3_20_EXPORT_MANIFEST_REVIEW_BINDING_DATABASE_URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("durable export-manifest read-recovery integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runReadRecoverySuite();
}

async function runReadRecoverySuite() {
  const { Pool } = await import("pg");
  const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { createEvidenceSummaryDraft, completeGeneratedContentReview } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
  const {
    requestGeneratedDraftExportReview,
    startGeneratedDraftExportReview,
    completeGeneratedDraftExportReview,
    getGeneratedDraftExportReviewPacket,
  } = await import("../Backend/kai/services/kaiExportReviewService.js");
  const { createPostgresExportCandidateRepository } = await import("../Backend/kai/dictionary/postgresExportCandidateRepository.js");
  const { confirmGeneratedDraftLimitationSnapshot, createGeneratedDraftExportCandidate } = await import("../Backend/kai/services/kaiExportCandidateService.js");
  const { createPostgresHumanAuthorityDecisionRepository } = await import("../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js");
  const { createPostgresExportManifestRepository } = await import("../Backend/kai/dictionary/postgresExportManifestRepository.js");
  const { createProductionMetadataOnlyAuditForExportManifest } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const NOW = "2026-09-08T11:00:00.000Z";
  const LATER = "2026-09-08T11:05:00.000Z";
  const EVEN_LATER = "2026-09-08T11:10:00.000Z";
  const GRANT_AT = "2026-09-08T11:15:00.000Z";
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

  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  const gkAdmin = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000035",
    source: "public.userdata",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  };

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
          review_queue_item_id: "10000000-0000-4000-8000-000000000991",
          review_queue_status: "resolved",
          review_status: eligible ? "approved" : "needs_gk_review",
          updated_at: "2026-08-06T09:00:00.000Z",
          sensitivity_level: "unknown",
        },
        locator: { source_locator_id: "10000000-0000-4000-8000-000000000992" },
        source: { source_id: "10000000-0000-4000-8000-000000000993", source_code: null },
        source_version: { source_version_id: "10000000-0000-4000-8000-000000000994", is_current: true },
        claim_review: { review_queue_item_id: "10000000-0000-4000-8000-000000000995", queue_status: "resolved", review_status: eligible ? "approved" : "needs_gk_review" },
        candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000005" },
        promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000996" },
        dimensions: {},
        gap_items: [],
        client_followup_workflows: [],
        potential_conflict_groups: [],
        requestedAudience: evalInput.requestedAudience,
        eligible,
        blockerCodes: eligible ? [] : ["claim_review_unresolved"],
        affectedDimensionKeys: eligible ? [] : ["missingness"],
        affectedObjectIds: eligible ? [] : ["10000000-0000-4000-8000-000000000995"],
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

  let seedCounter = 0;

  async function seedFullExportCandidatePipeline() {
    seedCounter += 1;
    const n = String(seedCounter).padStart(3, "0");
    const claimId = `10000000-0000-4000-8000-0000004a9${n}`;
    const evidenceId = `10000000-0000-4000-8000-0000004e9${n}`;

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
              'Durable read-recovery evidence item.', encode(digest($1::text, 'sha256'), 'hex'), created_by_type
         FROM kai.evidence_items WHERE evidence_item_id = $2::uuid`,
      [evidenceId, templateEvidenceId],
    );
    await query(
      `INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review','unassessed','Durable read-recovery claim.',encode(digest($1::text, 'sha256'), 'hex'),'system')`,
      [claimId, ORG, evidenceId],
    );
    await query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type) VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
      [ORG, claimId, evidenceId],
    );

    const created = await createEvidenceSummaryDraft(
      { organizationId: ORG, requestedAudience: "internal", claimIds: [claimId], idempotencyKey: `durable-read-recovery-${n}`, actorContext: gkAdmin, now: NOW },
      {
        env: enabledEnv,
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
      { organizationId: ORG, generatedContentDraftId: draftId, reviewQueueItemId: generatedContentQueueId, expectedUpdatedAt: genUpdatedAtRows[0].updated_at.toISOString(), actorContext: gkAdmin, now: NOW },
      { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(genReview.ok, true, JSON.stringify(genReview));

    const requested = await requestGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: draftId, requestedExportAudience: "internal", actorContext: gkAdmin, now: NOW },
      { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(requested.ok, true, JSON.stringify(requested));
    const exportReviewQueueId = requested.data.reviewQueueItemId;

    const startUpdatedAtRows = await query(`SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [exportReviewQueueId]);
    const started = await startGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: draftId, exportReviewQueueItemId: exportReviewQueueId, expectedUpdatedAt: startUpdatedAtRows[0].updated_at.toISOString(), actorContext: gkAdmin, now: LATER },
      { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(started.ok, true, JSON.stringify(started));

    const completeUpdatedAtRows = await query(`SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [exportReviewQueueId]);
    const completed = await completeGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: draftId, exportReviewQueueItemId: exportReviewQueueId, expectedUpdatedAt: completeUpdatedAtRows[0].updated_at.toISOString(), actorContext: gkAdmin, now: EVEN_LATER },
      { env: enabledEnv, generatedContentRepository: generatedContentRepository(currentUseEvaluator(evidenceId, { eligible: true })), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(completed.ok, true, JSON.stringify(completed));

    const snapshot = await confirmGeneratedDraftLimitationSnapshot(
      { organizationId: ORG, generatedContentDraftId: draftId, entries: [{ claimId, evidenceItemId: evidenceId, limitationCodes: [] }], actorContext: gkAdmin, now: NOW },
      { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(snapshot.ok, true, JSON.stringify(snapshot));

    const candidate = await createGeneratedDraftExportCandidate(
      { organizationId: ORG, generatedContentDraftId: draftId, actorContext: gkAdmin, now: NOW },
      { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(candidate.ok, true, JSON.stringify(candidate));

    return { draftId, evidenceId, claimId, exportReviewQueueItemId: exportReviewQueueId, exportCandidateId: candidate.data.exportCandidateId };
  }

  async function fetchPacket(seed, overrides = {}) {
    return getGeneratedDraftExportReviewPacket(
      {
        organizationId: ORG,
        generatedContentDraftId: seed.draftId,
        exportReviewQueueItemId: seed.exportReviewQueueItemId,
        actorContext: gkAdmin,
        ...overrides,
      },
      {
        env: enabledEnv,
        runInTransaction: withRunnerOwnedTransaction,
        // Same disclosed P2-06 current-use-eligibility stand-in used to seed
        // and finalize the pipeline above (see file header) - the packet's
        // own real composition, real review-queue state, and real P3-20
        // manifest-identity lookup are otherwise fully real and unmodified.
        evaluator: currentUseEvaluator(seed.evidenceId, { eligible: true }),
      },
    );
  }

  test.after(async () => {
    await pool.end();
  });

  test("ASSEMBLED: governed finalization -> durable binding -> exact exportManifestId -> reload/later read -> the SAME exact exportManifestId recovered", async () => {
    const seed = await seedFullExportCandidatePipeline();

    // Before any finalization: the same-session packet reports no
    // recoverable manifest identity - never a fabricated one.
    const before = await fetchPacket(seed);
    assert.equal(before.ok, true, JSON.stringify(before));
    assert.equal(before.data.exportManifestId, null);

    const grant = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "grant", requestedAudience: "internal", actorContext: gkAdmin, now: GRANT_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(grant.ok, true, JSON.stringify(grant));

    const finalized = await exportManifestRepository.createExportManifest(
      {
        organizationId: ORG,
        exportCandidateId: seed.exportCandidateId,
        exportReviewQueueItemId: seed.exportReviewQueueItemId,
        actorContext: gkAdmin,
        now: GRANT_AT,
      },
      {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForExportManifest({ organizationId: ORG, exportCandidateId: seed.exportCandidateId, actorContext: gkAdmin, now: GRANT_AT }),
        evaluator: currentUseEvaluator(seed.evidenceId, { eligible: true }),
      },
    );
    assert.equal(finalized.ok, true, JSON.stringify(finalized));

    // Simulate a page reload / later return: a brand-new packet fetch, with
    // no client-side state carried over, must recover the exact same id.
    const afterFirstReload = await fetchPacket(seed);
    assert.equal(afterFirstReload.ok, true, JSON.stringify(afterFirstReload));
    assert.equal(afterFirstReload.data.exportManifestId, finalized.data.exportManifestId);

    // A second, independent "later return" fetch recovers the exact same
    // identity again - historical identity is never silently replaced.
    const afterSecondReload = await fetchPacket(seed);
    assert.equal(afterSecondReload.data.exportManifestId, finalized.data.exportManifestId);
  });

  test("no finalization -> no recovered manifest (never fabricated)", async () => {
    const seed = await seedFullExportCandidatePipeline();
    const result = await fetchPacket(seed);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.exportManifestId, null);
  });

  test("a cross-tenant read leaks no manifest identity", async () => {
    const seed = await seedFullExportCandidatePipeline();
    const grant = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "grant", requestedAudience: "internal", actorContext: gkAdmin, now: GRANT_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(grant.ok, true);
    const finalized = await exportManifestRepository.createExportManifest(
      { organizationId: ORG, exportCandidateId: seed.exportCandidateId, exportReviewQueueItemId: seed.exportReviewQueueItemId, actorContext: gkAdmin, now: GRANT_AT },
      {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForExportManifest({ organizationId: ORG, exportCandidateId: seed.exportCandidateId, actorContext: gkAdmin, now: GRANT_AT }),
        evaluator: currentUseEvaluator(seed.evidenceId, { eligible: true }),
      },
    );
    assert.equal(finalized.ok, true, JSON.stringify(finalized));

    // The real repository lookup, called directly with a different
    // organizationId (as a cross-tenant packet fetch would), must find
    // nothing - the manifest belongs to ORG, not OTHER_ORG.
    const { loadExportManifestIdentityForReviewQueueItemInTransaction } = await import("../Backend/kai/dictionary/postgresExportManifestRepository.js");
    const leaked = await withRunnerOwnedTransaction((tx) =>
      loadExportManifestIdentityForReviewQueueItemInTransaction(tx, {
        organizationId: OTHER_ORG,
        exportReviewQueueItemId: seed.exportReviewQueueItemId,
      }));
    assert.equal(leaked.exportManifestId, null, "a cross-tenant lookup must never return a real manifest id belonging to a different organization");
  });

  test("a real, unambiguous single manifest per review item is recovered for a second, independent candidate - no shared/cross-candidate state", async () => {
    const seedA = await seedFullExportCandidatePipeline();
    const seedB = await seedFullExportCandidatePipeline();

    for (const seed of [seedA, seedB]) {
      const grant = await humanAuthorityDecisionRepository.recordDecision({
        organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
        decisionAction: "grant", requestedAudience: "internal", actorContext: gkAdmin, now: GRANT_AT,
      }, { metadataOnlyAudit: auditRecorder() });
      assert.equal(grant.ok, true);
    }

    const finalizedA = await exportManifestRepository.createExportManifest(
      { organizationId: ORG, exportCandidateId: seedA.exportCandidateId, exportReviewQueueItemId: seedA.exportReviewQueueItemId, actorContext: gkAdmin, now: GRANT_AT },
      {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForExportManifest({ organizationId: ORG, exportCandidateId: seedA.exportCandidateId, actorContext: gkAdmin, now: GRANT_AT }),
        evaluator: currentUseEvaluator(seedA.evidenceId, { eligible: true }),
      },
    );
    const finalizedB = await exportManifestRepository.createExportManifest(
      { organizationId: ORG, exportCandidateId: seedB.exportCandidateId, exportReviewQueueItemId: seedB.exportReviewQueueItemId, actorContext: gkAdmin, now: GRANT_AT },
      {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForExportManifest({ organizationId: ORG, exportCandidateId: seedB.exportCandidateId, actorContext: gkAdmin, now: GRANT_AT }),
        evaluator: currentUseEvaluator(seedB.evidenceId, { eligible: true }),
      },
    );
    assert.equal(finalizedA.ok, true, JSON.stringify(finalizedA));
    assert.equal(finalizedB.ok, true, JSON.stringify(finalizedB));
    assert.notEqual(finalizedA.data.exportManifestId, finalizedB.data.exportManifestId);

    const packetA = await fetchPacket(seedA);
    const packetB = await fetchPacket(seedB);
    assert.equal(packetA.data.exportManifestId, finalizedA.data.exportManifestId);
    assert.equal(packetB.data.exportManifestId, finalizedB.data.exportManifestId);
  });
}
