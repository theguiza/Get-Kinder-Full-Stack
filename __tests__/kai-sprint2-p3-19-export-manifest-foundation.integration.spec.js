// P3-19 EXPORT-MANIFEST-FOUNDATION REAL-PERSISTED PROOF
//
// Threads a real, persisted generated-content-draft/export-candidate
// identity through the same real, unmodified services this repository's own
// P3-18 real-persisted-final-gate-proof already uses (createEvidenceSummaryDraft
// -> completeGeneratedContentReview -> request/start/completeGeneratedDraftExportReview
// -> confirmGeneratedDraftLimitationSnapshot -> createGeneratedDraftExportCandidate),
// then drives the REAL, unmodified, shared
// evaluateFinalExportEligibilityInTransaction composition (Issue 1) through
// the P3-19 manifest write, and asserts a REAL kai.audit_events row (Issue 3
// - not a test double).
//
// DISCLOSED SCOPE BOUNDARY (identical to
// kai-sprint2-p3-18-real-persisted-final-gate-proof.integration.spec.js):
// current-use eligibility (packet.currentUseEligible) is computed from the
// real P2-06 claim-traceability evaluator's `eligible` field, which in
// production requires a fully resolved P1/P2 pipeline. This file injects the
// same real-shaped, disclosed stand-in `evaluator` function for that one
// P2-06 seam only - it does not stand in for draft_status, review-queue
// state, export-candidate/limitation-snapshot currentness, or the P3-17
// authority ledger, all of which remain fully real and unmodified
// throughout.

import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P3_19_EXPORT_MANIFEST_FOUNDATION_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P3-19 export-manifest-foundation suite refused a non-loopback KAI_P3_19_EXPORT_MANIFEST_FOUNDATION_DATABASE_URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P3-19 export-manifest-foundation integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runExportManifestFoundationSuite();
}

