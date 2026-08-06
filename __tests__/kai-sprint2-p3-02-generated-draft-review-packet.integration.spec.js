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
  const { getGeneratedDraftReviewPacket } = await import("../Backend/kai/services/kaiGeneratedContentService.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const RUN = "10000000-0000-4000-8000-000000000001";
  const DRAFT = "10000000-0000-4000-8000-000000000002";
  const BLOCK_1 = "10000000-0000-4000-8000-000000000003";
  const BLOCK_2 = "10000000-0000-4000-8000-000000000004";
  const CLAIM = "10000000-0000-4000-8000-000000000005";
  const QUEUE = "10000000-0000-4000-8000-000000000010";
  const NOW = "2026-08-06T10:00:00.000Z";
  let evidenceId = null;
  let sourceId = null;
  let sourceVersionId = null;
  let locatorId = null;
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
  await query(
    `INSERT INTO kai.generation_runs (
       generation_run_id, organization_id, idempotency_key, request_fingerprint,
       content_type, requested_audience, created_by_type, created_at
     )
     VALUES ($1::uuid,$2::uuid,'p3-02-synthetic',repeat('a',64),
             'evidence_summary','internal','system',$3::timestamptz)`,
    [RUN, ORG, NOW],
  );
  await query(
    `INSERT INTO kai.generated_content_drafts (
       generated_content_draft_id, generation_run_id, organization_id, content_type,
       requested_audience, draft_status, review_status, validator_results,
       created_by_type, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,'evidence_summary','internal','draft',
             'needs_gk_review','[]'::jsonb,'system',$4::timestamptz)`,
    [DRAFT, RUN, ORG, NOW],
  );
  await query(
    `INSERT INTO kai.generated_content_blocks (
       generated_content_block_id, generated_content_draft_id, organization_id,
       ordinal, text, created_at
     )
     VALUES
       ($1::uuid,$3::uuid,$4::uuid,1,'First visible generated paragraph.',$5::timestamptz),
       ($2::uuid,$3::uuid,$4::uuid,2,'Second visible generated paragraph.',$5::timestamptz)`,
    [BLOCK_1, BLOCK_2, DRAFT, ORG, NOW],
  );
  await query(
    `INSERT INTO kai.generated_content_citations (
       generated_content_block_id, organization_id, claim_id, evidence_item_id, created_at
     )
     VALUES
       ($1::uuid,$3::uuid,$4::uuid,$5::uuid,$6::timestamptz),
       ($2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::timestamptz)`,
    [BLOCK_1, BLOCK_2, ORG, CLAIM, evidenceId, NOW],
  );
  await query(
    `INSERT INTO kai.review_queue_items (
       review_queue_item_id, organization_id, queue_type, target_object_type,
       target_object_id, priority, queue_status, review_status, summary,
       required_action, queue_metadata, created_by_type
     )
     VALUES ($1::uuid,$2::uuid,'generated_content_review','generated_content_draft',
             $3::uuid,'normal','open','needs_gk_review',
             'Generated draft requires human review.',
             'Review citations, audience eligibility, limitations, and unsupported claims before any use.',
             '{}'::jsonb,'system')`,
    [QUEUE, ORG, DRAFT],
  );

  test("P3-02 read packet returns deterministic blocks and evaluates one repeated claim once inside the shared snapshot", async () => {
    const calls = [];
    const repository = createPostgresGeneratedContentRepository({
      runInTransaction: withRunnerOwnedTransaction,
      evaluator: evaluator({ calls, evidenceItemId: evidenceId }),
    });
    const result = await getGeneratedDraftReviewPacket(
      { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext },
      { env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" }, generatedContentRepository: repository },
    );
    assert.equal(result.ok, true);
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
      { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext },
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
      { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext },
      { env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" }, generatedContentRepository: repository },
    );
    assert.equal(result.error.code, "conflict_current_state_changed");
  });

  test("P3-02 read packet performs no writes, queue transitions, or audit effects", async () => {
    const before = await query(
      `SELECT
         (SELECT count(*)::int FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid AND queue_status = 'open') AS open_queue,
         (SELECT count(*)::int FROM kai.upload_lifecycle_audit WHERE operation = 'generated_content_draft_created') AS audits`,
      [QUEUE],
    );
    const repository = createPostgresGeneratedContentRepository({
      runInTransaction: withRunnerOwnedTransaction,
      evaluator: evaluator({ evidenceItemId: evidenceId }),
    });
    const result = await getGeneratedDraftReviewPacket(
      { organizationId: ORG, generatedContentDraftId: DRAFT, actorContext },
      { env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" }, generatedContentRepository: repository },
    );
    assert.equal(result.ok, true);
    const after = await query(
      `SELECT
         (SELECT count(*)::int FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid AND queue_status = 'open') AS open_queue,
         (SELECT count(*)::int FROM kai.upload_lifecycle_audit WHERE operation = 'generated_content_draft_created') AS audits`,
      [QUEUE],
    );
    assert.deepEqual(after, before);
  });
}
