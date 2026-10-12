import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P1_07_SOURCE_CANDIDATE_HANDOFF_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P1-07 handoff integration suite refused a non-loopback KAI_P1_07_SOURCE_CANDIDATE_HANDOFF_DATABASE_URL host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P1-07 source-candidate handoff integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runP107HandoffIntegrationSuite();
}

/**
 * KAI P1-07 handoff: proves against real PostgreSQL that the normal human review
 * flow now reaches P1-07 - P1-05 profile -> human ensures review work (P1-06) ->
 * human records a 'reviewed' Phase-5 decision -> the existing P1-07
 * createSourceCandidateStub creates exactly one intake_source_candidate plus
 * exactly one 'source_candidate_review' item -> the P1-08 cockpit candidate
 * detail is readable. No review_queue_items or intake_source_candidates row is
 * ever inserted by this file itself, and nothing is promoted.
 */
async function runP107HandoffIntegrationSuite() {
  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const { insertRequiredSuccessfulAuditEvent } = await import("../Backend/kai/db/kaiAuditQueries.js");
  const { createPostgresReviewQueueRepository } = await import("../Backend/kai/dictionary/postgresReviewQueueRepository.js");
  const { createPostgresSensitivityAllowedUseReviewRepository } = await import(
    "../Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js"
  );
  const {
    __sourceCandidateRepositoryTestables,
    createPostgresSourceCandidateRepository,
  } = await import("../Backend/kai/dictionary/postgresSourceCandidateRepository.js");
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { createSourceCandidateStub } = await import("../Backend/kai/services/kaiSourceCandidateService.js");
  const {
    createProductionMetadataOnlyAuditForSensitivityAllowedUseDecision,
    createProductionMetadataOnlyAuditForSensitivityReviewQueueItem,
    createProductionMetadataOnlyAuditForSourceCandidate,
  } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");
  const {
    getReviewCockpitSensitivityProfileDetail,
    getReviewCockpitSourceCandidateDetail,
    submitSensitivityProfileDecision,
  } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const {
    getReviewCockpitSensitivityProfileRecord,
    getReviewCockpitSourceCandidateRecord,
  } = await import("../Backend/kai/db/kaiReviewCockpitReadModels.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const REVIEWER = "90000000-0000-4000-8000-000000000001";
  const NOW = "2026-09-25T10:00:00.000Z";
  const ENV = { KAI_SPRINT2_ENABLED: "true" };

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 8 });
  const runInTransaction = (callback) => withTransaction(callback, pool);
  const reviewQueueRepository = createPostgresReviewQueueRepository({ runInTransaction });
  const decisionRepository = createPostgresSensitivityAllowedUseReviewRepository({ runInTransaction });
  const sourceCandidateRepository = createPostgresSourceCandidateRepository({ runInTransaction });

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

  async function seedPredicateSatisfyingSensitivityProfile(index) {
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
    const sensitivityResult = await withClient((client) => client.query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::timestamptz)
       RETURNING intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id`,
      [ORG, intakeFileId, fileProfileId, dataDictionaryId, profileCanonicalSha256, NOW],
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

  function internalOnlySnapshot() {
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
    };
  }

  // The real production P1-07 audit adapter, with its required-audit insert bound
  // to the runner-owned database instead of the process-default pool.
  function productionSourceCandidateAudit(intakeSensitivityProfileId, actorContext = reviewerActor) {
    return createProductionMetadataOnlyAuditForSourceCandidate({
      organizationId: ORG,
      intakeSensitivityProfileId,
      actorContext,
      now: NOW,
      insertAuditEvent: (metadata) => insertRequiredSuccessfulAuditEvent(metadata, pool),
    });
  }

  function decisionDependencies(intakeSensitivityProfileId) {
    return {
      env: ENV,
      sensitivityAllowedUseReviewRepository: decisionRepository,
      metadataOnlyAudit: auditRecorder(),
      sourceCandidateRepository,
      sourceCandidateMetadataOnlyAudit: productionSourceCandidateAudit(intakeSensitivityProfileId),
    };
  }

  async function ensureWorkAndReadDetail(intakeSensitivityProfileId) {
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: reviewerActor, now: NOW },
      { env: ENV, reviewQueueRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const detail = await getReviewCockpitSensitivityProfileDetail(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: reviewerActor },
      {
        env: ENV,
        getReviewCockpitSensitivityProfileRecord: (organizationId, profileId) =>
          getReviewCockpitSensitivityProfileRecord(organizationId, profileId, pool),
      },
    );
    assert.equal(detail.ok, true, JSON.stringify(detail));
    return {
      reviewQueueItemId: ensured.data.reviewQueueItem.review_queue_item_id,
      expectedUpdatedAt: detail.data.sensitivity_review_queue_item.updated_at,
    };
  }

  function decisionRequest(intakeSensitivityProfileId, work, decision, actorContext = reviewerActor) {
    return {
      organizationId: ORG,
      intakeSensitivityProfileId,
      actorContext,
      payload: {
        expected_updated_at: work.expectedUpdatedAt,
        review_queue_item_id: work.reviewQueueItemId,
        decision,
        ...(decision === "reviewed" ? { reviewed_snapshot: internalOnlySnapshot() } : {}),
      },
    };
  }

  async function candidateState(intakeSensitivityProfileId) {
    return withClient(async (client) => {
      const candidates = await client.query(
        `SELECT intake_source_candidate_id::text AS intake_source_candidate_id, candidate_status,
                created_by::text AS created_by, created_by_type
           FROM kai.intake_source_candidates
          WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid`,
        [ORG, intakeSensitivityProfileId],
      );
      const candidateIds = candidates.rows.map((row) => row.intake_source_candidate_id);
      const queueItems = candidateIds.length === 0
        ? { rows: [] }
        : await client.query(
          `SELECT review_queue_item_id::text AS review_queue_item_id, queue_status, created_by_type
             FROM kai.review_queue_items
            WHERE organization_id = $1::uuid
              AND queue_type = 'source_candidate_review'
              AND target_object_type = 'intake_source_candidate'
              AND target_object_id = ANY($2::uuid[])`,
          [ORG, candidateIds],
        );
      return { candidates: candidates.rows, queueItems: queueItems.rows };
    });
  }

  async function kaiTableRowCounts() {
    return withClient(async (client) => {
      const tables = await client.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'kai' AND table_type = 'BASE TABLE' ORDER BY table_name`,
      );
      const counts = {};
      for (const { table_name: tableName } of tables.rows) {
        // eslint-disable-next-line no-await-in-loop
        const rows = await client.query(`SELECT count(*)::int AS count FROM kai.${tableName}`);
        counts[tableName] = rows.rows[0].count;
      }
      return counts;
    });
  }

  function changedTables(before, after) {
    return Object.keys(after).filter((table) => after[table] !== before[table]).sort();
  }

  test("A/B/F: a human 'reviewed' decision creates exactly one source candidate and one source_candidate_review item, audits it, promotes nothing, and makes the P1-08 candidate detail reachable", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(1);
    const work = await ensureWorkAndReadDetail(intakeSensitivityProfileId);
    assert.deepEqual(await candidateState(intakeSensitivityProfileId), { candidates: [], queueItems: [] });

    const before = await kaiTableRowCounts();
    const decided = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed"),
      decisionDependencies(intakeSensitivityProfileId),
    );
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.current_decision.decision_outcome, "reviewed");
    assert.equal(decided.data.source_candidate_handoff.status, "created", JSON.stringify(decided.data.source_candidate_handoff));
    assert.equal(decided.data.source_candidate_handoff.candidate_status, "needs_gk_review");
    assert.equal(decided.data.source_candidate_handoff.queue_status, "open");

    const state = await candidateState(intakeSensitivityProfileId);
    assert.equal(state.candidates.length, 1);
    assert.equal(state.queueItems.length, 1);
    assert.equal(state.candidates[0].intake_source_candidate_id, decided.data.source_candidate_handoff.intake_source_candidate_id);
    assert.equal(state.candidates[0].candidate_status, "needs_gk_review");
    assert.equal(state.candidates[0].created_by, REVIEWER);
    assert.equal(state.candidates[0].created_by_type, "human");
    assert.equal(state.queueItems[0].review_queue_item_id, decided.data.source_candidate_handoff.review_queue_item_id);
    assert.equal(state.queueItems[0].created_by_type, "human");

    const after = await kaiTableRowCounts();
    // The decision ledger row, its queue compare-and-set, the P1-07 candidate and
    // its review item, and their audit rows - nothing else. No promotion decision,
    // source, or source_version is ever written by this flow.
    assert.deepEqual(changedTables(before, after), [
      "audit_events",
      "intake_sensitivity_review_decisions",
      "intake_source_candidates",
      "review_queue_items",
      "upload_lifecycle_audit",
    ]);
    assert.equal(after.intake_source_candidates - before.intake_source_candidates, 1);
    assert.equal(after.review_queue_items - before.review_queue_items, 1);
    for (const forbidden of ["intake_promotion_decisions", "sources", "source_versions"]) {
      assert.ok(forbidden in after, `kai.${forbidden} exists in this schema`);
      assert.equal(after[forbidden], before[forbidden], `kai.${forbidden} must not have been written`);
    }

    const audits = await withClient((client) => client.query(
      `SELECT action, actor_type, actor_user_id::text AS actor_user_id, metadata->>'object_id' AS object_id
         FROM kai.audit_events WHERE action = 'intake_source_candidate_persisted'`,
    ));
    const ownAudits = audits.rows.filter((row) => row.object_id === intakeSensitivityProfileId);
    assert.equal(ownAudits.length, 1);
    assert.equal(ownAudits[0].actor_type, "human");
    assert.equal(ownAudits[0].actor_user_id, REVIEWER);
    const lifecycleAudits = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit
        WHERE operation = 'intake_source_candidate_persisted' AND intake_file_id = $1::uuid`,
      [fileId(1)],
    ));
    assert.equal(lifecycleAudits.rows[0].count, 1);

    const candidateDetail = await getReviewCockpitSourceCandidateDetail(
      {
        organizationId: ORG,
        intakeSourceCandidateId: decided.data.source_candidate_handoff.intake_source_candidate_id,
        actorContext: reviewerActor,
      },
      {
        env: ENV,
        getReviewCockpitSourceCandidateRecord: (organizationId, candidateId) =>
          getReviewCockpitSourceCandidateRecord(organizationId, candidateId, pool),
      },
    );
    assert.equal(candidateDetail.ok, true, JSON.stringify(candidateDetail));
  });

  test("C: resubmitting the identical 'reviewed' decision replays both the decision and the candidate with zero new writes", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(2);
    const work = await ensureWorkAndReadDetail(intakeSensitivityProfileId);
    const first = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed"),
      decisionDependencies(intakeSensitivityProfileId),
    );
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.data.source_candidate_handoff.status, "created");

    const before = await kaiTableRowCounts();
    const replay = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed"),
      decisionDependencies(intakeSensitivityProfileId),
    );
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.source_candidate_handoff.status, "replayed");
    assert.equal(
      replay.data.source_candidate_handoff.intake_source_candidate_id,
      first.data.source_candidate_handoff.intake_source_candidate_id,
    );
    assert.deepEqual(changedTables(before, await kaiTableRowCounts()), []);

    const state = await candidateState(intakeSensitivityProfileId);
    assert.equal(state.candidates.length, 1);
    assert.equal(state.queueItems.length, 1);
  });

  test("D: system and AI actors cannot trigger candidate creation through the decision seam or the P1-07 service", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(3);
    const work = await ensureWorkAndReadDetail(intakeSensitivityProfileId);
    const before = await kaiTableRowCounts();

    for (const actorType of ["system", "ai"]) {
      const viaDecision = await submitSensitivityProfileDecision(
        decisionRequest(intakeSensitivityProfileId, work, "reviewed", { ...reviewerActor, actorType }),
        decisionDependencies(intakeSensitivityProfileId),
      );
      assert.equal(viaDecision.ok, false, actorType);
      assert.equal(viaDecision.error.code, "authorization_denied", actorType);

      const direct = await createSourceCandidateStub(
        {
          organizationId: ORG,
          intakeSensitivityProfileId,
          actorContext: { ...reviewerActor, actorType },
          now: NOW,
        },
        { env: ENV, sourceCandidateRepository, metadataOnlyAudit: productionSourceCandidateAudit(intakeSensitivityProfileId) },
      );
      assert.equal(direct.ok, false, actorType);
      assert.equal(direct.error.code, "authorization_denied", actorType);
    }

    assert.deepEqual(changedTables(before, await kaiTableRowCounts()), []);
    assert.deepEqual(await candidateState(intakeSensitivityProfileId), { candidates: [], queueItems: [] });
  });

  test("'needs_more_information' records the decision but creates no source candidate", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(4);
    const work = await ensureWorkAndReadDetail(intakeSensitivityProfileId);
    const decided = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "needs_more_information"),
      decisionDependencies(intakeSensitivityProfileId),
    );
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.source_candidate_handoff.status, "not_applicable");
    assert.deepEqual(await candidateState(intakeSensitivityProfileId), { candidates: [], queueItems: [] });
  });

  test("E: a VAL-KAI-P1-07-001 predicate failure leaves the reviewed decision committed and creates no candidate or queue item", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(5);
    const work = await ensureWorkAndReadDetail(intakeSensitivityProfileId);

    // The committed schema pins every P1-05 permission column fail-closed, so a
    // predicate-failing row cannot exist there. In this runner-owned, throwaway
    // database only, lift one CHECK long enough to put exactly one profile into
    // that state, then restore the CHECK (NOT VALID, since this one row now
    // violates it) so every other scenario keeps the committed pinning.
    await withClient(async (client) => {
      await client.query("ALTER TABLE kai.intake_sensitivity_profiles DROP CONSTRAINT intake_sensitivity_profiles_p1_05_public_use_check");
      await client.query(
        "UPDATE kai.intake_sensitivity_profiles SET public_use_allowed = true WHERE intake_sensitivity_profile_id = $1::uuid",
        [intakeSensitivityProfileId],
      );
      await client.query(
        `ALTER TABLE kai.intake_sensitivity_profiles
           ADD CONSTRAINT intake_sensitivity_profiles_p1_05_public_use_check CHECK (public_use_allowed = false) NOT VALID`,
      );
    });

    const decided = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed"),
      decisionDependencies(intakeSensitivityProfileId),
    );
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.current_decision.decision_outcome, "reviewed");
    assert.equal(decided.data.source_candidate_handoff.status, "not_created");
    assert.equal(decided.data.source_candidate_handoff.error_code, "validation_blocker");
    assert.deepEqual(await candidateState(intakeSensitivityProfileId), { candidates: [], queueItems: [] });
    const audits = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.audit_events
        WHERE action = 'intake_source_candidate_persisted' AND metadata->>'object_id' = $1`,
      [intakeSensitivityProfileId],
    ));
    assert.equal(audits.rows[0].count, 0);
  });

  // ---------------------------------------------------------------------------
  // Owner decision (2026-10-11): a mapped human holding a global gk_admin,
  // gk_operator, or gk_reviewer role whose active membership in the organization
  // is a client role (here client_admin) may start P1-06 review work and reach
  // the P1-07 handoff. Every other gate - human only, active membership in the
  // requested organization, tenant-scoped reads, the VAL-FUP-001-P0 and
  // VAL-KAI-P1-07-001 predicates, idempotency, and required audit - still applies.
  // ---------------------------------------------------------------------------

  const MIXED_REVIEWER = "90000000-0000-4000-8000-000000000002";
  const MIXED_ADMIN = "90000000-0000-4000-8000-000000000003";
  const MIXED_OPERATOR = "90000000-0000-4000-8000-000000000004";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";

  function mixedRoleActor(globalRole, actorUserId, overrides = {}) {
    return {
      actorType: "human",
      actorUserId,
      kaiRoles: [globalRole],
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }],
      ...overrides,
    };
  }

  const mixedReviewer = mixedRoleActor("gk_reviewer", MIXED_REVIEWER);

  // The real production P1-06 and decision audit adapters, with their required
  // audit inserts bound to the runner-owned database.
  function productionReviewWorkAudit(intakeSensitivityProfileId, actorContext, organizationId = ORG) {
    return createProductionMetadataOnlyAuditForSensitivityReviewQueueItem({
      organizationId,
      intakeSensitivityProfileId,
      actorContext,
      now: NOW,
      insertAuditEvent: (metadata) => insertRequiredSuccessfulAuditEvent(metadata, pool),
    });
  }

  function productionDecisionDependencies(intakeSensitivityProfileId, actorContext) {
    return {
      env: ENV,
      sensitivityAllowedUseReviewRepository: decisionRepository,
      metadataOnlyAudit: createProductionMetadataOnlyAuditForSensitivityAllowedUseDecision({
        organizationId: ORG,
        intakeSensitivityProfileId,
        actorContext,
        now: NOW,
        insertAuditEvent: (metadata) => insertRequiredSuccessfulAuditEvent(metadata, pool),
      }),
      sourceCandidateRepository,
      sourceCandidateMetadataOnlyAudit: productionSourceCandidateAudit(intakeSensitivityProfileId, actorContext),
    };
  }

  function ensureReviewWorkAs(actorContext, intakeSensitivityProfileId, { organizationId = ORG, env = ENV } = {}) {
    return ensureSensitivityReviewQueueItem(
      { organizationId, intakeSensitivityProfileId, actorContext, now: NOW },
      {
        env,
        reviewQueueRepository,
        metadataOnlyAudit: productionReviewWorkAudit(intakeSensitivityProfileId, actorContext, organizationId),
      },
    );
  }

  function createCandidateAs(actorContext, intakeSensitivityProfileId, { organizationId = ORG, env = ENV } = {}) {
    return createSourceCandidateStub(
      { organizationId, intakeSensitivityProfileId, actorContext, now: NOW },
      { env, sourceCandidateRepository, metadataOnlyAudit: productionSourceCandidateAudit(intakeSensitivityProfileId, actorContext) },
    );
  }

  async function readDetailAs(actorContext, intakeSensitivityProfileId) {
    const detail = await getReviewCockpitSensitivityProfileDetail(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext },
      {
        env: ENV,
        getReviewCockpitSensitivityProfileRecord: (organizationId, profileId) =>
          getReviewCockpitSensitivityProfileRecord(organizationId, profileId, pool),
      },
    );
    assert.equal(detail.ok, true, JSON.stringify(detail));
    return detail.data;
  }

  async function sensitivityReviewItems(intakeSensitivityProfileId) {
    const rows = await withClient((client) => client.query(
      `SELECT review_queue_item_id::text AS review_queue_item_id, queue_status, review_status,
              created_by::text AS created_by, created_by_type
         FROM kai.review_queue_items
        WHERE organization_id = $1::uuid
          AND queue_type = 'sensitivity_review'
          AND target_object_type = 'intake_sensitivity_profile'
          AND target_object_id = $2::uuid`,
      [ORG, intakeSensitivityProfileId],
    ));
    return rows.rows;
  }

  async function decisionRows(intakeSensitivityProfileId) {
    const rows = await withClient((client) => client.query(
      `SELECT decision_id::text AS decision_id, decision_outcome, decided_by::text AS decided_by, decided_by_role
         FROM kai.intake_sensitivity_review_decisions
        WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid
        ORDER BY created_at, decision_id`,
      [ORG, intakeSensitivityProfileId],
    ));
    return rows.rows;
  }

  async function auditActions(intakeSensitivityProfileId) {
    const rows = await withClient((client) => client.query(
      `SELECT action, actor_type, actor_user_id::text AS actor_user_id
         FROM kai.audit_events
        WHERE metadata->>'object_id' = $1
        ORDER BY action`,
      [intakeSensitivityProfileId],
    ));
    return rows.rows;
  }

  async function lifecycleOperations(index) {
    const rows = await withClient((client) => client.query(
      `SELECT operation FROM kai.upload_lifecycle_audit WHERE intake_file_id = $1::uuid ORDER BY operation`,
      [fileId(index)],
    ));
    return rows.rows.map((row) => row.operation);
  }

  // Same throwaway-database-only technique as scenario E: lift one P1-05 CHECK
  // long enough to make exactly one profile fail the creation-trigger predicate.
  async function makeProfileIneligible(intakeSensitivityProfileId) {
    await withClient(async (client) => {
      await client.query("ALTER TABLE kai.intake_sensitivity_profiles DROP CONSTRAINT intake_sensitivity_profiles_p1_05_public_use_check");
      await client.query(
        "UPDATE kai.intake_sensitivity_profiles SET public_use_allowed = true WHERE intake_sensitivity_profile_id = $1::uuid",
        [intakeSensitivityProfileId],
      );
      await client.query(
        `ALTER TABLE kai.intake_sensitivity_profiles
           ADD CONSTRAINT intake_sensitivity_profiles_p1_05_public_use_check CHECK (public_use_allowed = false) NOT VALID`,
      );
    });
  }

  test("mixed role (P1-06): a global gk_reviewer with an active client_admin membership starts review work on a zero-queue profile - one sensitivity_review item and its audits, no decision - and a repeat replays with zero writes", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(11);
    assert.deepEqual(await sensitivityReviewItems(intakeSensitivityProfileId), []);

    const before = await kaiTableRowCounts();
    const ensured = await ensureReviewWorkAs(mixedReviewer, intakeSensitivityProfileId);
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    assert.equal(ensured.data.replayed, false);
    const after = await kaiTableRowCounts();

    assert.deepEqual(changedTables(before, after), ["audit_events", "review_queue_items", "upload_lifecycle_audit"]);
    assert.equal(after.review_queue_items - before.review_queue_items, 1);
    const items = await sensitivityReviewItems(intakeSensitivityProfileId);
    assert.equal(items.length, 1);
    assert.equal(items[0].review_queue_item_id, ensured.data.reviewQueueItem.review_queue_item_id);
    assert.equal(items[0].queue_status, "open");
    assert.equal(items[0].created_by, MIXED_REVIEWER);
    assert.equal(items[0].created_by_type, "human");
    assert.deepEqual(await decisionRows(intakeSensitivityProfileId), []);
    assert.deepEqual(await auditActions(intakeSensitivityProfileId), [
      { action: "sensitivity_review_queue_item_created", actor_type: "human", actor_user_id: MIXED_REVIEWER },
    ]);
    assert.deepEqual(await lifecycleOperations(11), ["sensitivity_review_queue_item_created"]);

    const detail = await readDetailAs(mixedReviewer, intakeSensitivityProfileId);
    assert.equal(detail.current_decision, null, "starting review work records no decision");
    assert.equal(detail.sensitivity_review_queue_item.review_queue_item_id, items[0].review_queue_item_id);

    const replayBefore = await kaiTableRowCounts();
    const replay = await ensureReviewWorkAs(mixedReviewer, intakeSensitivityProfileId);
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.reviewQueueItem.review_queue_item_id, items[0].review_queue_item_id);
    assert.deepEqual(changedTables(replayBefore, await kaiTableRowCounts()), []);
  });

  test("mixed role (P1-06): the VAL-FUP-001-P0 predicate still blocks an ineligible profile, with nothing written", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(12);
    await makeProfileIneligible(intakeSensitivityProfileId);

    const before = await kaiTableRowCounts();
    const ensured = await ensureReviewWorkAs(mixedReviewer, intakeSensitivityProfileId);
    assert.equal(ensured.ok, false);
    assert.equal(ensured.error.code, "validation_blocker");
    assert.deepEqual(changedTables(before, await kaiTableRowCounts()), []);
  });

  test("mixed role (decision + P1-07): a global gk_reviewer with an active client_admin membership records 'reviewed' and the handoff creates exactly one needs_gk_review candidate and its review item; nothing is promoted; a repeat replays with zero writes", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(13);
    const work = await ensureWorkAndReadDetail(intakeSensitivityProfileId);

    const before = await kaiTableRowCounts();
    const decided = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed", mixedReviewer),
      productionDecisionDependencies(intakeSensitivityProfileId, mixedReviewer),
    );
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.replayed, false);
    assert.equal(decided.data.current_decision.decision_outcome, "reviewed");
    assert.equal(decided.data.current_decision.decided_by, MIXED_REVIEWER);
    assert.equal(decided.data.current_decision.decided_by_role, "gk_reviewer");
    assert.equal(decided.data.sensitivity_review_queue_item.queue_status, "resolved");
    assert.deepEqual(
      { status: decided.data.source_candidate_handoff.status, error_code: decided.data.source_candidate_handoff.error_code },
      { status: "created", error_code: null },
    );
    assert.equal(decided.data.source_candidate_handoff.candidate_status, "needs_gk_review");
    assert.equal(decided.data.source_candidate_handoff.queue_status, "open");

    const after = await kaiTableRowCounts();
    // Every kai table is compared, so this also proves no promotion decision,
    // source, source version, evidence item, claim, generated output, export, or
    // release-authority row was written.
    assert.deepEqual(changedTables(before, after), [
      "audit_events",
      "intake_sensitivity_review_decisions",
      "intake_source_candidates",
      "review_queue_items",
      "upload_lifecycle_audit",
    ]);
    assert.equal(after.intake_sensitivity_review_decisions - before.intake_sensitivity_review_decisions, 1);
    assert.equal(after.intake_source_candidates - before.intake_source_candidates, 1);
    assert.equal(after.review_queue_items - before.review_queue_items, 1);

    assert.deepEqual(await decisionRows(intakeSensitivityProfileId), [{
      decision_id: decided.data.current_decision.decision_id,
      decision_outcome: "reviewed",
      decided_by: MIXED_REVIEWER,
      decided_by_role: "gk_reviewer",
    }]);
    const items = await sensitivityReviewItems(intakeSensitivityProfileId);
    assert.equal(items.length, 1);
    assert.equal(items[0].queue_status, "resolved");
    assert.equal(items[0].review_status, "resolved");

    const profileRow = await withClient((client) => client.query(
      `SELECT human_review_required, public_use_allowed, funder_use_allowed, llm_processing_allowed,
              product_learning_allowed, retention_posture
         FROM kai.intake_sensitivity_profiles WHERE intake_sensitivity_profile_id = $1::uuid`,
      [intakeSensitivityProfileId],
    ));
    assert.equal(__sourceCandidateRepositoryTestables.satisfiesCreationTriggerPredicate(profileRow.rows[0]), true);

    const state = await candidateState(intakeSensitivityProfileId);
    assert.equal(state.candidates.length, 1);
    assert.equal(state.queueItems.length, 1);
    assert.equal(state.candidates[0].intake_source_candidate_id, decided.data.source_candidate_handoff.intake_source_candidate_id);
    assert.equal(state.candidates[0].candidate_status, "needs_gk_review");
    assert.equal(state.candidates[0].created_by, MIXED_REVIEWER);
    assert.equal(state.candidates[0].created_by_type, "human");
    assert.equal(state.queueItems[0].queue_status, "open");

    const actions = (await auditActions(intakeSensitivityProfileId)).filter((row) => row.actor_user_id === MIXED_REVIEWER);
    assert.deepEqual(actions.map((row) => row.action), [
      "intake_source_candidate_persisted",
      "sensitivity_review_decision_recorded",
    ]);
    assert.ok(actions.every((row) => row.actor_type === "human"));
    assert.deepEqual(await lifecycleOperations(13), [
      "intake_source_candidate_persisted",
      "sensitivity_review_decision_recorded",
      "sensitivity_review_queue_item_created",
    ]);

    const replayBefore = await kaiTableRowCounts();
    const replay = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed", mixedReviewer),
      productionDecisionDependencies(intakeSensitivityProfileId, mixedReviewer),
    );
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.current_decision.decision_id, decided.data.current_decision.decision_id);
    assert.equal(replay.data.source_candidate_handoff.status, "replayed");
    assert.equal(
      replay.data.source_candidate_handoff.intake_source_candidate_id,
      decided.data.source_candidate_handoff.intake_source_candidate_id,
    );
    assert.deepEqual(changedTables(replayBefore, await kaiTableRowCounts()), []);
  });

  test("mixed role (decision): 'needs_more_information' stays nonterminal and creates no source candidate", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(14);
    const work = await ensureWorkAndReadDetail(intakeSensitivityProfileId);
    const decided = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "needs_more_information", mixedReviewer),
      productionDecisionDependencies(intakeSensitivityProfileId, mixedReviewer),
    );
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.current_decision.decision_outcome, "needs_more_information");
    assert.equal(decided.data.sensitivity_review_queue_item.queue_status, "open");
    assert.equal(decided.data.source_candidate_handoff.status, "not_applicable");
    assert.deepEqual(await candidateState(intakeSensitivityProfileId), { candidates: [], queueItems: [] });
  });

  test("mixed role (recovery): a committed 'reviewed' decision whose earlier handoff failed is recovered by replaying the identical request - no second decision, exactly one candidate and review item, and later replays write nothing", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(15);
    const work = await ensureWorkAndReadDetail(intakeSensitivityProfileId);

    // Synthetic prior state: the decision committed but the P1-07 handoff was
    // refused (the pre-2026-10-11 membership-only P1-07 role check returned
    // tenant_boundary_violation for this actor).
    const failedHandoff = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed", mixedReviewer),
      {
        ...productionDecisionDependencies(intakeSensitivityProfileId, mixedReviewer),
        createSourceCandidateStub: async () => ({ ok: false, data: null, error: { code: "tenant_boundary_violation" } }),
      },
    );
    assert.equal(failedHandoff.ok, true, JSON.stringify(failedHandoff));
    assert.equal(failedHandoff.data.source_candidate_handoff.status, "not_created");
    assert.equal(failedHandoff.data.source_candidate_handoff.error_code, "tenant_boundary_violation");
    const committed = await decisionRows(intakeSensitivityProfileId);
    assert.equal(committed.length, 1);
    assert.equal((await sensitivityReviewItems(intakeSensitivityProfileId))[0].queue_status, "resolved");
    assert.deepEqual(await candidateState(intakeSensitivityProfileId), { candidates: [], queueItems: [] });
    const decisionAuditsBefore = (await auditActions(intakeSensitivityProfileId))
      .filter((row) => row.action === "sensitivity_review_decision_recorded");
    assert.equal(decisionAuditsBefore.length, 1);

    const before = await kaiTableRowCounts();
    const recovered = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed", mixedReviewer),
      productionDecisionDependencies(intakeSensitivityProfileId, mixedReviewer),
    );
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(recovered.data.replayed, true);
    assert.equal(recovered.data.current_decision.decision_id, committed[0].decision_id);
    assert.deepEqual(
      { status: recovered.data.source_candidate_handoff.status, error_code: recovered.data.source_candidate_handoff.error_code },
      { status: "created", error_code: null },
    );
    // No decision-ledger write: only the candidate, its review item, and their audits.
    assert.deepEqual(changedTables(before, await kaiTableRowCounts()), [
      "audit_events",
      "intake_source_candidates",
      "review_queue_items",
      "upload_lifecycle_audit",
    ]);
    assert.deepEqual(await decisionRows(intakeSensitivityProfileId), committed);
    assert.equal(
      (await auditActions(intakeSensitivityProfileId)).filter((row) => row.action === "sensitivity_review_decision_recorded").length,
      1,
    );
    const state = await candidateState(intakeSensitivityProfileId);
    assert.equal(state.candidates.length, 1);
    assert.equal(state.queueItems.length, 1);
    assert.equal(state.candidates[0].candidate_status, "needs_gk_review");

    const replayBefore = await kaiTableRowCounts();
    const replay = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed", mixedReviewer),
      productionDecisionDependencies(intakeSensitivityProfileId, mixedReviewer),
    );
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.data.source_candidate_handoff.status, "replayed");
    assert.deepEqual(changedTables(replayBefore, await kaiTableRowCounts()), []);
  });

  test("mixed role (role matrix): global gk_admin and gk_operator with an active client_admin membership complete review work, the 'reviewed' decision, and the handoff, attributed to their own global role", async () => {
    const cases = [
      ["gk_admin", MIXED_ADMIN, 16],
      ["gk_operator", MIXED_OPERATOR, 17],
    ];
    for (const [role, actorUserId, index] of cases) {
      const actor = mixedRoleActor(role, actorUserId);
      const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(index);

      const ensured = await ensureReviewWorkAs(actor, intakeSensitivityProfileId);
      assert.equal(ensured.ok, true, `${role}: ${JSON.stringify(ensured)}`);
      assert.equal(ensured.data.replayed, false, role);
      const detail = await readDetailAs(actor, intakeSensitivityProfileId);
      const work = {
        reviewQueueItemId: ensured.data.reviewQueueItem.review_queue_item_id,
        expectedUpdatedAt: detail.sensitivity_review_queue_item.updated_at,
      };

      const decided = await submitSensitivityProfileDecision(
        decisionRequest(intakeSensitivityProfileId, work, "reviewed", actor),
        productionDecisionDependencies(intakeSensitivityProfileId, actor),
      );
      assert.equal(decided.ok, true, `${role}: ${JSON.stringify(decided)}`);
      assert.equal(decided.data.current_decision.decided_by, actorUserId, role);
      assert.equal(decided.data.current_decision.decided_by_role, role, role);
      assert.equal(decided.data.source_candidate_handoff.status, "created", `${role}: ${JSON.stringify(decided.data.source_candidate_handoff)}`);

      const state = await candidateState(intakeSensitivityProfileId);
      assert.equal(state.candidates.length, 1, role);
      assert.equal(state.queueItems.length, 1, role);
      assert.equal(state.candidates[0].created_by, actorUserId, role);
      assert.equal(state.candidates[0].candidate_status, "needs_gk_review", role);
    }
  });

  test("mixed role (negatives): client-only, missing, other-organization, revoked, or inactive membership, non-human actors, a disabled feature, and a cross-organization profile identifier write nothing at either operation", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(18);
    const otherOrgMembership = [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "client_admin" }];
    const denied = [
      ["client_admin without a global GK role", {
        actorType: "human",
        actorUserId: MIXED_REVIEWER,
        organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }],
      }, "tenant_boundary_violation"],
      ["global gk_reviewer with no membership", mixedRoleActor("gk_reviewer", MIXED_REVIEWER, { organizationMemberships: [] }), "tenant_boundary_violation"],
      ["global gk_reviewer with membership only in another organization", mixedRoleActor("gk_reviewer", MIXED_REVIEWER, {
        organizationMemberships: otherOrgMembership,
      }), "tenant_boundary_violation"],
      ["global gk_reviewer with a revoked membership", mixedRoleActor("gk_reviewer", MIXED_REVIEWER, {
        organizationMemberships: [{ organization_id: ORG, membership_status: "revoked", role_name: "client_admin" }],
      }), "tenant_boundary_violation"],
      ["global gk_operator with an inactive membership", mixedRoleActor("gk_operator", MIXED_OPERATOR, {
        organizationMemberships: [{ organization_id: ORG, membership_status: "inactive", role_name: "client_admin" }],
      }), "tenant_boundary_violation"],
      ...["ai", "assistant", "system", "import"].map((actorType) => [
        `${actorType} actor carrying a mixed-role context`,
        mixedRoleActor("gk_admin", MIXED_ADMIN, { actorType }),
        "authorization_denied",
      ]),
    ];

    const before = await kaiTableRowCounts();
    for (const [label, actorContext, expectedCode] of denied) {
      const ensured = await ensureReviewWorkAs(actorContext, intakeSensitivityProfileId);
      assert.equal(ensured.ok, false, `P1-06 ${label}`);
      assert.equal(ensured.error.code, expectedCode, `P1-06 ${label}`);
      const candidate = await createCandidateAs(actorContext, intakeSensitivityProfileId);
      assert.equal(candidate.ok, false, `P1-07 ${label}`);
      assert.equal(candidate.error.code, expectedCode, `P1-07 ${label}`);
    }

    const disabledEnv = { KAI_SPRINT2_ENABLED: "false" };
    assert.equal((await ensureReviewWorkAs(mixedReviewer, intakeSensitivityProfileId, { env: disabledEnv })).error.code, "feature_disabled");
    assert.equal((await createCandidateAs(mixedReviewer, intakeSensitivityProfileId, { env: disabledEnv })).error.code, "feature_disabled");

    // An actor authorized in another organization cannot reach this
    // organization's profile by naming its own organization.
    const otherOrgActor = mixedRoleActor("gk_reviewer", MIXED_REVIEWER, { organizationMemberships: otherOrgMembership });
    const crossEnsure = await ensureReviewWorkAs(otherOrgActor, intakeSensitivityProfileId, { organizationId: OTHER_ORG });
    assert.equal(crossEnsure.ok, false);
    assert.equal(crossEnsure.error.code, "not_found");
    const crossCandidate = await createCandidateAs(otherOrgActor, intakeSensitivityProfileId, { organizationId: OTHER_ORG });
    assert.equal(crossCandidate.ok, false);
    assert.equal(crossCandidate.error.code, "not_found");

    assert.deepEqual(changedTables(before, await kaiTableRowCounts()), []);
  });

  test("existing membership-role authorization is preserved: a human whose organization membership is gk_operator, with no global role, still starts review work", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(19);
    const membershipOnlyOperator = {
      actorType: "human",
      actorUserId: MIXED_OPERATOR,
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
    };
    const ensured = await ensureReviewWorkAs(membershipOnlyOperator, intakeSensitivityProfileId);
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    assert.equal(ensured.data.replayed, false);
    assert.equal((await sensitivityReviewItems(intakeSensitivityProfileId)).length, 1);
  });

  // ---------------------------------------------------------------------------
  // KAI P1-07 first-failure reproduction (2026-10-12). The owner-approved bound
  // organization administrator (4191684) may record the sensitivity decision,
  // attributed `client_admin`, but P1-07 createSourceCandidateStub still admits
  // only gk_admin/gk_operator/gk_reviewer (membership or global). These tests pin
  // that boundary as it is; they do not widen P1-07.
  // ---------------------------------------------------------------------------

  const BOUND_ADMIN = "90000000-0000-4000-8000-000000000005";
  const BOUND_MIXED_REVIEWER = "90000000-0000-4000-8000-000000000006";
  const GK_ORGANIZATION_ID = 4242;

  // Exactly the derived membership gkOrganizationBindingAuthority emits.
  function boundAdminMembership(overrides = {}) {
    return {
      organization_id: ORG,
      role_name: "client_admin",
      membership_status: "active",
      source: "gk_organization_binding",
      gk_organization_id: GK_ORGANIZATION_ID,
      ...overrides,
    };
  }

  // Actor A: mapped human, active bound client_admin, no global GK role, no superuser.
  const boundAdmin = {
    actorType: "human",
    actorUserId: BOUND_ADMIN,
    kaiRoles: [],
    organizationMemberships: [boundAdminMembership()],
    platformSuperuser: false,
  };
  // Actor B: mapped human, global gk_reviewer, the same active bound client_admin, no superuser.
  const boundMixedReviewer = {
    actorType: "human",
    actorUserId: BOUND_MIXED_REVIEWER,
    kaiRoles: ["gk_reviewer"],
    organizationMemberships: [boundAdminMembership()],
    platformSuperuser: false,
  };

  function countingSourceCandidateRepository() {
    const calls = { createSourceCandidateStub: 0 };
    return {
      calls,
      repository: {
        async createSourceCandidateStub(input) {
          calls.createSourceCandidateStub += 1;
          return sourceCandidateRepository.createSourceCandidateStub(input);
        },
      },
    };
  }

  async function profilePredicate(intakeSensitivityProfileId) {
    const row = await withClient((client) => client.query(
      `SELECT human_review_required, public_use_allowed, funder_use_allowed, llm_processing_allowed,
              product_learning_allowed, retention_posture
         FROM kai.intake_sensitivity_profiles WHERE intake_sensitivity_profile_id = $1::uuid`,
      [intakeSensitivityProfileId],
    ));
    return __sourceCandidateRepositoryTestables.satisfiesCreationTriggerPredicate(row.rows[0]);
  }

  async function decisionAuditCount(intakeSensitivityProfileId) {
    return (await auditActions(intakeSensitivityProfileId))
      .filter((row) => row.action === "sensitivity_review_decision_recorded").length;
  }

  async function workAs(actorContext, intakeSensitivityProfileId) {
    const ensured = await ensureReviewWorkAs(actorContext, intakeSensitivityProfileId);
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const detail = await readDetailAs(actorContext, intakeSensitivityProfileId);
    return {
      reviewQueueItemId: ensured.data.reviewQueueItem.review_queue_item_id,
      expectedUpdatedAt: detail.sensitivity_review_queue_item.updated_at,
    };
  }

  test("P1-07 first failure, Actor A (bound client_admin, no global GK role): review work and the 'reviewed' decision commit as client_admin and resolve the queue, the handoff runs, and createSourceCandidateStub refuses it at VAL-AUT-004 role_not_allowed before the repository, so no candidate exists", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(21);
    const work = await workAs(boundAdmin, intakeSensitivityProfileId);
    assert.equal(await profilePredicate(intakeSensitivityProfileId), true, "the profile satisfies VAL-KAI-P1-07-001");

    const counted = countingSourceCandidateRepository();
    const before = await kaiTableRowCounts();
    const decided = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed", boundAdmin),
      {
        ...productionDecisionDependencies(intakeSensitivityProfileId, boundAdmin),
        sourceCandidateRepository: counted.repository,
      },
    );
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.replayed, false);
    assert.equal(decided.data.current_decision.decision_outcome, "reviewed");
    assert.equal(decided.data.current_decision.decided_by, BOUND_ADMIN);
    assert.equal(decided.data.current_decision.decided_by_role, "client_admin");
    assert.equal(decided.data.sensitivity_review_queue_item.queue_status, "resolved");
    assert.deepEqual(decided.data.source_candidate_handoff, {
      status: "not_created",
      intake_source_candidate_id: null,
      candidate_status: null,
      review_queue_item_id: null,
      queue_status: null,
      error_code: "tenant_boundary_violation",
    });
    assert.equal(counted.calls.createSourceCandidateStub, 0, "P1-07 never reached its repository (predicate, persistence, audit)");

    const after = await kaiTableRowCounts();
    assert.deepEqual(changedTables(before, after), [
      "audit_events",
      "intake_sensitivity_review_decisions",
      "upload_lifecycle_audit",
    ]);
    assert.deepEqual(await decisionRows(intakeSensitivityProfileId), [{
      decision_id: decided.data.current_decision.decision_id,
      decision_outcome: "reviewed",
      decided_by: BOUND_ADMIN,
      decided_by_role: "client_admin",
    }]);
    const items = await sensitivityReviewItems(intakeSensitivityProfileId);
    assert.equal(items.length, 1);
    assert.equal(items[0].queue_status, "resolved");
    assert.equal(items[0].review_status, "resolved");
    assert.deepEqual(await candidateState(intakeSensitivityProfileId), { candidates: [], queueItems: [] });
    assert.equal(await decisionAuditCount(intakeSensitivityProfileId), 1);

    // The same P1-07 check in isolation, against the same otherwise eligible profile.
    const direct = await createSourceCandidateStub(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: boundAdmin, now: NOW },
      { env: ENV, sourceCandidateRepository: counted.repository, metadataOnlyAudit: productionSourceCandidateAudit(intakeSensitivityProfileId, boundAdmin) },
    );
    assert.equal(direct.ok, false);
    assert.equal(direct.error.code, "tenant_boundary_violation");
    assert.equal(direct.blockers.length, 1);
    assert.equal(direct.blockers[0].validator_key, "VAL-AUT-004");
    assert.equal(direct.blockers[0].blocking_reason, "role_not_allowed");
    assert.equal(direct.blockers[0].object_code, "create_source_candidate_stub");
    assert.equal(counted.calls.createSourceCandidateStub, 0);
    assert.deepEqual(changedTables(after, await kaiTableRowCounts()), []);
  });

  test("P1-07 first failure, Actor B (global gk_reviewer + bound client_admin): the 'reviewed' decision is attributed gk_reviewer and the handoff creates exactly one needs_gk_review candidate and its review item", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(22);
    const work = await workAs(boundMixedReviewer, intakeSensitivityProfileId);

    const before = await kaiTableRowCounts();
    const decided = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed", boundMixedReviewer),
      productionDecisionDependencies(intakeSensitivityProfileId, boundMixedReviewer),
    );
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.current_decision.decided_by, BOUND_MIXED_REVIEWER);
    assert.equal(decided.data.current_decision.decided_by_role, "gk_reviewer");
    assert.equal(decided.data.sensitivity_review_queue_item.queue_status, "resolved");
    assert.deepEqual(
      { status: decided.data.source_candidate_handoff.status, error_code: decided.data.source_candidate_handoff.error_code },
      { status: "created", error_code: null },
    );
    assert.deepEqual(changedTables(before, await kaiTableRowCounts()), [
      "audit_events",
      "intake_sensitivity_review_decisions",
      "intake_source_candidates",
      "review_queue_items",
      "upload_lifecycle_audit",
    ]);
    const state = await candidateState(intakeSensitivityProfileId);
    assert.equal(state.candidates.length, 1);
    assert.equal(state.queueItems.length, 1);
    assert.equal(state.candidates[0].created_by, BOUND_MIXED_REVIEWER);
    assert.equal(state.candidates[0].candidate_status, "needs_gk_review");
    assert.equal(state.queueItems[0].queue_status, "open");
  });

  test("P1-07 recovery without re-review: after Actor A's committed client_admin 'reviewed' decision, Actor A's identical replay still creates nothing; an authorized GK human's identical replay (the head's original stamp) replays the decision and creates exactly one candidate; the API does not expose that stamp; a wrong stamp is refused", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(23);
    const work = await workAs(boundAdmin, intakeSensitivityProfileId);
    const first = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed", boundAdmin),
      productionDecisionDependencies(intakeSensitivityProfileId, boundAdmin),
    );
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.data.source_candidate_handoff.status, "not_created");
    const committed = await decisionRows(intakeSensitivityProfileId);
    assert.equal(committed.length, 1);
    assert.equal(committed[0].decided_by_role, "client_admin");

    // The read API returns the committed decision but not its target_updated_at.
    const detail = await readDetailAs(boundMixedReviewer, intakeSensitivityProfileId);
    assert.equal(detail.current_decision.decision_id, committed[0].decision_id);
    assert.equal(Object.hasOwn(detail.current_decision, "target_updated_at"), false);
    assert.notEqual(detail.sensitivity_review_queue_item.updated_at, work.expectedUpdatedAt);

    // Actor A replays the identical request: replayed, and P1-07 refuses again.
    const sameActorBefore = await kaiTableRowCounts();
    const sameActor = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed", boundAdmin),
      productionDecisionDependencies(intakeSensitivityProfileId, boundAdmin),
    );
    assert.equal(sameActor.ok, true, JSON.stringify(sameActor));
    assert.equal(sameActor.data.replayed, true);
    assert.equal(sameActor.data.current_decision.decision_id, committed[0].decision_id);
    assert.equal(sameActor.data.source_candidate_handoff.status, "not_created");
    assert.equal(sameActor.data.source_candidate_handoff.error_code, "tenant_boundary_violation");
    assert.deepEqual(changedTables(sameActorBefore, await kaiTableRowCounts()), []);

    // A stamp that is neither the queue's current one nor the head's is a conflict, never a write.
    const staleBefore = await kaiTableRowCounts();
    const stale = await submitSensitivityProfileDecision(
      decisionRequest(
        intakeSensitivityProfileId,
        { ...work, expectedUpdatedAt: "2026-09-24T10:00:00.000Z" },
        "reviewed",
        boundMixedReviewer,
      ),
      productionDecisionDependencies(intakeSensitivityProfileId, boundMixedReviewer),
    );
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "conflict_current_state_changed");
    assert.deepEqual(changedTables(staleBefore, await kaiTableRowCounts()), []);

    // An authorized GK human replays the identical request with the head's original stamp.
    const before = await kaiTableRowCounts();
    const recovered = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed", boundMixedReviewer),
      productionDecisionDependencies(intakeSensitivityProfileId, boundMixedReviewer),
    );
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(recovered.data.replayed, true);
    assert.equal(recovered.data.current_decision.decision_id, committed[0].decision_id);
    assert.equal(recovered.data.current_decision.decided_by_role, "client_admin");
    assert.deepEqual(
      { status: recovered.data.source_candidate_handoff.status, error_code: recovered.data.source_candidate_handoff.error_code },
      { status: "created", error_code: null },
    );
    assert.deepEqual(changedTables(before, await kaiTableRowCounts()), [
      "audit_events",
      "intake_source_candidates",
      "review_queue_items",
      "upload_lifecycle_audit",
    ]);
    assert.deepEqual(await decisionRows(intakeSensitivityProfileId), committed);
    assert.equal(await decisionAuditCount(intakeSensitivityProfileId), 1);
    const state = await candidateState(intakeSensitivityProfileId);
    assert.equal(state.candidates.length, 1);
    assert.equal(state.queueItems.length, 1);
    assert.equal(state.candidates[0].created_by, BOUND_MIXED_REVIEWER);
    assert.equal(state.candidates[0].candidate_status, "needs_gk_review");
    const candidateAudits = (await auditActions(intakeSensitivityProfileId))
      .filter((row) => row.action === "intake_source_candidate_persisted");
    assert.deepEqual(candidateAudits, [
      { action: "intake_source_candidate_persisted", actor_type: "human", actor_user_id: BOUND_MIXED_REVIEWER },
    ]);

    const replayBefore = await kaiTableRowCounts();
    const replay = await submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, "reviewed", boundMixedReviewer),
      productionDecisionDependencies(intakeSensitivityProfileId, boundMixedReviewer),
    );
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.source_candidate_handoff.status, "replayed");
    assert.deepEqual(changedTables(replayBefore, await kaiTableRowCounts()), []);
  });

  test("P1-07 first failure negatives: an unbound stored client_admin, an inactive or other-organization bound admin, and a binding without a GK organization id are refused at the decision, review work, and P1-07; a bound admin is refused by P1-07 even on an ineligible profile; nothing is written", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(24);
    const work = await workAs(boundMixedReviewer, intakeSensitivityProfileId);
    const ineligibleProfileId = await seedPredicateSatisfyingSensitivityProfile(25);
    await makeProfileIneligible(ineligibleProfileId);

    const denied = [
      ["stored client_admin without a binding", {
        ...boundAdmin,
        organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }],
      }],
      ["bound client_admin with an inactive membership", {
        ...boundAdmin,
        organizationMemberships: [boundAdminMembership({ membership_status: "inactive" })],
      }],
      ["bound client_admin of another organization", {
        ...boundAdmin,
        organizationMemberships: [boundAdminMembership({ organization_id: OTHER_ORG })],
      }],
      ["client_admin derived from a binding without a GK organization id", {
        ...boundAdmin,
        organizationMemberships: [boundAdminMembership({ gk_organization_id: null })],
      }],
    ];

    const before = await kaiTableRowCounts();
    for (const [label, actorContext] of denied) {
      const decided = await submitSensitivityProfileDecision(
        decisionRequest(intakeSensitivityProfileId, work, "reviewed", actorContext),
        productionDecisionDependencies(intakeSensitivityProfileId, actorContext),
      );
      assert.equal(decided.ok, false, `decision ${label}`);
      assert.equal(decided.error.code, "authorization_denied", `decision ${label}`);
      const ensured = await ensureReviewWorkAs(actorContext, intakeSensitivityProfileId);
      assert.equal(ensured.ok, false, `P1-06 ${label}`);
      assert.equal(ensured.error.code, "tenant_boundary_violation", `P1-06 ${label}`);
      const candidate = await createCandidateAs(actorContext, intakeSensitivityProfileId);
      assert.equal(candidate.ok, false, `P1-07 ${label}`);
      assert.equal(candidate.error.code, "tenant_boundary_violation", `P1-07 ${label}`);
    }

    const ineligible = await createCandidateAs(boundAdmin, ineligibleProfileId);
    assert.equal(ineligible.ok, false);
    assert.equal(ineligible.error.code, "tenant_boundary_violation", "authorization precedes VAL-KAI-P1-07-001");
    const ineligibleGk = await createCandidateAs(boundMixedReviewer, ineligibleProfileId);
    assert.equal(ineligibleGk.ok, false);
    assert.equal(ineligibleGk.error.code, "validation_blocker");

    // A bound admin of another organization naming that organization cannot reach this profile.
    const otherOrgAdmin = { ...boundAdmin, organizationMemberships: [boundAdminMembership({ organization_id: OTHER_ORG })] };
    const crossTenant = await createCandidateAs(otherOrgAdmin, intakeSensitivityProfileId, { organizationId: OTHER_ORG });
    assert.equal(crossTenant.ok, false);
    assert.equal(crossTenant.error.code, "tenant_boundary_violation");

    assert.deepEqual(changedTables(before, await kaiTableRowCounts()), []);
    assert.deepEqual(await decisionRows(intakeSensitivityProfileId), []);
    assert.deepEqual(await candidateState(intakeSensitivityProfileId), { candidates: [], queueItems: [] });
  });
}
