// Board final eligibility real-DB proof: drives the valid lifecycle through
// the actual Board candidate/review/authority services, then invokes the
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
  const ENGAGEMENT = "15100000-0000-4000-8000-000000000101";
  const DRAFT_A = "15100000-0000-4000-8000-000000000201";
  const DRAFT_B = "15100000-0000-4000-8000-000000000202";
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
          generationRunId: `15100000-0000-4000-8000-0000000001${index}1`,
          generatedContentDraftId: draftId,
          contentType: index % 2 === 0 ? "evidence_summary" : "impact_narrative",
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

  await withRunnerOwnedTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO kai.organizations (organization_id, name, organization_code)
       VALUES ($1::uuid, 'Board Final Eligibility Org', 'board-final-eligibility-org')
       ON CONFLICT (organization_id) DO NOTHING`,
      [ORG],
    );
    await tx.query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
       VALUES ($1::uuid, $2::uuid, 'board-final-eligibility-engagement')
       ON CONFLICT (engagement_id) DO NOTHING`,
      [ENGAGEMENT, ORG],
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

  await test("Board final eligibility real Postgres: GRANT passes, REVOKE blocks, re-GRANT passes, and gate evaluation is read-only", async () => {
    const createDependencies = {
      env: ENABLED_ENV,
      boardReportingCandidateRepository: candidateRepository,
      metadataOnlyAudit: candidateAudit(CREATE_NOW),
      composeRenderModel: async () => renderModel(),
    };
    const created = await createBoardReportingCandidate({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      idempotencyKey: "board-final-eligibility-candidate",
      actorContext: ACTOR,
      now: CREATE_NOW,
    }, createDependencies);
    assert.equal(created.ok, true, JSON.stringify(created));
    const CANDIDATE = created.data.boardReportingCandidateId;
    const CANDIDATE_FINGERPRINT = created.data.canonicalFingerprint;
    assert.equal(created.data.memberCount, 2);

    const requested = await requestBoardReportingCandidateReview({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: CANDIDATE,
      actorContext: ACTOR,
      now: REQUEST_NOW,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateRepository: candidateRepository,
      metadataOnlyAudit: candidateAudit(REQUEST_NOW),
    });
    assert.equal(requested.ok, true, JSON.stringify(requested));
    const REVIEW_QUEUE_ITEM = requested.data.reviewQueueItemId;

    const requestRow = await pool.query(
      `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [REVIEW_QUEUE_ITEM],
    );
    const started = await startBoardReportingCandidateReview({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: CANDIDATE,
      reviewQueueItemId: REVIEW_QUEUE_ITEM,
      expectedUpdatedAt: requestRow.rows[0].updated_at.toISOString(),
      actorContext: ACTOR,
      now: START_NOW,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateRepository: candidateRepository,
      metadataOnlyAudit: candidateAudit(START_NOW),
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    const startRow = await pool.query(
      `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [REVIEW_QUEUE_ITEM],
    );
    const completed = await completeBoardReportingCandidateReview({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: CANDIDATE,
      reviewQueueItemId: REVIEW_QUEUE_ITEM,
      expectedUpdatedAt: startRow.rows[0].updated_at.toISOString(),
      actorContext: ACTOR,
      now: COMPLETE_NOW,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateRepository: candidateRepository,
      metadataOnlyAudit: candidateAudit(COMPLETE_NOW),
    });
    assert.equal(completed.ok, true, JSON.stringify(completed));
    assert.equal(completed.data.queueStatus, "resolved");
    assert.equal(completed.data.reviewStatus, "resolved");

    const snapshot = async () => {
      const rows = await pool.query(
        `SELECT
           (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.board_reporting_candidate_id)
              FROM kai.board_reporting_candidates c
             WHERE c.board_reporting_candidate_id = $1::uuid) AS candidates,
           (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.ordinal)
              FROM kai.board_reporting_candidate_members m
             WHERE m.board_reporting_candidate_id = $1::uuid) AS members,
           (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.review_queue_item_id)
              FROM kai.review_queue_items r
             WHERE r.review_queue_item_id = $2::uuid) AS reviews,
           (SELECT count(*)::int
              FROM kai.board_reporting_candidate_human_authority_decisions
             WHERE board_reporting_candidate_id = $1::uuid) AS authority_count,
           (SELECT count(*)::int FROM kai.board_reporting_candidates) AS all_candidate_count,
           (SELECT count(*)::int FROM kai.export_manifests) AS export_manifest_count,
           (SELECT to_regclass('kai.grant_response_packet_export_manifests') IS NOT NULL) AS grant_manifest_table_exists,
           (SELECT count(*)::int
              FROM information_schema.tables
             WHERE table_schema = 'kai'
               AND table_name LIKE '%delivery%') AS delivery_table_count`,
        [CANDIDATE, REVIEW_QUEUE_ITEM],
      );
      return rows.rows[0];
    };

    const assertNoGateMutation = (before, after) => {
      assert.deepEqual(after.candidates, before.candidates, "candidate changed during gate evaluation");
      assert.deepEqual(after.members, before.members, "members changed during gate evaluation");
      assert.deepEqual(after.reviews, before.reviews, "review changed during gate evaluation");
      assert.equal(after.authority_count, before.authority_count, "authority history changed during gate evaluation");
      assert.equal(after.all_candidate_count, before.all_candidate_count, "replacement candidate created during gate evaluation");
      assert.equal(after.export_manifest_count, before.export_manifest_count, "export manifest side effect");
      assert.equal(after.grant_manifest_table_exists, before.grant_manifest_table_exists, "grant manifest table changed");
      assert.equal(after.delivery_table_count, before.delivery_table_count, "delivery side effect");
    };

    const evaluate = () => evaluateBoardReportingFinalEligibility({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: CANDIDATE,
      actorContext: ACTOR,
    }, {
      candidateRepository,
      authorityRepository,
      composeRenderModel: async () => renderModel(),
    });

    const grant = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: CANDIDATE,
      reviewQueueItemId: REVIEW_QUEUE_ITEM,
      decisionAction: "grant",
      actorContext: ACTOR,
      now: GRANT_NOW,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository,
      metadataOnlyAudit: authorityAudit(GRANT_NOW),
    });
    assert.equal(grant.ok, true, JSON.stringify(grant));

    const beforeGrantGate = await snapshot();
    const grantGate = await evaluate();
    const afterGrantGate = await snapshot();
    assertNoGateMutation(beforeGrantGate, afterGrantGate);
    assert.equal(grantGate.ok, true, JSON.stringify(grantGate));
    assert.equal(grantGate.data.candidateGate.contractValid, true);
    assert.equal(grantGate.data.reviewGate.resolved, true);
    assert.equal(grantGate.data.authorityGate.effective, true);
    assert.equal(grantGate.data.currentnessGate.current, true);
    assert.equal(grantGate.data.freshFingerprint, CANDIDATE_FINGERPRINT);
    assert.equal(grantGate.data.candidateFingerprint, CANDIDATE_FINGERPRINT);
    assert.equal(grantGate.data.finalEligibility, true);
    assert.deepEqual(grantGate.data.failedGates, []);

    const revoke = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: CANDIDATE,
      reviewQueueItemId: REVIEW_QUEUE_ITEM,
      decisionAction: "revoke",
      actorContext: ACTOR,
      now: REVOKE_NOW,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository,
      metadataOnlyAudit: authorityAudit(REVOKE_NOW),
    });
    assert.equal(revoke.ok, true, JSON.stringify(revoke));

    const beforeRevokeGate = await snapshot();
    const revokeGate = await evaluate();
    const afterRevokeGate = await snapshot();
    assertNoGateMutation(beforeRevokeGate, afterRevokeGate);
    assert.equal(revokeGate.ok, true, JSON.stringify(revokeGate));
    assert.equal(revokeGate.data.authorityGate.effective, false);
    assert.equal(revokeGate.data.authorityGate.reason, "head_is_revoke");
    assert.equal(revokeGate.data.currentnessGate.current, true);
    assert.equal(revokeGate.data.finalEligibility, false);
    assert.ok(revokeGate.data.failedGates.includes("human_release_authority_revoked"));

    const regrant = await recordBoardReportingCandidateHumanFinalReleaseAuthorityDecision({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: CANDIDATE,
      reviewQueueItemId: REVIEW_QUEUE_ITEM,
      decisionAction: "grant",
      actorContext: ACTOR,
      now: REGRANT_NOW,
    }, {
      env: ENABLED_ENV,
      boardReportingCandidateHumanAuthorityDecisionRepository: authorityRepository,
      metadataOnlyAudit: authorityAudit(REGRANT_NOW),
    });
    assert.equal(regrant.ok, true, JSON.stringify(regrant));
    assert.equal(regrant.data.effective, true);

    const beforeRegrantGate = await snapshot();
    const regrantGate = await evaluate();
    const afterRegrantGate = await snapshot();
    assertNoGateMutation(beforeRegrantGate, afterRegrantGate);
    assert.equal(regrantGate.ok, true, JSON.stringify(regrantGate));
    assert.equal(regrantGate.data.authorityGate.effective, true);
    assert.equal(regrantGate.data.currentnessGate.current, true);
    assert.equal(regrantGate.data.freshFingerprint, regrantGate.data.candidateFingerprint);
    assert.equal(regrantGate.data.finalEligibility, true);

    console.log(`TOOL_VERIFIED grantEligibility=${grantGate.data.finalEligibility}`);
    console.log(`TOOL_VERIFIED revokeEligibility=${revokeGate.data.finalEligibility}`);
    console.log(`TOOL_VERIFIED regrantEligibility=${regrantGate.data.finalEligibility}`);
    console.log(`TOOL_VERIFIED freshFingerprintEqualsCandidate=${grantGate.data.freshFingerprint === grantGate.data.candidateFingerprint}`);
    console.log("TOOL_VERIFIED gateReadOnly candidate=NO members=NO review=NO authorityChangedByGate=NO manifest=NO delivery=NO replacementCandidate=NO");
  });
}
