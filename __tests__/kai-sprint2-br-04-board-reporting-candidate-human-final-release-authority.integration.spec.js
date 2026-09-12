// BR-04 real-DB lifecycle proof: create -> request -> START -> COMPLETE
// through the actual postgresBoardReportingCandidateRepository.js, then
// GRANT -> read -> identical GRANT replay -> REVOKE -> read -> identical
// REVOKE replay through the actual
// kaiBoardReportingCandidateHumanFinalReleaseAuthorityService.js +
// postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js, against
// the runner-owned synthetic PostgreSQL database - not raw SQL, and not the
// fully mocked kai-sprint2-br-04-board-reporting-candidate-human-final-release-authority.spec.js.
// Mirrors the existing kai-sprint2-p3-17-real-authority-write.integration.spec.js
// and kai-sprint2-br-03b-board-reporting-candidate-review-lifecycle.integration.spec.js
// pattern.

import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_BR_04_BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`BR-04 real-authority-write suite refused a non-loopback KAI_BR_04_BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("BR-04 board-reporting-candidate human final-release authority real-DB integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const {
    createPostgresBoardReportingCandidateRepository,
  } = await import("../Backend/kai/dictionary/postgresBoardReportingCandidateRepository.js");
  const {
    createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository,
  } = await import("../Backend/kai/dictionary/postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js");
  const {
    recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision,
  } = await import("../Backend/kai/services/kaiBoardReportingCandidateHumanFinalReleaseAuthorityService.js");
  const {
    createProductionMetadataOnlyAuditForBoardReportingCandidate,
    createProductionMetadataOnlyAuditForBoardReportingCandidateHumanFinalReleaseAuthority,
  } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const ENGAGEMENT = "15040000-0000-4000-8000-000000000101";
  const DRAFT_A = "15040000-0000-4000-8000-000000000201";
  const DRAFT_B = "15040000-0000-4000-8000-000000000202";
  const ACTOR_ID = "90000000-0000-4000-8000-000000000001";
  const ACTOR = Object.freeze({ actorType: "human", actorUserId: ACTOR_ID });
  const GK_ADMIN_ACTOR = Object.freeze({
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
  const GRANT_REPLAY_NOW = "2026-09-12T15:05:00.000Z";
  const REVOKE_NOW = "2026-09-12T16:00:00.000Z";
  const REVOKE_REPLAY_NOW = "2026-09-12T16:05:00.000Z";

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
      actorContext: GK_ADMIN_ACTOR,
      now,
    });
  }

  function citation(index) {
    return {
      claimId: `15040000-0000-4000-8000-0000000003${index}1`,
      evidenceItemId: `15040000-0000-4000-8000-0000000003${index}2`,
      sourceId: `15040000-0000-4000-8000-0000000003${index}3`,
      sourceVersionId: `15040000-0000-4000-8000-0000000003${index}4`,
      generatedContentCitationId: `15040000-0000-4000-8000-0000000003${index}5`,
      supportStrength: "strong",
      claimReviewStatus: "approved",
      evidenceReviewStatus: "approved",
      currentEligible: true,
      blockerCodes: [],
      affectedDimensionKeys: [],
      affectedObjectIds: [],
    };
  }

  function renderModel() {
    return {
      ok: true,
      data: {
        renderModelContractVersion: "kai-sprint2-board-reporting-render-model-v1",
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        packetAudience: "internal",
        supportedContentTypes: ["evidence_summary", "impact_narrative"],
        members: [DRAFT_A, DRAFT_B].map((draftId, index) => ({
          generationRunId: `15040000-0000-4000-8000-0000000001${index}1`,
          generatedContentDraftId: draftId,
          contentType: index % 2 === 0 ? "evidence_summary" : "impact_narrative",
          draftStatus: "draft",
          requestedAudience: "internal",
          reviewQueueItemId: `15040000-0000-4000-8000-0000000004${index}1`,
          queueStatus: "resolved",
          reviewStatus: "resolved",
          reviewUpdatedAt: CREATE_NOW,
          currentUseEligible: true,
          blocks: [{
            ordinal: 0,
            generatedContentBlockId: `15040000-0000-4000-8000-0000000005${index}1`,
            text: "not stored in BR-04 real-DB lifecycle proof",
            citations: [citation(index)],
          }],
        })),
      },
      error: null,
    };
  }

  await withRunnerOwnedTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO kai.organizations (organization_id, name, organization_code)
       VALUES ($1::uuid, 'BR-04 Real-Write Org', 'br-04-real-write-org') ON CONFLICT (organization_id) DO NOTHING`,
      [ORG],
    );
    await tx.query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
       VALUES ($1::uuid, $2::uuid, 'br-04-real-write-engagement') ON CONFLICT (engagement_id) DO NOTHING`,
      [ENGAGEMENT, ORG],
    );
    for (const [index, draftId] of [DRAFT_A, DRAFT_B].entries()) {
      const runId = `15040000-0000-4000-8000-0000000001${index}1`;
      await tx.query(
        `INSERT INTO kai.generation_runs (
           generation_run_id, organization_id, idempotency_key, request_fingerprint, content_type, requested_audience, engagement_id
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'internal', $6::uuid)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [runId, ORG, `br-04-real-write-run-${draftId}`, "a".repeat(64), index % 2 === 0 ? "evidence_summary" : "impact_narrative", ENGAGEMENT],
      );
      await tx.query(
        `INSERT INTO kai.generated_content_drafts (
           generated_content_draft_id, generation_run_id, organization_id, content_type, requested_audience, validator_results
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

  await test("BR-04 real Postgres: create -> request -> START -> COMPLETE -> GRANT -> replay -> REVOKE -> replay, end to end through the actual repository/service path", async () => {
    // --- create (immutable Board candidate) ---
    const created = await candidateRepository.createBoardReportingCandidate(
      { organizationId: ORG, engagementId: ENGAGEMENT, idempotencyKey: "br-04-real-write-candidate", actorContext: ACTOR, now: CREATE_NOW },
      { metadataOnlyAudit: candidateAudit(CREATE_NOW), composeRenderModel: async () => renderModel() },
    );
    assert.equal(created.ok, true, JSON.stringify(created));
    const CANDIDATE = created.data.boardReportingCandidateId;
    const CANONICAL_FINGERPRINT = created.data.canonicalFingerprint;
    assert.deepEqual(created.data.memberGeneratedContentDraftIds, [DRAFT_A, DRAFT_B]);

    const candidateSnapshot = async () => {
      const candidateRows = await pool.query(
        `SELECT canonical_fingerprint, candidate_status, packet_audience, created_at
           FROM kai.board_reporting_candidates
          WHERE board_reporting_candidate_id = $1::uuid`,
        [CANDIDATE],
      );
      const memberRows = await pool.query(
        `SELECT generated_content_draft_id::text AS draft_id, ordinal
           FROM kai.board_reporting_candidate_members
          WHERE board_reporting_candidate_id = $1::uuid
          ORDER BY ordinal`,
        [CANDIDATE],
      );
      return { candidate: candidateRows.rows[0], members: memberRows.rows };
    };
    const beforeLifecycle = await candidateSnapshot();
    assert.equal(beforeLifecycle.candidate.canonical_fingerprint, CANONICAL_FINGERPRINT);

    // --- request review ---
    const requested = await candidateRepository.requestBoardReportingCandidateReview(
      { organizationId: ORG, engagementId: ENGAGEMENT, boardReportingCandidateId: CANDIDATE, actorContext: ACTOR, now: REQUEST_NOW },
      { metadataOnlyAudit: candidateAudit(REQUEST_NOW) },
    );
    assert.equal(requested.ok, true, JSON.stringify(requested));
    assert.equal(requested.data.queueStatus, "open");
    assert.equal(requested.data.reviewStatus, "needs_gk_review");
    const REVIEW_QUEUE_ITEM = requested.data.reviewQueueItemId;

    // Carry forward the actual REQUEST row's updated_at as the START
    // concurrency token - never a guessed/synthetic timestamp.
    const requestRow = await pool.query(
      `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [REVIEW_QUEUE_ITEM],
    );
    const REQUEST_UPDATED_AT = requestRow.rows[0].updated_at.toISOString();

    // --- START ---
    const started = await candidateRepository.startBoardReportingCandidateReview(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: CANDIDATE,
        reviewQueueItemId: REVIEW_QUEUE_ITEM,
        expectedUpdatedAt: REQUEST_UPDATED_AT,
        actorContext: ACTOR,
        now: START_NOW,
      },
      { metadataOnlyAudit: candidateAudit(START_NOW) },
    );
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(started.data.queueStatus, "in_progress");
    assert.equal(started.data.reviewStatus, "needs_gk_review");
    assert.equal(started.data.replayed, false);

    // Carry forward the actual post-START updated_at as the COMPLETE
    // concurrency token - never a guessed/synthetic timestamp.
    const startRow = await pool.query(
      `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [REVIEW_QUEUE_ITEM],
    );
    const START_UPDATED_AT = startRow.rows[0].updated_at.toISOString();

    // --- COMPLETE ---
    const completed = await candidateRepository.completeBoardReportingCandidateReview(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: CANDIDATE,
        reviewQueueItemId: REVIEW_QUEUE_ITEM,
        expectedUpdatedAt: START_UPDATED_AT,
        actorContext: ACTOR,
        now: COMPLETE_NOW,
      },
      { metadataOnlyAudit: candidateAudit(COMPLETE_NOW) },
    );
    assert.equal(completed.ok, true, JSON.stringify(completed));
    assert.equal(completed.data.queueStatus, "resolved");
    assert.equal(completed.data.reviewStatus, "resolved");
    assert.equal(completed.data.replayed, false);

    const resolvedReviewSnapshot = async () => {
      const rows = await pool.query(
        `SELECT queue_type, target_object_type, target_object_id::text AS target_object_id, queue_status, review_status
           FROM kai.review_queue_items
          WHERE review_queue_item_id = $1::uuid`,
        [REVIEW_QUEUE_ITEM],
      );
      return rows.rows[0];
    };
    const resolvedReviewBeforeAuthority = await resolvedReviewSnapshot();
    assert.deepEqual(resolvedReviewBeforeAuthority, {
      queue_type: "board_reporting_candidate_review",
      target_object_type: "board_reporting_candidate",
      target_object_id: CANDIDATE,
      queue_status: "resolved",
      review_status: "resolved",
    });

    // --- GRANT ---
    const grant = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: CANDIDATE,
        reviewQueueItemId: REVIEW_QUEUE_ITEM,
        decisionAction: "grant",
        actorContext: GK_ADMIN_ACTOR,
        now: GRANT_NOW,
      },
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit(GRANT_NOW) },
    );
    assert.equal(grant.ok, true, JSON.stringify(grant));
    assert.equal(grant.data.effective, true);
    assert.equal(grant.data.replayed, false);
    assert.equal(grant.data.decisionAction, "grant");
    assert.equal(grant.data.decidedByRole, "gk_admin");
    assert.equal(grant.data.supersedesDecisionId, null);
    const GRANT_DECISION_ID = grant.data.decisionId;

    const ledgerCount = async () => {
      const rows = await pool.query(
        `SELECT count(*)::int AS count
           FROM kai.board_reporting_candidate_human_authority_decisions
          WHERE board_reporting_candidate_id = $1::uuid`,
        [CANDIDATE],
      );
      return rows.rows[0].count;
    };
    const auditCount = async () => {
      const rows = await pool.query(
        `SELECT count(*)::int AS count
           FROM kai.audit_events
          WHERE action = 'board_reporting_candidate_human_authority_decision_recorded'
            AND metadata->>'board_reporting_candidate_id' = $1`,
        [CANDIDATE],
      );
      return rows.rows[0].count;
    };

    assert.equal(await ledgerCount(), 1, "GRANT must insert exactly one authority row");
    assert.equal(await auditCount(), 1, "GRANT must write exactly one authority audit row");

    // --- read authority state ---
    const afterGrantState = await authorityRepository.evaluateEffectiveness({
      organizationId: ORG,
      boardReportingCandidateId: CANDIDATE,
      decisionType: "export_authority_granted",
    });
    assert.equal(afterGrantState.ok, true);
    assert.equal(afterGrantState.data.effective, true);
    assert.equal(afterGrantState.data.headDecisionId, GRANT_DECISION_ID);

    // --- identical GRANT replay ---
    const grantReplay = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: CANDIDATE,
        reviewQueueItemId: REVIEW_QUEUE_ITEM,
        decisionAction: "grant",
        actorContext: GK_ADMIN_ACTOR,
        now: GRANT_REPLAY_NOW,
      },
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit(GRANT_REPLAY_NOW) },
    );
    assert.equal(grantReplay.ok, true, JSON.stringify(grantReplay));
    assert.equal(grantReplay.data.replayed, true);
    assert.equal(grantReplay.data.effective, true);
    assert.equal(grantReplay.data.decisionId, GRANT_DECISION_ID);
    assert.equal(await ledgerCount(), 1, "identical GRANT replay must insert no new authority rows");
    assert.equal(await auditCount(), 1, "identical GRANT replay must write no duplicate audit row");

    // --- REVOKE ---
    const revoke = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: CANDIDATE,
        reviewQueueItemId: REVIEW_QUEUE_ITEM,
        decisionAction: "revoke",
        actorContext: GK_ADMIN_ACTOR,
        now: REVOKE_NOW,
      },
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit(REVOKE_NOW) },
    );
    assert.equal(revoke.ok, true, JSON.stringify(revoke));
    assert.equal(revoke.data.effective, false);
    assert.equal(revoke.data.effectivenessReason, "head_is_revoke");
    assert.equal(revoke.data.supersedesDecisionId, GRANT_DECISION_ID);
    assert.equal(revoke.data.replayed, false);
    const REVOKE_DECISION_ID = revoke.data.decisionId;

    assert.equal(await ledgerCount(), 2, "REVOKE must supersede GRANT with exactly one new authority row");
    assert.equal(await auditCount(), 2, "REVOKE must write exactly one new authority audit row");

    const headRows = await pool.query(
      `SELECT d.decision_id::text AS decision_id, d.decision_action
         FROM kai.board_reporting_candidate_human_authority_decisions d
        WHERE d.board_reporting_candidate_id = $1::uuid
          AND NOT EXISTS (
                SELECT 1 FROM kai.board_reporting_candidate_human_authority_decisions s
                 WHERE s.supersedes_decision_id = d.decision_id
              )`,
      [CANDIDATE],
    );
    assert.equal(headRows.rows.length, 1);
    assert.equal(headRows.rows[0].decision_id, REVOKE_DECISION_ID);
    assert.equal(headRows.rows[0].decision_action, "revoke");

    // --- read authority state ---
    const afterRevokeState = await authorityRepository.evaluateEffectiveness({
      organizationId: ORG,
      boardReportingCandidateId: CANDIDATE,
      decisionType: "export_authority_granted",
    });
    assert.equal(afterRevokeState.ok, true);
    assert.equal(afterRevokeState.data.effective, false);
    assert.equal(afterRevokeState.data.headDecisionId, REVOKE_DECISION_ID);

    // --- identical REVOKE replay ---
    const revokeReplay = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: CANDIDATE,
        reviewQueueItemId: REVIEW_QUEUE_ITEM,
        decisionAction: "revoke",
        actorContext: GK_ADMIN_ACTOR,
        now: REVOKE_REPLAY_NOW,
      },
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit(REVOKE_REPLAY_NOW) },
    );
    assert.equal(revokeReplay.ok, true, JSON.stringify(revokeReplay));
    assert.equal(revokeReplay.data.replayed, true);
    assert.equal(revokeReplay.data.effective, false);
    assert.equal(revokeReplay.data.decisionId, REVOKE_DECISION_ID);
    assert.equal(await ledgerCount(), 2, "identical REVOKE replay must insert no new authority rows");
    assert.equal(await auditCount(), 2, "identical REVOKE replay must write no duplicate audit row");

    // --- candidate, fingerprint, members, and completed review all unchanged ---
    const afterAll = await candidateSnapshot();
    assert.deepEqual(afterAll, beforeLifecycle);
    assert.equal(afterAll.candidate.canonical_fingerprint, CANONICAL_FINGERPRINT);

    const resolvedReviewAfterAuthority = await resolvedReviewSnapshot();
    assert.deepEqual(resolvedReviewAfterAuthority, resolvedReviewBeforeAuthority);
  });
}
