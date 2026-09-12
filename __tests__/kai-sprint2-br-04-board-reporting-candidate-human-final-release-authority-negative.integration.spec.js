// BR-04 real-DB negative/governance proof: fail-closed and governance
// behavior for kaiBoardReportingCandidateHumanFinalReleaseAuthorityService.js
// + postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js
// against the runner-owned synthetic PostgreSQL database established by
// kai-sprint2-br-04-board-reporting-candidate-human-final-release-authority.integration.spec.js
// (Prompt 3A). Uses only actual repository/service error codes
// (not_found, conflict_current_state_changed, validation_blocker,
// authorization_denied) - none invented here. No raw SQL is used to bypass
// the code under test for any assertion that stands in for it; raw SQL is
// used only to seed hazard fixtures (an unstarted/in-progress review, a
// queue item bound to a different candidate) exactly as the existing
// BR-03B integration spec's "never started" fixture already does.

import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_BR_04_BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`BR-04 negative/governance suite refused a non-loopback KAI_BR_04_BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("BR-04 board-reporting-candidate human final-release authority negative/governance real-DB integration requires the runner-owned database", { skip: true }, () => {});
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
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const ENGAGEMENT = "15042000-0000-4000-8000-000000000101";
  const OTHER_ENGAGEMENT = "15042000-0000-4000-8000-000000000102";
  const DRAFT_A = "15042000-0000-4000-8000-000000000201";
  const DRAFT_B = "15042000-0000-4000-8000-000000000202";
  const ACTOR_ID = "90000000-0000-4000-8000-000000000001";
  const ACTOR = Object.freeze({ actorType: "human", actorUserId: ACTOR_ID });

  const GK_ADMIN_ACTOR = Object.freeze({
    actorType: "human",
    actorUserId: ACTOR_ID,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
  });
  const GK_ADMIN_ACTOR_MULTI_ORG = Object.freeze({
    actorType: "human",
    actorUserId: ACTOR_ID,
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
      { organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" },
    ],
  });
  const GK_REVIEWER_ACTOR = Object.freeze({
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000002",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  });
  const CROSS_TENANT_ACTOR = Object.freeze({
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000003",
    organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_admin" }],
  });
  const NON_HUMAN_ACTOR = Object.freeze({ actorType: "assistant", actorUserId: ACTOR_ID });

  const ENABLED_ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
  const MISSING_CANDIDATE = "15042000-0000-4000-8000-000000000999";
  const MISSING_REVIEW_QUEUE_ITEM = "15042000-0000-4000-8000-000000000998";

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
      claimId: `15042000-0000-4000-8000-0000000003${index}1`,
      evidenceItemId: `15042000-0000-4000-8000-0000000003${index}2`,
      sourceId: `15042000-0000-4000-8000-0000000003${index}3`,
      sourceVersionId: `15042000-0000-4000-8000-0000000003${index}4`,
      generatedContentCitationId: `15042000-0000-4000-8000-0000000003${index}5`,
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
          generationRunId: `15042000-0000-4000-8000-0000000001${index}1`,
          generatedContentDraftId: draftId,
          contentType: index % 2 === 0 ? "evidence_summary" : "impact_narrative",
          draftStatus: "draft",
          requestedAudience: "internal",
          reviewQueueItemId: `15042000-0000-4000-8000-0000000004${index}1`,
          queueStatus: "resolved",
          reviewStatus: "resolved",
          reviewUpdatedAt: "2026-09-12T12:00:00.000Z",
          currentUseEligible: true,
          blocks: [{
            ordinal: 0,
            generatedContentBlockId: `15042000-0000-4000-8000-0000000005${index}1`,
            text: "not stored in BR-04 negative/governance real-DB proof",
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
       VALUES ($1::uuid, 'BR-04 Negative Org', 'br-04-negative-org') ON CONFLICT (organization_id) DO NOTHING`,
      [ORG],
    );
    await tx.query(
      `INSERT INTO kai.organizations (organization_id, name, organization_code)
       VALUES ($1::uuid, 'BR-04 Negative Other Org', 'br-04-negative-other-org') ON CONFLICT (organization_id) DO NOTHING`,
      [OTHER_ORG],
    );
    await tx.query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
       VALUES ($1::uuid, $2::uuid, 'br-04-negative-engagement') ON CONFLICT (engagement_id) DO NOTHING`,
      [ENGAGEMENT, ORG],
    );
    await tx.query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
       VALUES ($1::uuid, $2::uuid, 'br-04-negative-other-engagement') ON CONFLICT (engagement_id) DO NOTHING`,
      [OTHER_ENGAGEMENT, ORG],
    );
    for (const [index, draftId] of [DRAFT_A, DRAFT_B].entries()) {
      const runId = `15042000-0000-4000-8000-0000000001${index}1`;
      await tx.query(
        `INSERT INTO kai.generation_runs (
           generation_run_id, organization_id, idempotency_key, request_fingerprint, content_type, requested_audience, engagement_id
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'internal', $6::uuid)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [runId, ORG, `br-04-negative-run-${draftId}`, "a".repeat(64), index % 2 === 0 ? "evidence_summary" : "impact_narrative", ENGAGEMENT],
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

  // Creates a Board candidate through the real repository, and drives its
  // review through the real repository to exactly the requested terminal
  // state ("none" | "request" | "start" | "complete") - never raw SQL for
  // the candidate/review transitions themselves.
  async function createCandidateAtReviewState(idempotencyKey, terminalState) {
    const created = await candidateRepository.createBoardReportingCandidate(
      { organizationId: ORG, engagementId: ENGAGEMENT, idempotencyKey, actorContext: ACTOR, now: "2026-09-12T12:00:00.000Z" },
      { metadataOnlyAudit: candidateAudit("2026-09-12T12:00:00.000Z"), composeRenderModel: async () => renderModel() },
    );
    assert.equal(created.ok, true, JSON.stringify(created));
    const candidateId = created.data.boardReportingCandidateId;
    if (terminalState === "none") return { candidateId, reviewQueueItemId: null };

    const requested = await candidateRepository.requestBoardReportingCandidateReview(
      { organizationId: ORG, engagementId: ENGAGEMENT, boardReportingCandidateId: candidateId, actorContext: ACTOR, now: "2026-09-12T12:05:00.000Z" },
      { metadataOnlyAudit: candidateAudit("2026-09-12T12:05:00.000Z") },
    );
    assert.equal(requested.ok, true, JSON.stringify(requested));
    const reviewQueueItemId = requested.data.reviewQueueItemId;
    if (terminalState === "request") return { candidateId, reviewQueueItemId };

    const requestRow = await pool.query(`SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [reviewQueueItemId]);
    const started = await candidateRepository.startBoardReportingCandidateReview(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: candidateId,
        reviewQueueItemId,
        expectedUpdatedAt: requestRow.rows[0].updated_at.toISOString(),
        actorContext: ACTOR,
        now: "2026-09-12T13:00:00.000Z",
      },
      { metadataOnlyAudit: candidateAudit("2026-09-12T13:00:00.000Z") },
    );
    assert.equal(started.ok, true, JSON.stringify(started));
    if (terminalState === "start") return { candidateId, reviewQueueItemId };

    const startRow = await pool.query(`SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [reviewQueueItemId]);
    const completed = await candidateRepository.completeBoardReportingCandidateReview(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        boardReportingCandidateId: candidateId,
        reviewQueueItemId,
        expectedUpdatedAt: startRow.rows[0].updated_at.toISOString(),
        actorContext: ACTOR,
        now: "2026-09-12T14:00:00.000Z",
      },
      { metadataOnlyAudit: candidateAudit("2026-09-12T14:00:00.000Z") },
    );
    assert.equal(completed.ok, true, JSON.stringify(completed));
    return { candidateId, reviewQueueItemId };
  }

  function authorityInput(overrides = {}) {
    return {
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      decisionAction: "grant",
      actorContext: GK_ADMIN_ACTOR,
      now: "2026-09-12T15:00:00.000Z",
      ...overrides,
    };
  }

  async function ledgerCountFor(candidateId) {
    const rows = await pool.query(
      `SELECT count(*)::int AS count FROM kai.board_reporting_candidate_human_authority_decisions WHERE board_reporting_candidate_id = $1::uuid`,
      [candidateId],
    );
    return rows.rows[0].count;
  }

  test.after(async () => {
    await pool.end();
  });

  // Node's test runner does not guarantee sequential execution of separate
  // top-level test() calls sharing one mutable database connection pool in
  // this file (observed empirically: a second/third top-level test() in
  // this file intermittently failed with a runner-internal
  // "cancelledByParent"/"Promise resolution is still pending" error or a
  // spurious query error unrelated to the assertions themselves, even
  // though each was fully awaited in program order and each ran cleanly in
  // isolation). All three proofs below are therefore sequenced inside one
  // top-level test() to guarantee ordering, rather than split across
  // separate test() calls.
  await test("BR-04 real Postgres: negative/fail-closed, stale/conflicting-successor, and audit/governance proof (sequenced in one test to guarantee ordering)", async () => {
    const NO_REVIEW = await createCandidateAtReviewState("br-04-neg-no-review", "none");
    const REQUEST_ONLY = await createCandidateAtReviewState("br-04-neg-request-only", "request");
    const START_ONLY = await createCandidateAtReviewState("br-04-neg-start-only", "start");
    const RESOLVED = await createCandidateAtReviewState("br-04-neg-resolved", "complete");

    // no review at all for this candidate (no queue row exists for the id supplied)
    const noReview = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: NO_REVIEW.candidateId, reviewQueueItemId: MISSING_REVIEW_QUEUE_ITEM }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(noReview.ok, false);
    assert.equal(noReview.error.code, "not_found");
    assert.equal(await ledgerCountFor(NO_REVIEW.candidateId), 0);

    // REQUEST-only (open/needs_gk_review) - never started
    const requestOnly = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: REQUEST_ONLY.candidateId, reviewQueueItemId: REQUEST_ONLY.reviewQueueItemId }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(requestOnly.ok, false);
    assert.equal(requestOnly.error.code, "conflict_current_state_changed");
    assert.equal(await ledgerCountFor(REQUEST_ONLY.candidateId), 0);

    // START-only (in_progress/needs_gk_review) - not yet COMPLETE
    const startOnly = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: START_ONLY.candidateId, reviewQueueItemId: START_ONLY.reviewQueueItemId }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(startOnly.ok, false);
    assert.equal(startOnly.error.code, "conflict_current_state_changed");
    assert.equal(await ledgerCountFor(START_ONLY.candidateId), 0);

    // wrong organization: actor legitimately holds gk_admin in OTHER_ORG too,
    // so authorization passes, but RESOLVED's candidate row lives under ORG,
    // not OTHER_ORG - repository lookup fails closed as not_found.
    const wrongOrg = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({
        organizationId: OTHER_ORG,
        boardReportingCandidateId: RESOLVED.candidateId,
        reviewQueueItemId: RESOLVED.reviewQueueItemId,
        actorContext: GK_ADMIN_ACTOR_MULTI_ORG,
      }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(wrongOrg.ok, false);
    assert.equal(wrongOrg.error.code, "not_found");

    // wrong engagement: correct organization, but RESOLVED belongs to ENGAGEMENT not OTHER_ENGAGEMENT
    const wrongEngagement = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ engagementId: OTHER_ENGAGEMENT, boardReportingCandidateId: RESOLVED.candidateId, reviewQueueItemId: RESOLVED.reviewQueueItemId }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(wrongEngagement.ok, false);
    assert.equal(wrongEngagement.error.code, "not_found");

    // wrong candidate: syntactically valid but nonexistent boardReportingCandidateId
    const wrongCandidate = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: MISSING_CANDIDATE, reviewQueueItemId: RESOLVED.reviewQueueItemId }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(wrongCandidate.ok, false);
    assert.equal(wrongCandidate.error.code, "not_found");

    // wrong reviewQueueItem: syntactically valid but nonexistent reviewQueueItemId
    const wrongQueueItem = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: RESOLVED.candidateId, reviewQueueItemId: MISSING_REVIEW_QUEUE_ITEM }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(wrongQueueItem.ok, false);
    assert.equal(wrongQueueItem.error.code, "not_found");

    // review item bound to another candidate: REQUEST_ONLY's real queue item
    // id exists, but its target_object_id is REQUEST_ONLY's candidate, not
    // RESOLVED's - binding proof fails closed.
    const wrongBinding = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: RESOLVED.candidateId, reviewQueueItemId: REQUEST_ONLY.reviewQueueItemId }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(wrongBinding.ok, false);
    assert.equal(wrongBinding.error.code, "conflict_current_state_changed");

    // cross-tenant actor: active gk_admin membership only in OTHER_ORG, called against ORG
    let repositoryCallsForCrossTenant = 0;
    const countingRepositoryForCrossTenant = { async recordDecision(input, deps) { repositoryCallsForCrossTenant += 1; return authorityRepository.recordDecision(input, deps); } };
    const crossTenant = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: RESOLVED.candidateId, reviewQueueItemId: RESOLVED.reviewQueueItemId, actorContext: CROSS_TENANT_ACTOR }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: countingRepositoryForCrossTenant, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(crossTenant.ok, false);
    assert.equal(crossTenant.error.code, "authorization_denied");
    assert.equal(repositoryCallsForCrossTenant, 0, "cross-tenant actor must be blocked before any repository call");

    // unauthorized role: active membership in the correct org, but gk_reviewer not gk_admin
    let repositoryCallsForUnauthorizedRole = 0;
    const countingRepositoryForRole = { async recordDecision(input, deps) { repositoryCallsForUnauthorizedRole += 1; return authorityRepository.recordDecision(input, deps); } };
    const unauthorizedRole = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: RESOLVED.candidateId, reviewQueueItemId: RESOLVED.reviewQueueItemId, actorContext: GK_REVIEWER_ACTOR }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: countingRepositoryForRole, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(unauthorizedRole.ok, false);
    assert.equal(unauthorizedRole.error.code, "authorization_denied");
    assert.equal(repositoryCallsForUnauthorizedRole, 0, "unauthorized role must be blocked before any repository call");

    // non-human actor: assistant actorType
    let repositoryCallsForNonHuman = 0;
    const countingRepositoryForNonHuman = { async recordDecision(input, deps) { repositoryCallsForNonHuman += 1; return authorityRepository.recordDecision(input, deps); } };
    const nonHuman = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: RESOLVED.candidateId, reviewQueueItemId: RESOLVED.reviewQueueItemId, actorContext: NON_HUMAN_ACTOR }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: countingRepositoryForNonHuman, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(nonHuman.ok, false);
    assert.equal(nonHuman.error.code, "authorization_denied");
    assert.equal(repositoryCallsForNonHuman, 0, "non-human actor must be blocked before any repository call");

    // invalid decision action
    const invalidAction = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: RESOLVED.candidateId, reviewQueueItemId: RESOLVED.reviewQueueItemId, decisionAction: "approve" }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(invalidAction.ok, false);
    assert.equal(invalidAction.error.code, "validation_blocker");
    assert.equal(await ledgerCountFor(RESOLVED.candidateId), 0);

    // root REVOKE before any GRANT
    const rootRevoke = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: RESOLVED.candidateId, reviewQueueItemId: RESOLVED.reviewQueueItemId, decisionAction: "revoke" }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(rootRevoke.ok, false);
    assert.equal(rootRevoke.error.code, "validation_blocker");
    assert.equal(await ledgerCountFor(RESOLVED.candidateId), 0, "root REVOKE must insert no row");

    // Every negative above left the ledger for every fixture candidate empty.
    assert.equal(await ledgerCountFor(NO_REVIEW.candidateId), 0);
    assert.equal(await ledgerCountFor(REQUEST_ONLY.candidateId), 0);
    assert.equal(await ledgerCountFor(START_ONLY.candidateId), 0);
    assert.equal(await ledgerCountFor(RESOLVED.candidateId), 0);

    // --- stale/conflicting successor: the schema's own unique indexes make
    // a forked lineage unconstructible, so the repository's ambiguous-head
    // branch is unreachable defense-in-depth ---
    const FORK = await createCandidateAtReviewState("br-04-neg-fork", "complete");

    const grant = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: FORK.candidateId, reviewQueueItemId: FORK.reviewQueueItemId }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(grant.ok, true, JSON.stringify(grant));
    const ROOT_DECISION_ID = grant.data.decisionId;

    // Attempt A: a second ROOT decision (supersedes_decision_id IS NULL) for
    // the same (organization, candidate, decision_type) lineage - rejected by
    // ux_brchad_br_04_root_per_lineage before the application ever sees it.
    let rootForkError = null;
    try {
      await pool.query(
        `INSERT INTO kai.board_reporting_candidate_human_authority_decisions (
           organization_id, board_reporting_candidate_id, decision_type, decision_action, decided_by, decided_by_role
         ) VALUES ($1::uuid, $2::uuid, 'export_authority_granted', 'grant', $3::uuid, 'gk_admin')`,
        [ORG, FORK.candidateId, ACTOR_ID],
      );
    } catch (error) {
      rootForkError = error;
    }
    assert.notEqual(rootForkError, null, "a second lineage root must be rejected by the DB unique index, not merely by application logic");
    assert.equal(rootForkError.code, "23505");
    assert.match(rootForkError.message, /ux_brchad_br_04_root_per_lineage/);

    // The legitimate first successor (a real revoke through the actual
    // repository) must still succeed - only a second, forking successor is
    // ever rejected.
    const revoke = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: FORK.candidateId, reviewQueueItemId: FORK.reviewQueueItemId, decisionAction: "revoke" }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T16:00:00.000Z") },
    );
    assert.equal(revoke.ok, true, JSON.stringify(revoke));
    assert.equal(revoke.data.supersedesDecisionId, ROOT_DECISION_ID);

    // Attempt B: a second, forking successor of the SAME predecessor
    // (ROOT_DECISION_ID), attempted after the legitimate revoke above already
    // occupies that predecessor's one successor slot - rejected by
    // ux_brchad_br_04_single_successor.
    let singleSuccessorForkError = null;
    try {
      await pool.query(
        `INSERT INTO kai.board_reporting_candidate_human_authority_decisions (
           organization_id, board_reporting_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id
         ) VALUES ($1::uuid, $2::uuid, 'export_authority_granted', 'grant', $3::uuid, 'gk_admin', $4::uuid)`,
        [ORG, FORK.candidateId, ACTOR_ID, ROOT_DECISION_ID],
      );
    } catch (error) {
      singleSuccessorForkError = error;
    }
    assert.notEqual(singleSuccessorForkError, null, "a second fork off an already-superseded predecessor must still be rejected");
    assert.equal(singleSuccessorForkError.code, "23505");
    assert.match(singleSuccessorForkError.message, /ux_brchad_br_04_single_successor/);

    // Exactly one un-superseded head exists - the schema never allows a
    // forked/ambiguous lineage to persist, so the repository's own
    // `headRows.length > 1` ("conflict_current_state_changed") branch can
    // never actually be reached in this proof; it is defense-in-depth behind
    // these two unique indexes, not a live application-level path.
    const headRows = await pool.query(
      `SELECT d.decision_id::text AS decision_id
         FROM kai.board_reporting_candidate_human_authority_decisions d
        WHERE d.board_reporting_candidate_id = $1::uuid
          AND NOT EXISTS (
                SELECT 1 FROM kai.board_reporting_candidate_human_authority_decisions s
                 WHERE s.supersedes_decision_id = d.decision_id
              )`,
      [FORK.candidateId],
    );
    assert.equal(headRows.rows.length, 1, "exactly one un-superseded head must exist - a forked/ambiguous lineage can never persist");
    assert.equal(headRows.rows[0].decision_id, revoke.data.decisionId);

    // --- a real authority mutation writes exactly one safe-metadata-only
    // audit row, replay writes no duplicate, and no governance boundary is
    // crossed ---
    const GOV = await createCandidateAtReviewState("br-04-neg-audit-governance", "complete");

    const candidateSnapshot = async () => {
      const candidateRows = await pool.query(
        `SELECT canonical_fingerprint, candidate_status, packet_audience, created_at
           FROM kai.board_reporting_candidates
          WHERE board_reporting_candidate_id = $1::uuid`,
        [GOV.candidateId],
      );
      const memberRows = await pool.query(
        `SELECT generated_content_draft_id::text AS draft_id, ordinal
           FROM kai.board_reporting_candidate_members
          WHERE board_reporting_candidate_id = $1::uuid
          ORDER BY ordinal`,
        [GOV.candidateId],
      );
      const reviewRows = await pool.query(
        `SELECT queue_type, target_object_type, target_object_id::text AS target_object_id, queue_status, review_status
           FROM kai.review_queue_items
          WHERE review_queue_item_id = $1::uuid`,
        [GOV.reviewQueueItemId],
      );
      return { candidate: candidateRows.rows[0], members: memberRows.rows, review: reviewRows.rows[0] };
    };
    const governanceCounts = async () => {
      const rows = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM kai.export_candidates) AS export_candidate_count,
           (SELECT count(*)::int FROM kai.export_manifests) AS manifest_count`,
      );
      return rows.rows[0];
    };

    const govBefore = await candidateSnapshot();
    const govBeforeGovernance = await governanceCounts();

    const govGrant = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: GOV.candidateId, reviewQueueItemId: GOV.reviewQueueItemId }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T15:00:00.000Z") },
    );
    assert.equal(govGrant.ok, true, JSON.stringify(govGrant));

    const govAuditRows = await pool.query(
      `SELECT metadata FROM kai.audit_events
        WHERE action = 'board_reporting_candidate_human_authority_decision_recorded'
          AND metadata->>'decision_id' = $1`,
      [govGrant.data.decisionId],
    );
    assert.equal(govAuditRows.rows.length, 1, "exactly one audit row must exist for the real mutation");
    const auditMetadata = govAuditRows.rows[0].metadata;

    // Safe scalar metadata only - no generated Board content, evidence/
    // citation text, member content, raw client data, credentials, tokens,
    // signed URLs, or infrastructure details.
    for (const [key, value] of Object.entries(auditMetadata)) {
      // The metadata_only "contains_*" flags are themselves safe markers
      // (each pinned to false, asserted below) - they name the absence of
      // unsafe content, not the content itself, so they are exempt from the
      // unsafe-key substring check applied to every other field.
      if (!/^contains_/.test(key)) {
        assert.doesNotMatch(
          key,
          /\b(content|citation|evidence|snapshot|members|prompt|manifest|credential|token|signed_url|secret|password|connection_string|db_host|db_port|hostname)\b/i,
          `unsafe key: ${key}`,
        );
      }
      assert.notEqual(typeof value, "object", `metadata.${key} must be a scalar, not an object/array`);
    }
    assert.equal(auditMetadata.metadata_only, true);
    assert.equal(auditMetadata.contains_raw_file_content, false);
    assert.equal(auditMetadata.contains_raw_parsed_rows, false);
    assert.equal(auditMetadata.contains_client_pii, false);
    assert.equal(auditMetadata.contains_prompt_text, false);
    assert.equal(auditMetadata.contains_unsafe_generated_text, false);
    assert.equal(auditMetadata.contains_signed_urls, false);
    assert.equal(auditMetadata.contains_storage_credentials, false);
    assert.equal(auditMetadata.board_reporting_candidate_id, GOV.candidateId);
    assert.equal(auditMetadata.review_queue_item_id, GOV.reviewQueueItemId);
    assert.equal(auditMetadata.decision_action, "grant");
    assert.equal(auditMetadata.decision_type, "export_authority_granted");
    assert.equal(auditMetadata.decided_by_role, "gk_admin");
    assert.equal(auditMetadata.effective, true);

    // identical replay writes no duplicate audit row
    const govReplay = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision(
      authorityInput({ boardReportingCandidateId: GOV.candidateId, reviewQueueItemId: GOV.reviewQueueItemId }),
      { env: ENABLED_ENV, boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository, metadataOnlyAudit: authorityAudit("2026-09-12T15:05:00.000Z") },
    );
    assert.equal(govReplay.ok, true, JSON.stringify(govReplay));
    assert.equal(govReplay.data.replayed, true);
    const govAuditRowsAfterReplay = await pool.query(
      `SELECT count(*)::int AS count FROM kai.audit_events
        WHERE action = 'board_reporting_candidate_human_authority_decision_recorded'
          AND metadata->>'board_reporting_candidate_id' = $1`,
      [GOV.candidateId],
    );
    assert.equal(govAuditRowsAfterReplay.rows[0].count, 1, "identical replay must write no duplicate audit row");

    // Governance: no final eligibility, manifest, or delivery side effect -
    // the only existing eligibility/manifest tables in this schema
    // (kai.export_candidates / kai.export_manifests) are untouched, and this
    // package implements no board-reporting-specific equivalent of them.
    const govAfterGovernance = await governanceCounts();
    assert.deepEqual(govAfterGovernance, govBeforeGovernance);
    assert.equal(govAfterGovernance.export_candidate_count, 0);
    assert.equal(govAfterGovernance.manifest_count, 0);

    // Governance: authority never rewrites the candidate, its fingerprint,
    // its members, or the resolved review row it is bound to.
    const govAfter = await candidateSnapshot();
    assert.deepEqual(govAfter, govBefore);
  });
}
