// Generated-content-review-start audit-contract migration.
//
// Repository-evidence-driven repair (see this package's runbook/patch
// notes): Backend/kai/dictionary/postgresGeneratedContentRepository.js has
// always written a 'generated_content_review_started' audit row on every
// real startGeneratedContentReview /start call, but no migration ever added
// that operation to kai.upload_lifecycle_audit's
// upload_lifecycle_audit_gate_a_operation_check allowlist - unlike its
// siblings 'generated_content_review_completed' (P3-04) and
// 'export_review_started' (P3-09). Every real /start database write has
// therefore always raised SQLSTATE 23514 on that INSERT, surfaced by the
// repository's catch branch as HTTP 422 validation_blocker.
//
// This suite proves, against a real ephemeral PostgreSQL database (no
// mocked client.query, no mocked persistence, no Anthropic call - a stub
// draftGenerator and packet evaluator only), that:
//   1. the real startGeneratedContentReview transaction is genuinely
//      rejected (23514, on exactly the missing-operation constraint) BEFORE
//      this package's migration runs, with no durable queue-state mutation
//      left behind;
//   2. the SAME transaction commits successfully AFTER the migration runs,
//      transitioning the queue item to in_progress/needs_gk_review and
//      persisting the exact expected audit metadata shape;
//   3. invalid audit operations, invalid/missing start metadata, forbidden
//      metadata content, invalid queue lifecycle, stale optimistic
//      concurrency, and a wrong draft/queue relationship all remain
//      fail-closed afterward.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_GCRS_AUDIT_CONTRACT_DATABASE_URL;
const PHASE = process.env.KAI_GCRS_AUDIT_CONTRACT_PHASE;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`generated-content-review-start audit-contract suite refused a non-loopback KAI_GCRS_AUDIT_CONTRACT_DATABASE_URL host: ${host}`);
  }
}

