// P14-12 review_queue_items queue_type legacy-constraint schema-drift repair.
//
// USER_CONFIRMED production evidence: a deployed kai.review_queue_items
// simultaneously carries three validated CHECK constraints -
// review_queue_items_p1_06_queue_type_check (admits
// board_reporting_candidate_review, after BR-03A), the obsolete pre-P1-06
// review_queue_items_queue_type_check (does NOT admit
// board_reporting_candidate_review), and the BR-03B Board review lifecycle
// contract. PostgreSQL CHECK constraints are cumulative, so the obsolete
// allowlist alone blocks every real Board-candidate-review-request write even
// though the newer, named contracts already admit it - with zero existing
// board_reporting_candidate_review rows in production (surfaced as a
// currently schema-blocked write path, not yet as a customer-visible defect).
//
// This suite proves, against a real ephemeral PostgreSQL database (no mocked
// client.query, no mocked persistence), that:
//   1. the real requestBoardReportingCandidateReview repository transaction
//      is genuinely rejected BEFORE the P14-12 repair migration runs, with no
//      durable state left behind;
//   2. the SAME transaction commits successfully AFTER the repair migration
//      runs, with the exact expected durable shape;
//   3. pre-existing non-Board queue_type writes are unaffected throughout.
//
// No generation application code, Anthropic call, Board packet
// composition/eligibility/release-authority logic, or unrelated schema is
// touched or exercised beyond what BR-03A/BR-03B's own suites already cover -
// this suite is schema-repair proof only.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P14_12_REVIEW_QUEUE_TYPE_CHECK_REPAIR_DATABASE_URL;
const PHASE = process.env.KAI_P14_12_REVIEW_QUEUE_TYPE_CHECK_REPAIR_PHASE;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P14-12 review-queue queue_type legacy-constraint repair integration suite refused a non-loopback KAI_P14_12_REVIEW_QUEUE_TYPE_CHECK_REPAIR_DATABASE_URL host: ${host}`);
  }
}

test("P14-12 review-queue queue_type legacy-constraint repair PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P14-12 review-queue queue_type legacy-constraint repair PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresBoardReportingCandidateRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL || (PHASE !== "pre" && PHASE !== "post")) {
  test("P14-12 review-queue queue_type legacy-constraint repair integration requires the runner-owned database and an explicit pre/post phase", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const { createPostgresBoardReportingCandidateRepository } = await import("../Backend/kai/dictionary/postgresBoardReportingCandidateRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const ENGAGEMENT = "14120000-0000-4000-8000-000000000101";
  const NOW = "2026-09-14T10:00:00.000Z";
  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 10 });

  async function withTx(callback) {
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

  test.after(async () => {
    await pool.end();
  });

  const reviewerActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };
  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  const repository = createPostgresBoardReportingCandidateRepository({ runInTransaction: withTx });

  async function seedCandidate(idempotencyKey) {
    await pool.query(`INSERT INTO kai.organizations (organization_id, name) VALUES ($1::uuid, 'P14-12 Review-Queue Repair Org') ON CONFLICT DO NOTHING;`, [ORG]);
    await pool.query(`INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ($1::uuid, $2::uuid, 'P14-12-REVIEW-QUEUE-REPAIR') ON CONFLICT DO NOTHING;`, [ENGAGEMENT, ORG]);
    const [candidate] = (await pool.query(
      `INSERT INTO kai.board_reporting_candidates (
         organization_id, engagement_id, packet_audience, idempotency_key,
         fingerprint_contract_version, canonical_fingerprint, candidate_status,
         created_by, created_by_type, created_at
       ) VALUES (
         $1::uuid, $2::uuid, 'internal', $3,
         'kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1', $4, 'created',
         $5::uuid, 'human', $6::timestamptz
       )
       ON CONFLICT (organization_id, engagement_id, idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING board_reporting_candidate_id`,
      [ORG, ENGAGEMENT, idempotencyKey, "b".repeat(64), reviewerActor.actorUserId, NOW],
    )).rows;
    return candidate.board_reporting_candidate_id;
  }

  async function durableRowCount(boardReportingCandidateId) {
    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'board_reporting_candidate_review' AND target_object_id = $2::uuid`,
      [ORG, boardReportingCandidateId],
    );
    return rows.rows[0].n;
  }

  if (PHASE === "pre") {
    test("P14-12 PRE-MIGRATION: the real requestBoardReportingCandidateReview transaction is rejected by the stale production-drift schema, with no durable state left behind", async () => {
      const boardReportingCandidateId = await seedCandidate("p14-12-pre-migration");

      // Direct proof of the exact SQLSTATE/constraint the real
      // insertBoardReportingCandidateReviewQueueRow INSERT hits under the
      // reproduced production-drift schema, captured independently of the
      // repository's own error-code mapping (which folds 23514 into a
      // generic validation_blocker failure).
      let capturedSqlstate = null;
      let capturedConstraint = null;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        try {
          await client.query(
            `INSERT INTO kai.review_queue_items (
               organization_id, engagement_id, queue_type, target_object_type, target_object_id,
               priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
             ) VALUES ($1::uuid,$2::uuid,'board_reporting_candidate_review','board_reporting_candidate',$3::uuid,
               'medium','open','needs_gk_review','Board Reporting candidate requires review.',
               'Review internal Board packet membership and current-use support before release work.','{}'::jsonb,'system')`,
            [ORG, ENGAGEMENT, boardReportingCandidateId],
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
      assert.equal(capturedConstraint, "review_queue_items_queue_type_check");

      // Now the real repository transaction, end to end, with no mocking.
      const result = await repository.requestBoardReportingCandidateReview(
        { organizationId: ORG, engagementId: ENGAGEMENT, boardReportingCandidateId, actorContext: reviewerActor, now: NOW },
        { metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, "validation_blocker");

      const durable = await durableRowCount(boardReportingCandidateId);
      assert.equal(durable, 0, "the rolled-back transaction must leave no partial review_queue_items row");
    });
  }

  if (PHASE === "post") {
    test("P14-12 POST-MIGRATION: the same real requestBoardReportingCandidateReview transaction now commits, with the exact expected durable shape", async () => {
      const boardReportingCandidateId = await seedCandidate("p14-12-post-migration");

      const result = await repository.requestBoardReportingCandidateReview(
        { organizationId: ORG, engagementId: ENGAGEMENT, boardReportingCandidateId, actorContext: reviewerActor, now: NOW },
        { metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.queueStatus, "open");
      assert.equal(result.data.reviewStatus, "needs_gk_review");
      assert.equal(result.data.replayed, false);

      const durable = await durableRowCount(boardReportingCandidateId);
      assert.equal(durable, 1);

      // Pre-existing non-Board queue_type writes remain accepted, unaffected
      // by this repair.
      await pool.query(
        `INSERT INTO kai.review_queue_items (
           organization_id, queue_type, target_object_type, target_object_id,
           priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
         ) VALUES ($1::uuid,'claim_review','claim',gen_random_uuid(),'medium','open','needs_gk_review','x','Review this claim before use.','{}'::jsonb,'system')`,
        [ORG],
      );

      // Negative: the BR-03B Board lifecycle contract must still fail closed
      // on a malformed Board row (wrong target_object_type).
      await assert.rejects(
        () => pool.query(
          `INSERT INTO kai.review_queue_items (organization_id, engagement_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
           VALUES ($1::uuid,$2::uuid,'board_reporting_candidate_review','not_a_board_reporting_candidate',gen_random_uuid(),'medium','open','needs_gk_review','Board Reporting candidate requires review.','Review internal Board packet membership and current-use support before release work.','{}'::jsonb,'system')`,
          [ORG, ENGAGEMENT],
        ),
        (error) => error.code === "23514",
      );
    });
  }
}
