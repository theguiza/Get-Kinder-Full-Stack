import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P14_13_GENERATION_REPLAY_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P14-13 integration suite refused a non-loopback KAI_P14_13_GENERATION_REPLAY_DATABASE_URL host: ${host}`);
  }
}

test("P14-13 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P14-13 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresGeneratedContentRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P14-13 generation-replay-lifecycle integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const {
    createPostgresGeneratedContentRepository,
    fingerprintEvidenceSummaryRequest,
  } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const {
    createEvidenceSummaryDraft,
    startGeneratedContentReview,
    completeGeneratedContentReview,
  } = await import("../Backend/kai/services/kaiGeneratedContentService.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000099";
  const ENGAGEMENT = "00000000-0000-4000-8000-000000000913";
  const OTHER_ENGAGEMENT = "00000000-0000-4000-8000-000000000914";
  const NOW = "2026-08-06T10:00:00.000Z";
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

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }

  async function getEngagementForOrganization({ organizationId, engagementId }) {
    const rows = await query(
      `SELECT engagement_id::text AS engagement_id, organization_id::text AS organization_id
         FROM kai.engagements
        WHERE organization_id = $1::uuid AND engagement_id = $2::uuid`,
      [organizationId, engagementId],
    );
    return rows[0] || null;
  }

  const actorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000913",
    source: "public.userdata",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
      { organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_reviewer" },
    ],
  };

  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  // P14-09: funder-audience generation requires eligible=true from the fresh
  // per-claim traceability evaluator, both pre- and post-generation.
  function funderEligibleEvaluator() {
    return async (tx, evalInput) => {
      const rows = await tx.query(
        `SELECT claim_id::text AS claim_id, evidence_item_id::text AS evidence_item_id
           FROM kai.claims
          WHERE organization_id = $1::uuid
            AND claim_id = $2::uuid`,
        [evalInput.organizationId, evalInput.claimId],
      );
      const claim = rows.rows[0];
      return {
        ok: true,
        data: {
          claim: { claim_id: claim.claim_id },
          evidence: { evidence_item_id: claim.evidence_item_id },
          requestedAudience: evalInput.requestedAudience,
          eligible: true,
          blockerCodes: [],
        },
        error: null,
      };
    };
  }

  let generatorCallCount = 0;
  function draftGenerator() {
    return async (genInput) => {
      generatorCallCount += 1;
      return {
        blocks: [{
          ordinal: 1,
          text: genInput.claims[0].claimStatement,
          citations: [{ claimId: genInput.claims[0].claimId, evidenceItemId: genInput.claims[0].evidenceItemId }],
        }],
      };
    };
  }

  function readPacketEvaluator({ evidenceItemId } = {}) {
    return async (tx, evalInput) => ({
      ok: true,
      data: {
        claim: {
          claim_id: evalInput.claimId,
          claim_type: "finding",
          claim_status: "proposed",
          claim_review_status: "approved",
          claim_strength: "unassessed",
          audience_gates: {},
        },
        evidence: {
          evidence_item_id: evidenceItemId,
          evidence_review_status: "approved",
          support_strength: "unassessed",
          review_queue_item_id: "10000000-0000-4000-8000-000000000931",
          review_queue_status: "open",
          review_status: "approved",
          updated_at: "2026-08-06T09:00:00.000Z",
          sensitivity_level: "unknown",
        },
        locator: { source_locator_id: "10000000-0000-4000-8000-000000000932" },
        source: { source_id: "10000000-0000-4000-8000-000000000933", source_code: null },
        source_version: { source_version_id: "10000000-0000-4000-8000-000000000934", is_current: true },
        claim_review: { review_queue_item_id: "10000000-0000-4000-8000-000000000935", queue_status: "open", review_status: "approved" },
        evidence_review_decision: null,
        claim_review_decision: null,
        graph_relationships: [{
          relationship_type: "claim_evidence",
          from_object_type: "claim",
          from_object_id: evalInput.claimId,
          to_object_type: "evidence_item",
          to_object_id: evidenceItemId,
        }],
        graph_trace_completeness: { complete: true, missing_relationship_types: [], invalid_relationship_count: 0 },
        candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000933" },
        promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000936" },
        dimensions: {},
        gap_items: [],
        client_followup_workflows: [],
        potential_conflict_groups: [],
        requestedAudience: evalInput.requestedAudience,
        eligible: true,
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
        truncated: false,
      },
      error: null,
    });
  }

  async function currentUpdatedAt(reviewQueueItemId) {
    const rows = await query(
      `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [reviewQueueItemId],
    );
    return rows[0].updated_at.toISOString();
  }

  async function countRows(table, whereSql, params) {
    const rows = await query(`SELECT count(*)::int AS count FROM ${table} WHERE ${whereSql}`, params);
    return rows[0].count;
  }

  test.after(async () => {
    await pool.end();
  });

  await query(
    `INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, 'P14-13 Replay Org', 'p14-13-replay-org') ON CONFLICT (organization_id) DO NOTHING;`,
    [ORG],
  );
  await query(
    `INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, 'P14-13 Replay Other Org', 'p14-13-replay-other-org') ON CONFLICT (organization_id) DO NOTHING;`,
    [OTHER_ORG],
  );
  await query(
    `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ($1::uuid, $2::uuid, 'P14-13-REPLAY') ON CONFLICT (engagement_id) DO NOTHING;`,
    [ENGAGEMENT, ORG],
  );
  await query(
    `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ($1::uuid, $2::uuid, 'P14-13-REPLAY-OTHER') ON CONFLICT (engagement_id) DO NOTHING;`,
    [OTHER_ENGAGEMENT, ORG],
  );

  let claimSuffix = 0;
  async function buildFunderClaim({ organizationId = ORG } = {}) {
    claimSuffix += 1;
    const suffix = String(claimSuffix).padStart(2, "0");
    const evidenceId = `9c130000-0000-4000-8000-0000000001${suffix}`;
    const claimId = `9c130000-0000-4000-8000-0000000002${suffix}`;

    const [sourceEvidence] = await query(
      `SELECT evidence_item_id::text AS evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id ASC LIMIT 1`,
      [organizationId],
    );
    await query(
      `INSERT INTO kai.evidence_items (
         evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
         evidence_type, data_class, sensitivity_level, support_strength, statement,
         statement_fingerprint, created_by_type
       )
       SELECT $1::uuid, organization_id, source_id, source_version_id, source_locator_id,
              evidence_type, data_class, sensitivity_level, support_strength,
              'Synthetic P14-13 generation-replay evidence item.', $3, created_by_type
         FROM kai.evidence_items
        WHERE evidence_item_id = $2::uuid`,
      [evidenceId, sourceEvidence.evidence_item_id, "a".repeat(62) + suffix],
    );
    await query(
      `INSERT INTO kai.claims (
         claim_id, organization_id, evidence_item_id, claim_type, claim_status,
         claim_review_status, claim_strength, statement, statement_fingerprint,
         created_by_type
       )
       VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review',
               'unassessed','Synthetic P14-13 generation-replay claim.',
               $4,'system')`,
      [claimId, organizationId, evidenceId, "b".repeat(62) + suffix],
    );
    await query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
      [organizationId, claimId, evidenceId],
    );
    return { claimId, evidenceId };
  }

  const enabledEnv = { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" };

  function repository() {
    return createPostgresGeneratedContentRepository({
      runInTransaction: withRunnerOwnedTransaction,
      evaluator: funderEligibleEvaluator(),
    });
  }

  test("P14-13 first request: generation succeeds with one run, one draft, expected blocks/citations, review queue, and audit", async () => {
    const { claimId } = await buildFunderClaim();
    const idempotencyKey = "p14-13-first-request";

    const auditsBefore = await countRows("kai.upload_lifecycle_audit", "operation = 'generated_content_draft_created'", []);
    const callsBefore = generatorCallCount;

    const result = await createEvidenceSummaryDraft(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        requestedAudience: "funder",
        claimIds: [claimId],
        idempotencyKey,
        actorContext,
        now: NOW,
      },
      {
        env: enabledEnv,
        getEngagementForOrganization,
        generatedContentRepository: repository(),
        draftGenerator: draftGenerator(),
        metadataOnlyAudit: auditRecorder(),
      },
    );

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.replayed, false);
    assert.equal(generatorCallCount, callsBefore + 1);

    const runCount = await countRows("kai.generation_runs", "organization_id = $1::uuid AND idempotency_key = $2", [ORG, idempotencyKey]);
    assert.equal(runCount, 1);
    const draftCount = await countRows("kai.generated_content_drafts", "generation_run_id = (SELECT generation_run_id FROM kai.generation_runs WHERE organization_id = $1::uuid AND idempotency_key = $2)", [ORG, idempotencyKey]);
    assert.equal(draftCount, 1);
    const blockCount = await countRows("kai.generated_content_blocks", "generated_content_draft_id = $1::uuid", [result.data.generatedContentDraftId]);
    assert.equal(blockCount, 1);
    const citationCount = await countRows("kai.generated_content_citations", "generated_content_block_id IN (SELECT generated_content_block_id FROM kai.generated_content_blocks WHERE generated_content_draft_id = $1::uuid)", [result.data.generatedContentDraftId]);
    assert.equal(citationCount, 1);
    const queueCount = await countRows("kai.review_queue_items", "target_object_type = 'generated_content_draft' AND target_object_id = $1::uuid AND queue_status = 'open' AND review_status = 'needs_gk_review'", [result.data.generatedContentDraftId]);
    assert.equal(queueCount, 1);
    const auditsAfter = await countRows("kai.upload_lifecycle_audit", "operation = 'generated_content_draft_created'", []);
    assert.equal(auditsAfter, auditsBefore + 1);
  });

  test("P14-13 exact replay before review: same key/request succeeds with the same run/draft and zero generator calls", async () => {
    const { claimId } = await buildFunderClaim();
    const idempotencyKey = "p14-13-replay-before-review";
    const input = {
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      requestedAudience: "funder",
      claimIds: [claimId],
      idempotencyKey,
      actorContext,
      now: NOW,
    };
    const deps = {
      env: enabledEnv,
      getEngagementForOrganization,
      generatedContentRepository: repository(),
      draftGenerator: draftGenerator(),
      metadataOnlyAudit: auditRecorder(),
    };

    const fresh = await createEvidenceSummaryDraft(input, deps);
    assert.equal(fresh.ok, true, JSON.stringify(fresh));
    assert.equal(fresh.data.replayed, false);

    const callsBefore = generatorCallCount;
    const auditsBefore = await countRows("kai.upload_lifecycle_audit", "operation = 'generated_content_draft_created'", []);

    const replay = await createEvidenceSummaryDraft(input, deps);
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.generationRunId, fresh.data.generationRunId);
    assert.equal(replay.data.generatedContentDraftId, fresh.data.generatedContentDraftId);
    assert.equal(generatorCallCount, callsBefore);

    const auditsAfter = await countRows("kai.upload_lifecycle_audit", "operation = 'generated_content_draft_created'", []);
    assert.equal(auditsAfter, auditsBefore);
    const draftCount = await countRows("kai.generated_content_drafts", "generation_run_id = $1::uuid", [fresh.data.generationRunId]);
    assert.equal(draftCount, 1);
  });

  test("P14-13 exact replay AFTER review START: same key/request succeeds with the same run/draft, zero generator calls, no duplicate rows", async () => {
    const { claimId, evidenceId } = await buildFunderClaim();
    const idempotencyKey = "p14-13-replay-after-start";
    const input = {
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      requestedAudience: "funder",
      claimIds: [claimId],
      idempotencyKey,
      actorContext,
      now: NOW,
    };
    const deps = {
      env: enabledEnv,
      getEngagementForOrganization,
      generatedContentRepository: repository(),
      draftGenerator: draftGenerator(),
      metadataOnlyAudit: auditRecorder(),
    };

    const fresh = await createEvidenceSummaryDraft(input, deps);
    assert.equal(fresh.ok, true, JSON.stringify(fresh));
    const draftId = fresh.data.generatedContentDraftId;
    const queueId = fresh.data.reviewQueueItemId;

    const expectedUpdatedAt = await currentUpdatedAt(queueId);
    const startResult = await startGeneratedContentReview(
      { organizationId: ORG, generatedContentDraftId: draftId, reviewQueueItemId: queueId, expectedUpdatedAt, actorContext, now: NOW },
      {
        env: enabledEnv,
        generatedContentRepository: createPostgresGeneratedContentRepository({
          runInTransaction: withRunnerOwnedTransaction,
          evaluator: readPacketEvaluator({ evidenceItemId: evidenceId }),
        }),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(startResult.ok, true, JSON.stringify(startResult));
    assert.equal(startResult.data.queueStatus, "in_progress");
    assert.equal(startResult.data.reviewStatus, "needs_gk_review");

    const queueRows = await query(
      `SELECT queue_status, review_status FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [queueId],
    );
    assert.equal(queueRows[0].queue_status, "in_progress");
    assert.equal(queueRows[0].review_status, "needs_gk_review");

    const callsBefore = generatorCallCount;
    const auditsBefore = await countRows("kai.upload_lifecycle_audit", "operation = 'generated_content_draft_created'", []);
    const draftCountBefore = await countRows("kai.generated_content_drafts", "generation_run_id = $1::uuid", [fresh.data.generationRunId]);

    // THE DEFECT: pre-repair, this replay returned 409 conflict_current_state_changed
    // because validateExistingState's queue-lifecycle check defaulted to
    // allowedLifecycleProfiles=[open/needs_gk_review only].
    const replay = await createEvidenceSummaryDraft(input, deps);
    assert.equal(replay.ok, true, `expected exact replay after review start to succeed, got: ${JSON.stringify(replay)}`);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.generationRunId, fresh.data.generationRunId);
    assert.equal(replay.data.generatedContentDraftId, draftId);
    assert.equal(generatorCallCount, callsBefore, "replay after review start must not invoke the generator");

    const auditsAfter = await countRows("kai.upload_lifecycle_audit", "operation = 'generated_content_draft_created'", []);
    assert.equal(auditsAfter, auditsBefore, "replay after review start must not write a duplicate generation audit");
    const draftCountAfter = await countRows("kai.generated_content_drafts", "generation_run_id = $1::uuid", [fresh.data.generationRunId]);
    assert.equal(draftCountAfter, draftCountBefore, "replay after review start must not create a duplicate draft");

    const queueRowsAfterReplay = await query(
      `SELECT queue_status, review_status FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [queueId],
    );
    assert.equal(queueRowsAfterReplay[0].queue_status, "in_progress", "replay must not revert review progress");
    assert.equal(queueRowsAfterReplay[0].review_status, "needs_gk_review");
  });

  test("P14-13 exact replay AFTER review COMPLETION: same key/request succeeds with the same run/draft, zero generator calls, no duplicate rows", async () => {
    const { claimId, evidenceId } = await buildFunderClaim();
    const idempotencyKey = "p14-13-replay-after-complete";
    const input = {
      organizationId: ORG,
      engagementId: ENGAGEMENT,
      requestedAudience: "funder",
      claimIds: [claimId],
      idempotencyKey,
      actorContext,
      now: NOW,
    };
    const deps = {
      env: enabledEnv,
      getEngagementForOrganization,
      generatedContentRepository: repository(),
      draftGenerator: draftGenerator(),
      metadataOnlyAudit: auditRecorder(),
    };

    const fresh = await createEvidenceSummaryDraft(input, deps);
    assert.equal(fresh.ok, true, JSON.stringify(fresh));
    const draftId = fresh.data.generatedContentDraftId;
    const queueId = fresh.data.reviewQueueItemId;

    const packetRepo = createPostgresGeneratedContentRepository({
      runInTransaction: withRunnerOwnedTransaction,
      evaluator: readPacketEvaluator({ evidenceItemId: evidenceId }),
    });

    const expectedUpdatedAtStart = await currentUpdatedAt(queueId);
    const startResult = await startGeneratedContentReview(
      { organizationId: ORG, generatedContentDraftId: draftId, reviewQueueItemId: queueId, expectedUpdatedAt: expectedUpdatedAtStart, actorContext, now: NOW },
      { env: enabledEnv, generatedContentRepository: packetRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(startResult.ok, true, JSON.stringify(startResult));

    const expectedUpdatedAtComplete = await currentUpdatedAt(queueId);
    const completeResult = await completeGeneratedContentReview(
      { organizationId: ORG, generatedContentDraftId: draftId, reviewQueueItemId: queueId, expectedUpdatedAt: expectedUpdatedAtComplete, actorContext, now: NOW },
      { env: enabledEnv, generatedContentRepository: packetRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(completeResult.ok, true, JSON.stringify(completeResult));
    assert.equal(completeResult.data.queueStatus, "resolved");
    assert.equal(completeResult.data.reviewStatus, "resolved");

    const callsBefore = generatorCallCount;
    const draftCountBefore = await countRows("kai.generated_content_drafts", "generation_run_id = $1::uuid", [fresh.data.generationRunId]);

    const replay = await createEvidenceSummaryDraft(input, deps);
    assert.equal(replay.ok, true, `expected exact replay after review completion to succeed, got: ${JSON.stringify(replay)}`);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.generationRunId, fresh.data.generationRunId);
    assert.equal(replay.data.generatedContentDraftId, draftId);
    assert.equal(generatorCallCount, callsBefore, "replay after review completion must not invoke the generator");

    const draftCountAfter = await countRows("kai.generated_content_drafts", "generation_run_id = $1::uuid", [fresh.data.generationRunId]);
    assert.equal(draftCountAfter, draftCountBefore, "replay after review completion must not create a duplicate draft");

    const queueRowsAfterReplay = await query(
      `SELECT queue_status, review_status FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [queueId],
    );
    assert.equal(queueRowsAfterReplay[0].queue_status, "resolved", "replay must not revert a completed review");
    assert.equal(queueRowsAfterReplay[0].review_status, "resolved");
  });

  test("P14-13 negative: same key + different request fingerprint (different claim set) fails closed as duplicate_conflict", async () => {
    const { claimId: claimA } = await buildFunderClaim();
    const { claimId: claimB } = await buildFunderClaim();
    const idempotencyKey = "p14-13-duplicate-conflict";
    const deps = {
      env: enabledEnv,
      getEngagementForOrganization,
      generatedContentRepository: repository(),
      draftGenerator: draftGenerator(),
      metadataOnlyAudit: auditRecorder(),
    };

    const first = await createEvidenceSummaryDraft(
      { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "funder", claimIds: [claimA], idempotencyKey, actorContext, now: NOW },
      deps,
    );
    assert.equal(first.ok, true, JSON.stringify(first));

    const second = await createEvidenceSummaryDraft(
      { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "funder", claimIds: [claimB], idempotencyKey, actorContext, now: NOW },
      deps,
    );
    assert.equal(second.ok, false);
    assert.equal(second.error.code, "duplicate_conflict");
  });

  // NOTE: engagementId is itself one of the inputs
  // fingerprintEvidenceSummaryRequest hashes into request_fingerprint (see
  // Backend/kai/dictionary/postgresGeneratedContentRepository.js
  // fingerprintGeneratedContentRequest). So "same idempotency_key, wrong
  // engagement" is not a distinct code path from "same key, different
  // fingerprint" - it is caught by the exact same duplicate_conflict check,
  // one line before the dedicated engagement_id comparison in
  // validateExistingState could ever run. That dedicated comparison (state.run
  // .engagement_id !== engagementId) is proven directly, in isolation, by the
  // boundary spec's "wrong engagement on the same key fails closed" test.
  test("P14-13 negative: same key + wrong engagement fails closed as duplicate_conflict (engagementId is part of the request fingerprint)", async () => {
    const { claimId } = await buildFunderClaim();
    const idempotencyKey = "p14-13-wrong-engagement";
    const deps = {
      env: enabledEnv,
      getEngagementForOrganization,
      generatedContentRepository: repository(),
      draftGenerator: draftGenerator(),
      metadataOnlyAudit: auditRecorder(),
    };

    const first = await createEvidenceSummaryDraft(
      { organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "funder", claimIds: [claimId], idempotencyKey, actorContext, now: NOW },
      deps,
    );
    assert.equal(first.ok, true, JSON.stringify(first));

    const second = await createEvidenceSummaryDraft(
      { organizationId: ORG, engagementId: OTHER_ENGAGEMENT, requestedAudience: "funder", claimIds: [claimId], idempotencyKey, actorContext, now: NOW },
      deps,
    );
    assert.equal(second.ok, false);
    assert.equal(second.error.code, "duplicate_conflict");
  });

  // A queue row belonging to a different organization, or an impossible
  // queue_status/review_status pairing, is proven fail-closed directly
  // against validateExistingState by the boundary spec
  // (__tests__/kai-sprint2-p14-13-generation-replay-lifecycle-boundary.spec.js)
  // rather than here: kai.review_queue_items itself carries the
  // review_queue_items_p3_04_generated_content_review_contract_check
  // database constraint, which already refuses any queue_status/review_status
  // pairing outside the three canonical profiles at the storage layer - a
  // genuine, independent defense-in-depth confirmed while building this
  // suite (a direct UPDATE to an impossible pairing is itself rejected with
  // SQLSTATE 23514 before application code ever runs). The boundary spec
  // proves the application-level validateExistingState check also fails
  // closed for that same impossible shape, in case that database constraint
  // is ever weakened.
}
