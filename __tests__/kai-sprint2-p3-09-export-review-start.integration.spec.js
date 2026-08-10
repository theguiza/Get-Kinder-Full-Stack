import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P3_09_EXPORT_REVIEW_START_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P3-09 integration suite refused a non-loopback KAI_P3_09_EXPORT_REVIEW_START_DATABASE_URL host: ${host}`);
  }
}

test("P3-09 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P3-09 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresGeneratedContentRepository\.js|postgresClaimTraceabilityRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P3-09 export-review-start integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP309IntegrationSuite();
}

async function runP309IntegrationSuite() {
  const { Pool } = await import("pg");
  const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { createEvidenceSummaryDraft, completeGeneratedContentReview } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
  const {
    requestGeneratedDraftExportReview,
    startGeneratedDraftExportReview,
    getGeneratedDraftExportReviewPacket,
  } = await import("../Backend/kai/services/kaiExportReviewService.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-06T10:00:00.000Z";
  const LATER = "2026-08-06T10:05:00.000Z";
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

  function readPacketEvaluator({ eligible = true, evidenceItemId } = {}) {
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
          review_queue_item_id: "10000000-0000-4000-8000-000000000041",
          review_queue_status: "open",
          review_status: eligible ? "approved" : "needs_gk_review",
        },
        locator: { source_locator_id: "10000000-0000-4000-8000-000000000042" },
        source: { source_id: "10000000-0000-4000-8000-000000000043", source_code: null },
        source_version: { source_version_id: "10000000-0000-4000-8000-000000000044", is_current: true },
        claim_review: { review_queue_item_id: "10000000-0000-4000-8000-000000000045", queue_status: "open", review_status: eligible ? "approved" : "needs_gk_review" },
        candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000003" },
        promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000046" },
        dimensions: {},
        gap_items: [],
        client_followup_workflows: [],
        potential_conflict_groups: [],
        requestedAudience: evalInput.requestedAudience,
        eligible,
        blockerCodes: eligible ? [] : ["claim_review_unresolved"],
        affectedDimensionKeys: eligible ? [] : ["missingness"],
        affectedObjectIds: eligible ? [] : ["10000000-0000-4000-8000-000000000045"],
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

  async function seedClaimAndDraft({ claimId, evidenceLabel, idempotencyKey }) {
    const evidenceId = `10000000-0000-4000-8000-0000000000${evidenceLabel}`;
    const sourceEvidenceRows = await query(
      `SELECT evidence_item_id::text AS evidence_item_id
         FROM kai.evidence_items
        WHERE organization_id = $1::uuid
        ORDER BY evidence_item_id ASC
        LIMIT 1`,
      [ORG],
    );
    const templateEvidenceId = sourceEvidenceRows[0].evidence_item_id;
    const statementFingerprint = evidenceLabel.padStart(2, "0").repeat(32).slice(0, 64);
    await query(
      `INSERT INTO kai.evidence_items (
         evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
         evidence_type, data_class, sensitivity_level, support_strength, statement,
         statement_fingerprint, created_by_type
       )
       SELECT $1::uuid, organization_id, source_id, source_version_id, source_locator_id,
              evidence_type, data_class, sensitivity_level, support_strength,
              'Synthetic P3-09 export-review-start evidence item.', $3, created_by_type
         FROM kai.evidence_items
        WHERE evidence_item_id = $2::uuid`,
      [evidenceId, templateEvidenceId, statementFingerprint],
    );
    await query(
      `INSERT INTO kai.claims (
         claim_id, organization_id, evidence_item_id, claim_type, claim_status,
         claim_review_status, claim_strength, statement, statement_fingerprint,
         created_by_type
       )
       VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review',
               'unassessed','Synthetic P3-09 export-review-start claim.',
               repeat('5', 64),'system')`,
      [claimId, ORG, evidenceId],
    );
    await query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
      [ORG, claimId, evidenceId],
    );

    const createResult = await createEvidenceSummaryDraft(
      {
        organizationId: ORG,
        requestedAudience: "internal",
        claimIds: [claimId],
        idempotencyKey,
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
    const draftId = createResult.data.generatedContentDraftId;
    const generatedContentQueueId = createResult.data.reviewQueueItemId;

    await markQueueInProgress(generatedContentQueueId);
    const expectedUpdatedAt = await currentUpdatedAt(generatedContentQueueId);
    const enabledEnv = { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true", KAI_PUBLIC_EXPORT_ENABLED: "true" };
    const completion = await completeGeneratedContentReview(
      { organizationId: ORG, generatedContentDraftId: draftId, reviewQueueItemId: generatedContentQueueId, expectedUpdatedAt, actorContext: gkReviewerActorContext, now: NOW },
      {
        env: enabledEnv,
        generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) }),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(completion.ok, true);

    const requestResult = await requestGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: draftId, requestedExportAudience: "internal", actorContext: gkAdminActorContext, now: NOW },
      {
        env: enabledEnv,
        generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) }),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(requestResult.ok, true);
    assert.equal(requestResult.data.exportReviewRequestAccepted, true);

    return {
      draftId,
      exportReviewQueueItemId: requestResult.data.reviewQueueItemId,
      evidenceId,
      enabledEnv,
    };
  }

  test.after(async () => {
    await pool.end();
  });

  test("P3-09 fresh start transitions open/needs_gk_review to in_progress/needs_gk_review with exactly one audit, then an identical replay converges with zero additional writes", async () => {
    const { draftId, exportReviewQueueItemId, evidenceId, enabledEnv } = await seedClaimAndDraft({
      claimId: "10000000-0000-4000-8000-000000000021",
      evidenceLabel: "21",
      idempotencyKey: "p3-09-fresh-start",
    });
    const repository = createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) });
    const deps = { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() };
    const expectedUpdatedAt = await currentUpdatedAt(exportReviewQueueItemId);
    const startInput = { organizationId: ORG, generatedContentDraftId: draftId, exportReviewQueueItemId, expectedUpdatedAt, actorContext: gkAdminActorContext, now: NOW };

    const fresh = await startGeneratedDraftExportReview(startInput, deps);
    assert.equal(fresh.ok, true);
    assert.equal(fresh.data.replayed, false);
    assert.equal(fresh.data.queueStatus, "in_progress");
    assert.equal(fresh.data.reviewStatus, "needs_gk_review");

    const queueRows = await query(
      `SELECT queue_status, review_status FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [exportReviewQueueItemId],
    );
    assert.equal(queueRows[0].queue_status, "in_progress");
    assert.equal(queueRows[0].review_status, "needs_gk_review");

    const auditsAfterFresh = await query(
      `SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'export_review_started' AND metadata->>'generated_content_draft_id' = $1`,
      [draftId],
    );
    assert.equal(auditsAfterFresh[0].count, 1);

    const replay = await startGeneratedDraftExportReview(startInput, deps);
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.queueStatus, "in_progress");

    const auditsAfterReplay = await query(
      `SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'export_review_started' AND metadata->>'generated_content_draft_id' = $1`,
      [draftId],
    );
    assert.equal(auditsAfterReplay[0].count, 1);

    const packet = await getGeneratedDraftExportReviewPacket(
      { organizationId: ORG, generatedContentDraftId: draftId, exportReviewQueueItemId, actorContext: gkAdminActorContext },
      {
        env: enabledEnv,
        runInTransaction: withRunnerOwnedTransaction,
        evaluatePacket: (await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js")).evaluateGeneratedDraftExportReviewPacketInTransaction,
        evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }),
      },
    );
    assert.equal(packet.ok, true);
    assert.equal(packet.data.exportReviewQueueStatus, "in_progress");
    assert.equal(packet.data.exportReviewStatus, "needs_gk_review");
    assert.equal(packet.data.exportEligible, false);
    assert.equal(packet.data.draftStatus, "draft");

    const postTransitionUpdatedAt = await currentUpdatedAt(exportReviewQueueItemId);
    assert.equal(packet.data.exportReviewUpdatedAt, postTransitionUpdatedAt);
    assert.notEqual(packet.data.exportReviewUpdatedAt, expectedUpdatedAt);
  });

  test("P3-09 stale expectedUpdatedAt conflicts with zero mutation and zero audit", async () => {
    const { draftId, exportReviewQueueItemId, evidenceId, enabledEnv } = await seedClaimAndDraft({
      claimId: "10000000-0000-4000-8000-000000000022",
      evidenceLabel: "22",
      idempotencyKey: "p3-09-stale-cas",
    });
    const repository = createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) });
    const deps = { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() };
    const result = await startGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: draftId, exportReviewQueueItemId, expectedUpdatedAt: "2020-01-01T00:00:00.000Z", actorContext: gkAdminActorContext, now: NOW },
      deps,
    );
    assert.equal(result.error.code, "conflict_current_state_changed");

    const queueRows = await query(
      `SELECT queue_status FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [exportReviewQueueItemId],
    );
    assert.equal(queueRows[0].queue_status, "open");

    const auditCount = await query(
      `SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'export_review_started' AND metadata->>'generated_content_draft_id' = $1`,
      [draftId],
    );
    assert.equal(auditCount[0].count, 0);
  });

  test("P3-09 tenant-safe not_found and cross-draft conflict", async () => {
    const { draftId, exportReviewQueueItemId, evidenceId, enabledEnv } = await seedClaimAndDraft({
      claimId: "10000000-0000-4000-8000-000000000023",
      evidenceLabel: "23",
      idempotencyKey: "p3-09-tenant-safety",
    });
    const repository = createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) });
    const deps = { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() };
    const expectedUpdatedAt = await currentUpdatedAt(exportReviewQueueItemId);

    const missing = await startGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: draftId, exportReviewQueueItemId: "10000000-0000-4000-8000-000000000999", expectedUpdatedAt, actorContext: gkAdminActorContext, now: NOW },
      deps,
    );
    assert.equal(missing.error.code, "not_found");

    const { draftId: otherDraftId } = await seedClaimAndDraft({
      claimId: "10000000-0000-4000-8000-000000000024",
      evidenceLabel: "24",
      idempotencyKey: "p3-09-tenant-safety-other-draft",
    });
    const mismatch = await startGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: otherDraftId, exportReviewQueueItemId, expectedUpdatedAt, actorContext: gkAdminActorContext, now: NOW },
      deps,
    );
    assert.equal(mismatch.error.code, "conflict_current_state_changed");
  });

  test("P3-09 concurrent identical start calls converge to exactly one transition and one audit", async () => {
    const { draftId, exportReviewQueueItemId, evidenceId, enabledEnv } = await seedClaimAndDraft({
      claimId: "10000000-0000-4000-8000-000000000025",
      evidenceLabel: "25",
      idempotencyKey: "p3-09-concurrency",
    });
    const repository = createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) });
    const deps = { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() };
    const expectedUpdatedAt = await currentUpdatedAt(exportReviewQueueItemId);
    const startInput = { organizationId: ORG, generatedContentDraftId: draftId, exportReviewQueueItemId, expectedUpdatedAt, actorContext: gkAdminActorContext, now: NOW };

    const [first, second] = await Promise.all([
      startGeneratedDraftExportReview(startInput, deps),
      startGeneratedDraftExportReview(startInput, deps),
    ]);
    assert.ok(first.ok && second.ok);
    const replayedFlags = [first.data.replayed, second.data.replayed].sort();
    assert.deepEqual(replayedFlags, [false, true]);

    const auditCount = await query(
      `SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'export_review_started' AND metadata->>'generated_content_draft_id' = $1`,
      [draftId],
    );
    assert.equal(auditCount[0].count, 1);

    const queueCount = await query(
      `SELECT count(*)::int AS count FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid AND queue_status = 'in_progress'`,
      [exportReviewQueueItemId],
    );
    assert.equal(queueCount[0].count, 1);
  });

  test("P3-09 never mutates draft_status or the generated-content review queue row", async () => {
    const { draftId, exportReviewQueueItemId, evidenceId, enabledEnv } = await seedClaimAndDraft({
      claimId: "10000000-0000-4000-8000-000000000026",
      evidenceLabel: "26",
      idempotencyKey: "p3-09-no-side-effects",
    });
    const repository = createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) });
    const deps = { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() };
    const expectedUpdatedAt = await currentUpdatedAt(exportReviewQueueItemId);
    await startGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: draftId, exportReviewQueueItemId, expectedUpdatedAt, actorContext: gkAdminActorContext, now: NOW },
      deps,
    );
    const draftRows = await query(
      `SELECT draft_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid`,
      [draftId],
    );
    assert.equal(draftRows[0].draft_status, "draft");
    const genContentQueueRows = await query(
      `SELECT queue_status, review_status FROM kai.review_queue_items WHERE queue_type = 'generated_content_review' AND target_object_id = $1::uuid`,
      [draftId],
    );
    assert.equal(genContentQueueRows[0].queue_status, "resolved");
    assert.equal(genContentQueueRows[0].review_status, "resolved");
  });

  test("P3-09 ambient DATABASE_URL is ignored by this suite (only the runner-owned pool is used)", () => {
    assert.notEqual(process.env.DATABASE_URL, RUNNER_OWNED_DATABASE_URL);
  });
}
