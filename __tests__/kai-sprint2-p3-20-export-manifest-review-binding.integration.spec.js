// P3-20 EXPORT-MANIFEST-REVIEW-BINDING REAL-PERSISTED PROOF
//
// Implements the accepted FUNCTIONAL_DEPENDENCY_PROOF's SELECTED_MODEL
// (DIRECT_MANIFEST_REVIEW_BINDING): every P3-19 export manifest now
// persists the exact originating export_review_queue_item_id, atomically,
// inside the same write transaction as the P3-18/VAL-EXP-001 PASS and the
// manifest insert itself. This suite proves, against a real database:
//
//   - the returned exportManifestId's persisted row carries the exact
//     export_review_queue_item_id the caller supplied;
//   - the same eligible state submitted twice still converges to exactly
//     one manifest row (P3-19 replay, unaffected by this package);
//   - a revoke-then-re-grant cycle on the SAME candidate produces a SECOND,
//     distinct manifest bound to the SAME export_review_queue_item_id -
//     "one review item -> multiple historical manifests", proven for real,
//     not merely asserted;
//   - a cross-tenant export candidate is still rejected before any manifest
//     or binding is ever written (unaffected by this package);
//   - a mismatched exportReviewQueueItemId (one that exists, but targets a
//     different draft) fails the same real P3-18 eligibility gate this
//     package's FUNCTIONAL_DEPENDENCY_PROOF traced, and creates neither a
//     manifest row nor any persisted binding - binding failure cannot
//     return a successful finalization.
//
// DISCLOSED SCOPE BOUNDARY (identical to
// kai-sprint2-p3-19-export-manifest-foundation.integration.spec.js): the
// same disclosed P2-06 current-use-eligibility stand-in is reused for the
// one seam that requires it; every other step (draft/review/candidate/
// authority/eligibility/manifest) is real and unmodified.

import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P3_20_EXPORT_MANIFEST_REVIEW_BINDING_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P3-20 export-manifest-review-binding suite refused a non-loopback KAI_P3_20_EXPORT_MANIFEST_REVIEW_BINDING_DATABASE_URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P3-20 export-manifest-review-binding integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runExportManifestReviewBindingSuite();
}

