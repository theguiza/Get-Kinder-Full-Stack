import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_C3_A3_B_IR_CONTRIB_002_REPAIR_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`C3.A3.B ir_contrib_002-repair integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("C3.A3.B PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("C3.A3.B integration requires the runner-owned database", { skip: true }, () => {});
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
      organizationMemberships: [
        { organization_id: organizationId, role_name: role, membership_status: "active" },
      ],
    };
  }

  const trueEnv = { KAI_SPRINT2_ENABLED: "true" };
  const falseEnv = {};

  // ---------------------------------------------------------------------
  // Group A fixtures: a real, minimal, hand-built evidence/claim lineage -
  // no support_strength/claim_strength parameter any more, since C3A3.B
  // retires that column as a material input entirely. Each test uses a
  // fresh organization_id (organization_id carries no FK to kai.organizations
  // anywhere in this schema - engagement_id is always NULL for this
  // organization-scope-only package), so no cross-test TRUNCATE is needed
  // for isolation.
  // ---------------------------------------------------------------------
  async function makeRequirement(keySuffix, key = SUPPORTED_REQUIREMENT_KEY) {
    const suffix = `${keySuffix}_${Math.random().toString(36).slice(2)}`;
    const source = (
      await pool.query(
        "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('kai_standard', $1, 'C3.A3.B Fixture Source') RETURNING requirement_source_id",
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

    return { evidenceItemId, claimId, sourceVersionId };
  }

  async function insertEvidenceDecision(organizationId, evidenceItemId, outcome, { supersedes = null } = {}) {
    const limitationNotes = outcome === "supported_with_limitation" ? ["Small sample size."] : null;
    const { rows } = await pool.query(
      `INSERT INTO kai.evidence_review_decisions
         (organization_id, evidence_item_id, review_queue_item_id, decision_outcome, limitation_notes, decided_by, decided_by_role, target_updated_at, supersedes_decision_id, created_by_type)
       VALUES ($1, $2, gen_random_uuid(), $3, $4, gen_random_uuid(), 'gk_reviewer', now(), $5, 'human')
       RETURNING decision_id::text AS decision_id`,
      [organizationId, evidenceItemId, outcome, limitationNotes, supersedes],
    );
    return rows[0].decision_id;
  }

  async function insertClaimDecision(organizationId, claimId, outcome, { supersedes = null } = {}) {
    const limitationNotes = outcome === "approved_with_limitation" ? ["Small sample size."] : null;
    const approvedAudiences = outcome === "approved" || outcome === "approved_with_limitation" ? ["internal"] : null;
    const { rows } = await pool.query(
      `INSERT INTO kai.claim_review_decisions
         (organization_id, claim_id, review_queue_item_id, decision_outcome, limitation_notes, approved_audiences, decided_by, decided_by_role, target_updated_at, supersedes_decision_id, created_by_type)
       VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, gen_random_uuid(), 'gk_reviewer', now(), $6, 'human')
       RETURNING decision_id::text AS decision_id`,
      [organizationId, claimId, outcome, limitationNotes, approvedAudiences, supersedes],
    );
    return rows[0].decision_id;
  }

  async function countRows(table, organizationId, requirementId) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.${table} WHERE organization_id = $1 AND requirement_id = $2`,
      [organizationId, requirementId],
    );
    return rows[0].n;
  }

  async function linkCount(table, requirementAssessmentId) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.${table} WHERE requirement_assessment_id = $1`,
      [requirementAssessmentId],
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

  async function assess(organizationId, requirementId, role = "gk_reviewer") {
    return assessOrganizationRequirement({
      organizationId,
      requirementId,
      actorContext: actorContext(role, organizationId),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
  }

  // -----------------------------------------------------------------------
  // A: hand-built fixture scenarios (decision-only, no gaps involved).
  // -----------------------------------------------------------------------

  test("A1: no governed objects follows final contract -> not_satisfied", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("a1");
    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, true);
    assert.equal(result.data.assessment_state, "not_satisfied");
  });

  test("A2: a different requirement_key fails closed (unsupported_requirement), zero rows written", async () => {
    const orgA = crypto.randomUUID();
    const otherRequirement = await makeRequirement("a2", "ir_pur_001");
    const before = await auditEventCount(orgA);
    const result = await assess(orgA, otherRequirement.requirement_id);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "unsupported_requirement");
    assert.equal(await countRows("requirement_assessments", orgA, otherRequirement.requirement_id), 0);
    assert.equal(await auditEventCount(orgA), before);
  });

  test("A3: governed object with no current decision follows final contract - all-unresolved is needs_review, mixed is partially_satisfied", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("a3");
    await buildEvidenceClaim(orgA, "a3-undecided");
    const allUnresolved = await assess(orgA, requirement.requirement_id);
    assert.equal(allUnresolved.ok, true);
    assert.equal(allUnresolved.data.assessment_state, "needs_review");

    const orgB = crypto.randomUUID();
    const requirement2 = await makeRequirement("a3b");
    const decided = await buildEvidenceClaim(orgB, "a3b-decided");
    await buildEvidenceClaim(orgB, "a3b-undecided");
    await insertEvidenceDecision(orgB, decided.evidenceItemId, "supported");
    const mixed = await assess(orgB, requirement2.requirement_id);
    assert.equal(mixed.ok, true);
    assert.equal(mixed.data.assessment_state, "partially_satisfied");
  });

  test("A4: not_supported/rejected follows final contract - a fully-decided negative outcome resolves the assessment (satisfied), never blocks it as unresolved", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("a4");
    const fixture = await buildEvidenceClaim(orgA, "a4");
    await insertEvidenceDecision(orgA, fixture.evidenceItemId, "not_supported");
    await insertClaimDecision(orgA, fixture.claimId, "rejected");
    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, true);
    assert.equal(result.data.assessment_state, "satisfied");
  });

  test("A5: needs_more_information is unresolved and drags a mixed universe to partially_satisfied", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("a5");
    const fixture = await buildEvidenceClaim(orgA, "a5");
    await insertEvidenceDecision(orgA, fixture.evidenceItemId, "needs_more_information");
    await insertClaimDecision(orgA, fixture.claimId, "approved");
    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, true);
    assert.equal(result.data.assessment_state, "partially_satisfied");
  });

  test("A6: _with_limitation uses the current decision; superseded decisions are ignored", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("a6");
    const fixture = await buildEvidenceClaim(orgA, "a6");
    const rootDecision = await insertEvidenceDecision(orgA, fixture.evidenceItemId, "needs_more_information");
    const headDecision = await insertEvidenceDecision(orgA, fixture.evidenceItemId, "supported_with_limitation", { supersedes: rootDecision });
    await insertClaimDecision(orgA, fixture.claimId, "approved");

    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, true);
    // Both objects now resolve (documented_limitation + no_limitation) -> satisfied,
    // which is only possible if the superseded 'needs_more_information' root was ignored.
    assert.equal(result.data.assessment_state, "satisfied");

    const { rows } = await pool.query(
      `SELECT decision_id::text AS decision_id FROM kai.ra_evidence_review_decision_links WHERE requirement_assessment_id = $1`,
      [result.data.requirement_assessment_id],
    );
    assert.deepEqual(rows.map((r) => r.decision_id), [headDecision]);
    assert.notEqual(rows[0].decision_id, rootDecision);
  });

  test("A7: cross-tenant isolation - assessing org B never counts, links, or is affected by org A's evidence/claims/decisions", async () => {
    const orgA = crypto.randomUUID();
    const orgB = crypto.randomUUID();
    const requirement = await makeRequirement("a7");
    const fixtureA = await buildEvidenceClaim(orgA, "a7a");
    await insertEvidenceDecision(orgA, fixtureA.evidenceItemId, "supported");
    await insertClaimDecision(orgA, fixtureA.claimId, "approved");
    const fixtureB = await buildEvidenceClaim(orgB, "a7b");

    const result = await assess(orgB, requirement.requirement_id);
    assert.equal(result.ok, true);
    assert.equal(result.data.assessment_state, "needs_review");
    const { rows: evidenceLinks } = await pool.query(
      `SELECT evidence_item_id::text AS evidence_item_id FROM kai.requirement_assessment_evidence_links WHERE requirement_assessment_id = $1`,
      [result.data.requirement_assessment_id],
    );
    assert.deepEqual(evidenceLinks.map((r) => r.evidence_item_id), [fixtureB.evidenceItemId]);
  });

  test("A8: feature-disabled zero-write - KAI_SPRINT2_ENABLED unset -> feature_disabled, zero rows written", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("a8");
    await buildEvidenceClaim(orgA, "a8");
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

  test("A9: tenant negative - a structurally invalid organization_id is rejected fail-closed (repository UUID-shape gate), never silently coerced or cross-matched", async () => {
    const requirement = await makeRequirement("a9");
    const result = await assessOrganizationRequirement({
      organizationId: "not-a-uuid",
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", "not-a-uuid"),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
  });

  test("A10: a successful assessment creation writes exactly one new kai.audit_events row", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("a10");
    const fixture = await buildEvidenceClaim(orgA, "a10");
    await insertEvidenceDecision(orgA, fixture.evidenceItemId, "supported");
    const before = await auditEventCount(orgA);
    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, true);
    assert.equal(await auditEventCount(orgA), before + 1);
    const { rows } = await pool.query(
      `SELECT metadata FROM kai.audit_events WHERE organization_id = $1 ORDER BY audit_event_id DESC LIMIT 1`,
      [orgA],
    );
    assert.equal(rows[0].metadata.object_id, result.data.requirement_assessment_id);
  });

  test("A11: audit failure rollback - a rejected required audit rolls back the assessment row and every provenance link table (C2.1 and C3.A3 alike)", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("a11");
    const fixture = await buildEvidenceClaim(orgA, "a11");
    await insertEvidenceDecision(orgA, fixture.evidenceItemId, "supported");
    await insertClaimDecision(orgA, fixture.claimId, "approved");
    const before = await auditEventCount(orgA);
    const forcedFailingAudit = { prepareMetadataOnlyAudit() { return { ok: false }; } };
    const result = await assessOrganizationRequirement({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_reviewer", orgA),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository, metadataOnlyAudit: forcedFailingAudit });
    assert.equal(result.ok, false);
    assert.equal(await countRows("requirement_assessments", orgA, requirement.requirement_id), 0);
    for (const table of [
      "requirement_assessment_evidence_links",
      "requirement_assessment_claim_links",
      "ra_evidence_review_decision_links",
      "ra_claim_review_decision_links",
      "ra_gap_links",
    ]) {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM kai.${table} WHERE organization_id = $1`, [orgA]);
      assert.equal(rows[0].n, 0, `expected zero rows in ${table} after rollback`);
    }
    assert.equal(await auditEventCount(orgA), before);
  });

  test("A12: unchanged v2 state replays - zero new rows, same id", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("a12");
    const fixture = await buildEvidenceClaim(orgA, "a12");
    await insertEvidenceDecision(orgA, fixture.evidenceItemId, "supported");
    const first = await assess(orgA, requirement.requirement_id);
    assert.equal(first.data.replayed, false);
    const second = await assess(orgA, requirement.requirement_id);
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.requirement_assessment_id, first.data.requirement_assessment_id);
    assert.equal(await countRows("requirement_assessments", orgA, requirement.requirement_id), 1);
    assert.equal(await linkCount("ra_evidence_review_decision_links", first.data.requirement_assessment_id), 1);
  });

  test("A13/A14: material decision change reassesses; the prior assessment row remains byte-for-byte unchanged", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("a13");
    const fixture = await buildEvidenceClaim(orgA, "a13");
    const first = await assess(orgA, requirement.requirement_id);
    assert.equal(first.data.assessment_state, "needs_review");
    const beforeRow = (
      await pool.query(`SELECT * FROM kai.requirement_assessments WHERE requirement_assessment_id = $1`, [first.data.requirement_assessment_id])
    ).rows[0];

    await insertEvidenceDecision(orgA, fixture.evidenceItemId, "supported");
    const second = await assess(orgA, requirement.requirement_id);
    assert.equal(second.data.replayed, false);
    assert.notEqual(second.data.state_fingerprint, first.data.state_fingerprint);
    assert.notEqual(second.data.requirement_assessment_id, first.data.requirement_assessment_id);
    assert.equal(await countRows("requirement_assessments", orgA, requirement.requirement_id), 2);

    const afterRow = (
      await pool.query(`SELECT * FROM kai.requirement_assessments WHERE requirement_assessment_id = $1`, [first.data.requirement_assessment_id])
    ).rows[0];
    assert.deepEqual(afterRow, beforeRow);
  });

  test("A15: read-back returns the CURRENT assessment with its decision/gap provenance ids", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("a15");
    const fixture = await buildEvidenceClaim(orgA, "a15");
    const decisionId = await insertEvidenceDecision(orgA, fixture.evidenceItemId, "supported");
    const claimDecisionId = await insertClaimDecision(orgA, fixture.claimId, "approved");
    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, true);

    const readBack = await getOrganizationRequirementAssessment({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_operator", orgA),
    }, { env: trueEnv, requirementAssessmentRepository: repository });

    assert.equal(readBack.ok, true);
    assert.equal(readBack.data.requirement.requirement_key, SUPPORTED_REQUIREMENT_KEY);
    assert.equal(readBack.data.assessment.requirement_assessment_id, result.data.requirement_assessment_id);
    assert.deepEqual(readBack.data.evidence_item_ids, [fixture.evidenceItemId]);
    assert.deepEqual(readBack.data.claim_ids, [fixture.claimId]);
    assert.deepEqual(readBack.data.evidence_review_decision_ids, [decisionId]);
    assert.deepEqual(readBack.data.claim_review_decision_ids, [claimDecisionId]);
    assert.deepEqual(readBack.data.current_gap_log_item_ids, []);
  });

  test("A16: the seeded requirement definition remains byte-for-byte unchanged across every operation", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("a16");
    const before = (await pool.query(`SELECT * FROM kai.requirements WHERE requirement_id = $1`, [requirement.requirement_id])).rows[0];

    const fixture = await buildEvidenceClaim(orgA, "a16");
    await assess(orgA, requirement.requirement_id);
    await insertEvidenceDecision(orgA, fixture.evidenceItemId, "supported");
    await assess(orgA, requirement.requirement_id);
    await getOrganizationRequirementAssessment({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_operator", orgA),
    }, { env: trueEnv, requirementAssessmentRepository: repository });

    const after = (await pool.query(`SELECT * FROM kai.requirements WHERE requirement_id = $1`, [requirement.requirement_id])).rows[0];
    assert.deepEqual(after, before);
  });

  test("A17: old v1 assessment is not current - a legacy c3_a2_ir_contrib_002_v1-shaped row never satisfies the corrected read, and a fresh assessment inserts a brand-new v2 row alongside it", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("a17");
    await buildEvidenceClaim(orgA, "a17");

    const legacyFingerprint = sha256hex(JSON.stringify({ fingerprint_version: "c3_a2_ir_contrib_002_v1", n: 1, r: 0 }));
    const legacyRow = (
      await pool.query(
        `INSERT INTO kai.requirement_assessments
           (organization_id, engagement_id, requirement_id, assessment_state, assessment_explanation, state_fingerprint, created_by_type, created_at)
         VALUES ($1, NULL, $2, 'needs_review', 'legacy v1 row', $3, 'system', now())
         RETURNING requirement_assessment_id::text AS requirement_assessment_id`,
        [orgA, requirement.requirement_id, legacyFingerprint],
      )
    ).rows[0];

    const beforeRead = await getOrganizationRequirementAssessment({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_operator", orgA),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    // The legacy row's fingerprint can never equal a freshly-recomputed v2
    // fingerprint (disjoint hash input spaces), so it is invisible to the
    // corrected read - not_found, never mistaken as current.
    assert.equal(beforeRead.ok, false);
    assert.equal(beforeRead.error.code, "not_found");

    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, true);
    assert.notEqual(result.data.requirement_assessment_id, legacyRow.requirement_assessment_id);
    assert.equal(await countRows("requirement_assessments", orgA, requirement.requirement_id), 2);

    const readBack = await getOrganizationRequirementAssessment({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_operator", orgA),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(readBack.ok, true);
    assert.equal(readBack.data.assessment.requirement_assessment_id, result.data.requirement_assessment_id);

    const stillThere = (
      await pool.query(`SELECT * FROM kai.requirement_assessments WHERE requirement_assessment_id = $1`, [legacyRow.requirement_assessment_id])
    ).rows[0];
    assert.ok(stillThere, "the legacy v1 row must remain in history, untouched");
  });

  // -----------------------------------------------------------------------
  // B: real-service gap fixture (mirrors P2-06's prepareTwoClaims pattern) -
  // proves the currently-applicable-gap wiring end to end against the real
  // P2-02/P2-04 production stack, not a hand-simulated snapshot. All of
  // group B shares one fixed, smoke-seeded organization/source_version, and
  // group B tests run strictly in the order below because the final test
  // (B4) permanently flips that shared source_version to non-current.
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

  async function currentGapLogItemIds(claimId) {
    const { rows } = await pool.query(
      `SELECT gap_log_item_id::text AS gap_log_item_id, assessment_status FROM kai.gap_log_items WHERE claim_id = $1::uuid ORDER BY gap_log_item_id`,
      [claimId],
    );
    return rows;
  }

  test("B1: supported/approved cannot hide a current gap - an approved claim's real, currently-applicable gaps are still persisted as provenance", async () => {
    const [claimA] = await gapEligibleClaims();
    const requirement = await makeRequirement("b1");
    const claimDecisionId = await insertClaimDecision(ORG_GAPS, claimA, "approved");
    const expectedGaps = await currentGapLogItemIds(claimA);
    assert.ok(expectedGaps.length > 0, "fixture must produce at least one real currently-applicable gap for this claim");

    const result = await assess(ORG_GAPS, requirement.requirement_id);
    assert.equal(result.ok, true);

    const { rows: claimDecisionLinks } = await pool.query(
      `SELECT decision_id::text AS decision_id FROM kai.ra_claim_review_decision_links WHERE requirement_assessment_id = $1 AND claim_id = $2::uuid`,
      [result.data.requirement_assessment_id, claimA],
    );
    assert.deepEqual(claimDecisionLinks.map((r) => r.decision_id), [claimDecisionId]);

    const { rows: gapLinks } = await pool.query(
      `SELECT gap_log_item_id::text AS gap_log_item_id FROM kai.ra_gap_links WHERE requirement_assessment_id = $1 AND claim_id = $2::uuid ORDER BY gap_log_item_id`,
      [result.data.requirement_assessment_id, claimA],
    );
    assert.deepEqual(gapLinks.map((r) => r.gap_log_item_id), expectedGaps.map((g) => g.gap_log_item_id));
  });

  test("B2/B3: current gaps affect assessment (material gap change reassesses) - assessing before vs. after a claim's real gaps exist produces a different fingerprint", async () => {
    const requirement = await makeRequirement("b2");
    const orgSolo = crypto.randomUUID();
    const soloFixture = await buildEvidenceClaim(orgSolo, "b2-solo");
    const before = await assess(orgSolo, requirement.requirement_id);
    assert.equal(before.data.assessment_state, "needs_review");

    const [, claimB] = await gapEligibleClaims();
    const expectedGaps = await currentGapLogItemIds(claimB);
    assert.ok(expectedGaps.length > 0);

    const requirement2 = await makeRequirement("b3");
    const afterWithGaps = await assess(ORG_GAPS, requirement2.requirement_id);
    assert.equal(afterWithGaps.ok, true);
    const { rows: gapLinks } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.ra_gap_links WHERE requirement_assessment_id = $1`,
      [afterWithGaps.data.requirement_assessment_id],
    );
    assert.ok(gapLinks[0].n > 0, "an assessment over an organization with real currently-applicable gaps must persist gap-link provenance");

    // Reassessing the exact same (still-current) gap state replays - proving
    // the gap state, not incidental noise, is what the fingerprint is
    // material over.
    const replay = await assess(ORG_GAPS, requirement2.requirement_id);
    assert.equal(replay.data.replayed, true);
  });

  test("B4: exact historical gap state preserved, then stale gaps ignored once the shared source_version is flipped non-current", async () => {
    const [claimA] = await gapEligibleClaims();
    const requirement = await makeRequirement("b4");
    const result = await assess(ORG_GAPS, requirement.requirement_id);
    assert.equal(result.ok, true);

    const sourceRows = await currentGapLogItemIds(claimA);
    const { rows: gapLinkRows } = await pool.query(
      `SELECT gap_log_item_id::text AS gap_log_item_id, claim_id::text AS claim_id, evidence_item_id::text AS evidence_item_id,
              source_version_id::text AS source_version_id, dimension_key, assessment_status
         FROM kai.ra_gap_links
        WHERE requirement_assessment_id = $1 AND claim_id = $2::uuid
        ORDER BY gap_log_item_id`,
      [result.data.requirement_assessment_id, claimA],
    );
    const { rows: sourceGapRows } = await pool.query(
      `SELECT gap_log_item_id::text AS gap_log_item_id, claim_id::text AS claim_id, evidence_item_id::text AS evidence_item_id,
              source_version_id::text AS source_version_id, dimension_key, assessment_status
         FROM kai.gap_log_items
        WHERE claim_id = $1::uuid
        ORDER BY gap_log_item_id`,
      [claimA],
    );
    assert.deepEqual(gapLinkRows, sourceGapRows);

    // Now stale-out every gap for this organization: flip the shared
    // source_version to no longer current. This must be the LAST group-B
    // test, since it affects every claim built from that source_version.
    await pool.query(`UPDATE kai.source_versions SET is_current = false WHERE organization_id = $1::uuid`, [ORG_GAPS]);

    const requirement2 = await makeRequirement("b4stale");
    const afterStale = await assess(ORG_GAPS, requirement2.requirement_id);
    assert.equal(afterStale.ok, true);
    const { rows: staleGapLinks } = await pool.query(
      `SELECT count(*)::int AS n FROM kai.ra_gap_links WHERE requirement_assessment_id = $1`,
      [afterStale.data.requirement_assessment_id],
    );
    assert.equal(staleGapLinks[0].n, 0, "a gap whose source_version is no longer current must be excluded, not persisted as provenance");
  });
}
