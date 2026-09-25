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
  const { createPostgresSourceCandidateRepository } = await import("../Backend/kai/dictionary/postgresSourceCandidateRepository.js");
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { createSourceCandidateStub } = await import("../Backend/kai/services/kaiSourceCandidateService.js");
  const { createProductionMetadataOnlyAuditForSourceCandidate } = await import(
    "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js"
  );
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
}
