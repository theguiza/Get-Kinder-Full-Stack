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
      }, "authorization_denied"],
      ["global gk_reviewer with no membership", mixedRoleActor("gk_reviewer", MIXED_REVIEWER, { organizationMemberships: [] }), "authorization_denied"],
      ["global gk_reviewer with membership only in another organization", mixedRoleActor("gk_reviewer", MIXED_REVIEWER, {
        organizationMemberships: otherOrgMembership,
      }), "authorization_denied"],
      ["global gk_reviewer with a revoked membership", mixedRoleActor("gk_reviewer", MIXED_REVIEWER, {
        organizationMemberships: [{ organization_id: ORG, membership_status: "revoked", role_name: "client_admin" }],
      }), "authorization_denied"],
      ["global gk_operator with an inactive membership", mixedRoleActor("gk_operator", MIXED_OPERATOR, {
        organizationMemberships: [{ organization_id: ORG, membership_status: "inactive", role_name: "client_admin" }],
      }), "authorization_denied"],
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
  // KAI P1-07 bound organization administrator handoff (owner decision
  // 2026-10-13). The first-failure reproduction (2026-10-12) pinned the refusal of
  // an owner-approved bound client_admin (4191684) at P1-07 VAL-AUT-004. That
  // refusal was the defect. P1-07 now admits an active binding-derived
  // client_admin of this exact organization only when the current decision-lineage
  // head is that same human's 'reviewed' decision, recorded as client_admin, and
  // its sensitivity_review item is resolved. The repository checks this from
  // committed rows under the profile lock. GK authority and client_admin's absence
  // from SOURCE_CANDIDATE_ALLOWED_ROLES are unchanged.
  // ---------------------------------------------------------------------------

  const BOUND_ADMIN = "90000000-0000-4000-8000-000000000005";
  const BOUND_MIXED_REVIEWER = "90000000-0000-4000-8000-000000000006";
  const OTHER_BOUND_ADMIN = "90000000-0000-4000-8000-000000000007";
  const GK_ORGANIZATION_ID = 4242;
  const T1 = "2026-09-25T11:00:00.000Z";
  const T2 = "2026-09-25T12:00:00.000Z";
  const T3 = "2026-09-25T13:00:00.000Z";

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

  // Actor A: mapped active human, active bound client_admin, no global GK role, no superuser.
  const boundAdmin = {
    actorType: "human",
    actorUserId: BOUND_ADMIN,
    kaiUserStatus: "active",
    kaiRoles: [],
    organizationMemberships: [boundAdminMembership()],
    platformSuperuser: false,
  };
  // Actor B: mapped active human, global gk_reviewer, the same active bound client_admin, no superuser.
  const boundMixedReviewer = {
    ...boundAdmin,
    actorUserId: BOUND_MIXED_REVIEWER,
    kaiRoles: ["gk_reviewer"],
  };
  const otherBoundAdmin = { ...boundAdmin, actorUserId: OTHER_BOUND_ADMIN };

  // The pre-fix P1-07 refusal of a bound client_admin, used only to construct the
  // historical "reviewed, resolved, no candidate" state.
  async function refusedHandoff() {
    return { ok: false, data: null, error: { code: "tenant_boundary_violation" } };
  }

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

  function decideAs(actorContext, intakeSensitivityProfileId, work, decision, { now, refuseHandoff = false, ...overrides } = {}) {
    return submitSensitivityProfileDecision(
      decisionRequest(intakeSensitivityProfileId, work, decision, actorContext),
      {
        ...productionDecisionDependencies(intakeSensitivityProfileId, actorContext),
        ...(now ? { now: () => now } : {}),
        ...(refuseHandoff ? { createSourceCandidateStub: refusedHandoff } : {}),
        ...overrides,
      },
    );
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

  async function currentHead(intakeSensitivityProfileId) {
    const rows = await withClient((client) => client.query(
      `SELECT d.decision_id::text AS decision_id, d.decision_outcome, d.decided_by::text AS decided_by,
              d.decided_by_role, d.target_updated_at
         FROM kai.intake_sensitivity_review_decisions d
        WHERE d.organization_id = $1::uuid AND d.intake_sensitivity_profile_id = $2::uuid
          AND NOT EXISTS (
                SELECT 1 FROM kai.intake_sensitivity_review_decisions s
                 WHERE s.supersedes_decision_id = d.decision_id
              )`,
      [ORG, intakeSensitivityProfileId],
    ));
    assert.equal(rows.rows.length, 1, "exactly one current decision head");
    return { ...rows.rows[0], target_updated_at: rows.rows[0].target_updated_at.toISOString() };
  }

  async function auditCounts(intakeSensitivityProfileId, index, action) {
    const events = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.audit_events WHERE action = $1 AND metadata->>'object_id' = $2`,
      [action, intakeSensitivityProfileId],
    ));
    const lifecycle = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = $1 AND intake_file_id = $2::uuid`,
      [action, fileId(index)],
    ));
    return { audit_events: events.rows[0].count, upload_lifecycle_audit: lifecycle.rows[0].count };
  }

  const decisionAudits = (id, index) => auditCounts(id, index, "sensitivity_review_decision_recorded");
  const candidateAudits = (id, index) => auditCounts(id, index, "intake_source_candidate_persisted");

  // Every kai table is compared by changedTables; this also names the downstream
  // tables explicitly. evidence_items and claims are not part of this runner's
  // schema, so they can only be asserted unchanged where they exist.
  function assertNothingDownstream(before, after) {
    for (const table of ["intake_promotion_decisions", "sources", "source_versions"]) {
      assert.ok(table in after, `kai.${table} exists in this schema`);
      assert.equal(after[table], before[table], `kai.${table} must not have been written`);
    }
    for (const table of ["evidence_items", "claims", "claim_evidence_links"]) {
      if (table in after) assert.equal(after[table], before[table], `kai.${table} must not have been written`);
    }
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

  // The queue item's current updated_at, as the cockpit detail returns it (the
  // stamp a UI submission sends). A BEFORE UPDATE trigger sets it from the
  // database clock, so it is read back, never assumed.
  async function currentQueueStamp(intakeSensitivityProfileId) {
    return (await readDetailAs(boundMixedReviewer, intakeSensitivityProfileId)).sensitivity_review_queue_item.updated_at;
  }

  // The historical condition: a bound admin's committed 'reviewed' decision, queue
  // resolved, no candidate (handoff refused as before the fix).
  async function historicalReviewedWithoutCandidate(index, actorContext = boundAdmin) {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(index);
    const work = await workAs(actorContext, intakeSensitivityProfileId);
    const decided = await decideAs(actorContext, intakeSensitivityProfileId, work, "reviewed", { now: T1, refuseHandoff: true });
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.source_candidate_handoff.status, "not_created");
    assert.deepEqual(await candidateState(intakeSensitivityProfileId), { candidates: [], queueItems: [] });
    return { intakeSensitivityProfileId, work, decided, resolvedStamp: await currentQueueStamp(intakeSensitivityProfileId) };
  }

  test("bound admin (positive): Actor A's own committed 'reviewed' decision resolves the queue and the handoff creates exactly one needs_gk_review candidate and one open review item, with both audits; nothing downstream; a repeat replays with zero writes", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(21);
    const work = await workAs(boundAdmin, intakeSensitivityProfileId);
    assert.equal(await profilePredicate(intakeSensitivityProfileId), true, "the profile satisfies VAL-KAI-P1-07-001");

    const counted = countingSourceCandidateRepository();
    const before = await kaiTableRowCounts();
    const decided = await decideAs(boundAdmin, intakeSensitivityProfileId, work, "reviewed", {
      sourceCandidateRepository: counted.repository,
    });
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.replayed, false);
    assert.equal(decided.data.current_decision.decision_outcome, "reviewed");
    assert.equal(decided.data.current_decision.decided_by, BOUND_ADMIN);
    assert.equal(decided.data.current_decision.decided_by_role, "client_admin");
    assert.equal(decided.data.sensitivity_review_queue_item.queue_status, "resolved");
    const handoff = decided.data.source_candidate_handoff;
    assert.deepEqual(
      { status: handoff.status, candidate_status: handoff.candidate_status, queue_status: handoff.queue_status, error_code: handoff.error_code },
      { status: "created", candidate_status: "needs_gk_review", queue_status: "open", error_code: null },
    );
    assert.equal(counted.calls.createSourceCandidateStub, 1);

    const after = await kaiTableRowCounts();
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
    assertNothingDownstream(before, after);

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

    const state = await candidateState(intakeSensitivityProfileId);
    assert.equal(state.candidates.length, 1);
    assert.equal(state.queueItems.length, 1);
    assert.equal(state.candidates[0].intake_source_candidate_id, handoff.intake_source_candidate_id);
    assert.equal(state.candidates[0].candidate_status, "needs_gk_review");
    assert.equal(state.candidates[0].created_by, BOUND_ADMIN);
    assert.equal(state.candidates[0].created_by_type, "human");
    assert.equal(state.queueItems[0].review_queue_item_id, handoff.review_queue_item_id);
    assert.equal(state.queueItems[0].queue_status, "open");
    assert.equal(state.queueItems[0].created_by_type, "human");

    assert.deepEqual(await decisionAudits(intakeSensitivityProfileId, 21), { audit_events: 1, upload_lifecycle_audit: 1 });
    assert.deepEqual(await candidateAudits(intakeSensitivityProfileId, 21), { audit_events: 1, upload_lifecycle_audit: 1 });
    const actions = (await auditActions(intakeSensitivityProfileId)).filter((row) => row.actor_user_id === BOUND_ADMIN);
    assert.deepEqual(actions.map((row) => row.action), [
      "intake_source_candidate_persisted",
      "sensitivity_review_decision_recorded",
      "sensitivity_review_queue_item_created",
    ]);
    assert.ok(actions.every((row) => row.actor_type === "human"));

    // The candidate is GK review work: the cockpit candidate detail is readable by a GK reviewer.
    const candidateDetail = await getReviewCockpitSourceCandidateDetail(
      { organizationId: ORG, intakeSourceCandidateId: handoff.intake_source_candidate_id, actorContext: reviewerActor },
      {
        env: ENV,
        getReviewCockpitSourceCandidateRecord: (organizationId, candidateId) =>
          getReviewCockpitSourceCandidateRecord(organizationId, candidateId, pool),
      },
    );
    assert.equal(candidateDetail.ok, true, JSON.stringify(candidateDetail));

    // Repeated invocation, through the decision seam and directly, writes nothing.
    const replayBefore = await kaiTableRowCounts();
    const replay = await decideAs(boundAdmin, intakeSensitivityProfileId, work, "reviewed");
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.current_decision.decision_id, decided.data.current_decision.decision_id);
    assert.equal(replay.data.source_candidate_handoff.status, "replayed");
    assert.equal(replay.data.source_candidate_handoff.intake_source_candidate_id, handoff.intake_source_candidate_id);
    const direct = await createCandidateAs(boundAdmin, intakeSensitivityProfileId);
    assert.equal(direct.ok, true, JSON.stringify(direct));
    assert.equal(direct.data.replayed, true);
    assert.deepEqual(changedTables(replayBefore, await kaiTableRowCounts()), []);
  });

  test("existing GK authority unchanged: Actor B (global gk_reviewer + bound client_admin) is attributed gk_reviewer and creates the candidate; a GK reviewer's direct P1-07 call needs no sensitivity decision", async () => {
    const intakeSensitivityProfileId = await seedPredicateSatisfyingSensitivityProfile(22);
    const work = await workAs(boundMixedReviewer, intakeSensitivityProfileId);

    const before = await kaiTableRowCounts();
    const decided = await decideAs(boundMixedReviewer, intakeSensitivityProfileId, work, "reviewed");
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

    // No sensitivity review work and no decision exist for this profile; the GK
    // reviewer's direct call is not subject to the bound-admin prerequisite.
    const undecidedProfileId = await seedPredicateSatisfyingSensitivityProfile(23);
    assert.deepEqual(await decisionRows(undecidedProfileId), []);
    const directBefore = await kaiTableRowCounts();
    const direct = await createCandidateAs(reviewerActor, undecidedProfileId);
    assert.equal(direct.ok, true, JSON.stringify(direct));
    assert.equal(direct.data.replayed, false);
    assert.deepEqual(changedTables(directBefore, await kaiTableRowCounts()), [
      "audit_events",
      "intake_source_candidates",
      "review_queue_items",
      "upload_lifecycle_audit",
    ]);
  });

  test("bound admin (negatives, decision prerequisite): no decision, needs_more_information, a superseded 'reviewed', another human's 'reviewed' (bound admin or GK), the same human's earlier GK-role decision, and an unresolved queue are refused at P1-07 with zero candidate, queue, or audit writes", async () => {
    const cases = [];

    // No persisted decision (review work only).
    {
      const id = await seedPredicateSatisfyingSensitivityProfile(24);
      await workAs(boundAdmin, id);
      cases.push(["no persisted decision", id, 24]);
    }
    // needs_more_information as the current head.
    {
      const id = await seedPredicateSatisfyingSensitivityProfile(25);
      const work = await workAs(boundAdmin, id);
      const decided = await decideAs(boundAdmin, id, work, "needs_more_information", { now: T1 });
      assert.equal(decided.ok, true, JSON.stringify(decided));
      assert.equal(decided.data.source_candidate_handoff.status, "not_applicable");
      cases.push(["needs_more_information", id, 25]);
    }
    // The bound admin's own 'reviewed' decision, superseded by needs_more_information.
    {
      const { intakeSensitivityProfileId: id, work, resolvedStamp } = await historicalReviewedWithoutCandidate(26);
      const superseding = await decideAs(boundAdmin, id, { ...work, expectedUpdatedAt: resolvedStamp }, "needs_more_information", { now: T2 });
      assert.equal(superseding.ok, true, JSON.stringify(superseding));
      assert.equal((await currentHead(id)).decision_outcome, "needs_more_information");
      cases.push(["superseded own 'reviewed'", id, 26]);
    }
    // The bound admin's own 'reviewed' decision, superseded by another human's 'reviewed'.
    {
      const { intakeSensitivityProfileId: id, work, resolvedStamp } = await historicalReviewedWithoutCandidate(27);
      const superseding = await decideAs(otherBoundAdmin, id, { ...work, expectedUpdatedAt: resolvedStamp }, "reviewed", { now: T2, refuseHandoff: true });
      assert.equal(superseding.ok, true, JSON.stringify(superseding));
      assert.equal((await currentHead(id)).decided_by, OTHER_BOUND_ADMIN);
      cases.push(["own 'reviewed' superseded by another bound admin's 'reviewed'", id, 27]);
    }
    // Another bound admin's 'reviewed' decision.
    {
      const { intakeSensitivityProfileId: id } = await historicalReviewedWithoutCandidate(28, otherBoundAdmin);
      cases.push(["another bound admin's 'reviewed'", id, 28]);
    }
    // A GK reviewer's 'reviewed' decision whose handoff was refused.
    {
      const id = await seedPredicateSatisfyingSensitivityProfile(29);
      const work = await workAs(boundMixedReviewer, id);
      const decided = await decideAs(boundMixedReviewer, id, work, "reviewed", { now: T1, refuseHandoff: true });
      assert.equal(decided.data.current_decision.decided_by_role, "gk_reviewer");
      cases.push(["a GK reviewer's 'reviewed'", id, 29]);
    }
    // The same human, who decided under a global GK role, later acting as a bound admin only.
    {
      const id = await seedPredicateSatisfyingSensitivityProfile(30);
      const work = await workAs(boundMixedReviewer, id);
      await decideAs(boundMixedReviewer, id, work, "reviewed", { now: T1, refuseHandoff: true });
      cases.push(["own 'reviewed' recorded as gk_reviewer", id, 30, { ...boundMixedReviewer, kaiRoles: [] }]);
    }
    // The bound admin's own current 'reviewed' head, but its queue item is not resolved.
    {
      const { intakeSensitivityProfileId: id, decided } = await historicalReviewedWithoutCandidate(31);
      // Throwaway database only: no supported path reopens a resolved item while
      // the head stays 'reviewed', so construct that state directly.
      await withClient((client) => client.query(
        `UPDATE kai.review_queue_items SET queue_status = 'in_progress', review_status = 'needs_gk_review'
          WHERE review_queue_item_id = $1::uuid`,
        [decided.data.sensitivity_review_queue_item.review_queue_item_id],
      ));
      cases.push(["unresolved sensitivity_review queue", id, 31]);
    }
    // The bound admin's own 'needs_more_information' head with its queue item
    // resolved: the outcome is checked on its own, not inferred from the queue.
    {
      const id = await seedPredicateSatisfyingSensitivityProfile(40);
      const work = await workAs(boundAdmin, id);
      const decided = await decideAs(boundAdmin, id, work, "needs_more_information", { now: T1 });
      assert.equal(decided.ok, true, JSON.stringify(decided));
      // Throwaway database only, as above.
      await withClient((client) => client.query(
        `UPDATE kai.review_queue_items SET queue_status = 'resolved', review_status = 'resolved'
          WHERE review_queue_item_id = $1::uuid`,
        [work.reviewQueueItemId],
      ));
      cases.push(["own needs_more_information head with a resolved queue", id, 40]);
    }

    for (const [label, id, index, actorContext = boundAdmin] of cases) {
      const before = await kaiTableRowCounts();
      const audits = await candidateAudits(id, index);
      const direct = await createCandidateAs(actorContext, id);
      assert.equal(direct.ok, false, label);
      assert.equal(direct.error.code, "authorization_denied", label);
      assert.deepEqual(changedTables(before, await kaiTableRowCounts()), [], label);
      assert.deepEqual(await candidateState(id), { candidates: [], queueItems: [] }, label);
      assert.deepEqual(await candidateAudits(id, index), audits, label);
      assert.deepEqual(audits, { audit_events: 0, upload_lifecycle_audit: 0 }, label);
    }

    // The decider of case 28 does satisfy the prerequisite: attribution is what decides.
    const [, otherAdminProfileId] = cases.find(([label]) => label === "another bound admin's 'reviewed'");
    const byDecider = await createCandidateAs(otherBoundAdmin, otherAdminProfileId);
    assert.equal(byDecider.ok, true, JSON.stringify(byDecider));
    assert.equal(byDecider.data.replayed, false);
  });

  test("bound admin (negative, paired queue state): the human's own current 'reviewed' head whose sensitivity_review item is resolved/needs_gk_review is refused directly and through the cockpit replay with zero writes; restoring review_status alone admits the same request", async () => {
    const { intakeSensitivityProfileId: id, work, decided } = await historicalReviewedWithoutCandidate(41);
    const reviewQueueItemId = decided.data.sensitivity_review_queue_item.review_queue_item_id;
    // Throwaway database only: no CHECK constraint pairs queue_status with
    // review_status for sensitivity_review, so change review_status alone.
    const setReviewStatus = (reviewStatus) => withClient((client) => client.query(
      `UPDATE kai.review_queue_items SET review_status = $2 WHERE review_queue_item_id = $1::uuid`,
      [reviewQueueItemId, reviewStatus],
    ));
    await setReviewStatus("needs_gk_review");

    // Every other prerequisite holds: one current head, the bound admin's own
    // human 'reviewed' as client_admin, the decided item resolved, eligible, no candidate.
    const items = await sensitivityReviewItems(id);
    assert.equal(items.length, 1);
    assert.equal(items[0].review_queue_item_id, reviewQueueItemId);
    assert.equal(items[0].queue_status, "resolved");
    assert.equal(items[0].review_status, "needs_gk_review");
    const head = await currentHead(id);
    assert.equal(head.decision_id, decided.data.current_decision.decision_id);
    assert.equal(head.decision_outcome, "reviewed");
    assert.equal(head.decided_by, BOUND_ADMIN);
    assert.equal(head.decided_by_role, "client_admin");
    assert.equal(await profilePredicate(id), true);
    assert.deepEqual(await candidateState(id), { candidates: [], queueItems: [] });
    const decisions = await decisionRows(id);
    assert.equal(decisions.length, 1);
    const decisionAuditsBefore = await decisionAudits(id, 41);

    const before = await kaiTableRowCounts();
    const direct = await createCandidateAs(boundAdmin, id);
    assert.equal(direct.ok, false, JSON.stringify(direct));
    assert.equal(direct.error.code, "authorization_denied");
    assert.deepEqual(changedTables(before, await kaiTableRowCounts()), []);

    // The cockpit replay never reaches the handoff: the decision workflow only
    // recognizes a terminal replay against a resolved/resolved item.
    const replayBefore = await kaiTableRowCounts();
    const replay = await decideAs(boundAdmin, id, { ...work, expectedUpdatedAt: head.target_updated_at }, "reviewed", { now: T3 });
    assert.equal(replay.ok, false, JSON.stringify(replay));
    assert.equal(replay.error.code, "conflict_current_state_changed");
    assert.deepEqual(changedTables(replayBefore, await kaiTableRowCounts()), []);

    assert.deepEqual(await candidateState(id), { candidates: [], queueItems: [] });
    assert.deepEqual(await candidateAudits(id, 41), { audit_events: 0, upload_lifecycle_audit: 0 });
    assert.deepEqual(await decisionRows(id), decisions);
    assert.deepEqual(await currentHead(id), head);
    assert.deepEqual(await decisionAudits(id, 41), decisionAuditsBefore);

    // review_status is the only difference from an admitted state.
    await setReviewStatus("resolved");
    const admitted = await createCandidateAs(boundAdmin, id);
    assert.equal(admitted.ok, true, JSON.stringify(admitted));
    assert.equal(admitted.data.replayed, false);
    const state = await candidateState(id);
    assert.equal(state.candidates.length, 1);
    assert.equal(state.candidates[0].candidate_status, "needs_gk_review");
    assert.equal(state.queueItems.length, 1);
    assert.equal(state.queueItems[0].queue_status, "open");
  });

  test("bound admin (negatives, actor): with the human's own current 'reviewed' head in place, an unbound stored client_admin, inactive or other-organization binding, missing or invalid GK organization id, client reviewer/contributor, inactive account, and non-human actors are all refused with zero writes", async () => {
    const { intakeSensitivityProfileId: id, work } = await historicalReviewedWithoutCandidate(32);
    const denied = [
      ["stored client_admin without a binding", {
        ...boundAdmin,
        organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }],
      }, "authorization_denied"],
      ["inactive binding-derived membership", {
        ...boundAdmin, organizationMemberships: [boundAdminMembership({ membership_status: "inactive" })],
      }, "authorization_denied"],
      ["binding for another organization", {
        ...boundAdmin, organizationMemberships: [boundAdminMembership({ organization_id: OTHER_ORG })],
      }, "authorization_denied"],
      ...[null, undefined, 0, "4242", 1.5].map((gkOrganizationId) => [
        `GK organization id ${String(gkOrganizationId)}`,
        { ...boundAdmin, organizationMemberships: [boundAdminMembership({ gk_organization_id: gkOrganizationId })] },
        "authorization_denied",
      ]),
      ...["client_reviewer", "client_contributor"].map((roleName) => [
        `binding-derived ${roleName}`,
        { ...boundAdmin, organizationMemberships: [boundAdminMembership({ role_name: roleName })] },
        "authorization_denied",
      ]),
      ["inactive kai.users account", { ...boundAdmin, kaiUserStatus: "inactive" }, "authorization_denied"],
      ...["ai", "assistant", "system", "import"].map((actorType) => [
        `${actorType} actor`, { ...boundAdmin, actorType }, "authorization_denied",
      ]),
    ];

    const before = await kaiTableRowCounts();
    for (const [label, actorContext, expectedCode] of denied) {
      const direct = await createCandidateAs(actorContext, id);
      assert.equal(direct.ok, false, label);
      assert.equal(direct.error.code, expectedCode, label);
    }
    // Through the decision seam, the inactive account's identical request replays the
    // committed decision (no write) and the handoff is still refused.
    const viaSeam = await decideAs({ ...boundAdmin, kaiUserStatus: "inactive" }, id, work, "reviewed");
    assert.equal(viaSeam.ok, true, JSON.stringify(viaSeam));
    assert.equal(viaSeam.data.replayed, true);
    assert.deepEqual(
      { status: viaSeam.data.source_candidate_handoff.status, error_code: viaSeam.data.source_candidate_handoff.error_code },
      { status: "not_created", error_code: "authorization_denied" },
    );
    assert.equal((await createCandidateAs(boundAdmin, id, { env: { KAI_SPRINT2_ENABLED: "false" } })).error.code, "feature_disabled");

    assert.deepEqual(changedTables(before, await kaiTableRowCounts()), []);
    assert.deepEqual(await candidateState(id), { candidates: [], queueItems: [] });
    assert.deepEqual(await candidateAudits(id, 32), { audit_events: 0, upload_lifecycle_audit: 0 });
  });

  test("bound admin (negatives, tenant, eligibility, audit): cross-tenant requests are refused, an ineligible profile is refused by VAL-KAI-P1-07-001 after the prerequisite, and a rejected required audit rolls the candidate back; all with zero candidate writes", async () => {
    // Cross-tenant: bound to ORG but naming OTHER_ORG; bound to OTHER_ORG and naming it for ORG's profile.
    const { intakeSensitivityProfileId: id, work } = await historicalReviewedWithoutCandidate(33);
    const otherOrgAdmin = { ...boundAdmin, organizationMemberships: [boundAdminMembership({ organization_id: OTHER_ORG })] };
    const crossBefore = await kaiTableRowCounts();
    const namingOther = await createCandidateAs(boundAdmin, id, { organizationId: OTHER_ORG });
    assert.deepEqual([namingOther.error.code, namingOther.blockers?.[0]?.blocking_reason], ["authorization_denied", "missing_active_organization_membership"]);
    const otherTenant = await createCandidateAs(otherOrgAdmin, id, { organizationId: OTHER_ORG });
    assert.equal(otherTenant.ok, false);
    assert.equal(otherTenant.error.code, "not_found");
    assert.deepEqual(changedTables(crossBefore, await kaiTableRowCounts()), []);

    // Ineligible P1-05 profile with the bound admin's own resolved 'reviewed' head.
    const ineligibleId = await seedPredicateSatisfyingSensitivityProfile(34);
    const ineligibleWork = await workAs(boundAdmin, ineligibleId);
    await makeProfileIneligible(ineligibleId);
    const ineligibleBefore = await kaiTableRowCounts();
    const ineligible = await decideAs(boundAdmin, ineligibleId, ineligibleWork, "reviewed", { now: T1 });
    assert.equal(ineligible.ok, true, JSON.stringify(ineligible));
    assert.equal(ineligible.data.current_decision.decided_by_role, "client_admin");
    assert.deepEqual(
      { status: ineligible.data.source_candidate_handoff.status, error_code: ineligible.data.source_candidate_handoff.error_code },
      { status: "not_created", error_code: "validation_blocker" },
    );
    assert.deepEqual(changedTables(ineligibleBefore, await kaiTableRowCounts()), [
      "audit_events",
      "intake_sensitivity_review_decisions",
      "upload_lifecycle_audit",
    ]);
    assert.deepEqual(await candidateState(ineligibleId), { candidates: [], queueItems: [] });
    assert.deepEqual(await candidateAudits(ineligibleId, 34), { audit_events: 0, upload_lifecycle_audit: 0 });
    // Without a decision, authorization still precedes the predicate.
    const undecidedIneligibleId = await seedPredicateSatisfyingSensitivityProfile(35);
    await makeProfileIneligible(undecidedIneligibleId);
    assert.equal((await createCandidateAs(boundAdmin, undecidedIneligibleId)).error.code, "authorization_denied");

    // Required audit rejected: the candidate and its review item roll back.
    const auditBefore = await kaiTableRowCounts();
    const rejected = await decideAs(boundAdmin, id, work, "reviewed", {
      sourceCandidateMetadataOnlyAudit: { prepareMetadataOnlyAudit() { return { ok: false }; } },
    });
    assert.equal(rejected.ok, true, JSON.stringify(rejected));
    assert.equal(rejected.data.replayed, true);
    assert.deepEqual(
      { status: rejected.data.source_candidate_handoff.status, error_code: rejected.data.source_candidate_handoff.error_code },
      { status: "not_created", error_code: "validation_blocker" },
    );
    assert.deepEqual(changedTables(auditBefore, await kaiTableRowCounts()), []);
    assert.deepEqual(await candidateState(id), { candidates: [], queueItems: [] });
    assert.deepEqual(await candidateAudits(id, 33), { audit_events: 0, upload_lifecycle_audit: 0 });
  });

  test("bound admin (concurrency): identical concurrent creations converge on one candidate, one review item, and one audit; another human's superseding decision holding the profile lock makes the creation wait and then refuse it with zero writes", async () => {
    const { intakeSensitivityProfileId: id } = await historicalReviewedWithoutCandidate(36);
    const before = await kaiTableRowCounts();
    const results = await Promise.all([1, 2, 3].map(() => createCandidateAs(boundAdmin, id)));
    for (const result of results) assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(results.map((result) => result.data.replayed).sort(), [false, true, true]);
    assert.equal(new Set(results.map((result) => result.data.sourceCandidate.intake_source_candidate_id)).size, 1);
    const after = await kaiTableRowCounts();
    assert.equal(after.intake_source_candidates - before.intake_source_candidates, 1);
    assert.equal(after.review_queue_items - before.review_queue_items, 1);
    assert.deepEqual(await candidateAudits(id, 36), { audit_events: 1, upload_lifecycle_audit: 1 });

    // Supersession race: another bound admin's superseding 'reviewed' decision has
    // written its row and holds the profile lock, uncommitted. The queue stays
    // resolved on the same item, so only the profile lock stops the creation from
    // authorizing against the head it is about to replace.
    const { intakeSensitivityProfileId: racedId, work, resolvedStamp } = await historicalReviewedWithoutCandidate(37);
    let signalReached;
    const reached = new Promise((resolve) => { signalReached = resolve; });
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    const gatedDecisionRepository = createPostgresSensitivityAllowedUseReviewRepository({
      runInTransaction: (callback) => withTransaction(async (tx) => {
        const result = await callback(tx);
        signalReached();
        await released;
        return result;
      }, pool),
    });
    const raceBefore = await kaiTableRowCounts();
    let superseding;
    let creation;
    let creationSettledEarly = false;
    try {
      superseding = decideAs(otherBoundAdmin, racedId, { ...work, expectedUpdatedAt: resolvedStamp }, "reviewed", {
        now: T2,
        refuseHandoff: true,
        sensitivityAllowedUseReviewRepository: gatedDecisionRepository,
      });
      await reached;
      creation = createCandidateAs(boundAdmin, racedId);
      creation.then(() => { creationSettledEarly = true; }, () => { creationSettledEarly = true; });
      await new Promise((resolve) => { setTimeout(resolve, 300); });
    } finally {
      release();
    }
    assert.equal(creationSettledEarly, false, "the creation waited on the profile lock");
    const [decided, created] = await Promise.all([superseding, creation]);
    assert.equal(decided.ok, true, JSON.stringify(decided));
    assert.equal(decided.data.current_decision.decided_by, OTHER_BOUND_ADMIN);
    assert.equal((await sensitivityReviewItems(racedId))[0].queue_status, "resolved");
    assert.equal(created.ok, false, JSON.stringify(created));
    assert.equal(created.error.code, "authorization_denied");
    assert.deepEqual(changedTables(raceBefore, await kaiTableRowCounts()), [
      "audit_events",
      "intake_sensitivity_review_decisions",
      "upload_lifecycle_audit",
    ]);
    assert.deepEqual(await candidateState(racedId), { candidates: [], queueItems: [] });
    assert.deepEqual(await candidateAudits(racedId, 37), { audit_events: 0, upload_lifecycle_audit: 0 });
  });

  // Historical production shape: two decisions, latest 'reviewed' by client_admin,
  // queue resolved, zero candidates. The second decision is what an ordinary UI
  // resubmission produces: it sends the queue's current updated_at, which the
  // compare-and-set accepts, so it records a new superseding decision, not a replay.
  async function historicalTwoDecisionState(index) {
    const { intakeSensitivityProfileId, work, decided: first, resolvedStamp } = await historicalReviewedWithoutCandidate(index);
    const uiResubmission = await decideAs(
      boundAdmin,
      intakeSensitivityProfileId,
      { ...work, expectedUpdatedAt: resolvedStamp },
      "reviewed",
      { now: T2, refuseHandoff: true },
    );
    assert.equal(uiResubmission.ok, true, JSON.stringify(uiResubmission));
    assert.equal(uiResubmission.data.replayed, false, "a UI resubmission is a new decision, not a replay");
    assert.notEqual(uiResubmission.data.current_decision.decision_id, first.data.current_decision.decision_id);

    const decisions = await decisionRows(intakeSensitivityProfileId);
    assert.equal(decisions.length, 2);
    const head = await currentHead(intakeSensitivityProfileId);
    assert.equal(head.decision_id, uiResubmission.data.current_decision.decision_id);
    assert.equal(head.decision_outcome, "reviewed");
    assert.equal(head.decided_by_role, "client_admin");
    assert.equal(head.target_updated_at, resolvedStamp);
    assert.equal((await sensitivityReviewItems(intakeSensitivityProfileId))[0].queue_status, "resolved");
    assert.deepEqual(await candidateState(intakeSensitivityProfileId), { candidates: [], queueItems: [] });
    assert.deepEqual(await decisionAudits(intakeSensitivityProfileId, index), { audit_events: 2, upload_lifecycle_audit: 2 });

    // The read API exposes the head but not its target_updated_at.
    const afterDetail = await readDetailAs(boundMixedReviewer, intakeSensitivityProfileId);
    assert.equal(afterDetail.current_decision.decision_id, head.decision_id);
    assert.equal(Object.hasOwn(afterDetail.current_decision, "target_updated_at"), false);
    assert.notEqual(afterDetail.sensitivity_review_queue_item.updated_at, head.target_updated_at);
    return { intakeSensitivityProfileId, work, decisions, head };
  }

  async function assertDecisionPreservingRecovery(index, recoverer) {
    const { intakeSensitivityProfileId: id, work, decisions, head } = await historicalTwoDecisionState(index);
    const decisionAuditsBefore = await decisionAudits(id, index);

    // A stamp other than the head's original target_updated_at never writes:
    // the earlier decision's stamp, and an arbitrary one.
    for (const expectedUpdatedAt of [work.expectedUpdatedAt, "2026-09-24T10:00:00.000Z"]) {
      const mismatchBefore = await kaiTableRowCounts();
      const mismatched = await decideAs(recoverer, id, { ...work, expectedUpdatedAt }, "reviewed", { now: T3 });
      assert.equal(mismatched.ok, false, expectedUpdatedAt);
      assert.equal(mismatched.error.code, "conflict_current_state_changed", expectedUpdatedAt);
      assert.deepEqual(changedTables(mismatchBefore, await kaiTableRowCounts()), [], expectedUpdatedAt);
    }

    // The identical replay with the head's original stamp.
    const before = await kaiTableRowCounts();
    const recovered = await decideAs(recoverer, id, { ...work, expectedUpdatedAt: head.target_updated_at }, "reviewed", { now: T3 });
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(recovered.data.replayed, true);
    assert.equal(recovered.data.current_decision.decision_id, head.decision_id);
    assert.equal(recovered.data.current_decision.decided_by, BOUND_ADMIN);
    assert.equal(recovered.data.current_decision.decided_by_role, "client_admin");
    assert.deepEqual(
      { status: recovered.data.source_candidate_handoff.status, error_code: recovered.data.source_candidate_handoff.error_code },
      { status: "created", error_code: null },
    );
    const after = await kaiTableRowCounts();
    assert.deepEqual(changedTables(before, after), [
      "audit_events",
      "intake_source_candidates",
      "review_queue_items",
      "upload_lifecycle_audit",
    ]);
    assertNothingDownstream(before, after);
    assert.deepEqual(await decisionRows(id), decisions);
    assert.deepEqual(await currentHead(id), head);
    assert.deepEqual(await decisionAudits(id, index), decisionAuditsBefore);
    const state = await candidateState(id);
    assert.equal(state.candidates.length, 1);
    assert.equal(state.queueItems.length, 1);
    assert.equal(state.candidates[0].candidate_status, "needs_gk_review");
    assert.equal(state.candidates[0].created_by, recoverer.actorUserId);
    assert.equal(state.queueItems[0].queue_status, "open");
    assert.deepEqual(await candidateAudits(id, index), { audit_events: 1, upload_lifecycle_audit: 1 });

    // Repeating the recovery writes nothing.
    const repeatBefore = await kaiTableRowCounts();
    const repeat = await decideAs(recoverer, id, { ...work, expectedUpdatedAt: head.target_updated_at }, "reviewed", { now: T3 });
    assert.equal(repeat.ok, true, JSON.stringify(repeat));
    assert.equal(repeat.data.replayed, true);
    assert.equal(repeat.data.source_candidate_handoff.status, "replayed");
    assert.deepEqual(changedTables(repeatBefore, await kaiTableRowCounts()), []);
  }

  test("decision-preserving recovery (GK human): for the historical two-decision state, an authorized GK human's identical replay with the head's original stamp keeps the decision ledger and its audits unchanged and creates exactly one candidate; a repeat writes nothing; mismatched stamps write nothing", async () => {
    await assertDecisionPreservingRecovery(38, boundMixedReviewer);
  });

  test("decision-preserving recovery (original bound admin): with the fix, the deciding bound admin's identical replay with the head's original stamp recovers the same way", async () => {
    await assertDecisionPreservingRecovery(39, boundAdmin);
  });
}
