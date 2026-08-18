import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_02_EVIDENCE_COVERAGE_ASSESSMENT_DATABASE_URL;

/**
 * PostgreSQL isolation, following the exact P2-01C-corrected pattern in
 * __tests__/kai-sprint2-p2-01-evidence-lineage.integration.spec.js: the
 * runner-owned database URL is validated as loopback-only synchronously,
 * before this file performs a single dynamic import of `pg`,
 * `Backend/kai/db/kaiDb.js`, or any P2-02 module.
 */
function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P2-02 integration suite refused a non-loopback KAI_P2_02_EVIDENCE_COVERAGE_ASSESSMENT_DATABASE_URL host: ${host}`);
  }
}

test("P2-02 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  for (const url of ["postgresql://user@example.com:5432/db", "postgresql://user@10.0.0.5:5432/db", "postgresql://user@my-internal-host.internal:5432/db"]) {
    assert.throws(() => assertLoopbackDatabaseUrl(url), /refused a non-loopback/);
  }
  for (const url of ["postgresql://user@127.0.0.1:59123/db", "postgresql://user@localhost:59123/db"]) {
    assert.doesNotThrow(() => assertLoopbackDatabaseUrl(url));
  }
});

test("P2-02 PostgreSQL isolation: this file imports no database module at its top level and never imports Backend/kai/db/kaiDb.js", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(
    topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresEvidenceCoverageAssessmentRepository\.js|kaiEvidenceCoverageAssessmentService\.js/.test(line)),
    "expected every database-capable module to be imported dynamically, never at the top level",
  );
  assert.doesNotMatch(
    ownSource,
    /from\s+["']\.\.\/Backend\/kai\/db\/kaiDb\.js["']/,
    "the P2-02 integration suite must never import the ambient kaiDb.js pool - it uses a test-local transaction wrapper over its own runner-owned Pool instead",
  );
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P2-02 evidence-coverage-assessment integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runEvidenceCoverageAssessmentIntegrationSuite();
}

async function runEvidenceCoverageAssessmentIntegrationSuite() {
  const { Pool } = await import("pg");
  const { createPostgresEvidenceCoverageAssessmentRepository } = await import(
    "../Backend/kai/dictionary/postgresEvidenceCoverageAssessmentRepository.js"
  );
  const { assessEvidenceCoverageForSourceVersion } = await import(
    "../Backend/kai/services/kaiEvidenceCoverageAssessmentService.js"
  );

  const DATABASE_URL = RUNNER_OWNED_DATABASE_URL;
  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-06T10:00:00.000Z";
  const REVIEWED_TYPE = "organization_primary_record";

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 8 });

  /**
   * Test-local transaction wrapper over the already-validated runner-owned
   * Pool, deliberately reimplemented here rather than imported from
   * Backend/kai/db/kaiDb.js - mirrors the P2-01 integration suite exactly, so
   * this suite never import-time-initializes the ambient application pool.
   */
  async function withRunnerOwnedTransaction(callback, ownPool = pool) {
    const client = await ownPool.connect();
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

  const repository = createPostgresEvidenceCoverageAssessmentRepository({
    runInTransaction: (callback) => withRunnerOwnedTransaction(callback, pool),
  });

  test.after(async () => {
    await pool.end();
  });

  async function withClient(callback) {
    const client = await pool.connect();
    try {
      return await callback(client);
    } finally {
      client.release();
    }
  }

  function fileId(index) {
    return `22000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function candidateId(index) {
    return `92000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function sensitivityId(index) {
    return `82000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function fileProfileId(index) {
    return `52000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function dictionaryId(index) {
    // Uses a 63000000... prefix, distinct from the 61000000.../62000000...
    // fixture ids already committed by the chained P1-05/.../P2-01 smoke-seed
    // scripts and by the P2-01 integration suite's own 62000000... fixtures,
    // avoiding a data_dictionaries_pkey collision with either.
    return `63000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function sourceId(index) {
    return `73000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function checksumFor(index) {
    const hex = index.toString(16).padStart(2, "0");
    return hex.repeat(32).slice(0, 64);
  }

  /**
   * Seeds one fully promoted P1-08 source_version whose committed
   * P1-04/P1-05 dictionary/quality/sensitivity metadata and P2-01 evidence
   * are exactly parameterized by the caller, so each test can prove one
   * specific committed-fact scenario without depending on any other test's
   * fixture state.
   */
  async function seedAssessableSourceVersion(index, {
    organizationId = ORG,
    fields = [
      { key: "email", type: "text", businessMeaning: "unknown", entityLevel: "unknown" },
      { key: "signup_count", type: "number", businessMeaning: "count of signups in the period", entityLevel: "household" },
    ],
    qualityFindings = [],
    sensitivityOverrides = {},
    evidenceFieldKeys = [],
  } = {}) {
    const intakeFileId = fileId(index);
    const checksum = checksumFor(index);
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_files (
         intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
         checksum, hash_algorithm, force_new_version, processing_status, parse_status,
         file_policy_status, upload_state, object_version_id, verified_checksum,
         verified_size_bytes, verified_at, upload_state_changed_at, upload_expires_at, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'fixture', 'fixture', $4, 'sha256', true,
               'quarantined', 'quarantined', 'pending', 'confirmed', 'v1', $4, 1024,
               $5::timestamptz, $5::timestamptz, $5::timestamptz + interval '24 hours', $5::timestamptz)`,
      [intakeFileId, BATCH, organizationId, checksum, NOW],
    ));
    const parserRunResult = await withClient((client) => client.query(
      `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', $4::timestamptz)
       RETURNING parser_run_id::text AS parser_run_id`,
      [organizationId, intakeFileId, checksum, NOW],
    ));
    const parserRunId = parserRunResult.rows[0].parser_run_id;
    const profile = { status: "profiled", format: "csv", counts: { row_count: 1, column_count: fields.length, field_count: fields.length } };
    const fileProfileIdValue = fileProfileId(index);
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_file_profiles (
         file_profile_id, organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'kai_local_profiling_kernel', '1.0.0', $5, $6::jsonb, $7, $8::timestamptz)`,
      [fileProfileIdValue, organizationId, intakeFileId, parserRunId, checksum, JSON.stringify(profile), checksum, NOW],
    ));
    const dataDictionaryId = dictionaryId(index);
    await withClient((client) => client.query(
      `INSERT INTO kai.data_dictionaries (data_dictionary_id, organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::timestamptz)`,
      [dataDictionaryId, organizationId, intakeFileId, fileProfileIdValue, checksum, NOW],
    ));
    for (const field of fields) {
      await withClient((client) => client.query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type, business_meaning, entity_level)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, $5, $6, $7)`,
        [dataDictionaryId, organizationId, fileProfileIdValue, field.key, field.type, field.businessMeaning || "unknown", field.entityLevel || "unknown"],
      ));
    }
    for (const finding of qualityFindings) {
      await withClient((client) => client.query(
        `INSERT INTO kai.data_quality_findings (data_dictionary_id, organization_id, file_profile_id, profile_field_key, finding_type, finding_detail_safe)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)`,
        [dataDictionaryId, organizationId, fileProfileIdValue, finding.profileFieldKey, finding.findingType, finding.detail || "Committed quality finding."],
      ));
    }
    const intakeSensitivityProfileId = sensitivityId(index);
    const sensitivity = {
      small_cell_risk_status: "unknown",
      allowed_use_status: "unknown",
      ...sensitivityOverrides,
    };
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_sensitivity_profiles (
         intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id,
         profile_canonical_sha256, small_cell_risk_status, allowed_use_status, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9::timestamptz)`,
      [intakeSensitivityProfileId, organizationId, intakeFileId, fileProfileIdValue, dataDictionaryId, checksum, sensitivity.small_cell_risk_status, sensitivity.allowed_use_status, NOW],
    ));
    const intakeSourceCandidateId = candidateId(index);
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_source_candidates (
         intake_source_candidate_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id,
         intake_sensitivity_profile_id, profile_canonical_sha256, candidate_status, created_by_type
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, 'promoted', 'human')`,
      [intakeSourceCandidateId, organizationId, intakeFileId, fileProfileIdValue, dataDictionaryId, intakeSensitivityProfileId, checksum],
    ));
    const reviewItemResult = await withClient((client) => client.query(
      `INSERT INTO kai.review_queue_items (
         organization_id, queue_type, target_object_type, target_object_id,
         priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
       ) VALUES ($1::uuid, 'source_candidate_review', 'intake_source_candidate', $2::uuid,
                 'medium', 'resolved', 'resolved', 'Review intake source-candidate stub for human classification.',
                 'Human review is required.', '{"p0_stub":true}'::jsonb, 'human')
       RETURNING review_queue_item_id::text AS review_queue_item_id`,
      [organizationId, intakeSourceCandidateId],
    ));
    const reviewQueueItemId = reviewItemResult.rows[0].review_queue_item_id;
    const sourceIdValue = sourceId(index);
    await withClient((client) => client.query(
      `INSERT INTO kai.sources (source_id, organization_id, source_code, reviewed_source_type, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'human')`,
      [sourceIdValue, organizationId, checksum, REVIEWED_TYPE],
    ));
    const sourceVersionResult = await withClient((client) => client.query(
      `INSERT INTO kai.source_versions (organization_id, source_id, intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'human')
       RETURNING source_version_id::text AS source_version_id`,
      [organizationId, sourceIdValue, intakeSourceCandidateId, intakeSensitivityProfileId, checksum],
    ));
    const sourceVersionId = sourceVersionResult.rows[0].source_version_id;
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_promotion_decisions (
         organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type,
         decision_status, source_id, source_version_id, promoted_at, created_by_type
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'promoted', $5::uuid, $6::uuid, $7::timestamptz, 'human')`,
      [organizationId, intakeSourceCandidateId, reviewQueueItemId, REVIEWED_TYPE, sourceIdValue, sourceVersionId, NOW],
    ));

    for (const fieldKey of evidenceFieldKeys) {
      const coordinates = { column_name: fieldKey };
      const locatorFingerprintResult = await withClient((client) => client.query(`SELECT encode(sha256(($1)::bytea), 'hex') AS fingerprint`, [`${organizationId}|${sourceVersionId}|column|${fieldKey}`]));
      const locatorFingerprint = locatorFingerprintResult.rows[0].fingerprint;
      const locatorResult = await withClient((client) => client.query(
        `INSERT INTO kai.source_locators (organization_id, source_version_id, locator_type, coordinates, locator_fingerprint, created_by_type)
         VALUES ($1::uuid, $2::uuid, 'column', $3::jsonb, $4, 'system')
         RETURNING source_locator_id::text AS source_locator_id`,
        [organizationId, sourceVersionId, JSON.stringify(coordinates), locatorFingerprint],
      ));
      const sourceLocatorId = locatorResult.rows[0].source_locator_id;
      const statement = `Field '${fieldKey}' is present in the committed data dictionary.`;
      const statementFingerprintResult = await withClient((client) => client.query(`SELECT encode(sha256(($1)::bytea), 'hex') AS fingerprint`, [`${organizationId}|${sourceVersionId}|dictionary_field_presence_fact|${fieldKey}`]));
      const statementFingerprint = statementFingerprintResult.rows[0].fingerprint;
      await withClient((client) => client.query(
        `INSERT INTO kai.evidence_items (
           organization_id, source_id, source_version_id, source_locator_id, evidence_type, data_class,
           sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type
         ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'dictionary_field_presence_fact', 'organization_committed_metadata',
                   'unknown', 'unassessed', $5, $6, 'system')`,
        [organizationId, sourceIdValue, sourceVersionId, sourceLocatorId, statement, statementFingerprint],
      ));
    }

    return { organizationId, intakeFileId, intakeSourceCandidateId, intakeSensitivityProfileId, dataDictionaryId, sourceId: sourceIdValue, sourceVersionId, fieldCount: fields.length };
  }

  function humanActor(overrides = {}) {
    return {
      actorType: "human",
      actorUserId: "93000000-0000-4000-8000-000000000001",
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
      ...overrides,
    };
  }

  test("P2-02 (a): repository reads exactly the committed dictionary-field, quality-finding, and evidence-coverage facts for a promoted source_version", async () => {
    const seed = await seedAssessableSourceVersion(1, {
      fields: [
        { key: "email", type: "text", businessMeaning: "unknown", entityLevel: "unknown" },
        { key: "signup_count", type: "number", businessMeaning: "count of signups in the period", entityLevel: "household" },
      ],
      qualityFindings: [{ profileFieldKey: "email", findingType: "missingness" }],
      sensitivityOverrides: { small_cell_risk_status: "present", allowed_use_status: "unknown" },
      evidenceFieldKeys: ["email"],
    });

    const result = await repository.readEvidenceCoverageAssessmentFacts({
      organizationId: ORG,
      sourceVersionId: seed.sourceVersionId,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    const { rows } = result.data;
    assert.equal(rows.sourceVersionRow.source_version_id, seed.sourceVersionId);
    assert.equal(rows.sourceVersionRow.is_current, true);
    assert.equal(rows.dictionaryRow.data_dictionary_id, seed.dataDictionaryId);
    assert.equal(rows.dictionaryFieldRows.length, 2);
    assert.deepEqual(rows.dictionaryFieldRows.map((row) => row.profile_field_key), ["email", "signup_count"]);
    assert.equal(rows.dictionaryFieldRows[0].business_meaning, "unknown");
    assert.equal(rows.dictionaryFieldRows[1].business_meaning, "count of signups in the period");
    assert.equal(rows.qualityFindingRows.length, 1);
    assert.equal(rows.qualityFindingRows[0].finding_type, "missingness");
    assert.equal(rows.profileRow.small_cell_risk_status, "present");
    assert.deepEqual(rows.evidenceFieldKeys, ["email"]);
  });

  test("P2-02 (b): the service composes the repository's committed facts into all ten dimension results end to end", async () => {
    const seed = await seedAssessableSourceVersion(2, {
      fields: [
        { key: "email", type: "text", businessMeaning: "unknown", entityLevel: "unknown" },
        { key: "signup_count", type: "number", businessMeaning: "count of signups in the period", entityLevel: "household" },
      ],
      qualityFindings: [
        { profileFieldKey: "email", findingType: "missingness" },
        { profileFieldKey: "file_level", findingType: "duplicate_rows" },
      ],
      sensitivityOverrides: { small_cell_risk_status: "absent", allowed_use_status: "unknown" },
      evidenceFieldKeys: ["email", "signup_count"],
    });

    const result = await assessEvidenceCoverageForSourceVersion(
      { organizationId: ORG, sourceVersionId: seed.sourceVersionId, actorContext: humanActor() },
      { evidenceCoverageAssessmentRepository: repository, env: { KAI_SPRINT2_ENABLED: "true" } },
    );

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.dimensions.missingness.evidence.assessment_status, "resolved_risk_flagged");
    assert.equal(result.data.dimensions.duplicates.evidence.assessment_status, "resolved_risk_flagged");
    assert.equal(result.data.dimensions.definition_clarity.evidence.assessment_status, "resolved_risk_flagged");
    assert.equal(result.data.dimensions.entity_level_clarity.evidence.assessment_status, "resolved_risk_flagged");
    assert.equal(result.data.dimensions.small_cell_risk.evidence.assessment_status, "resolved_clear");
    assert.equal(result.data.dimensions.coverage_gaps.evidence.assessment_status, "resolved_clear");
    assert.equal(result.data.dimensions.denominator_clarity.evidence.assessment_status, "unresolved");
    assert.equal(result.data.dimensions.time_period_clarity.evidence.assessment_status, "unresolved");
    assert.equal(result.data.dimensions.conflicting_source_indicators.evidence.assessment_status, "unresolved");
    assert.equal(result.data.dimensions.requirement_alignment.evidence.assessment_status, "unresolved");
  });

  test("P2-02 (c): a source_version belonging to a different organization is never read across the tenant boundary", async () => {
    const seed = await seedAssessableSourceVersion(3, { organizationId: OTHER_ORG });

    const result = await repository.readEvidenceCoverageAssessmentFacts({
      organizationId: ORG,
      sourceVersionId: seed.sourceVersionId,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.rows.sourceVersionRow, null);
    assert.equal(result.data.rows.dictionaryRow, null);
    assert.deepEqual(result.data.rows.dictionaryFieldRows, []);
    assert.deepEqual(result.data.rows.qualityFindingRows, []);
  });

  test("P2-02 (d): allowed_use_status 'not_allowed' fails the service closed even though the repository read itself succeeds", async () => {
    const seed = await seedAssessableSourceVersion(4, { sensitivityOverrides: { allowed_use_status: "not_allowed" } });

    const result = await assessEvidenceCoverageForSourceVersion(
      { organizationId: ORG, sourceVersionId: seed.sourceVersionId, actorContext: humanActor() },
      { evidenceCoverageAssessmentRepository: repository, env: { KAI_SPRINT2_ENABLED: "true" } },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
  });

  test("P2-02 (e): a non-existent source_version_id returns not_found with an all-null read, never a fabricated fact", async () => {
    const result = await repository.readEvidenceCoverageAssessmentFacts({
      organizationId: ORG,
      sourceVersionId: "79999999-0000-4000-8000-000000000099",
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.rows.sourceVersionRow, null);

    const serviceResult = await assessEvidenceCoverageForSourceVersion(
      { organizationId: ORG, sourceVersionId: "79999999-0000-4000-8000-000000000099", actorContext: humanActor() },
      { evidenceCoverageAssessmentRepository: repository, env: { KAI_SPRINT2_ENABLED: "true" } },
    );
    assert.equal(serviceResult.ok, false);
    assert.equal(serviceResult.error.code, "not_found");
  });
}
