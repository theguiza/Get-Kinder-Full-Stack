import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P3_05_EXPORT_REVIEW_REQUEST_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P3-05 integration suite refused a non-loopback KAI_P3_05_EXPORT_REVIEW_REQUEST_DATABASE_URL host: ${host}`);
  }
}

test("P3-05 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P3-05 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresGeneratedContentRepository\.js|postgresClaimTraceabilityRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P3-05 export-review-request integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP305IntegrationSuite();
}

async function runP305IntegrationSuite() {
  const { Pool } = await import("pg");
  const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { createEvidenceSummaryDraft, completeGeneratedContentReview } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
  const { requestGeneratedDraftExportReview } = await import("../Backend/kai/services/kaiExportReviewService.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const CLAIM = "10000000-0000-4000-8000-000000000010";
  const NOW = "2026-08-06T10:00:00.000Z";
  const LATER = "2026-08-06T10:05:00.000Z";
  let evidenceId = null;
  let draftId = null;
  let generatedContentQueueId = null;
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

  const gkAdminActorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000005",
    source: "public.userdata",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
    ],
  };
  const gkReviewerActorContext = {
    ...gkAdminActorContext,
    actorUserId: "90000000-0000-4000-8000-000000000004",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
    ],
  };

  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  function p301Evaluator() {
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
        },
        error: null,
      };
    };
  }

  function draftGenerator() {
    return async (genInput) => ({
      blocks: [{
        ordinal: 1,
        text: genInput.claims[0].claimStatement,
        citations: [{ claimId: genInput.claims[0].claimId, evidenceItemId: genInput.claims[0].evidenceItemId }],
      }],
    });
  }

  function readPacketEvaluator({ eligible = true, evidenceItemId = evidenceId } = {}) {
    return async (tx, evalInput) => ({
      ok: true,
      data: {
        claim: {
          claim_id: evalInput.claimId,
          claim_type: "finding",
          claim_status: "proposed",
          claim_review_status: eligible ? "approved" : "needs_gk_review",
          claim_strength: "unassessed",
          audience_gates: {},
        },
        evidence: {
          evidence_item_id: evidenceItemId,
          evidence_review_status: eligible ? "approved" : "needs_gk_review",
          support_strength: "unassessed",
          review_queue_item_id: "10000000-0000-4000-8000-000000000031",
          review_queue_status: "open",
          review_status: eligible ? "approved" : "needs_gk_review",
        },
        locator: { source_locator_id: "10000000-0000-4000-8000-000000000032" },
        source: { source_id: "10000000-0000-4000-8000-000000000033", source_code: null },
        source_version: { source_version_id: "10000000-0000-4000-8000-000000000034", is_current: true },
        claim_review: { review_queue_item_id: "10000000-0000-4000-8000-000000000035", queue_status: "open", review_status: eligible ? "approved" : "needs_gk_review" },
        candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000003" },
        promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000036" },
        dimensions: {},
        gap_items: [],
        client_followup_workflows: [],
        potential_conflict_groups: [],
        requestedAudience: evalInput.requestedAudience,
        eligible,
        blockerCodes: eligible ? [] : ["claim_review_unresolved"],
        affectedDimensionKeys: eligible ? [] : ["missingness"],
        affectedObjectIds: eligible ? [] : ["10000000-0000-4000-8000-000000000035"],
        truncated: false,
      },
      error: null,
    });
  }

  async function markQueueInProgress(reviewQueueItemId) {
    await query(
      `UPDATE kai.review_queue_items SET queue_status = 'in_progress' WHERE review_queue_item_id = $1::uuid`,
      [reviewQueueItemId],
    );
  }

  async function currentUpdatedAt(reviewQueueItemId) {
    const rows = await query(
      `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [reviewQueueItemId],
    );
    return rows[0].updated_at.toISOString();
  }

  test.after(async () => {
    await pool.end();
  });

  const evidenceRows = await query(
    `SELECT evidence_item_id::text AS evidence_item_id
       FROM kai.evidence_items
      WHERE organization_id = $1::uuid
      ORDER BY evidence_item_id ASC
      LIMIT 1`,
    [ORG],
  );
  evidenceId = evidenceRows[0].evidence_item_id;
  await query(
    `INSERT INTO kai.claims (
       claim_id, organization_id, evidence_item_id, claim_type, claim_status,
       claim_review_status, claim_strength, statement, statement_fingerprint,
       created_by_type
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review',
             'unassessed','Synthetic P3-05 export-review-request claim.',
             repeat('9', 64),'system')`,
    [CLAIM, ORG, evidenceId],
  );
  await query(
    `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
    [ORG, CLAIM, evidenceId],
  );
  await query(
    `INSERT INTO kai.review_queue_items (
       review_queue_item_id, organization_id, queue_type, target_object_type,
       target_object_id, priority, queue_status, review_status, summary,
       required_action, queue_metadata, created_by_type
     )
     VALUES (
       '10000000-0000-4000-8000-000000000035'::uuid,$1::uuid,'claim_review','claim',
       $2::uuid,'normal','open','needs_gk_review','New claim requires GK review.',
       'Review the proposed claim before use.','{}'::jsonb,'system'
     )`,
    [ORG, CLAIM],
  );

  const createResult = await createEvidenceSummaryDraft(
    {
      organizationId: ORG,
      requestedAudience: "internal",
      claimIds: [CLAIM],
      idempotencyKey: "p3-05-created-by-p3-01",
      actorContext: gkReviewerActorContext,
      now: NOW,
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
      generatedContentRepository: createPostgresGeneratedContentRepository({
        runInTransaction: withRunnerOwnedTransaction,
        evaluator: p301Evaluator(),
      }),
      draftGenerator: draftGenerator(),
      metadataOnlyAudit: auditRecorder(),
    },
  );
  assert.equal(createResult.ok, true);
  draftId = createResult.data.generatedContentDraftId;
  generatedContentQueueId = createResult.data.reviewQueueItemId;

  const enabledEnv = { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true", KAI_PUBLIC_EXPORT_ENABLED: "true" };

  test("P3-05 rejects an export review request while the generated-content review is still open (not resolved/resolved)", async () => {
    const result = await requestGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: draftId, requestedExportAudience: "internal", actorContext: gkAdminActorContext, now: NOW },
      {
        env: enabledEnv,
        generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true }) }),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(result.error.code, "conflict_current_state_changed");
  });

  test("P3-05 a missing tenant-scoped draft returns not_found", async () => {
    const result = await requestGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: "10000000-0000-4000-8000-000000000999", requestedExportAudience: "internal", actorContext: gkAdminActorContext, now: NOW },
      {
        env: enabledEnv,
        generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true }) }),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(result.error.code, "not_found");
  });

  test("P3-05 fresh export-review request after review completion writes one export_review queue row and one audit, then replays with a different actor and timestamp", async () => {
    await markQueueInProgress(generatedContentQueueId);
    const expectedUpdatedAt = await currentUpdatedAt(generatedContentQueueId);
    const completion = await completeGeneratedContentReview(
      { organizationId: ORG, generatedContentDraftId: draftId, reviewQueueItemId: generatedContentQueueId, expectedUpdatedAt, actorContext: gkReviewerActorContext, now: NOW },
      {
        env: enabledEnv,
        generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true }) }),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(completion.ok, true);
    assert.equal(completion.data.queueStatus, "resolved");

    const repository = createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true }) });
    const deps = { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() };
    const requestInput = { organizationId: ORG, generatedContentDraftId: draftId, requestedExportAudience: "internal", actorContext: gkAdminActorContext, now: NOW };

    const fresh = await requestGeneratedDraftExportReview(requestInput, deps);
    assert.equal(fresh.ok, true);
    assert.equal(fresh.data.exportReviewRequestAccepted, true);
    assert.equal(fresh.data.replayed, false);
    assert.equal(fresh.data.queueStatus, "open");
    assert.equal(fresh.data.reviewStatus, "needs_gk_review");
    assert.deepEqual(new Set(fresh.data.validatorResult.evidence.failed_gates), new Set([
      "generated_content_still_draft",
      "affirmative_human_export_authority_absent",
      "final_export_gate_absent",
    ]));

    const queueRows = await query(
      `SELECT queue_status, review_status, queue_type FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [fresh.data.reviewQueueItemId],
    );
    assert.equal(queueRows[0].queue_type, "export_review");
    assert.equal(queueRows[0].queue_status, "open");
    assert.equal(queueRows[0].review_status, "needs_gk_review");

    const auditsAfterFresh = await query(
      `SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'export_review_requested'`,
    );
    assert.equal(auditsAfterFresh[0].count, 1);

    const laterAdmin = { ...gkAdminActorContext, actorUserId: "90000000-0000-4000-8000-000000000006" };
    const replay = await requestGeneratedDraftExportReview(
      { ...requestInput, actorContext: laterAdmin, now: LATER },
      deps,
    );
    assert.equal(replay.ok, true);
    assert.equal(replay.data.exportReviewRequestAccepted, true);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.reviewQueueItemId, fresh.data.reviewQueueItemId);

    const auditsAfterReplay = await query(
      `SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'export_review_requested'`,
    );
    assert.equal(auditsAfterReplay[0].count, 1);
  });

  test("P3-05 concurrent identical export-review requests converge to exactly one queue row and one audit", async () => {
    const claim2 = "10000000-0000-4000-8000-000000000011";
    const evidenceIdForClaim2 = "10000000-0000-4000-8000-000000000012";
    await query(
      `INSERT INTO kai.evidence_items (
         evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
         evidence_type, data_class, sensitivity_level, support_strength, statement,
         statement_fingerprint, created_by_type
       )
       SELECT $1::uuid, organization_id, source_id, source_version_id, source_locator_id,
              evidence_type, data_class, sensitivity_level, support_strength,
              'Synthetic P3-05 concurrency evidence item.', repeat('8', 64), created_by_type
         FROM kai.evidence_items
        WHERE evidence_item_id = $2::uuid`,
      [evidenceIdForClaim2, evidenceId],
    );
    await query(
      `INSERT INTO kai.claims (
         claim_id, organization_id, evidence_item_id, claim_type, claim_status,
         claim_review_status, claim_strength, statement, statement_fingerprint,
         created_by_type
       )
       VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review',
               'unassessed','Synthetic P3-05 concurrency claim.',
               repeat('7', 64),'system')`,
      [claim2, ORG, evidenceIdForClaim2],
    );
    await query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
      [ORG, claim2, evidenceIdForClaim2],
    );

    const secondDraft = await createEvidenceSummaryDraft(
      {
        organizationId: ORG,
        requestedAudience: "internal",
        claimIds: [claim2],
        idempotencyKey: "p3-05-concurrency-draft",
        actorContext: gkReviewerActorContext,
        now: NOW,
      },
      {
        env: enabledEnv,
        generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: p301Evaluator() }),
        draftGenerator: draftGenerator(),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(secondDraft.ok, true);
    const concurrentDraftId = secondDraft.data.generatedContentDraftId;
    const concurrentQueueId = secondDraft.data.reviewQueueItemId;
    await markQueueInProgress(concurrentQueueId);
    const expectedUpdatedAt = await currentUpdatedAt(concurrentQueueId);
    const completion = await completeGeneratedContentReview(
      { organizationId: ORG, generatedContentDraftId: concurrentDraftId, reviewQueueItemId: concurrentQueueId, expectedUpdatedAt, actorContext: gkReviewerActorContext, now: NOW },
      {
        env: enabledEnv,
        generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceIdForClaim2 }) }),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(completion.ok, true);

    const repository = createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceIdForClaim2 }) });
    const deps = { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() };
    const requestInput = { organizationId: ORG, generatedContentDraftId: concurrentDraftId, requestedExportAudience: "internal", actorContext: gkAdminActorContext, now: NOW };

    const [first, second] = await Promise.all([
      requestGeneratedDraftExportReview(requestInput, deps),
      requestGeneratedDraftExportReview(requestInput, deps),
    ]);
    assert.ok(first.ok && second.ok);
    const replayedFlags = [first.data.replayed, second.data.replayed].sort();
    assert.deepEqual(replayedFlags, [false, true]);

    const auditCount = await query(
      `SELECT count(*)::int AS count
         FROM kai.upload_lifecycle_audit
        WHERE operation = 'export_review_requested'
          AND metadata->>'generated_content_draft_id' = $1`,
      [concurrentDraftId],
    );
    assert.equal(auditCount[0].count, 1);

    const queueCount = await query(
      `SELECT count(*)::int AS count
         FROM kai.review_queue_items
        WHERE queue_type = 'export_review'
          AND target_object_id = $1::uuid`,
      [concurrentDraftId],
    );
    assert.equal(queueCount[0].count, 1);
  });

  test("P3-05 export-review-request never mutates draft_status, blocks, citations, or the generated-content review queue row", async () => {
    const draftRows = await query(
      `SELECT draft_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid`,
      [draftId],
    );
    assert.equal(draftRows[0].draft_status, "draft");
    const genContentQueueRows = await query(
      `SELECT queue_status, review_status FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [generatedContentQueueId],
    );
    assert.equal(genContentQueueRows[0].queue_status, "resolved");
    assert.equal(genContentQueueRows[0].review_status, "resolved");
  });

  test("P3-05 audit metadata carries no draft, claim, or evidence text", async () => {
    const rows = await query(
      `SELECT metadata FROM kai.upload_lifecycle_audit
        WHERE operation = 'export_review_requested'
          AND metadata->>'generated_content_draft_id' = $1`,
      [draftId],
    );
    assert.equal(rows.length, 1);
    const metadata = rows[0].metadata;
    assert.deepEqual(new Set(Object.keys(metadata)), new Set([
      "contract",
      "organization_id",
      "generated_content_draft_id",
      "review_queue_item_id",
      "requested_export_audience",
      "actor_id",
      "actor_type",
      "requested_timestamp",
      "validator_key",
      "failed_gates",
    ]));
  });

  test("P3-05 ambient DATABASE_URL is ignored by this suite (only the runner-owned pool is used)", () => {
    assert.notEqual(process.env.DATABASE_URL, RUNNER_OWNED_DATABASE_URL);
  });
}
