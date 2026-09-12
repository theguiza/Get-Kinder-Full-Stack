import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_BR_03A_BOARD_REPORTING_CANDIDATE_REVIEW_REQUEST_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`BR-03A suite refused non-loopback database URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("BR-03A board-reporting-candidate review request integration requires the runner-owned database", { skip: true }, () => {});
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
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const ENGAGEMENT = "15030000-0000-4000-8000-000000000101";
  const OTHER_ENGAGEMENT = "15030000-0000-4000-8000-000000000102";
  const CANDIDATE = "15030000-0000-4000-8000-000000000311";
  const OTHER_CANDIDATE = "15030000-0000-4000-8000-000000000312";
  const MISSING_CANDIDATE = "15030000-0000-4000-8000-000000000399";
  const DRAFT_A = "15030000-0000-4000-8000-000000000201";
  const DRAFT_B = "15030000-0000-4000-8000-000000000202";
  const ACTOR = { actorType: "human", actorUserId: "90000000-0000-4000-8000-000000000001" };
  const NOW = "2026-09-12T12:00:00.000Z";
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

  async function seedOrganization(tx, orgId, engagementId) {
    await tx.query(
      `INSERT INTO kai.organizations (organization_id, name, organization_code)
       VALUES ($1::uuid, $2, $3) ON CONFLICT (organization_id) DO NOTHING`,
      [orgId, `BR-03A Org ${orgId.slice(-4)}`, `br-03a-${orgId.slice(-4)}`],
    );
    await tx.query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
       VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT (engagement_id) DO NOTHING`,
      [engagementId, orgId, `br-03a-engagement-${engagementId.slice(-4)}`],
    );
  }

  async function seedDraft(tx, draftId, index) {
    const runId = `15030000-0000-4000-8000-0000000001${index}1`;
    await tx.query(
      `INSERT INTO kai.generation_runs (
         generation_run_id, organization_id, idempotency_key, request_fingerprint, content_type, requested_audience, engagement_id
       )
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'internal', $6::uuid)
       ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
      [runId, ORG, `br-03a-run-${draftId}`, "a".repeat(64), index % 2 === 0 ? "evidence_summary" : "impact_narrative", ENGAGEMENT],
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

  async function seedCandidate(tx, {
    candidateId = CANDIDATE,
    orgId = ORG,
    engagementId = ENGAGEMENT,
    idempotencyKey = "br-03a-candidate",
    fingerprint = FINGERPRINT,
    draftIds = [DRAFT_A, DRAFT_B],
  } = {}) {
    await tx.query(
      `INSERT INTO kai.board_reporting_candidates (
         board_reporting_candidate_id, organization_id, engagement_id, packet_audience,
         idempotency_key, fingerprint_contract_version, canonical_fingerprint,
         candidate_status, created_by, created_by_type, created_at
       )
       VALUES ($1::uuid,$2::uuid,$3::uuid,'internal',$4,
         'kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1',$5,
         'created',$6::uuid,'human',$7::timestamptz)
       ON CONFLICT (organization_id, engagement_id, idempotency_key) DO NOTHING`,
      [candidateId, orgId, engagementId, idempotencyKey, fingerprint, ACTOR.actorUserId, NOW],
    );
    for (let ordinal = 0; ordinal < draftIds.length; ordinal += 1) {
      await tx.query(
        `INSERT INTO kai.board_reporting_candidate_members (
           board_reporting_candidate_id, organization_id, generated_content_draft_id, ordinal, created_at
         )
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::timestamptz)
         ON CONFLICT (board_reporting_candidate_id, generated_content_draft_id) DO NOTHING`,
        [candidateId, orgId, draftIds[ordinal], ordinal, NOW],
      );
    }
  }

  await withRunnerOwnedTransaction(async (tx) => {
    await seedOrganization(tx, ORG, ENGAGEMENT);
    await seedOrganization(tx, OTHER_ORG, OTHER_ENGAGEMENT);
    await seedDraft(tx, DRAFT_A, 0);
    await seedDraft(tx, DRAFT_B, 1);
    await seedCandidate(tx);
    await seedCandidate(tx, {
      candidateId: OTHER_CANDIDATE,
      orgId: OTHER_ORG,
      engagementId: OTHER_ENGAGEMENT,
      idempotencyKey: "br-03a-other-candidate",
      draftIds: [],
    });
  });

  await test("valid Board candidate review request creates one open / needs_gk_review row, preserves fingerprint, and writes metadata-only audit", async () => {
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

    const result = await repository.requestBoardReportingCandidateReview({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: CANDIDATE,
      actorContext: ACTOR,
      now: NOW,
    }, { metadataOnlyAudit: productionAudit() });

    assert.equal(result.ok, true);
    assert.equal(result.data.boardReportingCandidateId, CANDIDATE);
    assert.equal(result.data.canonicalFingerprint, FINGERPRINT);
    assert.equal(result.data.queueStatus, "open");
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
      [result.data.reviewQueueItemId],
    );
    assert.deepEqual(queue.rows[0], {
      queue_type: "board_reporting_candidate_review",
      target_object_type: "board_reporting_candidate",
      target_object_id: CANDIDATE,
      queue_status: "open",
      review_status: "needs_gk_review",
    });

    const audits = await pool.query(
      `SELECT action, metadata
         FROM kai.audit_events
        WHERE organization_id = $1::uuid
          AND action = 'board_reporting_candidate_review_requested'
        ORDER BY metadata->>'created_at' DESC`,
      [ORG],
    );
    assert.equal(audits.rows.length, 1);
    assert.equal(audits.rows[0].metadata.metadata_only, true);
    assert.equal(audits.rows[0].metadata.board_reporting_candidate_id, CANDIDATE);
    assert.equal(audits.rows[0].metadata.review_queue_item_id, result.data.reviewQueueItemId);
    assert.equal(audits.rows[0].metadata.canonical_fingerprint, FINGERPRINT);
    assert.equal(audits.rows[0].metadata.contains_prompt_text, false);
    assert.equal(audits.rows[0].metadata.contains_unsafe_generated_text, false);
  });

  await test("identical request replays the repository-owned row without duplicate audit or review item", async () => {
    const repository = makeRepository();
    const replay = await repository.requestBoardReportingCandidateReview({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: CANDIDATE,
      actorContext: ACTOR,
      now: NOW,
    }, { metadataOnlyAudit: productionAudit() });
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);

    const counts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM kai.review_queue_items WHERE queue_type = 'board_reporting_candidate_review' AND target_object_id = $1::uuid) AS queue_count,
         (SELECT count(*)::int FROM kai.audit_events WHERE action = 'board_reporting_candidate_review_requested') AS audit_count`,
      [CANDIDATE],
    );
    assert.equal(counts.rows[0].queue_count, 1);
    assert.equal(counts.rows[0].audit_count, 1);
  });

  await test("wrong organization, cross tenant, and missing candidate all fail closed", async () => {
    const repository = makeRepository();
    const wrongOrg = await repository.requestBoardReportingCandidateReview({
      organizationId: OTHER_ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: CANDIDATE,
      actorContext: ACTOR,
      now: NOW,
    }, { metadataOnlyAudit: productionAudit() });
    assert.equal(wrongOrg.error.code, "not_found");

    const crossTenant = await repository.requestBoardReportingCandidateReview({
      organizationId: ORG,
      engagementId: OTHER_ENGAGEMENT,
      boardReportingCandidateId: OTHER_CANDIDATE,
      actorContext: ACTOR,
      now: NOW,
    }, { metadataOnlyAudit: productionAudit() });
    assert.equal(crossTenant.error.code, "not_found");

    const missing = await repository.requestBoardReportingCandidateReview({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: MISSING_CANDIDATE,
      actorContext: ACTOR,
      now: NOW,
    }, { metadataOnlyAudit: productionAudit() });
    assert.equal(missing.error.code, "not_found");
  });

  await test("request creates no release authority, final eligibility, export candidate, or manifest rows", async () => {
    const rows = await pool.query(
      `SELECT
         to_regclass('kai.human_authority_decisions')::text AS human_authority_decisions,
         to_regclass('kai.export_candidates')::text AS export_candidates,
         to_regclass('kai.export_manifests')::text AS export_manifests,
         (SELECT count(*)::int FROM kai.human_authority_decisions) AS authority_count,
         (SELECT count(*)::int FROM kai.export_candidates) AS export_candidate_count,
         (SELECT count(*)::int FROM kai.export_manifests) AS manifest_count`,
    );
    assert.equal(rows.rows[0].human_authority_decisions, "kai.human_authority_decisions");
    assert.equal(rows.rows[0].export_candidates, "kai.export_candidates");
    assert.equal(rows.rows[0].export_manifests, "kai.export_manifests");
    assert.equal(rows.rows[0].authority_count, 0);
    assert.equal(rows.rows[0].export_candidate_count, 0);
    assert.equal(rows.rows[0].manifest_count, 0);
  });

  await pool.end();
}
