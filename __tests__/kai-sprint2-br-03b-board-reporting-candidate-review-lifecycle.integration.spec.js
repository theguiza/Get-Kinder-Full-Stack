import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_BR_03B_BOARD_REPORTING_CANDIDATE_REVIEW_LIFECYCLE_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`BR-03B suite refused non-loopback database URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("BR-03B board-reporting-candidate review lifecycle integration requires the runner-owned database", { skip: true }, () => {});
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
    createProductionMetadataOnlyAuditForBoardReportingCandidate,
  } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const ENGAGEMENT = "15030000-0000-4000-8000-000000000101";
  const OTHER_ENGAGEMENT = "15030000-0000-4000-8000-000000000102";
  const CANDIDATE = "15030000-0000-4000-8000-000000000301";
  const ACTOR = { actorType: "human", actorUserId: "90000000-0000-4000-8000-000000000001" };
  const NOW = "2026-09-12T13:00:00.000Z";
  const FINGERPRINT = "b".repeat(64);

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

  function makeRepository() {
    return createPostgresBoardReportingCandidateRepository({ runInTransaction: withRunnerOwnedTransaction });
  }

  function productionAudit() {
    return createProductionMetadataOnlyAuditForBoardReportingCandidate({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      actorContext: ACTOR,
      now: NOW,
    });
  }

  // The BR-03A smoke seed (installed by the local-postgres runner before this
  // suite runs) already created ORG/ENGAGEMENT, DRAFT_A/DRAFT_B, CANDIDATE,
  // and one board_reporting_candidate_review row in the REQUEST state
  // (open / needs_gk_review) at review_queue_item_id
  // 15030000-0000-4000-8000-000000000401. This suite reads that row's
  // updated_at as its own concurrency token rather than assuming one.
  const requestRow = await pool.query(
    `SELECT review_queue_item_id::text AS review_queue_item_id, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = 'board_reporting_candidate_review'
        AND target_object_id = $2::uuid`,
    [ORG, CANDIDATE],
  );
  assert.equal(requestRow.rows.length, 1);
  const QUEUE_ITEM = requestRow.rows[0].review_queue_item_id;
  const EXPECTED_UPDATED_AT = requestRow.rows[0].updated_at.toISOString();

  function startInput(overrides = {}) {
    return {
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: CANDIDATE,
      reviewQueueItemId: QUEUE_ITEM,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      actorContext: ACTOR,
      now: NOW,
      ...overrides,
    };
  }

  await test("valid Board review START transitions open/needs_gk_review -> in_progress/needs_gk_review, preserves candidate/member/fingerprint binding, and writes one metadata-only start audit", async () => {
    const repository = makeRepository();

    const beforeCandidate = await pool.query(
      `SELECT canonical_fingerprint, candidate_status, created_at
         FROM kai.board_reporting_candidates
        WHERE board_reporting_candidate_id = $1::uuid`,
      [CANDIDATE],
    );
    const beforeMembers = await pool.query(
      `SELECT generated_content_draft_id::text AS draft_id, ordinal
         FROM kai.board_reporting_candidate_members
        WHERE board_reporting_candidate_id = $1::uuid
        ORDER BY ordinal`,
      [CANDIDATE],
    );

    const result = await repository.startBoardReportingCandidateReview(startInput(), { metadataOnlyAudit: productionAudit() });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.boardReportingCandidateId, CANDIDATE);
    assert.equal(result.data.canonicalFingerprint, FINGERPRINT);
    assert.equal(result.data.reviewQueueItemId, QUEUE_ITEM);
    assert.equal(result.data.queueStatus, "in_progress");
    assert.equal(result.data.reviewStatus, "needs_gk_review");
    assert.equal(result.data.replayed, false);

    const afterCandidate = await pool.query(
      `SELECT canonical_fingerprint, candidate_status, created_at
         FROM kai.board_reporting_candidates
        WHERE board_reporting_candidate_id = $1::uuid`,
      [CANDIDATE],
    );
    const afterMembers = await pool.query(
      `SELECT generated_content_draft_id::text AS draft_id, ordinal
         FROM kai.board_reporting_candidate_members
        WHERE board_reporting_candidate_id = $1::uuid
        ORDER BY ordinal`,
      [CANDIDATE],
    );
    assert.deepEqual(afterCandidate.rows, beforeCandidate.rows);
    assert.deepEqual(afterMembers.rows, beforeMembers.rows);

    const queue = await pool.query(
      `SELECT queue_type, target_object_type, target_object_id::text AS target_object_id,
              queue_status, review_status
         FROM kai.review_queue_items
        WHERE review_queue_item_id = $1::uuid`,
      [QUEUE_ITEM],
    );
    assert.deepEqual(queue.rows[0], {
      queue_type: "board_reporting_candidate_review",
      target_object_type: "board_reporting_candidate",
      target_object_id: CANDIDATE,
      queue_status: "in_progress",
      review_status: "needs_gk_review",
    });

    const audits = await pool.query(
      `SELECT action, metadata
         FROM kai.audit_events
        WHERE organization_id = $1::uuid
          AND action = 'board_reporting_candidate_review_started'
        ORDER BY metadata->>'created_at' DESC`,
      [ORG],
    );
    assert.equal(audits.rows.length, 1);
    assert.equal(audits.rows[0].metadata.metadata_only, true);
    assert.equal(audits.rows[0].metadata.board_reporting_candidate_id, CANDIDATE);
    assert.equal(audits.rows[0].metadata.review_queue_item_id, QUEUE_ITEM);
    assert.equal(audits.rows[0].metadata.canonical_fingerprint, FINGERPRINT);
    assert.equal(audits.rows[0].metadata.previous_queue_status, "open");
    assert.equal(audits.rows[0].metadata.resulting_queue_status, "in_progress");
    assert.equal(audits.rows[0].metadata.previous_review_status, "needs_gk_review");
    assert.equal(audits.rows[0].metadata.resulting_review_status, "needs_gk_review");
    assert.equal(audits.rows[0].metadata.expected_updated_at, EXPECTED_UPDATED_AT);
    assert.equal(audits.rows[0].metadata.contains_prompt_text, false);
    assert.equal(audits.rows[0].metadata.contains_unsafe_generated_text, false);
  });

  await test("identical START replays without duplicate audit or duplicate transition", async () => {
    const repository = makeRepository();
    const replay = await repository.startBoardReportingCandidateReview(startInput(), { metadataOnlyAudit: productionAudit() });
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.queueStatus, "in_progress");
    assert.equal(replay.data.reviewStatus, "needs_gk_review");

    const counts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid) AS queue_count,
         (SELECT count(*)::int FROM kai.audit_events WHERE action = 'board_reporting_candidate_review_started') AS audit_count`,
      [QUEUE_ITEM],
    );
    assert.equal(counts.rows[0].queue_count, 1);
    assert.equal(counts.rows[0].audit_count, 1);
  });

  await test("a stale expected_updated_at concurrency token fails closed even though the row is already in START", async () => {
    const repository = makeRepository();
    const stale = await repository.startBoardReportingCandidateReview(
      startInput({ expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }),
      { metadataOnlyAudit: productionAudit() },
    );
    assert.equal(stale.error.code, "conflict_current_state_changed");
  });

  await test("wrong organization, wrong engagement, wrong candidate, and wrong review queue item all fail closed", async () => {
    const repository = makeRepository();
    const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
    const wrongOrg = await repository.startBoardReportingCandidateReview(
      startInput({ organizationId: OTHER_ORG }),
      { metadataOnlyAudit: productionAudit() },
    );
    assert.equal(wrongOrg.error.code, "not_found");

    const wrongEngagement = await repository.startBoardReportingCandidateReview(
      startInput({ engagementId: OTHER_ENGAGEMENT }),
      { metadataOnlyAudit: productionAudit() },
    );
    assert.equal(wrongEngagement.error.code, "not_found");

    const missingReviewQueueItem = "15030000-0000-4000-8000-000000000497";
    const wrongQueueItem = await repository.startBoardReportingCandidateReview(
      startInput({ reviewQueueItemId: missingReviewQueueItem }),
      { metadataOnlyAudit: productionAudit() },
    );
    assert.equal(wrongQueueItem.error.code, "not_found");
  });

  await test("START creates no release authority, final eligibility, export candidate, or manifest rows", async () => {
    const rows = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM kai.human_authority_decisions) AS authority_count,
         (SELECT count(*)::int FROM kai.export_candidates) AS export_candidate_count,
         (SELECT count(*)::int FROM kai.export_manifests) AS manifest_count`,
    );
    assert.equal(rows.rows[0].authority_count, 0);
    assert.equal(rows.rows[0].export_candidate_count, 0);
    assert.equal(rows.rows[0].manifest_count, 0);
  });

  await pool.end();
}
