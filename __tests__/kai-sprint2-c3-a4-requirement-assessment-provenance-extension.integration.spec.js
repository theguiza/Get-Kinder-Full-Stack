import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_C3_A4_PROVENANCE_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`C3.A4 provenance integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("C3.A4 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("C3.A4 integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runIntegrationSuite();
}

function sha256hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function runIntegrationSuite() {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false });
  after(async () => {
    await pool.end();
  });

  let orgA;
  let orgB;
  let engagementA;
  let engagementB;

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE
         kai.ra_outcome_context_links,
         kai.ra_source_promotion_links,
         kai.ra_conflict_resolution_links,
         kai.ra_gap_links,
         kai.ra_claim_review_decision_links,
         kai.ra_evidence_review_decision_links,
         kai.claim_review_decisions,
         kai.evidence_review_decisions,
         kai.gap_log_items,
         kai.conflict_groups,
         kai.requirement_assessment_evidence_links,
         kai.requirement_assessment_claim_links,
         kai.requirement_assessments,
         kai.impact_outcome_contexts,
         kai.claims,
         kai.evidence_items,
         kai.source_locators,
         kai.intake_promotion_decisions,
         kai.source_versions,
         kai.sources,
         kai.review_queue_items,
         kai.intake_source_candidates,
         kai.intake_sensitivity_profiles,
         kai.data_dictionary_fields,
         kai.data_dictionaries,
         kai.intake_file_profiles,
         kai.intake_parser_runs,
         kai.intake_files,
         kai.requirements,
         kai.requirement_sets,
         kai.requirement_framework_versions,
         kai.requirement_sources
       RESTART IDENTITY CASCADE`,
    );
    await pool.query("TRUNCATE kai.engagements, kai.organizations RESTART IDENTITY CASCADE");

    const orgs = await pool.query(
      "INSERT INTO kai.organizations (name) VALUES ('C3.A4 Org A'), ('C3.A4 Org B') RETURNING organization_id",
    );
    [orgA, orgB] = orgs.rows.map((r) => r.organization_id);

    const engagements = await pool.query(
      "INSERT INTO kai.engagements (organization_id, engagement_code) VALUES ($1, 'eng-a'), ($2, 'eng-b') RETURNING engagement_id",
      [orgA, orgB],
    );
    [engagementA, engagementB] = engagements.rows.map((r) => r.engagement_id);
  });

  async function makeRequirement(keySuffix) {
    const suffix = `${keySuffix}_${Math.random().toString(36).slice(2)}`;
    const source = (
      await pool.query(
        "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('kai_standard', $1, 'C3.A4 Fixture Source') RETURNING requirement_source_id",
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
        [set, suffix],
      )
    ).rows[0];
    return requirement;
  }

  async function insertAssessment(organizationId, engagementId, requirementId, fingerprint) {
    return (
      await pool.query(
        `INSERT INTO kai.requirement_assessments
           (organization_id, engagement_id, requirement_id, assessment_state, assessment_explanation, state_fingerprint)
         VALUES ($1, $2, $3, 'satisfied', 'Fixture assessment.', $4)
         RETURNING requirement_assessment_id`,
        [organizationId, engagementId, requirementId, fingerprint],
      )
    ).rows[0].requirement_assessment_id;
  }

  async function insertOutcomeContext(organizationId, engagementId, suffix) {
    return (
      await pool.query(
        `INSERT INTO kai.impact_outcome_contexts
           (organization_id, engagement_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label, created_by_type)
         VALUES ($1, $2, $3, $4, $5, $6, 'human') RETURNING *`,
        [
          organizationId,
          engagementId,
          `outcome_${suffix}`,
          `Stakeholders achieve the intended change for ${suffix}.`,
          `stakeholder_${suffix}`,
          `Stakeholder ${suffix}`,
        ],
      )
    ).rows[0];
  }

  async function buildEvidenceClaimFixture(organizationId, suffix) {
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

  async function buildConflictFixture(organizationId, suffix) {
    const claimA = await buildEvidenceClaimFixture(organizationId, `${suffix}a`);
    const claimB = await buildEvidenceClaimFixture(organizationId, `${suffix}b`);
    const [lowerClaimId, higherClaimId] =
      claimA.claimId < claimB.claimId ? [claimA.claimId, claimB.claimId] : [claimB.claimId, claimA.claimId];
    const lowerFixture = lowerClaimId === claimA.claimId ? claimA : claimB;
    const higherFixture = higherClaimId === claimA.claimId ? claimA : claimB;

    const lowerGapId = (
      await pool.query(
        `INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary, created_by_type)
         VALUES ($1, $2, $3, $4, 'conflicting_source_indicators', 'unresolved', 'VAL-KAI-P2-02-conflicting_source_indicators', 'Claim gap requires review for dimension: conflicting_source_indicators.', 'system') RETURNING gap_log_item_id`,
        [organizationId, lowerClaimId, lowerFixture.evidenceItemId, lowerFixture.sourceVersionId],
      )
    ).rows[0].gap_log_item_id;

    const higherGapId = (
      await pool.query(
        `INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary, created_by_type)
         VALUES ($1, $2, $3, $4, 'conflicting_source_indicators', 'unresolved', 'VAL-KAI-P2-02-conflicting_source_indicators', 'Claim gap requires review for dimension: conflicting_source_indicators.', 'system') RETURNING gap_log_item_id`,
        [organizationId, higherClaimId, higherFixture.evidenceItemId, higherFixture.sourceVersionId],
      )
    ).rows[0].gap_log_item_id;

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

    return { conflictGroupId, lowerClaimId, higherClaimId };
  }

  test("forward migration produced exactly the three new C3.A4 tables", async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'kai' AND table_name IN
       ('ra_outcome_context_links', 'ra_source_promotion_links', 'ra_conflict_resolution_links')`,
    );
    assert.deepEqual(
      rows.map((r) => r.table_name).sort(),
      ["ra_outcome_context_links", "ra_source_promotion_links", "ra_conflict_resolution_links"].sort(),
    );
  });

  test("same-tenant outcome-context, source-promotion, and conflict-resolution links all succeed", async () => {
    const requirement = await makeRequirement("st1");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("st1"));

    const context = await insertOutcomeContext(orgA, engagementA, "st1");
    const outcomeLink = await pool.query(
      `INSERT INTO kai.ra_outcome_context_links
         (organization_id, requirement_assessment_id, impact_outcome_context_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ra_outcome_context_link_id`,
      [orgA, assessmentId, context.impact_outcome_context_id, context.outcome_key, context.outcome_statement, context.stakeholder_key, context.stakeholder_label],
    );
    assert.ok(outcomeLink.rows[0].ra_outcome_context_link_id);

    const fixture = await buildEvidenceClaimFixture(orgA, "st1");
    const sourcePromotionLink = await pool.query(
      `INSERT INTO kai.ra_source_promotion_links
         (organization_id, requirement_assessment_id, evidence_item_id, source_id, source_version_id, intake_source_candidate_id, intake_promotion_decision_id, is_current, decision_status, reviewed_source_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'promoted', 'organization_primary_record') RETURNING ra_source_promotion_link_id`,
      [orgA, assessmentId, fixture.evidenceItemId, fixture.sourceId, fixture.sourceVersionId, fixture.candidateId, fixture.promotionDecisionId],
    );
    assert.ok(sourcePromotionLink.rows[0].ra_source_promotion_link_id);

    const conflict = await buildConflictFixture(orgA, "st1");
    const conflictLink = await pool.query(
      `INSERT INTO kai.ra_conflict_resolution_links (organization_id, requirement_assessment_id, claim_id, conflict_group_id)
       VALUES ($1, $2, $3, $4) RETURNING ra_conflict_resolution_link_id`,
      [orgA, assessmentId, conflict.lowerClaimId, conflict.conflictGroupId],
    );
    assert.ok(conflictLink.rows[0].ra_conflict_resolution_link_id);
  });

  test("cross-tenant outcome-context link fails", async () => {
    const requirement = await makeRequirement("ct1");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("ct1"));
    const contextB = await insertOutcomeContext(orgB, engagementB, "ct1b");

    await assert.rejects(
      pool.query(
        `INSERT INTO kai.ra_outcome_context_links
           (organization_id, requirement_assessment_id, impact_outcome_context_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [orgA, assessmentId, contextB.impact_outcome_context_id, contextB.outcome_key, contextB.outcome_statement, contextB.stakeholder_key, contextB.stakeholder_label],
      ),
      // The BEFORE INSERT snapshot-verification trigger runs before the FK
      // constraint is checked, so a cross-tenant impact_outcome_context_id
      // is caught by the trigger's own tenant-scoped lookup rather than
      // surfacing as an FK violation - both are the same tenant-safety
      // guarantee (mirrors C3.A3's own gap-link cross-tenant proof).
      /(violates foreign key constraint|no kai\.impact_outcome_contexts row found)/,
    );
  });

  test("cross-tenant source-promotion link fails", async () => {
    const requirement = await makeRequirement("ct2");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("ct2"));
    const fixtureB = await buildEvidenceClaimFixture(orgB, "ct2b");

    await assert.rejects(
      pool.query(
        `INSERT INTO kai.ra_source_promotion_links
           (organization_id, requirement_assessment_id, evidence_item_id, source_id, source_version_id, intake_source_candidate_id, intake_promotion_decision_id, is_current, decision_status, reviewed_source_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'promoted', 'organization_primary_record')`,
        [orgA, assessmentId, fixtureB.evidenceItemId, fixtureB.sourceId, fixtureB.sourceVersionId, fixtureB.candidateId, fixtureB.promotionDecisionId],
      ),
      /(violates foreign key constraint|no kai\..* row found)/,
    );
  });

  test("cross-tenant conflict-resolution link fails", async () => {
    const requirement = await makeRequirement("ct3");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("ct3"));
    const conflictB = await buildConflictFixture(orgB, "ct3b");

    await assert.rejects(
      pool.query(
        `INSERT INTO kai.ra_conflict_resolution_links (organization_id, requirement_assessment_id, claim_id, conflict_group_id)
         VALUES ($1, $2, $3, $4)`,
        [orgA, assessmentId, conflictB.lowerClaimId, conflictB.conflictGroupId],
      ),
      // The BEFORE INSERT participation-verification trigger runs before
      // the FK constraint is checked, so a cross-tenant conflict_group_id
      // is caught by the trigger's own tenant-scoped lookup rather than
      // surfacing as an FK violation.
      /(violates foreign key constraint|no kai\.conflict_groups row found)/,
    );
  });

  test("duplicate links fail on all three tables", async () => {
    const requirement = await makeRequirement("dup1");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("dup1"));

    const context = await insertOutcomeContext(orgA, engagementA, "dup1");
    const insertOutcomeLink = () =>
      pool.query(
        `INSERT INTO kai.ra_outcome_context_links
           (organization_id, requirement_assessment_id, impact_outcome_context_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [orgA, assessmentId, context.impact_outcome_context_id, context.outcome_key, context.outcome_statement, context.stakeholder_key, context.stakeholder_label],
      );
    await insertOutcomeLink();
    await assert.rejects(insertOutcomeLink(), /duplicate key value violates unique constraint/);

    const fixture = await buildEvidenceClaimFixture(orgA, "dup1");
    const insertSourceLink = () =>
      pool.query(
        `INSERT INTO kai.ra_source_promotion_links
           (organization_id, requirement_assessment_id, evidence_item_id, source_id, source_version_id, intake_source_candidate_id, intake_promotion_decision_id, is_current, decision_status, reviewed_source_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'promoted', 'organization_primary_record')`,
        [orgA, assessmentId, fixture.evidenceItemId, fixture.sourceId, fixture.sourceVersionId, fixture.candidateId, fixture.promotionDecisionId],
      );
    await insertSourceLink();
    await assert.rejects(insertSourceLink(), /duplicate key value violates unique constraint/);

    const conflict = await buildConflictFixture(orgA, "dup1");
    const insertConflictLink = () =>
      pool.query(
        `INSERT INTO kai.ra_conflict_resolution_links (organization_id, requirement_assessment_id, claim_id, conflict_group_id)
         VALUES ($1, $2, $3, $4)`,
        [orgA, assessmentId, conflict.lowerClaimId, conflict.conflictGroupId],
      );
    await insertConflictLink();
    await assert.rejects(insertConflictLink(), /duplicate key value violates unique constraint/);
  });

  test("an outcome-context link snapshot that does not match the live row at insert time is rejected", async () => {
    const requirement = await makeRequirement("snap1");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("snap1"));
    const context = await insertOutcomeContext(orgA, engagementA, "snap1");

    await assert.rejects(
      pool.query(
        `INSERT INTO kai.ra_outcome_context_links
           (organization_id, requirement_assessment_id, impact_outcome_context_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label)
         VALUES ($1, $2, $3, $4, 'Wrong statement entirely.', $5, $6)`,
        [orgA, assessmentId, context.impact_outcome_context_id, context.outcome_key, context.stakeholder_key, context.stakeholder_label],
      ),
      /snapshot does not match/,
    );
  });

  test("a source-promotion link snapshot that does not match the live decision at insert time is rejected", async () => {
    const requirement = await makeRequirement("snap2");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("snap2"));
    const fixture = await buildEvidenceClaimFixture(orgA, "snap2");

    await assert.rejects(
      pool.query(
        `INSERT INTO kai.ra_source_promotion_links
           (organization_id, requirement_assessment_id, evidence_item_id, source_id, source_version_id, intake_source_candidate_id, intake_promotion_decision_id, is_current, decision_status, reviewed_source_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'rejected', 'organization_primary_record')`,
        [orgA, assessmentId, fixture.evidenceItemId, fixture.sourceId, fixture.sourceVersionId, fixture.candidateId, fixture.promotionDecisionId],
      ),
      /snapshot does not match/,
    );
  });

  test("a conflict-resolution link citing a claim that does not participate in the conflict_group is rejected", async () => {
    const requirement = await makeRequirement("part1");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("part1"));
    const conflict = await buildConflictFixture(orgA, "part1");
    const unrelated = await buildEvidenceClaimFixture(orgA, "part1x");

    await assert.rejects(
      pool.query(
        `INSERT INTO kai.ra_conflict_resolution_links (organization_id, requirement_assessment_id, claim_id, conflict_group_id)
         VALUES ($1, $2, $3, $4)`,
        [orgA, assessmentId, unrelated.claimId, conflict.conflictGroupId],
      ),
      /does not participate in conflict_group/,
    );
  });

  test("later live mutation of impact_outcome_contexts does not alter stored provenance, and the stored snapshot is append-only", async () => {
    const requirement = await makeRequirement("live1");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("live1"));
    const context = await insertOutcomeContext(orgA, engagementA, "live1");

    await pool.query(
      `INSERT INTO kai.ra_outcome_context_links
         (organization_id, requirement_assessment_id, impact_outcome_context_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orgA, assessmentId, context.impact_outcome_context_id, context.outcome_key, context.outcome_statement, context.stakeholder_key, context.stakeholder_label],
    );
    const before = (
      await pool.query(`SELECT * FROM kai.ra_outcome_context_links WHERE impact_outcome_context_id = $1`, [context.impact_outcome_context_id])
    ).rows[0];

    await pool.query(
      `UPDATE kai.impact_outcome_contexts SET outcome_statement = 'A materially different, later-edited outcome statement.' WHERE impact_outcome_context_id = $1`,
      [context.impact_outcome_context_id],
    );

    const after = (
      await pool.query(`SELECT * FROM kai.ra_outcome_context_links WHERE impact_outcome_context_id = $1`, [context.impact_outcome_context_id])
    ).rows[0];
    assert.deepEqual(after, before, "stored provenance snapshot must not change when the live outcome context is later edited");

    await assert.rejects(
      pool.query(`UPDATE kai.ra_outcome_context_links SET outcome_statement = 'tampered' WHERE impact_outcome_context_id = $1`, [context.impact_outcome_context_id]),
      /append-only/,
    );
    await assert.rejects(
      pool.query(`DELETE FROM kai.ra_outcome_context_links WHERE impact_outcome_context_id = $1`, [context.impact_outcome_context_id]),
      /append-only/,
    );
  });

  test("later live mutation of source_versions.is_current does not alter stored source-promotion provenance, and the stored snapshot is append-only", async () => {
    const requirement = await makeRequirement("live2");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("live2"));
    const fixture = await buildEvidenceClaimFixture(orgA, "live2");

    await pool.query(
      `INSERT INTO kai.ra_source_promotion_links
         (organization_id, requirement_assessment_id, evidence_item_id, source_id, source_version_id, intake_source_candidate_id, intake_promotion_decision_id, is_current, decision_status, reviewed_source_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'promoted', 'organization_primary_record')`,
      [orgA, assessmentId, fixture.evidenceItemId, fixture.sourceId, fixture.sourceVersionId, fixture.candidateId, fixture.promotionDecisionId],
    );
    const before = (
      await pool.query(`SELECT * FROM kai.ra_source_promotion_links WHERE evidence_item_id = $1`, [fixture.evidenceItemId])
    ).rows[0];

    // Simulate a later source_version being promoted, flipping this one's
    // is_current to false - exactly the currentness signal ir_data_001
    // itself must recompute freshly, while this historical citation stays
    // reproducible.
    await pool.query(`UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1`, [fixture.sourceVersionId]);

    const after = (
      await pool.query(`SELECT * FROM kai.ra_source_promotion_links WHERE evidence_item_id = $1`, [fixture.evidenceItemId])
    ).rows[0];
    assert.deepEqual(after, before, "stored provenance snapshot must not change when live source_versions state later diverges");

    await assert.rejects(
      pool.query(`UPDATE kai.ra_source_promotion_links SET is_current = false WHERE evidence_item_id = $1`, [fixture.evidenceItemId]),
      /append-only/,
    );
    await assert.rejects(
      pool.query(`DELETE FROM kai.ra_source_promotion_links WHERE evidence_item_id = $1`, [fixture.evidenceItemId]),
      /append-only/,
    );
  });

  test("conflict-resolution links are immutable-object bare links: no append-only trigger fires because conflict_groups itself is insert-only", async () => {
    const requirement = await makeRequirement("cg1");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("cg1"));
    const conflict = await buildConflictFixture(orgA, "cg1");

    await pool.query(
      `INSERT INTO kai.ra_conflict_resolution_links (organization_id, requirement_assessment_id, claim_id, conflict_group_id)
       VALUES ($1, $2, $3, $4)`,
      [orgA, assessmentId, conflict.higherClaimId, conflict.conflictGroupId],
    );
    const link = (
      await pool.query(`SELECT * FROM kai.ra_conflict_resolution_links WHERE conflict_group_id = $1`, [conflict.conflictGroupId])
    ).rows[0];
    assert.equal(link.claim_id, conflict.higherClaimId);
  });

  test("rollback removes only the three new C3.A4 objects and leaves every prerequisite (including C2.1/C3.A3 provenance) intact", async () => {
    const requirement = await makeRequirement("rb1");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("rb1"));
    const context = await insertOutcomeContext(orgA, engagementA, "rb1");

    await pool.query(
      `INSERT INTO kai.ra_outcome_context_links
         (organization_id, requirement_assessment_id, impact_outcome_context_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orgA, assessmentId, context.impact_outcome_context_id, context.outcome_key, context.outcome_statement, context.stakeholder_key, context.stakeholder_label],
    );

    // Existing C2.1 provenance, written before rollback, to prove it survives.
    const fixture = await buildEvidenceClaimFixture(orgA, "rb1");
    await pool.query(
      `INSERT INTO kai.requirement_assessment_evidence_links (organization_id, requirement_assessment_id, evidence_item_id) VALUES ($1, $2, $3)`,
      [orgA, assessmentId, fixture.evidenceItemId],
    );

    const { readFileSync } = await import("node:fs");
    const rollbackSql = readFileSync(
      "migrations/kai_sprint2_c3_a4_requirement_assessment_provenance_extension.rollback.sql",
      "utf8",
    );
    await pool.query(rollbackSql);

    const remaining = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'kai' AND table_name IN
       ('ra_outcome_context_links', 'ra_source_promotion_links', 'ra_conflict_resolution_links')`,
    );
    assert.equal(remaining.rows.length, 0, "rollback must remove all three new C3.A4 tables");

    const prerequisites = await pool.query(`
      SELECT
        to_regclass('kai.requirement_assessments') AS requirement_assessments,
        to_regclass('kai.impact_outcome_contexts') AS impact_outcome_contexts,
        to_regclass('kai.evidence_items') AS evidence_items,
        to_regclass('kai.source_versions') AS source_versions,
        to_regclass('kai.intake_promotion_decisions') AS intake_promotion_decisions,
        to_regclass('kai.claims') AS claims,
        to_regclass('kai.conflict_groups') AS conflict_groups,
        to_regclass('kai.review_queue_items') AS review_queue_items,
        to_regclass('kai.ra_gap_links') AS ra_gap_links,
        to_regclass('kai.requirement_assessment_evidence_links') AS evidence_links
    `);
    for (const [name, value] of Object.entries(prerequisites.rows[0])) {
      assert.ok(value, `rollback must not remove prerequisite object: kai.${name}`);
    }

    const existingLinks = await pool.query(
      `SELECT count(*)::int AS n FROM kai.requirement_assessment_evidence_links WHERE requirement_assessment_id = $1`,
      [assessmentId],
    );
    assert.equal(existingLinks.rows[0].n, 1, "existing C2.1 evidence provenance row must survive rollback");

    // Re-apply the forward migration so later tests in this process see the
    // schema restored, mirroring the C3.A3 precedent's own single-shot
    // rollback proof.
    const { spawnSync } = await import("node:child_process");
    const binDir = process.env.PG_BIN_DIR || "/opt/homebrew/opt/postgresql@16/bin";
    const url = new URL(RUNNER_OWNED_DATABASE_URL);
    spawnSync(`${binDir}/psql`, [
      "-h", url.hostname, "-p", url.port, "-d", url.pathname.slice(1),
      "-v", "ON_ERROR_STOP=1",
      "-f", "migrations/kai_sprint2_c3_a4_requirement_assessment_provenance_extension.sql",
    ], { encoding: "utf8" });
  });
}
