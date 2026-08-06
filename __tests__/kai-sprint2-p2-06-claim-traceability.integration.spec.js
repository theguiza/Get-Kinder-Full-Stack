import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_06_CLAIM_TRACEABILITY_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P2-06 integration suite refused a non-loopback KAI_P2_06_CLAIM_TRACEABILITY_DATABASE_URL host: ${host}`);
  }
}

test("P2-06 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("P2-06 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresClaimTraceabilityRepository\.js/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P2-06 claim-traceability integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP206IntegrationSuite();
}

async function runP206IntegrationSuite() {
  const { Pool } = await import("pg");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { createConflictReviewCandidate } = await import("../Backend/kai/services/kaiConflictReviewCandidateService.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { createPostgresConflictReviewCandidateRepository } = await import("../Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js");
  const { createPostgresClaimTraceabilityRepository } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-06T10:00:00.000Z";
  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 10 });
  const transactionLog = [];

  async function withRunnerOwnedTransaction(callback) {
    const client = await pool.connect();
    const wrapped = {
      async query(sql, params) {
        transactionLog.push(String(sql));
        return client.query(sql, params);
      },
    };
    try {
      await client.query("BEGIN");
      const result = await callback(wrapped);
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
  const conflictRepo = createPostgresConflictReviewCandidateRepository({ runInTransaction: withRunnerOwnedTransaction });
  const traceRepo = createPostgresClaimTraceabilityRepository({ runInTransaction: withRunnerOwnedTransaction });

  test.after(async () => {
    await pool.end();
  });

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }

  async function trace(claimId, requestedAudience = "internal", repository = traceRepo) {
    return getClaimTraceabilitySummary(
      { organizationId: ORG, claimId, requestedAudience, actorContext },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimTraceabilityRepository: repository },
    );
  }

  let prepared;
  async function prepareTwoClaims() {
    if (prepared) return prepared;
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
    const evidenceRows = await query(
      `SELECT evidence_item_id
         FROM kai.evidence_items
        WHERE organization_id = $1::uuid
        ORDER BY evidence_item_id
        LIMIT 2`,
      [ORG],
    );
    const claimIds = [];
    for (const row of evidenceRows) {
      const claimResult = await proposeClaim(
        { organizationId: ORG, evidenceItemId: row.evidence_item_id, actorContext, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: claimRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(claimResult.ok, true);
      claimIds.push(claimResult.data.claim.claim_id);
      const gapResult = await generateClaimGapFollowups(
        { organizationId: ORG, claimId: claimResult.data.claim.claim_id, actorContext, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(gapResult.ok, true);
    }
    prepared = claimIds.sort();
    return prepared;
  }

  test("P2-06 recomputes P2-02, validates P2-04, uses one read-only repeatable-read transaction, and keeps proposed internal-only claims ineligible", async () => {
    const [claimId] = await prepareTwoClaims();
    transactionLog.length = 0;
    const beforeAudit = await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit`);
    const result = await trace(claimId, "internal");
    assert.equal(result.ok, true);
    assert.equal(result.data.eligible, false);
    assert.equal(result.data.requestedAudience, "internal");
    assert.equal(result.data.claim.claim_status, "proposed");
    assert.equal(result.data.claim.audience_gates.internal_only, true);
    assert.ok(result.data.blockerCodes.includes("claim_not_approved_for_requested_audience"));
    assert.ok(result.data.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.ok(result.data.dimensions.denominator_clarity.assessment_status, "unresolved");
    assert.ok(result.data.gap_items.some((gap) => gap.dimension_key === "denominator_clarity"));
    assert.ok(transactionLog.some((sql) => /REPEATABLE READ READ ONLY/.test(sql)));
    assert.equal(transactionLog.some((sql) => /\bINSERT\b|\bUPDATE\b|\bDELETE\b|upload_lifecycle_audit/.test(sql)), false);
    const afterAudit = await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit`);
    assert.deepEqual(afterAudit, beforeAudit);
  });

  test("P2-06 rejects absent P2-04 rows instead of inferring clear coverage", async () => {
    const [claimId] = await prepareTwoClaims();
    const savedGaps = await query(`SELECT * FROM kai.gap_log_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, claimId]);
    const savedFollowups = await query(`SELECT * FROM kai.client_followup_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, claimId]);
    const savedQueues = await query(
      `SELECT *
         FROM kai.review_queue_items
        WHERE organization_id = $1::uuid
          AND queue_type = 'client_followup'
          AND target_object_id = ANY($2::uuid[])`,
      [ORG, savedFollowups.map((row) => row.client_followup_item_id)],
    );
    await pool.query(
      `DELETE FROM kai.review_queue_items
        WHERE organization_id = $1::uuid
          AND queue_type = 'client_followup'
          AND target_object_id = ANY($2::uuid[])`,
      [ORG, savedFollowups.map((row) => row.client_followup_item_id)],
    );
    await pool.query(`DELETE FROM kai.client_followup_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, claimId]);
    await pool.query(`DELETE FROM kai.gap_log_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, claimId]);
    const result = await trace(claimId);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "conflict_current_state_changed");
    for (const row of savedGaps) {
      await pool.query(
        `INSERT INTO kai.gap_log_items (
           gap_log_item_id, organization_id, claim_id, evidence_item_id, source_version_id,
           dimension_key, assessment_status, validator_key, safe_summary,
           open_finding_count, field_count, undefined_field_count, uncovered_field_count, created_by_type, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [row.gap_log_item_id, row.organization_id, row.claim_id, row.evidence_item_id, row.source_version_id, row.dimension_key, row.assessment_status, row.validator_key, row.safe_summary, row.open_finding_count, row.field_count, row.undefined_field_count, row.uncovered_field_count, row.created_by_type, row.created_at],
      );
    }
    for (const row of savedFollowups) {
      await pool.query(
        `INSERT INTO kai.client_followup_items (
           client_followup_item_id, organization_id, claim_id, gap_log_item_id,
           dimension_key, question_text, created_by_type, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.client_followup_item_id, row.organization_id, row.claim_id, row.gap_log_item_id, row.dimension_key, row.question_text, row.created_by_type, row.created_at],
      );
    }
    for (const row of savedQueues) {
      await pool.query(
        `INSERT INTO kai.review_queue_items (
           review_queue_item_id, organization_id, queue_type, target_object_type,
           target_object_id, priority, queue_status, review_status, blocked_reason,
           assigned_to, due_at, summary, required_action, queue_metadata,
           created_by, created_by_type, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [row.review_queue_item_id, row.organization_id, row.queue_type, row.target_object_type, row.target_object_id, row.priority, row.queue_status, row.review_status, row.blocked_reason, row.assigned_to, row.due_at, row.summary, row.required_action, row.queue_metadata, row.created_by, row.created_by_type, row.created_at, row.updated_at],
      );
    }
  });

  test("P2-06 returns potential_conflict_groups, never confirmed conflicts, and requires the exact queue pair", async () => {
    const [lower, higher] = await prepareTwoClaims();
    await pool.query(`DELETE FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'conflict_resolution'`, [ORG]);
    await pool.query(`DELETE FROM kai.conflict_groups WHERE organization_id = $1::uuid`, [ORG]);
    const created = await createConflictReviewCandidate(
      { organizationId: ORG, firstClaimId: lower, secondClaimId: higher, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, conflictReviewCandidateRepository: conflictRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(created.ok, true);
    const result = await trace(lower);
    assert.equal(result.ok, true);
    assert.equal(result.data.potential_conflict_groups.length, 1);
    assert.ok(!("confirmed_conflicts" in result.data));
    assert.ok(result.data.blockerCodes.includes("potential_conflict_review_unresolved"));
    await pool.query(`DELETE FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'conflict_resolution'`, [ORG]);
    const partial = await trace(lower);
    assert.equal(partial.ok, false);
    assert.equal(partial.error.code, "conflict_current_state_changed");
    await pool.query(`DELETE FROM kai.conflict_groups WHERE organization_id = $1::uuid`, [ORG]);
  });

  test("P2-06 deterministic blocker ordering, deduplication, and public/funder fail closed", async () => {
    const [claimId] = await prepareTwoClaims();
    const result = await trace(claimId, "public");
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.blockerCodes, [...new Set(result.data.blockerCodes)]);
    assert.deepEqual(result.data.blockerCodes, result.data.blockerCodes.slice().sort((a, b) => {
      const order = [
        "claim_not_approved_for_requested_audience",
        "audience_gate_closed",
        "claim_review_unresolved",
        "evidence_review_unresolved",
        "support_strength_unassessed",
        "coverage_dimension_unresolved",
        "client_followup_unresolved",
        "potential_conflict_review_unresolved",
        "requirement_authority_absent",
        "traceability_incomplete",
      ];
      return order.indexOf(a) - order.indexOf(b);
    }));
    assert.equal(result.data.eligible, false);
    assert.ok(result.data.blockerCodes.includes("audience_gate_closed"));
  });

  test("P2-06 bounded conflict reads truncate at 100 and fail closed", async () => {
    const [claimId, otherClaimId] = await prepareTwoClaims();
    await pool.query(`DELETE FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'conflict_resolution'`, [ORG]);
    await pool.query(`DELETE FROM kai.conflict_groups WHERE organization_id = $1::uuid`, [ORG]);
    const lineage = (await query(
      `SELECT c.evidence_item_id, e.source_id, e.source_version_id
         FROM kai.claims c
         JOIN kai.evidence_items e
           ON e.organization_id = c.organization_id
          AND e.evidence_item_id = c.evidence_item_id
        WHERE c.organization_id = $1::uuid
          AND c.claim_id = $2::uuid`,
      [ORG, claimId],
    ))[0];
    const gaps = await query(
      `SELECT claim_id, gap_log_item_id
         FROM kai.gap_log_items
        WHERE organization_id = $1::uuid
          AND claim_id = ANY($2::uuid[])
          AND dimension_key = 'conflicting_source_indicators'`,
      [ORG, [claimId, otherClaimId]],
    );
    const byClaim = new Map(gaps.map((row) => [row.claim_id, row.gap_log_item_id]));
    for (let i = 0; i < 101; i += 1) {
      const suffix = String(i + 1000).padStart(12, "0");
      const locatorId = `20000000-0000-4000-8000-${suffix}`;
      const evidenceId = `21000000-0000-4000-8000-${suffix}`;
      const peerClaimId = `22000000-0000-4000-8000-${suffix}`;
      const peerGapId = `23000000-0000-4000-8000-${suffix}`;
      const groupId = `24000000-0000-4000-8000-${suffix}`;
      const locatorHex = String(i + 1).padStart(64, "0");
      const evidenceHex = String(i + 10001).padStart(64, "0");
      const claimHex = String(i + 20001).padStart(64, "0");
      await pool.query(
        `INSERT INTO kai.source_locators (
           source_locator_id, organization_id, source_version_id, locator_type,
           coordinates, locator_fingerprint, created_by_type
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,'column',$4::jsonb,$5,'system')`,
        [locatorId, ORG, lineage.source_version_id, JSON.stringify({ column_name: `synthetic_peer_${i}` }), locatorHex],
      );
      await pool.query(
        `INSERT INTO kai.evidence_items (
           evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
           evidence_type, data_class, sensitivity_level, support_strength,
           statement, statement_fingerprint, evidence_review_status,
           internal_only, public_use_allowed, funder_use_allowed,
           llm_processing_allowed, product_learning_allowed, created_by_type
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'dictionary_field_presence_fact',
           'organization_committed_metadata','unknown','unassessed',$6,$7,'needs_gk_review',
           true,false,false,false,false,'system')`,
        [evidenceId, ORG, lineage.source_id, lineage.source_version_id, locatorId, `Synthetic metadata evidence ${i}.`, evidenceHex],
      );
      await pool.query(
        `INSERT INTO kai.review_queue_items (
           organization_id, queue_type, target_object_type, target_object_id,
           priority, queue_status, review_status, summary, required_action,
           queue_metadata, created_by_type
         ) VALUES ($1::uuid,'evidence_review','evidence_item',$2::uuid,'normal','open','needs_gk_review',
           'Review evidence lineage before claim use.','Review evidence lineage before claim use.','{}'::jsonb,'system')`,
        [ORG, evidenceId],
      );
      await pool.query(
        `INSERT INTO kai.claims (
           claim_id, organization_id, evidence_item_id, claim_type, claim_status,
           claim_review_status, claim_strength, statement, statement_fingerprint,
           internal_only, public_use_allowed, funder_use_allowed,
           llm_processing_allowed, product_learning_allowed, export_ready, created_by_type
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,'finding','proposed','needs_gk_review','unassessed',
           $4,$5,true,false,false,false,false,false,'system')`,
        [peerClaimId, ORG, evidenceId, `Synthetic traceability peer claim ${i}.`, claimHex],
      );
      await pool.query(
        `INSERT INTO kai.claim_evidence_links (
           organization_id, claim_id, evidence_item_id, created_by_type
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,'system')`,
        [ORG, peerClaimId, evidenceId],
      );
      await pool.query(
        `INSERT INTO kai.review_queue_items (
           organization_id, queue_type, target_object_type, target_object_id,
           priority, queue_status, review_status, summary, required_action,
           queue_metadata, created_by_type
         ) VALUES ($1::uuid,'claim_review','claim',$2::uuid,'normal','open','needs_gk_review',
           'Review claim before audience use.','Review claim before audience use.','{}'::jsonb,'system')`,
        [ORG, peerClaimId],
      );
      await pool.query(
        `INSERT INTO kai.gap_log_items (
           gap_log_item_id, organization_id, claim_id, evidence_item_id, source_version_id,
           dimension_key, assessment_status, validator_key, safe_summary, created_by_type
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'conflicting_source_indicators',
           'unresolved','VAL-KAI-P2-02-conflicting_source_indicators',
           'Claim gap requires review for dimension: conflicting_source_indicators.','system')`,
        [peerGapId, ORG, peerClaimId, evidenceId, lineage.source_version_id],
      );
      const lower = claimId < peerClaimId ? claimId : peerClaimId;
      const higher = claimId < peerClaimId ? peerClaimId : claimId;
      await pool.query(
        `INSERT INTO kai.conflict_groups (
           conflict_group_id, organization_id, lower_claim_id, higher_claim_id,
           lower_claim_conflict_gap_id, higher_claim_conflict_gap_id,
           basis_code, safe_summary, created_by_type
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,'human_selected_unresolved_comparison','Potential claim conflict requires GK review.','system')
         ON CONFLICT (organization_id, lower_claim_id, higher_claim_id) DO NOTHING`,
        [
          groupId,
          ORG,
          lower,
          higher,
          lower === claimId ? byClaim.get(claimId) : peerGapId,
          higher === claimId ? byClaim.get(claimId) : peerGapId,
        ],
      );
      await pool.query(
        `INSERT INTO kai.review_queue_items (
           organization_id, queue_type, target_object_type, target_object_id,
           queue_status, review_status, priority, summary, required_action,
           assigned_to, due_at, queue_metadata, created_by_type
         ) VALUES ($1::uuid,'conflict_resolution','conflict_group',$2::uuid,'open','needs_gk_review','normal','Potential claim conflict requires GK review.','Compare both claims, their evidence lineage, definitions, reporting periods, entity levels, denominators, and support limitations. Record whether a conflict exists. Do not approve or promote either claim.',NULL,NULL,'{}'::jsonb,'system')
         ON CONFLICT (organization_id, queue_type, target_object_type, target_object_id)
           WHERE queue_type = 'conflict_resolution'
           DO NOTHING`,
        [ORG, groupId],
      );
    }
    const result = await trace(claimId);
    assert.equal(result.ok, true);
    assert.equal(result.data.truncated, true);
    assert.equal(result.data.potential_conflict_groups.length, 100);
    assert.equal(result.data.eligible, false);
    assert.ok(result.data.blockerCodes.includes("traceability_incomplete"));
  });
}
