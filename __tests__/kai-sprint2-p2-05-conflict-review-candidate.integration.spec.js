import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_05_CONFLICT_REVIEW_CANDIDATE_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P2-05 integration suite refused a non-loopback KAI_P2_05_CONFLICT_REVIEW_CANDIDATE_DATABASE_URL host: ${host}`);
  }
}

test("P2-05 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  for (const url of ["postgresql://user@example.com:5432/db", "postgresql://user@10.0.0.5:5432/db"]) {
    assert.throws(() => assertLoopbackDatabaseUrl(url), /refused a non-loopback/);
  }
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P2-05 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresConflictReviewCandidateRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P2-05 conflict-review-candidate integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP205IntegrationSuite();
}

async function runP205IntegrationSuite() {
  const { Pool } = await import("pg");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { createConflictReviewCandidate } = await import("../Backend/kai/services/kaiConflictReviewCandidateService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { createPostgresConflictReviewCandidateRepository } = await import("../Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js");

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

  function auditRecorder({ rejectPrepare = false, rejectPublish = false } = {}) {
    const calls = [];
    return {
      calls,
      prepareMetadataOnlyAudit({ payload }) {
        calls.push({ type: "prepare", payload });
        if (rejectPrepare) return { ok: false };
        return {
          ok: true,
          async publish() {
            calls.push({ type: "publish" });
            if (rejectPublish) throw new Error("forced publish failure");
          },
        };
      },
    };
  }

  const claimRepo = createPostgresClaimProposalRepository({ runInTransaction: withRunnerOwnedTransaction });
  const gapRepo = createPostgresClaimGapFollowupRepository({ runInTransaction: withRunnerOwnedTransaction });
  const evidenceRepo = createPostgresEvidenceLineageRepository({ runInTransaction: withRunnerOwnedTransaction });

  test.after(async () => {
    await pool.end();
  });

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }

  async function prepareClaimsAndGaps() {
    const sourceVersions = await query(
      `SELECT source_version_id
         FROM kai.source_versions
        WHERE organization_id = $1::uuid
          AND is_current = true
        ORDER BY source_version_id
        LIMIT 1`,
      [ORG],
    );
    assert.equal(sourceVersions.length, 1);
    const evidenceResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersions[0].source_version_id, actorContext, now: NOW },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        evidenceLineageRepository: evidenceRepo,
        metadataOnlyAudit: auditRecorder(),
      },
    );
    assert.equal(evidenceResult.ok, true);

    const evidenceRows = await query(
      `SELECT evidence_item_id
         FROM kai.evidence_items
        WHERE organization_id = $1::uuid
        ORDER BY evidence_item_id
        LIMIT 2`,
      [ORG],
    );
    assert.equal(evidenceRows.length, 2);

    const claimIds = [];
    for (const row of evidenceRows) {
      const claimResult = await proposeClaim(
        { organizationId: ORG, evidenceItemId: row.evidence_item_id, actorContext, now: NOW },
        {
          env: { KAI_SPRINT2_ENABLED: "true" },
          claimProposalRepository: claimRepo,
          metadataOnlyAudit: auditRecorder(),
        },
      );
      assert.equal(claimResult.ok, true);
      claimIds.push(claimResult.data.claim.claim_id);

      const gapResult = await generateClaimGapFollowups(
        { organizationId: ORG, claimId: claimResult.data.claim.claim_id, actorContext, now: NOW },
        {
          env: { KAI_SPRINT2_ENABLED: "true" },
          claimGapFollowupRepository: gapRepo,
          metadataOnlyAudit: auditRecorder(),
        },
      );
      assert.equal(gapResult.ok, true);
      assert.ok(gapResult.data.gapItems.some((gap) => gap.dimension_key === "conflicting_source_indicators"));
    }
    return claimIds.sort();
  }

  let pairPromise;
  async function claimPair() {
    pairPromise ||= prepareClaimsAndGaps();
    return pairPromise;
  }

  async function cleanupP205State() {
    await pool.query(
      `DELETE FROM kai.upload_lifecycle_audit
        WHERE operation = 'conflict_review_candidate_created'`,
    );
    await pool.query(
      `DELETE FROM kai.review_queue_items
        WHERE queue_type = 'conflict_resolution'
          AND organization_id = $1::uuid`,
      [ORG],
    );
    await pool.query(
      `DELETE FROM kai.conflict_groups
        WHERE organization_id = $1::uuid`,
      [ORG],
    );
  }

  async function counts() {
    const [groups, queues, audits] = await Promise.all([
      query(`SELECT count(*)::int AS count FROM kai.conflict_groups WHERE organization_id = $1::uuid`, [ORG]),
      query(`SELECT count(*)::int AS count FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'conflict_resolution'`, [ORG]),
      query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE organization_id = $1::uuid AND operation = 'conflict_review_candidate_created'`, [ORG]),
    ]);
    return { groups: groups[0].count, queues: queues[0].count, audits: audits[0].count };
  }

  function conflictRepo(options = {}) {
    return createPostgresConflictReviewCandidateRepository({ runInTransaction: withRunnerOwnedTransaction, ...options });
  }

  async function createCandidate(firstClaimId, secondClaimId, options = {}) {
    return createConflictReviewCandidate(
      { organizationId: ORG, firstClaimId, secondClaimId, actorContext, now: NOW },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        conflictReviewCandidateRepository: options.repository || conflictRepo(),
        metadataOnlyAudit: options.audit || auditRecorder(),
      },
    );
  }

  test("P2-05 fresh creation is atomic and persists a normalized pair, exact queue, and one audit", async () => {
    const [lower, higher] = await claimPair();
    await cleanupP205State();
    const result = await createCandidate(higher, lower);
    assert.equal(result.ok, true);
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.conflictGroup.lower_claim_id, lower);
    assert.equal(result.data.conflictGroup.higher_claim_id, higher);
    assert.equal(result.data.reviewQueueItem.target_object_id, result.data.conflictGroup.conflict_group_id);
    assert.equal(result.data.reviewQueueItem.queue_type, "conflict_resolution");
    assert.deepEqual(await counts(), { groups: 1, queues: 1, audits: 1 });
  });

  test("P2-05 identical replay is zero-write and zero-audit", async () => {
    const [lower, higher] = await claimPair();
    await cleanupP205State();
    const first = await createCandidate(lower, higher);
    assert.equal(first.ok, true);
    const before = await counts();
    const second = await createCandidate(higher, lower);
    assert.equal(second.ok, true);
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.conflictGroup.conflict_group_id, first.data.conflictGroup.conflict_group_id);
    assert.deepEqual(await counts(), before);
  });

  test("P2-05 partial state is rejected without repair or audit", async () => {
    const [lower, higher] = await claimPair();
    await cleanupP205State();
    const gaps = await query(
      `SELECT claim_id, gap_log_item_id
         FROM kai.gap_log_items
        WHERE organization_id = $1::uuid
          AND claim_id = ANY($2::uuid[])
          AND dimension_key = 'conflicting_source_indicators'`,
      [ORG, [lower, higher]],
    );
    const byClaim = new Map(gaps.map((row) => [row.claim_id, row.gap_log_item_id]));
    await pool.query(
      `INSERT INTO kai.conflict_groups (
         organization_id, lower_claim_id, higher_claim_id,
         lower_claim_conflict_gap_id, higher_claim_conflict_gap_id,
         basis_code, safe_summary, created_by_type
       ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,'system')`,
      [ORG, lower, higher, byClaim.get(lower), byClaim.get(higher), "human_selected_unresolved_comparison", "Potential claim conflict requires GK review."],
    );
    const result = await createCandidate(lower, higher);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "conflict_current_state_changed");
    assert.deepEqual(await counts(), { groups: 1, queues: 0, audits: 0 });
  });

  test("P2-05 concurrent identical calls converge to one group and one queue item", async () => {
    const [lower, higher] = await claimPair();
    await cleanupP205State();
    const [a, b] = await Promise.all([
      createCandidate(lower, higher),
      createCandidate(higher, lower),
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(a.data.conflictGroup.conflict_group_id, b.data.conflictGroup.conflict_group_id);
    assert.deepEqual(await counts(), { groups: 1, queues: 1, audits: 1 });
  });

  test("P2-05 audit rejection or publication failure rolls back all fresh writes", async () => {
    const [lower, higher] = await claimPair();
    for (const audit of [auditRecorder({ rejectPrepare: true }), auditRecorder({ rejectPublish: true })]) {
      await cleanupP205State();
      const result = await createCandidate(lower, higher, { audit });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "validation_blocker");
      assert.deepEqual(await counts(), { groups: 0, queues: 0, audits: 0 });
    }
  });
}
