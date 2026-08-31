import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_09_HUMAN_REVIEW_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P2-09 integration suite refused a non-loopback KAI_P2_09_HUMAN_REVIEW_DATABASE_URL host: ${host}`);
  }
}

test("P2-09 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P2-09 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresHumanReviewRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P2-09 human-review integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP209IntegrationSuite();
}

async function runP209IntegrationSuite() {
  const { Pool } = await import("pg");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { listEligibleClaimsForAudience } = await import("../Backend/kai/services/kaiEligibleClaimsForAudienceService.js");
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { createPostgresClaimTraceabilityRepository } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");
  const { createPostgresEligibleClaimsForAudienceRepository } = await import("../Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js");
  const { createPostgresHumanReviewRepository } = await import("../Backend/kai/dictionary/postgresHumanReviewRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const NOW = "2026-08-06T10:00:00.000Z";
  const LATER = "2026-08-06T10:05:00.000Z";
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
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
    ],
  };
  const adminActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000002",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
    ],
  };
  const operatorActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000003",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_operator" },
    ],
  };
  const aiActor = {
    actorType: "ai",
    actorUserId: "90000000-0000-4000-8000-000000000004",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
    ],
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
  const traceRepo = createPostgresClaimTraceabilityRepository({ runInTransaction: withRunnerOwnedTransaction });
  const eligibleRepo = createPostgresEligibleClaimsForAudienceRepository({ runInTransaction: withRunnerOwnedTransaction });
  const humanReviewRepo = createPostgresHumanReviewRepository({ runInTransaction: withRunnerOwnedTransaction });

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

  async function eligibleInternal() {
    return listEligibleClaimsForAudience(
      { organizationId: ORG, requestedAudience: "internal", limit: 25, afterClaimId: null, actorContext: reviewerActor },
      { env: { KAI_SPRINT2_ENABLED: "true" }, eligibleClaimsForAudienceRepository: eligibleRepo },
    );
  }

  // The synthetic P1-04 dictionary carries exactly two fields, so exactly two
  // evidence items / claims exist for this organization's source version.
  // Every scenario below is scoped to one of the two, never more.
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

  async function evidenceReviewQueueItem(evidenceItemId) {
    const rows = await query(
      `SELECT review_queue_item_id, updated_at
         FROM kai.review_queue_items
        WHERE organization_id = $1::uuid
          AND queue_type = 'evidence_review'
          AND target_object_type = 'evidence_item'
          AND target_object_id = $2::uuid`,
      [ORG, evidenceItemId],
    );
    return rows[0];
  }

  async function claimReviewQueueItem(claimId) {
    const rows = await query(
      `SELECT review_queue_item_id, updated_at
         FROM kai.review_queue_items
        WHERE organization_id = $1::uuid
          AND queue_type = 'claim_review'
          AND target_object_type = 'claim'
          AND target_object_id = $2::uuid`,
      [ORG, claimId],
    );
    return rows[0];
  }

  test("P2-12 before human review: internal is ineligible for the required reasons and the claim is absent from eligible-claims-for-audience", async () => {
    const [alpha] = await prepareTwoClaims();
    const before = await trace(alpha.claimId);
    assert.equal(before.ok, true);
    assert.equal(before.data.eligible, false);
    assert.ok(before.data.blockerCodes.includes("evidence_review_unresolved"));
    assert.ok(before.data.blockerCodes.includes("claim_review_unresolved"));
    assert.ok(before.data.blockerCodes.includes("support_strength_unassessed"));

    const eligible = await eligibleInternal();
    assert.equal(eligible.ok, true);
    assert.ok(!eligible.data.eligibleClaims.some((row) => row.claimId === alpha.claimId));
  });

  test("P2-12 evidence-review decision recording: authority/safety negatives, then success, same-transaction audit, idempotent replay, and the claim stays review-gated", async () => {
    const [alpha] = await prepareTwoClaims();
    const evidenceQueueItem = await evidenceReviewQueueItem(alpha.evidenceItemId);
    const expectedUpdatedAt = new Date(evidenceQueueItem.updated_at).toISOString();

    const nonHuman = await recordEvidenceReviewDecision(
      { organizationId: ORG, evidenceItemId: alpha.evidenceItemId, reviewQueueItemId: evidenceQueueItem.review_queue_item_id, expectedUpdatedAt, decision: "supported", actorContext: aiActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(nonHuman.ok, false);
    assert.equal(nonHuman.error.code, "authorization_denied");

    const wrongRole = await recordEvidenceReviewDecision(
      { organizationId: ORG, evidenceItemId: alpha.evidenceItemId, reviewQueueItemId: evidenceQueueItem.review_queue_item_id, expectedUpdatedAt, decision: "supported", actorContext: operatorActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(wrongRole.ok, false);
    assert.equal(wrongRole.error.code, "authorization_denied");

    const crossTenant = await recordEvidenceReviewDecision(
      {
        organizationId: OTHER_ORG,
        evidenceItemId: alpha.evidenceItemId,
        reviewQueueItemId: evidenceQueueItem.review_queue_item_id,
        expectedUpdatedAt,
        decision: "supported",
        actorContext: { ...reviewerActor, organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_reviewer" }] },
        now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(crossTenant.ok, false);
    assert.equal(crossTenant.error.code, "not_found");

    const stale = await recordEvidenceReviewDecision(
      { organizationId: ORG, evidenceItemId: alpha.evidenceItemId, reviewQueueItemId: evidenceQueueItem.review_queue_item_id, expectedUpdatedAt: "2020-01-01T00:00:00.000Z", decision: "supported", actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "conflict_current_state_changed");

    const disabled = await recordEvidenceReviewDecision(
      { organizationId: ORG, evidenceItemId: alpha.evidenceItemId, reviewQueueItemId: evidenceQueueItem.review_queue_item_id, expectedUpdatedAt, decision: "supported", actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "false" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(disabled.ok, false);
    assert.equal(disabled.error.code, "feature_disabled");

    const beforeAudit = await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'evidence_review_completed'`);
    const beforeDecisions = await query(`SELECT count(*)::int AS count FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`, [ORG, alpha.evidenceItemId]);
    const auditFailure = await recordEvidenceReviewDecision(
      { organizationId: ORG, evidenceItemId: alpha.evidenceItemId, reviewQueueItemId: evidenceQueueItem.review_queue_item_id, expectedUpdatedAt, decision: "supported", actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder({ rejectPublish: true }) },
    );
    assert.equal(auditFailure.ok, false);
    const afterFailureAudit = await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'evidence_review_completed'`);
    assert.equal(afterFailureAudit[0].count, beforeAudit[0].count);
    const afterFailureDecisions = await query(`SELECT count(*)::int AS count FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`, [ORG, alpha.evidenceItemId]);
    assert.equal(afterFailureDecisions[0].count, beforeDecisions[0].count);
    const rolledBackEvidence = (await query(`SELECT support_strength FROM kai.evidence_items WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`, [ORG, alpha.evidenceItemId]))[0];
    assert.equal(rolledBackEvidence.support_strength, "unassessed");
    const rolledBackQueueRow = (await query(`SELECT queue_status, review_status FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [evidenceQueueItem.review_queue_item_id]))[0];
    assert.equal(rolledBackQueueRow.queue_status, "open");
    assert.equal(rolledBackQueueRow.review_status, "needs_gk_review");

    const result = await recordEvidenceReviewDecision(
      { organizationId: ORG, evidenceItemId: alpha.evidenceItemId, reviewQueueItemId: evidenceQueueItem.review_queue_item_id, expectedUpdatedAt, decision: "supported", actorContext: adminActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.queue_status, "resolved");
    assert.equal(result.data.review_status, "resolved");
    assert.equal(result.data.support_strength, "reviewed_supported");
    assert.equal(result.data.decision_outcome, "supported");
    assert.ok(result.data.decision_id);
    assert.equal(result.data.replayed, false);

    const evidenceRow = (await query(`SELECT support_strength, evidence_review_status FROM kai.evidence_items WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`, [ORG, alpha.evidenceItemId]))[0];
    assert.equal(evidenceRow.support_strength, "reviewed_supported");
    assert.equal(evidenceRow.evidence_review_status, "reviewed");

    const afterAudit = await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'evidence_review_completed'`);
    assert.equal(afterAudit[0].count, beforeAudit[0].count + 1);

    const traced = await trace(alpha.claimId);
    assert.equal(traced.ok, true);
    assert.ok(!traced.data.blockerCodes.includes("evidence_review_unresolved"));
    assert.ok(traced.data.blockerCodes.includes("claim_review_unresolved"));
    assert.ok(traced.data.blockerCodes.includes("support_strength_unassessed"));

    const replay = await recordEvidenceReviewDecision(
      { organizationId: ORG, evidenceItemId: alpha.evidenceItemId, reviewQueueItemId: evidenceQueueItem.review_queue_item_id, expectedUpdatedAt, decision: "supported", actorContext: reviewerActor, now: LATER },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);

    const decisionRows = await query(`SELECT decision_id FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`, [ORG, alpha.evidenceItemId]);
    assert.equal(decisionRows.length, 1);

    // Append-only proof: a direct UPDATE/DELETE against the decision row is rejected.
    await assert.rejects(query(`UPDATE kai.evidence_review_decisions SET decision_outcome = 'not_supported' WHERE decision_id = $1::uuid`, [decisionRows[0].decision_id]), /append-only/);
    await assert.rejects(query(`DELETE FROM kai.evidence_review_decisions WHERE decision_id = $1::uuid`, [decisionRows[0].decision_id]), /append-only/);

    // Non-human/system actor cannot produce a decision row at the DB level.
    await assert.rejects(query(
      `INSERT INTO kai.evidence_review_decisions (organization_id, evidence_item_id, review_queue_item_id, decision_outcome, decided_by, decided_by_role, target_updated_at, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'supported', $4::uuid, 'gk_reviewer', now(), 'system')`,
      [ORG, alpha.evidenceItemId, evidenceQueueItem.review_queue_item_id, reviewerActor.actorUserId],
    ));
  });

  test("P2-09 claim-review/internal-approval requires the linked evidence_review to already be resolved", async () => {
    const [, beta] = await prepareTwoClaims();
    const claimQueueItem = await claimReviewQueueItem(beta.claimId);
    const result = await recordClaimReviewDecision(
      { organizationId: ORG, claimId: beta.claimId, reviewQueueItemId: claimQueueItem.review_queue_item_id, expectedUpdatedAt: new Date(claimQueueItem.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"], actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "evidence_review_unresolved");
  });

  test("P2-09 claim-review/internal-approval completes after evidence review, audits in the same transaction, both blockers clear internally, and funder/public/absent-from-eligible-claims stay fail-closed", async () => {
    const [, beta] = await prepareTwoClaims();

    const evidenceQueueItem = await evidenceReviewQueueItem(beta.evidenceItemId);
    const evidenceResult = await recordEvidenceReviewDecision(
      { organizationId: ORG, evidenceItemId: beta.evidenceItemId, reviewQueueItemId: evidenceQueueItem.review_queue_item_id, expectedUpdatedAt: new Date(evidenceQueueItem.updated_at).toISOString(), decision: "supported", actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceResult.ok, true);

    const claimQueueItem = await claimReviewQueueItem(beta.claimId);
    const expectedUpdatedAt = new Date(claimQueueItem.updated_at).toISOString();

    const wrongRole = await recordClaimReviewDecision(
      { organizationId: ORG, claimId: beta.claimId, reviewQueueItemId: claimQueueItem.review_queue_item_id, expectedUpdatedAt, decision: "approved", approvedAudiences: ["internal"], actorContext: operatorActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(wrongRole.ok, false);
    assert.equal(wrongRole.error.code, "authorization_denied");

    const replayed = await recordClaimReviewDecision(
      { organizationId: ORG, claimId: beta.claimId, reviewQueueItemId: "00000000-0000-4000-8000-0000000000ff", expectedUpdatedAt, decision: "approved", approvedAudiences: ["internal"], actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(replayed.ok, false);
    assert.equal(replayed.error.code, "not_found");

    const governanceCeiling = await recordClaimReviewDecision(
      { organizationId: ORG, claimId: beta.claimId, reviewQueueItemId: claimQueueItem.review_queue_item_id, expectedUpdatedAt, decision: "approved", approvedAudiences: ["internal", "funder"], actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(governanceCeiling.ok, false);
    assert.equal(governanceCeiling.error.code, "governance_ceiling_exceeded");
    const noPersistFromCeiling = await query(`SELECT count(*)::int AS count FROM kai.claim_review_decisions WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, beta.claimId]);
    assert.equal(noPersistFromCeiling[0].count, 0);

    const beforeAudit = await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'claim_review_completed_internal_approval'`);
    const claimResult = await recordClaimReviewDecision(
      { organizationId: ORG, claimId: beta.claimId, reviewQueueItemId: claimQueueItem.review_queue_item_id, expectedUpdatedAt, decision: "approved", approvedAudiences: ["internal"], actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimResult.ok, true);
    assert.equal(claimResult.data.queue_status, "resolved");
    assert.equal(claimResult.data.claim_strength, "reviewed_supported");
    assert.deepEqual(claimResult.data.approved_audiences, ["internal"]);

    const claimRow = (await query(`SELECT claim_strength, claim_status, claim_review_status FROM kai.claims WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, beta.claimId]))[0];
    assert.equal(claimRow.claim_strength, "reviewed_supported");
    assert.equal(claimRow.claim_status, "proposed");
    assert.equal(claimRow.claim_review_status, "reviewed");

    const afterAudit = await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'claim_review_completed_internal_approval'`);
    assert.equal(afterAudit[0].count, beforeAudit[0].count + 1);

    const tracedInternal = await trace(beta.claimId, "internal");
    assert.equal(tracedInternal.ok, true);
    assert.ok(!tracedInternal.data.blockerCodes.includes("evidence_review_unresolved"));
    assert.ok(!tracedInternal.data.blockerCodes.includes("claim_review_unresolved"));
    assert.ok(!tracedInternal.data.blockerCodes.includes("support_strength_unassessed"));
    assert.ok(tracedInternal.data.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.ok(!tracedInternal.data.blockerCodes.includes("claim_not_approved_for_requested_audience"));
    assert.equal(tracedInternal.data.eligible, false);

    for (const audience of ["funder", "public"]) {
      const tracedExternal = await trace(beta.claimId, audience);
      assert.equal(tracedExternal.ok, true);
      assert.equal(tracedExternal.data.eligible, false);
    }

    const eligible = await eligibleInternal();
    assert.equal(eligible.ok, true);
    assert.ok(!eligible.data.eligibleClaims.some((row) => row.claimId === beta.claimId));
  });
}
