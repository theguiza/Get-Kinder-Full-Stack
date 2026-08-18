import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P3_03_EXPORT_ELIGIBILITY_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P3-03 integration suite refused a non-loopback KAI_P3_03_EXPORT_ELIGIBILITY_DATABASE_URL host: ${host}`);
  }
}

test("P3-03 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P3-03 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresGeneratedContentRepository\.js|postgresClaimTraceabilityRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P3-03 export-eligibility integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP303IntegrationSuite();
}

async function runP303IntegrationSuite() {
  const { Pool } = await import("pg");
  const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { evaluateGeneratedDraftReviewPacketInTransaction } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { createEvidenceSummaryDraft } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
  const { evaluateGeneratedDraftExportEligibility } = await import("../Backend/kai/services/kaiExportEligibilityService.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const CLAIM = "10000000-0000-4000-8000-000000000006";
  const NOW = "2026-08-06T10:00:00.000Z";
  let evidenceId = null;
  let draftId = null;
  let queueId = null;
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

  const actorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000002",
    source: "public.userdata",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_admin" },
    ],
  };

  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  function p301Evaluator() {
    return async (tx, input) => {
      const rows = await tx.query(
        `SELECT claim_id::text AS claim_id, evidence_item_id::text AS evidence_item_id
           FROM kai.claims
          WHERE organization_id = $1::uuid
            AND claim_id = $2::uuid`,
        [input.organizationId, input.claimId],
      );
      const claim = rows.rows[0];
      return {
        ok: true,
        data: {
          claim: { claim_id: claim.claim_id },
          evidence: { evidence_item_id: claim.evidence_item_id },
          requestedAudience: input.requestedAudience,
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
    return async (tx, evalInput) => {
      assert.equal(typeof tx.query, "function");
      return {
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
            review_queue_item_id: "10000000-0000-4000-8000-000000000021",
            review_queue_status: "open",
            review_status: eligible ? "approved" : "needs_gk_review",
          },
          locator: { source_locator_id: "10000000-0000-4000-8000-000000000022" },
          source: { source_id: "10000000-0000-4000-8000-000000000023", source_code: null },
          source_version: { source_version_id: "10000000-0000-4000-8000-000000000024", is_current: true },
          claim_review: { review_queue_item_id: "10000000-0000-4000-8000-000000000025", queue_status: "open", review_status: eligible ? "approved" : "needs_gk_review" },
          candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000003" },
          promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000026" },
          dimensions: {},
          gap_items: [],
          client_followup_workflows: [],
          potential_conflict_groups: [],
          requestedAudience: evalInput.requestedAudience,
          eligible,
          blockerCodes: eligible ? [] : ["claim_review_unresolved"],
          affectedDimensionKeys: eligible ? [] : ["missingness"],
          affectedObjectIds: eligible ? [] : ["10000000-0000-4000-8000-000000000025"],
          truncated: false,
        },
        error: null,
      };
    };
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
             'unassessed','Synthetic P3-03 export eligibility claim.',
             repeat('c', 64),'system')`,
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
       '10000000-0000-4000-8000-000000000025'::uuid,$1::uuid,'claim_review','claim',
       $2::uuid,'medium','open','needs_gk_review','New claim requires GK review.',
       'Review the proposed claim before use.','{}'::jsonb,'system'
     )`,
    [ORG, CLAIM],
  );

  const createResult = await createEvidenceSummaryDraft(
    {
      organizationId: ORG,
      requestedAudience: "internal",
      claimIds: [CLAIM],
      idempotencyKey: "p3-03-created-by-p3-01",
      actorContext,
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
  queueId = createResult.data.reviewQueueItemId;

  const enabledEnv = { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true", KAI_PUBLIC_EXPORT_ENABLED: "true" };

  test("P3-03 reuses the transaction-scoped P3-02 evaluator to return a successful preflight DTO with exportEligible:false for an authentic draft", async () => {
    const result = await evaluateGeneratedDraftExportEligibility(
      { organizationId: ORG, generatedContentDraftId: draftId, requestedExportAudience: "internal", actorContext },
      {
        env: enabledEnv,
        runInTransaction: withRunnerOwnedTransaction,
        evaluatePacket: evaluateGeneratedDraftReviewPacketInTransaction,
        evaluator: readPacketEvaluator({ eligible: true }),
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.generatedContentDraftId, draftId);
    assert.equal(result.data.reviewQueueItemId, queueId);
    assert.equal(result.data.draftStatus, "draft");
    assert.equal(result.data.queueStatus, "open");
    assert.equal(result.data.reviewStatus, "needs_gk_review");
    assert.equal(result.data.currentUseEligible, true);
    assert.equal(result.data.exportEligible, false);
    assert.equal(result.data.validatorResult.severity, "blocker");
    assert.deepEqual(result.data.validatorResult.evidence.failed_gates, [
      "generated_content_still_draft",
      "generated_content_review_unresolved",
      "affirmative_human_export_authority_absent",
      "final_export_gate_absent",
    ]);
  });

  test("P3-03 requested-audience mismatch adds the export_audience_mismatch gate on top of the always-absent authority gates", async () => {
    const result = await evaluateGeneratedDraftExportEligibility(
      { organizationId: ORG, generatedContentDraftId: draftId, requestedExportAudience: "public", actorContext },
      {
        env: enabledEnv,
        runInTransaction: withRunnerOwnedTransaction,
        evaluatePacket: evaluateGeneratedDraftReviewPacketInTransaction,
        evaluator: readPacketEvaluator({ eligible: true }),
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.exportEligible, false);
    assert.deepEqual(result.data.validatorResult.evidence.failed_gates, [
      "generated_content_still_draft",
      "generated_content_review_unresolved",
      "export_audience_mismatch",
      "affirmative_human_export_authority_absent",
      "final_export_gate_absent",
    ]);
  });

  test("P3-03 current ineligibility blocks via current_use_ineligible", async () => {
    const result = await evaluateGeneratedDraftExportEligibility(
      { organizationId: ORG, generatedContentDraftId: draftId, requestedExportAudience: "internal", actorContext },
      {
        env: enabledEnv,
        runInTransaction: withRunnerOwnedTransaction,
        evaluatePacket: evaluateGeneratedDraftReviewPacketInTransaction,
        evaluator: readPacketEvaluator({ eligible: false }),
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.currentUseEligible, false);
    assert.ok(result.data.validatorResult.evidence.failed_gates.includes("current_use_ineligible"));
  });

  test("P3-03 a missing tenant-scoped draft returns not_found", async () => {
    const result = await evaluateGeneratedDraftExportEligibility(
      { organizationId: ORG, generatedContentDraftId: "10000000-0000-4000-8000-000000000099", requestedExportAudience: "internal", actorContext },
      {
        env: enabledEnv,
        runInTransaction: withRunnerOwnedTransaction,
        evaluatePacket: evaluateGeneratedDraftReviewPacketInTransaction,
        evaluator: readPacketEvaluator({ eligible: true }),
      },
    );
    assert.equal(result.error.code, "not_found");
    assert.equal(result.data, null);
  });

  test("P3-03 malformed authoritative state (evidence identity mismatch) fails closed with conflict_current_state_changed", async () => {
    const result = await evaluateGeneratedDraftExportEligibility(
      { organizationId: ORG, generatedContentDraftId: draftId, requestedExportAudience: "internal", actorContext },
      {
        env: enabledEnv,
        runInTransaction: withRunnerOwnedTransaction,
        evaluatePacket: evaluateGeneratedDraftReviewPacketInTransaction,
        evaluator: readPacketEvaluator({ evidenceItemId: "10000000-0000-4000-8000-000000000098" }),
      },
    );
    assert.equal(result.error.code, "conflict_current_state_changed");
    assert.equal(result.data, null);
  });

  test("P3-03 performs no writes, queue transitions, audits, or manifest/file creation", async () => {
    const before = await query(
      `SELECT
         (SELECT count(*)::int FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid AND queue_status = 'open') AS open_queue,
         (SELECT draft_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $2::uuid) AS draft_status,
         (SELECT count(*)::int FROM kai.upload_lifecycle_audit) AS audits`,
      [queueId, draftId],
    );
    await evaluateGeneratedDraftExportEligibility(
      { organizationId: ORG, generatedContentDraftId: draftId, requestedExportAudience: "internal", actorContext },
      {
        env: enabledEnv,
        runInTransaction: withRunnerOwnedTransaction,
        evaluatePacket: evaluateGeneratedDraftReviewPacketInTransaction,
        evaluator: readPacketEvaluator({ eligible: true }),
      },
    );
    const after = await query(
      `SELECT
         (SELECT count(*)::int FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid AND queue_status = 'open') AS open_queue,
         (SELECT draft_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $2::uuid) AS draft_status,
         (SELECT count(*)::int FROM kai.upload_lifecycle_audit) AS audits`,
      [queueId, draftId],
    );
    assert.deepEqual(after, before);
  });

  test("P3-03 real repository defaults (no injected finalGate/authority) still fail closed via lazily-loaded default dependencies", async () => {
    const result = await evaluateGeneratedDraftExportEligibility(
      { organizationId: ORG, generatedContentDraftId: draftId, requestedExportAudience: "internal", actorContext },
      { env: enabledEnv, runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true }) },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.exportEligible, false);
    assert.ok(result.data.validatorResult.evidence.failed_gates.includes("affirmative_human_export_authority_absent"));
    assert.ok(result.data.validatorResult.evidence.failed_gates.includes("final_export_gate_absent"));
  });
}