async function runExportManifestReviewBindingSuite() {
  const { Pool } = await import("pg");
  const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { createEvidenceSummaryDraft, completeGeneratedContentReview } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
  const {
    requestGeneratedDraftExportReview,
    startGeneratedDraftExportReview,
    completeGeneratedDraftExportReview,
  } = await import("../Backend/kai/services/kaiExportReviewService.js");
  const { createPostgresExportCandidateRepository } = await import("../Backend/kai/dictionary/postgresExportCandidateRepository.js");
  const { confirmGeneratedDraftLimitationSnapshot, createGeneratedDraftExportCandidate } = await import("../Backend/kai/services/kaiExportCandidateService.js");
  const { createPostgresHumanAuthorityDecisionRepository } = await import("../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js");
  const { createPostgresExportManifestRepository } = await import("../Backend/kai/dictionary/postgresExportManifestRepository.js");
  const { createProductionMetadataOnlyAuditForExportManifest } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const NOW = "2026-09-08T10:00:00.000Z";
  const LATER = "2026-09-08T10:05:00.000Z";
  const EVEN_LATER = "2026-09-08T10:10:00.000Z";
  const GRANT_AT = "2026-09-08T10:15:00.000Z";
  const REVOKE_AT = "2026-09-08T10:20:00.000Z";
  const RE_GRANT_AT = "2026-09-08T10:25:00.000Z";
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
    actorUserId: "90000000-0000-4000-8000-000000000025",
    source: "public.userdata",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  };
  const gkReviewer = {
    ...gkAdmin,
    actorUserId: "90000000-0000-4000-8000-000000000024",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
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
          review_queue_item_id: "10000000-0000-4000-8000-000000000981",
          review_queue_status: "resolved",
          review_status: eligible ? "approved" : "needs_gk_review",
          updated_at: "2026-08-06T09:00:00.000Z",
          sensitivity_level: "unknown",
        },
        locator: { source_locator_id: "10000000-0000-4000-8000-000000000982" },
        source: { source_id: "10000000-0000-4000-8000-000000000983", source_code: null },
        source_version: { source_version_id: "10000000-0000-4000-8000-000000000984", is_current: true },
        claim_review: { review_queue_item_id: "10000000-0000-4000-8000-000000000985", queue_status: "resolved", review_status: eligible ? "approved" : "needs_gk_review" },
        candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000004" },
        promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000986" },
        dimensions: {},
        gap_items: [],
        client_followup_workflows: [],
        potential_conflict_groups: [],
        requestedAudience: evalInput.requestedAudience,
        eligible,
        blockerCodes: eligible ? [] : ["claim_review_unresolved"],
        affectedDimensionKeys: eligible ? [] : ["missingness"],
        affectedObjectIds: eligible ? [] : ["10000000-0000-4000-8000-000000000985"],
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
    const claimId = `10000000-0000-4000-8000-0000003a9${n}`;
    const evidenceId = `10000000-0000-4000-8000-0000003e9${n}`;

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
              'P3-20 export-manifest-review-binding evidence item.', encode(digest($1::text, 'sha256'), 'hex'), created_by_type
         FROM kai.evidence_items WHERE evidence_item_id = $2::uuid`,
      [evidenceId, templateEvidenceId],
    );
    await query(
      `INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review','unassessed','P3-20 export-manifest-review-binding claim.',encode(digest($1::text, 'sha256'), 'hex'),'system')`,
      [claimId, ORG, evidenceId],
    );
    await query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type) VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
      [ORG, claimId, evidenceId],
    );

    const created = await createEvidenceSummaryDraft(
      { organizationId: ORG, requestedAudience: "internal", claimIds: [claimId], idempotencyKey: `p3-20-export-manifest-review-binding-${n}`, actorContext: gkReviewer, now: NOW },
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
      { organizationId: ORG, generatedContentDraftId: draftId, reviewQueueItemId: generatedContentQueueId, expectedUpdatedAt: genUpdatedAtRows[0].updated_at.toISOString(), actorContext: gkReviewer, now: NOW },
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
      { organizationId: ORG, generatedContentDraftId: draftId, entries: [{ claimId, evidenceItemId: evidenceId, limitationCodes: [] }], actorContext: gkReviewer, now: NOW },
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

  function createManifestInput(seed, overrides = {}) {
    return {
      organizationId: ORG,
      exportCandidateId: seed.exportCandidateId,
      exportReviewQueueItemId: seed.exportReviewQueueItemId,
      actorContext: gkAdmin,
      now: GRANT_AT,
      ...overrides,
    };
  }

  function manifestDependencies(seed, overrides = {}) {
    return {
      metadataOnlyAudit: createProductionMetadataOnlyAuditForExportManifest({ organizationId: ORG, exportCandidateId: seed.exportCandidateId, actorContext: gkAdmin, now: GRANT_AT }),
      evaluator: currentUseEvaluator(seed.evidenceId, { eligible: true }),
      ...overrides,
    };
  }

  test.after(async () => {
    await pool.end();
  });

  test("the returned exportManifestId's persisted row carries the exact caller-supplied export_review_queue_item_id", async () => {
    const seed = await seedFullExportCandidatePipeline();
    const grant = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "grant", requestedAudience: "internal", actorContext: gkAdmin, now: GRANT_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(grant.ok, true, JSON.stringify(grant));

    const result = await exportManifestRepository.createExportManifest(createManifestInput(seed), manifestDependencies(seed));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.exportReviewQueueItemId, seed.exportReviewQueueItemId);

    const rows = await query(
      `SELECT export_review_queue_item_id::text AS export_review_queue_item_id
         FROM kai.export_manifests WHERE export_manifest_id = $1::uuid`,
      [result.data.exportManifestId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].export_review_queue_item_id, seed.exportReviewQueueItemId, "returned exportManifestId's persisted binding identity must equal what the repository returned");
  });

  test("one review item legitimately backs multiple historical manifests: revoke then re-grant on the SAME candidate produces a second, distinct manifest bound to the SAME review item", async () => {
    const seed = await seedFullExportCandidatePipeline();
    const grant = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "grant", requestedAudience: "internal", actorContext: gkAdmin, now: GRANT_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(grant.ok, true);

    const first = await exportManifestRepository.createExportManifest(createManifestInput(seed), manifestDependencies(seed));
    assert.equal(first.ok, true, JSON.stringify(first));

    const revoke = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "revoke", requestedAudience: "internal", actorContext: gkAdmin, now: REVOKE_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(revoke.ok, true);

    const regrant = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "grant", requestedAudience: "internal", actorContext: gkAdmin, now: RE_GRANT_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(regrant.ok, true);

    const second = await exportManifestRepository.createExportManifest(
      createManifestInput(seed, { now: RE_GRANT_AT }),
      manifestDependencies(seed),
    );
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.notEqual(second.data.exportManifestId, first.data.exportManifestId, "a distinct effective authority decision must produce a distinct manifest, per the unchanged P3-19 fingerprint");
    assert.equal(second.data.exportReviewQueueItemId, seed.exportReviewQueueItemId);
    assert.equal(first.data.exportReviewQueueItemId, seed.exportReviewQueueItemId);

    const rows = await query(
      `SELECT export_manifest_id::text AS export_manifest_id
         FROM kai.export_manifests
        WHERE organization_id = $1::uuid AND export_review_queue_item_id = $2::uuid`,
      [ORG, seed.exportReviewQueueItemId],
    );
    const manifestIds = rows.map((row) => row.export_manifest_id).sort();
    assert.deepEqual(manifestIds, [first.data.exportManifestId, second.data.exportManifestId].sort(), "the same review item now legitimately backs exactly these two distinct historical manifests - no UNIQUE(export_review_queue_item_id) collapsed them");
  });

  test("replay: the same eligible state submitted twice still converges to exactly one manifest row, with the same persisted review-item binding", async () => {
    const seed = await seedFullExportCandidatePipeline();
    const grant = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "grant", requestedAudience: "internal", actorContext: gkAdmin, now: GRANT_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(grant.ok, true);

    const deps = manifestDependencies(seed);
    const first = await exportManifestRepository.createExportManifest(createManifestInput(seed), deps);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.data.replayed, false);

    const second = await exportManifestRepository.createExportManifest(createManifestInput(seed), deps);
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.exportManifestId, first.data.exportManifestId);
    assert.equal(second.data.exportReviewQueueItemId, seed.exportReviewQueueItemId);

    const rows = await query(`SELECT export_review_queue_item_id::text AS export_review_queue_item_id FROM kai.export_manifests WHERE export_candidate_id = $1::uuid`, [seed.exportCandidateId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].export_review_queue_item_id, seed.exportReviewQueueItemId);
  });

  test("cross-tenant object (export candidate belongs to a different organization) -> BLOCKED before any manifest or binding is ever written", async () => {
    const seed = await seedFullExportCandidatePipeline();
    const grant = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "grant", requestedAudience: "internal", actorContext: gkAdmin, now: GRANT_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(grant.ok, true);

    const result = await exportManifestRepository.createExportManifest(
      createManifestInput(seed, { organizationId: OTHER_ORG }),
      manifestDependencies(seed),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");

    const rows = await query(`SELECT 1 FROM kai.export_manifests WHERE export_candidate_id = $1::uuid`, [seed.exportCandidateId]);
    assert.equal(rows.length, 0);
  });

  test("binding failure cannot return a successful finalization: an exportReviewQueueItemId that exists but targets a DIFFERENT draft fails the real P3-18 eligibility gate, and creates no manifest and no persisted binding", async () => {
    const seedA = await seedFullExportCandidatePipeline();
    const seedB = await seedFullExportCandidatePipeline();
    const grant = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seedA.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "grant", requestedAudience: "internal", actorContext: gkAdmin, now: GRANT_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(grant.ok, true);

    // seedA's candidate, but seedB's (real, existing, same-tenant, but
    // wrong-draft) export_review_queue_item_id - exactly the mismatch the
    // accepted FUNCTIONAL_DEPENDENCY_PROOF traced through
    // isExportReviewQueueContractRow's target_object_id check.
    const result = await exportManifestRepository.createExportManifest(
      createManifestInput(seedA, { exportReviewQueueItemId: seedB.exportReviewQueueItemId }),
      manifestDependencies(seedA),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "conflict_current_state_changed", "a real but mismatched review item must fail the real P3-18 eligibility gate, never a fabricated success");

    const rows = await query(`SELECT 1 FROM kai.export_manifests WHERE export_candidate_id = $1::uuid`, [seedA.exportCandidateId]);
    assert.equal(rows.length, 0, "no manifest, and therefore no export_review_queue_item_id binding, may ever be persisted for a rejected finalization attempt");
  });
}
