import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_B1A_3B_R2_ZERO_QUEUE_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`B1A-3B-R2 integration suite refused a non-loopback KAI_B1A_3B_R2_ZERO_QUEUE_DATABASE_URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("B1A-3B-R2 zero-queue integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runB1A3BR2IntegrationSuite();
}

/**
 * KAI B1A-3B-R2: proves, against real PostgreSQL, that the true first-review
 * bootstrap - a P1-05 intake_sensitivity_profile with NO sensitivity_review
 * queue item, NO promoted source, NO evidence item, and NO claim - is
 * discoverable and reachable through the existing file-detail/P1 lifecycle
 * read and the existing B1A-2R review-work operation, with zero pre-existing
 * review queue row required. This is the R1 gap: sensitivityReviewQueuePath
 * only ever reads EXISTING review_queue_items rows, so it cannot discover a
 * profile that has none.
 */
async function runB1A3BR2IntegrationSuite() {
  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const { createPostgresReviewQueueRepository } = await import("../Backend/kai/dictionary/postgresReviewQueueRepository.js");
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { getReviewCockpitSensitivityProfileDetail } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const { getReviewCockpitSensitivityProfileRecord } = await import("../Backend/kai/db/kaiReviewCockpitReadModels.js");
  const { getIntakeFileDetail } = await import("../Backend/kai/services/kaiIntakeService.js");
  const {
    getIntakeFileMetadata,
    getScopedIntakeFileP1Lifecycle,
    getScopedLatestSecurityAssessmentAuditProjection,
  } = await import("../Backend/kai/db/kaiReadModels.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const REVIEWER = "90000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-31T10:00:00.000Z";
  const ENV = { KAI_SPRINT2_ENABLED: "true" };

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 8 });
  const reviewQueueRepository = createPostgresReviewQueueRepository({
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
    return `20000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }

  function checksumFor(index) {
    return String(index % 10).repeat(64).slice(0, 63) + "a";
  }

  // Seeds ONLY the P1-05 lineage - intentionally never inserts a
  // review_queue_items row, an evidence item, a claim, or a promoted source.
  // This is the exact zero-queue fixture B1A-3B-R2 requires.
  async function seedZeroQueueSensitivityProfile(index) {
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
      [intakeFileId, BATCH, ORG, checksum, NOW],
    ));
    const parserRunResult = await withClient((client) => client.query(
      `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', $4::timestamptz)
       RETURNING parser_run_id::text AS parser_run_id`,
      [ORG, intakeFileId, checksum, NOW],
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
      [ORG, intakeFileId, parserRunId, checksum, JSON.stringify(profile), NOW],
    ));
    const fileProfileId = profileResult.rows[0].file_profile_id;
    const profileCanonicalSha256 = profileResult.rows[0].profile_canonical_sha256;
    const dictionaryResult = await withClient((client) => client.query(
      `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz)
       RETURNING data_dictionary_id::text AS data_dictionary_id`,
      [ORG, intakeFileId, fileProfileId, profileCanonicalSha256, NOW],
    ));
    const dataDictionaryId = dictionaryResult.rows[0].data_dictionary_id;
    // Also mark this parser run 'completed' so the P1 lifecycle projection's
    // completeness chain (which requires parser_status = 'completed') can
    // actually reach "sensitivity_profile_complete = true".
    await withClient((client) => client.query(
      `UPDATE kai.intake_parser_runs
          SET parser_status = 'completed', output_profile_id = $3::uuid, completed_at = $4::timestamptz
        WHERE organization_id = $1::uuid AND intake_file_id = $2::uuid`,
      [ORG, intakeFileId, fileProfileId, NOW],
    ));
    const sensitivityResult = await withClient((client) => client.query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::timestamptz)
       RETURNING intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id`,
      [ORG, intakeFileId, fileProfileId, dataDictionaryId, profileCanonicalSha256, NOW],
    ));
    return { intakeFileId, intakeSensitivityProfileId: sensitivityResult.rows[0].intake_sensitivity_profile_id };
  }

  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }

  const reviewerActor = {
    actorType: "human",
    actorUserId: REVIEWER,
    kaiRoles: ["gk_reviewer"],
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };

  async function fileDetail(intakeFileId) {
    return getIntakeFileDetail(
      { organizationId: ORG, intakeFileId, actorContext: reviewerActor },
      {
        env: ENV,
        getIntakeFileMetadata: (organizationId, id) => getIntakeFileMetadata(organizationId, id, pool),
        getScopedIntakeFileP1Lifecycle: (organizationId, id) => getScopedIntakeFileP1Lifecycle(organizationId, id, pool),
        getScopedLatestSecurityAssessmentAuditProjection: (organizationId, id) =>
          getScopedLatestSecurityAssessmentAuditProjection(organizationId, id, pool),
      },
    );
  }

  async function sensitivityDetail(intakeSensitivityProfileId) {
    return getReviewCockpitSensitivityProfileDetail(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: reviewerActor },
      {
        env: ENV,
        getReviewCockpitSensitivityProfileRecord: (organizationId, profileId) =>
          getReviewCockpitSensitivityProfileRecord(organizationId, profileId, pool),
      },
    );
  }

  async function schemaRowCounts() {
    const tables = await withClient((client) => client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'kai' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    ));
    const counts = {};
    for (const { table_name: tableName } of tables.rows) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await withClient((client) => client.query(`SELECT count(*)::int AS count FROM kai.${tableName}`));
      counts[tableName] = rows.rows[0].count;
    }
    return counts;
  }

  test("B1A-3B-R2 zero-queue fixture: P1-05 profile exists with NO sensitivity_review row, NO promoted source, NO evidence item, NO claim", async () => {
    const { intakeSensitivityProfileId } = await seedZeroQueueSensitivityProfile(1);

    const queueRows = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.review_queue_items
        WHERE queue_type = 'sensitivity_review' AND target_object_id = $1::uuid`,
      [intakeSensitivityProfileId],
    ));
    assert.equal(queueRows.rows[0].count, 0, "fixture must start with zero review-queue rows for this profile");

    for (const table of ["intake_source_candidates", "sources", "source_versions", "evidence_items", "claims"]) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await withClient((client) => client.query(
        `SELECT to_regclass($1) IS NOT NULL AS exists`,
        [`kai.${table}`],
      ));
      if (!exists.rows[0].exists) continue;
      // eslint-disable-next-line no-await-in-loop
      const rows = await withClient((client) => client.query(`SELECT count(*)::int AS count FROM kai.${table}`));
      assert.equal(rows.rows[0].count, 0, `fixture must start with zero ${table} rows`);
    }
  });

  test("B1A-3B-R2 (A,B,C): file-detail/P1 lifecycle returns the exact server-grounded intake_sensitivity_profile_id, with no claim traceability call and no pre-existing review-queue row required", async () => {
    const { intakeFileId, intakeSensitivityProfileId } = await seedZeroQueueSensitivityProfile(2);

    const detail = await fileDetail(intakeFileId);
    assert.equal(detail.ok, true, JSON.stringify(detail));
    assert.equal(detail.data.p1_lifecycle.sensitivity_profile_complete, true);
    // (A) the exact server-grounded id, straight from the deterministic P1-05
    // read model - never fabricated, never a different/newest-row guess.
    assert.equal(detail.data.p1_lifecycle.intake_sensitivity_profile_id, intakeSensitivityProfileId);

    // (C) confirm, directly against the schema, that no review_queue_items row
    // exists for this profile - the file-detail read above never created one
    // and required none to succeed.
    const queueRows = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.review_queue_items
        WHERE queue_type = 'sensitivity_review' AND target_object_id = $1::uuid`,
      [intakeSensitivityProfileId],
    ));
    assert.equal(queueRows.rows[0].count, 0);
    // (B) this test never calls any claim-traceability function or reads any
    // claims/evidence table - the discovery above is already complete.
  });

  test("B1A-3B-R2 (D,E,F,G,H): GET returns queue item = null -> review-work POST {} succeeds -> exactly one queue identity exists -> authoritative GET returns it -> current_decision is still null", async () => {
    const { intakeFileId, intakeSensitivityProfileId } = await seedZeroQueueSensitivityProfile(3);

    const detail = await fileDetail(intakeFileId);
    assert.equal(detail.ok, true);
    assert.equal(detail.data.p1_lifecycle.intake_sensitivity_profile_id, intakeSensitivityProfileId);

    // (D)
    const firstProfileDetail = await sensitivityDetail(intakeSensitivityProfileId);
    assert.equal(firstProfileDetail.ok, true, JSON.stringify(firstProfileDetail));
    assert.equal(firstProfileDetail.data.sensitivity_review_queue_item, null);
    assert.equal(firstProfileDetail.data.current_decision, null);

    // (E) the exact operation the B1A-2R review-work route delegates to,
    // called with nothing beyond organizationId/intakeSensitivityProfileId/
    // actorContext - mirroring the route's own strictly-empty-body contract.
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: reviewerActor, now: NOW },
      { env: ENV, reviewQueueRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));

    // (F) exactly one review-queue identity now exists for this profile.
    const queueRows = await withClient((client) => client.query(
      `SELECT review_queue_item_id::text AS review_queue_item_id, queue_status
         FROM kai.review_queue_items
        WHERE queue_type = 'sensitivity_review' AND target_object_id = $1::uuid`,
      [intakeSensitivityProfileId],
    ));
    assert.equal(queueRows.rows.length, 1);
    assert.equal(queueRows.rows[0].queue_status, "open");

    // (G, H) the authoritative refetch returns that queue item, and
    // current_decision is still null - the queue is work state, not
    // substantive Phase-5 authority.
    const secondProfileDetail = await sensitivityDetail(intakeSensitivityProfileId);
    assert.equal(secondProfileDetail.ok, true);
    assert.equal(
      secondProfileDetail.data.sensitivity_review_queue_item.review_queue_item_id,
      queueRows.rows[0].review_queue_item_id,
    );
    assert.equal(secondProfileDetail.data.sensitivity_review_queue_item.queue_status, "open");
    assert.equal(secondProfileDetail.data.current_decision, null);
  });

  test("B1A-3B-R2 (I,J): review-work creation grants zero permissive Phase-5 authority and creates no evidence, claim, generated-output, export, or release authority row", async () => {
    const { intakeFileId, intakeSensitivityProfileId } = await seedZeroQueueSensitivityProfile(4);
    await fileDetail(intakeFileId);

    const beforeProfile = await withClient((client) => client.query(
      `SELECT human_review_required, public_use_allowed, funder_use_allowed, llm_processing_allowed,
              product_learning_allowed, retention_posture
         FROM kai.intake_sensitivity_profiles WHERE intake_sensitivity_profile_id = $1::uuid`,
      [intakeSensitivityProfileId],
    ));
    const before = await schemaRowCounts();

    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: reviewerActor, now: NOW },
      { env: ENV, reviewQueueRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));

    const afterProfile = await withClient((client) => client.query(
      `SELECT human_review_required, public_use_allowed, funder_use_allowed, llm_processing_allowed,
              product_learning_allowed, retention_posture
         FROM kai.intake_sensitivity_profiles WHERE intake_sensitivity_profile_id = $1::uuid`,
      [intakeSensitivityProfileId],
    ));
    // (I) no permissive authority was granted - every restriction/requirement
    // fact on the P1-05 profile is byte-for-byte unchanged.
    assert.deepEqual(afterProfile.rows[0], beforeProfile.rows[0]);
    assert.equal(afterProfile.rows[0].human_review_required, true);
    assert.equal(afterProfile.rows[0].public_use_allowed, false);
    assert.equal(afterProfile.rows[0].funder_use_allowed, false);
    assert.equal(afterProfile.rows[0].llm_processing_allowed, false);
    assert.equal(afterProfile.rows[0].product_learning_allowed, false);

    // (J) the only rows that changed are the new queue item and its audit row.
    const after = await schemaRowCounts();
    const changed = Object.keys(after).filter((table) => after[table] !== before[table]).sort();
    assert.deepEqual(changed, ["review_queue_items", "upload_lifecycle_audit"]);
    for (const forbidden of [
      "intake_sensitivity_review_decisions",
      "intake_source_candidates",
      "intake_promotion_decisions",
      "sources",
      "source_versions",
    ]) {
      if (!(forbidden in before)) continue;
      assert.equal(after[forbidden], before[forbidden], `kai.${forbidden} must not have been written`);
    }
  });
}
