import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_12_HUMAN_REVIEW_DECISION_LEDGER_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P2-12 integration suite refused a non-loopback KAI_P2_12_HUMAN_REVIEW_DECISION_LEDGER_DATABASE_URL host: ${host}`);
  }
}

test("P2-12 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P2-12 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresHumanReviewRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P2-12 human-review-decision-ledger integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP212IntegrationSuite();
}

// NOTE ON FIXTURE BUDGET: the synthetic P1-04 dictionary carries exactly two
// fields, so exactly two evidence items / claims exist for ORG's source
// version (alpha, beta). Every scenario below is deliberately sequenced to
// build on top of alpha's or beta's PRIOR state via legitimate re-review
// (superseding), rather than requiring a third pristine fixture - this
// mirrors how a real reviewer would revisit and correct an existing decision.
async function runP212IntegrationSuite() {
  const { Pool } = await import("pg");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { createPostgresClaimTraceabilityRepository } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");
  const { createPostgresHumanReviewRepository } = await import("../Backend/kai/dictionary/postgresHumanReviewRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const NOW = "2026-08-06T10:00:00.000Z";
  const T1 = "2026-08-06T10:05:00.000Z";
  const T2 = "2026-08-06T10:10:00.000Z";
  const T3 = "2026-08-06T10:15:00.000Z";
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

  const reviewerActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };

  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  const evidenceRepo = createPostgresEvidenceLineageRepository({ runInTransaction: withRunnerOwnedTransaction });
  const claimRepo = createPostgresClaimProposalRepository({ runInTransaction: withRunnerOwnedTransaction });
  const gapRepo = createPostgresClaimGapFollowupRepository({ runInTransaction: withRunnerOwnedTransaction });
  const traceRepo = createPostgresClaimTraceabilityRepository({ runInTransaction: withRunnerOwnedTransaction });
  const humanReviewRepo = createPostgresHumanReviewRepository({ runInTransaction: withRunnerOwnedTransaction });

  test.after(async () => {
    await pool.end();
  });

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }

  async function trace(claimId, requestedAudience = "internal") {
    return getClaimTraceabilitySummary(
      { organizationId: ORG, claimId, requestedAudience, actorContext: reviewerActor },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimTraceabilityRepository: traceRepo },
    );
  }

  let preparedClaims = null;
  async function prepareTwoClaims() {
    if (preparedClaims) return preparedClaims;
    const sourceVersions = await query(
      `SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1`,
      [ORG],
    );
    const evidenceResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersions[0].source_version_id, actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceLineageRepository: evidenceRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceResult.ok, true);
    const evidenceRows = await query(
      `SELECT evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id LIMIT 2`,
      [ORG],
    );
    assert.equal(evidenceRows.length, 2);
    const claims = [];
    for (const row of evidenceRows) {
      const claimResult = await proposeClaim(
        { organizationId: ORG, evidenceItemId: row.evidence_item_id, actorContext: reviewerActor, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: claimRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(claimResult.ok, true);
      const gapResult = await generateClaimGapFollowups(
        { organizationId: ORG, claimId: claimResult.data.claim.claim_id, actorContext: reviewerActor, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(gapResult.ok, true);
      claims.push({ claimId: claimResult.data.claim.claim_id, evidenceItemId: row.evidence_item_id });
    }
    preparedClaims = claims.sort((a, b) => (a.claimId < b.claimId ? -1 : 1));
    return preparedClaims;
  }

  async function evidenceReviewQueueItem(evidenceItemId) {
    const rows = await query(
      `SELECT review_queue_item_id, queue_status, review_status, updated_at FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_type = 'evidence_item' AND target_object_id = $2::uuid`,
      [ORG, evidenceItemId],
    );
    return rows[0];
  }

  async function claimReviewQueueItem(claimId) {
    const rows = await query(
      `SELECT review_queue_item_id, queue_status, review_status, updated_at FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_type = 'claim' AND target_object_id = $2::uuid`,
      [ORG, claimId],
    );
    return rows[0];
  }

  test("P2-12 before human review: internal is ineligible for the required reasons and the claim is absent from eligible-claims-for-audience", async () => {
    const [alpha] = await prepareTwoClaims();
    const before = await trace(alpha.claimId);
    assert.equal(before.ok, true);
    assert.equal(before.data.eligible, false);
    assert.ok(before.data.blockerCodes.includes("evidence_review_unresolved"));
    assert.ok(before.data.blockerCodes.includes("claim_review_unresolved"));
    assert.ok(before.data.blockerCodes.includes("support_strength_unassessed"));
  });

  test("P2-12 resolved queue without a decision head is treated as unresolved by P2-06 (legacy fail-closed), and the legacy-repair mechanism inserts the first real decision as a root", async () => {
    const [alpha] = await prepareTwoClaims();
    const evidenceQueueItem = await evidenceReviewQueueItem(alpha.evidenceItemId);

    // Simulate the legacy pre-P2-12 code path: resolve the queue and set a
    // terminal strength directly, with NO decision row ever recorded.
    await query(
      `UPDATE kai.review_queue_items SET queue_status = 'resolved', review_status = 'resolved' WHERE review_queue_item_id = $1::uuid`,
      [evidenceQueueItem.review_queue_item_id],
    );
    await query(
      `UPDATE kai.evidence_items SET support_strength = 'reviewed_supported', evidence_review_status = 'reviewed' WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`,
      [ORG, alpha.evidenceItemId],
    );
    const decisionCountBefore = await query(`SELECT count(*)::int AS count FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`, [ORG, alpha.evidenceItemId]);
    assert.equal(decisionCountBefore[0].count, 0);

    const tracedBefore = await trace(alpha.claimId);
    assert.equal(tracedBefore.ok, true);
    assert.ok(tracedBefore.data.blockerCodes.includes("evidence_review_unresolved"));
    // A1C-1: a legacy resolved queue with no decision row must never fabricate
    // a decision - the DTO field stays null and the item remains blocked.
    assert.equal(tracedBefore.data.evidence_review_decision, null);

    // The legacy-repair mechanism: recording a genuine first decision now
    // (the queue is already resolved/resolved) inserts as a ROOT, exactly
    // like an ordinary first review - no special-case code path.
    const queueItemAfter = await evidenceReviewQueueItem(alpha.evidenceItemId);
    const repaired = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId: alpha.evidenceItemId, reviewQueueItemId: queueItemAfter.review_queue_item_id,
        expectedUpdatedAt: new Date(queueItemAfter.updated_at).toISOString(), decision: "supported",
        actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(repaired.ok, true);
    const decisionRows = await query(`SELECT decision_id, supersedes_decision_id FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`, [ORG, alpha.evidenceItemId]);
    assert.equal(decisionRows.length, 1);
    assert.equal(decisionRows[0].supersedes_decision_id, null);

    const tracedAfter = await trace(alpha.claimId);
    assert.ok(!tracedAfter.data.blockerCodes.includes("evidence_review_unresolved"));
    // A1C-1: the current (root, terminal) decision is now returned as-is.
    assert.deepEqual(tracedAfter.data.evidence_review_decision, {
      decision_id: decisionRows[0].decision_id,
      decision_outcome: "supported",
    });
  });

  test("P2-12 needs_more_information reopens a resolved item and never sets a terminal strength; a legitimate re-review then resolves it again, and the old decision rows remain provably immutable", async () => {
    const [alpha] = await prepareTwoClaims();
    const queueBefore = await evidenceReviewQueueItem(alpha.evidenceItemId);
    assert.equal(queueBefore.queue_status, "resolved"); // from the prior test

    const rootDecision = (await query(`SELECT decision_id FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid AND supersedes_decision_id IS NULL`, [ORG, alpha.evidenceItemId]))[0];

    const reopened = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId: alpha.evidenceItemId, reviewQueueItemId: queueBefore.review_queue_item_id,
        expectedUpdatedAt: new Date(queueBefore.updated_at).toISOString(), decision: "needs_more_information",
        actorContext: reviewerActor, now: T1,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(reopened.ok, true);
    assert.equal(reopened.data.queue_status, "open");
    assert.equal(reopened.data.review_status, "needs_gk_review");
    assert.equal(reopened.data.support_strength, "unassessed");

    const tracedReopened = await trace(alpha.claimId);
    assert.ok(tracedReopened.data.blockerCodes.includes("evidence_review_unresolved"));
    assert.ok(tracedReopened.data.blockerCodes.includes("support_strength_unassessed"));
    // A1C-1: needs_more_information is returned truthfully as the current
    // decision, and the review remains unresolved (proven above).
    assert.equal(tracedReopened.data.evidence_review_decision.decision_outcome, "needs_more_information");
    assert.equal(tracedReopened.data.evidence_review_decision.decision_id, reopened.data.decision_id);

    const queueAfterReopen = await evidenceReviewQueueItem(alpha.evidenceItemId);
    const reResolved = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId: alpha.evidenceItemId, reviewQueueItemId: queueAfterReopen.review_queue_item_id,
        expectedUpdatedAt: new Date(queueAfterReopen.updated_at).toISOString(), decision: "supported",
        actorContext: reviewerActor, now: T2,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(reResolved.ok, true);
    assert.equal(reResolved.data.queue_status, "resolved");
    assert.equal(reResolved.data.support_strength, "reviewed_supported");

    const decisionRows = await query(
      `SELECT decision_id, decision_outcome, supersedes_decision_id FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid ORDER BY created_at`,
      [ORG, alpha.evidenceItemId],
    );
    assert.equal(decisionRows.length, 3);
    assert.equal(decisionRows[0].decision_id, rootDecision.decision_id);
    assert.equal(decisionRows[1].decision_outcome, "needs_more_information");
    assert.equal(decisionRows[1].supersedes_decision_id, decisionRows[0].decision_id);
    assert.equal(decisionRows[2].decision_outcome, "supported");
    assert.equal(decisionRows[2].supersedes_decision_id, decisionRows[1].decision_id);

    // A1C-1: only the current lineage head (the third, terminal row) is
    // returned - the superseded root and the superseded needs_more_information
    // row are never disclosed as current.
    const tracedResolvedAgain = await trace(alpha.claimId);
    assert.equal(tracedResolvedAgain.data.evidence_review_decision.decision_id, decisionRows[2].decision_id);
    assert.equal(tracedResolvedAgain.data.evidence_review_decision.decision_outcome, "supported");
    assert.notEqual(tracedResolvedAgain.data.evidence_review_decision.decision_id, decisionRows[0].decision_id);
    assert.notEqual(tracedResolvedAgain.data.evidence_review_decision.decision_id, decisionRows[1].decision_id);

    // Append-only proof: the OLD (superseded) decision rows are still
    // present and immutable - a direct UPDATE/DELETE is rejected.
    await assert.rejects(query(`UPDATE kai.evidence_review_decisions SET decision_outcome = 'not_supported' WHERE decision_id = $1::uuid`, [decisionRows[0].decision_id]), /append-only/);
    await assert.rejects(query(`DELETE FROM kai.evidence_review_decisions WHERE decision_id = $1::uuid`, [decisionRows[1].decision_id]), /append-only/);
  });

  test("P2-12 not_supported resolves the evidence-review queue but P2-06 still blocks eligibility via the broadened strength check", async () => {
    const [, beta] = await prepareTwoClaims();
    const queueItem = await evidenceReviewQueueItem(beta.evidenceItemId);
    const result = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId: beta.evidenceItemId, reviewQueueItemId: queueItem.review_queue_item_id,
        expectedUpdatedAt: new Date(queueItem.updated_at).toISOString(), decision: "not_supported",
        actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.queue_status, "resolved");
    assert.equal(result.data.support_strength, "reviewed_not_supported");

    const traced = await trace(beta.claimId);
    assert.equal(traced.ok, true);
    assert.ok(!traced.data.blockerCodes.includes("evidence_review_unresolved"));
    assert.ok(traced.data.blockerCodes.includes("support_strength_unassessed"));
    assert.equal(traced.data.eligible, false);
  });

  test("P2-12 supported_with_limitation requires non-empty limitation_notes, then a re-review flips beta's evidence to supported; an approved claim decision then clears the corresponding P2-06 blockers", async () => {
    const [, beta] = await prepareTwoClaims();
    const queueItem = await evidenceReviewQueueItem(beta.evidenceItemId);

    const missingNotes = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId: beta.evidenceItemId, reviewQueueItemId: queueItem.review_queue_item_id,
        expectedUpdatedAt: new Date(queueItem.updated_at).toISOString(), decision: "supported_with_limitation",
        actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(missingNotes.ok, false);
    assert.equal(missingNotes.error.code, "validation_blocker");

    const unexpectedNotes = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId: beta.evidenceItemId, reviewQueueItemId: queueItem.review_queue_item_id,
        expectedUpdatedAt: new Date(queueItem.updated_at).toISOString(), decision: "supported",
        limitationNotes: ["should not be allowed"], actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(unexpectedNotes.ok, false);
    assert.equal(unexpectedNotes.error.code, "validation_blocker");

    const withNotes = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId: beta.evidenceItemId, reviewQueueItemId: queueItem.review_queue_item_id,
        expectedUpdatedAt: new Date(queueItem.updated_at).toISOString(), decision: "supported_with_limitation",
        limitationNotes: ["Sample is small."], actorContext: reviewerActor, now: T1,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(withNotes.ok, true);
    assert.equal(withNotes.data.support_strength, "reviewed_supported");

    const claimQueueItem = await claimReviewQueueItem(beta.claimId);
    const claimResult = await recordClaimReviewDecision(
      {
        organizationId: ORG, claimId: beta.claimId, reviewQueueItemId: claimQueueItem.review_queue_item_id,
        expectedUpdatedAt: new Date(claimQueueItem.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"],
        actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimResult.ok, true);
    assert.deepEqual(claimResult.data.approved_audiences, ["internal"]);

    const traced = await trace(beta.claimId);
    assert.equal(traced.ok, true);
    assert.ok(!traced.data.blockerCodes.includes("evidence_review_unresolved"));
    assert.ok(!traced.data.blockerCodes.includes("claim_review_unresolved"));
    assert.ok(!traced.data.blockerCodes.includes("support_strength_unassessed"));
    // A1C-1: current evidence + claim decisions, including approved_audiences
    // exactly as persisted, are returned in the traceability DTO.
    assert.equal(traced.data.evidence_review_decision.decision_outcome, "supported_with_limitation");
    assert.deepEqual(traced.data.claim_review_decision, {
      decision_id: claimResult.data.decision_id,
      decision_outcome: "approved",
      approved_audiences: ["internal"],
    });
  });

  test("P2-12 governance ceiling: a re-review requesting funder/public in approved_audiences fails closed and persists nothing", async () => {
    const [, beta] = await prepareTwoClaims();
    const claimQueueItem = await claimReviewQueueItem(beta.claimId);
    const beforeCount = await query(`SELECT count(*)::int AS count FROM kai.claim_review_decisions WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, beta.claimId]);
    const beforeQueueRow = (await query(`SELECT queue_status, review_status FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [claimQueueItem.review_queue_item_id]))[0];
    assert.equal(beforeQueueRow.queue_status, "resolved"); // from the prior test

    for (const audiences of [["funder"], ["public"], ["internal", "funder"], ["internal", "public"]]) {
      const result = await recordClaimReviewDecision(
        {
          organizationId: ORG, claimId: beta.claimId, reviewQueueItemId: claimQueueItem.review_queue_item_id,
          expectedUpdatedAt: new Date(claimQueueItem.updated_at).toISOString(), decision: "approved", approvedAudiences: audiences,
          actorContext: reviewerActor, now: NOW,
        },
        { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, false, `expected governance ceiling failure for audiences ${JSON.stringify(audiences)}`);
      assert.equal(result.error.code, "validation_blocker");
      assert.equal(result.error.status, 422);
    }

    const afterCount = await query(`SELECT count(*)::int AS count FROM kai.claim_review_decisions WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, beta.claimId]);
    assert.equal(afterCount[0].count, beforeCount[0].count);
    const afterQueueRow = (await query(`SELECT queue_status, review_status, updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`, [claimQueueItem.review_queue_item_id]))[0];
    assert.equal(afterQueueRow.queue_status, beforeQueueRow.queue_status);
    assert.equal(afterQueueRow.review_status, beforeQueueRow.review_status);
  });

  test("P2-12 cross-tenant decision attempt fails", async () => {
    const [alpha] = await prepareTwoClaims();
    const evidenceQueueItem = await evidenceReviewQueueItem(alpha.evidenceItemId);
    const result = await recordEvidenceReviewDecision(
      {
        organizationId: OTHER_ORG, evidenceItemId: alpha.evidenceItemId, reviewQueueItemId: evidenceQueueItem.review_queue_item_id,
        expectedUpdatedAt: new Date(evidenceQueueItem.updated_at).toISOString(), decision: "supported",
        actorContext: { ...reviewerActor, organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_reviewer" }] },
        now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P2-12 stale expected_updated_at fails", async () => {
    const [alpha] = await prepareTwoClaims();
    const result = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId: alpha.evidenceItemId, reviewQueueItemId: (await evidenceReviewQueueItem(alpha.evidenceItemId)).review_queue_item_id,
        expectedUpdatedAt: "2020-01-01T00:00:00.000Z", decision: "supported",
        actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "conflict_current_state_changed");
  });

  test("P2-12 unknown request field is rejected before any repository call (route/service boundary)", async () => {
    const { validateCompleteEvidenceReviewRequest } = await import("../Backend/kai/validators/kaiSprint2RequestSchemas.js");
    const result = validateCompleteEvidenceReviewRequest({ expected_updated_at: NOW, decision: "supported", not_a_real_field: true });
    assert.equal(result.ok, false);
  });

  test("P2-12 non-human/system actor cannot produce a decision row (DB-level CHECK proof)", async () => {
    const [alpha] = await prepareTwoClaims();
    const evidenceQueueItem = await evidenceReviewQueueItem(alpha.evidenceItemId);
    await assert.rejects(query(
      `INSERT INTO kai.evidence_review_decisions (organization_id, evidence_item_id, review_queue_item_id, decision_outcome, decided_by, decided_by_role, target_updated_at, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'supported', $4::uuid, 'gk_reviewer', now(), 'system')`,
      [ORG, alpha.evidenceItemId, evidenceQueueItem.review_queue_item_id, reviewerActor.actorUserId],
    ));
    await assert.rejects(query(
      `INSERT INTO kai.evidence_review_decisions (organization_id, evidence_item_id, review_queue_item_id, decision_outcome, decided_by, decided_by_role, target_updated_at, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'supported', $4::uuid, 'gk_operator', now(), 'human')`,
      [ORG, alpha.evidenceItemId, evidenceQueueItem.review_queue_item_id, reviewerActor.actorUserId],
    ));
  });

  // --- KAI B1B public-authority wiring repair: real-Postgres claim-review proof ---
  //
  // The Phase-5 sensitivity/allowed-use decision ledger is scoped to the one
  // intake_sensitivity_profile shared by every evidence item/claim drawn from
  // this org's single is_current source version (same sharing behavior the
  // P14-09 funder-authority-repair suite already relies on), so each case
  // below writes its own fresh profile-level decision head (superseding
  // whatever head already exists) immediately before its
  // recordClaimReviewDecision call, and builds its own independent,
  // never-before-claimed evidence item/claim (via extra committed dictionary
  // fields, mirroring the P14-09 fixture-budget pattern) so it never disturbs
  // alpha/beta's state used by the sequenced tests above.
  const PUBLIC_AUTHORITY_DICTIONARY_ID = "60000000-0000-4000-8000-000000000001";
  const PUBLIC_AUTHORITY_FILE_PROFILE_ID = "50000000-0000-4000-8000-000000000001";
  let publicAuthorityFieldsSeeded = false;
  async function seedPublicAuthorityDictionaryFields() {
    if (publicAuthorityFieldsSeeded) return;
    for (const suffix of ["11", "12", "13"]) {
      await pool.query(
        `INSERT INTO kai.data_dictionary_fields (
           data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id,
           profile_field_key, field_label_safe, data_type, created_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, 'number', now())
         ON CONFLICT DO NOTHING`,
        [`70000000-0000-4000-8000-0000000000${suffix}`, PUBLIC_AUTHORITY_DICTIONARY_ID, ORG, PUBLIC_AUTHORITY_FILE_PROFILE_ID, `field_${Number(suffix)}`],
      );
    }
    publicAuthorityFieldsSeeded = true;
  }

  // Builds one fresh claim (through the real proposal/gap pipeline) with its
  // evidence review already resolved/supported, so only the claim-review
  // governance ceiling under test remains to be exercised.
  async function buildPublicAuthorityCandidateClaim() {
    await seedPublicAuthorityDictionaryFields();
    const [sourceVersion] = await query(
      `SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1`,
      [ORG],
    );
    const evidenceResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersion.source_version_id, actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceLineageRepository: evidenceRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceResult.ok, true, JSON.stringify(evidenceResult));
    const [evidenceRow] = await query(
      `SELECT evidence_item_id, source_version_id FROM kai.evidence_items
        WHERE organization_id = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM kai.claims c WHERE c.organization_id = kai.evidence_items.organization_id AND c.evidence_item_id = kai.evidence_items.evidence_item_id)
        ORDER BY evidence_item_id ASC LIMIT 1`,
      [ORG],
    );
    const claimResult = await proposeClaim(
      { organizationId: ORG, evidenceItemId: evidenceRow.evidence_item_id, actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: claimRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimResult.ok, true, JSON.stringify(claimResult));
    const claimId = claimResult.data.claim.claim_id;
    const gapResult = await generateClaimGapFollowups(
      { organizationId: ORG, claimId, actorContext: reviewerActor, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(gapResult.ok, true, JSON.stringify(gapResult));

    const evidenceQueue = await evidenceReviewQueueItem(evidenceRow.evidence_item_id);
    const evidenceReviewResult = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId: evidenceRow.evidence_item_id, reviewQueueItemId: evidenceQueue.review_queue_item_id,
        expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported", actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceReviewResult.ok, true, JSON.stringify(evidenceReviewResult));

    return { claimId, evidenceItemId: evidenceRow.evidence_item_id, sourceVersionId: evidenceRow.source_version_id };
  }

  // Supersedes the current Phase-5 decision head for the profile shared by
  // this org's one source version, writing exactly the reviewed snapshot the
  // case under test needs. Uses the same raw-INSERT approach the existing
  // P14-09 funder-authority-repair suite already established for this
  // purpose (there is no other test-owned helper for writing a Phase-5
  // decision), so no consent/governance predicate is duplicated here - only
  // field values are supplied, and the real DB-level
  // intake_sensitivity_review_decisions_b1a_02_public_use_basis_check
  // constraint is what actually enforces (or rejects) the basis.
  async function supersedePhase5Decision(sourceVersionId, snapshot) {
    const [lineage] = await query(
      `SELECT intake_sensitivity_profile_id FROM kai.source_versions WHERE organization_id = $1::uuid AND source_version_id = $2::uuid`,
      [ORG, sourceVersionId],
    );
    const intakeSensitivityProfileId = lineage.intake_sensitivity_profile_id;
    let [sensitivityQueue] = await query(
      `SELECT review_queue_item_id FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_type = 'intake_sensitivity_profile' AND target_object_id = $2::uuid`,
      [ORG, intakeSensitivityProfileId],
    );
    if (!sensitivityQueue) {
      [sensitivityQueue] = await query(
        `INSERT INTO kai.review_queue_items (
           organization_id, queue_type, target_object_type, target_object_id,
           priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
         ) VALUES ($1::uuid, 'sensitivity_review', 'intake_sensitivity_profile', $2::uuid, 'medium', 'open', 'needs_gk_review',
           'Review sensitivity and allowed-use metadata.', 'Review sensitivity and allowed-use metadata before governed use.', '{}'::jsonb, 'human')
         RETURNING review_queue_item_id`,
        [ORG, intakeSensitivityProfileId],
      );
    }
    const [currentHead] = await query(
      `SELECT d.decision_id
         FROM kai.intake_sensitivity_review_decisions d
        WHERE d.organization_id = $1::uuid
          AND d.intake_sensitivity_profile_id = $2::uuid
          AND NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)`,
      [ORG, intakeSensitivityProfileId],
    );
    await pool.query(
      `INSERT INTO kai.intake_sensitivity_review_decisions (
         organization_id, intake_sensitivity_profile_id, review_queue_item_id,
         decision_outcome, reviewed_personal_data_status, reviewed_minor_data_status,
         reviewed_health_housing_justice_immigration_status, reviewed_indigenous_governance_status,
         reviewed_staff_notes_status, reviewed_story_testimonial_status, reviewed_small_cell_risk_status,
         reviewed_financial_records_status, reviewed_consent_basis_status, reviewed_allowed_use_status,
         reviewed_llm_processing_allowed, reviewed_product_learning_allowed, reviewed_public_use_allowed,
         reviewed_funder_use_allowed, decided_by, decided_by_role, target_updated_at,
         supersedes_decision_id, created_by_type, created_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid,
         'reviewed', 'unknown', 'unknown',
         'unknown', $4,
         'unknown', 'unknown', 'unknown',
         'unknown', $5, $6,
         false, false, $7,
         false, $8::uuid, 'gk_reviewer', $9::timestamptz,
         $10, 'human', now()
       )`,
      [
        ORG, intakeSensitivityProfileId, sensitivityQueue.review_queue_item_id,
        snapshot.reviewed_indigenous_governance_status, snapshot.reviewed_consent_basis_status, snapshot.reviewed_allowed_use_status,
        snapshot.reviewed_public_use_allowed, reviewerActor.actorUserId, NOW, currentHead?.decision_id ?? null,
      ],
    );
    return { intakeSensitivityProfileId };
  }

  test("B1B public-authority DB proof (positive): a fully-established Phase-5 public basis lets recordClaimReviewDecision approve approvedAudiences=['public'], and the persisted current decision records it", async () => {
    const { claimId, sourceVersionId } = await buildPublicAuthorityCandidateClaim();
    await supersedePhase5Decision(sourceVersionId, {
      reviewed_allowed_use_status: "allowed",
      reviewed_consent_basis_status: "present",
      reviewed_indigenous_governance_status: "absent",
      reviewed_public_use_allowed: true,
    });

    const claimQueue = await claimReviewQueueItem(claimId);
    const result = await recordClaimReviewDecision(
      {
        organizationId: ORG, claimId, reviewQueueItemId: claimQueue.review_queue_item_id,
        expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved",
        approvedAudiences: ["public"], actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.data.approved_audiences, ["public"]);

    const [currentHead] = await query(
      `SELECT approved_audiences FROM kai.claim_review_decisions
        WHERE organization_id = $1::uuid AND claim_id = $2::uuid
          AND NOT EXISTS (SELECT 1 FROM kai.claim_review_decisions s WHERE s.supersedes_decision_id = kai.claim_review_decisions.decision_id)`,
      [ORG, claimId],
    );
    assert.ok(currentHead.approved_audiences.includes("public"));
  });

  test("B1B public-authority DB proof (Case A): reviewed_public_use_allowed=false fails closed and persists no new claim-review decision", async () => {
    const { claimId, sourceVersionId } = await buildPublicAuthorityCandidateClaim();
    await supersedePhase5Decision(sourceVersionId, {
      reviewed_allowed_use_status: "allowed",
      reviewed_consent_basis_status: "present",
      reviewed_indigenous_governance_status: "absent",
      reviewed_public_use_allowed: false,
    });

    const beforeCount = await query(`SELECT count(*)::int AS count FROM kai.claim_review_decisions WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, claimId]);
    const claimQueue = await claimReviewQueueItem(claimId);
    const result = await recordClaimReviewDecision(
      {
        organizationId: ORG, claimId, reviewQueueItemId: claimQueue.review_queue_item_id,
        expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved",
        approvedAudiences: ["public"], actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(result.error.status, 422);
    const afterCount = await query(`SELECT count(*)::int AS count FROM kai.claim_review_decisions WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, claimId]);
    assert.equal(afterCount[0].count, beforeCount[0].count);
  });

  test("B1B public-authority DB proof (Case B): a Phase-5 state that cannot legitimately establish the public basis (invalid consent) fails closed, persists no new claim-review decision, and the DB itself refuses to record public_use_allowed=true against that same invalid basis", async () => {
    const { claimId, sourceVersionId } = await buildPublicAuthorityCandidateClaim();
    const { intakeSensitivityProfileId } = await supersedePhase5Decision(sourceVersionId, {
      reviewed_allowed_use_status: "allowed",
      reviewed_consent_basis_status: "unknown",
      reviewed_indigenous_governance_status: "absent",
      reviewed_public_use_allowed: false,
    });

    // Independent DB-level proof: this exact invalid-basis snapshot can never
    // legitimately carry reviewed_public_use_allowed = true - the schema's
    // own intake_sensitivity_review_decisions_b1a_02_public_use_basis_check
    // constraint rejects the attempt outright, before any application code
    // runs.
    const [rejectedHead] = await query(
      `SELECT d.decision_id
         FROM kai.intake_sensitivity_review_decisions d
        WHERE d.organization_id = $1::uuid
          AND d.intake_sensitivity_profile_id = $2::uuid
          AND NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)`,
      [ORG, intakeSensitivityProfileId],
    );
    await assert.rejects(
      query(
        `INSERT INTO kai.intake_sensitivity_review_decisions (
           organization_id, intake_sensitivity_profile_id, review_queue_item_id,
           decision_outcome, reviewed_personal_data_status, reviewed_minor_data_status,
           reviewed_health_housing_justice_immigration_status, reviewed_indigenous_governance_status,
           reviewed_staff_notes_status, reviewed_story_testimonial_status, reviewed_small_cell_risk_status,
           reviewed_financial_records_status, reviewed_consent_basis_status, reviewed_allowed_use_status,
           reviewed_llm_processing_allowed, reviewed_product_learning_allowed, reviewed_public_use_allowed,
           reviewed_funder_use_allowed, decided_by, decided_by_role, target_updated_at,
           supersedes_decision_id, created_by_type, created_at
         ) VALUES (
           $1::uuid, $2::uuid,
           (SELECT review_queue_item_id FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_type = 'intake_sensitivity_profile' AND target_object_id = $2::uuid),
           'reviewed', 'unknown', 'unknown', 'unknown', 'absent', 'unknown', 'unknown', 'unknown', 'unknown',
           'unknown', 'allowed', false, false, true, false,
           $3::uuid, 'gk_reviewer', $4::timestamptz, $5, 'human', now()
         )`,
        [ORG, intakeSensitivityProfileId, reviewerActor.actorUserId, NOW, rejectedHead.decision_id],
      ),
      /public_use_basis_check|violates check constraint/,
    );

    const beforeCount = await query(`SELECT count(*)::int AS count FROM kai.claim_review_decisions WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, claimId]);
    const claimQueue = await claimReviewQueueItem(claimId);
    const result = await recordClaimReviewDecision(
      {
        organizationId: ORG, claimId, reviewQueueItemId: claimQueue.review_queue_item_id,
        expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved",
        approvedAudiences: ["public"], actorContext: reviewerActor, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(result.error.status, 422);
    const afterCount = await query(`SELECT count(*)::int AS count FROM kai.claim_review_decisions WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, claimId]);
    assert.equal(afterCount[0].count, beforeCount[0].count);
  });
}
