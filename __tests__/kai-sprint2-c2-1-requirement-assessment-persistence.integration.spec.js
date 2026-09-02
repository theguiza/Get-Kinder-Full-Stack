import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_C2_1_REQUIREMENT_ASSESSMENT_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`C2.1 requirement-assessment-persistence integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("C2.1 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("C2.1 integration requires the runner-owned database", { skip: true }, () => {});
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
  let sharedFrameworkVersionId;
  let sharedCriterionId;

  beforeEach(async () => {
    sharedFrameworkVersionId = undefined;
    sharedCriterionId = undefined;
    await pool.query(
      `TRUNCATE
         kai.requirement_assessment_evidence_links,
         kai.requirement_assessment_claim_links,
         kai.requirement_assessment_evaluation_result_links,
         kai.requirement_assessments,
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
         kai.impact_evaluation_result_evidence_links,
         kai.impact_evaluation_result_claim_links,
         kai.impact_evaluation_results,
         kai.impact_evaluations,
         kai.impact_outcome_contexts,
         kai.impact_evaluation_criteria,
         kai.impact_evaluation_framework_versions,
         kai.engagement_requirement_sets,
         kai.requirements,
         kai.requirement_sets,
         kai.requirement_framework_versions,
         kai.requirement_sources
       RESTART IDENTITY CASCADE`,
    );
    await pool.query("TRUNCATE kai.engagements, kai.organizations RESTART IDENTITY CASCADE");

    const orgs = await pool.query(
      "INSERT INTO kai.organizations (name) VALUES ('C2.1 Org A'), ('C2.1 Org B') RETURNING organization_id",
    );
    [orgA, orgB] = orgs.rows.map((r) => r.organization_id);

    const engagements = await pool.query(
      "INSERT INTO kai.engagements (organization_id, engagement_code) VALUES ($1, 'eng-a'), ($2, 'eng-b') RETURNING engagement_id",
      [orgA, orgB],
    );
    [engagementA, engagementB] = engagements.rows.map((r) => r.engagement_id);
  });

  // ---------------------------------------------------------------------
  // B1.1 requirement-catalogue fixture: a real, minimal
  // source -> framework version -> set -> requirement chain. kai.requirements
  // carries no organization_id of its own (B1.1 shared/organization
  // catalogue data), so one requirement row can be reused across tenants.
  // ---------------------------------------------------------------------
  async function makeRequirement(keySuffix) {
    const suffix = `${keySuffix}_${Math.random().toString(36).slice(2)}`;
    const source = (
      await pool.query(
        "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('kai_standard', $1, 'C2.1 Fixture Source') RETURNING requirement_source_id",
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

  // ---------------------------------------------------------------------
  // Evidence/claim provenance fixture: a real, minimal
  // intake_file -> parser_run -> file_profile -> data_dictionary(+field) ->
  // sensitivity_profile -> source_candidate -> promoted source/source_version
  // -> source_locator -> evidence_item -> claim chain, hand-written against
  // the exact Gate A/P1/P2-01/P2-03 schema (not the shared smoke-seed .sql
  // files, which only cover one fixed org). Built once per (org, suffix).
  // ---------------------------------------------------------------------
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

    await pool.query(
      `INSERT INTO kai.intake_promotion_decisions (organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type, decision_status, source_id, source_version_id, promoted_at, created_by_type)
       VALUES ($1, $2, $3, 'organization_primary_record', 'promoted', $4, $5, now(), 'human')`,
      [organizationId, candidateId, reviewItemId, sourceId, sourceVersionId],
    );

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

    return { evidenceItemId, claimId };
  }

  // ---------------------------------------------------------------------
  // Impact Evaluation result provenance fixture: a real, minimal
  // outcome_context -> (shared framework_version/criterion) -> evaluation ->
  // result chain, hand-written against the exact A1.1-A1.3 schema.
  // ---------------------------------------------------------------------
  async function ensureSharedImpactFramework() {
    if (sharedFrameworkVersionId) return;
    sharedFrameworkVersionId = (
      await pool.query(
        `INSERT INTO kai.impact_evaluation_framework_versions (framework_code, framework_name, version_label, framework_status)
         VALUES ('c2_1_fixture', 'C2.1 Fixture Framework', 'v1', 'active') RETURNING framework_version_id`,
      )
    ).rows[0].framework_version_id;
    sharedCriterionId = (
      await pool.query(
        `INSERT INTO kai.impact_evaluation_criteria (framework_version_id, criterion_key, criterion_label, description, evaluation_guidance, display_order)
         VALUES ($1, 'what', 'What changed', 'What outcome changed.', 'Assess outcome.', 0) RETURNING criterion_id`,
        [sharedFrameworkVersionId],
      )
    ).rows[0].criterion_id;
  }

  async function buildImpactEvaluationResultFixture(organizationId, engagementId, suffix) {
    await ensureSharedImpactFramework();
    const outcomeContextId = (
      await pool.query(
        `INSERT INTO kai.impact_outcome_contexts (organization_id, engagement_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label)
         VALUES ($1, $2, $3, 'Participants achieve the outcome.', 'participants', 'Participants') RETURNING impact_outcome_context_id`,
        [organizationId, engagementId, `outcome_${suffix.toLowerCase()}`],
      )
    ).rows[0].impact_outcome_context_id;

    const impactEvaluationId = (
      await pool.query(
        `INSERT INTO kai.impact_evaluations (organization_id, impact_outcome_context_id, framework_version_id, created_by_type)
         VALUES ($1, $2, $3, 'system') RETURNING impact_evaluation_id`,
        [organizationId, outcomeContextId, sharedFrameworkVersionId],
      )
    ).rows[0].impact_evaluation_id;

    const resultId = (
      await pool.query(
        `INSERT INTO kai.impact_evaluation_results (organization_id, impact_evaluation_id, framework_version_id, criterion_id, assessment_state, safe_explanation)
         VALUES ($1, $2, $3, $4, 'supported', 'Evidence supports this criterion.') RETURNING impact_evaluation_result_id`,
        [organizationId, impactEvaluationId, sharedFrameworkVersionId, sharedCriterionId],
      )
    ).rows[0].impact_evaluation_result_id;

    return { impactEvaluationResultId: resultId };
  }

  async function insertAssessment({ organizationId, engagementId, requirementId, state, explanation, fingerprint }) {
    return pool.query(
      `INSERT INTO kai.requirement_assessments
         (organization_id, engagement_id, requirement_id, assessment_state, assessment_explanation, state_fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING requirement_assessment_id`,
      [organizationId, engagementId, requirementId, state, explanation, fingerprint],
    );
  }

  test("forward migration produced all four canonical C2.1 tables", async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'kai' AND table_name IN
       ('requirement_assessments', 'requirement_assessment_evidence_links', 'requirement_assessment_claim_links', 'requirement_assessment_evaluation_result_links')`,
    );
    assert.deepEqual(
      rows.map((r) => r.table_name).sort(),
      [
        "requirement_assessment_claim_links",
        "requirement_assessment_evaluation_result_links",
        "requirement_assessment_evidence_links",
        "requirement_assessments",
      ].sort(),
    );
  });

  test("1: a valid assessment succeeds", async () => {
    const requirement = await makeRequirement("t1");
    const fingerprint = sha256hex("t1-fingerprint");
    const result = await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "The requirement is satisfied by governed evidence.",
      fingerprint,
    });
    assert.ok(result.rows[0].requirement_assessment_id);
  });

  test("1b: an organization-level assessment (engagement_id NULL) succeeds", async () => {
    const requirement = await makeRequirement("t1b");
    const fingerprint = sha256hex("t1b-fingerprint");
    const result = await insertAssessment({
      organizationId: orgA,
      engagementId: null,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "Organization-level assessment.",
      fingerprint,
    });
    assert.ok(result.rows[0].requirement_assessment_id);
    const { rows } = await pool.query(
      `SELECT engagement_id FROM kai.requirement_assessments WHERE requirement_assessment_id = $1`,
      [result.rows[0].requirement_assessment_id],
    );
    assert.equal(rows[0].engagement_id, null);
  });

  test("1c: all four valid assessment_state values succeed", async () => {
    const requirement = await makeRequirement("t1c");
    for (const state of ["satisfied", "partially_satisfied", "not_satisfied", "needs_review"]) {
      const result = await insertAssessment({
        organizationId: orgA,
        engagementId: engagementA,
        requirementId: requirement.requirement_id,
        state,
        explanation: `Assessment state ${state}.`,
        fingerprint: sha256hex(`t1c-${state}`),
      });
      assert.ok(result.rows[0].requirement_assessment_id, `expected ${state} to succeed`);
    }
  });

  test("2: an invalid (non-existent) requirement fails", async () => {
    await assert.rejects(
      insertAssessment({
        organizationId: orgA,
        engagementId: engagementA,
        requirementId: "99999999-0000-4000-8000-000000000099",
        state: "satisfied",
        explanation: "Bogus requirement.",
        fingerprint: sha256hex("t2-fingerprint"),
      }),
    );
  });

  test("3a: cross-tenant engagement binding fails", async () => {
    const requirement = await makeRequirement("t3a");
    await assert.rejects(
      insertAssessment({
        organizationId: orgA,
        engagementId: engagementB,
        requirementId: requirement.requirement_id,
        state: "satisfied",
        explanation: "Cross-tenant engagement.",
        fingerprint: sha256hex("t3a-fingerprint"),
      }),
    );
  });

  test("3b: cross-tenant evidence-link binding fails", async () => {
    const requirement = await makeRequirement("t3b");
    const assessment = await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "Same-tenant assessment.",
      fingerprint: sha256hex("t3b-fingerprint"),
    });
    const assessmentId = assessment.rows[0].requirement_assessment_id;
    const { evidenceItemId } = await buildEvidenceClaimFixture(orgB, "t3b_orgB");
    await assert.rejects(
      pool.query(
        `INSERT INTO kai.requirement_assessment_evidence_links (organization_id, requirement_assessment_id, evidence_item_id)
         VALUES ($1, $2, $3)`,
        [orgA, assessmentId, evidenceItemId],
      ),
    );
  });

  test("3c: cross-tenant claim-link binding fails", async () => {
    const requirement = await makeRequirement("t3c");
    const assessment = await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "Same-tenant assessment.",
      fingerprint: sha256hex("t3c-fingerprint"),
    });
    const assessmentId = assessment.rows[0].requirement_assessment_id;
    const { claimId } = await buildEvidenceClaimFixture(orgB, "t3c_orgB");
    await assert.rejects(
      pool.query(
        `INSERT INTO kai.requirement_assessment_claim_links (organization_id, requirement_assessment_id, claim_id)
         VALUES ($1, $2, $3)`,
        [orgA, assessmentId, claimId],
      ),
    );
  });

  test("3d: cross-tenant evaluation-result-link binding fails", async () => {
    const requirement = await makeRequirement("t3d");
    const assessment = await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "Same-tenant assessment.",
      fingerprint: sha256hex("t3d-fingerprint"),
    });
    const assessmentId = assessment.rows[0].requirement_assessment_id;
    const { impactEvaluationResultId } = await buildImpactEvaluationResultFixture(orgB, engagementB, "t3d_orgB");
    await assert.rejects(
      pool.query(
        `INSERT INTO kai.requirement_assessment_evaluation_result_links (organization_id, requirement_assessment_id, impact_evaluation_result_id)
         VALUES ($1, $2, $3)`,
        [orgA, assessmentId, impactEvaluationResultId],
      ),
    );
  });

  test("4: each supported provenance type succeeds independently (evidence-only, claim-only, evaluation-result-only)", async () => {
    const requirement = await makeRequirement("t4");

    const evidenceOnly = await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "Evidence-only assessment.",
      fingerprint: sha256hex("t4-evidence-only"),
    });
    const { evidenceItemId } = await buildEvidenceClaimFixture(orgA, "t4_evidence");
    const evidenceLink = await pool.query(
      `INSERT INTO kai.requirement_assessment_evidence_links (organization_id, requirement_assessment_id, evidence_item_id)
       VALUES ($1, $2, $3) RETURNING requirement_assessment_evidence_link_id`,
      [orgA, evidenceOnly.rows[0].requirement_assessment_id, evidenceItemId],
    );
    assert.ok(evidenceLink.rows[0].requirement_assessment_evidence_link_id);

    const claimOnly = await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "Claim-only assessment.",
      fingerprint: sha256hex("t4-claim-only"),
    });
    const { claimId } = await buildEvidenceClaimFixture(orgA, "t4_claim");
    const claimLink = await pool.query(
      `INSERT INTO kai.requirement_assessment_claim_links (organization_id, requirement_assessment_id, claim_id)
       VALUES ($1, $2, $3) RETURNING requirement_assessment_claim_link_id`,
      [orgA, claimOnly.rows[0].requirement_assessment_id, claimId],
    );
    assert.ok(claimLink.rows[0].requirement_assessment_claim_link_id);

    const evaluationResultOnly = await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "Evaluation-result-only assessment.",
      fingerprint: sha256hex("t4-evaluation-result-only"),
    });
    const { impactEvaluationResultId } = await buildImpactEvaluationResultFixture(orgA, engagementA, "t4_result");
    const resultLink = await pool.query(
      `INSERT INTO kai.requirement_assessment_evaluation_result_links (organization_id, requirement_assessment_id, impact_evaluation_result_id)
       VALUES ($1, $2, $3) RETURNING requirement_assessment_evaluation_result_link_id`,
      [orgA, evaluationResultOnly.rows[0].requirement_assessment_id, impactEvaluationResultId],
    );
    assert.ok(resultLink.rows[0].requirement_assessment_evaluation_result_link_id);
  });

  test("5: mixed same-tenant provenance succeeds (evidence + claim + evaluation-result together)", async () => {
    const requirement = await makeRequirement("t5");
    const assessment = await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "Mixed-provenance assessment.",
      fingerprint: sha256hex("t5-fingerprint"),
    });
    const assessmentId = assessment.rows[0].requirement_assessment_id;

    const { evidenceItemId, claimId } = await buildEvidenceClaimFixture(orgA, "t5_evidence_claim");
    const { impactEvaluationResultId } = await buildImpactEvaluationResultFixture(orgA, engagementA, "t5_result");

    await pool.query(
      `INSERT INTO kai.requirement_assessment_evidence_links (organization_id, requirement_assessment_id, evidence_item_id) VALUES ($1, $2, $3)`,
      [orgA, assessmentId, evidenceItemId],
    );
    await pool.query(
      `INSERT INTO kai.requirement_assessment_claim_links (organization_id, requirement_assessment_id, claim_id) VALUES ($1, $2, $3)`,
      [orgA, assessmentId, claimId],
    );
    await pool.query(
      `INSERT INTO kai.requirement_assessment_evaluation_result_links (organization_id, requirement_assessment_id, impact_evaluation_result_id) VALUES ($1, $2, $3)`,
      [orgA, assessmentId, impactEvaluationResultId],
    );

    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM kai.requirement_assessment_evidence_links WHERE requirement_assessment_id = $1) AS evidence_links,
         (SELECT count(*)::int FROM kai.requirement_assessment_claim_links WHERE requirement_assessment_id = $1) AS claim_links,
         (SELECT count(*)::int FROM kai.requirement_assessment_evaluation_result_links WHERE requirement_assessment_id = $1) AS result_links`,
      [assessmentId],
    );
    assert.deepEqual(rows[0], { evidence_links: 1, claim_links: 1, result_links: 1 });
  });

  test("6: historical reassessment coexists with the earlier record", async () => {
    const requirement = await makeRequirement("t6");
    const fingerprint1 = sha256hex("t6-fingerprint-1");
    const fingerprint2 = sha256hex("t6-fingerprint-2");

    await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "not_satisfied",
      explanation: "Initial assessment: not yet satisfied.",
      fingerprint: fingerprint1,
    });
    await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "Reassessment: now satisfied.",
      fingerprint: fingerprint2,
    });

    const { rows } = await pool.query(
      `SELECT state_fingerprint, assessment_state FROM kai.requirement_assessments
       WHERE organization_id = $1 AND engagement_id = $2 AND requirement_id = $3
       ORDER BY created_at`,
      [orgA, engagementA, requirement.requirement_id],
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => [r.state_fingerprint, r.assessment_state]),
      [
        [fingerprint1, "not_satisfied"],
        [fingerprint2, "satisfied"],
      ],
    );
  });

  test("7: the earlier assessment remains unchanged - UPDATE and DELETE are both rejected (append-only)", async () => {
    const requirement = await makeRequirement("t7");
    const fingerprint1 = sha256hex("t7-fingerprint-1");
    const fingerprint2 = sha256hex("t7-fingerprint-2");

    await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "not_satisfied",
      explanation: "Initial assessment: not yet satisfied.",
      fingerprint: fingerprint1,
    });
    await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "Reassessment: now satisfied.",
      fingerprint: fingerprint2,
    });

    await assert.rejects(
      pool.query(`UPDATE kai.requirement_assessments SET assessment_state = 'not_satisfied' WHERE state_fingerprint = $1`, [fingerprint1]),
      /append-only/,
    );
    await assert.rejects(
      pool.query(`DELETE FROM kai.requirement_assessments WHERE state_fingerprint = $1`, [fingerprint1]),
      /append-only/,
    );

    const { rows } = await pool.query(`SELECT assessment_state FROM kai.requirement_assessments WHERE state_fingerprint = $1`, [fingerprint1]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].assessment_state, "not_satisfied");
  });

  test("8: an invalid assessment_state fails, including the excluded P2-02 vocabulary and not_applicable", async () => {
    const requirement = await makeRequirement("t8");
    for (const [suffix, state] of [
      ["bogus", "bogus"],
      ["p2-02-vocabulary", "SUPPORTED_INPUT_EXISTS"],
      ["p2-02-vocabulary-2", "PARTIAL_INPUT_EXISTS"],
      ["p2-02-vocabulary-3", "NO_CURRENT_INPUT"],
      ["not-applicable", "not_applicable"],
    ]) {
      await assert.rejects(
        insertAssessment({
          organizationId: orgA,
          engagementId: engagementA,
          requirementId: requirement.requirement_id,
          state,
          explanation: "Invalid state must be rejected.",
          fingerprint: sha256hex(`t8-${suffix}`),
        }),
        `expected state "${state}" to be rejected`,
      );
    }
  });

  test("10: identical organization-scope fingerprint replay fails; a different organization-scope fingerprint reassessment succeeds", async () => {
    const requirement = await makeRequirement("t10");
    const fingerprint = sha256hex("t10-fingerprint");
    await insertAssessment({
      organizationId: orgA,
      engagementId: null,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "First organization-level assessment.",
      fingerprint,
    });
    await assert.rejects(
      insertAssessment({
        organizationId: orgA,
        engagementId: null,
        requirementId: requirement.requirement_id,
        state: "satisfied",
        explanation: "Identical-fingerprint replay must be rejected.",
        fingerprint,
      }),
    );
    const reassessment = await insertAssessment({
      organizationId: orgA,
      engagementId: null,
      requirementId: requirement.requirement_id,
      state: "not_satisfied",
      explanation: "Different-fingerprint reassessment must succeed.",
      fingerprint: sha256hex("t10-fingerprint-2"),
    });
    assert.ok(reassessment.rows[0].requirement_assessment_id);
  });

  test("11: identical engagement-scope fingerprint replay fails; a different engagement-scope fingerprint reassessment succeeds", async () => {
    const requirement = await makeRequirement("t11");
    const fingerprint = sha256hex("t11-fingerprint");
    await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "First engagement-level assessment.",
      fingerprint,
    });
    await assert.rejects(
      insertAssessment({
        organizationId: orgA,
        engagementId: engagementA,
        requirementId: requirement.requirement_id,
        state: "satisfied",
        explanation: "Identical-fingerprint replay must be rejected.",
        fingerprint,
      }),
    );
    const reassessment = await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "not_satisfied",
      explanation: "Different-fingerprint reassessment must succeed.",
      fingerprint: sha256hex("t11-fingerprint-2"),
    });
    assert.ok(reassessment.rows[0].requirement_assessment_id);
  });

  test("12: an organization-scope fingerprint and an equal-valued engagement-scope fingerprint do not collide (scopes are independent)", async () => {
    const requirement = await makeRequirement("t12");
    const fingerprint = sha256hex("t12-fingerprint");
    const orgLevel = await insertAssessment({
      organizationId: orgA,
      engagementId: null,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "Organization-level assessment.",
      fingerprint,
    });
    const engagementLevel = await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "Engagement-level assessment with the same fingerprint value.",
      fingerprint,
    });
    assert.ok(orgLevel.rows[0].requirement_assessment_id);
    assert.ok(engagementLevel.rows[0].requirement_assessment_id);
  });

  test("9: the underlying requirement definition (B1.1 catalogue data) remains unchanged across assessments/reassessments", async () => {
    const requirement = await makeRequirement("t9");
    const before = (
      await pool.query(`SELECT * FROM kai.requirements WHERE requirement_id = $1`, [requirement.requirement_id])
    ).rows[0];

    await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "not_satisfied",
      explanation: "Initial assessment.",
      fingerprint: sha256hex("t9-fingerprint-1"),
    });
    await insertAssessment({
      organizationId: orgA,
      engagementId: engagementA,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "Reassessment.",
      fingerprint: sha256hex("t9-fingerprint-2"),
    });
    await insertAssessment({
      organizationId: orgB,
      engagementId: engagementB,
      requirementId: requirement.requirement_id,
      state: "satisfied",
      explanation: "A different tenant assessing the same shared requirement.",
      fingerprint: sha256hex("t9-fingerprint-3"),
    });

    const after = (
      await pool.query(`SELECT * FROM kai.requirements WHERE requirement_id = $1`, [requirement.requirement_id])
    ).rows[0];
    assert.deepEqual(after, before);
  });
}