async function runExportManifestFoundationSuite() {
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
  const ENGAGEMENT = "00000000-0000-4000-8000-000000000919";
  const NOW = "2026-09-06T10:00:00.000Z";
  const LATER = "2026-09-06T10:05:00.000Z";
  const EVEN_LATER = "2026-09-06T10:10:00.000Z";
  const GRANT_AT = "2026-09-06T10:15:00.000Z";
  const REVOKE_AT = "2026-09-06T10:20:00.000Z";
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
    actorUserId: "90000000-0000-4000-8000-000000000015",
    source: "public.userdata",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  };
  const gkReviewer = {
    ...gkAdmin,
    actorUserId: "90000000-0000-4000-8000-000000000014",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };
  const aiActor = { actorType: "ai", actorUserId: "90000000-0000-4000-8000-000000000099", organizationMemberships: [] };

  // Disclosed P2-06 current-use-eligibility stand-in (see file header) -
  // identical technique to kai-sprint2-p3-18-real-persisted-final-gate-proof's
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

  // Creation-time P2-06 traceability stand-in (identical technique to
  // kai-sprint2-p3-18-real-persisted-final-gate-proof's own creationEvaluator):
  // reads the real seeded claim row, reports it traceable so real draft
  // generation can proceed.
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

  // Real, persisted pipeline: draft -> generated-content review -> export
  // review (request/start/complete) -> limitation snapshot -> export
  // candidate. Mirrors kai-sprint2-p3-18-real-persisted-final-gate-proof's
  // own seedFullExportCandidatePipeline exactly.
  async function seedFullExportCandidatePipeline() {
    seedCounter += 1;
    const n = String(seedCounter).padStart(3, "0");
    const claimId = `10000000-0000-4000-8000-0000002a9${n}`;
    const evidenceId = `10000000-0000-4000-8000-0000002e9${n}`;

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
              'P3-19 export-manifest-foundation evidence item.', encode(digest($1::text, 'sha256'), 'hex'), created_by_type
         FROM kai.evidence_items WHERE evidence_item_id = $2::uuid`,
      [evidenceId, templateEvidenceId],
    );
    await query(
      `INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review','unassessed','P3-19 export-manifest-foundation claim.',encode(digest($1::text, 'sha256'), 'hex'),'system')`,
      [claimId, ORG, evidenceId],
    );
    await query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type) VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
      [ORG, claimId, evidenceId],
    );

    const created = await createEvidenceSummaryDraft(
      { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "internal", claimIds: [claimId], idempotencyKey: `p3-19-export-manifest-foundation-${n}`, actorContext: gkReviewer, now: NOW },
      {
        env: enabledEnv,
        getEngagementForOrganization,
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

  function realMetadataOnlyAudit(exportCandidateId) {
    return createProductionMetadataOnlyAuditForExportManifest({ organizationId: ORG, exportCandidateId, actorContext: gkAdmin, now: GRANT_AT });
  }

  function manifestDependencies(seed, overrides = {}) {
    return {
      metadataOnlyAudit: realMetadataOnlyAudit(seed.exportCandidateId),
      evaluator: currentUseEvaluator(seed.evidenceId, { eligible: true }),
      ...overrides,
    };
  }

  test.after(async () => {
    await pool.end();
  });

  test("STATE PASS: authoritative P3-18/VAL-EXP-001 PASS inside the write transaction creates a manifest, FK'd to the exact effective grant, with a real kai.audit_events row", async () => {
    const seed = await seedFullExportCandidatePipeline();
    const grant = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "grant", requestedAudience: "internal", actorContext: gkAdmin, now: GRANT_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(grant.ok, true, JSON.stringify(grant));

    const result = await exportManifestRepository.createExportManifest(createManifestInput(seed), manifestDependencies(seed));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.effectiveAuthorityDecisionId, grant.data.decisionId);

    const manifestRows = await query(
      `SELECT export_candidate_id::text AS export_candidate_id, effective_authority_decision_id::text AS effective_authority_decision_id, effective_authority_decision_type, canonical_fingerprint
         FROM kai.export_manifests WHERE export_manifest_id = $1::uuid`,
      [result.data.exportManifestId],
    );
    assert.equal(manifestRows.length, 1);
    assert.equal(manifestRows[0].export_candidate_id, seed.exportCandidateId);
    assert.equal(manifestRows[0].effective_authority_decision_id, grant.data.decisionId);
    assert.equal(manifestRows[0].effective_authority_decision_type, "export_authority_granted");
    assert.match(manifestRows[0].canonical_fingerprint, /^[a-f0-9]{64}$/);

    const auditRows = await query(
      `SELECT object_type, action, metadata FROM kai.audit_events WHERE metadata->>'export_manifest_id' = $1`,
      [result.data.exportManifestId],
    );
    assert.equal(auditRows.length, 1, "real kai.audit_events row must persist alongside the manifest (Issue 3 - not a test double)");
    assert.equal(auditRows[0].object_type, "other", "the synthetic bootstrap enum has no export_manifest label, so this proves the documented fallback path, not a fabricated assumption about the real production enum");
    assert.equal(auditRows[0].metadata.export_manifest_id, result.data.exportManifestId);
    assert.equal(auditRows[0].metadata.export_candidate_id, seed.exportCandidateId);
    assert.equal(auditRows[0].metadata.operation_type, "export_manifest_created");

    const draftRows = await query(`SELECT draft_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid`, [seed.draftId]);
    assert.equal(draftRows[0].draft_status, "draft");
  });

  test("STATE 2: no authority decision at all -> BLOCKED, no manifest, no audit row", async () => {
    const seed = await seedFullExportCandidatePipeline();
    const result = await exportManifestRepository.createExportManifest(createManifestInput(seed), manifestDependencies(seed));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");

    const manifestRows = await query(`SELECT 1 FROM kai.export_manifests WHERE export_candidate_id = $1::uuid`, [seed.exportCandidateId]);
    assert.equal(manifestRows.length, 0);
  });

  test("STATE 3: authority revoked after an earlier grant -> BLOCKED, no manifest", async () => {
    const seed = await seedFullExportCandidatePipeline();
    const grant = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "grant", requestedAudience: "internal", actorContext: gkAdmin, now: GRANT_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(grant.ok, true);
    const revoke = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "revoke", requestedAudience: "internal", actorContext: gkAdmin, now: REVOKE_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(revoke.ok, true);

    const result = await exportManifestRepository.createExportManifest(createManifestInput(seed), manifestDependencies(seed));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");

    const manifestRows = await query(`SELECT 1 FROM kai.export_manifests WHERE export_candidate_id = $1::uuid`, [seed.exportCandidateId]);
    assert.equal(manifestRows.length, 0);
  });

  test("STATE 4: stale candidate (superseded limitation snapshot) -> BLOCKED, no manifest", async () => {
    const seed = await seedFullExportCandidatePipeline();
    const grant = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "grant", requestedAudience: "internal", actorContext: gkAdmin, now: GRANT_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(grant.ok, true);

    const supersedingSnapshot = await confirmGeneratedDraftLimitationSnapshot(
      { organizationId: ORG, generatedContentDraftId: seed.draftId, entries: [{ claimId: seed.claimId, evidenceItemId: seed.evidenceId, limitationCodes: ["sample_size_small"] }], actorContext: gkReviewer, now: LATER },
      { env: enabledEnv, exportCandidateRepository: exportCandidateRepository(), metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(supersedingSnapshot.ok, true, JSON.stringify(supersedingSnapshot));

    const result = await exportManifestRepository.createExportManifest(createManifestInput(seed), manifestDependencies(seed));
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker", "a stale candidate makes P3-17 authority ineffective, which the shared P3-18/VAL-EXP-001 composition reports as a blocker - the same code as any other not-PASS eligibility outcome");

    const manifestRows = await query(`SELECT 1 FROM kai.export_manifests WHERE export_candidate_id = $1::uuid`, [seed.exportCandidateId]);
    assert.equal(manifestRows.length, 0);
  });

  test("STATE 5: cross-tenant object (export candidate belongs to a different organization) -> BLOCKED, no manifest", async () => {
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
    assert.equal(result.error.code, "not_found", "a candidate scoped to a different organization must never be found, never leaking existence across tenants");

    const manifestRows = await query(`SELECT 1 FROM kai.export_manifests WHERE export_candidate_id = $1::uuid`, [seed.exportCandidateId]);
    assert.equal(manifestRows.length, 0);
  });

  test("replay: the same eligible state submitted twice converges to exactly one manifest row and exactly one audit-event row", async () => {
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

    const manifestRows = await query(`SELECT 1 FROM kai.export_manifests WHERE export_candidate_id = $1::uuid`, [seed.exportCandidateId]);
    assert.equal(manifestRows.length, 1);

    const auditRows = await query(`SELECT 1 FROM kai.audit_events WHERE metadata->>'export_manifest_id' = $1`, [first.data.exportManifestId]);
    assert.equal(auditRows.length, 1, "the audit publish only runs on the real-insert branch, never on a replay");
  });

  test("an unauthorized-role write (AI actor) never reaches the manifest repository's own gate (defense in depth: the repository's own input contract also refuses a non-human actor)", async () => {
    const seed = await seedFullExportCandidatePipeline();
    const grant = await humanAuthorityDecisionRepository.recordDecision({
      organizationId: ORG, exportCandidateId: seed.exportCandidateId, decisionType: "export_authority_granted",
      decisionAction: "grant", requestedAudience: "internal", actorContext: gkAdmin, now: GRANT_AT,
    }, { metadataOnlyAudit: auditRecorder() });
    assert.equal(grant.ok, true);

    const aiResult = await exportManifestRepository.createExportManifest(
      createManifestInput(seed, { actorContext: aiActor }),
      manifestDependencies(seed),
    );
    assert.equal(aiResult.ok, false);
    assert.equal(aiResult.error.code, "validation_blocker");

    const manifestRows = await query(`SELECT 1 FROM kai.export_manifests WHERE export_candidate_id = $1::uuid`, [seed.exportCandidateId]);
    assert.equal(manifestRows.length, 0);
  });
}
