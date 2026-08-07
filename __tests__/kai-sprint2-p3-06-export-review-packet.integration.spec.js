import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P3_06_EXPORT_REVIEW_PACKET_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P3-06 integration suite refused a non-loopback KAI_P3_06_EXPORT_REVIEW_PACKET_DATABASE_URL host: ${host}`);
  }
}

test("P3-06 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P3-06 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresGeneratedContentRepository\.js|postgresClaimTraceabilityRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P3-06 export-review-packet integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP306IntegrationSuite();
}

async function runP306IntegrationSuite() {
  const { Pool } = await import("pg");
  const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { createEvidenceSummaryDraft, completeGeneratedContentReview } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
  const { requestGeneratedDraftExportReview, getGeneratedDraftExportReviewPacket } = await import("../Backend/kai/services/kaiExportReviewService.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const CLAIM = "10000000-0000-4000-8000-000000000060";
  const NOW = "2026-08-06T10:00:00.000Z";
  const enabledEnv = { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true", KAI_PUBLIC_EXPORT_ENABLED: "true" };
  let evidenceId = null;
  let draftId = null;
  let generatedContentQueueId = null;
  let exportReviewQueueId = null;
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
      return { ok: true, data: { claim: { claim_id: claim.claim_id }, evidence: { evidence_item_id: claim.evidence_item_id }, requestedAudience: evalInput.requestedAudience, eligible: true }, error: null };
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

  function readPacketEvaluator({ eligible = true } = {}) {
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
          evidence_item_id: evidenceId,
          evidence_review_status: eligible ? "approved" : "needs_gk_review",
          support_strength: "unassessed",
          review_queue_item_id: "10000000-0000-4000-8000-000000000061",
          review_queue_status: "resolved",
          review_status: eligible ? "approved" : "needs_gk_review",
        },
        locator: { source_locator_id: "10000000-0000-4000-8000-000000000062" },
        source: { source_id: "10000000-0000-4000-8000-000000000063", source_code: null },
        source_version: { source_version_id: "10000000-0000-4000-8000-000000000064", is_current: true },
        claim_review: { review_queue_item_id: "10000000-0000-4000-8000-000000000065", queue_status: "resolved", review_status: eligible ? "approved" : "needs_gk_review" },
        candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000003" },
        promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000066" },
        dimensions: {},
        gap_items: [],
        client_followup_workflows: [],
        potential_conflict_groups: [],
        requestedAudience: evalInput.requestedAudience,
        eligible,
        blockerCodes: eligible ? [] : ["claim_review_unresolved"],
        affectedDimensionKeys: eligible ? [] : ["missingness"],
        affectedObjectIds: eligible ? [] : ["10000000-0000-4000-8000-000000000065"],
        truncated: false,
      },
      error: null,
    });
  }

  test.after(async () => {
    await pool.end();
  });

  test("P3-06 authentic P3-05 state returns a read-only export-review packet with citations and canonical validator", async () => {
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
               'unassessed','Synthetic P3-06 export-review-packet claim.',
               repeat('6', 64),'system')`,
      [CLAIM, ORG, evidenceId],
    );
    await query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
      [ORG, CLAIM, evidenceId],
    );

    const createResult = await createEvidenceSummaryDraft(
      {
        organizationId: ORG,
        requestedAudience: "internal",
        claimIds: [CLAIM],
        idempotencyKey: "p3-06-created-by-p3-01",
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
    assert.equal(createResult.ok, true);
    draftId = createResult.data.generatedContentDraftId;
    generatedContentQueueId = createResult.data.reviewQueueItemId;

    await query(
      `UPDATE kai.review_queue_items SET queue_status = 'in_progress' WHERE review_queue_item_id = $1::uuid`,
      [generatedContentQueueId],
    );
    const updatedAtRows = await query(
      `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [generatedContentQueueId],
    );
    const completion = await completeGeneratedContentReview(
      {
        organizationId: ORG,
        generatedContentDraftId: draftId,
        reviewQueueItemId: generatedContentQueueId,
        expectedUpdatedAt: updatedAtRows[0].updated_at.toISOString(),
        actorContext: gkReviewerActorContext,
        now: NOW,
      },
      {
        env: enabledEnv,
        generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true }) }),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(completion.ok, true);

    const exportReview = await requestGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: draftId, requestedExportAudience: "internal", actorContext: gkAdminActorContext, now: NOW },
      {
        env: enabledEnv,
        generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true }) }),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(exportReview.ok, true);
    exportReviewQueueId = exportReview.data.reviewQueueItemId;

    const packet = await getGeneratedDraftExportReviewPacket(
      { organizationId: ORG, generatedContentDraftId: draftId, exportReviewQueueItemId: exportReviewQueueId, actorContext: gkAdminActorContext },
      {
        env: enabledEnv,
        runInTransaction: withRunnerOwnedTransaction,
        evaluatePacket: (await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js")).evaluateGeneratedDraftExportReviewPacketInTransaction,
        evaluator: readPacketEvaluator({ eligible: false }),
      },
    );
    assert.equal(packet.ok, true);
    assert.equal(packet.data.generatedContentReviewQueueStatus, "resolved");
    assert.equal(packet.data.exportReviewQueueStatus, "open");
    assert.equal(packet.data.currentUseEligible, false);
    assert.equal(packet.data.exportEligible, false);
    assert.ok(packet.data.validatorResult.evidence.failed_gates.includes("current_use_ineligible"));
    assert.equal(packet.data.blocks[0].citations[0].evidenceItemId, evidenceId);

    const exportReviewQueueUpdatedAtRows = await query(
      `SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [exportReviewQueueId],
    );
    assert.equal(packet.data.exportReviewUpdatedAt, exportReviewQueueUpdatedAtRows[0].updated_at.toISOString());

    const afterRows = await query(
      `SELECT count(*)::int AS audits
         FROM kai.upload_lifecycle_audit
        WHERE operation = 'export_review_requested'
          AND metadata->>'generated_content_draft_id' = $1`,
      [draftId],
    );
    assert.equal(afterRows[0].audits, 1);
  });

  test("P3-06 scoped missing queue returns not_found and ambient DATABASE_URL is ignored", async () => {
    const result = await getGeneratedDraftExportReviewPacket(
      {
        organizationId: ORG,
        generatedContentDraftId: draftId,
        exportReviewQueueItemId: "10000000-0000-4000-8000-000000000999",
        actorContext: gkAdminActorContext,
      },
      {
        env: enabledEnv,
        runInTransaction: withRunnerOwnedTransaction,
        evaluatePacket: (await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js")).evaluateGeneratedDraftExportReviewPacketInTransaction,
        evaluator: readPacketEvaluator({ eligible: true }),
      },
    );
    assert.equal(result.error.code, "not_found");
    assert.notEqual(process.env.DATABASE_URL, RUNNER_OWNED_DATABASE_URL);
  });
}
