import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_C3_A3_PROVENANCE_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`C3.A3 provenance integration suite refused a non-loopback runner-owned URL host: ${host}`);
  }
}

test("C3.A3 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("C3.A3 integration requires the runner-owned database", { skip: true }, () => {});
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
         kai.ra_gap_links,
         kai.ra_claim_review_decision_links,
         kai.ra_evidence_review_decision_links,
         kai.claim_review_decisions,
         kai.evidence_review_decisions,
         kai.gap_log_items,
         kai.requirement_assessment_evidence_links,
         kai.requirement_assessment_claim_links,
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
         kai.requirement_sources
       RESTART IDENTITY CASCADE`,
    );
    await pool.query("TRUNCATE kai.engagements, kai.organizations RESTART IDENTITY CASCADE");

    const orgs = await pool.query(
      "INSERT INTO kai.organizations (name) VALUES ('C3.A3 Org A'), ('C3.A3 Org B') RETURNING organization_id",
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
        "INSERT INTO kai.requirement_sources (source_type, source_code, source_name) VALUES ('kai_standard', $1, 'C3.A3 Fixture Source') RETURNING requirement_source_id",
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

    return { evidenceItemId, claimId, sourceVersionId };
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

  async function insertEvidenceDecision(organizationId, evidenceItemId, outcome = "supported") {
    return (
      await pool.query(
        `INSERT INTO kai.evidence_review_decisions
           (organization_id, evidence_item_id, review_queue_item_id, decision_outcome, decided_by, decided_by_role, target_updated_at, created_by_type)
         VALUES ($1, $2, gen_random_uuid(), $3, gen_random_uuid(), 'gk_reviewer', now(), 'human')
         RETURNING decision_id`,
        [organizationId, evidenceItemId, outcome],
      )
    ).rows[0].decision_id;
  }

  async function insertClaimDecision(organizationId, claimId, outcome = "approved") {
    return (
      await pool.query(
        `INSERT INTO kai.claim_review_decisions
           (organization_id, claim_id, review_queue_item_id, decision_outcome, approved_audiences, decided_by, decided_by_role, target_updated_at, created_by_type)
         VALUES ($1, $2, gen_random_uuid(), $3, ARRAY['internal'], gen_random_uuid(), 'gk_reviewer', now(), 'human')
         RETURNING decision_id`,
        [organizationId, claimId, outcome],
      )
    ).rows[0].decision_id;
  }

  async function insertGap(organizationId, claimId, evidenceItemId, sourceVersionId, dimensionKey = "missingness") {
    return (
      await pool.query(
        `INSERT INTO kai.gap_log_items
           (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary, created_by_type)
         VALUES ($1, $2, $3, $4, $5, 'resolved_risk_flagged', 'VAL-KAI-P2-02-missingness', $6, 'system')
         RETURNING gap_log_item_id`,
        [organizationId, claimId, evidenceItemId, sourceVersionId, dimensionKey, `Claim gap requires review for dimension: ${dimensionKey}.`],
      )
    ).rows[0].gap_log_item_id;
  }

  test("forward migration produced exactly the three new C3.A3 tables", async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'kai' AND table_name IN
       ('ra_evidence_review_decision_links', 'ra_claim_review_decision_links', 'ra_gap_links')`,
    );
    assert.deepEqual(
      rows.map((r) => r.table_name).sort(),
      [
        "ra_claim_review_decision_links",
        "ra_evidence_review_decision_links",
        "ra_gap_links",
      ].sort(),
    );
  });

  test("same-tenant evidence-decision, claim-decision, and gap links all succeed", async () => {
    const requirement = await makeRequirement("st1");
    const { evidenceItemId, claimId, sourceVersionId } = await buildEvidenceClaimFixture(orgA, "st1");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("st1"));
    const evidenceDecisionId = await insertEvidenceDecision(orgA, evidenceItemId);
    const claimDecisionId = await insertClaimDecision(orgA, claimId);
    const gapId = await insertGap(orgA, claimId, evidenceItemId, sourceVersionId);

    const evidenceLink = await pool.query(
      `INSERT INTO kai.ra_evidence_review_decision_links (organization_id, requirement_assessment_id, evidence_item_id, decision_id)
       VALUES ($1, $2, $3, $4) RETURNING ra_evidence_review_decision_link_id`,
      [orgA, assessmentId, evidenceItemId, evidenceDecisionId],
    );
    assert.ok(evidenceLink.rows[0].ra_evidence_review_decision_link_id);

    const claimLink = await pool.query(
      `INSERT INTO kai.ra_claim_review_decision_links (organization_id, requirement_assessment_id, claim_id, decision_id)
       VALUES ($1, $2, $3, $4) RETURNING ra_claim_review_decision_link_id`,
      [orgA, assessmentId, claimId, claimDecisionId],
    );
    assert.ok(claimLink.rows[0].ra_claim_review_decision_link_id);

    const gapLink = await pool.query(
      `INSERT INTO kai.ra_gap_links
         (organization_id, requirement_assessment_id, gap_log_item_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'missingness', 'resolved_risk_flagged') RETURNING ra_gap_link_id`,
      [orgA, assessmentId, gapId, claimId, evidenceItemId, sourceVersionId],
    );
    assert.ok(gapLink.rows[0].ra_gap_link_id);
  });

  test("cross-tenant evidence-decision link fails", async () => {
    const requirement = await makeRequirement("ct1");
    const { evidenceItemId: evidenceItemA } = await buildEvidenceClaimFixture(orgA, "ct1a");
    const { evidenceItemId: evidenceItemB } = await buildEvidenceClaimFixture(orgB, "ct1b");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("ct1"));
    const decisionB = await insertEvidenceDecision(orgB, evidenceItemB);

    await assert.rejects(
      pool.query(
        `INSERT INTO kai.ra_evidence_review_decision_links (organization_id, requirement_assessment_id, evidence_item_id, decision_id)
         VALUES ($1, $2, $3, $4)`,
        [orgA, assessmentId, evidenceItemA, decisionB],
      ),
      /violates foreign key constraint/,
    );
  });

  test("cross-tenant claim-decision link fails", async () => {
    const requirement = await makeRequirement("ct2");
    const { claimId: claimA } = await buildEvidenceClaimFixture(orgA, "ct2a");
    const { claimId: claimB } = await buildEvidenceClaimFixture(orgB, "ct2b");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("ct2"));
    const decisionB = await insertClaimDecision(orgB, claimB);

    await assert.rejects(
      pool.query(
        `INSERT INTO kai.ra_claim_review_decision_links (organization_id, requirement_assessment_id, claim_id, decision_id)
         VALUES ($1, $2, $3, $4)`,
        [orgA, assessmentId, claimA, decisionB],
      ),
      /violates foreign key constraint/,
    );
  });

  test("cross-tenant gap link fails", async () => {
    const requirement = await makeRequirement("ct3");
    const fixtureA = await buildEvidenceClaimFixture(orgA, "ct3a");
    const fixtureB = await buildEvidenceClaimFixture(orgB, "ct3b");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("ct3"));
    const gapB = await insertGap(orgB, fixtureB.claimId, fixtureB.evidenceItemId, fixtureB.sourceVersionId);

    await assert.rejects(
      pool.query(
        `INSERT INTO kai.ra_gap_links
           (organization_id, requirement_assessment_id, gap_log_item_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status)
         VALUES ($1, $2, $3, $4, $5, $6, 'missingness', 'resolved_risk_flagged')`,
        [orgA, assessmentId, gapB, fixtureA.claimId, fixtureA.evidenceItemId, fixtureA.sourceVersionId],
      ),
      // The BEFORE INSERT snapshot-verification trigger runs before the FK
      // constraint is checked, so a cross-tenant gap_log_item_id is caught
      // by the trigger's own tenant-scoped lookup ("no ... row found for
      // gap_log_item_id ... in organization ...") rather than surfacing as
      // an FK violation - both are the same tenant-safety guarantee.
      /(violates foreign key constraint|no kai\.gap_log_items row found)/,
    );
  });

  test("duplicate links fail on all three tables", async () => {
    const requirement = await makeRequirement("dup1");
    const { evidenceItemId, claimId, sourceVersionId } = await buildEvidenceClaimFixture(orgA, "dup1");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("dup1"));
    const evidenceDecisionId = await insertEvidenceDecision(orgA, evidenceItemId);
    const claimDecisionId = await insertClaimDecision(orgA, claimId);
    const gapId = await insertGap(orgA, claimId, evidenceItemId, sourceVersionId);

    const insertEvidenceLink = () =>
      pool.query(
        `INSERT INTO kai.ra_evidence_review_decision_links (organization_id, requirement_assessment_id, evidence_item_id, decision_id)
         VALUES ($1, $2, $3, $4)`,
        [orgA, assessmentId, evidenceItemId, evidenceDecisionId],
      );
    await insertEvidenceLink();
    await assert.rejects(insertEvidenceLink(), /duplicate key value violates unique constraint/);

    const insertClaimLink = () =>
      pool.query(
        `INSERT INTO kai.ra_claim_review_decision_links (organization_id, requirement_assessment_id, claim_id, decision_id)
         VALUES ($1, $2, $3, $4)`,
        [orgA, assessmentId, claimId, claimDecisionId],
      );
    await insertClaimLink();
    await assert.rejects(insertClaimLink(), /duplicate key value violates unique constraint/);

    const insertGapLink = () =>
      pool.query(
        `INSERT INTO kai.ra_gap_links
           (organization_id, requirement_assessment_id, gap_log_item_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status)
         VALUES ($1, $2, $3, $4, $5, $6, 'missingness', 'resolved_risk_flagged')`,
        [orgA, assessmentId, gapId, claimId, evidenceItemId, sourceVersionId],
      );
    await insertGapLink();
    await assert.rejects(insertGapLink(), /duplicate key value violates unique constraint/);
  });

  test("decision historical identity remains exact: citing the right decision_id with the wrong subject id fails", async () => {
    const requirement = await makeRequirement("id1");
    const fixture1 = await buildEvidenceClaimFixture(orgA, "id1a");
    const fixture2 = await buildEvidenceClaimFixture(orgA, "id1b");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("id1"));
    const decisionForFixture1 = await insertEvidenceDecision(orgA, fixture1.evidenceItemId);

    await assert.rejects(
      pool.query(
        `INSERT INTO kai.ra_evidence_review_decision_links (organization_id, requirement_assessment_id, evidence_item_id, decision_id)
         VALUES ($1, $2, $3, $4)`,
        [orgA, assessmentId, fixture2.evidenceItemId, decisionForFixture1],
      ),
      /violates foreign key constraint/,
      "a decision_id may only be cited together with the exact evidence_item_id it was decided against",
    );
  });

  test("gap historical state round-trips exactly", async () => {
    const requirement = await makeRequirement("gh1");
    const { evidenceItemId, claimId, sourceVersionId } = await buildEvidenceClaimFixture(orgA, "gh1");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("gh1"));
    const gapId = await insertGap(orgA, claimId, evidenceItemId, sourceVersionId, "duplicates");

    await pool.query(
      `INSERT INTO kai.ra_gap_links
         (organization_id, requirement_assessment_id, gap_log_item_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'duplicates', 'resolved_risk_flagged')`,
      [orgA, assessmentId, gapId, claimId, evidenceItemId, sourceVersionId],
    );

    const source = (await pool.query(`SELECT * FROM kai.gap_log_items WHERE gap_log_item_id = $1`, [gapId])).rows[0];
    const link = (
      await pool.query(`SELECT * FROM kai.ra_gap_links WHERE gap_log_item_id = $1`, [gapId])
    ).rows[0];
    assert.equal(link.claim_id, source.claim_id);
    assert.equal(link.evidence_item_id, source.evidence_item_id);
    assert.equal(link.source_version_id, source.source_version_id);
    assert.equal(link.dimension_key, source.dimension_key);
    assert.equal(link.assessment_status, source.assessment_status);
  });

  test("a gap link snapshot that does not match the live gap_log_items row at insert time is rejected", async () => {
    const requirement = await makeRequirement("gh2");
    const { evidenceItemId, claimId, sourceVersionId } = await buildEvidenceClaimFixture(orgA, "gh2");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("gh2"));
    const gapId = await insertGap(orgA, claimId, evidenceItemId, sourceVersionId, "duplicates");

    await assert.rejects(
      pool.query(
        `INSERT INTO kai.ra_gap_links
           (organization_id, requirement_assessment_id, gap_log_item_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status)
         VALUES ($1, $2, $3, $4, $5, $6, 'missingness', 'resolved_risk_flagged')`,
        [orgA, assessmentId, gapId, claimId, evidenceItemId, sourceVersionId],
      ),
      /snapshot does not match/,
    );
  });

  test("later live source/P2 changes do not alter stored assessment provenance, and the stored gap-link snapshot is itself append-only", async () => {
    const requirement = await makeRequirement("live1");
    const { evidenceItemId, claimId, sourceVersionId } = await buildEvidenceClaimFixture(orgA, "live1");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("live1"));
    const gapId = await insertGap(orgA, claimId, evidenceItemId, sourceVersionId);

    await pool.query(
      `INSERT INTO kai.ra_gap_links
         (organization_id, requirement_assessment_id, gap_log_item_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'missingness', 'resolved_risk_flagged')`,
      [orgA, assessmentId, gapId, claimId, evidenceItemId, sourceVersionId],
    );
    const before = (
      await pool.query(`SELECT * FROM kai.ra_gap_links WHERE gap_log_item_id = $1`, [gapId])
    ).rows[0];

    // Simulate the live source/P2-02 state later diverging from what it was
    // at cite time (source_versions.is_current flipping is exactly the
    // signal C3A3.2/C3A3.3 identified as making a gap stale for *current*
    // exposure purposes).
    await pool.query(`UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1`, [sourceVersionId]);

    const after = (
      await pool.query(`SELECT * FROM kai.ra_gap_links WHERE gap_log_item_id = $1`, [gapId])
    ).rows[0];
    assert.deepEqual(after, before, "stored provenance snapshot must not change when live state later diverges");

    await assert.rejects(
      pool.query(`UPDATE kai.ra_gap_links SET assessment_status = 'unresolved' WHERE gap_log_item_id = $1`, [gapId]),
      /append-only/,
    );
    await assert.rejects(
      pool.query(`DELETE FROM kai.ra_gap_links WHERE gap_log_item_id = $1`, [gapId]),
      /append-only/,
    );
  });

  test("rollback removes only the three new C3.A3 objects and leaves every prerequisite (including existing C2.1 evidence/claim links) intact", async () => {
    const requirement = await makeRequirement("rb1");
    const { evidenceItemId, claimId, sourceVersionId } = await buildEvidenceClaimFixture(orgA, "rb1");
    const assessmentId = await insertAssessment(orgA, engagementA, requirement.requirement_id, sha256hex("rb1"));

    // Existing C2.1 provenance, written before rollback, to prove it survives.
    await pool.query(
      `INSERT INTO kai.requirement_assessment_evidence_links (organization_id, requirement_assessment_id, evidence_item_id) VALUES ($1, $2, $3)`,
      [orgA, assessmentId, evidenceItemId],
    );
    await pool.query(
      `INSERT INTO kai.requirement_assessment_claim_links (organization_id, requirement_assessment_id, claim_id) VALUES ($1, $2, $3)`,
      [orgA, assessmentId, claimId],
    );

    const { readFileSync } = await import("node:fs");
    const rollbackSql = readFileSync(
      "migrations/kai_sprint2_c3_a3_requirement_assessment_decision_gap_provenance.rollback.sql",
      "utf8",
    );
    await pool.query(rollbackSql);

    const remaining = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'kai' AND table_name IN
       ('ra_evidence_review_decision_links', 'ra_claim_review_decision_links', 'ra_gap_links')`,
    );
    assert.equal(remaining.rows.length, 0, "rollback must remove all three new C3.A3 tables");

    const prerequisites = await pool.query(`
      SELECT
        to_regclass('kai.requirement_assessments') AS requirement_assessments,
        to_regclass('kai.evidence_review_decisions') AS evidence_review_decisions,
        to_regclass('kai.claim_review_decisions') AS claim_review_decisions,
        to_regclass('kai.gap_log_items') AS gap_log_items,
        to_regclass('kai.requirement_assessment_evidence_links') AS evidence_links,
        to_regclass('kai.requirement_assessment_claim_links') AS claim_links
    `);
    for (const [name, value] of Object.entries(prerequisites.rows[0])) {
      assert.ok(value, `rollback must not remove prerequisite object: kai.${name}`);
    }

    const existingLinks = await pool.query(
      `SELECT count(*)::int AS n FROM kai.requirement_assessment_evidence_links WHERE requirement_assessment_id = $1`,
      [assessmentId],
    );
    assert.equal(existingLinks.rows[0].n, 1, "existing C2.1 evidence provenance row must survive rollback");

    // Re-apply the forward migration so later tests in this file/run see the
    // schema restored (mirrors the C2.1 precedent script's own single-shot
    // rollback proof, but this suite runs multiple tests in one process).
    const { spawnSync } = await import("node:child_process");
    const binDir = process.env.PG_BIN_DIR || "/opt/homebrew/opt/postgresql@16/bin";
    const url = new URL(RUNNER_OWNED_DATABASE_URL);
    spawnSync(`${binDir}/psql`, [
      "-h", url.hostname, "-p", url.port, "-d", url.pathname.slice(1),
      "-v", "ON_ERROR_STOP=1",
      "-f", "migrations/kai_sprint2_c3_a3_requirement_assessment_decision_gap_provenance.sql",
    ], { encoding: "utf8" });
  });
}
