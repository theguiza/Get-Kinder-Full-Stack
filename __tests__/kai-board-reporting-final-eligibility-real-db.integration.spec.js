// Board final eligibility real-DB proof: drives Board candidate/review/authority
// lifecycle state through the actual repositories/services, then invokes the
// actual evaluateBoardReportingFinalEligibility service against the same
// runner-owned ephemeral PostgreSQL database.

import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_BOARD_FINAL_ELIGIBILITY_REAL_DB_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`Board final eligibility real-DB suite refused a non-loopback database URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("Board final eligibility real-DB integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  try {
    console.log = (...args) => {
      if (args[0] === "[pg] Using remote connection" || args[0] === "[pg] Using remote connection string") return;
      originalConsoleLog(...args);
    };
    console.warn = (...args) => {
      if (typeof args[0] === "string" && args[0].startsWith("[pg] ")) return;
      originalConsoleWarn(...args);
    };
    var {
      createPostgresBoardReportingCandidateRepository,
    } = await import("../Backend/kai/dictionary/postgresBoardReportingCandidateRepository.js");
    var {
      createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository,
    } = await import("../Backend/kai/dictionary/postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js");
    var {
      createBoardReportingCandidate,
      requestBoardReportingCandidateReview,
      startBoardReportingCandidateReview,
      completeBoardReportingCandidateReview,
    } = await import("../Backend/kai/services/kaiBoardReportingCandidateService.js");
    var {
      recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision,
    } = await import("../Backend/kai/services/kaiBoardReportingCandidateHumanFinalReleaseAuthorityService.js");
    var {
      evaluateBoardReportingFinalEligibility,
    } = await import("../Backend/kai/services/kaiBoardReportingFinalEligibilityGateService.js");
    var {
      createProductionMetadataOnlyAuditForBoardReportingCandidate,
      createProductionMetadataOnlyAuditForBoardReportingCandidateHumanFinalReleaseAuthority,
    } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");
  } finally {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
  }

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const ENGAGEMENT = "15100000-0000-4000-8000-000000000101";
  const OTHER_ENGAGEMENT = "15100000-0000-4000-8000-000000000102";
  const DRAFT_A = "15100000-0000-4000-8000-000000000201";
  const DRAFT_B = "15100000-0000-4000-8000-000000000202";
  const MISSING_CANDIDATE = "15100000-0000-4000-8000-000000000999";
  const ACTOR_ID = "90000000-0000-4000-8000-000000000001";
  const ACTOR = Object.freeze({
    actorType: "human",
    actorUserId: ACTOR_ID,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  });
  const ENABLED_ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
  const CREATE_NOW = "2026-09-12T12:00:00.000Z";
  const REQUEST_NOW = "2026-09-12T12:05:00.000Z";
  const START_NOW = "2026-09-12T13:00:00.000Z";
  const COMPLETE_NOW = "2026-09-12T14:00:00.000Z";
  const GRANT_NOW = "2026-09-12T15:00:00.000Z";
  const REVOKE_NOW = "2026-09-12T16:00:00.000Z";
  const REGRANT_NOW = "2026-09-12T17:00:00.000Z";

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 5 });

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

  const candidateRepository = createPostgresBoardReportingCandidateRepository({ runInTransaction: withRunnerOwnedTransaction });
  const authorityRepository = createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({ runInTransaction: withRunnerOwnedTransaction });

  function candidateAudit(now) {
    return createProductionMetadataOnlyAuditForBoardReportingCandidate({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      actorContext: ACTOR,
      now,
    });
  }

  function authorityAudit(now) {
    return createProductionMetadataOnlyAuditForBoardReportingCandidateHumanFinalReleaseAuthority({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      actorContext: ACTOR,
      now,
    });
  }

  function citation(index) {
    return {
      claimId: `15100000-0000-4000-8000-0000000003${index}1`,
      evidenceItemId: `15100000-0000-4000-8000-0000000003${index}2`,
      sourceId: `15100000-0000-4000-8000-0000000003${index}3`,
      sourceVersionId: `15100000-0000-4000-8000-0000000003${index}4`,
      generatedContentCitationId: `15100000-0000-4000-8000-0000000003${index}5`,
      supportStrength: "strong",
      claimReviewStatus: "approved",
      evidenceReviewStatus: "approved",
      currentEligible: true,
      blockerCodes: [],
      affectedDimensionKeys: [],
      affectedObjectIds: [],
    };
  }

  function renderModel({ stale = false } = {}) {
    return {
      ok: true,
      data: {
        renderModelContractVersion: "kai-sprint2-board-reporting-render-model-v1",
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        packetAudience: "internal",
        supportedContentTypes: ["evidence_summary", "impact_narrative"],
        members: [DRAFT_A, DRAFT_B].map((draftId, index) => ({
          generationRunId: `15100000-0000-4000-8000-0000000001${index}1`,
          generatedContentDraftId: draftId,
          contentType: index === 0 && stale ? "impact_narrative" : (index % 2 === 0 ? "evidence_summary" : "impact_narrative"),
          draftStatus: "draft",
          requestedAudience: "internal",
          reviewQueueItemId: `15100000-0000-4000-8000-0000000004${index}1`,
          queueStatus: "resolved",
          reviewStatus: "resolved",
          reviewUpdatedAt: CREATE_NOW,
          currentUseEligible: true,
          blocks: [{
            ordinal: 0,
            generatedContentBlockId: `15100000-0000-4000-8000-0000000005${index}1`,
            text: "not stored in Board final eligibility real-DB proof",
            citations: [citation(index)],
          }],
        })),
      },
      error: null,
    };
  }

  let currentRenderModelStale = false;
  const composeRenderModel = async () => renderModel({ stale: currentRenderModelStale });

  await withRunnerOwnedTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO kai.organizations (organization_id, name, organization_code)
       VALUES ($1::uuid, 'Board Final Eligibility Org', 'board-final-eligibility-org'),
              ($2::uuid, 'Board Final Eligibility Other Org', 'board-final-eligibility-other-org')
       ON CONFLICT (organization_id) DO NOTHING`,
      [ORG, OTHER_ORG],
    );
    await tx.query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
       VALUES ($1::uuid, $2::uuid, 'board-final-eligibility-engagement'),
              ($3::uuid, $2::uuid, 'board-final-eligibility-other-engagement')
       ON CONFLICT (engagement_id) DO NOTHING`,
      [ENGAGEMENT, ORG, OTHER_ENGAGEMENT],
    );
    for (const [index, draftId] of [DRAFT_A, DRAFT_B].entries()) {
      const runId = `15100000-0000-4000-8000-0000000001${index}1`;
      await tx.query(
        `INSERT INTO kai.generation_runs (
           generation_run_id, organization_id, idempotency_key, request_fingerprint,
           content_type, requested_audience, engagement_id
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'internal', $6::uuid)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [runId, ORG, `board-final-eligibility-run-${draftId}`, "a".repeat(64), index % 2 === 0 ? "evidence_summary" : "impact_narrative", ENGAGEMENT],
      );
      await tx.query(
        `INSERT INTO kai.generated_content_drafts (
           generated_content_draft_id, generation_run_id, organization_id,
           content_type, requested_audience, validator_results
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'internal', '[]'::jsonb)
         ON CONFLICT (generated_content_draft_id) DO NOTHING`,
        [draftId, runId, ORG, index % 2 === 0 ? "evidence_summary" : "impact_narrative"],
      );
    }
  });

  test.after(async () => {
    await pool.end();
  });

  async function createCandidate(idempotencyKey, now = CREATE_NOW) {
    const result = await createBoardReportingCandidate({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      idempotencyKey,
      actorContext: ACTOR,
      now,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateRepository: candidateRepository,
      metadataOnlyAudit: candidateAudit(now),
      composeRenderModel,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.memberCount, 2);
    return {
      candidateId: result.data.boardReportingCandidateId,
      fingerprint: result.data.canonicalFingerprint,
    };
  }

  async function requestReview(candidateId, now = REQUEST_NOW) {
    const requested = await requestBoardReportingCandidateReview({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: candidateId,
      actorContext: ACTOR,
      now,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateRepository: candidateRepository,
      metadataOnlyAudit: candidateAudit(now),
    });
    assert.equal(requested.ok, true, JSON.stringify(requested));
    return requested.data.reviewQueueItemId;
  }

  async function startReview(candidateId, reviewQueueItemId, now = START_NOW) {
    const requestRow = await pool.query(
      `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [reviewQueueItemId],
    );
    const started = await startBoardReportingCandidateReview({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: candidateId,
      reviewQueueItemId,
      expectedUpdatedAt: requestRow.rows[0].updated_at.toISOString(),
      actorContext: ACTOR,
      now,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateRepository: candidateRepository,
      metadataOnlyAudit: candidateAudit(now),
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    return started;
  }

  async function completeReview(candidateId, reviewQueueItemId, now = COMPLETE_NOW) {
    const startRow = await pool.query(
      `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [reviewQueueItemId],
    );
    const completed = await completeBoardReportingCandidateReview({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: candidateId,
      reviewQueueItemId,
      expectedUpdatedAt: startRow.rows[0].updated_at.toISOString(),
      actorContext: ACTOR,
      now,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateRepository: candidateRepository,
      metadataOnlyAudit: candidateAudit(now),
    });
    assert.equal(completed.ok, true, JSON.stringify(completed));
    assert.equal(completed.data.queueStatus, "resolved");
    assert.equal(completed.data.reviewStatus, "resolved");
    return completed;
  }

  async function resolveReview(candidateId) {
    const reviewQueueItemId = await requestReview(candidateId);
    await startReview(candidateId, reviewQueueItemId);
    await completeReview(candidateId, reviewQueueItemId);
    return reviewQueueItemId;
  }

  async function recordAuthority(candidateId, reviewQueueItemId, decisionAction, now) {
    const result = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: candidateId,
      reviewQueueItemId,
      decisionAction,
      actorContext: ACTOR,
      now,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository,
      metadataOnlyAudit: authorityAudit(now),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result;
  }

  function evaluate(candidateId, overrides = {}) {
    return evaluateBoardReportingFinalEligibility({
      organizationId: overrides.organizationId || ORG,
      engagementId: overrides.engagementId || ENGAGEMENT,
      boardReportingCandidateId: candidateId,
      actorContext: overrides.actorContext || ACTOR,
    }, {
      candidateRepository,
      authorityRepository,
      composeRenderModel,
    });
  }

  async function snapshot(candidateId, reviewQueueItemId = null) {
    const rows = await pool.query(
      `SELECT
         (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.board_reporting_candidate_id)
            FROM kai.board_reporting_candidates c
           WHERE c.board_reporting_candidate_id = $1::uuid) AS candidates,
         (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.ordinal)
            FROM kai.board_reporting_candidate_members m
           WHERE m.board_reporting_candidate_id = $1::uuid) AS members,
         (SELECT jsonb_agg(m.ordinal ORDER BY m.ordinal)
            FROM kai.board_reporting_candidate_members m
           WHERE m.board_reporting_candidate_id = $1::uuid) AS member_ordinals,
         (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.review_queue_item_id)
            FROM kai.review_queue_items r
           WHERE ($2::uuid IS NOT NULL AND r.review_queue_item_id = $2::uuid)
              OR ($2::uuid IS NULL AND r.queue_type = 'board_reporting_candidate_review' AND r.target_object_id = $1::uuid)) AS reviews,
         (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.decision_id)
            FROM kai.board_reporting_candidate_human_authority_decisions d
           WHERE d.board_reporting_candidate_id = $1::uuid) AS authority,
         (SELECT count(*)::int FROM kai.board_reporting_candidates) AS all_candidate_count,
         (SELECT count(*)::int FROM kai.board_reporting_candidate_members) AS all_member_count,
         (SELECT count(*)::int FROM kai.review_queue_items WHERE queue_type = 'board_reporting_candidate_review') AS board_review_count,
         (SELECT count(*)::int FROM kai.board_reporting_candidate_human_authority_decisions) AS authority_count,
         (SELECT count(*)::int FROM kai.export_manifests) AS export_manifest_count,
         (SELECT to_regclass('kai.grant_response_packet_export_manifests') IS NOT NULL) AS grant_manifest_table_exists,
         (SELECT count(*)::int
            FROM information_schema.tables
           WHERE table_schema = 'kai'
             AND table_name LIKE '%delivery%') AS delivery_table_count`,
      [candidateId, reviewQueueItemId],
    );
    return rows.rows[0];
  }

  function assertNoGateMutation(before, after) {
    assert.deepEqual(after.candidates, before.candidates, "candidate changed during gate evaluation");
    assert.deepEqual(after.members, before.members, "members changed during gate evaluation");
    assert.deepEqual(after.member_ordinals, before.member_ordinals, "member ordinals changed during gate evaluation");
    assert.deepEqual(after.reviews, before.reviews, "review changed during gate evaluation");
    assert.deepEqual(after.authority, before.authority, "authority history changed during gate evaluation");
    assert.equal(after.all_candidate_count, before.all_candidate_count, "replacement candidate created during gate evaluation");
    assert.equal(after.all_member_count, before.all_member_count, "candidate member side effect");
    assert.equal(after.board_review_count, before.board_review_count, "review side effect");
    assert.equal(after.authority_count, before.authority_count, "authority side effect");
    assert.equal(after.export_manifest_count, before.export_manifest_count, "export manifest side effect");
    assert.equal(after.grant_manifest_table_exists, before.grant_manifest_table_exists, "grant manifest table changed");
    assert.equal(after.delivery_table_count, before.delivery_table_count, "delivery side effect");
  }

  await test("Board final eligibility real Postgres: current GRANT passes, stale currentness fails independently, negatives fail closed, and gate evaluation is read-only", async () => {
    currentRenderModelStale = false;
    const main = await createCandidate("board-final-eligibility-candidate");
    const mainReview = await resolveReview(main.candidateId);

    const grant = await recordAuthority(main.candidateId, mainReview, "grant", GRANT_NOW);
    assert.equal(grant.data.effective, true);

    const beforeGrantGate = await snapshot(main.candidateId, mainReview);
    const grantGate = await evaluate(main.candidateId);
    const afterGrantGate = await snapshot(main.candidateId, mainReview);
    assertNoGateMutation(beforeGrantGate, afterGrantGate);
    assert.equal(grantGate.ok, true, JSON.stringify(grantGate));
    assert.equal(grantGate.data.candidateGate.contractValid, true);
    assert.equal(grantGate.data.reviewGate.resolved, true);
    assert.equal(grantGate.data.authorityGate.effective, true);
    assert.equal(grantGate.data.currentnessGate.current, true);
    assert.equal(grantGate.data.freshFingerprint, main.fingerprint);
    assert.equal(grantGate.data.candidateFingerprint, main.fingerprint);
    assert.equal(grantGate.data.finalEligibility, true);
    assert.deepEqual(grantGate.data.failedGates, []);

    const revoke = await recordAuthority(main.candidateId, mainReview, "revoke", REVOKE_NOW);
    assert.equal(revoke.data.effective, false);
    const beforeRevokeGate = await snapshot(main.candidateId, mainReview);
    const revokeGate = await evaluate(main.candidateId);
    const afterRevokeGate = await snapshot(main.candidateId, mainReview);
    assertNoGateMutation(beforeRevokeGate, afterRevokeGate);
    assert.equal(revokeGate.data.authorityGate.effective, false);
    assert.equal(revokeGate.data.authorityGate.reason, "head_is_revoke");
    assert.equal(revokeGate.data.currentnessGate.current, true);
    assert.equal(revokeGate.data.finalEligibility, false);
    assert.ok(revokeGate.data.failedGates.includes("human_release_authority_revoked"));

    const regrant = await recordAuthority(main.candidateId, mainReview, "grant", REGRANT_NOW);
    assert.equal(regrant.data.effective, true);
    const beforeRegrantGate = await snapshot(main.candidateId, mainReview);
    const regrantGate = await evaluate(main.candidateId);
    const afterRegrantGate = await snapshot(main.candidateId, mainReview);
    assertNoGateMutation(beforeRegrantGate, afterRegrantGate);
    assert.equal(regrantGate.data.authorityGate.effective, true);
    assert.equal(regrantGate.data.currentnessGate.current, true);
    assert.equal(regrantGate.data.freshFingerprint, regrantGate.data.candidateFingerprint);
    assert.equal(regrantGate.data.finalEligibility, true);

    assert.equal(regrantGate.data.freshFingerprint, main.fingerprint);
    await withRunnerOwnedTransaction(async (tx) => {
      await tx.query(
        `UPDATE kai.generated_content_drafts
            SET content_type = 'impact_narrative'
          WHERE organization_id = $1::uuid
            AND generated_content_draft_id = $2::uuid`,
        [ORG, DRAFT_A],
      );
      await tx.query(
        `UPDATE kai.generation_runs
            SET content_type = 'impact_narrative'
          WHERE organization_id = $1::uuid
            AND generation_run_id = $2::uuid`,
        [ORG, "15100000-0000-4000-8000-000000000101"],
      );
    });
    currentRenderModelStale = true;

    const beforeStaleGate = await snapshot(main.candidateId, mainReview);
    const staleGate = await evaluate(main.candidateId);
    const afterStaleGate = await snapshot(main.candidateId, mainReview);
    assertNoGateMutation(beforeStaleGate, afterStaleGate);
    assert.equal(staleGate.ok, true, JSON.stringify(staleGate));
    assert.equal(staleGate.data.candidateGate.contractValid, true);
    assert.equal(staleGate.data.reviewGate.resolved, true);
    assert.equal(staleGate.data.authorityGate.effective, true);
    assert.equal(staleGate.data.currentnessGate.current, false);
    assert.equal(staleGate.data.currentnessGate.stale, true);
    assert.notEqual(staleGate.data.freshFingerprint, main.fingerprint);
    assert.equal(staleGate.data.candidateFingerprint, main.fingerprint);
    assert.equal(staleGate.data.finalEligibility, false);
    assert.deepEqual(staleGate.data.failedGates, ["board_reporting_candidate_stale"]);

    currentRenderModelStale = false;
    await withRunnerOwnedTransaction(async (tx) => {
      await tx.query(
        `UPDATE kai.generated_content_drafts
            SET content_type = 'evidence_summary'
          WHERE organization_id = $1::uuid
            AND generated_content_draft_id = $2::uuid`,
        [ORG, DRAFT_A],
      );
      await tx.query(
        `UPDATE kai.generation_runs
            SET content_type = 'evidence_summary'
          WHERE organization_id = $1::uuid
            AND generation_run_id = $2::uuid`,
        [ORG, "15100000-0000-4000-8000-000000000101"],
      );
    });

    const missingCandidate = await evaluate(MISSING_CANDIDATE);
    assert.equal(missingCandidate.ok, false);
    assert.equal(missingCandidate.error.code, "not_found");

    const wrongOrg = await evaluate(main.candidateId, { organizationId: OTHER_ORG });
    assert.equal(wrongOrg.ok, false);
    assert.equal(wrongOrg.error.code, "not_found");

    const wrongEngagement = await evaluate(main.candidateId, { engagementId: OTHER_ENGAGEMENT });
    assert.equal(wrongEngagement.ok, false);
    assert.equal(wrongEngagement.error.code, "not_found");

    const noReview = await createCandidate("board-final-eligibility-no-review");
    const requestOnly = await createCandidate("board-final-eligibility-request-only");
    await requestReview(requestOnly.candidateId);
    const startOnly = await createCandidate("board-final-eligibility-start-only");
    const startOnlyReview = await requestReview(startOnly.candidateId);
    await startReview(startOnly.candidateId, startOnlyReview, "2026-09-12T13:05:00.000Z");
    const noAuthority = await createCandidate("board-final-eligibility-no-authority");
    await resolveReview(noAuthority.candidateId);
    const revoked = await createCandidate("board-final-eligibility-revoked");
    const revokedReview = await resolveReview(revoked.candidateId);
    await recordAuthority(revoked.candidateId, revokedReview, "grant", "2026-09-12T15:05:00.000Z");
    await recordAuthority(revoked.candidateId, revokedReview, "revoke", "2026-09-12T16:05:00.000Z");
    const malformedReviewBinding = await createCandidate("board-final-eligibility-wrong-review-binding");
    await pool.query(
      `INSERT INTO kai.review_queue_items (
         organization_id, engagement_id, queue_type, target_object_type, target_object_id,
         priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
       )
       VALUES (
         $1::uuid, $2::uuid, 'board_reporting_candidate_review', 'board_reporting_candidate',
         $3::uuid, 'medium', 'resolved', 'resolved', 'Board Reporting candidate requires review.',
         'Review internal Board packet membership and current-use support before release work.', '{}'::jsonb, 'system'
       )`,
      [ORG, OTHER_ENGAGEMENT, malformedReviewBinding.candidateId],
    );

    const negativeBefore = await snapshot(main.candidateId, mainReview);
    const noReviewGate = await evaluate(noReview.candidateId);
    const requestOnlyGate = await evaluate(requestOnly.candidateId);
    const startOnlyGate = await evaluate(startOnly.candidateId);
    const wrongReviewBindingGate = await evaluate(malformedReviewBinding.candidateId);
    const noAuthorityGate = await evaluate(noAuthority.candidateId);
    const revokedGate = await evaluate(revoked.candidateId);
    const negativeAfter = await snapshot(main.candidateId, mainReview);
    assertNoGateMutation(negativeBefore, negativeAfter);

    assert.equal(noReviewGate.ok, true);
    assert.equal(noReviewGate.data.reviewGate.resolved, false);
    assert.equal(noReviewGate.data.finalEligibility, false);
    assert.ok(noReviewGate.data.failedGates.includes("board_reporting_candidate_review_unresolved"));
    assert.equal(requestOnlyGate.ok, true);
    assert.equal(requestOnlyGate.data.reviewGate.queueStatus, "open");
    assert.equal(requestOnlyGate.data.finalEligibility, false);
    assert.equal(startOnlyGate.ok, true);
    assert.equal(startOnlyGate.data.reviewGate.queueStatus, "in_progress");
    assert.equal(startOnlyGate.data.finalEligibility, false);
    assert.equal(wrongReviewBindingGate.ok, false);
    assert.equal(wrongReviewBindingGate.error.code, "conflict_current_state_changed");
    assert.equal(noAuthorityGate.ok, true);
    assert.equal(noAuthorityGate.data.authorityGate.reason, "no_decision");
    assert.equal(noAuthorityGate.data.finalEligibility, false);
    assert.ok(noAuthorityGate.data.failedGates.includes("human_release_authority_absent"));
    assert.equal(revokedGate.ok, true);
    assert.equal(revokedGate.data.authorityGate.reason, "head_is_revoke");
    assert.equal(revokedGate.data.finalEligibility, false);
    assert.ok(revokedGate.data.failedGates.includes("human_release_authority_revoked"));

    console.log(`TOOL_VERIFIED grantEligibility=${grantGate.data.finalEligibility}`);
    console.log(`TOOL_VERIFIED revokeEligibility=${revokeGate.data.finalEligibility}`);
    console.log(`TOOL_VERIFIED regrantEligibility=${regrantGate.data.finalEligibility}`);
    console.log(`TOOL_VERIFIED freshFingerprintBeforeEqualsCandidate=${regrantGate.data.freshFingerprint === main.fingerprint}`);
    console.log(`TOOL_VERIFIED staleFreshFingerprintDiffers=${staleGate.data.freshFingerprint !== main.fingerprint}`);
    console.log(`TOOL_VERIFIED staleGates candidate=${staleGate.data.candidateGate.contractValid} review=${staleGate.data.reviewGate.resolved} authority=${staleGate.data.authorityGate.effective} current=${staleGate.data.currentnessGate.current} final=${staleGate.data.finalEligibility}`);
    console.log(`TOOL_VERIFIED negatives missing=${missingCandidate.error.code} wrongOrg=${wrongOrg.error.code} wrongEngagement=${wrongEngagement.error.code} noReview=${noReviewGate.data.finalEligibility} requestOnly=${requestOnlyGate.data.finalEligibility} startOnly=${startOnlyGate.data.finalEligibility} wrongReviewBinding=${wrongReviewBindingGate.error.code} noAuthority=${noAuthorityGate.data.finalEligibility} revoked=${revokedGate.data.finalEligibility}`);
    console.log("TOOL_VERIFIED CROSS_TENANT_GATE=UPSTREAM_BOUNDARY");
    console.log("TOOL_VERIFIED gateReadOnly candidate=NO candidateFingerprint=NO members=NO memberOrdinals=NO review=NO authorityChangedByGate=NO manifest=NO delivery=NO replacementCandidate=NO");
    console.log(`TOOL_VERIFIED boardManifestPersistence=${afterStaleGate.grant_manifest_table_exists ? "GRANT_ONLY_TABLE_EXISTS" : "NO_BOARD_MANIFEST_TABLE"} deliveryTables=${afterStaleGate.delivery_table_count}`);
  });
}
