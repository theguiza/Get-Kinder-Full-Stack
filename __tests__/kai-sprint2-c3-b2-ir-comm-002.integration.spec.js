import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_C3_B2_IR_COMM_002_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`C3.B2 ir_comm_002 integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("C3.B2 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("C3.B2 integration requires the runner-owned database", { skip: true }, () => {});
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
  const { REQUIREMENT_KEY: IR_COMM_002_KEY } = await import(
    "../Backend/kai/validators/kaiCommunicationAccountabilityAssessmentValidators.js"
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

  // ---------------------------------------------------------------------
  // Fixtures: minimal hand-built evidence/claim lineage (evidence is only
  // needed as the FK parent claims require - ir_comm_002's universe is
  // claims only). Each test uses a fresh organization_id, so no cross-test
  // TRUNCATE is needed for isolation.
  // ---------------------------------------------------------------------
  async function makeRequirement(keySuffix, key = IR_COMM_002_KEY) {
    const suffix = `${keySuffix}_${Math.random().toString(36).slice(2)}`;
    const source = (
      await pool.query(
        "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('kai_standard', $1, 'C3.B2 Fixture Source') RETURNING requirement_source_id",
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

  async function insertClaimDecision(organizationId, claimId, outcome, { supersedes = null, decidedBy = crypto.randomUUID(), decidedByRole = "gk_reviewer" } = {}) {
    const limitationNotes = outcome === "approved_with_limitation" ? ["Small sample size."] : null;
    const approvedAudiences = outcome === "approved" || outcome === "approved_with_limitation" ? ["internal"] : null;
    const { rows } = await pool.query(
      `INSERT INTO kai.claim_review_decisions
         (organization_id, claim_id, review_queue_item_id, decision_outcome, limitation_notes, approved_audiences, decided_by, decided_by_role, target_updated_at, supersedes_decision_id, created_by_type)
       VALUES ($1, $2, gen_random_uuid(), $3, $4, $5, $6, $7, now(), $8, 'human')
       RETURNING decision_id::text AS decision_id`,
      [organizationId, claimId, outcome, limitationNotes, approvedAudiences, decidedBy, decidedByRole, supersedes],
    );
    return { decisionId: rows[0].decision_id, decidedBy, decidedByRole };
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

  async function tableCountForOrg(table, organizationId) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM kai.${table} WHERE organization_id = $1`, [organizationId]);
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

  test("C1: reported-result universe boundary - only kai.claims rows for the org are counted; empty universe (n=0) -> not_satisfied, never vacuously satisfied", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("c1");
    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, true);
    assert.equal(result.data.assessment_state, "not_satisfied");
    assert.equal(await linkCount("requirement_assessment_claim_links", result.data.requirement_assessment_id), 0);
  });

  test("C2: accountability uses the exact current decision (decision_id/decided_by/decided_by_role), not 'reviewed'/'approved' vocabulary", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("c2");
    const fixture = await buildEvidenceClaim(orgA, "c2");
    const decision = await insertClaimDecision(orgA, fixture.claimId, "rejected");
    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, true);
    // 'rejected' is not an approval outcome, yet the claim is still ACCOUNTABLE
    // because a current decision (naming decided_by/decided_by_role) exists.
    assert.equal(result.data.assessment_state, "satisfied");

    const { rows } = await pool.query(
      `SELECT decision_id::text AS decision_id FROM kai.ra_claim_review_decision_links WHERE requirement_assessment_id = $1`,
      [result.data.requirement_assessment_id],
    );
    assert.deepEqual(rows.map((r) => r.decision_id), [decision.decisionId]);
  });

  test("C3: superseded decisions are ignored - a 2-hop lineage counts only the head", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("c3");
    const fixture = await buildEvidenceClaim(orgA, "c3");
    const root = await insertClaimDecision(orgA, fixture.claimId, "needs_more_information");
    const head = await insertClaimDecision(orgA, fixture.claimId, "approved", { supersedes: root.decisionId });

    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, true);
    assert.equal(result.data.assessment_state, "satisfied");

    const { rows } = await pool.query(
      `SELECT decision_id::text AS decision_id FROM kai.ra_claim_review_decision_links WHERE requirement_assessment_id = $1`,
      [result.data.requirement_assessment_id],
    );
    assert.deepEqual(rows.map((r) => r.decision_id), [head.decisionId]);
    assert.notEqual(rows[0].decision_id, root.decisionId);
  });

  test("C4: claim with no decision at all -> NO_ACCOUNTABILITY; ra_claim_review_decision_links has no row, provable via re-derive-and-compare read (not a stored sentinel)", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("c4");
    const decided = await buildEvidenceClaim(orgA, "c4-decided");
    const undecided = await buildEvidenceClaim(orgA, "c4-undecided");
    await insertClaimDecision(orgA, decided.claimId, "approved");

    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, true);
    assert.equal(result.data.assessment_state, "partially_satisfied");

    const { rows: claimLinks } = await pool.query(
      `SELECT claim_id::text AS claim_id FROM kai.requirement_assessment_claim_links WHERE requirement_assessment_id = $1 ORDER BY claim_id`,
      [result.data.requirement_assessment_id],
    );
    assert.deepEqual(claimLinks.map((r) => r.claim_id).sort(), [decided.claimId, undecided.claimId].sort());

    const { rows: decisionLinks } = await pool.query(
      `SELECT claim_id::text AS claim_id FROM kai.ra_claim_review_decision_links WHERE requirement_assessment_id = $1`,
      [result.data.requirement_assessment_id],
    );
    assert.deepEqual(decisionLinks.map((r) => r.claim_id), [decided.claimId]);

    // Prove absence via the standard recompute-and-compare read path, not a
    // stored sentinel: the read-back must reflect exactly the same current
    // decision-link set as what was written - one decision id (for the
    // decided claim), and the undecided claim's id never appears among the
    // decision ids at all.
    const readBack = await getOrganizationRequirementAssessment({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_operator", orgA),
    }, { env: trueEnv, requirementAssessmentRepository: repository });
    assert.equal(readBack.ok, true);
    assert.equal(readBack.data.claim_review_decision_ids.length, 1);
    assert.deepEqual(readBack.data.claim_ids.sort(), [decided.claimId, undecided.claimId].sort());
    assert.ok(!readBack.data.claim_review_decision_ids.includes(undecided.claimId));
  });

  test("C5: all-accountable -> satisfied; all-no-accountability -> not_satisfied (explicitly NOT needs_review); mixed -> partially_satisfied", async () => {
    const orgAllAccountable = crypto.randomUUID();
    const requirementAllAccountable = await makeRequirement("c5_all_acc");
    const f1 = await buildEvidenceClaim(orgAllAccountable, "c5-all-acc-1");
    const f2 = await buildEvidenceClaim(orgAllAccountable, "c5-all-acc-2");
    await insertClaimDecision(orgAllAccountable, f1.claimId, "approved");
    await insertClaimDecision(orgAllAccountable, f2.claimId, "rejected");
    const allAccountable = await assess(orgAllAccountable, requirementAllAccountable.requirement_id);
    assert.equal(allAccountable.data.assessment_state, "satisfied");

    const orgAllAbsent = crypto.randomUUID();
    const requirementAllAbsent = await makeRequirement("c5_all_absent");
    await buildEvidenceClaim(orgAllAbsent, "c5-all-absent-1");
    await buildEvidenceClaim(orgAllAbsent, "c5-all-absent-2");
    const allAbsent = await assess(orgAllAbsent, requirementAllAbsent.requirement_id);
    assert.equal(allAbsent.data.assessment_state, "not_satisfied");
    assert.notEqual(allAbsent.data.assessment_state, "needs_review");

    const orgMixed = crypto.randomUUID();
    const requirementMixed = await makeRequirement("c5_mixed");
    const mixedDecided = await buildEvidenceClaim(orgMixed, "c5-mixed-decided");
    await buildEvidenceClaim(orgMixed, "c5-mixed-undecided");
    await insertClaimDecision(orgMixed, mixedDecided.claimId, "approved");
    const mixed = await assess(orgMixed, requirementMixed.requirement_id);
    assert.equal(mixed.data.assessment_state, "partially_satisfied");

    const orgEmpty = crypto.randomUUID();
    const requirementEmpty = await makeRequirement("c5_empty");
    const empty = await assess(orgEmpty, requirementEmpty.requirement_id);
    assert.equal(empty.data.assessment_state, "not_satisfied");
  });

  test("C6: unsupported_requirement still fails closed for a third fabricated requirement_key, zero writes", async () => {
    const orgA = crypto.randomUUID();
    // ir_pur_002 remains genuinely unsupported (PARTIAL_INPUT_EXISTS in the
    // accepted catalogue, not part of any implemented dispatcher entry) -
    // ir_pur_001 was used here historically but became a real dispatcher
    // entry in KAI Package C3.B3, so it can no longer serve as an
    // "unsupported requirement" fixture.
    const otherRequirement = await makeRequirement("c6", "ir_pur_002");
    const before = await auditEventCount(orgA);
    const result = await assess(orgA, otherRequirement.requirement_id);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "unsupported_requirement");
    assert.equal(await countRows("requirement_assessments", orgA, otherRequirement.requirement_id), 0);
    assert.equal(await auditEventCount(orgA), before);
  });

  test("C7: new in-scope claim causes reassessment (new fingerprint/new row)", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("c7");
    const fixture = await buildEvidenceClaim(orgA, "c7-first");
    await insertClaimDecision(orgA, fixture.claimId, "approved");
    const first = await assess(orgA, requirement.requirement_id);
    assert.equal(first.data.assessment_state, "satisfied");

    await buildEvidenceClaim(orgA, "c7-second");
    const second = await assess(orgA, requirement.requirement_id);
    assert.equal(second.data.replayed, false);
    assert.notEqual(second.data.state_fingerprint, first.data.state_fingerprint);
    assert.equal(second.data.assessment_state, "partially_satisfied");
    assert.equal(await countRows("requirement_assessments", orgA, requirement.requirement_id), 2);
  });

  test("C8: a new accountable decision moves a claim NO_ACCOUNTABILITY -> ACCOUNTABLE and causes reassessment", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("c8");
    const fixture = await buildEvidenceClaim(orgA, "c8");
    const first = await assess(orgA, requirement.requirement_id);
    assert.equal(first.data.assessment_state, "not_satisfied");

    await insertClaimDecision(orgA, fixture.claimId, "approved");
    const second = await assess(orgA, requirement.requirement_id);
    assert.equal(second.data.replayed, false);
    assert.notEqual(second.data.state_fingerprint, first.data.state_fingerprint);
    assert.equal(second.data.assessment_state, "satisfied");
    assert.equal(await countRows("requirement_assessments", orgA, requirement.requirement_id), 2);
  });

  test("C9: unchanged state replays - zero new rows, zero new provenance, zero new audit", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("c9");
    const fixture = await buildEvidenceClaim(orgA, "c9");
    await insertClaimDecision(orgA, fixture.claimId, "approved");
    const first = await assess(orgA, requirement.requirement_id);
    assert.equal(first.data.replayed, false);
    const beforeAudit = await auditEventCount(orgA);

    const second = await assess(orgA, requirement.requirement_id);
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.requirement_assessment_id, first.data.requirement_assessment_id);
    assert.equal(await countRows("requirement_assessments", orgA, requirement.requirement_id), 1);
    assert.equal(await linkCount("requirement_assessment_claim_links", first.data.requirement_assessment_id), 1);
    assert.equal(await linkCount("ra_claim_review_decision_links", first.data.requirement_assessment_id), 1);
    assert.equal(await auditEventCount(orgA), beforeAudit);
  });

  test("C10: exact provenance only - zero rows in requirement_assessment_evidence_links / ra_evidence_review_decision_links / ra_gap_links for this assessment", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("c10");
    const fixture = await buildEvidenceClaim(orgA, "c10");
    await insertClaimDecision(orgA, fixture.claimId, "approved");
    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, true);
    assert.equal(await linkCount("requirement_assessment_evidence_links", result.data.requirement_assessment_id), 0);
    assert.equal(await linkCount("ra_evidence_review_decision_links", result.data.requirement_assessment_id), 0);
    assert.equal(await linkCount("ra_gap_links", result.data.requirement_assessment_id), 0);
    // Membership + decision provenance ARE written.
    assert.equal(await linkCount("requirement_assessment_claim_links", result.data.requirement_assessment_id), 1);
    assert.equal(await linkCount("ra_claim_review_decision_links", result.data.requirement_assessment_id), 1);
  });

  test("C11: cross-tenant rejection - assessing org B never counts, links, or is affected by org A's claims/decisions", async () => {
    const orgA = crypto.randomUUID();
    const orgB = crypto.randomUUID();
    const requirement = await makeRequirement("c11");
    const fixtureA = await buildEvidenceClaim(orgA, "c11a");
    await insertClaimDecision(orgA, fixtureA.claimId, "approved");
    const fixtureB = await buildEvidenceClaim(orgB, "c11b");

    const result = await assess(orgB, requirement.requirement_id);
    assert.equal(result.ok, true);
    assert.equal(result.data.assessment_state, "not_satisfied");
    const { rows: claimLinks } = await pool.query(
      `SELECT claim_id::text AS claim_id FROM kai.requirement_assessment_claim_links WHERE requirement_assessment_id = $1`,
      [result.data.requirement_assessment_id],
    );
    assert.deepEqual(claimLinks.map((r) => r.claim_id), [fixtureB.claimId]);
  });

  test("C12: KAI_SPRINT2_ENABLED disabled -> feature_disabled, zero writes", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("c12");
    await buildEvidenceClaim(orgA, "c12");
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

  test("C13: audit rejection -> full rollback (zero rows in requirement_assessments AND both link tables)", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("c13");
    const fixture = await buildEvidenceClaim(orgA, "c13");
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
    for (const table of ["requirement_assessment_claim_links", "ra_claim_review_decision_links"]) {
      assert.equal(await tableCountForOrg(table, orgA), 0, `expected zero rows in ${table} after rollback`);
    }
    assert.equal(await auditEventCount(orgA), before);
  });

  test("C14: read-back returns the CURRENT assessment with claim/decision provenance, empty evidence/gap ids", async () => {
    const orgA = crypto.randomUUID();
    const requirement = await makeRequirement("c14");
    const fixture = await buildEvidenceClaim(orgA, "c14");
    const decision = await insertClaimDecision(orgA, fixture.claimId, "approved");
    const result = await assess(orgA, requirement.requirement_id);
    assert.equal(result.ok, true);

    const readBack = await getOrganizationRequirementAssessment({
      organizationId: orgA,
      requirementId: requirement.requirement_id,
      actorContext: actorContext("gk_operator", orgA),
    }, { env: trueEnv, requirementAssessmentRepository: repository });

    assert.equal(readBack.ok, true);
    assert.equal(readBack.data.requirement.requirement_key, IR_COMM_002_KEY);
    assert.equal(readBack.data.assessment.requirement_assessment_id, result.data.requirement_assessment_id);
    assert.deepEqual(readBack.data.claim_ids, [fixture.claimId]);
    assert.deepEqual(readBack.data.claim_review_decision_ids, [decision.decisionId]);
    assert.deepEqual(readBack.data.evidence_item_ids, []);
    assert.deepEqual(readBack.data.evidence_review_decision_ids, []);
    assert.deepEqual(readBack.data.current_gap_log_item_ids, []);
  });

  test("C15: fingerprint version string is exactly c3_b_ir_comm_002_v1", async () => {
    const { computeRequirementAssessmentFingerprint } = await import(
      "../Backend/kai/validators/kaiCommunicationAccountabilityAssessmentValidators.js"
    );
    const fp = computeRequirementAssessmentFingerprint({ claims: [] });
    const expected = sha256hex(JSON.stringify({ fingerprint_version: "c3_b_ir_comm_002_v1", claims: [] }));
    assert.equal(fp, expected);
  });
}
