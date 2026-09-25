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
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { createPostgresConflictReviewCandidateRepository } = await import("../Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js");
  const { createPostgresHumanReviewRepository } = await import("../Backend/kai/dictionary/postgresHumanReviewRepository.js");
  const {
    createPostgresClaimTraceabilityRepository,
    evaluateClaimTraceabilityInTransaction,
  } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");
  const { createPostgresCoverageReviewDecisionRepository } = await import("../Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js");
  const {
    acceptInternalCoverageLimitation,
    acceptFunderCoverageLimitation,
    acceptPublicCoverageLimitation,
  } = await import("../Backend/kai/services/kaiCoverageReviewDecisionService.js");
  const { completeClientFollowup } = await import("../Backend/kai/services/kaiClientFollowupCompletionService.js");
  const { createPostgresClientFollowupCompletionRepository } = await import("../Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js");

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
  const humanReviewRepo = createPostgresHumanReviewRepository({ runInTransaction: withRunnerOwnedTransaction });
  const coverageRepo = createPostgresCoverageReviewDecisionRepository({ runInTransaction: withRunnerOwnedTransaction });
  const clientFollowupRepo = createPostgresClientFollowupCompletionRepository({ runInTransaction: withRunnerOwnedTransaction });

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

  function unresolvedDimensionKeys(traceData) {
    return Object.entries(traceData.dimensions)
      .filter(([, value]) => value.assessment_status === "unresolved")
      .map(([dimensionKey]) => dimensionKey)
      .sort();
  }

  async function acceptPublicForEveryUnresolvedDimension(claimId) {
    const traced = await trace(claimId, "public");
    assert.equal(traced.ok, true, JSON.stringify(traced));
    const unresolved = unresolvedDimensionKeys(traced.data);
    for (const dimensionKey of unresolved) {
      const result = await acceptPublicCoverageLimitation(
        { organizationId: ORG, claimId, dimensionKey, actorContext, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, coverageReviewDecisionRepository: coverageRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, true, JSON.stringify(result));
    }
    return unresolved;
  }

  async function completeAllFollowups(claimId) {
    const rows = await query(
      `SELECT cfi.client_followup_item_id, rq.updated_at
         FROM kai.client_followup_items cfi
         JOIN kai.review_queue_items rq
           ON rq.organization_id = cfi.organization_id
          AND rq.queue_type = 'client_followup'
          AND rq.target_object_type = 'client_followup_item'
          AND rq.target_object_id = cfi.client_followup_item_id
        WHERE cfi.organization_id = $1::uuid
          AND cfi.claim_id = $2::uuid
        ORDER BY cfi.dimension_key`,
      [ORG, claimId],
    );
    const clientReviewerActor = {
      actorType: "human",
      actorUserId: "90000000-0000-4000-8000-000000000007",
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_reviewer" }],
    };
    for (const row of rows) {
      const result = await completeClientFollowup(
        {
          organizationId: ORG,
          claimId,
          clientFollowupItemId: row.client_followup_item_id,
          expectedUpdatedAt: new Date(row.updated_at).toISOString(),
          actorContext: clientReviewerActor,
          now: NOW,
        },
        { env: { KAI_SPRINT2_ENABLED: "true" }, clientFollowupCompletionRepository: clientFollowupRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, true, JSON.stringify(result));
    }
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
    // KAI P2-10: for requestedAudience = "internal", claim_not_approved_for_
    // requested_audience/audience_gate_closed/requirement_authority_absent no
    // longer fire merely because this stub used to unconditionally return
    // false - P2-09 evidence/claim-review completeness (still incomplete
    // here) is independently enforced by its own blocker codes instead.
    assert.ok(!result.data.blockerCodes.includes("claim_not_approved_for_requested_audience"));
    assert.ok(result.data.blockerCodes.includes("evidence_review_unresolved"));
    assert.ok(result.data.blockerCodes.includes("claim_review_unresolved"));
    assert.ok(result.data.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.ok(result.data.dimensions.denominator_clarity.assessment_status, "unresolved");
    assert.ok(result.data.gap_items.some((gap) => gap.dimension_key === "denominator_clarity"));
    assert.ok(transactionLog.some((sql) => /REPEATABLE READ READ ONLY/.test(sql)));
    assert.equal(transactionLog.some((sql) => /\bINSERT\b|\bUPDATE\b|\bDELETE\b|upload_lifecycle_audit/.test(sql)), false);
    const afterAudit = await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit`);
    assert.deepEqual(afterAudit, beforeAudit);
    const [persistedEvidenceRow] = await query(
      `SELECT sensitivity_level
         FROM kai.evidence_items
        WHERE organization_id = $1::uuid
          AND evidence_item_id = $2::uuid`,
      [ORG, result.data.evidence.evidence_item_id],
    );
    assert.equal(persistedEvidenceRow.sensitivity_level, "unknown");
    assert.equal(result.data.evidence.sensitivity_level, persistedEvidenceRow.sensitivity_level);
    assert.equal(result.data.evidence.sensitivity_level, "unknown");
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
         ) VALUES ($1::uuid,'evidence_review','evidence_item',$2::uuid,'medium','open','needs_gk_review',
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
         ) VALUES ($1::uuid,'claim_review','claim',$2::uuid,'medium','open','needs_gk_review',
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
         ) VALUES ($1::uuid,'conflict_resolution','conflict_group',$2::uuid,'open','needs_gk_review','medium','Potential claim conflict requires GK review.','Compare both claims, their evidence lineage, definitions, reporting periods, entity levels, denominators, and support limitations. Record whether a conflict exists. Do not approve or promote either claim.',NULL,NULL,'{}'::jsonb,'system')
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

  // --- KAI B1B public-authority wiring repair: real-Postgres P2-06 proof ---
  //
  // Builds one fresh claim (its own never-before-claimed evidence item, via
  // extra committed dictionary fields under the same shared dictionary/
  // profile the P1-04 smoke seed already committed - the established
  // fixture-budget pattern also used by the P14-09 funder-authority-repair
  // and P2-12 public-authority suites) with its evidence review resolved, an
  // (optional) Phase-5 public-authority decision, and an (optional) claim-
  // review decision recording the given approvedAudiences.
  const PUBLIC_P206_DICTIONARY_ID = "60000000-0000-4000-8000-000000000001";
  const PUBLIC_P206_FILE_PROFILE_ID = "50000000-0000-4000-8000-000000000001";
  let publicP206FieldsSeeded = false;
  async function seedPublicP206DictionaryFields() {
    if (publicP206FieldsSeeded) return;
    // Budget: one never-before-claimed evidence item per buildPublicP206Claim()
    // call across this whole suite (3 pre-existing B1B audience-authority
    // tests + 6 public coverage-consumption tests added by the P2-06
    // public-consumption proof + 4 client-safe impact-facts fixture claims) -
    // generously overprovisioned so a future test
    // addition does not silently exhaust it.
    for (const suffix of ["31", "32", "33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"]) {
      await pool.query(
        `INSERT INTO kai.data_dictionary_fields (
           data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id,
           profile_field_key, field_label_safe, data_type, created_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, 'number', now())
         ON CONFLICT DO NOTHING`,
        [`70000000-0000-4000-8000-0000000000${suffix}`, PUBLIC_P206_DICTIONARY_ID, ORG, PUBLIC_P206_FILE_PROFILE_ID, `field_${Number(suffix)}`],
      );
    }
    publicP206FieldsSeeded = true;
  }

  async function supersedePhase5PublicDecision(sourceVersionId, { publicUseAllowed }) {
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
         'unknown', 'absent',
         'unknown', 'unknown', 'unknown',
         'unknown', 'present', 'allowed',
         false, false, $4,
         false, $5::uuid, 'gk_reviewer', $6::timestamptz,
         $7, 'human', now()
       )`,
      [ORG, intakeSensitivityProfileId, sensitivityQueue.review_queue_item_id, publicUseAllowed, actorContext.actorUserId, NOW, currentHead?.decision_id ?? null],
    );
  }

  async function buildPublicP206Claim({
    phase5PublicAllowed = true,
    claimReviewApprovedAudiences = ["internal", "public"],
    forceRawClaimReviewInsert = false,
  } = {}) {
    await seedPublicP206DictionaryFields();
    const [sourceVersion] = await query(
      `SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1`,
      [ORG],
    );
    const evidenceResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: sourceVersion.source_version_id, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceLineageRepository: evidenceRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceResult.ok, true, JSON.stringify(evidenceResult));
    const [evidenceRow] = await query(
      `SELECT evidence_item_id FROM kai.evidence_items
        WHERE organization_id = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM kai.claims c WHERE c.organization_id = kai.evidence_items.organization_id AND c.evidence_item_id = kai.evidence_items.evidence_item_id)
        ORDER BY evidence_item_id ASC LIMIT 1`,
      [ORG],
    );
    const claimResult = await proposeClaim(
      { organizationId: ORG, evidenceItemId: evidenceRow.evidence_item_id, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: claimRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(claimResult.ok, true, JSON.stringify(claimResult));
    const claimId = claimResult.data.claim.claim_id;
    const gapResult = await generateClaimGapFollowups(
      { organizationId: ORG, claimId, actorContext, now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(gapResult.ok, true, JSON.stringify(gapResult));

    const [evidenceQueue] = await query(
      `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_type = 'evidence_item' AND target_object_id = $2::uuid`,
      [ORG, evidenceRow.evidence_item_id],
    );
    const evidenceReviewResult = await recordEvidenceReviewDecision(
      {
        organizationId: ORG, evidenceItemId: evidenceRow.evidence_item_id, reviewQueueItemId: evidenceQueue.review_queue_item_id,
        expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported", actorContext, now: NOW,
      },
      { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(evidenceReviewResult.ok, true, JSON.stringify(evidenceReviewResult));

    await supersedePhase5PublicDecision(sourceVersion.source_version_id, { publicUseAllowed: phase5PublicAllowed });

    if (claimReviewApprovedAudiences && forceRawClaimReviewInsert) {
      // recordClaimReviewDecision itself enforces the Phase-5 governance
      // ceiling for an approved_audiences write that includes "public" (it
      // would reject the write outright when Phase-5 public authority is not
      // currently established) - the exact same precedent the P14-09
      // funder-authority-repair suite already established for this case. A
      // negative case that needs an already-approved "public" claim-review
      // decision sitting against a since-changed/invalid Phase-5 state is
      // therefore testing P2-06 read-time behavior against that decision, not
      // the write-time ceiling enforced elsewhere, so it must record the
      // decision directly.
      const [claimQueue] = await query(
        `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_type = 'claim' AND target_object_id = $2::uuid`,
        [ORG, claimId],
      );
      await pool.query(
        `INSERT INTO kai.claim_review_decisions (
           organization_id, claim_id, review_queue_item_id, decision_outcome,
           limitation_notes, approved_audiences, decided_by, decided_by_role,
           target_updated_at, supersedes_decision_id, created_by_type, created_at
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'approved', NULL, $4, $5::uuid, 'gk_reviewer', $6::timestamptz, NULL, 'human', now())`,
        [ORG, claimId, claimQueue.review_queue_item_id, claimReviewApprovedAudiences, actorContext.actorUserId, new Date(claimQueue.updated_at).toISOString()],
      );
    } else if (claimReviewApprovedAudiences) {
      const [claimQueue] = await query(
        `SELECT review_queue_item_id, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_type = 'claim' AND target_object_id = $2::uuid`,
        [ORG, claimId],
      );
      const claimReviewResult = await recordClaimReviewDecision(
        {
          organizationId: ORG, claimId, reviewQueueItemId: claimQueue.review_queue_item_id,
          expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved",
          approvedAudiences: claimReviewApprovedAudiences, actorContext, now: NOW,
        },
        { env: { KAI_SPRINT2_ENABLED: "true" }, humanReviewRepository: humanReviewRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(claimReviewResult.ok, true, JSON.stringify(claimReviewResult));
    }

    return { claimId, evidenceItemId: evidenceRow.evidence_item_id };
  }

  async function supersedePhase5FunderAuthorityForClaim(claimId, { permitted }) {
    const [lineage] = await query(
      `SELECT sv.intake_sensitivity_profile_id
         FROM kai.claims c
         JOIN kai.evidence_items e
           ON e.organization_id = c.organization_id
          AND e.evidence_item_id = c.evidence_item_id
         JOIN kai.source_versions sv
           ON sv.organization_id = e.organization_id
          AND sv.source_version_id = e.source_version_id
        WHERE c.organization_id = $1::uuid
          AND c.claim_id = $2::uuid`,
      [ORG, claimId],
    );
    const intakeSensitivityProfileId = lineage.intake_sensitivity_profile_id;
    const [sensitivityQueue] = await query(
      `SELECT review_queue_item_id FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_type = 'intake_sensitivity_profile' AND target_object_id = $2::uuid`,
      [ORG, intakeSensitivityProfileId],
    );
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
         'unknown', 'absent',
         'unknown', 'unknown', 'unknown',
         'unknown', 'present', 'allowed',
         false, false, true,
         $4, $5::uuid, 'gk_reviewer', $6::timestamptz,
         $7, 'human', now()
       )`,
      [ORG, intakeSensitivityProfileId, sensitivityQueue.review_queue_item_id, permitted, actorContext.actorUserId, NOW, currentHead?.decision_id ?? null],
    );
  }

  test("P2-06 B1B public-authority proof: current public-approved claim review + valid Phase-5 public authority clears every audience-authority blocker for requestedAudience='public' (real evaluator, real resolveEffectivePublicAuthority, real Phase-5 head lookup)", async () => {
    const { claimId } = await buildPublicP206Claim({ phase5PublicAllowed: true, claimReviewApprovedAudiences: ["internal", "public"] });
    const result = await withRunnerOwnedTransaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "public" });
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.requestedAudience, "public");
    // The audience-authority verdict itself (AUDIENCE_AUTHORITY_BLOCKER_CODES)
    // must be fully cleared: approvalForAudience("public") really executed
    // resolveEffectivePublicAuthority() against the real current Phase-5 head
    // and found it permitted, and the real current claim-review head really
    // carries "public" in approved_audiences.
    assert.ok(!result.data.blockerCodes.includes("claim_not_approved_for_requested_audience"), JSON.stringify(result.data.blockerCodes));
    assert.ok(!result.data.blockerCodes.includes("audience_gate_closed"), JSON.stringify(result.data.blockerCodes));
    assert.ok(!result.data.blockerCodes.includes("requirement_authority_absent"), JSON.stringify(result.data.blockerCodes));
    // With zero coverage acceptances recorded, coverage_dimension_unresolved
    // remains among the blockers and eligible stays false - this proves the
    // audience-authority verdict (the three blockers above) is fully and
    // independently satisfied on its own, decoupled from coverage-dimension
    // state. The full end-to-end positive proof (audience authority AND
    // coverage acceptance both satisfied, eligible:true) is below.
    assert.ok(result.data.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.equal(result.data.eligible, false);
  });

  test("P2-06 public coverage consumption: accepted_public_with_limitation for every otherwise-unresolved dimension, layered on a public-approved claim review + valid Phase-5 public authority, clears coverage_dimension_unresolved and yields eligible=true for requestedAudience='public' (real evaluator, real resolveEffectivePublicAuthority, real P2-10 repository, real Phase-5 head lookup)", async () => {
    const { claimId } = await buildPublicP206Claim({ phase5PublicAllowed: true, claimReviewApprovedAudiences: ["internal", "public"] });

    const unresolved = await acceptPublicForEveryUnresolvedDimension(claimId);
    assert.ok(unresolved.length > 0, "fixture must have at least one unresolved dimension to prove the coverage-acceptance path");
    // client_followup_unresolved (P2-04/P2-11) is an independent, untouched
    // blocker never affected by a coverage decision - it must be separately
    // resolved for eligible to reach true, exactly as the established P2-10
    // suite's own full-acceptance proof already does for internal/funder.
    await completeAllFollowups(claimId);

    const result = await withRunnerOwnedTransaction((tx) =>
      evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "public" }));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.requestedAudience, "public");
    assert.ok(!result.data.blockerCodes.includes("claim_not_approved_for_requested_audience"), JSON.stringify(result.data.blockerCodes));
    assert.ok(!result.data.blockerCodes.includes("audience_gate_closed"), JSON.stringify(result.data.blockerCodes));
    assert.ok(!result.data.blockerCodes.includes("requirement_authority_absent"), JSON.stringify(result.data.blockerCodes));
    assert.ok(!result.data.blockerCodes.includes("coverage_dimension_unresolved"), JSON.stringify(result.data.blockerCodes));
    for (const dimensionKey of unresolved) {
      assert.equal(result.data.dimensions[dimensionKey].public_limitation_accepted, true);
      assert.equal(result.data.dimensions[dimensionKey].blocks_requested_audience, false);
    }
    assert.deepEqual(result.data.blockerCodes, [], JSON.stringify(result.data.blockerCodes));
    assert.equal(result.data.eligible, true);
  });

  test("P2-06 public coverage consumption, Negative: one required public coverage acceptance missing - coverage_dimension_unresolved fires and eligible stays false", async () => {
    const { claimId } = await buildPublicP206Claim({ phase5PublicAllowed: true, claimReviewApprovedAudiences: ["internal", "public"] });
    const traced = await trace(claimId, "public");
    const unresolved = unresolvedDimensionKeys(traced.data);
    assert.ok(unresolved.length > 1, "fixture must have at least two unresolved dimensions to prove partial acceptance");

    for (const dimensionKey of unresolved.slice(1)) {
      const result = await acceptPublicCoverageLimitation(
        { organizationId: ORG, claimId, dimensionKey, actorContext, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, coverageReviewDecisionRepository: coverageRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, true, JSON.stringify(result));
    }

    const result = await withRunnerOwnedTransaction((tx) =>
      evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "public" }));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.data.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.equal(result.data.dimensions[unresolved[0]].public_limitation_accepted, false);
    assert.equal(result.data.dimensions[unresolved[0]].blocks_requested_audience, true);
    assert.equal(result.data.eligible, false);
  });

  test("P2-06 public coverage consumption, Negative: a stale state_fingerprint is ignored - coverage_dimension_unresolved fires and eligible stays false", async () => {
    const { claimId, evidenceItemId } = await buildPublicP206Claim({ phase5PublicAllowed: true, claimReviewApprovedAudiences: ["internal", "public"] });
    await acceptPublicForEveryUnresolvedDimension(claimId);
    await completeAllFollowups(claimId);

    const eligibleBefore = await withRunnerOwnedTransaction((tx) =>
      evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "public" }));
    assert.equal(eligibleBefore.data.eligible, true, JSON.stringify(eligibleBefore.data.blockerCodes));

    // Mutating a fact bound into the fingerprint (support_strength) makes the
    // CURRENT recomputed fingerprint differ from the one every prior
    // accepted_public_with_limitation row was written against - the stale
    // rows are never mutated, revoked, or deleted, they simply stop matching.
    await pool.query(
      `UPDATE kai.evidence_items SET support_strength = 'unassessed' WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`,
      [ORG, evidenceItemId],
    );

    const result = await withRunnerOwnedTransaction((tx) =>
      evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "public" }));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.data.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.equal(result.data.eligible, false);
    for (const dimensionKey of Object.keys(result.data.dimensions)) {
      if (result.data.dimensions[dimensionKey].assessment_status === "unresolved") {
        assert.equal(result.data.dimensions[dimensionKey].public_limitation_accepted, false, `${dimensionKey} must not read the now-stale acceptance as current`);
      }
    }

    await pool.query(
      `UPDATE kai.evidence_items SET support_strength = 'reviewed_supported' WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`,
      [ORG, evidenceItemId],
    );
  });

  test("P2-06 public coverage consumption, Negative: only accepted_internal_with_limitation exists - does not satisfy public", async () => {
    const { claimId } = await buildPublicP206Claim({ phase5PublicAllowed: true, claimReviewApprovedAudiences: ["internal", "public"] });
    const traced = await trace(claimId, "public");
    const unresolved = unresolvedDimensionKeys(traced.data);
    assert.ok(unresolved.length > 0);

    for (const dimensionKey of unresolved) {
      const result = await acceptInternalCoverageLimitation(
        { organizationId: ORG, claimId, dimensionKey, actorContext, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, coverageReviewDecisionRepository: coverageRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, true, JSON.stringify(result));
    }

    const result = await withRunnerOwnedTransaction((tx) =>
      evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "public" }));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.data.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.equal(result.data.eligible, false);
    for (const dimensionKey of unresolved) {
      assert.equal(result.data.dimensions[dimensionKey].internal_limitation_accepted, true);
      assert.equal(result.data.dimensions[dimensionKey].public_limitation_accepted, false);
      assert.equal(result.data.dimensions[dimensionKey].blocks_requested_audience, true);
    }
  });

  test("P2-06 public coverage consumption, Negative: only accepted_funder_with_limitation exists - does not satisfy public", async () => {
    const { claimId } = await buildPublicP206Claim({ phase5PublicAllowed: true, claimReviewApprovedAudiences: ["internal", "public"] });
    await supersedePhase5FunderAuthorityForClaim(claimId, { permitted: true });
    const traced = await trace(claimId, "public");
    const unresolved = unresolvedDimensionKeys(traced.data);
    assert.ok(unresolved.length > 0);

    for (const dimensionKey of unresolved) {
      const result = await acceptFunderCoverageLimitation(
        { organizationId: ORG, claimId, dimensionKey, actorContext, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, coverageReviewDecisionRepository: coverageRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(result.ok, true, JSON.stringify(result));
    }

    const result = await withRunnerOwnedTransaction((tx) =>
      evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "public" }));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.data.blockerCodes.includes("coverage_dimension_unresolved"));
    assert.equal(result.data.eligible, false);
    for (const dimensionKey of unresolved) {
      assert.equal(result.data.dimensions[dimensionKey].funder_limitation_accepted, true);
      assert.equal(result.data.dimensions[dimensionKey].public_limitation_accepted, false);
      assert.equal(result.data.dimensions[dimensionKey].blocks_requested_audience, true);
    }
  });

  test("P2-06 public coverage consumption, Negative: current accepted_public_with_limitation exists for every dimension but Phase-5 public authority is absent/invalid - public remains ineligible", async () => {
    const { claimId } = await buildPublicP206Claim({ phase5PublicAllowed: true, claimReviewApprovedAudiences: ["internal", "public"] });
    await acceptPublicForEveryUnresolvedDimension(claimId);
    await completeAllFollowups(claimId);

    const before = await withRunnerOwnedTransaction((tx) =>
      evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "public" }));
    assert.equal(before.data.eligible, true, JSON.stringify(before.data.blockerCodes));

    // Revoke Phase-5 public authority AFTER the coverage decisions already
    // exist and are current: the coverage-dimension carve-out never grants
    // audience authority by itself, so this must independently fail closed.
    const [sourceVersion] = await query(
      `SELECT source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1`,
      [ORG],
    );
    await supersedePhase5PublicDecision(sourceVersion.source_version_id, { publicUseAllowed: false });

    const result = await withRunnerOwnedTransaction((tx) =>
      evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "public" }));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(result.data.blockerCodes.includes("claim_not_approved_for_requested_audience"));
    assert.ok(result.data.blockerCodes.includes("audience_gate_closed"));
    assert.ok(result.data.blockerCodes.includes("requirement_authority_absent"));
    assert.ok(!result.data.blockerCodes.includes("coverage_dimension_unresolved"), "the coverage-dimension carve-out remains satisfied - only the independent audience-authority verdict fails");
    assert.equal(result.data.eligible, false);
  });

  test("P2-06 B1B public-authority proof, Negative A: Phase-5 public authority absent/false + claim review includes 'public' - eligible=false and every audience-authority blocker fires", async () => {
    const { claimId } = await buildPublicP206Claim({ phase5PublicAllowed: false, claimReviewApprovedAudiences: ["internal", "public"], forceRawClaimReviewInsert: true });
    const result = await withRunnerOwnedTransaction((tx) => evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "public" }));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.eligible, false);
    assert.ok(result.data.blockerCodes.includes("claim_not_approved_for_requested_audience"));
    assert.ok(result.data.blockerCodes.includes("audience_gate_closed"));
    assert.ok(result.data.blockerCodes.includes("requirement_authority_absent"));
  });

  test("P2-06 B1B public-authority proof, Negative B: Phase-5 public authority valid but the current claim review does NOT include 'public' - eligible=false and every audience-authority blocker fires", async () => {
    const { claimId } = await buildPublicP206Claim({ phase5PublicAllowed: true, claimReviewApprovedAudiences: ["internal"] });
    const result = await withRunnerOwnedTransaction((tx) => evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "public" }));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.eligible, false);
    assert.ok(result.data.blockerCodes.includes("claim_not_approved_for_requested_audience"));
    assert.ok(result.data.blockerCodes.includes("audience_gate_closed"));
    assert.ok(result.data.blockerCodes.includes("requirement_authority_absent"));
  });

  // Client-safe impact-facts over real governed state: real binding-derived
  // client_admin -> listClientImpactFacts -> real P2-08 repository (runner-
  // owned transaction only) -> real P2-06 evaluator -> client projection.
  const { listClientImpactFacts } = await import("../Backend/kai/services/kaiClientImpactFactsService.js");
  const { createPostgresEligibleClaimsForAudienceRepository } = await import("../Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js");
  const { resolveKaiActorContext } = await import("../Backend/kai/auth/kaiActorContext.js");
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const GK_ORG = 77;

  async function bindingDerivedClientAdmin(boundKaiOrganizationId) {
    const result = await resolveKaiActorContext(
      { user: { id: 501, email: "admin@harbourline.test" } },
      {
        findOrCreateKaiUserByLegacyPublicUserdataId: async ({ legacyPublicUserdataId, email }) => ({
          user_id: "90000000-0000-4000-8000-000000000021",
          legacy_identity_source: "public.userdata",
          legacy_public_userdata_id: legacyPublicUserdataId,
          status: "active",
          email,
        }),
        listKaiRolesForUser: async () => [],
        listOrganizationMembershipsForUser: async () => [],
        resolveOrgScopeForUserId: async () => ({ memberships: [{ orgId: GK_ORG, role: "admin", is_active: true }] }),
        listActiveGkOrganizationBindingsForGkOrganizationIds: async (ids) =>
          ids.includes(GK_ORG) ? [{ gk_organization_id: GK_ORG, kai_organization_id: boundKaiOrganizationId, status: "active" }] : [],
      },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(
      result.actorContext.organizationMemberships.map(({ organization_id, role_name, source }) => ({ organization_id, role_name, source })),
      [{ organization_id: boundKaiOrganizationId, role_name: "client_admin", source: "gk_organization_binding" }],
    );
    return result.actorContext;
  }

  const factsDependencies = { env: { KAI_SPRINT2_ENABLED: "true" }, runInTransaction: withRunnerOwnedTransaction };

  // Ground truth from the real evaluator. Claims the P2-08 repository treats
  // as unusable (not_found / conflict_current_state_changed - e.g. the
  // deliberately inconsistent claim seeded by the "absent P2-04 rows" test
  // above) are never eligible; `requireUsable` is set for fixture claims.
  async function internalEvaluation(claimId, { requireUsable = true } = {}) {
    const result = await withRunnerOwnedTransaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience: "internal" });
    });
    if (!requireUsable && !result.ok && ["not_found", "conflict_current_state_changed"].includes(result.error?.code)) {
      return { eligible: false, unusable: true, reason: result.error.reason || result.error.code };
    }
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.data;
  }

  let impactFactsFixture;
  async function prepareImpactFactsFixture() {
    if (impactFactsFixture) return impactFactsFixture;
    // B: a fresh proposed claim whose claim review is still open (its GK
    // claim-review queue item remains open - D). The shared prepareTwoClaims
    // claims are not used: an earlier test deliberately corrupts their P2-04
    // state, which the repository then skips as unusable.
    const unreviewed = await buildPublicP206Claim({ phase5PublicAllowed: false, claimReviewApprovedAudiences: null });
    const unreviewedClaimIds = [unreviewed.claimId];
    const [openClaimQueue] = await query(
      `SELECT queue_status FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_id = $2::uuid`,
      [ORG, unreviewed.claimId],
    );
    assert.notEqual(openClaimQueue?.queue_status, "resolved", "B keeps open GK claim-review work");
    // A: governed internal-eligible claim - evidence review supported, claim
    // review approved for internal, every unresolved dimension accepted as an
    // internal limitation, every client follow-up completed.
    const eligible = await buildPublicP206Claim({ phase5PublicAllowed: false, claimReviewApprovedAudiences: ["internal"] });
    const unresolvedForEligible = unresolvedDimensionKeys((await trace(eligible.claimId, "internal")).data);
    for (const dimensionKey of unresolvedForEligible) {
      const accepted = await acceptInternalCoverageLimitation(
        { organizationId: ORG, claimId: eligible.claimId, dimensionKey, actorContext, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, coverageReviewDecisionRepository: coverageRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(accepted.ok, true, JSON.stringify(accepted));
    }
    await completeAllFollowups(eligible.claimId);
    // C: reviewed and approved for internal with follow-ups completed, but its
    // unresolved coverage dimensions were never accepted for internal use, so
    // the real evaluator rejects it (coverage_dimension_unresolved).
    const rejected = await buildPublicP206Claim({ phase5PublicAllowed: false, claimReviewApprovedAudiences: ["internal"] });
    await completeAllFollowups(rejected.claimId);
    impactFactsFixture = {
      eligibleClaimId: eligible.claimId,
      eligibleUnresolved: unresolvedForEligible,
      unreviewedClaimIds,
      rejectedClaimId: rejected.claimId,
    };
    return impactFactsFixture;
  }

  test("impact-facts (real PostgreSQL, real P2-06 evaluator): binding-derived client_admin sees exactly the governed internal-eligible facts, nothing hidden leaks, read-only", async () => {
    const fixture = await prepareImpactFactsFixture();

    // Ground truth straight from the real evaluator for every claim in ORG.
    const allClaims = await query(`SELECT claim_id::text AS claim_id FROM kai.claims WHERE organization_id = $1::uuid ORDER BY claim_id`, [ORG]);
    const evaluations = new Map();
    for (const row of allClaims) evaluations.set(row.claim_id, await internalEvaluation(row.claim_id, { requireUsable: false }));
    const eligibleIds = [...evaluations].filter(([, data]) => data.eligible === true).map(([id]) => id).sort();

    for (const claimId of [fixture.eligibleClaimId, fixture.rejectedClaimId, ...fixture.unreviewedClaimIds]) {
      assert.notEqual(evaluations.get(claimId).unusable, true, `fixture claim ${claimId} must be evaluable`);
    }
    const eligibleEvaluation = evaluations.get(fixture.eligibleClaimId);
    assert.equal(eligibleEvaluation.eligible, true, JSON.stringify(eligibleEvaluation.blockerCodes));
    for (const claimId of fixture.unreviewedClaimIds) {
      assert.equal(evaluations.get(claimId).eligible, false);
      assert.ok(evaluations.get(claimId).blockerCodes.includes("claim_review_unresolved"));
    }
    const rejectedEvaluation = evaluations.get(fixture.rejectedClaimId);
    assert.equal(rejectedEvaluation.eligible, false);
    assert.ok(rejectedEvaluation.blockerCodes.includes("coverage_dimension_unresolved"), JSON.stringify(rejectedEvaluation.blockerCodes));
    assert.ok(allClaims.length > eligibleIds.length, "fixture contains hidden (ineligible) claims");

    const hidden = await query(
      `SELECT c.claim_id::text AS claim_id, c.statement AS claim_statement, e.evidence_item_id::text AS evidence_item_id,
              e.statement AS evidence_statement, e.source_id::text AS source_id, e.source_version_id::text AS source_version_id,
              e.source_locator_id::text AS source_locator_id
         FROM kai.claims c
         JOIN kai.evidence_items e ON e.organization_id = c.organization_id AND e.evidence_item_id = c.evidence_item_id
        WHERE c.organization_id = $1::uuid`,
      [ORG],
    );
    const queueRows = await query(
      `SELECT review_queue_item_id::text AS id, summary, required_action FROM kai.review_queue_items WHERE organization_id = $1::uuid`,
      [ORG],
    );
    assert.ok(queueRows.length > 0, "fixture has GK review-queue material");

    const actorContextForClient = await bindingDerivedClientAdmin(ORG);
    const beforeAudit = await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit`);
    const beforeCounts = await query(
      `SELECT (SELECT count(*) FROM kai.claims)::int AS claims, (SELECT count(*) FROM kai.review_queue_items)::int AS queue,
              (SELECT count(*) FROM kai.coverage_review_decisions)::int AS coverage`,
    );
    transactionLog.length = 0;

    const result = await listClientImpactFacts({ organizationId: ORG, actorContext: actorContextForClient }, factsDependencies);
    assert.equal(result.ok, true, JSON.stringify(result));

    // Exact DTO shape and exact governed set.
    assert.deepEqual(Object.keys(result.data).sort(), ["items", "truncated"]);
    assert.equal(result.data.truncated, false);
    assert.deepEqual(result.data.items.map((item) => item.claimId).sort(), eligibleIds);
    assert.ok(eligibleIds.includes(fixture.eligibleClaimId));
    for (const item of result.data.items) {
      assert.deepEqual(Object.keys(item).sort(), ["claimId", "claimType", "limitationDimensionKeys", "statement"]);
      const evaluation = evaluations.get(item.claimId);
      assert.equal(item.statement, evaluation.claim.statement);
      assert.equal(item.claimType, evaluation.claim.claim_type);
      const expectedLimitations = Object.entries(evaluation.dimensions)
        .filter(([, value]) => value.assessment_status === "unresolved" && value.internal_limitation_accepted === true)
        .map(([key]) => key)
        .sort();
      assert.deepEqual(item.limitationDimensionKeys, expectedLimitations);
    }
    const factA = result.data.items.find((item) => item.claimId === fixture.eligibleClaimId);
    assert.deepEqual(factA.limitationDimensionKeys, [...fixture.eligibleUnresolved].sort());

    // Leak check against every real hidden value.
    const serialized = JSON.stringify(result.data);
    const eligibleSet = new Set(eligibleIds);
    for (const row of hidden) {
      if (!eligibleSet.has(row.claim_id)) {
        assert.ok(!serialized.includes(row.claim_id), `leaked hidden claim id ${row.claim_id}`);
        if (row.claim_statement) {
          const statementOwnedByVisibleFact = result.data.items.some((item) => item.statement === row.claim_statement);
          if (!statementOwnedByVisibleFact) assert.ok(!serialized.includes(row.claim_statement), "leaked hidden claim statement");
        }
      }
      for (const value of [row.evidence_item_id, row.evidence_statement, row.source_id, row.source_version_id, row.source_locator_id]) {
        if (typeof value === "string" && value.length > 0) assert.ok(!serialized.includes(value), `leaked ${value}`);
      }
    }
    for (const row of queueRows) {
      for (const value of [row.id, row.summary, row.required_action]) {
        if (typeof value === "string" && value.length > 0) assert.ok(!serialized.includes(value), `leaked queue material ${value}`);
      }
    }
    for (const token of ["review_queue_item_id", "queue_status", "review_status", "needs_gk_review", "decision_outcome", "validator_key", "approved_audiences", "sensitivity_level", "evidence_item_id", "source_locator_id", "source_version_id", "blockerCodes"]) {
      assert.ok(!serialized.includes(token), `leaked GK field token ${token}`);
    }

    // Read-only: no write SQL, no audit, no row-count change.
    assert.ok(transactionLog.some((sql) => /REPEATABLE READ READ ONLY/.test(sql)));
    assert.equal(transactionLog.some((sql) => /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(sql)), false);
    assert.deepEqual(await query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit`), beforeAudit);
    assert.deepEqual(
      await query(
        `SELECT (SELECT count(*) FROM kai.claims)::int AS claims, (SELECT count(*) FROM kai.review_queue_items)::int AS queue,
                (SELECT count(*) FROM kai.coverage_review_decisions)::int AS coverage`,
      ),
      beforeCounts,
    );
  });

  test("impact-facts (real PostgreSQL): hidden/ineligible claims change neither the returned count nor the pagination metadata", async () => {
    const fixture = await prepareImpactFactsFixture();
    const clientAdmin = await bindingDerivedClientAdmin(ORG);
    const before = await listClientImpactFacts({ organizationId: ORG, actorContext: clientAdmin }, factsDependencies);
    // Add one more real ineligible claim (proposed, unreviewed) to ORG.
    const extra = await buildPublicP206Claim({ phase5PublicAllowed: false, claimReviewApprovedAudiences: null });
    assert.equal((await internalEvaluation(extra.claimId)).eligible, false);
    const after = await listClientImpactFacts({ organizationId: ORG, actorContext: clientAdmin }, factsDependencies);
    assert.equal(before.ok && after.ok, true);
    assert.deepEqual(after.data, before.data);
    assert.ok(!JSON.stringify(after.data).includes(extra.claimId));
    assert.ok(after.data.items.some((item) => item.claimId === fixture.eligibleClaimId));
  });

  test("impact-facts (real PostgreSQL): client_admin bound to another organization is denied before any claim is scanned", async () => {
    await prepareImpactFactsFixture();
    const crossOrgAdmin = await bindingDerivedClientAdmin(OTHER_ORG);
    transactionLog.length = 0;
    const result = await listClientImpactFacts({ organizationId: ORG, actorContext: crossOrgAdmin }, factsDependencies);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "authorization_denied");
    assert.equal(result.blockers[0].validator_key, "VAL-AUT-003");
    assert.equal(result.data ?? null, null);
    assert.equal(transactionLog.length, 0, "no transaction opened, no claim scanned");
  });

  test("impact-facts (real PostgreSQL): the default P2-08 DTO is unchanged when no projection is requested", async () => {
    await prepareImpactFactsFixture();
    const defaultRepository = createPostgresEligibleClaimsForAudienceRepository({ runInTransaction: withRunnerOwnedTransaction });
    const listed = await defaultRepository.listEligibleClaimsForAudience({ organizationId: ORG, requestedAudience: "internal", limit: 100, afterClaimId: null });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    assert.deepEqual(Object.keys(listed.data).sort(), ["afterClaimId", "eligibleClaims", "limit", "nextAfterClaimId", "requestedAudience", "truncated"]);
    assert.ok(listed.data.eligibleClaims.length > 0);
    for (const claim of listed.data.eligibleClaims) {
      assert.deepEqual(Object.keys(claim).sort(), [
        "claimId", "claimReviewStatus", "claimStatus", "claimType", "evidenceItemId", "requestedAudience", "sourceId", "sourceVersionId", "supportStrength",
      ]);
    }
    const facts = await listClientImpactFacts({ organizationId: ORG, actorContext: await bindingDerivedClientAdmin(ORG) }, factsDependencies);
    assert.deepEqual(
      facts.data.items.map((item) => item.claimId).sort(),
      listed.data.eligibleClaims.map((claim) => claim.claimId).sort(),
      "the client projection selects exactly the default P2-08 eligible set",
    );
  });

  // ===================================================================
  // Client Generated Drafts over the REAL P2-06 evaluator: real governed
  // claims (built and reviewed through the real services above), real
  // persisted draft/block/citation/review rows, the real generated-content
  // repository with its default evaluateClaimTraceabilityInTransaction, the
  // real project-scoped index SQL, and the real client service.
  // ===================================================================
  const {
    listClientGeneratedDrafts,
    getClientGeneratedDraft,
  } = await import("../Backend/kai/services/kaiClientGeneratedContentService.js");
  const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const {
    listGeneratedDraftLibraryIndex: readDraftIndexSql,
    readGeneratedDraftEngagementId: readDraftEngagementSql,
  } = await import("../Backend/kai/db/kaiGeneratedDraftLibraryReadModels.js");
  const { getEngagementForOrganization: readEngagementSql } = await import("../Backend/kai/db/kaiQueries.js");

  const PROJECT_A = "5a000000-0000-4000-8000-00000000a001";
  const PROJECT_B = "5a000000-0000-4000-8000-00000000b001";
  const clientContentDeps = Object.freeze({
    env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" },
    generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withRunnerOwnedTransaction }),
    listGeneratedDraftLibraryIndex: (organizationId, options) => readDraftIndexSql(organizationId, options, pool),
    readGeneratedDraftEngagementId: (organizationId, draftId) => readDraftEngagementSql(organizationId, draftId, pool),
    getEngagementForOrganization: (input) => readEngagementSql(input, pool),
  });
  const clientMember = (role, organizationId = ORG) => ({
    actorType: "human",
    actorUserId: `90000000-0000-4000-8000-0000000000${role === "client_admin" ? "31" : role === "client_reviewer" ? "32" : "33"}`,
    kaiRoles: [],
    organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: role }],
  });

  async function seedClientDraft(n, { engagementId, claimId, evidenceItemId, audience = "internal", contentType = "evidence_summary", review = "resolved" }) {
    const hex = String(n).padStart(2, "0");
    const draft = {
      runId: `5b0000${hex}-0000-4000-8000-000000000001`,
      draftId: `5c0000${hex}-0000-4000-8000-000000000001`,
      blockId: `5d0000${hex}-0000-4000-8000-000000000001`,
      citationId: `5e0000${hex}-0000-4000-8000-000000000001`,
      queueId: `5f0000${hex}-0000-4000-8000-000000000001`,
    };
    const [queueStatus, reviewStatus] = review === "resolved" ? ["resolved", "resolved"] : ["open", "needs_gk_review"];
    await pool.query(
      `INSERT INTO kai.generation_runs (generation_run_id, organization_id, engagement_id, idempotency_key, request_fingerprint,
         content_type, requested_audience, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'system')`,
      [draft.runId, ORG, engagementId, `client-p206-${hex}`, `${hex}`.repeat(32), contentType, audience],
    );
    await pool.query(
      `INSERT INTO kai.generated_content_drafts (generated_content_draft_id, generation_run_id, organization_id, content_type,
         requested_audience, draft_status, review_status, validator_results, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'draft', 'needs_gk_review', '[]'::jsonb, 'system')`,
      [draft.draftId, draft.runId, ORG, contentType, audience],
    );
    await pool.query(
      `INSERT INTO kai.generated_content_blocks (generated_content_block_id, generated_content_draft_id, organization_id, ordinal, text)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 1, $4)`,
      [draft.blockId, draft.draftId, ORG, `Client draft ${hex} text.`],
    );
    await pool.query(
      `INSERT INTO kai.generated_content_citations (generated_content_citation_id, generated_content_block_id, organization_id, claim_id, evidence_item_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)`,
      [draft.citationId, draft.blockId, ORG, claimId, evidenceItemId],
    );
    await pool.query(
      `INSERT INTO kai.review_queue_items (review_queue_item_id, organization_id, queue_type, target_object_type, target_object_id,
         priority, queue_status, review_status, assigned_to, due_at, summary, required_action, queue_metadata, created_by_type)
       VALUES ($1::uuid, $2::uuid, 'generated_content_review', 'generated_content_draft', $3::uuid, 'medium', $4, $5, NULL, NULL,
               'Generated draft requires human review.',
               'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.',
               '{}'::jsonb, 'system')`,
      [draft.queueId, ORG, draft.draftId, queueStatus, reviewStatus],
    );
    return draft;
  }

  async function governedInternalClaim({ completeFollowups }) {
    const built = await buildPublicP206Claim({ phase5PublicAllowed: false, claimReviewApprovedAudiences: ["internal"] });
    for (const dimensionKey of unresolvedDimensionKeys((await trace(built.claimId, "internal")).data)) {
      const accepted = await acceptInternalCoverageLimitation(
        { organizationId: ORG, claimId: built.claimId, dimensionKey, actorContext, now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, coverageReviewDecisionRepository: coverageRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(accepted.ok, true, JSON.stringify(accepted));
    }
    if (completeFollowups) await completeAllFollowups(built.claimId);
    return built;
  }

  let clientDraftFixture;
  async function prepareClientDraftFixture() {
    if (clientDraftFixture) return clientDraftFixture;
    for (const [engagementId, code] of [[PROJECT_A, "client-project-alpha"], [PROJECT_B, "client-project-beta"]]) {
      await pool.query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ($1::uuid, $2::uuid, $3)", [engagementId, ORG, code]);
    }
    const eligible = await governedInternalClaim({ completeFollowups: true });
    const held = await governedInternalClaim({ completeFollowups: false });
    const openFollowups = await query(
      "SELECT count(*)::int AS n FROM kai.client_followup_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid",
      [ORG, held.claimId],
    );
    assert.ok(openFollowups[0].n > 0, "the held claim has real P2-04/P2-11 client follow-ups");
    clientDraftFixture = {
      eligible,
      held,
      caseA: await seedClientDraft(1, { engagementId: PROJECT_A, claimId: eligible.claimId, evidenceItemId: eligible.evidenceItemId }),
      caseB: await seedClientDraft(2, { engagementId: PROJECT_A, claimId: eligible.claimId, evidenceItemId: eligible.evidenceItemId, contentType: "impact_narrative", review: "open" }),
      caseC: await seedClientDraft(3, { engagementId: PROJECT_A, claimId: held.claimId, evidenceItemId: held.evidenceItemId, contentType: "impact_narrative" }),
      caseE: await seedClientDraft(4, { engagementId: PROJECT_A, claimId: eligible.claimId, evidenceItemId: eligible.evidenceItemId, audience: "funder" }),
      caseF: await seedClientDraft(5, { engagementId: PROJECT_B, claimId: eligible.claimId, evidenceItemId: eligible.evidenceItemId }),
    };
    return clientDraftFixture;
  }

  async function realEvaluation(claimId, requestedAudience) {
    const result = await withRunnerOwnedTransaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return evaluateClaimTraceabilityInTransaction(tx, { organizationId: ORG, claimId, requestedAudience });
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.data;
  }

  async function listFor(role, engagementId) {
    const result = await listClientGeneratedDrafts({ organizationId: ORG, engagementId, actorContext: clientMember(role) }, clientContentDeps);
    assert.equal(result.ok, true, `${role}: ${JSON.stringify(result)}`);
    return result.data;
  }

  const CLIENT_ROLES = ["client_admin", "client_reviewer", "client_contributor"];

  async function authorityCounts() {
    const [row] = await query(`
      SELECT (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'generated_content_review')::int AS gc_review,
             (SELECT string_agg(queue_status || review_status || updated_at::text, ',' ORDER BY review_queue_item_id)
                FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'generated_content_review') AS gc_review_state,
             (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'export_review')::int AS export_review,
             (SELECT count(*) FROM kai.generated_content_drafts WHERE organization_id = $1::uuid)::int AS drafts,
             (SELECT count(*) FROM kai.generation_runs WHERE organization_id = $1::uuid)::int AS runs`, [ORG]);
    return row;
  }

  test("client Generated Drafts (real P2-06): A visible, B in GK review hidden, C held by a real client follow-up counted, E audience-ineligible hidden; identical for A/R/C; read-only", async () => {
    const fixture = await prepareClientDraftFixture();
    const eligibleInternal = await realEvaluation(fixture.eligible.claimId, "internal");
    assert.equal(eligibleInternal.eligible, true, JSON.stringify(eligibleInternal.blockerCodes));
    const heldInternal = await realEvaluation(fixture.held.claimId, "internal");
    assert.equal(heldInternal.eligible, false);
    assert.deepEqual([...new Set(heldInternal.blockerCodes)], ["client_followup_unresolved"], "held only by the real client follow-up");
    const eligibleFunder = await realEvaluation(fixture.eligible.claimId, "funder");
    assert.equal(eligibleFunder.eligible, false, "the claim is approved for internal only");
    assert.ok(eligibleFunder.blockerCodes.includes("claim_not_approved_for_requested_audience"), JSON.stringify(eligibleFunder.blockerCodes));

    const before = await authorityCounts();
    const views = [];
    for (const role of CLIENT_ROLES) views.push(await listFor(role, PROJECT_A));
    assert.deepEqual(views[1], views[0]);
    assert.deepEqual(views[2], views[0]);
    assert.deepEqual(views[0].items.map((item) => item.generatedContentDraftId), [fixture.caseA.draftId]);
    assert.equal(views[0].awaitingClientInputCount, 1);
    assert.equal(views[0].nextCursor, null);
    const serialized = JSON.stringify(views);
    for (const hidden of [fixture.caseB.draftId, fixture.caseC.draftId, fixture.caseE.draftId, fixture.caseF.draftId, fixture.eligible.evidenceItemId,
      fixture.caseA.queueId, fixture.caseA.runId, fixture.caseA.citationId, "client_followup_unresolved", "needs_gk_review"]) {
      assert.ok(!serialized.includes(hidden), `leaked ${hidden}`);
    }
    const detail = await getClientGeneratedDraft(
      { organizationId: ORG, engagementId: PROJECT_A, generatedContentDraftId: fixture.caseA.draftId, actorContext: clientMember("client_contributor") },
      clientContentDeps,
    );
    assert.equal(detail.ok, true, JSON.stringify(detail));
    assert.deepEqual(detail.data.blocks, [{ ordinal: 1, text: "Client draft 01 text.", supportingClaimIds: [fixture.eligible.claimId] }]);
    for (const draft of [fixture.caseB, fixture.caseC, fixture.caseE]) {
      const denied = await getClientGeneratedDraft(
        { organizationId: ORG, engagementId: PROJECT_A, generatedContentDraftId: draft.draftId, actorContext: clientMember("client_reviewer") },
        clientContentDeps,
      );
      assert.equal(denied.error.code, "not_found", draft.draftId);
    }
    assert.deepEqual(await authorityCounts(), before, "client reads write nothing");
  });

  test("client Generated Drafts (real P2-06): the real client_reviewer P2-11 completion makes the held draft visible and creates no generated-content review, export, or final state; A and C cannot complete", async () => {
    const fixture = await prepareClientDraftFixture();
    const [row] = await query(
      `SELECT cfi.client_followup_item_id, rq.updated_at FROM kai.client_followup_items cfi
         JOIN kai.review_queue_items rq ON rq.organization_id = cfi.organization_id AND rq.queue_type = 'client_followup'
          AND rq.target_object_type = 'client_followup_item' AND rq.target_object_id = cfi.client_followup_item_id
        WHERE cfi.organization_id = $1::uuid AND cfi.claim_id = $2::uuid ORDER BY cfi.dimension_key LIMIT 1`,
      [ORG, fixture.held.claimId],
    );
    for (const role of ["client_admin", "client_contributor"]) {
      const denied = await completeClientFollowup(
        { organizationId: ORG, claimId: fixture.held.claimId, clientFollowupItemId: row.client_followup_item_id,
          expectedUpdatedAt: new Date(row.updated_at).toISOString(), actorContext: clientMember(role), now: NOW },
        { env: { KAI_SPRINT2_ENABLED: "true" }, clientFollowupCompletionRepository: clientFollowupRepo, metadataOnlyAudit: auditRecorder() },
      );
      assert.equal(denied.ok, false, role);
      assert.equal(denied.blockers[0].blocking_reason, "role_not_allowed", role);
    }
    const before = await authorityCounts();
    await completeAllFollowups(fixture.held.claimId);
    assert.equal((await realEvaluation(fixture.held.claimId, "internal")).eligible, true, "the real evaluator now clears the claim");
    assert.deepEqual(await authorityCounts(), before, "completion created no generated-content review, export review, draft, or run");
    for (const role of CLIENT_ROLES) {
      const view = await listFor(role, PROJECT_A);
      assert.deepEqual(view.items.map((item) => item.generatedContentDraftId).sort(), [fixture.caseA.draftId, fixture.caseC.draftId].sort(), role);
      assert.equal(view.awaitingClientInputCount, 0);
    }
    const detail = await getClientGeneratedDraft(
      { organizationId: ORG, engagementId: PROJECT_A, generatedContentDraftId: fixture.caseC.draftId, actorContext: clientMember("client_admin") },
      clientContentDeps,
    );
    assert.equal(detail.data.reviewState, "reviewed");
  });

  test("client Generated Drafts (real P2-06): project scoping - Project B lists only its draft, Project A cannot fetch B's draft; cross-org is denied before any read", async () => {
    const fixture = await prepareClientDraftFixture();
    const viewB = await listFor("client_reviewer", PROJECT_B);
    assert.deepEqual(viewB.items.map((item) => item.generatedContentDraftId), [fixture.caseF.draftId]);
    const viewA = await listFor("client_reviewer", PROJECT_A);
    assert.ok(!viewA.items.some((item) => item.generatedContentDraftId === fixture.caseF.draftId));
    const crossProject = await getClientGeneratedDraft(
      { organizationId: ORG, engagementId: PROJECT_A, generatedContentDraftId: fixture.caseF.draftId, actorContext: clientMember("client_admin") },
      clientContentDeps,
    );
    assert.equal(crossProject.error.code, "not_found");
    const ownProject = await getClientGeneratedDraft(
      { organizationId: ORG, engagementId: PROJECT_B, generatedContentDraftId: fixture.caseF.draftId, actorContext: clientMember("client_admin") },
      clientContentDeps,
    );
    assert.equal(ownProject.ok, true);

    transactionLog.length = 0;
    for (const result of [
      await listClientGeneratedDrafts({ organizationId: ORG, engagementId: PROJECT_A, actorContext: clientMember("client_admin", OTHER_ORG) }, clientContentDeps),
      await getClientGeneratedDraft({ organizationId: ORG, engagementId: PROJECT_A, generatedContentDraftId: fixture.caseA.draftId, actorContext: clientMember("client_reviewer", OTHER_ORG) }, clientContentDeps),
    ]) {
      assert.equal(result.ok, false);
      assert.equal(result.blockers[0].validator_key, "VAL-AUT-003");
    }
    assert.equal(transactionLog.length, 0, "no transaction opened for a cross-org client");
    const foreign = await getClientGeneratedDraft(
      { organizationId: OTHER_ORG, engagementId: PROJECT_A, generatedContentDraftId: fixture.caseA.draftId, actorContext: clientMember("client_admin", OTHER_ORG) },
      clientContentDeps,
    );
    assert.equal(foreign.error.code, "not_found", "this organization's project and draft ids expose nothing to another organization");
    assert.ok(!JSON.stringify(foreign).includes("Client draft"));
  });
}
