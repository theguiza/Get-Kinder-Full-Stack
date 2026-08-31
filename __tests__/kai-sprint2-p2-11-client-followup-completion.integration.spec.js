import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_11_CLIENT_FOLLOWUP_COMPLETION_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P2-11 integration suite refused a non-loopback KAI_P2_11_CLIENT_FOLLOWUP_COMPLETION_DATABASE_URL host: ${host}`);
  }
}

test("P2-11 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P2-11 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresClientFollowupCompletionRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P2-11 client-followup-completion integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP211IntegrationSuite();
}

async function runP211IntegrationSuite() {
  const { Pool } = await import("pg");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { createConflictReviewCandidate } = await import("../Backend/kai/services/kaiConflictReviewCandidateService.js");
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { acceptInternalCoverageLimitation } = await import("../Backend/kai/services/kaiCoverageReviewDecisionService.js");
  const { completeClientFollowup } = await import("../Backend/kai/services/kaiClientFollowupCompletionService.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { listEligibleClaimsForAudience } = await import("../Backend/kai/services/kaiEligibleClaimsForAudienceService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { createPostgresConflictReviewCandidateRepository } = await import("../Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js");
  const { createPostgresHumanReviewRepository } = await import("../Backend/kai/dictionary/postgresHumanReviewRepository.js");
  const { createPostgresCoverageReviewDecisionRepository } = await import("../Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js");
  const { createPostgresClientFollowupCompletionRepository } = await import("../Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js");
  const { createPostgresClaimTraceabilityRepository } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");
  const { createPostgresEligibleClaimsForAudienceRepository } = await import("../Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js");

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

  const gkReviewerActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };
  const clientReviewerActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000002",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_reviewer" }],
  };
  const clientAdminActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000003",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }],
  };
  const aiActor = {
    actorType: "ai",
    actorUserId: "90000000-0000-4000-8000-000000000004",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_reviewer" }],
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
  const coverageRepo = createPostgresCoverageReviewDecisionRepository({ runInTransaction: withRunnerOwnedTransaction });
  const clientFollowupRepo = createPostgresClientFollowupCompletionRepository({ runInTransaction: withRunnerOwnedTransaction });
  const traceRepo = createPostgresClaimTraceabilityRepository({ runInTransaction: withRunnerOwnedTransaction });
  const eligibleRepo = createPostgresEligibleClaimsForAudienceRepository({ runInTransaction: withRunnerOwnedTransaction });

  test.after(async () => {
    await pool.end();
  });

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }

  async function trace(claimId, requestedAudience = "internal") {
    return getClaimTraceabilitySummary(
      { organizationId: ORG, claimId, requestedAudience, actorContext: gkReviewerActor },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimTraceabilityRepository: traceRepo },
    );
  }

  async function eligibleFor(requestedAudience) {
    return listEligibleClaimsForAudience(
      { organizationId: ORG, requestedAudience, limit: 25, afterClaimId: null, actorContext: gkReviewerActor },
      { env: { KAI_SPRINT2_ENABLED: "true" }, eligibleClaimsForAudienceRepository: eligibleRepo },
    );
  }

  async function acceptCoverage(claimId, dimensionKey) {
    return acceptInternalCoverageLimitation(
      { organizationId: ORG, claimId, dimensionKey, actorContext: gkReviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, coverageReviewDecisionRepository: coverageRepo, metadataOnlyAudit: auditRecorder() },
    );
  }

  async function completeFollowup(claimId, clientFollowupItemId, expectedUpdatedAt, dependencies = {}) {
    return completeClientFollowup(
      { organizationId: ORG, claimId, clientFollowupItemId, expectedUpdatedAt, actorContext: clientReviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, clientFollowupCompletionRepository: clientFollowupRepo, metadataOnlyAudit: auditRecorder(), ...dependencies },
    );
  }

  async function currentFollowupRows(claimId) {
    return query(
      `SELECT cfi.client_followup_item_id, cfi.dimension_key, cfi.gap_log_item_id, cfi.question_text,
              rq.review_queue_item_id, rq.queue_status, rq.review_status, rq.updated_at
         FROM kai.client_followup_items cfi
         JOIN kai.review_queue_items rq
           ON rq.organization_id = cfi.organization_id
          AND rq.queue_type = 'client_followup'
          AND rq.target_object_type = 'client_followup_item'
          AND rq.target_object_id = cfi.client_followup_item_id
        WHERE cfi.organization_id = $1::uuid
          AND cfi.claim_id = $2::uuid
        ORDER BY cfi.dimension_key ASC`,
      [ORG, claimId],
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
      { organizationId: ORG, sourceVersionId: sourceVersions[0].source_version_id, actorContext: gkReviewerActor, now: NOW },
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
        { organizationId: ORG, evidenceItemId: row.evidence_item_id, actorContext: gkReviewerActor, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: claimRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(claimResult.ok, true);
      const gapResult = await generateClaimGapFollowups(
        { organizationId: ORG, claimId: claimResult.data.claim.claim_id, actorContext: gkReviewerActor, now: NOW },
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
        expectedUpdatedAt: new Date(evidenceQueueRows[0].updated_at).toISOString(), decision: "supported", actorContext: gkReviewerActor, now: NOW,
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
        expectedUpdatedAt: new Date(claimQueueRows[0].updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"], actorContext: gkReviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimResult.ok, true);
  }

  function unresolvedDimensionKeys(traceData) {
    return Object.entries(traceData.dimensions)
      .filter(([, value]) => value.assessment_status === "unresolved")
      .map(([dimensionKey]) => dimensionKey)
      .sort();
  }

  async function completeP2_09AndP2_10(claimId, evidenceItemId) {
    await completeHumanReview(claimId, evidenceItemId);
    const traced = await trace(claimId, "internal");
    assert.equal(traced.ok, true);
    for (const dimensionKey of unresolvedDimensionKeys(traced.data)) {
      const result = await acceptCoverage(claimId, dimensionKey);
      assert.equal(result.ok, true);
    }
  }

  // This test runs FIRST, immediately after the shared two-claim fixture is
  // prepared and before either claim's own P2-09 human review is touched -
  // completeClientFollowup requires no P2-09/P2-10 precondition of its own, so
  // this is a valid point to prove every denied path fails closed with zero
  // mutation.
  test("P2-11 SAFETY: non-human/wrong-role/cross-tenant/wrong-target/disabled all fail closed with zero mutation", async () => {
    const [alpha] = await prepareTwoClaims();
    const followupRows = await currentFollowupRows(alpha.claimId);
    assert.ok(followupRows.length >= 2, "fixture must have at least two current client_followup workflows to prove partial-vs-complete resolution later");
    const target = followupRows[0];
    const expectedUpdatedAt = new Date(target.updated_at).toISOString();

    const nonHuman = await completeClientFollowup(
      { organizationId: ORG, claimId: alpha.claimId, clientFollowupItemId: target.client_followup_item_id, expectedUpdatedAt, actorContext: aiActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, clientFollowupCompletionRepository: clientFollowupRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(nonHuman.ok, false);
    assert.equal(nonHuman.error.code, "authorization_denied");

    const wrongRole = await completeClientFollowup(
      { organizationId: ORG, claimId: alpha.claimId, clientFollowupItemId: target.client_followup_item_id, expectedUpdatedAt, actorContext: gkReviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, clientFollowupCompletionRepository: clientFollowupRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(wrongRole.ok, false);
    assert.equal(wrongRole.error.code, "authorization_denied");

    const wrongRoleClientAdmin = await completeClientFollowup(
      { organizationId: ORG, claimId: alpha.claimId, clientFollowupItemId: target.client_followup_item_id, expectedUpdatedAt, actorContext: clientAdminActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, clientFollowupCompletionRepository: clientFollowupRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(wrongRoleClientAdmin.ok, false);
    assert.equal(wrongRoleClientAdmin.error.code, "authorization_denied");

    const wrongTenant = await completeClientFollowup(
      { organizationId: OTHER_ORG, claimId: alpha.claimId, clientFollowupItemId: target.client_followup_item_id, expectedUpdatedAt, actorContext: clientReviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, clientFollowupCompletionRepository: clientFollowupRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(wrongTenant.ok, false);
    assert.equal(wrongTenant.error.code, "authorization_denied");

    const wrongTarget = await completeFollowup(alpha.claimId, "00000000-0000-4000-8000-00000000dead", expectedUpdatedAt);
    assert.equal(wrongTarget.ok, false);
    assert.equal(wrongTarget.error.code, "not_found");

    const disabled = await completeClientFollowup(
      { organizationId: ORG, claimId: alpha.claimId, clientFollowupItemId: target.client_followup_item_id, expectedUpdatedAt, actorContext: clientReviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "false" }, clientFollowupCompletionRepository: clientFollowupRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(disabled.ok, false);
    assert.equal(disabled.error.code, "feature_disabled");

    const stillFresh = await query(
      `SELECT queue_status, review_status FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'client_followup' AND target_object_id = $2::uuid`,
      [ORG, target.client_followup_item_id],
    );
    assert.equal(stillFresh[0].queue_status, "waiting_on_client", "none of the denied attempts above may mutate the queue row");
    assert.equal(stillFresh[0].review_status, "proposed");
  });

  // P2-05's own createConflictReviewCandidate requires both claims' own
  // claim_review queue item to still read 'needs_gk_review' at creation time
  // (see Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js),
  // so this test runs BEFORE alpha's own P2-09 claim-review is completed by
  // any later test in this file, creates the conflict candidate against beta,
  // then drives beta alone through full P2-09/P2-10/P2-11 completion to prove
  // the independent P2-05 conflict still blocks beta's internal eligibility -
  // never cleared by client-followup completion.
  test("P2-11 CONFLICT: a real unresolved P2-05 potential conflict still blocks internal eligibility even after full P2-09/P2-10/P2-11 completion", async () => {
    const [alpha, beta] = await prepareTwoClaims();

    const conflictResult = await createConflictReviewCandidate(
      { organizationId: ORG, firstClaimId: alpha.claimId, secondClaimId: beta.claimId, actorContext: gkReviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, conflictReviewCandidateRepository: conflictRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(conflictResult.ok, true);

    await completeP2_09AndP2_10(beta.claimId, beta.evidenceItemId);
    const betaFollowupRows = await currentFollowupRows(beta.claimId);
    for (const row of betaFollowupRows) {
      const result = await completeFollowup(beta.claimId, row.client_followup_item_id, new Date(row.updated_at).toISOString());
      assert.equal(result.ok, true);
    }

    const betaTrace = await trace(beta.claimId, "internal");
    assert.equal(betaTrace.ok, true);
    assert.equal(betaTrace.data.eligible, false);
    assert.ok(betaTrace.data.blockerCodes.includes("potential_conflict_review_unresolved"), "a real unresolved P2-05 conflict remains blocking regardless of full P2-09/P2-10/P2-11 completion");
    assert.ok(!betaTrace.data.blockerCodes.includes("client_followup_unresolved"), "client_followup_unresolved was genuinely cleared on beta - the remaining blocker is the independent P2-05 conflict, not P2-11");
    assert.ok(!betaTrace.data.blockerCodes.includes("coverage_dimension_unresolved"));

    const eligibleInternal = await eligibleFor("internal");
    assert.equal(eligibleInternal.ok, true);
    assert.ok(!eligibleInternal.data.eligibleClaims.some((row) => row.claimId === beta.claimId));

    await pool.query(`DELETE FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'conflict_resolution'`, [ORG]);
    await pool.query(`DELETE FROM kai.conflict_groups WHERE organization_id = $1::uuid`, [ORG]);
  });

  test("P2-11 BEFORE: after P2-09 review and full P2-10 coverage acceptance, client_followup_unresolved is the ONLY remaining internal blocker, and P2-08 omits the claim", async () => {
    const [alpha] = await prepareTwoClaims();
    await completeP2_09AndP2_10(alpha.claimId, alpha.evidenceItemId);

    const before = await trace(alpha.claimId, "internal");
    assert.equal(before.ok, true);
    assert.equal(before.data.eligible, false);
    assert.deepEqual(before.data.blockerCodes, ["client_followup_unresolved"]);

    const followupRows = await currentFollowupRows(alpha.claimId);
    assert.ok(followupRows.every((row) => row.queue_status === "waiting_on_client" && row.review_status === "proposed"));

    const eligibleInternal = await eligibleFor("internal");
    assert.equal(eligibleInternal.ok, true);
    assert.ok(!eligibleInternal.data.eligibleClaims.some((row) => row.claimId === alpha.claimId));
  });

  test("P2-11 audit failure rolls back the fresh queue-row write - zero orphaned mutation", async () => {
    const [alpha] = await prepareTwoClaims();
    const followupRows = await currentFollowupRows(alpha.claimId);
    const target = followupRows[0];
    const expectedUpdatedAt = new Date(target.updated_at).toISOString();

    const rejected = await completeClientFollowup(
      { organizationId: ORG, claimId: alpha.claimId, clientFollowupItemId: target.client_followup_item_id, expectedUpdatedAt, actorContext: clientReviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, clientFollowupCompletionRepository: clientFollowupRepo, metadataOnlyAudit: auditRecorder({ rejectPublish: true }) },
    );
    assert.equal(rejected.ok, false);

    const stillFresh = await query(
      `SELECT queue_status, review_status FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'client_followup' AND target_object_id = $2::uuid`,
      [ORG, target.client_followup_item_id],
    );
    assert.equal(stillFresh[0].queue_status, "waiting_on_client", "a rejected required audit must roll back the fresh queue-row write - no orphaned mutation");
    assert.equal(stillFresh[0].review_status, "proposed");
  });

  test("P2-11 replay: exact replay creates no duplicate mutation or audit - resolves the FIRST of alpha's current client_followup workflows", async () => {
    const [alpha] = await prepareTwoClaims();
    const followupRows = await currentFollowupRows(alpha.claimId);
    const target = followupRows[0];
    const expectedUpdatedAt = new Date(target.updated_at).toISOString();

    const beforeAuditCount = (await query(
      `SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'client_followup_completed'`,
    ))[0].count;

    const first = await completeFollowup(alpha.claimId, target.client_followup_item_id, expectedUpdatedAt);
    assert.equal(first.ok, true);
    assert.equal(first.data.replayed, false);
    assert.equal(first.data.queue_status, "resolved");
    assert.equal(first.data.review_status, "resolved");
    assert.equal(first.data.disposition, "no_additional_client_information");

    const replay = await completeFollowup(alpha.claimId, target.client_followup_item_id, expectedUpdatedAt);
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);

    const secondReplay = await completeFollowup(alpha.claimId, target.client_followup_item_id, expectedUpdatedAt);
    assert.equal(secondReplay.ok, true);
    assert.equal(secondReplay.data.replayed, true);

    const afterAuditCount = (await query(
      `SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'client_followup_completed'`,
    ))[0].count;
    assert.equal(afterAuditCount, beforeAuditCount + 1, "exact replay must never create a duplicate audit row");

    const decisionCount = (await query(
      `SELECT count(*)::int AS count FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'client_followup' AND target_object_id = $2::uuid`,
      [ORG, target.client_followup_item_id],
    ))[0].count;
    assert.equal(decisionCount, 1, "exact replay must never create a duplicate queue row");
  });

  test("P2-11 PARTIAL: resolving only some current client_followup workflows still leaves internal ineligible", async () => {
    const [alpha] = await prepareTwoClaims();
    const followupRows = await currentFollowupRows(alpha.claimId);
    assert.ok(followupRows.some((row) => row.queue_status === "resolved"), "the replay test above must have already resolved exactly one workflow");
    assert.ok(followupRows.some((row) => row.queue_status === "waiting_on_client"), "at least one workflow must still be fresh to prove PARTIAL");

    const partial = await trace(alpha.claimId, "internal");
    assert.equal(partial.ok, true);
    assert.equal(partial.data.eligible, false);
    assert.ok(partial.data.blockerCodes.includes("client_followup_unresolved"), "at least one still-open client_followup workflow must keep blocking internal eligibility");

    const eligibleInternal = await eligibleFor("internal");
    assert.equal(eligibleInternal.ok, true);
    assert.ok(!eligibleInternal.data.eligibleClaims.some((row) => row.claimId === alpha.claimId));
  });

  test("P2-11 COMPLETE: an authorized client_reviewer resolving every current client_followup workflow clears client_followup_unresolved - P2-06 internal eligible:true, blockerCodes:[], and P2-08 internal returns the same claim", async () => {
    const [alpha] = await prepareTwoClaims();
    const followupRows = await currentFollowupRows(alpha.claimId);
    for (const row of followupRows) {
      if (row.queue_status === "resolved") continue;
      const result = await completeFollowup(alpha.claimId, row.client_followup_item_id, new Date(row.updated_at).toISOString());
      assert.equal(result.ok, true);
      assert.equal(result.data.replayed, false);
    }

    const full = await trace(alpha.claimId, "internal");
    assert.equal(full.ok, true);
    assert.equal(full.data.eligible, true);
    assert.deepEqual(full.data.blockerCodes, []);

    const eligibleInternal = await eligibleFor("internal");
    assert.equal(eligibleInternal.ok, true);
    assert.ok(eligibleInternal.data.eligibleClaims.some((row) => row.claimId === alpha.claimId), "P2-08 internal must return the same claim P2-06 now reports eligible");
  });

  test("P2-11 TRUTH: P2-02 unresolved dimensions, P2-04 gap rows, and client_followup_items all remain exactly as before - queue items are resolved, never deleted; P2-10 authority remains current; no answer/fact was stored", async () => {
    const [alpha] = await prepareTwoClaims();

    const traced = await trace(alpha.claimId, "internal");
    assert.equal(traced.ok, true);
    for (const [dimensionKey, dimension] of Object.entries(traced.data.dimensions)) {
      if (dimension.internal_limitation_accepted) {
        assert.equal(dimension.assessment_status, "unresolved", `${dimensionKey}: P2-02 automated assessment must never be relabeled by a P2-10 acceptance or a P2-11 workflow disposition`);
      }
    }

    const gapRows = await query(
      `SELECT dimension_key, assessment_status FROM kai.gap_log_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid`,
      [ORG, alpha.claimId],
    );
    assert.ok(gapRows.length > 0, "P2-04 gap rows must still exist - never deleted");
    assert.ok(gapRows.every((row) => row.assessment_status === "unresolved" || row.assessment_status === "resolved_risk_flagged"));

    const followupRows = await currentFollowupRows(alpha.claimId);
    assert.ok(followupRows.length > 0, "client_followup_items rows must still exist - never deleted");
    for (const row of followupRows) {
      assert.equal(row.queue_status, "resolved", "every workflow was resolved by the COMPLETE test above");
      assert.equal(row.review_status, "resolved");
      assert.ok(typeof row.question_text === "string" && row.question_text.length > 0, "the fixed P2-04 question must remain exactly as written");
    }

    const coverageDecisionRows = await query(
      `SELECT dimension_key FROM kai.coverage_review_decisions WHERE organization_id = $1::uuid AND claim_id = $2::uuid`,
      [ORG, alpha.claimId],
    );
    assert.ok(coverageDecisionRows.length > 0, "P2-10 authority rows must remain current and untouched by P2-11");

    const columnRows = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'kai' AND table_name = 'client_followup_items'`,
    );
    assert.ok(!columnRows.some((row) => ["answer", "client_answer", "raw_value", "free_text"].includes(row.column_name)), "no answer/free-text/raw-value column was ever introduced");
  });

  test("P2-11 EXTERNAL: funder/public remain ineligible even after full client_followup completion", async () => {
    const [alpha] = await prepareTwoClaims();
    for (const audience of ["funder", "public"]) {
      const external = await trace(alpha.claimId, audience);
      assert.equal(external.ok, true);
      assert.equal(external.data.eligible, false, "client_followup completion never grants funder/public authority");
      const externalEligible = await eligibleFor(audience);
      assert.equal(externalEligible.ok, true);
      assert.ok(!externalEligible.data.eligibleClaims.some((row) => row.claimId === alpha.claimId));
    }
  });
}
