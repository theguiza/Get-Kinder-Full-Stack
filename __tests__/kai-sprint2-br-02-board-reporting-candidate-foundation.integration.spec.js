import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_BR_02_BOARD_REPORTING_CANDIDATE_FOUNDATION_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`BR-02 suite refused non-loopback database URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("BR-02 board-reporting-candidate integration requires the runner-owned database", { skip: true }, () => {});
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
    composeBoardReportingPacketFingerprint,
  } = await import("../Backend/kai/services/kaiBoardReportingPacketFingerprintService.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const ENGAGEMENT = "15020000-0000-4000-8000-000000000101";
  const OTHER_ENGAGEMENT = "15020000-0000-4000-8000-000000000102";
  const DRAFT_A = "15020000-0000-4000-8000-000000000201";
  const DRAFT_B = "15020000-0000-4000-8000-000000000202";
  const DRAFT_C = "15020000-0000-4000-8000-000000000203";
  const ACTOR = { actorType: "human", actorUserId: "00000000-0000-4000-8000-000000000910" };
  const NOW = "2026-09-12T12:00:00.000Z";

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

  const noopAudit = Object.freeze({
    prepareMetadataOnlyAudit({ payload } = {}) {
      if (!payload?.board_reporting_candidate_id) return { ok: false };
      return { ok: true, async publish() { return { ok: true }; } };
    },
  });

  function citation(index, overrides = {}) {
    return {
      claimId: `15020000-0000-4000-8000-0000000003${index}1`,
      evidenceItemId: `15020000-0000-4000-8000-0000000003${index}2`,
      sourceId: `15020000-0000-4000-8000-0000000003${index}3`,
      sourceVersionId: `15020000-0000-4000-8000-0000000003${index}4`,
      generatedContentCitationId: `15020000-0000-4000-8000-0000000003${index}5`,
      supportStrength: "strong",
      claimReviewStatus: "approved",
      evidenceReviewStatus: "approved",
      currentEligible: true,
      blockerCodes: [],
      affectedDimensionKeys: [],
      affectedObjectIds: [],
      ...overrides,
    };
  }

  function renderModel({ engagementId = ENGAGEMENT, draftIds = [DRAFT_A, DRAFT_B], audience = "internal", blockerCodes = [] } = {}) {
    return {
      ok: true,
      data: {
        renderModelContractVersion: "kai-sprint2-board-reporting-render-model-v1",
        organizationId: ORG,
        engagementId,
        packetAudience: audience,
        supportedContentTypes: ["evidence_summary", "impact_narrative"],
        members: draftIds.map((draftId, index) => ({
          generationRunId: `15020000-0000-4000-8000-0000000001${index + 1}1`,
          generatedContentDraftId: draftId,
          contentType: index % 2 === 0 ? "evidence_summary" : "impact_narrative",
          draftStatus: "draft",
          requestedAudience: audience,
          reviewQueueItemId: `15020000-0000-4000-8000-0000000004${index}1`,
          queueStatus: "resolved",
          reviewStatus: "resolved",
          reviewUpdatedAt: NOW,
          currentUseEligible: true,
          blocks: [{
            ordinal: 0,
            generatedContentBlockId: `15020000-0000-4000-8000-0000000005${index}1`,
            text: "not stored in BR-02",
            citations: [citation(index, { blockerCodes })],
          }],
        })),
      },
      error: null,
    };
  }

  async function seedEngagementAndDrafts(tx, { orgId = ORG, engagementId = ENGAGEMENT, draftIds = [DRAFT_A, DRAFT_B, DRAFT_C] } = {}) {
    await tx.query(
      `INSERT INTO kai.organizations (organization_id, name, organization_code)
       VALUES ($1::uuid, $2, $3) ON CONFLICT (organization_id) DO NOTHING`,
      [orgId, `BR-02 Org ${orgId}`, `br-02-${orgId.slice(-4)}`],
    );
    await tx.query(
      `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
       VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT (engagement_id) DO NOTHING`,
      [engagementId, orgId, `br-02-engagement-${engagementId.slice(-4)}`],
    );
    for (let index = 0; index < draftIds.length; index += 1) {
      const draftId = draftIds[index];
      const runId = `15020000-0000-4000-8000-${String(Number(draftId.slice(-12)) + 1000).padStart(12, "0")}`;
      await tx.query(
        `INSERT INTO kai.generation_runs (
           generation_run_id, organization_id, idempotency_key, request_fingerprint, content_type, requested_audience, engagement_id
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'internal', $6::uuid)
         ON CONFLICT (organization_id, idempotency_key) DO NOTHING`,
        [runId, orgId, `br-02-run-${draftId}`, "a".repeat(64), index % 2 === 0 ? "evidence_summary" : "impact_narrative", engagementId],
      );
      await tx.query(
        `INSERT INTO kai.generated_content_drafts (
           generated_content_draft_id, generation_run_id, organization_id, content_type, requested_audience, validator_results
         )
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'internal', '[]'::jsonb)
         ON CONFLICT (generated_content_draft_id) DO NOTHING`,
        [draftId, runId, orgId, index % 2 === 0 ? "evidence_summary" : "impact_narrative"],
      );
    }
  }

  await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx));
  await withRunnerOwnedTransaction((tx) => seedEngagementAndDrafts(tx, {
    orgId: OTHER_ORG,
    engagementId: OTHER_ENGAGEMENT,
    draftIds: ["15020000-0000-4000-8000-000000000901"],
  }));

  await test("valid current Board packet creates an internal candidate with server-derived ordered members and fingerprint", async () => {
    const repository = makeRepository();
    const model = renderModel();
    const expected = composeBoardReportingPacketFingerprint(model.data);
    const result = await repository.createBoardReportingCandidate(
      { organizationId: ORG, engagementId: ENGAGEMENT, idempotencyKey: "br-02-valid-create", actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => model },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.packetAudience, "internal");
    assert.equal(result.data.canonicalFingerprint, expected.fingerprint);
    assert.deepEqual(result.data.memberGeneratedContentDraftIds, [DRAFT_A, DRAFT_B]);

    const rows = await pool.query(
      `SELECT generated_content_draft_id::text AS draft_id, ordinal
         FROM kai.board_reporting_candidate_members
        WHERE board_reporting_candidate_id = $1::uuid
        ORDER BY ordinal`,
      [result.data.boardReportingCandidateId],
    );
    assert.deepEqual(rows.rows.map((row) => row.draft_id), [DRAFT_A, DRAFT_B]);
    assert.deepEqual(rows.rows.map((row) => row.ordinal), [0, 1]);
  });

  await test("fake client member and fingerprint fields cannot become authoritative", async () => {
    const repository = makeRepository();
    const result = await repository.createBoardReportingCandidate(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        idempotencyKey: "br-02-fake-client",
        actorContext: ACTOR,
        now: NOW,
        generatedContentDraftIds: [DRAFT_C],
        canonicalFingerprint: "f".repeat(64),
      },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => renderModel({ draftIds: [DRAFT_A] }) },
    );
    assert.equal(result.error.code, "validation_blocker");
  });

  await test("cross-tenant engagement input is blocked", async () => {
    const repository = makeRepository();
    const result = await repository.createBoardReportingCandidate(
      { organizationId: ORG, engagementId: OTHER_ENGAGEMENT, idempotencyKey: "br-02-cross-tenant", actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => renderModel({ engagementId: OTHER_ENGAGEMENT, draftIds: [DRAFT_A] }) },
    );
    assert.equal(result.error.code, "not_found");
  });

  await test("identical replay returns the same candidate and conflicting replay fails closed", async () => {
    const repository = makeRepository();
    const input = { organizationId: ORG, engagementId: ENGAGEMENT, idempotencyKey: "br-02-replay-key", actorContext: ACTOR, now: NOW };
    const first = await repository.createBoardReportingCandidate(input, {
      metadataOnlyAudit: noopAudit,
      composeRenderModel: async () => renderModel({ draftIds: [DRAFT_A] }),
    });
    const second = await repository.createBoardReportingCandidate(input, {
      metadataOnlyAudit: noopAudit,
      composeRenderModel: async () => renderModel({ draftIds: [DRAFT_A] }),
    });
    const conflict = await repository.createBoardReportingCandidate(input, {
      metadataOnlyAudit: noopAudit,
      composeRenderModel: async () => renderModel({ draftIds: [DRAFT_B] }),
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.boardReportingCandidateId, first.data.boardReportingCandidateId);
    assert.equal(conflict.error.code, "conflict_current_state_changed");
  });

  await test("authoritative-state race fails closed and persists no stale candidate", async () => {
    const repository = makeRepository();
    let calls = 0;
    const result = await repository.createBoardReportingCandidate(
      { organizationId: ORG, engagementId: ENGAGEMENT, idempotencyKey: "br-02-race-key", actorContext: ACTOR, now: NOW },
      {
        metadataOnlyAudit: noopAudit,
        composeRenderModel: async () => {
          calls += 1;
          return calls === 1 ? renderModel({ draftIds: [DRAFT_A] }) : renderModel({ draftIds: [DRAFT_A, DRAFT_B] });
        },
      },
    );
    assert.equal(result.error.code, "conflict_current_state_changed");
    const rows = await pool.query(
      `SELECT count(*)::int AS count FROM kai.board_reporting_candidates WHERE idempotency_key = 'br-02-race-key'`,
    );
    assert.equal(rows.rows[0].count, 0);
  });

  await test("candidate read preserves original immutable member snapshot after later current packet change", async () => {
    const repository = makeRepository();
    const created = await repository.createBoardReportingCandidate(
      { organizationId: ORG, engagementId: ENGAGEMENT, idempotencyKey: "br-02-read-immutable", actorContext: ACTOR, now: NOW },
      { metadataOnlyAudit: noopAudit, composeRenderModel: async () => renderModel({ draftIds: [DRAFT_A] }) },
    );
    assert.equal(created.ok, true);
    const read = await repository.readBoardReportingCandidate({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: created.data.boardReportingCandidateId,
    });
    assert.equal(read.ok, true);
    assert.deepEqual(read.data.members.map((member) => member.generatedContentDraftId), [DRAFT_A]);

    const laterCurrent = renderModel({ draftIds: [DRAFT_A, DRAFT_B, DRAFT_C] });
    assert.notDeepEqual(
      laterCurrent.data.members.map((member) => member.generatedContentDraftId),
      read.data.members.map((member) => member.generatedContentDraftId),
    );
    const readAgain = await repository.readBoardReportingCandidate({
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      boardReportingCandidateId: created.data.boardReportingCandidateId,
    });
    assert.deepEqual(readAgain.data.members.map((member) => member.generatedContentDraftId), [DRAFT_A]);
  });

  await test("DB append-only trigger rejects candidate/member mutation", async () => {
    const candidateId = "15020000-0000-4000-8000-000000000301";
    await assert.rejects(
      () => pool.query(
        `UPDATE kai.board_reporting_candidates SET candidate_status = 'changed'
          WHERE board_reporting_candidate_id = $1::uuid`,
        [candidateId],
      ),
      /append-only/,
    );
    await pool.end();
  });
}
