import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_REVIEW_QUEUE_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`Review Queue integration suite refused a non-loopback KAI_REVIEW_QUEUE_DATABASE_URL host: ${host}`);
  }
}

test("Review Queue PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("Review Queue PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresClaimTraceabilityRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("Review Queue integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runReviewQueueIntegrationSuite();
}

async function runReviewQueueIntegrationSuite() {
  const { Pool } = await import("pg");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { listOrganizationReviewQueue } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { createPostgresClaimTraceabilityRepository } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
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

  const actorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [
      { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
    ],
  };

  function auditRecorder() {
    return {
      prepareMetadataOnlyAudit() {
        return { ok: true, async publish() {} };
      },
    };
  }

  const evidenceRepo = createPostgresEvidenceLineageRepository({ runInTransaction: withRunnerOwnedTransaction });
  const claimRepo = createPostgresClaimProposalRepository({ runInTransaction: withRunnerOwnedTransaction });
  const gapRepo = createPostgresClaimGapFollowupRepository({ runInTransaction: withRunnerOwnedTransaction });
  const traceRepo = createPostgresClaimTraceabilityRepository({ runInTransaction: withRunnerOwnedTransaction });

  test.after(async () => {
    await pool.end();
  });

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }

  async function reviewQueue() {
    return listOrganizationReviewQueue(
      { organizationId: ORG, actorContext },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimTraceabilityRepository: traceRepo },
    );
  }

  test("Review Queue rollup: a claim with resolved evidence/claim-review queue lifecycle, no recorded decision, an unresolved coverage dimension, and a waiting-on-client follow-up still surfaces all four current blockers", async () => {
    const sourceVersions = await query(
      `SELECT source_version_id
         FROM kai.source_versions
        WHERE organization_id = $1::uuid
          AND is_current = true
        ORDER BY source_version_id
        LIMIT 1`,
      [ORG],
    );
    const evidenceResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersions[0].source_version_id, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceLineageRepository: evidenceRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceResult.ok, true);
    const [evidenceRow] = await query(
      `SELECT evidence_item_id
         FROM kai.evidence_items
        WHERE organization_id = $1::uuid
        ORDER BY evidence_item_id
        LIMIT 1`,
      [ORG],
    );
    const claimResult = await proposeClaim(
      { organizationId: ORG, evidenceItemId: evidenceRow.evidence_item_id, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: claimRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimResult.ok, true);
    const claimId = claimResult.data.claim.claim_id;
    const gapResult = await generateClaimGapFollowups(
      { organizationId: ORG, claimId, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(gapResult.ok, true);

    // Simulate the exact production screenshot state: the evidence-review and
    // claim-review review_queue_items lifecycle is marked resolved, but NO
    // row is ever inserted into kai.evidence_review_decisions or
    // kai.claim_review_decisions - i.e. a legacy/pre-P2-12 style resolved
    // queue row with no decision-ledger head behind it.
    const beforeEvidenceDecisions = (await query(`SELECT count(*)::int AS count FROM kai.evidence_review_decisions`))[0].count;
    const beforeClaimDecisions = (await query(`SELECT count(*)::int AS count FROM kai.claim_review_decisions`))[0].count;
    await pool.query(
      `UPDATE kai.review_queue_items
          SET queue_status = 'resolved', review_status = 'resolved'
        WHERE organization_id = $1::uuid
          AND queue_type = 'evidence_review'
          AND target_object_id = $2::uuid`,
      [ORG, evidenceRow.evidence_item_id],
    );
    await pool.query(
      `UPDATE kai.review_queue_items
          SET queue_status = 'resolved', review_status = 'resolved'
        WHERE organization_id = $1::uuid
          AND queue_type = 'claim_review'
          AND target_object_id = $2::uuid`,
      [ORG, claimId],
    );
    const [followupItem] = await query(
      `SELECT client_followup_item_id FROM kai.client_followup_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid LIMIT 1`,
      [ORG, claimId],
    );
    await pool.query(
      `UPDATE kai.review_queue_items
          SET queue_status = 'waiting_on_client', review_status = 'proposed'
        WHERE organization_id = $1::uuid
          AND queue_type = 'client_followup'
          AND target_object_id = $2::uuid`,
      [ORG, followupItem.client_followup_item_id],
    );

    const result = await reviewQueue();
    assert.equal(result.ok, true);
    const item = result.data.items.find((entry) => entry.claim.claim_id === claimId);
    assert.ok(item, "the claim must appear in the Review Queue rollup");

    // 1-4: all four current blockers remain visible.
    assert.ok(item.blockerCodes.includes("claim_review_unresolved"));
    assert.ok(item.blockerCodes.includes("evidence_review_unresolved"));
    assert.ok(item.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.ok(item.blockerCodes.includes("client_followup_unresolved"));

    // 5: the resolved lifecycle is disclosed as-is (never hidden).
    assert.equal(item.evidence.review_queue_status, "resolved");
    assert.equal(item.evidence.review_status, "resolved");
    assert.equal(item.claim_review.queue_status, "resolved");
    assert.equal(item.claim_review.review_status, "resolved");

    // 6: the resolved queue row is never reinterpreted as an approved decision.
    assert.equal(item.evidence_review_decision, null);
    assert.equal(item.claim_review_decision, null);
    assert.equal(item.eligible, false);

    // 7: the rollup itself never mutates, reopens, or replaces the resolved
    // queue row, and never invents a decision.
    const afterEvidenceDecisions = (await query(`SELECT count(*)::int AS count FROM kai.evidence_review_decisions`))[0].count;
    const afterClaimDecisions = (await query(`SELECT count(*)::int AS count FROM kai.claim_review_decisions`))[0].count;
    assert.equal(afterEvidenceDecisions, beforeEvidenceDecisions);
    assert.equal(afterClaimDecisions, beforeClaimDecisions);
    const [evidenceQueueRowAfter] = await query(
      `SELECT queue_status, review_status FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_id = $2::uuid`,
      [ORG, evidenceRow.evidence_item_id],
    );
    assert.equal(evidenceQueueRowAfter.queue_status, "resolved");
    assert.equal(evidenceQueueRowAfter.review_status, "resolved");
  });
}
