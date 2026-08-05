import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

if (!process.env.KAI_P2_01_EVIDENCE_LINEAGE_DATABASE_URL) {
  test("P2-01 evidence-lineage integration requires the runner-owned database", { skip: true }, () => {});
} else {
  await runEvidenceLineageIntegrationSuite();
}

async function runEvidenceLineageIntegrationSuite() {
  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const { createPostgresEvidenceLineageRepository } = await import(
    "../Backend/kai/dictionary/postgresEvidenceLineageRepository.js"
  );
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");

  const DATABASE_URL = process.env.KAI_P2_01_EVIDENCE_LINEAGE_DATABASE_URL;
  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-05T10:00:00.000Z";
  const REVIEWED_TYPE = "organization_primary_record";

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 8 });
  const repository = createPostgresEvidenceLineageRepository({
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

  function fileId(index) {
    return `21000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function candidateId(index) {
    return `91000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function sensitivityId(index) {
    return `81000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function fileProfileId(index) {
    return `51000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function dictionaryId(index) {
    // Uses a 62000000... prefix, distinct from the 61000000... dictionary2 fixture
    // id already committed by the chained P1-05/P1-06/P1-07/P1-08 smoke-seed
    // scripts (which run, and COMMIT, ahead of this integration suite in the
    // package's own local-postgres runner) - avoids a data_dictionaries_pkey
    // collision with that pre-existing fixture.
    return `62000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function sourceId(index) {
    return `72000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function checksumFor(index) {
    const hex = index.toString(16).padStart(2, "0");
    return hex.repeat(32).slice(0, 64);
  }

  async function seedPromotedSourceVersion(index, { organizationId = ORG, fields = [{ key: "email", type: "text" }, { key: "signup_count", type: "number" }] } = {}) {
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
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, $5)`,
        [dataDictionaryId, organizationId, fileProfileIdValue, field.key, field.type],
      ));
    }
    const intakeSensitivityProfileId = sensitivityId(index);
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::timestamptz)`,
      [intakeSensitivityProfileId, organizationId, intakeFileId, fileProfileIdValue, dataDictionaryId, checksum, NOW],
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
                 'normal', 'resolved', 'resolved', 'Review intake source-candidate stub for human classification.',
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
    return { organizationId, intakeFileId, intakeSourceCandidateId, intakeSensitivityProfileId, dataDictionaryId, sourceId: sourceIdValue, sourceVersionId, fieldCount: fields.length };
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

  function humanActor(overrides = {}) {
    return {
      actorType: "human",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
      ...overrides,
    };
  }

  test("P2-01 (a): first extraction creates the aggregate item, one field item per committed field, each field item's locator, one open evidence_review queue item per evidence item, and exactly one audit row", async () => {
    const seed = await seedPromotedSourceVersion(1);
    const audit = createAuditProbe();

    const result = await repository.extractEvidenceFromSourceVersion({
      organizationId: ORG,
      sourceVersionId: seed.sourceVersionId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.evidenceItems.length, seed.fieldCount + 1);
    assert.equal(result.data.sourceLocators.length, seed.fieldCount);
    assert.equal(result.data.reviewQueueItems.length, seed.fieldCount + 1);
    assert.ok(result.data.reviewQueueItems.every((item) => item.queue_status === "open"));
    assert.equal(audit.published.length, 1);

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.evidence_items WHERE organization_id = $1::uuid AND source_version_id = $2::uuid`, [ORG, seed.sourceVersionId]),
      client.query(`SELECT count(*)::int AS count FROM kai.source_locators WHERE organization_id = $1::uuid AND source_version_id = $2::uuid`, [ORG, seed.sourceVersionId]),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'evidence_lineage_extracted' AND organization_id = $1::uuid AND intake_file_id = $2::uuid`, [ORG, seed.intakeFileId]),
    ]));
    assert.equal(counts[0].rows[0].count, seed.fieldCount + 1);
    assert.equal(counts[1].rows[0].count, seed.fieldCount);
    assert.equal(counts[2].rows[0].count, 1);

    const auditRow = await withClient((client) => client.query(
      `SELECT metadata FROM kai.upload_lifecycle_audit WHERE operation = 'evidence_lineage_extracted' AND organization_id = $1::uuid AND intake_file_id = $2::uuid`,
      [ORG, seed.intakeFileId],
    ));
    assert.deepEqual(
      Object.keys(auditRow.rows[0].metadata).sort(),
      [
        "contract", "evidence_item_count", "fresh_write_count", "intake_sensitivity_profile_id",
        "metadata_only", "profile_canonical_sha256", "review_queue_item_count", "source_locator_count",
        "source_version_id", "validator_key",
      ],
    );
    assert.equal(auditRow.rows[0].metadata.evidence_item_count, seed.fieldCount + 1);
    assert.equal(auditRow.rows[0].metadata.fresh_write_count, seed.fieldCount + 1);
  });

  test("P2-01 (b): replaying the identical call is a full no-op - zero new rows, zero new audit rows, replayed: true", async () => {
    const seed = await seedPromotedSourceVersion(2);
    const first = await repository.extractEvidenceFromSourceVersion({
      organizationId: ORG,
      sourceVersionId: seed.sourceVersionId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(first.ok, true);

    const secondAudit = createAuditProbe();
    const second = await repository.extractEvidenceFromSourceVersion({
      organizationId: ORG,
      sourceVersionId: seed.sourceVersionId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: secondAudit.dependency,
    });
    assert.equal(second.ok, true);
    assert.equal(second.data.replayed, true);
    assert.equal(secondAudit.published.length, 0);
    assert.deepEqual(
      second.data.evidenceItems.map((item) => item.evidence_item_id).sort(),
      first.data.evidenceItems.map((item) => item.evidence_item_id).sort(),
    );

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.evidence_items WHERE organization_id = $1::uuid AND source_version_id = $2::uuid`, [ORG, seed.sourceVersionId]),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'evidence_lineage_extracted' AND organization_id = $1::uuid AND intake_file_id = $2::uuid`, [ORG, seed.intakeFileId]),
    ]));
    assert.equal(counts[0].rows[0].count, seed.fieldCount + 1);
    assert.equal(counts[1].rows[0].count, 1);
  });

  test("P2-01 (c): two genuinely overlapping extraction calls for the same source_version converge to the same row set with exactly one audit row published between them", async () => {
    const seed = await seedPromotedSourceVersion(3);

    let arrived = 0;
    let openGate;
    const gateOpened = new Promise((resolve) => { openGate = resolve; });
    async function gate() {
      arrived += 1;
      if (arrived >= 2) openGate();
      await gateOpened;
    }
    const racingRepository = createPostgresEvidenceLineageRepository({
      runInTransaction: (callback) => withTransaction(callback, pool),
      beforeInsert: gate,
    });

    const firstAudit = createAuditProbe();
    const secondAudit = createAuditProbe();
    const [first, second] = await Promise.all([
      racingRepository.extractEvidenceFromSourceVersion({
        organizationId: ORG,
        sourceVersionId: seed.sourceVersionId,
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: firstAudit.dependency,
      }),
      racingRepository.extractEvidenceFromSourceVersion({
        organizationId: ORG,
        sourceVersionId: seed.sourceVersionId,
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: secondAudit.dependency,
      }),
    ]);
    assert.equal(arrived, 2);

    assert.equal(first.ok, true, `first call failed: ${JSON.stringify(first.error)}`);
    assert.equal(second.ok, true, `second call failed: ${JSON.stringify(second.error)}`);
    assert.deepEqual(
      first.data.evidenceItems.map((item) => item.evidence_item_id).sort(),
      second.data.evidenceItems.map((item) => item.evidence_item_id).sort(),
    );
    const replayFlags = [first.data.replayed, second.data.replayed].sort();
    assert.deepEqual(replayFlags, [false, true]);
    assert.equal(firstAudit.published.length + secondAudit.published.length, 1);

    const rows = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.evidence_items WHERE organization_id = $1::uuid AND source_version_id = $2::uuid`, [ORG, seed.sourceVersionId]),
      client.query(`SELECT count(*)::int AS count FROM kai.source_locators WHERE organization_id = $1::uuid AND source_version_id = $2::uuid`, [ORG, seed.sourceVersionId]),
    ]));
    assert.equal(rows[0].rows[0].count, seed.fieldCount + 1);
    assert.equal(rows[1].rows[0].count, seed.fieldCount);
  });

  test("P2-01 (d): tenant isolation - a different organizationId with a matching sourceVersionId returns not_found and creates nothing", async () => {
    const seed = await seedPromotedSourceVersion(4);
    const result = await repository.extractEvidenceFromSourceVersion({
      organizationId: OTHER_ORG,
      sourceVersionId: seed.sourceVersionId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");

    const rowCount = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.evidence_items WHERE organization_id = $1::uuid`,
      [OTHER_ORG],
    ));
    assert.equal(rowCount.rows[0].count, 0);
  });

  test("P2-01 (e): an unknown source_version_id is rejected as not_found without creating any row", async () => {
    const result = await repository.extractEvidenceFromSourceVersion({
      organizationId: ORG,
      sourceVersionId: "79999999-0000-4000-8000-000000000999",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P2-01 (e): a superseded (non-current) source_version returns conflict_current_state_changed without creating any row", async () => {
    const seed = await seedPromotedSourceVersion(5);
    await withClient((client) => client.query(
      `UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid`,
      [seed.sourceVersionId],
    ));
    const result = await repository.extractEvidenceFromSourceVersion({
      organizationId: ORG,
      sourceVersionId: seed.sourceVersionId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "conflict_current_state_changed");
    const count = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.evidence_items WHERE source_version_id = $1::uuid`,
      [seed.sourceVersionId],
    ));
    assert.equal(count.rows[0].count, 0);
  });

  test("P2-01 (e): a promotion decision bound to a different source than the source_version's own returns conflict_current_state_changed without creating any row", async () => {
    const seedA = await seedPromotedSourceVersion(6);
    const seedB = await seedPromotedSourceVersion(7);
    await withClient((client) => client.query(
      `UPDATE kai.intake_promotion_decisions SET source_id = $1::uuid WHERE source_version_id = $2::uuid`,
      [seedB.sourceId, seedA.sourceVersionId],
    ));
    const result = await repository.extractEvidenceFromSourceVersion({
      organizationId: ORG,
      sourceVersionId: seedA.sourceVersionId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "conflict_current_state_changed");
    const count = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.evidence_items WHERE source_version_id = $1::uuid`,
      [seedA.sourceVersionId],
    ));
    assert.equal(count.rows[0].count, 0);
  });

  test("P2-01 (e): a candidate that is not (or no longer) promoted returns validation_blocker without creating any row", async () => {
    const seed = await seedPromotedSourceVersion(8);
    await withClient((client) => client.query(
      `UPDATE kai.intake_source_candidates SET candidate_status = 'needs_gk_review' WHERE intake_source_candidate_id = $1::uuid`,
      [seed.intakeSourceCandidateId],
    ));
    const result = await repository.extractEvidenceFromSourceVersion({
      organizationId: ORG,
      sourceVersionId: seed.sourceVersionId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    const count = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.evidence_items WHERE source_version_id = $1::uuid`,
      [seed.sourceVersionId],
    ));
    assert.equal(count.rows[0].count, 0);
  });

  // NOTE: the reapplied P1-08 permission predicate (VAL-KAI-P2-01-001 check 9) has
  // no reachable real-row failure mode at this integration layer: every one of its
  // six columns is itself pinned by a P1-05 CHECK constraint
  // (intake_sensitivity_profiles_p1_05_{llm_processing,product_learning,public_use,
  // funder_use}_check, ..._human_review_check, ..._retention_posture_check), so no
  // committed kai.intake_sensitivity_profiles row can ever violate it - exactly
  // like P1-08's own integration spec, which likewise never attempts this against a
  // real row. The predicate's full failure-mode coverage lives in
  // kai-sprint2-p2-01-evidence-lineage-boundary.spec.js ("validateEvidenceHasSourceLineage
  // check 9"), which exercises it directly against synthetic row objects.

  test("P2-01 (f): a rejected required-audit prepare rolls back every write", async () => {
    const seed = await seedPromotedSourceVersion(10);
    const audit = createAuditProbe({ prepareOk: false });
    const result = await repository.extractEvidenceFromSourceVersion({
      organizationId: ORG,
      sourceVersionId: seed.sourceVersionId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.evidence_items WHERE source_version_id = $1::uuid`, [seed.sourceVersionId]),
      client.query(`SELECT count(*)::int AS count FROM kai.source_locators WHERE source_version_id = $1::uuid`, [seed.sourceVersionId]),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'evidence_lineage_extracted' AND intake_file_id = $1::uuid`, [seed.intakeFileId]),
    ]));
    assert.equal(counts[0].rows[0].count, 0);
    assert.equal(counts[1].rows[0].count, 0);
    assert.equal(counts[2].rows[0].count, 0);
  });

  for (const [label, probeOptions, seedIndex] of [
    ["a synchronous publish() throw", { publishThrows: true }, 11],
    ["a rejected publish() promise", { publishRejects: true }, 12],
  ]) {
    test(`P2-01 (f): ${label} rolls back every write together`, async () => {
      const seed = await seedPromotedSourceVersion(seedIndex);
      const audit = createAuditProbe(probeOptions);
      const result = await repository.extractEvidenceFromSourceVersion({
        organizationId: ORG,
        sourceVersionId: seed.sourceVersionId,
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: audit.dependency,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "system_error");

      const count = await withClient((client) => client.query(
        `SELECT count(*)::int AS count FROM kai.evidence_items WHERE source_version_id = $1::uuid`,
        [seed.sourceVersionId],
      ));
      assert.equal(count.rows[0].count, 0);
    });
  }

  test("P2-01 (g): disabled feature flag returns feature_disabled with zero repository/DB activity", async () => {
    const seed = await seedPromotedSourceVersion(13);
    const result = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: seed.sourceVersionId, actorContext: humanActor(), now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, evidenceLineageRepository: repository, metadataOnlyAudit: createAuditProbe().dependency },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "feature_disabled");

    const count = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.evidence_items WHERE source_version_id = $1::uuid`,
      [seed.sourceVersionId],
    ));
    assert.equal(count.rows[0].count, 0);
  });

  test("P2-01: end-to-end via the service seam with both feature flags, AUTH-KAI-003, and VAL-TEN-001, using the postgres repository", async () => {
    const seed = await seedPromotedSourceVersion(14);

    const result = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: seed.sourceVersionId, actorContext: humanActor(), now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true", KAI_EVIDENCE_LINEAGE_ENABLED: "true" }, evidenceLineageRepository: repository, metadataOnlyAudit: createAuditProbe().dependency },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.evidenceItems.length, seed.fieldCount + 1);

    const deniedResult = await extractEvidenceFromSourceVersion(
      { organizationId: ORG, sourceVersionId: seed.sourceVersionId, actorContext: humanActor({ actorType: "ai" }), now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true", KAI_EVIDENCE_LINEAGE_ENABLED: "true" }, evidenceLineageRepository: repository, metadataOnlyAudit: createAuditProbe().dependency },
    );
    assert.equal(deniedResult.ok, false);
    assert.equal(deniedResult.error.code, "authorization_denied");
  });

  test("P2-01 catalog verifier: every expected check name appears exactly once with no FAIL", async () => {
    const verifierSql = readFileSync(
      new URL("../scripts/kai-sprint2-p2-01-evidence-lineage-verifier.sql", import.meta.url),
      "utf8",
    );
    const result = await pool.query(verifierSql);
    const keys = result.rows.map((row) => `${row.check_name}::${row.object_name}`);
    assert.equal(keys.length, new Set(keys).size, "duplicate catalog-check rows found");
    assert.ok(!result.rows.some((row) => row.status === "FAIL"), "catalog verifier reported an unexpected FAIL");
  });
}
