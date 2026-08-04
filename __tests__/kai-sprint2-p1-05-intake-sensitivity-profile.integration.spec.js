import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.KAI_P1_05_SENSITIVITY_PROFILE_DATABASE_URL) {
  test("P1-05 intake-sensitivity-profile integration requires the runner-owned database", { skip: true }, () => {});
} else {
  await runSensitivityProfileIntegrationSuite();
}

async function runSensitivityProfileIntegrationSuite() {
  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const { createPostgresIntakeSensitivityProfileRepository } = await import(
    "../Backend/kai/dictionary/postgresIntakeSensitivityProfileRepository.js"
  );
  const { persistIntakeSensitivityProfile } = await import("../Backend/kai/services/kaiIntakeSensitivityProfileService.js");

  const DATABASE_URL = process.env.KAI_P1_05_SENSITIVITY_PROFILE_DATABASE_URL;
  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-04T10:00:00.000Z";

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 8 });
  const repository = createPostgresIntakeSensitivityProfileRepository({
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
      "TRUNCATE kai.upload_lifecycle_audit, kai.upload_policy_decision_replay, kai.intake_sensitivity_profiles, " +
      "kai.data_quality_findings, kai.data_dictionary_mappings, kai.data_dictionary_fields, kai.data_dictionaries, " +
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

  async function seedDictionary({ organizationId, intakeFileId, fileProfileId, profileCanonicalSha256 }) {
    const result = await withClient((client) => client.query(
      `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz)
       RETURNING data_dictionary_id::text AS data_dictionary_id`,
      [organizationId, intakeFileId, fileProfileId, profileCanonicalSha256, NOW],
    ));
    return result.rows[0].data_dictionary_id;
  }

  function fixtureProfile(extra = {}) {
    return {
      status: "profiled",
      format: "csv",
      counts: { row_count: 10, column_count: 2, field_count: 2 },
      fields: [{ field_key: "field_1" }, { field_key: "field_2" }],
      ...extra,
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

  async function seedFullLineage(index, { profile } = {}) {
    const intakeFileId = fileId(index);
    const checksum = checksumFor(index);
    await seedIntakeFile(intakeFileId, ORG, checksum);
    const { fileProfileId, profileCanonicalSha256 } = await seedCompletedProfile({
      intakeFileId, organizationId: ORG, checksum, profile: profile ?? fixtureProfile(),
    });
    const dataDictionaryId = await seedDictionary({
      organizationId: ORG, intakeFileId, fileProfileId, profileCanonicalSha256,
    });
    return { intakeFileId, fileProfileId, profileCanonicalSha256, dataDictionaryId };
  }

  test.beforeEach(resetTables);

  test("P1-05: creates one sensitivity profile row with every dimension defaulting to unknown and one required audit row", async () => {
    const { fileProfileId, dataDictionaryId, profileCanonicalSha256 } = await seedFullLineage(1);

    const audit = createAuditProbe();
    const result = await repository.persistIntakeSensitivityProfile({
      identity: { organizationId: ORG, fileProfileId, dataDictionaryId },
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.replayed, false);
    const row = result.data.sensitivityProfile;
    assert.equal(row.pii_status, "unknown");
    assert.equal(row.minor_data_status, "unknown");
    assert.equal(row.health_housing_justice_immigration_status, "unknown");
    assert.equal(row.indigenous_governance_status, "unknown");
    assert.equal(row.staff_notes_status, "unknown");
    assert.equal(row.story_testimonial_status, "unknown");
    assert.equal(row.small_cell_risk_status, "unknown");
    assert.equal(row.financial_records_status, "unknown");
    assert.equal(row.consent_basis_status, "unknown");
    assert.equal(row.allowed_use_status, "unknown");
    assert.equal(row.llm_processing_allowed, false);
    assert.equal(row.product_learning_allowed, false);
    assert.equal(row.public_use_allowed, false);
    assert.equal(row.funder_use_allowed, false);
    assert.equal(row.human_review_required, true);
    assert.equal(row.retention_posture, "restricted_pending_review");
    assert.equal(audit.published.length, 1);

    const auditRow = await withClient((client) => client.query(
      `SELECT metadata FROM kai.upload_lifecycle_audit WHERE operation = 'intake_sensitivity_profile_persisted'`,
    ));
    assert.equal(auditRow.rows.length, 1);
    const metadata = auditRow.rows[0].metadata;
    assert.deepEqual(
      Object.keys(metadata).sort(),
      ["contract", "data_dictionary_id", "file_profile_id", "human_review_required", "metadata_only", "profile_canonical_sha256", "validator_key"],
    );
    assert.equal(metadata.contract, "p1_intake_sensitivity_and_allowed_use_v1");
    assert.equal(metadata.validator_key, "VAL-KAI-P1-05-001");
    assert.equal(metadata.profile_canonical_sha256, profileCanonicalSha256);
    assert.equal(metadata.human_review_required, true);
  });

  test("P1-05: same identity with the same stored hash replays the existing row without duplicating rows", async () => {
    const { fileProfileId, dataDictionaryId } = await seedFullLineage(2);

    const first = await repository.persistIntakeSensitivityProfile({
      identity: { organizationId: ORG, fileProfileId, dataDictionaryId },
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(first.ok, true);
    assert.equal(first.data.replayed, false);

    const secondAudit = createAuditProbe();
    const second = await repository.persistIntakeSensitivityProfile({
      identity: { organizationId: ORG, fileProfileId, dataDictionaryId },
      now: NOW,
      metadataOnlyAudit: secondAudit.dependency,
    });
    assert.equal(second.ok, true);
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.sensitivityProfile.intake_sensitivity_profile_id, first.data.sensitivityProfile.intake_sensitivity_profile_id);
    assert.equal(secondAudit.published.length, 0, "replay must not write a second audit row");

    const rowCount = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.intake_sensitivity_profiles WHERE organization_id = $1::uuid AND file_profile_id = $2::uuid AND data_dictionary_id = $3::uuid`,
      [ORG, fileProfileId, dataDictionaryId],
    ));
    assert.equal(rowCount.rows[0].count, 1);
  });

  test("P1-05: a different file_profile_id/data_dictionary_id lineage always creates a separate row", async () => {
    const first = await seedFullLineage(3);
    const second = await seedFullLineage(4);

    const firstResult = await repository.persistIntakeSensitivityProfile({
      identity: { organizationId: ORG, fileProfileId: first.fileProfileId, dataDictionaryId: first.dataDictionaryId },
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    const secondResult = await repository.persistIntakeSensitivityProfile({
      identity: { organizationId: ORG, fileProfileId: second.fileProfileId, dataDictionaryId: second.dataDictionaryId },
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    assert.notEqual(
      firstResult.data.sensitivityProfile.intake_sensitivity_profile_id,
      secondResult.data.sensitivityProfile.intake_sensitivity_profile_id,
    );
  });

  test("P1-05: tenant scoping prevents cross-tenant reads of another organization's sensitivity profile", async () => {
    const { fileProfileId, dataDictionaryId } = await seedFullLineage(5);

    await repository.persistIntakeSensitivityProfile({
      identity: { organizationId: ORG, fileProfileId, dataDictionaryId },
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });

    const crossTenantRead = await repository.getIntakeSensitivityProfile({
      identity: { organizationId: OTHER_ORG, fileProfileId, dataDictionaryId },
    });
    assert.equal(crossTenantRead.ok, false);
    assert.equal(crossTenantRead.error.code, "not_found");
  });

  test("P1-05: an unknown file_profile_id is rejected as not_found without creating any row", async () => {
    const { dataDictionaryId } = await seedFullLineage(6);
    const bogusProfileId = "50000000-0000-4000-8000-000000000999";
    const result = await repository.persistIntakeSensitivityProfile({
      identity: { organizationId: ORG, fileProfileId: bogusProfileId, dataDictionaryId },
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P1-05: an unknown data_dictionary_id is rejected as not_found without creating any row", async () => {
    const { fileProfileId } = await seedFullLineage(7);
    const bogusDictionaryId = "60000000-0000-4000-8000-000000000999";
    const result = await repository.persistIntakeSensitivityProfile({
      identity: { organizationId: ORG, fileProfileId, dataDictionaryId: bogusDictionaryId },
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P1-05: a dictionary bound to a different profile than the one supplied is rejected as not_found", async () => {
    const first = await seedFullLineage(8);
    const second = await seedFullLineage(9);
    // second.dataDictionaryId is bound to second.fileProfileId, not first.fileProfileId
    const result = await repository.persistIntakeSensitivityProfile({
      identity: { organizationId: ORG, fileProfileId: first.fileProfileId, dataDictionaryId: second.dataDictionaryId },
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P1-05: a rejected required-audit prepare rolls back the sensitivity profile write", async () => {
    const { fileProfileId, dataDictionaryId } = await seedFullLineage(10);

    const audit = createAuditProbe({ prepareOk: false });
    const result = await repository.persistIntakeSensitivityProfile({
      identity: { organizationId: ORG, fileProfileId, dataDictionaryId },
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.intake_sensitivity_profiles`),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'intake_sensitivity_profile_persisted'`),
    ]));
    for (const countResult of counts) assert.equal(countResult.rows[0].count, 0);
  });

  for (const [label, probeOptions, seedIndex] of [
    ["a synchronous publish() throw", { publishThrows: true }, 11],
    ["a rejected publish() promise", { publishRejects: true }, 12],
  ]) {
    test(`P1-05: ${label} rolls back the sensitivity profile and required audit row together`, async () => {
      const { fileProfileId, dataDictionaryId } = await seedFullLineage(seedIndex);

      const audit = createAuditProbe(probeOptions);
      // Asserted directly on the returned result object: no try/catch wrapper and no
      // test-thrown error may stand in for the repository's own failure result.
      const result = await repository.persistIntakeSensitivityProfile({
        identity: { organizationId: ORG, fileProfileId, dataDictionaryId },
        now: NOW,
        metadataOnlyAudit: audit.dependency,
      });
      assert.equal(result.ok, false);
      assert.equal(result.data, null);
      assert.equal(result.error.code, "system_error");
      assert.equal(audit.published.length, 0);

      const rollbackCounts = await withClient((client) => Promise.all([
        client.query(`SELECT count(*)::int AS count FROM kai.intake_sensitivity_profiles`),
        client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'intake_sensitivity_profile_persisted'`),
      ]));
      for (const countResult of rollbackCounts) assert.equal(countResult.rows[0].count, 0);
    });
  }

  test("P1-05: two genuinely overlapping transactions creating the same row resolve to exactly one authoritative row", async () => {
    const { fileProfileId, dataDictionaryId } = await seedFullLineage(13);

    // Both repository transactions issue BEGIN and only then pass this gate, so neither
    // can have committed before the other has started: the overlap is real, not two
    // sequential awaits.
    let arrived = 0;
    let openGate;
    const gateOpened = new Promise((resolve) => { openGate = resolve; });
    async function gate() {
      arrived += 1;
      if (arrived >= 2) openGate();
      await gateOpened;
    }
    const racingRepository = createPostgresIntakeSensitivityProfileRepository({
      runInTransaction: (callback) => withTransaction(async (tx) => {
        await gate();
        return callback(tx);
      }, pool),
    });

    const firstAudit = createAuditProbe();
    const secondAudit = createAuditProbe();
    const [first, second] = await Promise.all([
      racingRepository.persistIntakeSensitivityProfile({
        identity: { organizationId: ORG, fileProfileId, dataDictionaryId },
        now: NOW,
        metadataOnlyAudit: firstAudit.dependency,
      }),
      racingRepository.persistIntakeSensitivityProfile({
        identity: { organizationId: ORG, fileProfileId, dataDictionaryId },
        now: NOW,
        metadataOnlyAudit: secondAudit.dependency,
      }),
    ]);
    assert.equal(arrived, 2, "both transactions must have opened before either did its conflicting work");

    assert.equal(first.ok, true, `first call failed: ${JSON.stringify(first.error)}`);
    assert.equal(second.ok, true, `second call failed: ${JSON.stringify(second.error)}`);
    assert.equal(first.data.sensitivityProfile.intake_sensitivity_profile_id, second.data.sensitivityProfile.intake_sensitivity_profile_id);
    const replayFlags = [first.data.replayed, second.data.replayed].sort();
    assert.deepEqual(replayFlags, [false, true], "exactly one creator and exactly one replay");
    assert.equal(firstAudit.published.length + secondAudit.published.length, 1);

    const rows = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.intake_sensitivity_profiles`),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'intake_sensitivity_profile_persisted'`),
    ]));
    assert.deepEqual(rows.map((row) => row.rows[0].count), [1, 1]);

    const authoritative = await repository.getIntakeSensitivityProfile({ identity: { organizationId: ORG, fileProfileId, dataDictionaryId } });
    assert.equal(authoritative.ok, true);
    assert.equal(authoritative.data.sensitivityProfile.intake_sensitivity_profile_id, first.data.sensitivityProfile.intake_sensitivity_profile_id);
  });

  test("P1-05: an explicit safe committed profile fact is persisted, not clobbered back to unknown", async () => {
    const { fileProfileId, dataDictionaryId } = await seedFullLineage(14, {
      profile: fixtureProfile({
        sensitivity_committed_facts: {
          personal_data: "present",
          financial_records: "present",
          indigenous_governance: "absent",
          allowed_use: "not_allowed",
        },
      }),
    });

    const result = await repository.persistIntakeSensitivityProfile({
      identity: { organizationId: ORG, fileProfileId, dataDictionaryId },
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, true);
    const row = result.data.sensitivityProfile;
    assert.equal(row.pii_status, "present");
    assert.equal(row.financial_records_status, "present");
    assert.equal(row.indigenous_governance_status, "absent");
    assert.equal(row.allowed_use_status, "not_allowed");
    // dimensions not stated in this profile remain unknown
    assert.equal(row.minor_data_status, "unknown");
    assert.equal(row.staff_notes_status, "unknown");
  });

  test("P1-05: end-to-end via the service seam with KAI_SPRINT2_ENABLED, using the postgres repository", async () => {
    const { fileProfileId, dataDictionaryId } = await seedFullLineage(16);

    const result = await persistIntakeSensitivityProfile(
      { organizationId: ORG, fileProfileId, dataDictionaryId, now: NOW },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        intakeSensitivityProfileRepository: repository,
        metadataOnlyAudit: createAuditProbe().dependency,
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.sensitivityProfile.human_review_required, true);
  });
}
