import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_C3_B3_SEVEN_RULES_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`C3.B3 seven-rules integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("C3.B3 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("C3.B3 integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runIntegrationSuite();
}

function sha256hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function runIntegrationSuite() {
  const { Pool } = await import("pg");
  const { createPostgresRequirementAssessmentRepository } = await import(
    "../Backend/kai/dictionary/postgresRequirementAssessmentRepository.js"
  );
  const {
    assessOrganizationRequirement,
    getOrganizationRequirementAssessment,
  } = await import("../Backend/kai/services/kaiRequirementAssessmentService.js");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false });
  after(async () => {
    await pool.end();
  });

  async function runInTransaction(callback) {
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

  const repository = createPostgresRequirementAssessmentRepository({ runInTransaction });

  function actorContext(role, organizationId, userId = crypto.randomUUID()) {
    return {
      actorType: "human",
      actorUserId: userId,
      kaiRoles: [],
      organizationMemberships: [{ organization_id: organizationId, role_name: role, membership_status: "active" }],
    };
  }

  const trueEnv = { KAI_SPRINT2_ENABLED: "true" };

  async function assess(organizationId, requirementId, role = "gk_reviewer") {
    return assessOrganizationRequirement({
      organizationId,
      requirementId,
      actorContext: actorContext(role, organizationId),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
  }

  async function readCurrent(organizationId, requirementId, role = "gk_operator") {
    return getOrganizationRequirementAssessment({
      organizationId,
      requirementId,
      actorContext: actorContext(role, organizationId),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
  }

  async function makeRequirement(keySuffix, key) {
    const suffix = `${keySuffix}_${Math.random().toString(36).slice(2)}`;
    const source = (
      await pool.query(
        "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('kai_standard', $1, 'C3.B3 Fixture Source') RETURNING requirement_source_id",
        [`src_${suffix}`],
      )
    ).rows[0].requirement_source_id;
    const frameworkVersion = (
      await pool.query(
        "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label) VALUES ($1, 'fw', 'Framework', 'v1') RETURNING requirement_framework_version_id",
        [source],
      )
    ).rows[0].requirement_framework_version_id;
    const set = (
      await pool.query(
        "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'set', 'Set') RETURNING requirement_set_id",
        [frameworkVersion],
      )
    ).rows[0].requirement_set_id;
    const requirement = (
      await pool.query(
        "INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, display_order) VALUES ($1, $2, 'Requirement', 0) RETURNING *",
        [set, key],
      )
    ).rows[0];
    return requirement;
  }

  async function makeOrgEngagement() {
    const organizationId = (
      await pool.query("INSERT INTO kai.organizations (name) VALUES ('C3.B3 Org') RETURNING organization_id")
    ).rows[0].organization_id;
    return organizationId;
  }

  // -----------------------------------------------------------------------
  // Shared evidence/claim/source fixture (identical shape to C3.A2/C3.A3/
  // C3.A4/C3.B2's own fixture builders).
  // -----------------------------------------------------------------------
  async function buildEvidenceClaim(organizationId, suffix) {
    const checksum = sha256hex(`checksum|${suffix}`);
    const profileSha = sha256hex(`profile|${suffix}`);
    const sourceCode = sha256hex(`source|${suffix}`);
    const statementFingerprint = sha256hex(`evidence-statement|${suffix}`);
    const claimFingerprint = sha256hex(`claim-statement|${suffix}`);
    const locatorFingerprint = sha256hex(`locator|${suffix}`);

    const intakeFileId = (
      await pool.query(
        `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename, checksum, hash_algorithm)
         VALUES (gen_random_uuid(), gen_random_uuid(), $1, $2, $2, $3, 'sha256') RETURNING intake_file_id`,
        [organizationId, `f-${suffix}.csv`, checksum],
      )
    ).rows[0].intake_file_id;

    const parserRunId = (
      await pool.query(
        `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
         VALUES ($1, $2, 'csv_parser', 'v1', $3, 'running', now()) RETURNING parser_run_id`,
        [organizationId, intakeFileId, checksum],
      )
    ).rows[0].parser_run_id;

    const fileProfileId = (
      await pool.query(
        `INSERT INTO kai.intake_file_profiles (organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256)
         VALUES ($1, $2, $3, 'csv_parser', 'v1', $4, $5::jsonb, $6) RETURNING file_profile_id`,
        [organizationId, intakeFileId, parserRunId, checksum, JSON.stringify({ field_count: 1 }), profileSha],
      )
    ).rows[0].file_profile_id;

    await pool.query(
      `UPDATE kai.intake_parser_runs SET parser_status = 'completed', completed_at = now(), output_profile_id = $1 WHERE parser_run_id = $2`,
      [fileProfileId, parserRunId],
    );

    const dataDictionaryId = (
      await pool.query(
        `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256)
         VALUES ($1, $2, $3, $4) RETURNING data_dictionary_id`,
        [organizationId, intakeFileId, fileProfileId, profileSha],
      )
    ).rows[0].data_dictionary_id;

    await pool.query(
      `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type)
       VALUES ($1, $2, $3, 'signup_count', 'Signup Count', 'number')`,
      [dataDictionaryId, organizationId, fileProfileId],
    );

    const sensitivityId = (
      await pool.query(
        `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
         VALUES ($1, $2, $3, $4, $5) RETURNING intake_sensitivity_profile_id`,
        [organizationId, intakeFileId, fileProfileId, dataDictionaryId, profileSha],
      )
    ).rows[0].intake_sensitivity_profile_id;

    const candidateId = (
      await pool.query(
        `INSERT INTO kai.intake_source_candidates (organization_id, intake_file_id, file_profile_id, data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256, candidate_status)
         VALUES ($1, $2, $3, $4, $5, $6, 'needs_gk_review') RETURNING intake_source_candidate_id`,
        [organizationId, intakeFileId, fileProfileId, dataDictionaryId, sensitivityId, profileSha],
      )
    ).rows[0].intake_source_candidate_id;

    const reviewItemId = (
      await pool.query(
        `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary, required_action)
         VALUES ($1, 'source_candidate_review', 'intake_source_candidate', $2, 'Review candidate.', 'Human review required.') RETURNING review_queue_item_id`,
        [organizationId, candidateId],
      )
    ).rows[0].review_queue_item_id;

    await pool.query(`UPDATE kai.intake_source_candidates SET candidate_status = 'promoted' WHERE intake_source_candidate_id = $1`, [candidateId]);
    await pool.query(`UPDATE kai.review_queue_items SET queue_status = 'resolved', review_status = 'resolved' WHERE review_queue_item_id = $1`, [reviewItemId]);

    const sourceId = (
      await pool.query(
        `INSERT INTO kai.sources (organization_id, source_code, reviewed_source_type, created_by_type)
         VALUES ($1, $2, 'organization_primary_record', 'human') RETURNING source_id`,
        [organizationId, sourceCode],
      )
    ).rows[0].source_id;

    const sourceVersionId = (
      await pool.query(
        `INSERT INTO kai.source_versions (organization_id, source_id, intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type)
         VALUES ($1, $2, $3, $4, $5, 'human') RETURNING source_version_id`,
        [organizationId, sourceId, candidateId, sensitivityId, profileSha],
      )
    ).rows[0].source_version_id;

    const promotionDecisionId = (
      await pool.query(
        `INSERT INTO kai.intake_promotion_decisions (organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type, decision_status, source_id, source_version_id, promoted_at, created_by_type)
         VALUES ($1, $2, $3, 'organization_primary_record', 'promoted', $4, $5, now(), 'human') RETURNING intake_promotion_decision_id`,
        [organizationId, candidateId, reviewItemId, sourceId, sourceVersionId],
      )
    ).rows[0].intake_promotion_decision_id;

    const sourceLocatorId = (
      await pool.query(
        `INSERT INTO kai.source_locators (organization_id, source_version_id, locator_type, coordinates, locator_fingerprint, created_by_type)
         VALUES ($1, $2, 'column', $3::jsonb, $4, 'system') RETURNING source_locator_id`,
        [organizationId, sourceVersionId, JSON.stringify({ column_name: "signup_count" }), locatorFingerprint],
      )
    ).rows[0].source_locator_id;

    const evidenceItemId = (
      await pool.query(
        `INSERT INTO kai.evidence_items (organization_id, source_id, source_version_id, source_locator_id, evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type)
         VALUES ($1, $2, $3, $4, 'dictionary_field_presence_fact', 'organization_committed_metadata', 'unknown', 'unassessed', 'Signup count field is present.', $5, 'system') RETURNING evidence_item_id`,
        [organizationId, sourceId, sourceVersionId, sourceLocatorId, statementFingerprint],
      )
    ).rows[0].evidence_item_id;

    const claimId = (
      await pool.query(
        `INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
         VALUES ($1, $2, 'finding', 'proposed', 'needs_gk_review', 'unassessed', 'Signups were recorded.', $3, 'system') RETURNING claim_id`,
        [organizationId, evidenceItemId, claimFingerprint],
      )
    ).rows[0].claim_id;

    return { evidenceItemId, claimId, sourceId, sourceVersionId, candidateId, promotionDecisionId };
  }

  async function insertClaimDecision(organizationId, claimId, outcome, approvedAudiences = null, supersedes = null) {
    const row = (
      await pool.query(
        `INSERT INTO kai.claim_review_decisions
           (organization_id, claim_id, review_queue_item_id, decision_outcome, approved_audiences, decided_by, decided_by_role, target_updated_at, supersedes_decision_id, created_by_type)
         VALUES ($1, $2, gen_random_uuid(), $3, $4, gen_random_uuid(), 'gk_reviewer', now(), $5, 'human')
         RETURNING decision_id`,
        [organizationId, claimId, outcome, approvedAudiences, supersedes],
      )
    ).rows[0];
    return row.decision_id;
  }

  async function insertOutcomeContext(organizationId, suffix, overrides = {}) {
    return (
      await pool.query(
        `INSERT INTO kai.impact_outcome_contexts
           (organization_id, engagement_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label, created_by_type)
         VALUES ($1, NULL, $2, $3, $4, $5, 'human') RETURNING *`,
        [
          organizationId,
          overrides.outcomeKey || `outcome_${suffix}`,
          overrides.outcomeStatement || `Stakeholders achieve the intended change for ${suffix}.`,
          overrides.stakeholderKey || `stakeholder_${suffix}`,
          overrides.stakeholderLabel || `Stakeholder ${suffix}`,
        ],
      )
    ).rows[0];
  }

  async function supersedeSourceVersion(organizationId, sourceVersionId) {
    await pool.query(`UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1 AND organization_id = $2`, [sourceVersionId, organizationId]);
  }

  async function insertGap(organizationId, claimId, evidenceItemId, sourceVersionId, dimensionKey, assessmentStatus) {
    return (
      await pool.query(
        `INSERT INTO kai.gap_log_items
           (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary, created_by_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'system')
         RETURNING gap_log_item_id`,
        [
          organizationId, claimId, evidenceItemId, sourceVersionId, dimensionKey, assessmentStatus,
          `VAL-KAI-P2-02-${dimensionKey}`,
          `Claim gap requires review for dimension: ${dimensionKey}.`,
        ],
      )
    ).rows[0].gap_log_item_id;
  }

  async function insertClaimEvidenceLink(organizationId, claimId, evidenceItemId) {
    await pool.query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id) VALUES ($1, $2, $3)`,
      [organizationId, claimId, evidenceItemId],
    );
  }

  async function buildConflict(organizationId, suffix) {
    const claimA = await buildEvidenceClaim(organizationId, `${suffix}a`);
    const claimB = await buildEvidenceClaim(organizationId, `${suffix}b`);
    const [lowerClaimId, higherClaimId] =
      claimA.claimId < claimB.claimId ? [claimA.claimId, claimB.claimId] : [claimB.claimId, claimA.claimId];
    const lowerFixture = lowerClaimId === claimA.claimId ? claimA : claimB;
    const higherFixture = higherClaimId === claimA.claimId ? claimA : claimB;

    const lowerGapId = await insertGap(organizationId, lowerClaimId, lowerFixture.evidenceItemId, lowerFixture.sourceVersionId, "conflicting_source_indicators", "unresolved");
    const higherGapId = await insertGap(organizationId, higherClaimId, higherFixture.evidenceItemId, higherFixture.sourceVersionId, "conflicting_source_indicators", "unresolved");

    const conflictGroupId = (
      await pool.query(
        `INSERT INTO kai.conflict_groups
           (organization_id, lower_claim_id, higher_claim_id, lower_claim_conflict_gap_id, higher_claim_conflict_gap_id, basis_code, safe_summary, created_by_type)
         VALUES ($1, $2, $3, $4, $5, 'human_selected_unresolved_comparison', 'Potential claim conflict requires GK review.', 'system')
         RETURNING conflict_group_id`,
        [organizationId, lowerClaimId, higherClaimId, lowerGapId, higherGapId],
      )
    ).rows[0].conflict_group_id;

    await pool.query(
      `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary, required_action)
       VALUES ($1, 'conflict_resolution', 'conflict_group', $2,
         'Potential claim conflict requires GK review.',
         'Compare both claims, their evidence lineage, definitions, reporting periods, entity levels, denominators, and support limitations. Record whether a conflict exists. Do not approve or promote either claim.')`,
      [organizationId, conflictGroupId],
    );

    return { conflictGroupId, lowerClaimId, higherClaimId, lowerGapId, higherGapId };
  }

  async function auditEventCount(organizationId) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM kai.audit_events WHERE organization_id = $1`, [organizationId]);
    return rows[0].n;
  }

  // -----------------------------------------------------------------------
  // Real currently-applicable-gap fixture (mirrors C3.A3.B's ORG_GAPS
  // pattern exactly): kai.gap_log_items rows written by a hand-rolled raw
  // SQL insert are NEVER recognized as "current" by
  // filterCurrentOrganizationEvidenceGaps - that gate recomputes the
  // expected P2-02 dimension plan from real data_dictionary_fields/
  // data_quality_findings/evidence-coverage state and requires an exact
  // match. Real currently-applicable gaps can only be produced by running
  // the actual production pipeline (extractEvidenceFromSourceVersion ->
  // proposeClaim -> generateClaimGapFollowups) against the pre-seeded,
  // quality-issue-triggering ORG_GAPS smoke-seed data the C3.A3.B runner
  // also depends on.
  // -----------------------------------------------------------------------
  const ORG_GAPS = "00000000-0000-4000-8000-000000000001";
  const GAPS_NOW = "2026-08-06T10:00:00.000Z";
  const gapsActorContext = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000002",
    organizationMemberships: [{ organization_id: ORG_GAPS, membership_status: "active", role_name: "gk_reviewer" }],
  };
  function gapsAuditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }
  const evidenceRepo = createPostgresEvidenceLineageRepository({ runInTransaction });
  const claimRepo = createPostgresClaimProposalRepository({ runInTransaction });
  const gapRepo = createPostgresClaimGapFollowupRepository({ runInTransaction });

  let gapEligibleClaimIds;
  async function gapEligibleClaims() {
    if (gapEligibleClaimIds) return gapEligibleClaimIds;
    const { rows: sourceVersions } = await pool.query(
      `SELECT source_version_id::text AS source_version_id FROM kai.source_versions WHERE organization_id = $1::uuid AND is_current = true ORDER BY source_version_id LIMIT 1`,
      [ORG_GAPS],
    );
    const evidenceResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG_GAPS, sourceVersionId: sourceVersions[0].source_version_id, actorContext: gapsActorContext, now: GAPS_NOW },
      { env: trueEnv, evidenceLineageRepository: evidenceRepo, metadataOnlyAudit: gapsAuditRecorder() },
    );
    assert.equal(evidenceResult.ok, true);
    const { rows: evidenceRows } = await pool.query(
      `SELECT evidence_item_id::text AS evidence_item_id FROM kai.evidence_items WHERE organization_id = $1::uuid ORDER BY evidence_item_id LIMIT 2`,
      [ORG_GAPS],
    );
    const claimIds = [];
    for (const row of evidenceRows) {
      const claimResult = await proposeClaim(
        { organizationId: ORG_GAPS, evidenceItemId: row.evidence_item_id, actorContext: gapsActorContext, now: GAPS_NOW },
        { env: trueEnv, claimProposalRepository: claimRepo, metadataOnlyAudit: gapsAuditRecorder() },
      );
      assert.equal(claimResult.ok, true);
      const claimId = claimResult.data.claim.claim_id;
      const gapResult = await generateClaimGapFollowups(
        { organizationId: ORG_GAPS, claimId, actorContext: gapsActorContext, now: GAPS_NOW },
        { env: trueEnv, claimGapFollowupRepository: gapRepo, metadataOnlyAudit: gapsAuditRecorder() },
      );
      assert.equal(gapResult.ok, true);
      claimIds.push(claimId);
    }
    gapEligibleClaimIds = claimIds;
    return claimIds;
  }

  async function countAssessmentRows(organizationId, requirementId) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.requirement_assessments WHERE organization_id = $1 AND requirement_id = $2`,
      [organizationId, requirementId],
    );
    return rows[0].n;
  }

  // =========================================================================
  // ir_pur_001
  // =========================================================================
  test("ir_pur_001: states, provenance, replay, reassessment, GET, audit, tenant", async () => {
    const orgA = await makeOrgEngagement();
    const orgB = await makeOrgEngagement();
    const requirement = await makeRequirement("pur1", "ir_pur_001");

    const empty = await assess(orgA, requirement.requirement_id);
    assert.equal(empty.ok, true);
    assert.equal(empty.data.assessment_state, "not_satisfied");
    const auditAfterEmpty = await auditEventCount(orgA);
    assert.equal(auditAfterEmpty, 1);

    const context = await insertOutcomeContext(orgA, "pur1");
    const satisfied = await assess(orgA, requirement.requirement_id);
    assert.equal(satisfied.data.assessment_state, "satisfied");
    assert.equal(satisfied.data.replayed, false);
    assert.notEqual(satisfied.data.state_fingerprint, empty.data.state_fingerprint);
    assert.equal(await countAssessmentRows(orgA, requirement.requirement_id), 2, "old row preserved, new row inserted");

    const { rows: links } = await pool.query(
      `SELECT impact_outcome_context_id::text AS id FROM kai.ra_outcome_context_links WHERE requirement_assessment_id = $1`,
      [satisfied.data.requirement_assessment_id],
    );
    assert.deepEqual(links.map((r) => r.id), [context.impact_outcome_context_id]);

    // Same-state replay.
    const replay = await assess(orgA, requirement.requirement_id);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.requirement_assessment_id, satisfied.data.requirement_assessment_id);
    assert.equal(await countAssessmentRows(orgA, requirement.requirement_id), 2, "replay adds no new row");
    assert.equal(await auditEventCount(orgA), 2, "replay adds no new audit event");

    // GET current.
    const current = await readCurrent(orgA, requirement.requirement_id);
    assert.equal(current.ok, true);
    assert.equal(current.data.assessment.assessment_state, "satisfied");
    assert.deepEqual(current.data.outcome_context_ids, [context.impact_outcome_context_id]);

    // Cross-tenant: orgB has no context, must independently be not_satisfied.
    const crossTenant = await assess(orgB, requirement.requirement_id);
    assert.equal(crossTenant.data.assessment_state, "not_satisfied");
    assert.equal(await countAssessmentRows(orgB, requirement.requirement_id), 1);
  });

  // =========================================================================
  // ir_stk_001
  // =========================================================================
  test("ir_stk_001: states, provenance, replay, GET, tenant", async () => {
    const orgA = await makeOrgEngagement();
    const requirement = await makeRequirement("stk1", "ir_stk_001");

    const empty = await assess(orgA, requirement.requirement_id);
    assert.equal(empty.data.assessment_state, "not_satisfied");

    const context = await insertOutcomeContext(orgA, "stk1");
    const satisfied = await assess(orgA, requirement.requirement_id);
    assert.equal(satisfied.data.assessment_state, "satisfied");

    const { rows: links } = await pool.query(
      `SELECT impact_outcome_context_id::text AS id, stakeholder_key FROM kai.ra_outcome_context_links WHERE requirement_assessment_id = $1`,
      [satisfied.data.requirement_assessment_id],
    );
    assert.equal(links[0].id, context.impact_outcome_context_id);
    assert.equal(links[0].stakeholder_key, context.stakeholder_key);

    const replay = await assess(orgA, requirement.requirement_id);
    assert.equal(replay.data.replayed, true);

    const current = await readCurrent(orgA, requirement.requirement_id);
    assert.deepEqual(current.data.outcome_context_ids, [context.impact_outcome_context_id]);

    // Fingerprint is not material over outcome_statement: changing it alone
    // (impossible via UPDATE given the append-only provenance link, but the
    // context row itself is mutable) must not change ir_stk_001's fingerprint.
    await pool.query(`UPDATE kai.impact_outcome_contexts SET outcome_statement = 'A wholly different statement.' WHERE impact_outcome_context_id = $1`, [context.impact_outcome_context_id]);
    const afterUnrelatedEdit = await assess(orgA, requirement.requirement_id);
    assert.equal(afterUnrelatedEdit.data.replayed, true, "outcome_statement is immaterial to ir_stk_001");
  });

  // =========================================================================
  // ir_data_001
  // =========================================================================
  test("ir_data_001: states (current/superseded), provenance, replay, reassessment on supersession, GET, audit, tenant", async () => {
    const orgA = await makeOrgEngagement();
    const orgB = await makeOrgEngagement();
    const requirement = await makeRequirement("data1", "ir_data_001");

    const empty = await assess(orgA, requirement.requirement_id);
    assert.equal(empty.data.assessment_state, "not_satisfied");

    const fixture = await buildEvidenceClaim(orgA, "data1");
    const satisfied = await assess(orgA, requirement.requirement_id);
    assert.equal(satisfied.data.assessment_state, "satisfied");

    const { rows: srcLinks } = await pool.query(
      `SELECT evidence_item_id::text AS evidence_item_id, is_current, decision_status, reviewed_source_type
         FROM kai.ra_source_promotion_links WHERE requirement_assessment_id = $1`,
      [satisfied.data.requirement_assessment_id],
    );
    assert.equal(srcLinks.length, 1);
    assert.equal(srcLinks[0].evidence_item_id, fixture.evidenceItemId);
    assert.equal(srcLinks[0].is_current, true);
    assert.equal(srcLinks[0].decision_status, "promoted");

    // Replay while unchanged.
    const replay = await assess(orgA, requirement.requirement_id);
    assert.equal(replay.data.replayed, true);

    // Supersession -> needs_review (single-item universe, all superseded).
    await supersedeSourceVersion(orgA, fixture.sourceVersionId);
    const afterSupersede = await assess(orgA, requirement.requirement_id);
    assert.equal(afterSupersede.data.replayed, false);
    assert.notEqual(afterSupersede.data.state_fingerprint, satisfied.data.state_fingerprint);
    assert.equal(afterSupersede.data.assessment_state, "needs_review");
    // Historical preservation: prior row unchanged.
    const { rows: priorRow } = await pool.query(`SELECT assessment_state FROM kai.requirement_assessments WHERE requirement_assessment_id = $1`, [satisfied.data.requirement_assessment_id]);
    assert.equal(priorRow[0].assessment_state, "satisfied");

    // Mixed: add a second, still-current evidence item -> partially_satisfied.
    const fixture2 = await buildEvidenceClaim(orgA, "data1-second");
    const mixed = await assess(orgA, requirement.requirement_id);
    assert.equal(mixed.data.assessment_state, "partially_satisfied");
    assert.ok(fixture2.evidenceItemId);

    const current = await readCurrent(orgA, requirement.requirement_id);
    assert.equal(current.data.assessment.assessment_state, "partially_satisfied");
    assert.equal(await auditEventCount(orgA), 4);

    // Cross-tenant isolation.
    const crossTenant = await assess(orgB, requirement.requirement_id);
    assert.equal(crossTenant.data.assessment_state, "not_satisfied");
  });

  // =========================================================================
  // ir_data_002
  // =========================================================================
  test("ir_data_002: N=0 not_satisfied; real currently-applicable gaps drive a non-vacuous state; provenance, replay, GET, audit, tenant", async () => {
    const orgEmpty = await makeOrgEngagement();
    const requirement = await makeRequirement("data2empty", "ir_data_002");
    const empty = await assess(orgEmpty, requirement.requirement_id);
    assert.equal(empty.data.assessment_state, "not_satisfied");

    // Real, currently-applicable gaps (via the actual P2-01/P2-02/P2-04
    // production stack against the pre-seeded ORG_GAPS data) must drive a
    // non-vacuous (not `not_satisfied`) state and be cited as ra_gap_links
    // provenance - mirrors C3.A3.B's own B1/B2/B3 proof pattern.
    const [claimA] = await gapEligibleClaims();
    const expectedGaps = await pool.query(
      `SELECT gap_log_item_id::text AS gap_log_item_id FROM kai.gap_log_items WHERE claim_id = $1::uuid`,
      [claimA],
    );
    assert.ok(expectedGaps.rows.length > 0, "fixture must produce at least one real currently-applicable gap");

    const requirementGaps = await makeRequirement("data2gaps", "ir_data_002");
    const withGaps = await assess(ORG_GAPS, requirementGaps.requirement_id);
    assert.equal(withGaps.ok, true);
    assert.notEqual(withGaps.data.assessment_state, "not_satisfied");

    const { rows: gapLinks } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.ra_gap_links WHERE requirement_assessment_id = $1`,
      [withGaps.data.requirement_assessment_id],
    );
    assert.ok(gapLinks[0].n > 0);
    const auditAfterFirst = await auditEventCount(ORG_GAPS);

    // Same-state replay.
    const replay = await assess(ORG_GAPS, requirementGaps.requirement_id);
    assert.equal(replay.data.replayed, true);
    assert.equal(await auditEventCount(ORG_GAPS), auditAfterFirst, "replay adds no new audit event");

    const current = await readCurrent(ORG_GAPS, requirementGaps.requirement_id);
    assert.equal(current.data.assessment.assessment_state, withGaps.data.assessment_state);
    assert.ok(current.data.current_gap_log_item_ids.length > 0);

    // Cross-tenant isolation.
    const orgB = await makeOrgEngagement();
    const crossTenant = await assess(orgB, requirementGaps.requirement_id);
    assert.equal(crossTenant.data.assessment_state, "not_satisfied");
    assert.equal(await countAssessmentRows(orgB, requirementGaps.requirement_id), 1);

    // Reassessment + historical preservation (changed-state reassessment
    // via real supersession, mirroring ir_data_001's own dedicated-org
    // proof and C3.A3.B's B4 test): staling out every source_version for
    // this organization must reduce the gap universe and mint a fresh,
    // distinct assessment row while the prior one remains byte-for-byte
    // unchanged. This is deliberately the LAST step touching ORG_GAPS in
    // this file (like C3.A3.B's B4) since it permanently affects every
    // other test sharing this fixture - ir_contrib_003 (which also reuses
    // ORG_GAPS) runs its own destructive step at its own end, in the same
    // spirit, after this one.
    await pool.query(`UPDATE kai.source_versions SET is_current = false WHERE organization_id = $1::uuid`, [ORG_GAPS]);
    const afterStale = await assess(ORG_GAPS, requirementGaps.requirement_id);
    assert.equal(afterStale.data.replayed, false);
    assert.notEqual(afterStale.data.state_fingerprint, withGaps.data.state_fingerprint);
    assert.equal(afterStale.data.assessment_state, "not_satisfied", "no currently-applicable gaps remain once every source_version is stale");
    const { rows: staleGapLinks } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.ra_gap_links WHERE requirement_assessment_id = $1`,
      [afterStale.data.requirement_assessment_id],
    );
    assert.equal(staleGapLinks[0].n, 0);
    const { rows: priorRow } = await pool.query(`SELECT assessment_state FROM kai.requirement_assessments WHERE requirement_assessment_id = $1`, [withGaps.data.requirement_assessment_id]);
    assert.notEqual(priorRow[0].assessment_state, "not_satisfied", "the prior gaps-present row is preserved, untouched");

    // Restore currentness so later tests in this file (ir_contrib_003) that
    // reuse ORG_GAPS's real gap-eligible claims still see a non-vacuous gap
    // universe.
    await pool.query(`UPDATE kai.source_versions SET is_current = true WHERE organization_id = $1::uuid`, [ORG_GAPS]);
  });

  // =========================================================================
  // ir_data_003
  // =========================================================================
  test("ir_data_003: states (traced/untraced), provenance, replay, reassessment, GET, audit, tenant", async () => {
    const orgA = await makeOrgEngagement();
    const orgB = await makeOrgEngagement();
    const requirement = await makeRequirement("data3", "ir_data_003");

    const empty = await assess(orgA, requirement.requirement_id);
    assert.equal(empty.data.assessment_state, "not_satisfied");

    const untracedFixture = await buildEvidenceClaim(orgA, "data3-untraced");
    const allUntraced = await assess(orgA, requirement.requirement_id);
    assert.equal(allUntraced.data.assessment_state, "not_satisfied");

    const tracedFixture = await buildEvidenceClaim(orgA, "data3-traced");
    await insertClaimEvidenceLink(orgA, tracedFixture.claimId, tracedFixture.evidenceItemId);
    const mixed = await assess(orgA, requirement.requirement_id);
    assert.equal(mixed.data.assessment_state, "partially_satisfied");
    assert.equal(mixed.data.replayed, false);

    const { rows: claimLinks } = await pool.query(
      `SELECT claim_id::text AS claim_id FROM kai.requirement_assessment_claim_links WHERE requirement_assessment_id = $1 ORDER BY claim_id`,
      [mixed.data.requirement_assessment_id],
    );
    assert.deepEqual(claimLinks.map((r) => r.claim_id).sort(), [untracedFixture.claimId, tracedFixture.claimId].sort());
    const { rows: evidenceLinks } = await pool.query(
      `SELECT evidence_item_id::text AS id FROM kai.requirement_assessment_evidence_links WHERE requirement_assessment_id = $1`,
      [mixed.data.requirement_assessment_id],
    );
    assert.deepEqual(evidenceLinks.map((r) => r.id), [tracedFixture.evidenceItemId]);

    const replay = await assess(orgA, requirement.requirement_id);
    assert.equal(replay.data.replayed, true);

    const current = await readCurrent(orgA, requirement.requirement_id);
    assert.equal(current.data.assessment.assessment_state, "partially_satisfied");
    assert.equal(await auditEventCount(orgA), 3);

    const crossTenant = await assess(orgB, requirement.requirement_id);
    assert.equal(crossTenant.data.assessment_state, "not_satisfied");
  });

  // =========================================================================
  // ir_contrib_003
  // =========================================================================
  test("ir_contrib_003: N=0 not_satisfied; real conflict pairing over real currently-applicable gaps is cited; fingerprint materiality; replay; GET; tenant", async () => {
    const orgEmpty = await makeOrgEngagement();
    const requirementEmpty = await makeRequirement("contrib3empty", "ir_contrib_003");
    const empty = await assess(orgEmpty, requirementEmpty.requirement_id);
    assert.equal(empty.data.assessment_state, "not_satisfied");

    // Real conflict pairing over two real, currently-applicable-gap-bearing
    // claims (reuses each claim's own already-real gap_log_items row as the
    // conflict's lower/higher_claim_conflict_gap_id - conflict_groups has no
    // dimension_key constraint on the cited gap, only that it belongs to the
    // claim and organization).
    const [claimA, claimB] = await gapEligibleClaims();
    const [lowerClaimId, higherClaimId] = claimA < claimB ? [claimA, claimB] : [claimB, claimA];
    const lowerGap = (await pool.query(`SELECT gap_log_item_id::text AS id FROM kai.gap_log_items WHERE claim_id = $1::uuid LIMIT 1`, [lowerClaimId])).rows[0];
    const higherGap = (await pool.query(`SELECT gap_log_item_id::text AS id FROM kai.gap_log_items WHERE claim_id = $1::uuid LIMIT 1`, [higherClaimId])).rows[0];
    assert.ok(lowerGap && higherGap, "both conflicting claims must already have a real currently-applicable gap");

    const conflictGroupId = (
      await pool.query(
        `INSERT INTO kai.conflict_groups
           (organization_id, lower_claim_id, higher_claim_id, lower_claim_conflict_gap_id, higher_claim_conflict_gap_id, basis_code, safe_summary, created_by_type)
         VALUES ($1, $2, $3, $4, $5, 'human_selected_unresolved_comparison', 'Potential claim conflict requires GK review.', 'system')
         ON CONFLICT (organization_id, lower_claim_id, higher_claim_id) DO UPDATE SET organization_id = EXCLUDED.organization_id
         RETURNING conflict_group_id`,
        [ORG_GAPS, lowerClaimId, higherClaimId, lowerGap.id, higherGap.id],
      )
    ).rows[0].conflict_group_id;
    await pool.query(
      `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary, required_action)
       SELECT $1, 'conflict_resolution', 'conflict_group', $2,
         'Potential claim conflict requires GK review.',
         'Compare both claims, their evidence lineage, definitions, reporting periods, entity levels, denominators, and support limitations. Record whether a conflict exists. Do not approve or promote either claim.'
       WHERE NOT EXISTS (
         SELECT 1 FROM kai.review_queue_items WHERE organization_id = $1 AND queue_type = 'conflict_resolution' AND target_object_id = $2
       )`,
      [ORG_GAPS, conflictGroupId],
    );

    const requirement = await makeRequirement("contrib3", "ir_contrib_003");
    const result = await assess(ORG_GAPS, requirement.requirement_id);
    assert.equal(result.ok, true);
    assert.notEqual(result.data.assessment_state, "not_satisfied");

    const { rows: conflictLinks } = await pool.query(
      `SELECT claim_id::text AS claim_id, conflict_group_id::text AS conflict_group_id FROM kai.ra_conflict_resolution_links WHERE requirement_assessment_id = $1 ORDER BY claim_id`,
      [result.data.requirement_assessment_id],
    );
    assert.deepEqual(conflictLinks.map((r) => r.claim_id).sort(), [lowerClaimId, higherClaimId].sort());
    assert.ok(conflictLinks.every((r) => r.conflict_group_id === conflictGroupId));

    const replay = await assess(ORG_GAPS, requirement.requirement_id);
    assert.equal(replay.data.replayed, true);

    const current = await readCurrent(ORG_GAPS, requirement.requirement_id);
    assert.equal(current.data.conflict_resolution_pairs.length, 2);

    // Fingerprint materiality: a fresh requirement with the identical gap
    // universe but computed before the conflict citation existed would
    // differ - proven directly via the pure validator's own fingerprint
    // materiality unit test (kai-sprint2-c3-b3-seven-rules-validators.spec.js)
    // since reproducing a live "before conflict" moment against the same
    // shared ORG_GAPS fixture here would require an earlier assessment row
    // this test does not otherwise need.

    const orgB = await makeOrgEngagement();
    const crossTenant = await assess(orgB, requirement.requirement_id);
    assert.equal(crossTenant.data.assessment_state, "not_satisfied");
  });

  // =========================================================================
  // ir_comm_001
  // =========================================================================
  test("ir_comm_001: states (known/unknown audience), provenance, replay, reassessment, GET, audit, tenant", async () => {
    const orgA = await makeOrgEngagement();
    const orgB = await makeOrgEngagement();
    const requirement = await makeRequirement("comm1", "ir_comm_001");

    const empty = await assess(orgA, requirement.requirement_id);
    assert.equal(empty.data.assessment_state, "not_satisfied");

    const rejectedFixture = await buildEvidenceClaim(orgA, "comm1-rejected");
    const rejectedDecisionId = await insertClaimDecision(orgA, rejectedFixture.claimId, "rejected", null);
    const allUnknown = await assess(orgA, requirement.requirement_id);
    assert.equal(allUnknown.data.assessment_state, "not_satisfied", "a decision with no approved audience is still UNKNOWN");
    // Even a no-audience decision is cited as provenance (it IS the fact
    // supporting the UNKNOWN classification, exactly mirroring ir_comm_002's
    // citation of any current decision regardless of outcome).
    const { rows: allUnknownLinks } = await pool.query(
      `SELECT decision_id::text AS decision_id FROM kai.ra_claim_review_decision_links WHERE requirement_assessment_id = $1`,
      [allUnknown.data.requirement_assessment_id],
    );
    assert.deepEqual(allUnknownLinks.map((r) => r.decision_id), [rejectedDecisionId]);

    const approvedFixture = await buildEvidenceClaim(orgA, "comm1-approved");
    const decisionId = await insertClaimDecision(orgA, approvedFixture.claimId, "approved", ["internal", "funder"]);
    const mixed = await assess(orgA, requirement.requirement_id);
    assert.equal(mixed.data.assessment_state, "partially_satisfied");
    assert.equal(mixed.data.replayed, false);

    const { rows: decisionLinks } = await pool.query(
      `SELECT claim_id::text AS claim_id, decision_id::text AS decision_id FROM kai.ra_claim_review_decision_links WHERE requirement_assessment_id = $1 ORDER BY claim_id`,
      [mixed.data.requirement_assessment_id],
    );
    assert.deepEqual(
      decisionLinks.sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1)),
      [
        { claim_id: rejectedFixture.claimId, decision_id: rejectedDecisionId },
        { claim_id: approvedFixture.claimId, decision_id: decisionId },
      ].sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1)),
    );

    const replay = await assess(orgA, requirement.requirement_id);
    assert.equal(replay.data.replayed, true);

    // Superseding the approved decision with a still-approved-but-different-
    // audience decision must change the fingerprint (new lineage head).
    const newDecisionId = await insertClaimDecision(orgA, approvedFixture.claimId, "approved", ["internal"], decisionId);
    const afterResupersede = await assess(orgA, requirement.requirement_id);
    assert.equal(afterResupersede.data.replayed, false);
    assert.equal(afterResupersede.data.assessment_state, "partially_satisfied");
    const { rows: newDecisionLinks } = await pool.query(
      `SELECT decision_id::text AS decision_id FROM kai.ra_claim_review_decision_links WHERE requirement_assessment_id = $1`,
      [afterResupersede.data.requirement_assessment_id],
    );
    assert.deepEqual(newDecisionLinks.map((r) => r.decision_id).sort(), [rejectedDecisionId, newDecisionId].sort());

    const current = await readCurrent(orgA, requirement.requirement_id);
    assert.equal(current.data.assessment.assessment_state, "partially_satisfied");
    assert.equal(await auditEventCount(orgA), 4);

    const crossTenant = await assess(orgB, requirement.requirement_id);
    assert.equal(crossTenant.data.assessment_state, "not_satisfied");
  });

  // =========================================================================
  // Cross-cutting: unsupported requirement still fails closed after adding
  // seven new dispatcher entries.
  // =========================================================================
  test("an unimplemented requirement (ir_pur_002) still fails closed with zero writes after C3.B3", async () => {
    const orgA = await makeOrgEngagement();
    const requirement = await makeRequirement("unsup1", "ir_pur_002");
    const before = await auditEventCount(orgA);
    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "unsupported_requirement");
    assert.equal(await countAssessmentRows(orgA, requirement.requirement_id), 0);
    assert.equal(await auditEventCount(orgA), before);
  });
}
