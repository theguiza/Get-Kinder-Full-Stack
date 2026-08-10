import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P3_02_REVIEW_PACKET_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P3-02 integration suite refused a non-loopback KAI_P3_02_REVIEW_PACKET_DATABASE_URL host: ${host}`);
  }
}

test("P3-02 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P3-02 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresGeneratedContentRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P3-02 generated-draft review packet integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP302IntegrationSuite();
}

async function runP302IntegrationSuite() {
  const { Pool } = await import("pg");
  const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const {
    createEvidenceSummaryDraft,
    getGeneratedDraftReviewPacket,
  } = await import("../Backend/kai/services/kaiGeneratedContentService.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const CLAIM = "10000000-0000-4000-8000-000000000005";
  const NOW = "2026-08-06T10:00:00.000Z";
  const REQUIRED_ACTION =
    "Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.";
  let evidenceId = null;
  let sourceId = null;
  let sourceVersionId = null;
  let locatorId = null;
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
    actorUserId: "90000000-0000-4000-8000-000000000001",
    source: "public.userdata",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
    ],
  };

  function auditRecorder() {
    return {
      prepareMetadataOnlyAudit() {
        return {
          ok: true,
          async publish() {},
        };
      },
    };
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

  function draftGenerator({ calls = [] } = {}) {
    return async (input) => {
      calls.push(input);
      return {
        blocks: [
          {
            ordinal: 1,
            text: input.claims[0].claimStatement,
            citations: [{ claimId: input.claims[0].claimId, evidenceItemId: input.claims[0].evidenceItemId }],
          },
          {
            ordinal: 2,
            text: input.claims[0].claimStatement,
            citations: [{ claimId: input.claims[0].claimId, evidenceItemId: input.claims[0].evidenceItemId }],
          },
        ],
      };
    };
  }

  function evaluator({ calls = [], eligible = true, evidenceItemId = evidenceId } = {}) {
    return async (tx, input) => {
      assert.equal(typeof tx.query, "function");
      calls.push(input);
      return {
        ok: true,
        data: {
          claim: {
            claim_id: input.claimId,
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
            review_queue_item_id: "10000000-0000-4000-8000-000000000011",
            review_queue_status: "open",
            review_status: eligible ? "approved" : "needs_gk_review",
          },
          locator: { source_locator_id: locatorId },
          source: { source_id: sourceId, source_code: null },
          source_version: { source_version_id: sourceVersionId, is_current: true },
          claim_review: {
            review_queue_item_id: "10000000-0000-4000-8000-000000000012",
            queue_status: "open",
            review_status: eligible ? "approved" : "needs_gk_review",
          },
          candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000001" },
          promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000013" },
          dimensions: {},
          gap_items: [],
          client_followup_workflows: [],
          potential_conflict_groups: [],
          requestedAudience: input.requestedAudience,
          eligible,
          blockerCodes: eligible ? [] : ["claim_review_unresolved", "evidence_review_unresolved"],
          affectedDimensionKeys: eligible ? [] : ["missingness"],
          affectedObjectIds: eligible ? [] : ["10000000-0000-4000-8000-000000000012"],
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
    `SELECT evidence_item_id::text AS evidence_item_id,
            source_id::text AS source_id,
            source_version_id::text AS source_version_id,
            source_locator_id::text AS source_locator_id
       FROM kai.evidence_items
      WHERE organization_id = $1::uuid
      ORDER BY evidence_item_id ASC
      LIMIT 1`,
    [ORG],
  );
  evidenceId = evidenceRows[0].evidence_item_id;
  sourceId = evidenceRows[0].source_id;
  sourceVersionId = evidenceRows[0].source_version_id;
  locatorId = evidenceRows[0].source_locator_id;
  await query(
    `INSERT INTO kai.claims (
       claim_id, organization_id, evidence_item_id, claim_type, claim_status,
       claim_review_status, claim_strength, statement, statement_fingerprint,
       created_by_type
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review',
             'unassessed','Synthetic P3-02 review packet claim.',
             repeat('b', 64),'system')`,
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
       '10000000-0000-4000-8000-000000000012'::uuid,$1::uuid,'claim_review','claim',
       $2::uuid,'normal','open','needs_gk_review','New claim requires GK review.',
       'Review the proposed claim before use.','{}'::jsonb,'system'
     )`,
    [ORG, CLAIM],
  );

  const generatorCalls = [];
  const createResult = await createEvidenceSummaryDraft(
    {
      organizationId: ORG,
      requestedAudience: "internal",
      claimIds: [CLAIM],
      idempotencyKey: "p3-02-created-by-p3-01",
      actorContext,
      now: NOW,
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
      generatedContentRepository: createPostgresGeneratedContentRepository({
        runInTransaction: withRunnerOwnedTransaction,
        evaluator: p301Evaluator(),
      }),
      draftGenerator: draftGenerator({ calls: generatorCalls }),
      metadataOnlyAudit: auditRecorder(),
    },
  );
  assert.equal(createResult.ok, true);
  assert.equal(createResult.data.replayed, false);
  assert.equal(generatorCalls.length, 1);
  draftId = createResult.data.generatedContentDraftId;
  queueId = createResult.data.reviewQueueItemId;

  test("P3-02 reads the exact P3-01-created draft as the accepted DTO and evaluates one repeated claim once inside the shared snapshot", async () => {
    const calls = [];
    const repository = createPostgresGeneratedContentRepository({
      runInTransaction: withRunnerOwnedTransaction,
      evaluator: evaluator({ calls, evidenceItemId: evidenceId }),
    });
    const result = await getGeneratedDraftReviewPacket(
      { organizationId: ORG, generatedContentDraftId: draftId, actorContext },
      { env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" }, generatedContentRepository: repository },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.generatedContentDraftId, draftId);
    assert.equal(result.data.reviewQueueItemId, queueId);
    assert.equal(result.data.contentType, "evidence_summary");
    assert.equal(result.data.draftStatus, "draft");
    assert.equal(result.data.queueStatus, "open");
    assert.equal(result.data.reviewStatus, "needs_gk_review");
    assert.equal(result.data.currentUseEligible, true);
    assert.deepEqual(result.data.blocks.map((block) => block.ordinal), [1, 2]);
    assert.deepEqual(result.data.blocks.map((block) => block.citations[0].claimId), [CLAIM, CLAIM]);
    assert.deepEqual(calls, [{ organizationId: ORG, claimId: CLAIM, requestedAudience: "internal" }]);
  });

  test("P3-02 current ineligibility returns the visible packet with per-claim blockers", async () => {
    const repository = createPostgresGeneratedContentRepository({
      runInTransaction: withRunnerOwnedTransaction,
      evaluator: evaluator({ eligible: false, evidenceItemId: evidenceId }),
    });
    const result = await getGeneratedDraftReviewPacket(
      { organizationId: ORG, generatedContentDraftId: draftId, actorContext },
      { env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" }, generatedContentRepository: repository },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.currentUseEligible, false);
    assert.deepEqual(result.data.blocks[0].citations[0].blockerCodes, ["claim_review_unresolved", "evidence_review_unresolved"]);
    assert.deepEqual(result.data.blocks[0].citations[0].affectedDimensionKeys, ["missingness"]);
  });

  test("P3-02 malformed authority evidence mismatch fails closed", async () => {
    const repository = createPostgresGeneratedContentRepository({
      runInTransaction: withRunnerOwnedTransaction,
      evaluator: evaluator({ evidenceItemId: "10000000-0000-4000-8000-000000000099" }),
    });
    const result = await getGeneratedDraftReviewPacket(
      { organizationId: ORG, generatedContentDraftId: draftId, actorContext },
      { env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" }, generatedContentRepository: repository },
    );
    assert.equal(result.error.code, "conflict_current_state_changed");
  });

  test("P3-02 read packet performs no writes, queue transitions, or audit effects", async () => {
    const before = await query(
      `SELECT
         (SELECT count(*)::int FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid AND queue_status = 'open') AS open_queue,
         (SELECT required_action FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid) AS required_action,
         (SELECT count(*)::int FROM kai.upload_lifecycle_audit WHERE operation = 'generated_content_draft_created') AS audits`,
      [queueId],
    );
    assert.equal(before[0].required_action, REQUIRED_ACTION);
    const repository = createPostgresGeneratedContentRepository({
      runInTransaction: withRunnerOwnedTransaction,
      evaluator: evaluator({ evidenceItemId: evidenceId }),
    });
    const result = await getGeneratedDraftReviewPacket(
      { organizationId: ORG, generatedContentDraftId: draftId, actorContext },
      { env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" }, generatedContentRepository: repository },
    );
    assert.equal(result.ok, true);
    const after = await query(
      `SELECT
         (SELECT count(*)::int FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid AND queue_status = 'open') AS open_queue,
         (SELECT required_action FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid) AS required_action,
         (SELECT count(*)::int FROM kai.upload_lifecycle_audit WHERE operation = 'generated_content_draft_created') AS audits`,
      [queueId],
    );
    assert.deepEqual(after, before);
  });

  test("P3-01 database CHECK rejects malformed generated_content_review required_action", async () => {
    await assert.rejects(
      () => query(
        `INSERT INTO kai.review_queue_items (
           organization_id, queue_type, target_object_type, target_object_id,
           priority, queue_status, review_status, summary, required_action,
           queue_metadata, created_by_type
         )
         VALUES ($1::uuid,'generated_content_review','generated_content_draft',
                 '10000000-0000-4000-8000-000000000099'::uuid,'normal','open',
                 'needs_gk_review','Generated draft requires human review.',
                 'Review citations only before use.','{}'::jsonb,'system')`,
        [ORG],
      ),
      (error) => error.code === "23514",
    );
  });

  test("P3-02 detects malformed generated_content_review queue rows without repair or mutation when the database CHECK is temporarily relaxed", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE kai.review_queue_items DROP CONSTRAINT review_queue_items_p3_01_generated_content_review_contract_check");
      await client.query(
        `UPDATE kai.review_queue_items
            SET required_action = 'Review citations only before use.'
          WHERE review_queue_item_id = $1::uuid`,
        [queueId],
      );
      const before = await client.query(
        `SELECT
           (SELECT count(*)::int FROM kai.review_queue_items) AS queues,
           (SELECT count(*)::int FROM kai.generated_content_drafts) AS drafts,
           (SELECT count(*)::int FROM kai.generated_content_blocks) AS blocks,
           (SELECT count(*)::int FROM kai.generated_content_citations) AS citations,
           (SELECT count(*)::int FROM kai.upload_lifecycle_audit WHERE operation = 'generated_content_draft_created') AS audits,
           (SELECT required_action FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid) AS required_action`,
        [queueId],
      );
      const repository = createPostgresGeneratedContentRepository({
        runInTransaction: async (callback) => callback({
          async query(sql, params) {
            if (/^SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY$/i.test(sql)) {
              return { rows: [] };
            }
            return client.query(sql, params);
          },
        }),
        evaluator: evaluator({ evidenceItemId: evidenceId }),
      });
      const result = await getGeneratedDraftReviewPacket(
        { organizationId: ORG, generatedContentDraftId: draftId, actorContext },
        { env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" }, generatedContentRepository: repository },
      );
      assert.equal(result.error.code, "conflict_current_state_changed");
      assert.equal(result.data, null);
      const after = await client.query(
        `SELECT
           (SELECT count(*)::int FROM kai.review_queue_items) AS queues,
           (SELECT count(*)::int FROM kai.generated_content_drafts) AS drafts,
           (SELECT count(*)::int FROM kai.generated_content_blocks) AS blocks,
           (SELECT count(*)::int FROM kai.generated_content_citations) AS citations,
           (SELECT count(*)::int FROM kai.upload_lifecycle_audit WHERE operation = 'generated_content_draft_created') AS audits,
           (SELECT required_action FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid) AS required_action`,
        [queueId],
      );
      assert.deepEqual(after.rows, before.rows);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const restored = await query(
      `SELECT
         (SELECT count(*)::int
            FROM pg_constraint
           WHERE conname = 'review_queue_items_p3_01_generated_content_review_contract_check') AS contract_checks,
         (SELECT required_action
            FROM kai.review_queue_items
           WHERE review_queue_item_id = $1::uuid) AS required_action`,
      [queueId],
    );
    assert.deepEqual(restored, [{ contract_checks: 1, required_action: REQUIRED_ACTION }]);
  });
}