test("generated-content-review-start audit-contract PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("generated-content-review-start audit-contract PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresGeneratedContentRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL || (PHASE !== "pre" && PHASE !== "post")) {
  test("generated-content-review-start audit-contract integration requires the runner-owned database and an explicit pre/post phase", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { createEvidenceSummaryDraft, startGeneratedContentReview } = await import("../Backend/kai/services/kaiGeneratedContentService.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const ENGAGEMENT = "00000000-0000-4000-8000-000000000905";
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
    actorUserId: "90000000-0000-4000-8000-000000000004",
    source: "public.userdata",
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
          review_queue_item_id: "10000000-0000-4000-8000-000000000921",
          review_queue_status: "open",
          review_status: eligible ? "approved" : "needs_gk_review",
          updated_at: "2026-08-06T09:00:00.000Z",
          sensitivity_level: "unknown",
        },
        locator: { source_locator_id: "10000000-0000-4000-8000-000000000922" },
        source: { source_id: "10000000-0000-4000-8000-000000000923", source_code: null },
        source_version: { source_version_id: "10000000-0000-4000-8000-000000000924", is_current: true },
        claim_review: { review_queue_item_id: "10000000-0000-4000-8000-000000000925", queue_status: "open", review_status: eligible ? "approved" : "needs_gk_review" },
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
        candidate: { intake_source_candidate_id: "90000000-0000-4000-8000-000000000903" },
        promotion_decision: { intake_promotion_decision_id: "10000000-0000-4000-8000-000000000926" },
        dimensions: {},
        gap_items: [],
        client_followup_workflows: [],
        potential_conflict_groups: [],
        requestedAudience: evalInput.requestedAudience,
        eligible,
        blockerCodes: eligible ? [] : ["claim_review_unresolved"],
        affectedDimensionKeys: eligible ? [] : ["missingness"],
        affectedObjectIds: eligible ? [] : ["10000000-0000-4000-8000-000000000925"],
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

  test.after(async () => {
    await pool.end();
  });

  await query(
    `INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, 'GCRS Audit Contract Org', 'gcrs-audit-contract-org') ON CONFLICT (organization_id) DO NOTHING;`,
    [ORG],
  );
  await query(
    `INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ($1::uuid, $2::uuid, 'GCRS-AUDIT-CONTRACT') ON CONFLICT (engagement_id) DO NOTHING;`,
    [ENGAGEMENT, ORG],
  );

  // PHASE-tagged so "pre" and "post" runs (against the same synthetic
  // database, applied in sequence by the runner) never collide on a
  // deterministic id: without this tag, phase "post"'s first call would
  // reuse phase "pre"'s already-committed evidence_items/claims ids.
  const phaseTag = PHASE === "pre" ? "a" : "b";
  let claimSuffix = 0;
  async function buildDraftAndQueueItem() {
    claimSuffix += 1;
    const suffix = phaseTag + String(claimSuffix).padStart(2, "0");
    const evidenceId = `9c510000-0000-4000-8000-000000001${suffix}`;
    const claimId = `9c510000-0000-4000-8000-000000002${suffix}`;
    const claimReviewQueueId = `9c510000-0000-4000-8000-000000003${suffix}`;

    const [sourceEvidence] = await query(
      `SELECT evidence_item_id::text AS evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id ASC LIMIT 1`,
      [ORG],
    );
    await query(
      `INSERT INTO kai.evidence_items (
         evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
         evidence_type, data_class, sensitivity_level, support_strength, statement,
         statement_fingerprint, created_by_type
       )
       SELECT $1::uuid, organization_id, source_id, source_version_id, source_locator_id,
              evidence_type, data_class, sensitivity_level, support_strength,
              'Synthetic generated-content-review-start evidence item.', $3, created_by_type
         FROM kai.evidence_items
        WHERE evidence_item_id = $2::uuid`,
      [evidenceId, sourceEvidence.evidence_item_id, "a".repeat(61) + suffix],
    );
    await query(
      `INSERT INTO kai.claims (
         claim_id, organization_id, evidence_item_id, claim_type, claim_status,
         claim_review_status, claim_strength, statement, statement_fingerprint,
         created_by_type
       )
       VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review',
               'unassessed','Synthetic generated-content-review-start claim.',
               $4,'system')`,
      [claimId, ORG, evidenceId, "b".repeat(61) + suffix],
    );
    await query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
      [ORG, claimId, evidenceId],
    );
    await query(
      `INSERT INTO kai.review_queue_items (
         review_queue_item_id, organization_id, queue_type, target_object_type,
         target_object_id, priority, queue_status, review_status, summary,
         required_action, queue_metadata, created_by_type
       )
       VALUES (
         $1::uuid,$2::uuid,'claim_review','claim',
         $3::uuid,'medium','open','needs_gk_review','New claim requires GK review.',
         'Review the proposed claim before use.','{}'::jsonb,'system'
       )`,
      [claimReviewQueueId, ORG, claimId],
    );

    const createResult = await createEvidenceSummaryDraft(
      {
        organizationId: ORG,
        engagementId: ENGAGEMENT,
        requestedAudience: "internal",
        claimIds: [claimId],
        idempotencyKey: `gcrs-draft-${PHASE}-${claimSuffix}`,
        actorContext,
        now: NOW,
      },
      {
        env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
        getEngagementForOrganization,
        generatedContentRepository: createPostgresGeneratedContentRepository({
          runInTransaction: withRunnerOwnedTransaction,
          evaluator: p301Evaluator(),
        }),
        draftGenerator: draftGenerator(),
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(createResult.ok, true, JSON.stringify(createResult));
    return { draftId: createResult.data.generatedContentDraftId, queueId: createResult.data.reviewQueueItemId, evidenceId };
  }

  const enabledEnv = { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" };

  if (PHASE === "pre") {
    test("PRE-MIGRATION: the real startGeneratedContentReview transaction is rejected under the current (unrepaired) audit-operation vocabulary, with no durable queue-state mutation left behind", async () => {
      const { draftId, queueId, evidenceId } = await buildDraftAndQueueItem();
      const expectedUpdatedAt = await currentUpdatedAt(queueId);

      // Direct proof of the exact SQLSTATE/constraint the real
      // insertGeneratedContentStartReviewAudit INSERT hits, captured
      // independently of the repository's own error-code mapping.
      let capturedSqlstate = null;
      let capturedConstraint = null;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        try {
          const [intakeFile] = await query(`SELECT intake_file_id::text AS id, upload_state FROM kai.intake_files WHERE organization_id = $1::uuid LIMIT 1`, [ORG]);
          await client.query(
            `INSERT INTO kai.upload_lifecycle_audit (organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at)
             VALUES ($1::uuid,$2::uuid,'generated_content_review_started',$3,$3,'success','{}'::jsonb,now())`,
            [ORG, intakeFile.id, intakeFile.upload_state],
          );
        } catch (error) {
          capturedSqlstate = error.code;
          capturedConstraint = error.constraint;
        }
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
      assert.equal(capturedSqlstate, "23514");
      assert.equal(capturedConstraint, "upload_lifecycle_audit_gate_a_operation_check");

      const repository = createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) });
      const result = await startGeneratedContentReview(
        { organizationId: ORG, generatedContentDraftId: draftId, reviewQueueItemId: queueId, expectedUpdatedAt, actorContext, now: NOW },
        { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, "validation_blocker");
      assert.ok(result.blockers.some((b) => b.validator_key === "VAL-REV-START-001"), JSON.stringify(result.blockers));

      const queueRows = await query(`SELECT queue_status, review_status FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [queueId]);
      assert.equal(queueRows[0].queue_status, "open", "the rolled-back transaction must leave the queue item in its original open state");
      assert.equal(queueRows[0].review_status, "needs_gk_review");

      const auditRows = await query(`SELECT count(*)::int AS n FROM kai.upload_lifecycle_audit WHERE operation = 'generated_content_review_started' AND metadata->>'generated_content_draft_id' = $1`, [draftId]);
      assert.equal(auditRows[0].n, 0, "the rolled-back transaction must leave no partial audit row");
    });
  }

  if (PHASE === "post") {
    test("POST-MIGRATION: the same real startGeneratedContentReview transaction now commits, transitioning the queue item and persisting the exact expected audit metadata shape", async () => {
      const { draftId, queueId, evidenceId } = await buildDraftAndQueueItem();
      const expectedUpdatedAt = await currentUpdatedAt(queueId);

      const repository = createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) });
      const deps = { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() };
      const requestInput = { organizationId: ORG, generatedContentDraftId: draftId, reviewQueueItemId: queueId, expectedUpdatedAt, actorContext, now: NOW };

      const fresh = await startGeneratedContentReview(requestInput, deps);
      assert.equal(fresh.ok, true, JSON.stringify(fresh));
      assert.equal(fresh.data.replayed, false);
      assert.equal(fresh.data.queueStatus, "in_progress");
      assert.equal(fresh.data.reviewStatus, "needs_gk_review");

      const queueRows = await query(`SELECT queue_status, review_status FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [queueId]);
      assert.equal(queueRows[0].queue_status, "in_progress");
      assert.equal(queueRows[0].review_status, "needs_gk_review");

      const auditRows = await query(
        `SELECT metadata FROM kai.upload_lifecycle_audit WHERE operation = 'generated_content_review_started' AND metadata->>'generated_content_draft_id' = $1`,
        [draftId],
      );
      assert.equal(auditRows.length, 1);
      assert.deepEqual(new Set(Object.keys(auditRows[0].metadata)), new Set([
        "contract",
        "organization_id",
        "generation_run_id",
        "generated_content_draft_id",
        "review_queue_item_id",
        "actor_id",
        "actor_type",
        "expected_updated_at",
        "requested_start_timestamp",
        "previous_queue_status",
        "resulting_queue_status",
        "previous_review_status",
        "resulting_review_status",
        "validator_keys",
      ]));

      // Replay is idempotent: no second queue transition, no second audit row.
      const replayRepository = createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) });
      const replay = await startGeneratedContentReview(requestInput, { env: enabledEnv, generatedContentRepository: replayRepository, metadataOnlyAudit: auditRecorder() });
      assert.equal(replay.ok, true, JSON.stringify(replay));
      assert.equal(replay.data.replayed, true);
      const auditRowsAfterReplay = await query(
        `SELECT count(*)::int AS n FROM kai.upload_lifecycle_audit WHERE operation = 'generated_content_review_started' AND metadata->>'generated_content_draft_id' = $1`,
        [draftId],
      );
      assert.equal(auditRowsAfterReplay[0].n, 1);
    });

    test("POST-MIGRATION negative: stale optimistic concurrency (wrong expectedUpdatedAt) remains fail-closed", async () => {
      const { draftId, queueId, evidenceId } = await buildDraftAndQueueItem();
      const repository = createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) });
      const result = await startGeneratedContentReview(
        { organizationId: ORG, generatedContentDraftId: draftId, reviewQueueItemId: queueId, expectedUpdatedAt: "2020-01-01T00:00:00.000Z", actorContext, now: NOW },
        { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "conflict_current_state_changed");
    });

    test("POST-MIGRATION negative: a wrong draft/queue relationship remains fail-closed with not_found", async () => {
      const { queueId, evidenceId } = await buildDraftAndQueueItem();
      const { draftId: otherDraftId } = await buildDraftAndQueueItem();
      const expectedUpdatedAt = await currentUpdatedAt(queueId);
      const repository = createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) });
      const result = await startGeneratedContentReview(
        { organizationId: ORG, generatedContentDraftId: otherDraftId, reviewQueueItemId: queueId, expectedUpdatedAt, actorContext, now: NOW },
        { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "conflict_current_state_changed");
    });

    test("POST-MIGRATION negative: invalid queue lifecycle (already in_progress) remains blocked", async () => {
      const { draftId, queueId, evidenceId } = await buildDraftAndQueueItem();
      const repository = createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) });
      const deps = { env: enabledEnv, generatedContentRepository: repository, metadataOnlyAudit: auditRecorder() };
      const expectedUpdatedAt = await currentUpdatedAt(queueId);
      const first = await startGeneratedContentReview(
        { organizationId: ORG, generatedContentDraftId: draftId, reviewQueueItemId: queueId, expectedUpdatedAt, actorContext, now: NOW },
        deps,
      );
      assert.equal(first.ok, true);

      const staleExpected = expectedUpdatedAt;
      const second = await startGeneratedContentReview(
        { organizationId: ORG, generatedContentDraftId: draftId, reviewQueueItemId: queueId, expectedUpdatedAt: staleExpected, actorContext, now: NOW },
        { env: enabledEnv, generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction, evaluator: readPacketEvaluator({ eligible: true, evidenceItemId: evidenceId }) }), metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(second.ok, true);
      assert.equal(second.data.replayed, true, "an identical retry against the now-in_progress state must replay, not error");
    });

    test("POST-MIGRATION negative: invalid/missing required start metadata is rejected directly at the database boundary", async () => {
      const [intakeFile] = await query(`SELECT intake_file_id::text AS id, upload_state FROM kai.intake_files WHERE organization_id = $1::uuid LIMIT 1`, [ORG]);
      await assert.rejects(
        () => pool.query(
          `INSERT INTO kai.upload_lifecycle_audit (organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata)
           VALUES ($1::uuid,$2::uuid,'generated_content_review_started',$3,$3,'success','{"contract":"p3_stage_b_generated_content_review_start_v1"}'::jsonb)`,
          [ORG, intakeFile.id, intakeFile.upload_state],
        ),
        (error) => error.code === "23514" && error.constraint === "upload_lifecycle_audit_gcrs_metadata_object_check",
      );
    });

    test("POST-MIGRATION negative: an invalid audit operation still fails closed", async () => {
      const [intakeFile] = await query(`SELECT intake_file_id::text AS id, upload_state FROM kai.intake_files WHERE organization_id = $1::uuid LIMIT 1`, [ORG]);
      await assert.rejects(
        () => pool.query(
          `INSERT INTO kai.upload_lifecycle_audit (organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata)
           VALUES ($1::uuid,$2::uuid,'not_a_real_operation',$3,$3,'success','{}'::jsonb)`,
          [ORG, intakeFile.id, intakeFile.upload_state],
        ),
        (error) => error.code === "23514" && error.constraint === "upload_lifecycle_audit_gate_a_operation_check",
      );
    });
  }
}
