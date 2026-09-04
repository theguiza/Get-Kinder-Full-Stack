import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_10_COVERAGE_REVIEW_DECISION_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P2-10 integration suite refused a non-loopback KAI_P2_10_COVERAGE_REVIEW_DECISION_DATABASE_URL host: ${host}`);
  }
}

test("P2-10 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P2-10 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresCoverageReviewDecisionRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P2-10 coverage-review-decision integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP210IntegrationSuite();
}

async function runP210IntegrationSuite() {
  const { Pool } = await import("pg");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { createConflictReviewCandidate } = await import("../Backend/kai/services/kaiConflictReviewCandidateService.js");
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { listEligibleClaimsForAudience } = await import("../Backend/kai/services/kaiEligibleClaimsForAudienceService.js");
  const { completeClientFollowup } = await import("../Backend/kai/services/kaiClientFollowupCompletionService.js");
  const {
    acceptInternalCoverageLimitation,
    acceptFunderCoverageLimitation,
  } = await import("../Backend/kai/services/kaiCoverageReviewDecisionService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { createPostgresConflictReviewCandidateRepository } = await import("../Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js");
  const { createPostgresHumanReviewRepository } = await import("../Backend/kai/dictionary/postgresHumanReviewRepository.js");
  const { createPostgresClaimTraceabilityRepository } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");
  const { createPostgresEligibleClaimsForAudienceRepository } = await import("../Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js");
  const { createPostgresCoverageReviewDecisionRepository } = await import("../Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js");
  const { createPostgresClientFollowupCompletionRepository } = await import("../Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const NOW = "2026-08-15T10:00:00.000Z";
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

  const reviewerActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };
  const adminActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000002",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  };
  const operatorActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000003",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
  };
  const aiActor = {
    actorType: "ai",
    actorUserId: "90000000-0000-4000-8000-000000000004",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };

  function auditRecorder({ rejectPublish = false } = {}) {
    const calls = [];
    return {
      calls,
      prepareMetadataOnlyAudit({ payload }) {
        calls.push({ type: "prepare", payload });
        return {
          ok: true,
          async publish() {
            calls.push({ type: "publish" });
            if (rejectPublish) throw new Error("forced publish failure");
          },
        };
      },
    };
  }

  const evidenceRepo = createPostgresEvidenceLineageRepository({ runInTransaction: withRunnerOwnedTransaction });
  const claimRepo = createPostgresClaimProposalRepository({ runInTransaction: withRunnerOwnedTransaction });
  const gapRepo = createPostgresClaimGapFollowupRepository({ runInTransaction: withRunnerOwnedTransaction });
  const conflictRepo = createPostgresConflictReviewCandidateRepository({ runInTransaction: withRunnerOwnedTransaction });
  const humanReviewRepo = createPostgresHumanReviewRepository({ runInTransaction: withRunnerOwnedTransaction });
  const traceRepo = createPostgresClaimTraceabilityRepository({ runInTransaction: withRunnerOwnedTransaction });
  const eligibleRepo = createPostgresEligibleClaimsForAudienceRepository({ runInTransaction: withRunnerOwnedTransaction });
  const coverageRepo = createPostgresCoverageReviewDecisionRepository({ runInTransaction: withRunnerOwnedTransaction });
  const clientFollowupRepo = createPostgresClientFollowupCompletionRepository({ runInTransaction: withRunnerOwnedTransaction });

  test.after(async () => {
    await pool.end();
  });

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }

  async function trace(claimId, requestedAudience = "internal") {
    return getClaimTraceabilitySummary(
      { organizationId: ORG, claimId, requestedAudience, actorContext: reviewerActor },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimTraceabilityRepository: traceRepo },
    );
  }

  async function eligibleFor(requestedAudience) {
    return listEligibleClaimsForAudience(
      { organizationId: ORG, requestedAudience, limit: 25, afterClaimId: null, actorContext: reviewerActor },
      { env: { KAI_SPRINT2_ENABLED: "true" }, eligibleClaimsForAudienceRepository: eligibleRepo },
    );
  }

  async function accept(claimId, dimensionKey, actorContext = reviewerActor, dependencies = {}) {
    return acceptInternalCoverageLimitation(
      { organizationId: ORG, claimId, dimensionKey, actorContext, now: NOW },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        coverageReviewDecisionRepository: coverageRepo,
        metadataOnlyAudit: auditRecorder(),
        ...dependencies,
      },
    );
  }

  async function acceptFunder(claimId, dimensionKey, actorContext = reviewerActor, dependencies = {}) {
    return acceptFunderCoverageLimitation(
      { organizationId: ORG, claimId, dimensionKey, actorContext, now: NOW },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        coverageReviewDecisionRepository: coverageRepo,
        metadataOnlyAudit: auditRecorder(),
        ...dependencies,
      },
    );
  }

  let preparedClaims = null;
  async function prepareTwoClaims() {
    if (preparedClaims) return preparedClaims;
    const sourceVersions = await query(
      `SELECT source_version_id
         FROM kai.source_versions
        WHERE organization_id = $1::uuid
          AND is_current = true
        ORDER BY source_version_id
        LIMIT 1`,
      [ORG],
    );
    const evidenceResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersions[0].source_version_id, actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceLineageRepository: evidenceRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceResult.ok, true);
    const evidenceRows = await query(
      `SELECT evidence_item_id
         FROM kai.evidence_items
        WHERE organization_id = $1::uuid
        ORDER BY evidence_item_id
        LIMIT 2`,
      [ORG],
    );
    assert.equal(evidenceRows.length, 2);
    const claims = [];
    for (const row of evidenceRows) {
      const claimResult = await proposeClaim(
        { organizationId: ORG, evidenceItemId: row.evidence_item_id, actorContext: reviewerActor, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: claimRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(claimResult.ok, true);
      const gapResult = await generateClaimGapFollowups(
        { organizationId: ORG, claimId: claimResult.data.claim.claim_id, actorContext: reviewerActor, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(gapResult.ok, true);
      claims.push({ claimId: claimResult.data.claim.claim_id, evidenceItemId: row.evidence_item_id });
    }
    preparedClaims = claims.sort((a, b) => (a.claimId < b.claimId ? -1 : 1));
    return preparedClaims;
  }

  async function completeHumanReview(claimId, evidenceItemId) {
    const evidenceQueueRows = await query(
      `SELECT review_queue_item_id, updated_at
         FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_type = 'evidence_item' AND target_object_id = $2::uuid`,
      [ORG, evidenceItemId],
    );
    const evidenceResult = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId, reviewQueueItemId: evidenceQueueRows[0].review_queue_item_id,
        expectedUpdatedAt: new Date(evidenceQueueRows[0].updated_at).toISOString(), decision: "supported", actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceResult.ok, true);

    const claimQueueRows = await query(
      `SELECT review_queue_item_id, updated_at
         FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_type = 'claim' AND target_object_id = $2::uuid`,
      [ORG, claimId],
    );
    const claimResult = await recordClaimReviewDecision(
      {
        organizationId: ORG, claimId, reviewQueueItemId: claimQueueRows[0].review_queue_item_id,
        expectedUpdatedAt: new Date(claimQueueRows[0].updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"], actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimResult.ok, true);
  }

  async function completeHumanReviewForAudiences(claimId, evidenceItemId, approvedAudiences) {
    const evidenceQueueRows = await query(
      `SELECT review_queue_item_id, updated_at
         FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_type = 'evidence_item' AND target_object_id = $2::uuid`,
      [ORG, evidenceItemId],
    );
    const evidenceResult = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId, reviewQueueItemId: evidenceQueueRows[0].review_queue_item_id,
        expectedUpdatedAt: new Date(evidenceQueueRows[0].updated_at).toISOString(), decision: "supported", actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceResult.ok, true);

    const claimQueueRows = await query(
      `SELECT review_queue_item_id, updated_at
         FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_type = 'claim' AND target_object_id = $2::uuid`,
      [ORG, claimId],
    );
    const claimResult = await recordClaimReviewDecision(
      {
        organizationId: ORG, claimId, reviewQueueItemId: claimQueueRows[0].review_queue_item_id,
        expectedUpdatedAt: new Date(claimQueueRows[0].updated_at).toISOString(), decision: "approved", approvedAudiences, actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimResult.ok, true);
  }

  async function reapproveClaimForAudiences(claimId, approvedAudiences) {
    const claimQueueRows = await query(
      `SELECT review_queue_item_id, updated_at
         FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_type = 'claim' AND target_object_id = $2::uuid`,
      [ORG, claimId],
    );
    const claimResult = await recordClaimReviewDecision(
      {
        organizationId: ORG,
        claimId,
        reviewQueueItemId: claimQueueRows[0].review_queue_item_id,
        expectedUpdatedAt: new Date(claimQueueRows[0].updated_at).toISOString(),
        decision: "approved",
        approvedAudiences,
        actorContext: reviewerActor,
        now: new Date(Date.parse(NOW) + 1000).toISOString(),
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimResult.ok, true, JSON.stringify(claimResult));
  }

  async function recordPhase5FunderAuthorityForClaim(claimId, { permitted }) {
    const [lineage] = await query(
      `SELECT sv.intake_sensitivity_profile_id
         FROM kai.claims c
         JOIN kai.evidence_items e
           ON e.organization_id = c.organization_id
          AND e.evidence_item_id = c.evidence_item_id
         JOIN kai.source_versions sv
           ON sv.organization_id = e.organization_id
          AND sv.source_version_id = e.source_version_id
        WHERE c.organization_id = $1::uuid
          AND c.claim_id = $2::uuid`,
      [ORG, claimId],
    );
    assert.ok(lineage);
    let [queueItem] = await query(
      `SELECT review_queue_item_id
         FROM kai.review_queue_items
        WHERE organization_id = $1::uuid
          AND queue_type = 'sensitivity_review'
          AND target_object_type = 'intake_sensitivity_profile'
          AND target_object_id = $2::uuid`,
      [ORG, lineage.intake_sensitivity_profile_id],
    );
    if (!queueItem) {
      [queueItem] = await query(
        `INSERT INTO kai.review_queue_items (
           organization_id, queue_type, target_object_type, target_object_id,
           priority, queue_status, review_status, summary, required_action,
           queue_metadata, created_by_type
         ) VALUES (
           $1::uuid, 'sensitivity_review', 'intake_sensitivity_profile', $2::uuid,
           'medium', 'open', 'needs_gk_review', 'Review sensitivity and allowed-use metadata.',
           'Review sensitivity and allowed-use metadata before governed use.', '{}'::jsonb, 'human'
         )
         RETURNING review_queue_item_id`,
        [ORG, lineage.intake_sensitivity_profile_id],
      );
    }

    const [head] = await query(
      `SELECT decision_id
         FROM kai.intake_sensitivity_review_decisions d
        WHERE d.organization_id = $1::uuid
          AND d.intake_sensitivity_profile_id = $2::uuid
          AND NOT EXISTS (
                SELECT 1
                  FROM kai.intake_sensitivity_review_decisions s
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
         'unknown', 'present', $4,
         false, false, false,
         $5, $6::uuid, 'gk_reviewer', $7::timestamptz,
         $8::uuid, 'human', now()
       )`,
      [
        ORG,
        lineage.intake_sensitivity_profile_id,
        queueItem.review_queue_item_id,
        permitted ? "allowed" : "not_allowed",
        permitted,
        reviewerActor.actorUserId,
        NOW,
        head?.decision_id || null,
      ],
    );
  }

  async function completeAllFollowups(claimId) {
    const rows = await query(
      `SELECT cfi.client_followup_item_id, rq.updated_at
         FROM kai.client_followup_items cfi
         JOIN kai.review_queue_items rq
           ON rq.organization_id = cfi.organization_id
          AND rq.queue_type = 'client_followup'
          AND rq.target_object_type = 'client_followup_item'
          AND rq.target_object_id = cfi.client_followup_item_id
        WHERE cfi.organization_id = $1::uuid
          AND cfi.claim_id = $2::uuid
        ORDER BY cfi.dimension_key`,
      [ORG, claimId],
    );
    const clientReviewerActor = {
      actorType: "human",
      actorUserId: "90000000-0000-4000-8000-000000000007",
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_reviewer" }],
    };
    for (const row of rows) {
      const result = await completeClientFollowup(
        {
          organizationId: ORG,
          claimId,
          clientFollowupItemId: row.client_followup_item_id,
          expectedUpdatedAt: new Date(row.updated_at).toISOString(),
          actorContext: clientReviewerActor,
          now: NOW,
        },
        { env: { KAI_SPRINT2_ENABLED: "true" }, clientFollowupCompletionRepository: clientFollowupRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, true, JSON.stringify(result));
    }
  }

  function unresolvedDimensionKeys(traceData) {
    return Object.entries(traceData.dimensions)
      .filter(([, value]) => value.assessment_status === "unresolved")
      .map(([dimensionKey]) => dimensionKey)
      .sort();
  }

  test("P2-10 authority safety: non-human/wrong-role/wrong-tenant/disabled/fabricated-dimension/incomplete-review are all denied with zero mutation", async () => {
    const [alpha, beta] = await prepareTwoClaims();
    const before = await query(`SELECT count(*)::int AS count FROM kai.coverage_review_decisions`);

    const nonHuman = await accept(alpha.claimId, "denominator_clarity", aiActor);
    assert.equal(nonHuman.ok, false);
    assert.equal(nonHuman.error.code, "authorization_denied");

    const operator = await accept(alpha.claimId, "denominator_clarity", operatorActor);
    assert.equal(operator.ok, false);
    assert.equal(operator.error.code, "authorization_denied");

    const admin = await accept(alpha.claimId, "denominator_clarity", adminActor);
    assert.equal(admin.ok, false);
    assert.equal(admin.error.code, "authorization_denied");

    const wrongTenant = await acceptInternalCoverageLimitation(
      { organizationId: OTHER_ORG, claimId: alpha.claimId, dimensionKey: "denominator_clarity", actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, coverageReviewDecisionRepository: coverageRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(wrongTenant.ok, false);
    assert.equal(wrongTenant.error.code, "authorization_denied");

    const disabled = await acceptInternalCoverageLimitation(
      { organizationId: ORG, claimId: alpha.claimId, dimensionKey: "denominator_clarity", actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "false" }, coverageReviewDecisionRepository: coverageRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(disabled.ok, false);
    assert.equal(disabled.error.code, "feature_disabled");

    const fabricated = await accept(alpha.claimId, "not_a_real_dimension");
    assert.equal(fabricated.ok, false);
    assert.equal(fabricated.error.code, "validation_blocker");

    // Neither alpha nor beta has had its P2-09 evidence/claim review
    // completed yet at this point in the suite (this test runs before any
    // other) - a correctly-authorized gk_reviewer call must still fail closed
    // for that reason alone.
    const humanReviewIncomplete = await accept(beta.claimId, "denominator_clarity");
    assert.equal(humanReviewIncomplete.ok, false);
    assert.equal(humanReviewIncomplete.error.code, "human_review_incomplete");

    const after = await query(`SELECT count(*)::int AS count FROM kai.coverage_review_decisions`);
    assert.equal(after[0].count, before[0].count);
  });

  // P2-05's own createConflictReviewCandidate requires the claim_review queue
  // item to still read 'needs_gk_review' at creation time (see
  // Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js#
  // readClaimBundle) - so a conflict candidate can only be created BEFORE
  // P2-09 claim-review completion, not after. This test runs FIRST in the
  // suite, before any other test completes either claim's P2-09 review, then
  // completes P2-09 review and full coverage acceptance for one side, proving
  // coverage acceptance clears coverage_dimension_unresolved completely while
  // the independently-computed potential_conflict_review_unresolved blocker -
  // which P2-10 never touches - keeps the claim ineligible regardless.
  test("P2-10 a real unresolved P2-05 potential conflict remains independently blocking after full internal coverage acceptance - never cleared by a coverage decision", async () => {
    const [alpha, beta] = await prepareTwoClaims();

    const conflictResult = await createConflictReviewCandidate(
      { organizationId: ORG, firstClaimId: alpha.claimId, secondClaimId: beta.claimId, actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, conflictReviewCandidateRepository: conflictRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(conflictResult.ok, true);

    await completeHumanReview(beta.claimId, beta.evidenceItemId);
    const beforeAccept = await trace(beta.claimId, "internal");
    assert.equal(beforeAccept.ok, true);
    assert.ok(beforeAccept.data.blockerCodes.includes("potential_conflict_review_unresolved"));
    assert.ok(beforeAccept.data.blockerCodes.includes("coverage_dimension_unresolved"));

    const unresolved = unresolvedDimensionKeys(beforeAccept.data);
    for (const dimensionKey of unresolved) {
      const result = await accept(beta.claimId, dimensionKey);
      assert.equal(result.ok, true);
    }

    const afterConflict = await trace(beta.claimId, "internal");
    assert.equal(afterConflict.ok, true);
    assert.equal(afterConflict.data.eligible, false);
    assert.ok(afterConflict.data.blockerCodes.includes("potential_conflict_review_unresolved"), "a real unresolved P2-05 conflict remains blocking regardless of coverage acceptance");
    assert.ok(!afterConflict.data.blockerCodes.includes("coverage_dimension_unresolved"), "coverage acceptance can never clear, resolve, or override a P2-05 conflict");

    const eligibleInternal = await eligibleFor("internal");
    assert.equal(eligibleInternal.ok, true);
    assert.ok(!eligibleInternal.data.eligibleClaims.some((row) => row.claimId === beta.claimId));

    await pool.query(`DELETE FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'conflict_resolution'`, [ORG]);
    await pool.query(`DELETE FROM kai.conflict_groups WHERE organization_id = $1::uuid`, [ORG]);
  });

  test("P2-10 end-to-end: zero acceptances leaves internal ineligible and absent from eligible-claims-for-audience", async () => {
    const [alpha, beta] = await prepareTwoClaims();
    await completeHumanReview(alpha.claimId, alpha.evidenceItemId);

    const before = await trace(alpha.claimId, "internal");
    assert.equal(before.ok, true);
    assert.equal(before.data.eligible, false);
    assert.ok(!before.data.blockerCodes.includes("claim_not_approved_for_requested_audience"));
    assert.ok(!before.data.blockerCodes.includes("evidence_review_unresolved"));
    assert.ok(!before.data.blockerCodes.includes("claim_review_unresolved"));
    assert.ok(before.data.blockerCodes.includes("coverage_dimension_unresolved"));

    const unresolved = unresolvedDimensionKeys(before.data);
    assert.ok(unresolved.length > 0);
    for (const dimensionKey of unresolved) {
      assert.equal(before.data.dimensions[dimensionKey].internal_limitation_accepted, false);
      assert.equal(before.data.dimensions[dimensionKey].blocks_requested_audience, true);
    }

    const eligible = await eligibleFor("internal");
    assert.equal(eligible.ok, true);
    assert.ok(!eligible.data.eligibleClaims.some((row) => row.claimId === alpha.claimId));

    for (const audience of ["funder", "public"]) {
      const external = await trace(alpha.claimId, audience);
      assert.equal(external.ok, true);
      assert.equal(external.data.eligible, false);
      const externalEligible = await eligibleFor(audience);
      assert.equal(externalEligible.ok, true);
      assert.ok(!externalEligible.data.eligibleClaims.some((row) => row.claimId === alpha.claimId));
      void beta;
    }
  });

  test("P2-10 audit failure rolls back the fresh authority write - zero orphaned rows", async () => {
    const [alpha] = await prepareTwoClaims();
    const traced = await trace(alpha.claimId, "internal");
    const [dimensionKey] = unresolvedDimensionKeys(traced.data);

    const beforeCount = (await query(`SELECT count(*)::int AS count FROM kai.coverage_review_decisions`))[0].count;
    const rejected = await acceptInternalCoverageLimitation(
      { organizationId: ORG, claimId: alpha.claimId, dimensionKey, actorContext: reviewerActor, now: NOW },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        coverageReviewDecisionRepository: coverageRepo,
        metadataOnlyAudit: auditRecorder({ rejectPublish: true }),
      },
    );
    assert.equal(rejected.ok, false);
    const afterCount = (await query(`SELECT count(*)::int AS count FROM kai.coverage_review_decisions`))[0].count;
    assert.equal(afterCount, beforeCount, "a rejected required audit must roll back the fresh authority write - no orphaned row");
  });

  // NOTE ON THIS FIXTURE'S CEILING: P2-02's denominator_clarity and
  // time_period_clarity dimensions are unconditionally "unresolved" by
  // design (Backend/kai/validators/kaiEvidenceCoverageAssessmentValidators.js
  // - no committed fact ever satisfies them), so P2-04 always opens a
  // client_followup_item (queue_status='waiting_on_client') for both, for
  // every claim ever proposed - and no P2 package through P2-09 builds a
  // route to resolve one. client_followup_unresolved is therefore an
  // independent, pre-existing blocker on every claim in this schema, and
  // P2-10 is explicitly forbidden from resolving/mutating/silently
  // suppressing it. So "full acceptance" below proves the coverage-dimension
  // carve-out is completely clear (no coverage_dimension_unresolved, and
  // every previously-audience-gating code is gone), while eligible honestly
  // stays false for this one independent, untouched reason - not a P2-10 gap.
  test("P2-10 end-to-end: partial acceptance still leaves internal ineligible; full acceptance clears coverage_dimension_unresolved completely (leaving only the independent, untouched client_followup_unresolved); P2-02/P2-04 truth is unchanged; funder/public stay ineligible", async () => {
    const [alpha] = await prepareTwoClaims();

    const traced = await trace(alpha.claimId, "internal");
    const unresolved = unresolvedDimensionKeys(traced.data);
    assert.ok(unresolved.length >= 2, "fixture must have at least two always-unresolved dimensions to prove partial acceptance");

    const [firstDimension, ...restDimensions] = unresolved;
    const beforeAuditCount = (await query(
      `SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'coverage_review_decision_accepted_internal_with_limitation'`,
    ))[0].count;

    const firstAccept = await accept(alpha.claimId, firstDimension);
    assert.equal(firstAccept.ok, true);
    assert.equal(firstAccept.data.replayed, false);

    const replay = await accept(alpha.claimId, firstDimension);
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);

    const midAuditCount = (await query(
      `SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'coverage_review_decision_accepted_internal_with_limitation'`,
    ))[0].count;
    assert.equal(midAuditCount, beforeAuditCount + 1, "exact replay must not create a duplicate audit row");

    const decisionRows = await query(
      `SELECT count(*)::int AS count FROM kai.coverage_review_decisions WHERE organization_id = $1::uuid AND claim_id = $2::uuid AND dimension_key = $3`,
      [ORG, alpha.claimId, firstDimension],
    );
    assert.equal(decisionRows[0].count, 1, "exact replay must not create a duplicate authority row");

    const partial = await trace(alpha.claimId, "internal");
    assert.equal(partial.ok, true);
    assert.equal(partial.data.eligible, false);
    assert.ok(partial.data.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.equal(partial.data.dimensions[firstDimension].assessment_status, "unresolved");
    assert.equal(partial.data.dimensions[firstDimension].internal_limitation_accepted, true);
    assert.equal(partial.data.dimensions[firstDimension].blocks_requested_audience, false);
    for (const dimensionKey of restDimensions) {
      assert.equal(partial.data.dimensions[dimensionKey].internal_limitation_accepted, false);
      assert.equal(partial.data.dimensions[dimensionKey].blocks_requested_audience, true);
    }

    for (const dimensionKey of restDimensions) {
      const result = await accept(alpha.claimId, dimensionKey);
      assert.equal(result.ok, true);
    }

    const full = await trace(alpha.claimId, "internal");
    assert.equal(full.ok, true);
    assert.ok(!full.data.blockerCodes.includes("coverage_dimension_unresolved"), "every currently-unresolved dimension has a matching current acceptance");
    assert.ok(!full.data.blockerCodes.includes("claim_not_approved_for_requested_audience"));
    assert.ok(!full.data.blockerCodes.includes("audience_gate_closed"));
    assert.ok(!full.data.blockerCodes.includes("requirement_authority_absent"));
    assert.deepEqual(full.data.blockerCodes, ["client_followup_unresolved"], "the ONLY remaining blocker is the independent, untouched P2-04 client-followup gate - never coverage_dimension_unresolved");
    assert.equal(full.data.eligible, false, "eligible stays false solely because of the independent client_followup_unresolved blocker, not because of coverage");
    for (const dimensionKey of unresolved) {
      assert.equal(full.data.dimensions[dimensionKey].assessment_status, "unresolved", "P2-02 automated assessment must never be relabeled");
      assert.equal(full.data.dimensions[dimensionKey].internal_limitation_accepted, true);
      assert.equal(full.data.dimensions[dimensionKey].blocks_requested_audience, false);
    }
    const fullGapRows = full.data.gap_items.filter((row) => unresolved.includes(row.dimension_key));
    for (const row of fullGapRows) {
      assert.equal(row.assessment_status, "unresolved", "P2-04 gap rows must never be mutated by a coverage acceptance");
    }

    // P2-08 stays perfectly consistent with P2-06: since eligible is honestly
    // still false (independent client_followup_unresolved), P2-08 correctly
    // continues to omit this claim - it never runs a second eligibility model.
    const eligibleInternal = await eligibleFor("internal");
    assert.equal(eligibleInternal.ok, true);
    assert.ok(!eligibleInternal.data.eligibleClaims.some((row) => row.claimId === alpha.claimId));

    for (const audience of ["funder", "public"]) {
      const external = await trace(alpha.claimId, audience);
      assert.equal(external.ok, true);
      assert.equal(external.data.eligible, false, "coverage acceptance never grants funder/public authority");
      const externalEligible = await eligibleFor(audience);
      assert.equal(externalEligible.ok, true);
      assert.ok(!externalEligible.data.eligibleClaims.some((row) => row.claimId === alpha.claimId));
    }
  });

  test("P2-10 funder write: missing or denied Phase-5 authority fails closed with zero coverage mutation", async () => {
    const [alpha] = await prepareTwoClaims();
    const traced = await trace(alpha.claimId, "internal");
    const [dimensionKey] = unresolvedDimensionKeys(traced.data);

    const beforeMissing = (await query(`SELECT count(*)::int AS count FROM kai.coverage_review_decisions`))[0].count;
    const missing = await acceptFunder(alpha.claimId, dimensionKey);
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "validation_blocker");
    const afterMissing = (await query(`SELECT count(*)::int AS count FROM kai.coverage_review_decisions`))[0].count;
    assert.equal(afterMissing, beforeMissing);

    await recordPhase5FunderAuthorityForClaim(alpha.claimId, { permitted: false });
    const beforeDenied = (await query(`SELECT count(*)::int AS count FROM kai.coverage_review_decisions`))[0].count;
    const denied = await acceptFunder(alpha.claimId, dimensionKey);
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, "validation_blocker");
    const afterDenied = (await query(`SELECT count(*)::int AS count FROM kai.coverage_review_decisions`))[0].count;
    assert.equal(afterDenied, beforeDenied);
  });

  test("P2-10 funder coverage authority coexists with internal, is idempotent by decision, and is audience-specific in P2-06/P2-08", async () => {
    const [alpha] = await prepareTwoClaims();
    await recordPhase5FunderAuthorityForClaim(alpha.claimId, { permitted: true });

    const beforeFunder = await trace(alpha.claimId, "funder");
    assert.equal(beforeFunder.ok, true);
    assert.ok(beforeFunder.data.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.ok(beforeFunder.data.blockerCodes.includes("claim_not_approved_for_requested_audience"));
    assert.ok(beforeFunder.data.blockerCodes.includes("audience_gate_closed"));
    assert.ok(beforeFunder.data.blockerCodes.includes("requirement_authority_absent"));

    const unresolved = unresolvedDimensionKeys(beforeFunder.data);
    assert.ok(unresolved.length > 0);
    for (const dimensionKey of unresolved) {
      assert.equal(beforeFunder.data.dimensions[dimensionKey].internal_limitation_accepted, true);
      assert.equal(beforeFunder.data.dimensions[dimensionKey].funder_limitation_accepted, false);
    }

    const firstFunderAccept = await acceptFunder(alpha.claimId, unresolved[0]);
    assert.equal(firstFunderAccept.ok, true, JSON.stringify(firstFunderAccept));
    assert.equal(firstFunderAccept.data.decision, "accepted_funder_with_limitation");
    assert.equal(firstFunderAccept.data.replayed, false);
    const replay = await acceptFunder(alpha.claimId, unresolved[0]);
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);

    const coexist = await query(
      `SELECT decision, count(*)::int AS count
         FROM kai.coverage_review_decisions
        WHERE organization_id = $1::uuid
          AND claim_id = $2::uuid
          AND dimension_key = $3
        GROUP BY decision
        ORDER BY decision`,
      [ORG, alpha.claimId, unresolved[0]],
    );
    assert.deepEqual(coexist.map((row) => [row.decision, row.count]), [
      ["accepted_funder_with_limitation", 1],
      ["accepted_internal_with_limitation", 1],
    ]);

    const partialFunder = await trace(alpha.claimId, "funder");
    assert.equal(partialFunder.ok, true);
    assert.ok(partialFunder.data.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.equal(partialFunder.data.dimensions[unresolved[0]].funder_limitation_accepted, true);
    assert.equal(partialFunder.data.dimensions[unresolved[0]].blocks_requested_audience, false);

    for (const dimensionKey of unresolved.slice(1)) {
      const result = await acceptFunder(alpha.claimId, dimensionKey);
      assert.equal(result.ok, true, JSON.stringify(result));
    }

    const intermediate = await trace(alpha.claimId, "funder");
    assert.equal(intermediate.ok, true);
    assert.ok(!intermediate.data.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.equal(intermediate.data.claim_review_decision.approved_audiences.includes("funder"), false);
    assert.ok(intermediate.data.blockerCodes.includes("claim_not_approved_for_requested_audience"));
    assert.ok(intermediate.data.blockerCodes.includes("audience_gate_closed"));
    assert.ok(intermediate.data.blockerCodes.includes("requirement_authority_absent"));

    const publicTrace = await trace(alpha.claimId, "public");
    assert.equal(publicTrace.ok, true);
    assert.ok(publicTrace.data.blockerCodes.includes("coverage_dimension_unresolved"));

    await reapproveClaimForAudiences(alpha.claimId, ["internal", "funder"]);
    await completeAllFollowups(alpha.claimId);
    const finalFunder = await trace(alpha.claimId, "funder");
    assert.equal(finalFunder.ok, true);
    assert.equal(finalFunder.data.eligible, true);
    assert.deepEqual(finalFunder.data.blockerCodes, []);

    const eligibleFunder = await eligibleFor("funder");
    assert.equal(eligibleFunder.ok, true);
    assert.ok(eligibleFunder.data.eligibleClaims.some((row) => row.claimId === alpha.claimId));

    const internalTrace = await trace(alpha.claimId, "internal");
    assert.equal(internalTrace.ok, true);
    assert.equal(internalTrace.data.eligible, true);

    await pool.query(
      `UPDATE kai.evidence_items
          SET support_strength = 'unassessed'
        WHERE organization_id = $1::uuid
          AND evidence_item_id = $2::uuid`,
      [ORG, alpha.evidenceItemId],
    );
    const stale = await trace(alpha.claimId, "funder");
    assert.equal(stale.ok, true);
    assert.ok(stale.data.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.ok(stale.data.blockerCodes.includes("support_strength_unassessed"));
  });

}
