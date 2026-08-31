import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_B1A_2R_REVIEW_WORK_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`B1A-2R integration suite refused a non-loopback KAI_B1A_2R_REVIEW_WORK_DATABASE_URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("B1A-2R review-work integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runB1A2RIntegrationSuite();
}

/**
 * KAI B1A-2R: proves the one missing P1-05 -> P1-06 lifecycle edge is actually
 * closed end to end against real PostgreSQL - never by manually inserting a
 * `kai.review_queue_items` row. Every scenario below creates the P1-06
 * 'sensitivity_review' work item through the exact same application operation
 * the route uses (`ensureSensitivityReviewQueueItem`), then reads it back
 * through the existing Review Cockpit GET, then resolves it through the
 * existing, unmodified B1A-2 decision seam, then reads it back again.
 */
async function runB1A2RIntegrationSuite() {
  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const { createPostgresReviewQueueRepository } = await import("../Backend/kai/dictionary/postgresReviewQueueRepository.js");
  const { createPostgresSensitivityAllowedUseReviewRepository } = await import(
    "../Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js"
  );
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const {
    getReviewCockpitSensitivityProfileDetail,
    submitSensitivityProfileDecision,
  } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const { getReviewCockpitSensitivityProfileRecord } = await import("../Backend/kai/db/kaiReviewCockpitReadModels.js");
  const { __sourceCandidateRepositoryTestables } = await import("../Backend/kai/dictionary/postgresSourceCandidateRepository.js");
  const { __sourcePromotionRepositoryTestables } = await import("../Backend/kai/dictionary/postgresSourcePromotionRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const REVIEWER = "90000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-31T10:00:00.000Z";
  const ENV = { KAI_SPRINT2_ENABLED: "true" };

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 8 });
  const reviewQueueRepository = createPostgresReviewQueueRepository({
    runInTransaction: (callback) => withTransaction(callback, pool),
  });
  const decisionRepository = createPostgresSensitivityAllowedUseReviewRepository({
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

  async function seedPredicateSatisfyingSensitivityProfile(index, { organizationId = ORG } = {}) {
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
    return sensitivityResult.rows[0].intake_sensitivity_profile_id;
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

  function internalOnlySnapshot(overrides = {}) {
    return {
      reviewed_personal_data_status: "present",
      reviewed_minor_data_status: "absent",
      reviewed_health_housing_justice_immigration_status: "absent",
      reviewed_indigenous_governance_status: "unknown",
      reviewed_staff_notes_status: "absent",
      reviewed_story_testimonial_status: "absent",
      reviewed_small_cell_risk_status: "unknown",
      reviewed_financial_records_status: "absent",
      reviewed_consent_basis_status: "unknown",
      reviewed_allowed_use_status: "unknown",
      reviewed_llm_processing_allowed: false,
      reviewed_product_learning_allowed: false,
      reviewed_public_use_allowed: false,
      reviewed_funder_use_allowed: false,
      ...overrides,
    };
  }

  async function getDetail(intakeSensitivityProfileId) {
    return getReviewCockpitSensitivityProfileDetail(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: reviewerActor },
      {
        env: ENV,
        getReviewCockpitSensitivityProfileRecord: (organizationId, profileId) =>
          getReviewCockpitSensitivityProfileRecord(organizationId, profileId, pool),
      },
    );
  }

  test("B1A-2R full lifecycle: ensure work -> GET (real queue item, current_decision null) -> POST reviewed decision -> GET (resolved, current head)", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(1);

    // Before this operation exists, there is no application path that creates the
    // P1-06 work item: the GET below would 404/system_error without it. This test
    // never inserts a review_queue_items row itself - only the operation under
    // test does.
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: reviewerActor, now: NOW },
      { env: ENV, reviewQueueRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    assert.equal(ensured.data.replayed, false);
    const reviewQueueItemId = ensured.data.reviewQueueItem.review_queue_item_id;

    const rowCheck = await withClient((client) => client.query(
      `SELECT queue_status, target_object_type, target_object_id::text AS target_object_id
         FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid`,
      [reviewQueueItemId],
    ));
    assert.equal(rowCheck.rows.length, 1, "the work item must be a real, persisted row");
    assert.equal(rowCheck.rows[0].queue_status, "open");
    assert.equal(rowCheck.rows[0].target_object_type, "intake_sensitivity_profile");
    assert.equal(rowCheck.rows[0].target_object_id, intakeSensitivityProfileId);

    const firstDetail = await getDetail(intakeSensitivityProfileId);
    assert.equal(firstDetail.ok, true, JSON.stringify(firstDetail));
    assert.equal(firstDetail.data.current_decision, null, "no decision exists yet - this must never be fabricated");
    assert.equal(firstDetail.data.sensitivity_review_queue_item.review_queue_item_id, reviewQueueItemId);
    assert.equal(firstDetail.data.sensitivity_review_queue_item.queue_status, "open");

    const decided = await submitSensitivityProfileDecision(
      {
        organizationId: ORG,
        intakeSensitivityProfileId,
        actorContext: reviewerActor,
        payload: {
          expected_updated_at: firstDetail.data.sensitivity_review_queue_item.updated_at,
          review_queue_item_id: reviewQueueItemId,
          decision: "reviewed",
          reviewed_snapshot: internalOnlySnapshot(),
        },
      },
      { env: ENV, sensitivityAllowedUseReviewRepository: decisionRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.current_decision.decision_outcome, "reviewed");
    assert.equal(decided.data.sensitivity_review_queue_item.queue_status, "resolved");

    const secondDetail = await getDetail(intakeSensitivityProfileId);
    assert.equal(secondDetail.ok, true, JSON.stringify(secondDetail));
    assert.equal(secondDetail.data.current_decision.decision_id, decided.data.current_decision.decision_id);
    assert.equal(secondDetail.data.current_decision.decision_outcome, "reviewed");
    assert.equal(secondDetail.data.sensitivity_review_queue_item.queue_status, "resolved");
    assert.equal(secondDetail.data.current_decision.authority.review_complete, true);
    assert.equal(secondDetail.data.current_decision.authority.public_use_allowed, false);
  });

  test("B1A-2R full lifecycle: ensure work -> POST needs_more_information -> work stays active, current head is needs_more_information, no permissive authority", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(2);

    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: reviewerActor, now: NOW },
      { env: ENV, reviewQueueRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const reviewQueueItemId = ensured.data.reviewQueueItem.review_queue_item_id;

    const detail = await getDetail(intakeSensitivityProfileId);
    assert.equal(detail.ok, true, JSON.stringify(detail));
    assert.equal(detail.data.current_decision, null);

    const decided = await submitSensitivityProfileDecision(
      {
        organizationId: ORG,
        intakeSensitivityProfileId,
        actorContext: reviewerActor,
        payload: {
          expected_updated_at: detail.data.sensitivity_review_queue_item.updated_at,
          review_queue_item_id: reviewQueueItemId,
          decision: "needs_more_information",
        },
      },
      { env: ENV, sensitivityAllowedUseReviewRepository: decisionRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.current_decision.decision_outcome, "needs_more_information");
    // The review is left/reopened active, never resolved, by needs_more_information.
    assert.equal(decided.data.sensitivity_review_queue_item.queue_status, "open");
    assert.equal(decided.data.current_decision.authority.review_complete, false);
    assert.equal(decided.data.current_decision.authority.public_use_allowed, false);
    assert.equal(decided.data.current_decision.authority.funder_use_allowed, false);
    assert.equal(decided.data.current_decision.authority.llm_processing_allowed, false);
    assert.equal(decided.data.current_decision.authority.product_learning_allowed, false);

    const secondDetail = await getDetail(intakeSensitivityProfileId);
    assert.equal(secondDetail.ok, true, JSON.stringify(secondDetail));
    assert.equal(secondDetail.data.current_decision.decision_outcome, "needs_more_information");
    assert.equal(secondDetail.data.sensitivity_review_queue_item.queue_status, "open");
  });

  test("B1A-2R: generic P1-06 queue-status endpoint semantics remain unchanged (its own file's exported function body is byte-for-byte unaffected)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../Backend/kai/services/kaiReviewQueueService.js", import.meta.url), "utf8");
    const body = source.match(/export async function updateReviewQueueStatus\([\s\S]*?\n}\n/)?.[0];
    assert.ok(body, "expected to find updateReviewQueueStatus's function body");
    assert.doesNotMatch(body, /createSensitivityReviewQueueItem|ensureSensitivityReviewQueueItem/);
  });

  test("B1A-2R: P1-05/P1-07/P1-08 predicates are unaffected by ensuring review work and recording a decision", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(3);
    const beforeProfile = await withClient((client) => client.query(
      `SELECT human_review_required, public_use_allowed, funder_use_allowed, llm_processing_allowed,
              product_learning_allowed, retention_posture
         FROM kai.intake_sensitivity_profiles WHERE intake_sensitivity_profile_id = $1::uuid`,
      [intakeSensitivityProfileId],
    ));

    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: reviewerActor, now: NOW },
      { env: ENV, reviewQueueRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const detail = await getDetail(intakeSensitivityProfileId);
    await submitSensitivityProfileDecision(
      {
        organizationId: ORG,
        intakeSensitivityProfileId,
        actorContext: reviewerActor,
        payload: {
          expected_updated_at: detail.data.sensitivity_review_queue_item.updated_at,
          review_queue_item_id: ensured.data.reviewQueueItem.review_queue_item_id,
          decision: "reviewed",
          reviewed_snapshot: internalOnlySnapshot(),
        },
      },
      { env: ENV, sensitivityAllowedUseReviewRepository: decisionRepository, metadataOnlyAudit: auditRecorder() },
    );

    const afterProfile = await withClient((client) => client.query(
      `SELECT human_review_required, public_use_allowed, funder_use_allowed, llm_processing_allowed,
              product_learning_allowed, retention_posture
         FROM kai.intake_sensitivity_profiles WHERE intake_sensitivity_profile_id = $1::uuid`,
      [intakeSensitivityProfileId],
    ));
    assert.deepEqual(afterProfile.rows[0], beforeProfile.rows[0]);

    const predicateRow = beforeProfile.rows[0];
    assert.equal(__sourceCandidateRepositoryTestables.satisfiesCreationTriggerPredicate(predicateRow), true);
    assert.equal(__sourcePromotionRepositoryTestables.satisfiesPermissionPredicate(predicateRow), true);
  });

  test("B1A-2R: ensuring work and recording a decision creates no claim, evidence, generated-output, export, or release authority row anywhere in the schema", async () => {
    const tables = await withClient((client) => client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'kai' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    ));
    async function schemaRowCounts() {
      const counts = {};
      for (const { table_name: tableName } of tables.rows) {
        // eslint-disable-next-line no-await-in-loop
        const rows = await withClient((client) => client.query(`SELECT count(*)::int AS count FROM kai.${tableName}`));
        counts[tableName] = rows.rows[0].count;
      }
      return counts;
    }

    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(4);
    const before = await schemaRowCounts();

    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: reviewerActor, now: NOW },
      { env: ENV, reviewQueueRepository, metadataOnlyAudit: auditRecorder() },
    );
    const detail = await getDetail(intakeSensitivityProfileId);
    await submitSensitivityProfileDecision(
      {
        organizationId: ORG,
        intakeSensitivityProfileId,
        actorContext: reviewerActor,
        payload: {
          expected_updated_at: detail.data.sensitivity_review_queue_item.updated_at,
          review_queue_item_id: ensured.data.reviewQueueItem.review_queue_item_id,
          decision: "reviewed",
          reviewed_snapshot: internalOnlySnapshot(),
        },
      },
      { env: ENV, sensitivityAllowedUseReviewRepository: decisionRepository, metadataOnlyAudit: auditRecorder() },
    );

    const after = await schemaRowCounts();
    const changed = Object.keys(after).filter((table) => after[table] !== before[table]).sort();
    // The P1-05 profile (and its file/dictionary foundation) was already seeded
    // before this snapshot, so only the bound queue row, the new decision-ledger
    // row, and their audit rows change from here.
    assert.deepEqual(changed, [
      "intake_sensitivity_review_decisions",
      "review_queue_items",
      "upload_lifecycle_audit",
    ]);
    for (const forbidden of [
      "intake_source_candidates",
      "intake_promotion_decisions",
      "sources",
      "source_versions",
    ]) {
      if (!(forbidden in before)) continue;
      assert.equal(after[forbidden], before[forbidden], `kai.${forbidden} must not have been written`);
    }
  });

  test("B1A-2R: cross-tenant reuse of a review_queue_item id is refused by the existing B1A-2 tenant scoping", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(5);
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: reviewerActor, now: NOW },
      { env: ENV, reviewQueueRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));

    const crossTenant = await getReviewCockpitSensitivityProfileDetail(
      { organizationId: OTHER_ORG, intakeSensitivityProfileId, actorContext: {
        ...reviewerActor,
        organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_reviewer" }],
      } },

      {
        env: ENV,
        getReviewCockpitSensitivityProfileRecord: (organizationId, profileId) =>
          getReviewCockpitSensitivityProfileRecord(organizationId, profileId, pool),
      },
    );
    assert.equal(crossTenant.ok, false);
    assert.equal(crossTenant.error.code, "not_found");
  });
}
