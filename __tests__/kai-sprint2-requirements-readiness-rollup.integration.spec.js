import test, { after } from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_REQUIREMENTS_ROLLUP_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`requirements-readiness-rollup integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("requirements-readiness-rollup PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("requirements-readiness-rollup integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runIntegrationSuite();
}

async function runIntegrationSuite() {
  const { Pool } = await import("pg");
  const { createPostgresRequirementAssessmentRepository } = await import(
    "../Backend/kai/dictionary/postgresRequirementAssessmentRepository.js"
  );
  const {
    assessOrganizationRequirement,
    listOrganizationRequirementsReadiness,
  } = await import("../Backend/kai/services/kaiRequirementAssessmentService.js");
  const { SUPPORTED_REQUIREMENT_KEY: IR_CONTRIB_002 } = await import("../Backend/kai/validators/kaiRequirementAssessmentValidators.js");
  const { REQUIREMENT_KEY: IR_COMM_002 } = await import("../Backend/kai/validators/kaiCommunicationAccountabilityAssessmentValidators.js");
  const { REQUIREMENT_KEY: IR_PUR_001 } = await import("../Backend/kai/validators/kaiOutcomeDefinedAssessmentValidators.js");
  const { REQUIREMENT_KEY: IR_STK_001 } = await import("../Backend/kai/validators/kaiStakeholderIdentifiedAssessmentValidators.js");
  const { REQUIREMENT_KEY: IR_DATA_001 } = await import("../Backend/kai/validators/kaiSourceGovernanceAssessmentValidators.js");
  const { REQUIREMENT_KEY: IR_DATA_002 } = await import("../Backend/kai/validators/kaiDataQualityDocumentedAssessmentValidators.js");
  const { REQUIREMENT_KEY: IR_DATA_003 } = await import("../Backend/kai/validators/kaiClaimEvidenceTraceabilityAssessmentValidators.js");
  const { REQUIREMENT_KEY: IR_CONTRIB_003 } = await import("../Backend/kai/validators/kaiConflictGapTrackedAssessmentValidators.js");
  const { REQUIREMENT_KEY: IR_COMM_001 } = await import("../Backend/kai/validators/kaiAudiencePermissionKnownAssessmentValidators.js");

  const SUPPORTED_KEYS = [
    IR_CONTRIB_002, IR_COMM_002, IR_PUR_001, IR_STK_001, IR_DATA_001,
    IR_DATA_002, IR_DATA_003, IR_CONTRIB_003, IR_COMM_001,
  ];
  assert.equal(SUPPORTED_KEYS.length, 9, "this proof assumes exactly nine supported requirement keys");
  assert.equal(new Set(SUPPORTED_KEYS).size, 9, "supported requirement keys must be distinct");

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

  function actorContext(role, organizationId, userId) {
    return {
      actorType: "human",
      actorUserId: userId,
      kaiRoles: [],
      organizationMemberships: [{ organization_id: organizationId, role_name: role, membership_status: "active" }],
    };
  }

  const trueEnv = { KAI_SPRINT2_ENABLED: "true" };

  async function assess(organizationId, requirementId, userId) {
    return assessOrganizationRequirement({
      organizationId,
      requirementId,
      actorContext: actorContext("gk_reviewer", organizationId, userId),
      now: new Date().toISOString(),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
  }

  async function rollup(organizationId, userId) {
    return listOrganizationRequirementsReadiness({
      organizationId,
      actorContext: actorContext("gk_operator", organizationId, userId),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
  }

  async function makeOrganization(name) {
    return (
      await pool.query("INSERT INTO kai.organizations (name) VALUES ($1) RETURNING organization_id", [name])
    ).rows[0].organization_id;
  }

  // ---------------------------------------------------------------------
  // Catalogue fixture: this suite is the FIRST test suite the runner
  // executes against the freshly-migrated ephemeral database (see the
  // runner script), so kai.requirements is empty when this file runs -
  // requirement_key is only unique per requirement_set
  // (requirements_b1_1_identity_unique = UNIQUE(requirement_set_id,
  // requirement_key), not globally), so any later suite's own
  // makeRequirement-style fixtures inserting additional rows sharing these
  // same nine keys (in their own, separate requirement_sets) would make
  // "exactly nine, each appearing once" unprovable if this suite ran after
  // them. Running first is what makes the catalogue closed and countable.
  // ---------------------------------------------------------------------
  const runSuffix = Math.random().toString(36).slice(2);
  const requirementSourceId = (
    await pool.query(
      "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('kai_standard', $1, 'Rollup Fixture Source') RETURNING requirement_source_id",
      [`src_rollup_${runSuffix}`],
    )
  ).rows[0].requirement_source_id;
  const frameworkVersionId = (
    await pool.query(
      "INSERT INTO kai.requirement_framework_versions (requirement_source_id, framework_code, framework_name, version_label) VALUES ($1, 'fw_rollup', 'Rollup Framework', 'v1') RETURNING requirement_framework_version_id",
      [requirementSourceId],
    )
  ).rows[0].requirement_framework_version_id;
  const requirementSetId = (
    await pool.query(
      "INSERT INTO kai.requirement_sets (requirement_framework_version_id, set_key, set_name) VALUES ($1, 'set_rollup', 'Rollup Set') RETURNING requirement_set_id",
      [frameworkVersionId],
    )
  ).rows[0].requirement_set_id;

  const catalogueRowsByKey = new Map();
  for (let i = 0; i < SUPPORTED_KEYS.length; i += 1) {
    const key = SUPPORTED_KEYS[i];
    const row = (
      await pool.query(
        "INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, display_order) VALUES ($1, $2, $3, $4) RETURNING requirement_id, requirement_key, requirement_label",
        [requirementSetId, key, `Rollup label for ${key}`, i],
      )
    ).rows[0];
    catalogueRowsByKey.set(key, row);
  }
  // An unsupported key must never leak into the rollup.
  await pool.query(
    "INSERT INTO kai.requirements (requirement_set_id, requirement_key, requirement_label, display_order) VALUES ($1, 'ir_unsupported_999', 'Unsupported requirement', 99)",
    [requirementSetId],
  );

  async function tableCounts() {
    const tables = [
      "kai.requirement_assessments",
      "kai.ra_outcome_context_links",
      "kai.ra_evidence_review_decision_links",
      "kai.ra_claim_review_decision_links",
      "kai.ra_gap_links",
      "kai.requirement_assessment_evidence_links",
      "kai.requirement_assessment_claim_links",
      "kai.ra_source_promotion_links",
      "kai.ra_conflict_resolution_links",
      "kai.audit_events",
    ];
    const counts = {};
    for (const table of tables) {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
      counts[table] = rows[0].n;
    }
    return counts;
  }

  test("listOrganizationRequirementsReadiness: catalogue closure, current-assessment fidelity, unassessed shape, zero-write reads, and tenant isolation", async () => {
    const orgA = await makeOrganization("Rollup Org A");
    const orgB = await makeOrganization("Rollup Org B");

    // -----------------------------------------------------------------
    // 1 & 2. Exactly the nine supported requirements appear once, and the
    // catalogue identity (id/key/label) is exactly what kai.requirements
    // holds - before any assessment exists for orgA at all.
    // -----------------------------------------------------------------
    const initialRollup = await rollup(orgA, "90000000-0000-4000-8000-00000000a001");
    assert.equal(initialRollup.ok, true);
    const initialRequirements = initialRollup.data.requirements;
    assert.equal(initialRequirements.length, 9, "exactly the nine supported requirements must appear");
    const seenKeys = initialRequirements.map((r) => r.requirement_key);
    assert.deepEqual([...seenKeys].sort(), [...SUPPORTED_KEYS].sort(), "each supported key must appear exactly once");
    assert.equal(new Set(seenKeys).size, 9, "no supported key may be duplicated");
    assert.ok(!seenKeys.includes("ir_unsupported_999"), "an unsupported catalogue key must never leak into the rollup");

    for (const row of initialRequirements) {
      const expected = catalogueRowsByKey.get(row.requirement_key);
      assert.equal(row.requirement_id, expected.requirement_id, `requirement_id for ${row.requirement_key} must come from kai.requirements`);
      assert.equal(row.requirement_label, expected.requirement_label, `requirement_label for ${row.requirement_key} must come from kai.requirements`);
    }

    // -----------------------------------------------------------------
    // 4. Every requirement is unassessed before any write.
    // -----------------------------------------------------------------
    for (const row of initialRequirements) {
      assert.equal(row.assessed, false, `${row.requirement_key} must be unassessed before any write`);
      assert.equal(row.assessment, null, `${row.requirement_key}'s unassessed representation must be null`);
    }

    // -----------------------------------------------------------------
    // 3. Real C3 machinery: assess ir_pur_001 for orgA (via a real
    // organization-scope outcome context) and prove the rollup surfaces
    // exactly the persisted id/state/fingerprint - not a recomputed or
    // synthesized value.
    // -----------------------------------------------------------------
    const irPur001 = catalogueRowsByKey.get(IR_PUR_001);
    await pool.query(
      `INSERT INTO kai.impact_outcome_contexts
         (organization_id, engagement_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label, created_by_type)
       VALUES ($1, NULL, $2, $3, $4, $5, 'human')`,
      [orgA, `outcome_rollup_${runSuffix}`, "Stakeholders achieve the intended change.", `stakeholder_rollup_${runSuffix}`, "Rollup Stakeholder"],
    );
    const assessed = await assess(orgA, irPur001.requirement_id, "90000000-0000-4000-8000-00000000a002");
    assert.equal(assessed.ok, true);
    assert.equal(assessed.data.assessment_state, "satisfied");

    const afterAssessRollup = await rollup(orgA, "90000000-0000-4000-8000-00000000a003");
    assert.equal(afterAssessRollup.ok, true);
    const afterAssessPur001 = afterAssessRollup.data.requirements.find((r) => r.requirement_key === IR_PUR_001);
    assert.ok(afterAssessPur001);
    assert.equal(afterAssessPur001.assessed, true);
    assert.equal(afterAssessPur001.assessment.requirement_assessment_id, assessed.data.requirement_assessment_id);
    assert.equal(afterAssessPur001.assessment.assessment_state, assessed.data.assessment_state);
    assert.equal(afterAssessPur001.assessment.state_fingerprint, assessed.data.state_fingerprint);

    // ir_stk_001 remains unassessed for orgA throughout - proves the
    // unassessed representation still holds alongside an assessed sibling.
    const afterAssessStk001 = afterAssessRollup.data.requirements.find((r) => r.requirement_key === IR_STK_001);
    assert.equal(afterAssessStk001.assessed, false);
    assert.equal(afterAssessStk001.assessment, null);

    // -----------------------------------------------------------------
    // 5. One rollup read causes zero new assessment/provenance/audit rows.
    // -----------------------------------------------------------------
    const beforeReadOnly = await tableCounts();
    const readOnlyRollup = await rollup(orgA, "90000000-0000-4000-8000-00000000a004");
    assert.equal(readOnlyRollup.ok, true);
    const afterReadOnly = await tableCounts();
    assert.deepEqual(afterReadOnly, beforeReadOnly, "a rollup read must write zero rows anywhere");

    // -----------------------------------------------------------------
    // 6. Org-B assessment state cannot appear in Org-A's rollup.
    // -----------------------------------------------------------------
    await pool.query(
      `INSERT INTO kai.impact_outcome_contexts
         (organization_id, engagement_id, outcome_key, outcome_statement, stakeholder_key, stakeholder_label, created_by_type)
       VALUES ($1, NULL, $2, $3, $4, $5, 'human')`,
      [orgB, `outcome_rollup_b_${runSuffix}`, "A wholly separate org-B outcome.", `stakeholder_rollup_b_${runSuffix}`, "Rollup Stakeholder B"],
    );
    const assessedB = await assess(orgB, irPur001.requirement_id, "90000000-0000-4000-8000-00000000b001");
    assert.equal(assessedB.ok, true);
    assert.equal(assessedB.data.assessment_state, "satisfied");
    assert.notEqual(assessedB.data.requirement_assessment_id, assessed.data.requirement_assessment_id);

    const orgARollupAfterOrgBWrite = await rollup(orgA, "90000000-0000-4000-8000-00000000a005");
    const orgAPur001AfterOrgBWrite = orgARollupAfterOrgBWrite.data.requirements.find((r) => r.requirement_key === IR_PUR_001);
    assert.equal(orgAPur001AfterOrgBWrite.assessment.requirement_assessment_id, assessed.data.requirement_assessment_id, "orgA's rollup must keep citing orgA's own assessment row");
    assert.notEqual(orgAPur001AfterOrgBWrite.assessment.requirement_assessment_id, assessedB.data.requirement_assessment_id, "orgB's assessment row must never surface in orgA's rollup");

    const orgBRollup = await rollup(orgB, "90000000-0000-4000-8000-00000000b002");
    const orgBPur001 = orgBRollup.data.requirements.find((r) => r.requirement_key === IR_PUR_001);
    assert.equal(orgBPur001.assessment.requirement_assessment_id, assessedB.data.requirement_assessment_id);
    assert.notEqual(orgBPur001.assessment.requirement_assessment_id, assessed.data.requirement_assessment_id, "orgA's assessment row must never surface in orgB's rollup");
  });
}
