import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_C3_A2_FIRST_REQUIREMENT_ASSESSMENT_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`C3.A2 first-requirement-assessment integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("C3.A2 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("C3.A2 integration requires the runner-owned database", { skip: true }, () => {});
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
  const { SUPPORTED_REQUIREMENT_KEY } = await import(
    "../Backend/kai/validators/kaiRequirementAssessmentValidators.js"
  );

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
      organizationMemberships: [
        { organization_id: organizationId, role_name: role, membership_status: "active" },
      ],
    };
  }

  const trueEnv = { KAI_SPRINT2_ENABLED: "true" };
  const falseEnv = {};

  let orgA;
  let orgB;

  beforeEach(async () => {
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
         kai.requirements,
         kai.requirement_sets,
         kai.requirement_framework_versions,
         kai.requirement_sources,
         kai.audit_events
       RESTART IDENTITY CASCADE`,
    );
    await pool.query("TRUNCATE kai.engagements, kai.organizations RESTART IDENTITY CASCADE");

    const orgs = await pool.query(
      "INSERT INTO kai.organizations (name) VALUES ('C3.A2 Org A'), ('C3.A2 Org B') RETURNING organization_id",
    );
    [orgA, orgB] = orgs.rows.map((r) => r.organization_id);
  });

  // ---------------------------------------------------------------------
  // Requirement fixture: a real source -> framework version -> set ->
  // requirement chain. `key` defaults to the one supported requirement_key
  // (ir_contrib_002); pass a different key to build the "another requirement
  // fails closed" fixture.
  // ---------------------------------------------------------------------
  async function makeRequirement(keySuffix, key = SUPPORTED_REQUIREMENT_KEY) {
    const suffix = `${keySuffix}_${Math.random().toString(36).slice(2)}`;
    const source = (
      await pool.query(
        "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('kai_standard', $1, 'C3.A2 Fixture Source') RETURNING requirement_source_id",
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

  // ---------------------------------------------------------------------
  // Evidence/claim provenance fixture: a real, minimal
  // intake_file -> parser_run -> file_profile -> data_dictionary(+field) ->
  // sensitivity_profile -> source_candidate -> promoted source/source_version
  // -> source_locator -> evidence_item -> claim chain, parameterized on
  // support_strength/claim_strength so tests can construct every governed-
  // state combination the N/R rule depends on.
  // ---------------------------------------------------------------------
  async function buildEvidenceClaim(organizationId, suffix, { supportStrength = "unassessed", claimStrength = "unassessed" } = {}) {
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
         VALUES ($1, $2, $3, $4, 'dictionary_field_presence_fact', 'organization_committed_metadata', 'unknown', $5, 'Signup count field is present.', $6, 'system') RETURNING evidence_item_id`,
        [organizationId, sourceId, sourceVersionId, sourceLocatorId, supportStrength, statementFingerprint],
      )
    ).rows[0].evidence_item_id;

    const claimId = (
      await pool.query(
        `INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
         VALUES ($1, $2, 'finding', 'proposed', 'needs_gk_review', $3, 'Signups were recorded.', $4, 'system') RETURNING claim_id`,
        [organizationId, evidenceItemId, claimStrength, claimFingerprint],
      )
    ).rows[0].claim_id;

    return { evidenceItemId, claimId };
  }

  async function countRows(table, organizationId, requirementId) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.${table} WHERE organization_id = $1 AND requirement_id = $2`,
      [organizationId, requirementId],
    );
    return rows[0].n;
  }

  async function auditEventCount(organizationId) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.audit_events WHERE organization_id = $1`,
      [organizationId],
    );
    return rows[0].n;
  }

  // Scenario 1: a valid governed evidence/claim state succeeds and produces
  // one of the four states correctly.
  test("1: ir_contrib_002 succeeds for an organization with a real, valid governed evidence/claim state", async () => {
    const requirement = await makeRequirement("s1");
    await buildEvidenceClaim(orgA, "s1a", { supportStrength: "reviewed_supported", claimStrength: "unassessed" });
    const result = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(result.ok, true);
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.assessment_state, "partially_satisfied");
  });

  // Scenario 2: a different real requirement_id fails closed with
  // unsupported_requirement, zero rows written anywhere.
  test("2: a different requirement_key fails closed (unsupported_requirement), zero rows written", async () => {
    const otherRequirement = await makeRequirement("s2", "ir_pur_001");
    const before = await auditEventCount(orgA);
    const result = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: otherRequirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "unsupported_requirement");
    assert.equal(await countRows("requirement_assessments", orgA, otherRequirement.requirement_id), 0);
    const { rows: evidenceLinks } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.requirement_assessment_evidence_links WHERE organization_id = $1`,
      [orgA],
    );
    assert.equal(evidenceLinks[0].n, 0);
    assert.equal(await auditEventCount(orgA), before);
  });

  // Scenario 3: all four assessment_state outcomes.
  test("3a: N = 0 -> not_satisfied", async () => {
    const requirement = await makeRequirement("s3a");
    const result = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(result.ok, true);
    assert.equal(result.data.assessment_state, "not_satisfied");
    assert.equal(result.data.assessment_explanation, "0 of 0 governed evidence/claim items for this organization have a documented review outcome (support_strength or claim_strength other than 'unassessed').");
  });

  test("3b: N > 0, R = 0 -> needs_review", async () => {
    const requirement = await makeRequirement("s3b");
    await buildEvidenceClaim(orgA, "s3b", { supportStrength: "unassessed", claimStrength: "unassessed" });
    const result = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(result.ok, true);
    assert.equal(result.data.assessment_state, "needs_review");
  });

  test("3c: N > 0, 0 < R < N -> partially_satisfied", async () => {
    const requirement = await makeRequirement("s3c");
    await buildEvidenceClaim(orgA, "s3c", { supportStrength: "reviewed_supported", claimStrength: "unassessed" });
    const result = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(result.ok, true);
    assert.equal(result.data.assessment_state, "partially_satisfied");
  });

  test("3d: N > 0, R = N -> satisfied", async () => {
    const requirement = await makeRequirement("s3d");
    await buildEvidenceClaim(orgA, "s3d", { supportStrength: "reviewed_supported", claimStrength: "reviewed_not_supported" });
    const result = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(result.ok, true);
    assert.equal(result.data.assessment_state, "satisfied");
  });

  // Scenario 4: the N/R counts in assessment_explanation exactly match the
  // counts actually present for that org at that time.
  test("4: assessment_explanation's N/R counts exactly match this organization's actual current counts", async () => {
    const requirement = await makeRequirement("s4");
    await buildEvidenceClaim(orgA, "s4a", { supportStrength: "reviewed_supported", claimStrength: "unassessed" });
    await buildEvidenceClaim(orgA, "s4b", { supportStrength: "unassessed", claimStrength: "unassessed" });
    // Other org's data must never be counted.
    await buildEvidenceClaim(orgB, "s4c", { supportStrength: "reviewed_supported", claimStrength: "reviewed_supported" });
    const result = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(result.ok, true);
    // orgA has 2 evidence + 2 claims = N=4, R=1 (only the s4a evidence item reviewed).
    assert.equal(result.data.assessment_explanation, "1 of 4 governed evidence/claim items for this organization have a documented review outcome (support_strength or claim_strength other than 'unassessed').");
  });

  // Scenario 5: exactly one provenance link row per evidence_item/claim
  // actually read for that org+assessment - no more, no fewer.
  test("5: exactly one evidence-link/claim-link row per evidence_item/claim actually read", async () => {
    const requirement = await makeRequirement("s5");
    const first = await buildEvidenceClaim(orgA, "s5a", { supportStrength: "reviewed_supported", claimStrength: "unassessed" });
    const second = await buildEvidenceClaim(orgA, "s5b", { supportStrength: "unassessed", claimStrength: "reviewed_not_supported" });
    const result = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(result.ok, true);
    const assessmentId = result.data.requirement_assessment_id;
    const { rows: evidenceLinks } = await pool.query(
      `SELECT evidence_item_id::text AS evidence_item_id FROM kai.requirement_assessment_evidence_links WHERE requirement_assessment_id = $1`,
      [assessmentId],
    );
    const { rows: claimLinks } = await pool.query(
      `SELECT claim_id::text AS claim_id FROM kai.requirement_assessment_claim_links WHERE requirement_assessment_id = $1`,
      [assessmentId],
    );
    assert.deepEqual(evidenceLinks.map((r) => r.evidence_item_id).sort(), [first.evidenceItemId, second.evidenceItemId].sort());
    assert.deepEqual(claimLinks.map((r) => r.claim_id).sort(), [first.claimId, second.claimId].sort());
  });

  // Scenario 6: kai.requirement_assessment_evaluation_result_links always
  // has zero rows for every assessment this package creates.
  test("6: requirement_assessment_evaluation_result_links has zero rows for every assessment this package creates", async () => {
    const requirement = await makeRequirement("s6");
    await buildEvidenceClaim(orgA, "s6", { supportStrength: "reviewed_supported", claimStrength: "reviewed_supported" });
    const result = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(result.ok, true);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.requirement_assessment_evaluation_result_links WHERE requirement_assessment_id = $1`,
      [result.data.requirement_assessment_id],
    );
    assert.equal(rows[0].n, 0);
  });

  // Scenario 7: cross-tenant isolation - assessing organization B never
  // reads/counts/links organization A's rows, even when both have data.
  test("7: cross-tenant isolation - assessing org B never counts or links org A's evidence/claims", async () => {
    const requirement = await makeRequirement("s7");
    await buildEvidenceClaim(orgA, "s7a", { supportStrength: "reviewed_supported", claimStrength: "reviewed_supported" });
    await buildEvidenceClaim(orgA, "s7a2", { supportStrength: "reviewed_supported", claimStrength: "reviewed_supported" });
    const orgBFixture = await buildEvidenceClaim(orgB, "s7b", { supportStrength: "unassessed", claimStrength: "unassessed" });

    const result = await assessOrganizationRequirement({
      organizationId: orgB,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgB),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(result.ok, true);
    // orgB has exactly 1 evidence_item + 1 claim, both unassessed -> N=2, R=0 -> needs_review.
    assert.equal(result.data.assessment_state, "needs_review");
    assert.equal(result.data.assessment_explanation, "0 of 2 governed evidence/claim items for this organization have a documented review outcome (support_strength or claim_strength other than 'unassessed').");

    const { rows: evidenceLinks } = await pool.query(
      `SELECT evidence_item_id::text AS evidence_item_id FROM kai.requirement_assessment_evidence_links WHERE requirement_assessment_id = $1`,
      [result.data.requirement_assessment_id],
    );
    assert.deepEqual(evidenceLinks.map((r) => r.evidence_item_id), [orgBFixture.evidenceItemId]);
  });

  // Scenario 8: KAI_SPRINT2_ENABLED unset/false -> feature_disabled, zero
  // rows written anywhere.
  test("8: KAI_SPRINT2_ENABLED unset -> feature_disabled, zero rows written", async () => {
    const requirement = await makeRequirement("s8");
    await buildEvidenceClaim(orgA, "s8", { supportStrength: "reviewed_supported", claimStrength: "unassessed" });
    const result = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: falseEnv, requirementAssessmentRepository: repository });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "feature_disabled");
    assert.equal(await countRows("requirement_assessments", orgA, requirement.requirement_id), 0);
  });

  // Scenario 9: a successful (non-replayed) creation writes exactly one new
  // audit row with the expected object_type/object_id/organization_id/operation.
  test("9: a successful assessment creation writes exactly one new kai.audit_events row", async () => {
    const requirement = await makeRequirement("s9");
    await buildEvidenceClaim(orgA, "s9", { supportStrength: "reviewed_supported", claimStrength: "unassessed" });
    const before = await auditEventCount(orgA);
    const result = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(result.ok, true);
    const after = await auditEventCount(orgA);
    assert.equal(after, before + 1);
    const { rows } = await pool.query(
      `SELECT organization_id::text AS organization_id, action, object_type, metadata
         FROM kai.audit_events WHERE organization_id = $1 ORDER BY audit_event_id DESC LIMIT 1`,
      [orgA],
    );
    assert.equal(rows[0].organization_id, orgA);
    assert.equal(rows[0].metadata.object_id, result.data.requirement_assessment_id);
    assert.equal(rows[0].metadata.operation, "c3_a2_requirement_assessment_created");
  });

  // Scenario 10: forced audit failure rolls back everything.
  test("10: a rejected required audit rolls back the assessment row, its provenance links, and any audit row", async () => {
    const requirement = await makeRequirement("s10");
    await buildEvidenceClaim(orgA, "s10", { supportStrength: "reviewed_supported", claimStrength: "unassessed" });
    const before = await auditEventCount(orgA);
    const forcedFailingAudit = {
      prepareMetadataOnlyAudit() {
        return { ok: false };
      },
    };
    const result = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository, metadataOnlyAudit: forcedFailingAudit });
    assert.equal(result.ok, false);
    assert.equal(await countRows("requirement_assessments", orgA, requirement.requirement_id), 0);
    const { rows: evidenceLinks } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.requirement_assessment_evidence_links WHERE organization_id = $1`,
      [orgA],
    );
    assert.equal(evidenceLinks[0].n, 0);
    assert.equal(await auditEventCount(orgA), before);
  });

  // Scenario 11: an unchanged-state replay is a complete no-op besides the
  // reread - same requirement_assessment_id, no new row, no new links.
  test("11: an unchanged-state replay returns replayed=true, reuses the same id, creates no new row/links", async () => {
    const requirement = await makeRequirement("s11");
    await buildEvidenceClaim(orgA, "s11", { supportStrength: "reviewed_supported", claimStrength: "unassessed" });
    const first = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(first.ok, true);
    assert.equal(first.data.replayed, false);

    const second = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(second.ok, true);
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.requirement_assessment_id, first.data.requirement_assessment_id);

    assert.equal(await countRows("requirement_assessments", orgA, requirement.requirement_id), 1);
    const { rows: evidenceLinks } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.requirement_assessment_evidence_links WHERE requirement_assessment_id = $1`,
      [first.data.requirement_assessment_id],
    );
    assert.equal(evidenceLinks[0].n, 1);
  });

  // Scenario 12: a materially different governed state produces a
  // different fingerprint and inserts a brand-new row.
  test("12: a changed evidence support_strength produces a new fingerprint and a brand-new row", async () => {
    const requirement = await makeRequirement("s12");
    const fixture = await buildEvidenceClaim(orgA, "s12", { supportStrength: "unassessed", claimStrength: "unassessed" });
    const first = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(first.ok, true);
    assert.equal(first.data.assessment_state, "needs_review");

    await pool.query(`UPDATE kai.evidence_items SET support_strength = 'reviewed_supported' WHERE evidence_item_id = $1`, [fixture.evidenceItemId]);

    const second = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(second.ok, true);
    assert.equal(second.data.replayed, false);
    assert.notEqual(second.data.state_fingerprint, first.data.state_fingerprint);
    assert.notEqual(second.data.requirement_assessment_id, first.data.requirement_assessment_id);

    assert.equal(await countRows("requirement_assessments", orgA, requirement.requirement_id), 2);
  });

  // Scenario 13: the first (prior) row remains byte-for-byte unchanged
  // after the reassessment in scenario 12 - the append-only trigger holds.
  test("13: the earlier assessment row remains byte-for-byte unchanged after a reassessment", async () => {
    const requirement = await makeRequirement("s13");
    const fixture = await buildEvidenceClaim(orgA, "s13", { supportStrength: "unassessed", claimStrength: "unassessed" });
    const first = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    const beforeRow = (
      await pool.query(`SELECT * FROM kai.requirement_assessments WHERE requirement_assessment_id = $1`, [first.data.requirement_assessment_id])
    ).rows[0];

    await pool.query(`UPDATE kai.evidence_items SET support_strength = 'reviewed_supported' WHERE evidence_item_id = $1`, [fixture.evidenceItemId]);
    await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });

    const afterRow = (
      await pool.query(`SELECT * FROM kai.requirement_assessments WHERE requirement_assessment_id = $1`, [first.data.requirement_assessment_id])
    ).rows[0];
    assert.deepEqual(afterRow, beforeRow);
  });

  // Scenario 14: the read-back path returns the CURRENT (post-reassessment)
  // assessment, matching the live-recomputed fingerprint, with exactly its
  // own provenance link sets.
  test("14: read-back returns the CURRENT assessment (post-reassessment) with its own provenance", async () => {
    const requirement = await makeRequirement("s14");
    const fixture = await buildEvidenceClaim(orgA, "s14", { supportStrength: "unassessed", claimStrength: "unassessed" });
    const first = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });

    await pool.query(`UPDATE kai.evidence_items SET support_strength = 'reviewed_supported' WHERE evidence_item_id = $1`, [fixture.evidenceItemId]);
    const second = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });

    const readBack = await getOrganizationRequirementAssessment({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_operator", orgA),
    }, { env: trueEnv, requirementAssessmentRepository: repository });

    assert.equal(readBack.ok, true);
    assert.equal(readBack.data.requirement.requirement_key, SUPPORTED_REQUIREMENT_KEY);
    assert.equal(readBack.data.assessment.requirement_assessment_id, second.data.requirement_assessment_id);
    assert.notEqual(readBack.data.assessment.requirement_assessment_id, first.data.requirement_assessment_id);
    assert.deepEqual(readBack.data.evidence_item_ids, [fixture.evidenceItemId]);
    assert.deepEqual(readBack.data.claim_ids, [fixture.claimId]);
  });

  // Scenario 15: kai.requirements' seeded ir_contrib_002 row is byte-for-byte
  // unchanged after every write above.
  test("15: the seeded kai.requirements row is byte-for-byte unchanged after every operation", async () => {
    const requirement = await makeRequirement("s15");
    const before = (
      await pool.query(`SELECT * FROM kai.requirements WHERE requirement_id = $1`, [requirement.requirement_id])
    ).rows[0];

    const fixture = await buildEvidenceClaim(orgA, "s15", { supportStrength: "unassessed", claimStrength: "unassessed" });
    await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    await pool.query(`UPDATE kai.evidence_items SET support_strength = 'reviewed_supported' WHERE evidence_item_id = $1`, [fixture.evidenceItemId]);
    await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    await getOrganizationRequirementAssessment({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_operator", orgA),
    }, { env: trueEnv, requirementAssessmentRepository: repository });

    const after = (
      await pool.query(`SELECT * FROM kai.requirements WHERE requirement_id = $1`, [requirement.requirement_id])
    ).rows[0];
    assert.deepEqual(after, before);
  });
}
