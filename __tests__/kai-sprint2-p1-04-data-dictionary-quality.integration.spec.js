import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.KAI_P1_04_DATA_DICTIONARY_DATABASE_URL) {
  test("P1-04 data-dictionary/quality integration requires the runner-owned database", { skip: true }, () => {});
} else {
  await runDataDictionaryIntegrationSuite();
}

async function runDataDictionaryIntegrationSuite() {
  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const { createPostgresDataDictionaryRepository } = await import(
    "../Backend/kai/dictionary/postgresDataDictionaryRepository.js"
  );
  const { createDraftDataDictionary } = await import("../Backend/kai/services/kaiDataDictionaryService.js");

  const DATABASE_URL = process.env.KAI_P1_04_DATA_DICTIONARY_DATABASE_URL;
  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-04T10:00:00.000Z";

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 8 });
  const repository = createPostgresDataDictionaryRepository({
    runInTransaction: (callback) => withTransaction(callback, pool),
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

  async function resetTables() {
    await withClient((client) => client.query(
      "TRUNCATE kai.upload_lifecycle_audit, kai.upload_policy_decision_replay, kai.data_quality_findings, " +
      "kai.data_dictionary_mappings, kai.data_dictionary_fields, kai.data_dictionaries, " +
      "kai.intake_file_profiles, kai.intake_parser_runs, kai.intake_files",
    ));
  }

  function fileId(index) {
    return `20000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }

  function checksumFor(index) {
    return String(index % 10).repeat(64).slice(0, 63) + "a";
  }

  async function seedIntakeFile(intakeFileId, organizationId, checksum) {
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_files (
         intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
         checksum, hash_algorithm, force_new_version, processing_status, parse_status,
         file_policy_status, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'fixture', 'fixture', $4, 'sha256', true,
               'quarantined', 'quarantined', 'pending', $5::timestamptz)`,
      [intakeFileId, BATCH, organizationId, checksum, NOW],
    ));
  }

  async function seedCompletedProfile({ intakeFileId, organizationId, checksum, profile }) {
    const parserRunResult = await withClient((client) => client.query(
      `INSERT INTO kai.intake_parser_runs (
         organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at
       )
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', $4::timestamptz)
       RETURNING parser_run_id::text AS parser_run_id`,
      [organizationId, intakeFileId, checksum, NOW],
    ));
    const parserRunId = parserRunResult.rows[0].parser_run_id;
    const profileResult = await withClient((client) => client.query(
      `INSERT INTO kai.intake_file_profiles (
         organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'kai_local_profiling_kernel', '1.0.0', $4, $5::jsonb,
               encode(digest($5::jsonb::text, 'sha256'), 'hex'), $6::timestamptz)
       RETURNING file_profile_id::text AS file_profile_id, profile_canonical_sha256`,
      [organizationId, intakeFileId, parserRunId, checksum, JSON.stringify(profile), NOW],
    ));
    await withClient((client) => client.query(
      `UPDATE kai.intake_parser_runs
          SET parser_status = 'completed', completed_at = $3::timestamptz, output_profile_id = $2::uuid
        WHERE parser_run_id = $1::uuid`,
      [parserRunId, profileResult.rows[0].file_profile_id, NOW],
    ));
    return {
      fileProfileId: profileResult.rows[0].file_profile_id,
      profileCanonicalSha256: profileResult.rows[0].profile_canonical_sha256,
    };
  }

  function fixtureProfile() {
    return {
      status: "profiled",
      format: "csv",
      counts: { row_count: 10, column_count: 2, field_count: 2, formula_count: 1, duplicate_row_count: 2 },
      duplicate_row_hints: { has_duplicate_rows: true, duplicate_row_count: 2 },
      fields: [
        {
          field_key: "field_1",
          meaning: "unknown",
          missing_count: 3,
          present_count: 7,
          primitive_type_hints: { blank: 0, boolean: 0, number: 7, date_like: 0, text_like: 0 },
        },
        {
          field_key: "field_2",
          meaning: "unknown",
          missing_count: 0,
          present_count: 10,
          primitive_type_hints: { blank: 0, boolean: 0, number: 5, date_like: 0, text_like: 5 },
        },
      ],
    };
  }

  function createAuditProbe({ prepareOk = true, publishThrows = false, publishRejects = false } = {}) {
    const prepared = [];
    const published = [];
    return {
      prepared,
      published,
      dependency: {
        prepareMetadataOnlyAudit(input) {
          prepared.push(input);
          if (!prepareOk) return { ok: false };
          return {
            ok: true,
            publish() {
              if (publishThrows) throw new Error("synthetic required-audit publish failure");
              if (publishRejects) return Promise.reject(new Error("synthetic required-audit publish rejection"));
              published.push(input);
              return Promise.resolve();
            },
          };
        },
      },
    };
  }

  test.beforeEach(resetTables);

  test("P1-04: creates one draft dictionary bundle with derived fields, mappings, findings, and one required audit row", async () => {
    const intakeFileId = fileId(1);
    const checksum = checksumFor(1);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const { fileProfileId, profileCanonicalSha256 } = await seedCompletedProfile({
      intakeFileId, organizationId: ORG, checksum, profile: fixtureProfile(),
    });

    const audit = createAuditProbe();
    const result = await repository.draftDataDictionary({
      identity: { organizationId: ORG, fileProfileId },
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.dictionary.dictionary_status, "draft");
    assert.equal(result.data.dictionary.field_count, 2);
    assert.equal(result.data.dictionary.mapping_count, 2);
    assert.equal(result.data.dictionary.finding_count, 4);
    assert.equal(audit.published.length, 1);

    const auditRow = await withClient((client) => client.query(
      `SELECT metadata FROM kai.upload_lifecycle_audit WHERE operation = 'data_dictionary_draft_persisted'`,
    ));
    assert.equal(auditRow.rows.length, 1);
    const metadata = auditRow.rows[0].metadata;
    assert.deepEqual(
      Object.keys(metadata).sort(),
      ["contract", "dictionary_status", "field_count", "file_profile_id", "finding_count", "mapping_count", "metadata_only", "profile_canonical_sha256", "validator_key"],
    );
    assert.equal(metadata.contract, "p1_draft_data_dictionary_and_quality_v1");
    assert.equal(metadata.validator_key, "VAL-KAI-P1-04-001");
    assert.equal(metadata.profile_canonical_sha256, profileCanonicalSha256);
    assert.equal(metadata.field_count, 2);
    assert.equal(metadata.mapping_count, 2);
    assert.equal(metadata.finding_count, 4);

    const findingTypes = await withClient((client) => client.query(
      `SELECT finding_type FROM kai.data_quality_findings WHERE data_dictionary_id = $1::uuid ORDER BY finding_type`,
      [result.data.dictionary.data_dictionary_id],
    ));
    assert.deepEqual(findingTypes.rows.map((row) => row.finding_type), ["duplicate_rows", "formula_like_content", "missingness", "type_inconsistency"]);
  });

  test("P1-04: same organization_id + file_profile_id with the same stored hash replays the existing bundle without duplicating rows", async () => {
    const intakeFileId = fileId(2);
    const checksum = checksumFor(2);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const { fileProfileId } = await seedCompletedProfile({ intakeFileId, organizationId: ORG, checksum, profile: fixtureProfile() });

    const first = await repository.draftDataDictionary({
      identity: { organizationId: ORG, fileProfileId },
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(first.ok, true);
    assert.equal(first.data.replayed, false);

    const secondAudit = createAuditProbe();
    const second = await repository.draftDataDictionary({
      identity: { organizationId: ORG, fileProfileId },
      now: NOW,
      metadataOnlyAudit: secondAudit.dependency,
    });
    assert.equal(second.ok, true);
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.dictionary.data_dictionary_id, first.data.dictionary.data_dictionary_id);
    assert.equal(secondAudit.published.length, 0, "replay must not write a second audit row or re-derive facts");

    const dictionaryCount = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.data_dictionaries WHERE organization_id = $1::uuid AND file_profile_id = $2::uuid`,
      [ORG, fileProfileId],
    ));
    assert.equal(dictionaryCount.rows[0].count, 1);
  });

  test("P1-04: a different file_profile_id always creates a separate bundle (no revision/predecessor lineage)", async () => {
    const intakeFileId = fileId(3);
    const checksum1 = checksumFor(3);
    const checksum2 = checksumFor(4);
    await seedIntakeFile(intakeFileId, ORG, checksum1);
    const first = await seedCompletedProfile({ intakeFileId, organizationId: ORG, checksum: checksum1, profile: fixtureProfile() });
    const second = await seedCompletedProfile({ intakeFileId, organizationId: ORG, checksum: checksum2, profile: fixtureProfile() });

    const firstResult = await repository.draftDataDictionary({
      identity: { organizationId: ORG, fileProfileId: first.fileProfileId },
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    const secondResult = await repository.draftDataDictionary({
      identity: { organizationId: ORG, fileProfileId: second.fileProfileId },
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    assert.notEqual(firstResult.data.dictionary.data_dictionary_id, secondResult.data.dictionary.data_dictionary_id);
  });

  test("P1-04: tenant scoping prevents cross-tenant reads of another organization's dictionary bundle", async () => {
    const intakeFileId = fileId(5);
    const checksum = checksumFor(5);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const { fileProfileId } = await seedCompletedProfile({ intakeFileId, organizationId: ORG, checksum, profile: fixtureProfile() });

    await repository.draftDataDictionary({
      identity: { organizationId: ORG, fileProfileId },
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });

    const crossTenantRead = await repository.getDataDictionary({ identity: { organizationId: OTHER_ORG, fileProfileId } });
    assert.equal(crossTenantRead.ok, false);
    assert.equal(crossTenantRead.error.code, "not_found");
  });

  test("P1-04: an unknown file_profile_id is rejected as not_found without creating any bundle", async () => {
    const bogusProfileId = "50000000-0000-4000-8000-000000000999";
    const result = await repository.draftDataDictionary({
      identity: { organizationId: ORG, fileProfileId: bogusProfileId },
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P1-04: a rejected required-audit prepare rolls back every dictionary, field, mapping, and finding write", async () => {
    const intakeFileId = fileId(6);
    const checksum = checksumFor(6);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const { fileProfileId } = await seedCompletedProfile({ intakeFileId, organizationId: ORG, checksum, profile: fixtureProfile() });

    const audit = createAuditProbe({ prepareOk: false });
    const result = await repository.draftDataDictionary({
      identity: { organizationId: ORG, fileProfileId },
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.data_dictionaries`),
      client.query(`SELECT count(*)::int AS count FROM kai.data_dictionary_fields`),
      client.query(`SELECT count(*)::int AS count FROM kai.data_dictionary_mappings`),
      client.query(`SELECT count(*)::int AS count FROM kai.data_quality_findings`),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'data_dictionary_draft_persisted'`),
    ]));
    for (const countResult of counts) assert.equal(countResult.rows[0].count, 0);
  });

  test("P1-04: a rejected publish() promise rolls back every domain write in the same transaction", async () => {
    const intakeFileId = fileId(7);
    const checksum = checksumFor(7);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const { fileProfileId } = await seedCompletedProfile({ intakeFileId, organizationId: ORG, checksum, profile: fixtureProfile() });

    const audit = createAuditProbe({ publishRejects: true });
    await assert.rejects(() => repository.draftDataDictionary({
      identity: { organizationId: ORG, fileProfileId },
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    }).then((result) => {
      if (!result.ok) throw new Error(`draftDataDictionary resolved with a failure instead of propagating the rejection: ${result.error.code}`);
    }));

    const dictionaryCount = await withClient((client) => client.query(`SELECT count(*)::int AS count FROM kai.data_dictionaries`));
    assert.equal(dictionaryCount.rows[0].count, 0);
  });

  test("P1-04: end-to-end via the service seam with KAI_SPRINT2_ENABLED, using the postgres repository", async () => {
    const intakeFileId = fileId(8);
    const checksum = checksumFor(8);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const { fileProfileId } = await seedCompletedProfile({ intakeFileId, organizationId: ORG, checksum, profile: fixtureProfile() });

    const result = await createDraftDataDictionary(
      { organizationId: ORG, fileProfileId, now: NOW },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        dataDictionaryRepository: repository,
        metadataOnlyAudit: createAuditProbe().dependency,
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.dictionary.dictionary_status, "draft");
  });
}
