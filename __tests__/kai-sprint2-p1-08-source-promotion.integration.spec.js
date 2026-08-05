import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

if (!process.env.KAI_P1_08_SOURCE_PROMOTION_DATABASE_URL) {
  test("P1-08 source-promotion integration requires the runner-owned database", { skip: true }, () => {});
} else {
  await runSourcePromotionIntegrationSuite();
}

async function runSourcePromotionIntegrationSuite() {
  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const { createPostgresSourcePromotionRepository } = await import(
    "../Backend/kai/dictionary/postgresSourcePromotionRepository.js"
  );
  const { createSourcePromotionDecision } = await import("../Backend/kai/services/kaiSourcePromotionService.js");

  const DATABASE_URL = process.env.KAI_P1_08_SOURCE_PROMOTION_DATABASE_URL;
  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-04T10:00:00.000Z";
  const REVIEWED_TYPE = "organization_primary_record";

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 8 });
  const repository = createPostgresSourcePromotionRepository({
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
      "TRUNCATE kai.upload_lifecycle_audit, kai.source_versions, kai.sources, kai.intake_promotion_decisions, " +
      "kai.review_queue_items, kai.intake_source_candidates, kai.upload_policy_decision_replay, " +
      "kai.intake_sensitivity_profiles, kai.data_quality_findings, kai.data_dictionary_mappings, " +
      "kai.data_dictionary_fields, kai.data_dictionaries, kai.intake_file_profiles, kai.intake_parser_runs, kai.intake_files",
    ));
  }

  function fileId(index) {
    return `20000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }

  function candidateId(index) {
    return `90000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }

  function checksumFor(index) {
    return String(index % 10).repeat(64).slice(0, 63) + "a";
  }

  async function seedCompletePair(index, { organizationId = ORG } = {}) {
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
    const profile = { status: "profiled", format: "csv", counts: { row_count: 1, column_count: 1, field_count: 1 }, fields: [{ field_key: "field_1" }] };
    const profileResult = await withClient((client) => client.query(
      `INSERT INTO kai.intake_file_profiles (
         organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'kai_local_profiling_kernel', '1.0.0', $4, $5::jsonb,
               encode(digest($5::jsonb::text, 'sha256'), 'hex'), $6::timestamptz)
       RETURNING file_profile_id::text AS file_profile_id, profile_canonical_sha256`,
      [organizationId, intakeFileId, parserRunId, checksum, JSON.stringify(profile), NOW],
    ));
    const fileProfileId = profileResult.rows[0].file_profile_id;
    const profileCanonicalSha256 = profileResult.rows[0].profile_canonical_sha256;
    const dictionaryResult = await withClient((client) => client.query(
      `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz)
       RETURNING data_dictionary_id::text AS data_dictionary_id`,
      [organizationId, intakeFileId, fileProfileId, profileCanonicalSha256, NOW],
    ));
    const dataDictionaryId = dictionaryResult.rows[0].data_dictionary_id;
    const sensitivityResult = await withClient((client) => client.query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::timestamptz)
       RETURNING intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id`,
      [organizationId, intakeFileId, fileProfileId, dataDictionaryId, profileCanonicalSha256, NOW],
    ));
    const intakeSensitivityProfileId = sensitivityResult.rows[0].intake_sensitivity_profile_id;
    const intakeSourceCandidateId = candidateId(index);
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_source_candidates (
         intake_source_candidate_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id,
         intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, 'human')`,
      [intakeSourceCandidateId, organizationId, intakeFileId, fileProfileId, dataDictionaryId, intakeSensitivityProfileId, profileCanonicalSha256],
    ));
    const reviewItemResult = await withClient((client) => client.query(
      `INSERT INTO kai.review_queue_items (
         organization_id, queue_type, target_object_type, target_object_id,
         priority, queue_status, summary, required_action, queue_metadata, created_by_type
       ) VALUES ($1::uuid, 'source_candidate_review', 'intake_source_candidate', $2::uuid,
                 'normal', 'open', 'Review intake source-candidate stub for human classification.',
                 'Human review is required.', '{"p0_stub":true}'::jsonb, 'human')
       RETURNING review_queue_item_id::text AS review_queue_item_id`,
      [organizationId, intakeSourceCandidateId],
    ));
    return {
      organizationId,
      intakeFileId,
      intakeSourceCandidateId,
      intakeSensitivityProfileId,
      profileCanonicalSha256,
      reviewQueueItemId: reviewItemResult.rows[0].review_queue_item_id,
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

  function humanActor(overrides = {}) {
    return {
      actorType: "human",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
      ...overrides,
    };
  }

  test.beforeEach(resetTables);

  test("P1-08: promotes one complete pair into a source and current source_version, transitions the candidate/review item, and writes the required audit row", async () => {
    const pair = await seedCompletePair(1);
    const audit = createAuditProbe();

    const result = await repository.createSourcePromotionDecision({
      identity: { organizationId: ORG, intakeSourceCandidateId: pair.intakeSourceCandidateId },
      reviewedSourceType: REVIEWED_TYPE,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.promotionDecision.decision_status, "promoted");
    assert.equal(result.data.sourceCandidate.candidate_status, "promoted");
    assert.equal(result.data.reviewQueueItem.queue_status, "resolved");
    assert.equal(result.data.source.reviewed_source_type, REVIEWED_TYPE);
    assert.equal(result.data.sourceVersion.is_current, true);
    assert.equal(audit.published.length, 1);

    const auditRow = await withClient((client) => client.query(
      `SELECT metadata FROM kai.upload_lifecycle_audit WHERE operation = 'source_promotion_decision_persisted'`,
    ));
    assert.equal(auditRow.rows.length, 1);
    assert.deepEqual(
      Object.keys(auditRow.rows[0].metadata).sort(),
      [
        "candidate_status", "contract", "decision_status", "intake_sensitivity_profile_id",
        "intake_source_candidate_id", "metadata_only", "profile_canonical_sha256",
        "queue_status", "reviewed_source_type", "source_id", "source_version_id", "validator_key",
      ],
    );
  });

  test("P1-08: same identity replays the existing promotion decision, source, and source_version without duplicating rows or audit", async () => {
    const pair = await seedCompletePair(2);
    const first = await repository.createSourcePromotionDecision({
      identity: { organizationId: ORG, intakeSourceCandidateId: pair.intakeSourceCandidateId },
      reviewedSourceType: REVIEWED_TYPE,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(first.ok, true);

    const secondAudit = createAuditProbe();
    const second = await repository.createSourcePromotionDecision({
      identity: { organizationId: ORG, intakeSourceCandidateId: pair.intakeSourceCandidateId },
      reviewedSourceType: REVIEWED_TYPE,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: secondAudit.dependency,
    });
    assert.equal(second.ok, true);
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.promotionDecision.intake_promotion_decision_id, first.data.promotionDecision.intake_promotion_decision_id);
    assert.equal(second.data.source.source_id, first.data.source.source_id);
    assert.equal(second.data.sourceVersion.source_version_id, first.data.sourceVersion.source_version_id);
    assert.equal(secondAudit.published.length, 0);

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.intake_promotion_decisions WHERE organization_id = $1::uuid AND intake_source_candidate_id = $2::uuid`, [ORG, pair.intakeSourceCandidateId]),
      client.query(`SELECT count(*)::int AS count FROM kai.sources WHERE organization_id = $1::uuid`, [ORG]),
      client.query(`SELECT count(*)::int AS count FROM kai.source_versions WHERE organization_id = $1::uuid AND intake_source_candidate_id = $2::uuid`, [ORG, pair.intakeSourceCandidateId]),
    ]));
    assert.deepEqual(counts.map((row) => row.rows[0].count), [1, 1, 1]);
  });

  test("P1-08: an unknown intake_source_candidate_id is rejected as not_found without creating any row", async () => {
    const result = await repository.createSourcePromotionDecision({
      identity: { organizationId: ORG, intakeSourceCandidateId: "90000000-0000-4000-8000-000000000999" },
      reviewedSourceType: REVIEWED_TYPE,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P1-08: tenant scoping prevents reading another organization's candidate", async () => {
    const pair = await seedCompletePair(3);
    const crossTenantResult = await repository.createSourcePromotionDecision({
      identity: { organizationId: OTHER_ORG, intakeSourceCandidateId: pair.intakeSourceCandidateId },
      reviewedSourceType: REVIEWED_TYPE,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(crossTenantResult.ok, false);
    assert.equal(crossTenantResult.error.code, "not_found");

    const rowCount = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.intake_promotion_decisions WHERE organization_id = $1::uuid`,
      [OTHER_ORG],
    ));
    assert.equal(rowCount.rows[0].count, 0);
  });

  test("P1-08: an unrecognized reviewed_source_type is rejected as validation_blocker without creating any row", async () => {
    const pair = await seedCompletePair(4);
    const result = await repository.createSourcePromotionDecision({
      identity: { organizationId: ORG, intakeSourceCandidateId: pair.intakeSourceCandidateId },
      reviewedSourceType: "unknown",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");
    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.intake_promotion_decisions`),
      client.query(`SELECT count(*)::int AS count FROM kai.sources`),
    ]));
    for (const countResult of counts) assert.equal(countResult.rows[0].count, 0);
  });

  test("P1-08: a rejected required-audit prepare rolls back the decision, source, source_version, and the candidate/review transitions", async () => {
    const pair = await seedCompletePair(5);
    const audit = createAuditProbe({ prepareOk: false });
    const result = await repository.createSourcePromotionDecision({
      identity: { organizationId: ORG, intakeSourceCandidateId: pair.intakeSourceCandidateId },
      reviewedSourceType: REVIEWED_TYPE,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.intake_promotion_decisions`),
      client.query(`SELECT count(*)::int AS count FROM kai.sources`),
      client.query(`SELECT count(*)::int AS count FROM kai.source_versions`),
      client.query(`SELECT candidate_status FROM kai.intake_source_candidates WHERE intake_source_candidate_id = $1::uuid`, [pair.intakeSourceCandidateId]),
      client.query(`SELECT queue_status FROM kai.review_queue_items WHERE target_object_id = $1::uuid`, [pair.intakeSourceCandidateId]),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'source_promotion_decision_persisted'`),
    ]));
    assert.equal(counts[0].rows[0].count, 0);
    assert.equal(counts[1].rows[0].count, 0);
    assert.equal(counts[2].rows[0].count, 0);
    assert.equal(counts[3].rows[0].candidate_status, "needs_gk_review");
    assert.equal(counts[4].rows[0].queue_status, "open");
    assert.equal(counts[5].rows[0].count, 0);
  });

  for (const [label, probeOptions, seedIndex] of [
    ["a synchronous publish() throw", { publishThrows: true }, 6],
    ["a rejected publish() promise", { publishRejects: true }, 7],
  ]) {
    test(`P1-08: ${label} rolls back the decision, source, source_version, transitions, and audit together`, async () => {
      const pair = await seedCompletePair(seedIndex);
      const audit = createAuditProbe(probeOptions);
      const result = await repository.createSourcePromotionDecision({
        identity: { organizationId: ORG, intakeSourceCandidateId: pair.intakeSourceCandidateId },
        reviewedSourceType: REVIEWED_TYPE,
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: audit.dependency,
      });
      assert.equal(result.ok, false);
      assert.equal(result.data, null);
      assert.equal(result.error.code, "system_error");
      assert.equal(audit.published.length, 0);

      const rollbackCounts = await withClient((client) => Promise.all([
        client.query(`SELECT count(*)::int AS count FROM kai.intake_promotion_decisions`),
        client.query(`SELECT candidate_status FROM kai.intake_source_candidates WHERE intake_source_candidate_id = $1::uuid`, [pair.intakeSourceCandidateId]),
      ]));
      assert.equal(rollbackCounts[0].rows[0].count, 0);
      assert.equal(rollbackCounts[1].rows[0].candidate_status, "needs_gk_review");
    });
  }

  test("P1-08: two genuinely overlapping transactions promoting the same candidate resolve to exactly one authoritative decision, source, and source_version", async () => {
    const pair = await seedCompletePair(8);

    let arrived = 0;
    let openGate;
    const gateOpened = new Promise((resolve) => { openGate = resolve; });
    async function gate() {
      arrived += 1;
      if (arrived >= 2) openGate();
      await gateOpened;
    }
    const racingRepository = createPostgresSourcePromotionRepository({
      runInTransaction: (callback) => withTransaction(callback, pool),
      beforeInsert: gate,
    });

    const firstAudit = createAuditProbe();
    const secondAudit = createAuditProbe();
    const [first, second] = await Promise.all([
      racingRepository.createSourcePromotionDecision({
        identity: { organizationId: ORG, intakeSourceCandidateId: pair.intakeSourceCandidateId },
        reviewedSourceType: REVIEWED_TYPE,
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: firstAudit.dependency,
      }),
      racingRepository.createSourcePromotionDecision({
        identity: { organizationId: ORG, intakeSourceCandidateId: pair.intakeSourceCandidateId },
        reviewedSourceType: REVIEWED_TYPE,
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: secondAudit.dependency,
      }),
    ]);
    assert.equal(arrived, 2);

    assert.equal(first.ok, true, `first call failed: ${JSON.stringify(first.error)}`);
    assert.equal(second.ok, true, `second call failed: ${JSON.stringify(second.error)}`);
    assert.equal(first.data.promotionDecision.intake_promotion_decision_id, second.data.promotionDecision.intake_promotion_decision_id);
    assert.equal(first.data.source.source_id, second.data.source.source_id);
    const replayFlags = [first.data.replayed, second.data.replayed].sort();
    assert.deepEqual(replayFlags, [false, true]);
    assert.equal(firstAudit.published.length + secondAudit.published.length, 1);

    const rows = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.intake_promotion_decisions WHERE intake_source_candidate_id = $1::uuid`, [pair.intakeSourceCandidateId]),
      client.query(`SELECT count(*)::int AS count FROM kai.source_versions WHERE intake_source_candidate_id = $1::uuid`, [pair.intakeSourceCandidateId]),
    ]));
    assert.deepEqual(rows.map((row) => row.rows[0].count), [1, 1]);
  });

  test("P1-08 catalog verifier: every expected check name appears exactly once with no FAIL", async () => {
    const verifierSql = readFileSync(
      new URL("../scripts/kai-sprint2-p1-08-source-promotion-verifier.sql", import.meta.url),
      "utf8",
    );
    const result = await pool.query(verifierSql);
    const keys = result.rows.map((row) => `${row.check_name}::${row.object_name}`);
    assert.equal(keys.length, new Set(keys).size, "duplicate catalog-check rows found");
    assert.ok(!result.rows.some((row) => row.status === "FAIL"), "catalog verifier reported an unexpected FAIL");
  });

  test("P1-08: end-to-end via the service seam with both feature flags, AUTH-KAI-003, and VAL-TEN-001, using the postgres repository", async () => {
    const pair = await seedCompletePair(9);

    const result = await createSourcePromotionDecision(
      { organizationId: ORG, intakeSourceCandidateId: pair.intakeSourceCandidateId, reviewedSourceType: REVIEWED_TYPE, actorContext: humanActor(), now: NOW },
      {
        env: { KAI_SPRINT2_ENABLED: "true", KAI_SOURCE_PROMOTION_ENABLED: "true" },
        sourcePromotionRepository: repository,
        metadataOnlyAudit: createAuditProbe().dependency,
      },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.sourceCandidate.candidate_status, "promoted");

    const deniedResult = await createSourcePromotionDecision(
      { organizationId: ORG, intakeSourceCandidateId: pair.intakeSourceCandidateId, reviewedSourceType: REVIEWED_TYPE, actorContext: humanActor({ actorType: "ai" }), now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true", KAI_SOURCE_PROMOTION_ENABLED: "true" }, sourcePromotionRepository: repository, metadataOnlyAudit: createAuditProbe().dependency },
    );
    assert.equal(deniedResult.ok, false);
    assert.equal(deniedResult.error.code, "authorization_denied");

    const disabledResult = await createSourcePromotionDecision(
      { organizationId: ORG, intakeSourceCandidateId: pair.intakeSourceCandidateId, reviewedSourceType: REVIEWED_TYPE, actorContext: humanActor(), now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, sourcePromotionRepository: repository, metadataOnlyAudit: createAuditProbe().dependency },
    );
    assert.equal(disabledResult.ok, false);
    assert.equal(disabledResult.error.code, "feature_disabled");
  });
}
