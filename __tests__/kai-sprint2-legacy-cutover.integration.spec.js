import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.KAI_LEGACY_CUTOVER_DATABASE_URL) {
  test("legacy-cutover integration requires the runner-owned database", { skip: true }, () => {});
} else {
  await runLegacyCutoverIntegrationSuite();
}

async function runLegacyCutoverIntegrationSuite() {
  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const { createPostgresParserRunRepository } = await import("../Backend/kai/parsing/postgresParserRunRepository.js");
  const { createDraftDataDictionary } = await import("../Backend/kai/services/kaiDataDictionaryService.js");
  const { createPostgresDataDictionaryRepository } = await import("../Backend/kai/dictionary/postgresDataDictionaryRepository.js");
  const { persistIntakeSensitivityProfile } = await import("../Backend/kai/services/kaiIntakeSensitivityProfileService.js");
  const { createPostgresIntakeSensitivityProfileRepository } = await import("../Backend/kai/dictionary/postgresIntakeSensitivityProfileRepository.js");
  const { createSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { createPostgresReviewQueueRepository } = await import("../Backend/kai/dictionary/postgresReviewQueueRepository.js");
  const { createSourceCandidateStub } = await import("../Backend/kai/services/kaiSourceCandidateService.js");
  const { createPostgresSourceCandidateRepository } = await import("../Backend/kai/dictionary/postgresSourceCandidateRepository.js");
  const { getReviewCockpitSourceCandidateDetail } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const { getReviewCockpitSourceCandidateRecord, listReviewCockpitQueueItems } =
    await import("../Backend/kai/db/kaiReviewCockpitReadModels.js");
  const { getScopedSourceCandidateByIdentityForDisplay } = await import("../Backend/kai/db/kaiIntakeQueries.js");
  const { createProductionMetadataOnlyAudit } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");

  const DATABASE_URL = process.env.KAI_LEGACY_CUTOVER_DATABASE_URL;
  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const LEGACY_CANDIDATE_ID = "9f1e0000-0000-4000-8000-00000000c0c0";
  const LEGACY_SENSITIVITY_PROFILE_ID = "d1000000-0000-4000-8000-00000000f001";
  const LEGACY_DATA_DICTIONARY_ID = "c1000000-0000-4000-8000-00000000f001";
  const LEGACY_EVIDENCE_ITEM_ID = "f2000000-0000-4000-8000-00000000f001";
  const SHARED_INTAKE_FILE_ID = "20000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-17T12:00:00.000Z";
  const ACTOR = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000001",
    kaiRoles: ["gk_operator"],
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_operator" }],
  };

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 8 });
  const bindTx = (callback) => withTransaction(callback, pool);
  const parserRunRepository = createPostgresParserRunRepository({ runInTransaction: bindTx });
  const dataDictionaryRepository = createPostgresDataDictionaryRepository({ runInTransaction: bindTx });
  const intakeSensitivityProfileRepository = createPostgresIntakeSensitivityProfileRepository({ runInTransaction: bindTx });
  const reviewQueueRepository = createPostgresReviewQueueRepository({ runInTransaction: bindTx });
  const sourceCandidateRepository = createPostgresSourceCandidateRepository({ runInTransaction: bindTx });
  const deps = { env: { ...process.env, KAI_SPRINT2_ENABLED: "true" } };

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

  test("legacy candidate row survives the cutover unchanged, under the preserved legacy schema only", async () => {
    const { rows: legacyRows } = await pool.query(
      `SELECT intake_source_candidate_id, proposed_display_name
         FROM kai_legacy_20260817.intake_source_candidates
        WHERE intake_source_candidate_id = $1`,
      [LEGACY_CANDIDATE_ID],
    );
    assert.equal(legacyRows.length, 1);
    assert.equal(legacyRows[0].proposed_display_name, "Legacy synthetic candidate (pre-Sprint2 generation)");

    // Never relabelled/reused as a canonical candidate.
    const canonical = await getScopedSourceCandidateByIdentityForDisplay(
      { organizationId: ORG, intakeSourceCandidateId: LEGACY_CANDIDATE_ID },
      pool,
    );
    assert.equal(canonical, null);
  });

  test("reprocessing an actual confirmed intake file through the real current P1 producer chain yields a working Review Cockpit detail read", async () => {
    const intakeFileId = "20000000-0000-4000-8000-000000000101";
    const checksum = "7".repeat(64);

    await withClient((client) => client.query(
      `INSERT INTO kai.intake_files (
         intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
         checksum, hash_algorithm, force_new_version, processing_status, parse_status,
         file_policy_status, upload_state, object_version_id, verified_checksum,
         verified_size_bytes, verified_at, upload_state_changed_at, upload_expires_at, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'reprocessed.csv', 'reprocessed.csv', $4, 'sha256', true,
               'quarantined', 'quarantined', 'passed', 'confirmed', 'v1', $4, 2048,
               $5::timestamptz, $5::timestamptz, $5::timestamptz + interval '24 hours', $5::timestamptz)`,
      [intakeFileId, BATCH, ORG, checksum, NOW],
    ));

    // P1-03: real parser-run repository, real Postgres-side sha256 computation
    // (never computed by this test). Mirrors exactly what
    // activateParserProfileWorkForIntakeFile would drive through the worker
    // orchestration seam, without needing a live storage/byte-source adapter.
    const identity = {
      organizationId: ORG,
      intakeFileId,
      parserName: "kai_local_profiling_kernel",
      parserVersion: "1.0.0",
      checksum,
    };
    const { insertRequiredSuccessfulAuditEvent } = await import("../Backend/kai/db/kaiAuditQueries.js");
    const metadataOnlyAudit = createProductionMetadataOnlyAudit({
      organizationId: ORG,
      intakeFileId,
      actorContext: ACTOR,
      now: NOW,
      // Some P1 repositories' own prepareRequiredAudit helper does not forward
      // the transaction's db handle into prepareMetadataOnlyAudit, so publish()
      // would otherwise fall back to the global app pool - which always
      // requests SSL and cannot reach this non-SSL ephemeral instance. Falling
      // back to this test's own pool (not a repository/service change) keeps
      // the audit write real and durable, just targeted correctly.
      insertAuditEvent: (metadata, db) => insertRequiredSuccessfulAuditEvent(metadata, db || pool),
    });

    const queued = await parserRunRepository.ensureQueuedParserRun({ identity, now: NOW });
    assert.equal(queued.ok, true);
    const claimed = await parserRunRepository.claimQueuedParserRun({ identity, now: NOW, metadataOnlyAudit });
    assert.equal(claimed.ok, true, JSON.stringify(claimed));

    const profile = {
      status: "profiled",
      format: "csv",
      counts: { row_count: 3, column_count: 2, field_count: 2 },
      fields: [{ field_key: "field_1" }, { field_key: "field_2" }],
    };
    const completed = await parserRunRepository.completeParserRunWithProfile({
      identity,
      parserRunId: claimed.data.run.parser_run_id,
      profile,
      now: NOW,
      metadataOnlyAudit,
    });
    assert.equal(completed.ok, true, JSON.stringify(completed));
    const fileProfileId = completed.data.run.output_profile_id;
    assert.ok(fileProfileId);

    const realHash = await withClient((client) => client.query(
      `SELECT profile_canonical_sha256 FROM kai.intake_file_profiles WHERE file_profile_id = $1`,
      [fileProfileId],
    ));
    assert.match(realHash.rows[0].profile_canonical_sha256, /^[a-f0-9]{64}$/);
    // Proves the hash was derived by Postgres from the committed profile, not
    // supplied by any script: recomputing it independently must match exactly.
    const independentCheck = await withClient((client) => client.query(
      `SELECT encode(digest($1::jsonb::text, 'sha256'), 'hex') AS expected`,
      [JSON.stringify(profile)],
    ));
    assert.equal(realHash.rows[0].profile_canonical_sha256, independentCheck.rows[0].expected);

    const depsWithAudit = { ...deps, metadataOnlyAudit };

    // P1-04: real service, injected with a non-SSL pool-bound repository (the
    // default repository binds to the global app pool, which always requests
    // SSL - incompatible with this ephemeral, unencrypted local instance).
    const dictionaryResult = await createDraftDataDictionary(
      { organizationId: ORG, fileProfileId, now: NOW },
      { ...depsWithAudit, dataDictionaryRepository },
    );
    assert.equal(dictionaryResult.ok, true, JSON.stringify(dictionaryResult));
    const dataDictionaryId = dictionaryResult.data.dictionary.data_dictionary_id;

    // P1-05: real service.
    const sensitivityResult = await persistIntakeSensitivityProfile(
      { organizationId: ORG, fileProfileId, dataDictionaryId, now: NOW },
      { ...depsWithAudit, intakeSensitivityProfileRepository },
    );
    assert.equal(sensitivityResult.ok, true, JSON.stringify(sensitivityResult));
    const intakeSensitivityProfileId = sensitivityResult.data.sensitivityProfile.intake_sensitivity_profile_id;

    // P1-06: real service (dormant in production but wired correctly here).
    const queueItemResult = await createSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: ACTOR, now: NOW },
      { ...depsWithAudit, reviewQueueRepository },
    );
    assert.equal(queueItemResult.ok, true, JSON.stringify(queueItemResult));

    // P1-07: real service. New candidate identity - never the preserved legacy one.
    const candidateResult = await createSourceCandidateStub(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: ACTOR, now: NOW },
      { ...depsWithAudit, sourceCandidateRepository },
    );
    assert.equal(candidateResult.ok, true, JSON.stringify(candidateResult));
    const intakeSourceCandidateId = candidateResult.data.sourceCandidate.intake_source_candidate_id;
    assert.notEqual(intakeSourceCandidateId, LEGACY_CANDIDATE_ID);

    // Canonical lineage tuple is genuinely populated (not fabricated by this test).
    const canonicalRow = await withClient((client) => client.query(
      `SELECT file_profile_id, data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256, candidate_status
         FROM kai.intake_source_candidates WHERE intake_source_candidate_id = $1`,
      [intakeSourceCandidateId],
    ));
    assert.equal(canonicalRow.rows[0].file_profile_id, fileProfileId);
    assert.equal(canonicalRow.rows[0].data_dictionary_id, dataDictionaryId);
    assert.equal(canonicalRow.rows[0].intake_sensitivity_profile_id, intakeSensitivityProfileId);
    assert.equal(canonicalRow.rows[0].profile_canonical_sha256, realHash.rows[0].profile_canonical_sha256);
    assert.equal(canonicalRow.rows[0].candidate_status, "needs_gk_review");

    // Exactly one CANONICAL source_candidate_review queue row exists for this
    // organization. The preserved legacy generation's own source_candidate_review
    // row is still there, untouched, but it carries the legacy-generation marker,
    // so canonical work and legacy work are cleanly separable.
    const queueRow = await withClient((client) => client.query(
      `SELECT target_object_id, queue_type FROM kai.review_queue_items
        WHERE organization_id = $1 AND queue_type = 'source_candidate_review'
          AND NOT (queue_metadata ? 'kai_legacy_generation_target')`,
      [ORG],
    ));
    assert.equal(queueRow.rows.length, 1);
    // The new canonical source_candidate_review row targets the NEW canonical
    // candidate, never the preserved legacy one.
    assert.equal(queueRow.rows[0].target_object_id, intakeSourceCandidateId);
    assert.notEqual(queueRow.rows[0].target_object_id, LEGACY_CANDIDATE_ID);
    const legacyQueueRow = await withClient((client) => client.query(
      `SELECT queue_status, review_status, target_object_id, summary, required_action
         FROM kai.review_queue_items
        WHERE organization_id = $1 AND queue_type = 'source_candidate_review'
          AND queue_metadata ? 'kai_legacy_generation_target'`,
      [ORG],
    ));
    assert.equal(legacyQueueRow.rows.length, 1);
    // Nothing about the legacy row's own facts was changed or fabricated.
    assert.equal(legacyQueueRow.rows[0].queue_status, "open");
    assert.equal(legacyQueueRow.rows[0].review_status, "needs_gk_review");
    assert.equal(legacyQueueRow.rows[0].target_object_id, LEGACY_CANDIDATE_ID);
    assert.equal(legacyQueueRow.rows[0].summary, "Legacy source candidate review");
    assert.equal(legacyQueueRow.rows[0].required_action, "Review legacy candidate");

    // The actual production read model + service composition now succeeds.
    const record = await getReviewCockpitSourceCandidateRecord(ORG, intakeSourceCandidateId, pool);
    assert.ok(record);
    assert.equal(record.sourceCandidate.intake_source_candidate_id, intakeSourceCandidateId);

    const detail = await getReviewCockpitSourceCandidateDetail(
      {
        intakeSourceCandidateId,
        actorContext: ACTOR,
        organizationId: ORG,
      },
      { ...deps, getReviewCockpitSourceCandidateRecord: (org, id) => getReviewCockpitSourceCandidateRecord(org, id, pool) },
    );
    assert.equal(detail.ok, true, JSON.stringify(detail));
    assert.equal(detail.data.source_candidate.intake_source_candidate_id, intakeSourceCandidateId);
    // P1-08 no-decision case: clean null, not an error.
    assert.equal(detail.data.promotion_decision, null);

    // Tenant isolation: a different organization cannot read this candidate.
    const crossTenant = await getReviewCockpitSourceCandidateDetail(
      { intakeSourceCandidateId, actorContext: { ...ACTOR, organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_operator" }] }, organizationId: OTHER_ORG },
      { ...deps, getReviewCockpitSourceCandidateRecord: (org, id) => getReviewCockpitSourceCandidateRecord(org, id, pool) },
    );
    assert.equal(crossTenant.ok, false);
    assert.equal(crossTenant.error.code, "not_found");

    // The cockpit queue reader never presents a preserved legacy target as
    // canonical work, while every canonical row it should show is still shown.
    const cockpitQueue = await listReviewCockpitQueueItems(
      ORG,
      {
        limit: 50,
        queueTypes: ["intake_file_review", "source_candidate_review", "sensitivity_review",
          "data_dictionary_review", "evidence_review"],
        queueStatuses: ["open", "in_progress", "blocked", "waiting_on_client", "waiting_on_gk"],
      },
      pool,
    );
    const listedTargets = cockpitQueue.map((row) => row.target_object_id);
    assert.ok(!listedTargets.includes(LEGACY_CANDIDATE_ID),
      "the cockpit must not list a preserved legacy source candidate as canonical work");
    assert.ok(!listedTargets.includes(LEGACY_SENSITIVITY_PROFILE_ID),
      "the cockpit must not list a preserved legacy sensitivity profile as canonical work");
    assert.ok(!listedTargets.includes(LEGACY_DATA_DICTIONARY_ID),
      "the cockpit must not list a preserved legacy data dictionary as canonical work");
    assert.ok(!listedTargets.includes(LEGACY_EVIDENCE_ITEM_ID),
      "the cockpit must not list a preserved legacy evidence item as canonical work");
    // The non-legacy shared intake_file_review row is untouched and still listed.
    assert.ok(listedTargets.includes(SHARED_INTAKE_FILE_ID),
      "the cockpit must still list the shared intake-file review row the cutover never marked");
    // And the canonical work produced above is listed.
    assert.ok(listedTargets.includes(intakeSensitivityProfileId),
      "the cockpit must list the canonical sensitivity-review work produced by the real producer chain");

    // Replaying the canonical producer chain on the same identities is
    // convergent, per each producer's own idempotency contract: no duplicate
    // dictionary, sensitivity profile, queue item or candidate is created, and the
    // candidate identity does not change.
    const replayDictionary = await createDraftDataDictionary(
      { organizationId: ORG, fileProfileId, now: NOW },
      { ...depsWithAudit, dataDictionaryRepository },
    );
    assert.equal(replayDictionary.ok, true, JSON.stringify(replayDictionary));
    assert.equal(replayDictionary.data.dictionary.data_dictionary_id, dataDictionaryId);

    const replaySensitivity = await persistIntakeSensitivityProfile(
      { organizationId: ORG, fileProfileId, dataDictionaryId, now: NOW },
      { ...depsWithAudit, intakeSensitivityProfileRepository },
    );
    assert.equal(replaySensitivity.ok, true, JSON.stringify(replaySensitivity));
    assert.equal(
      replaySensitivity.data.sensitivityProfile.intake_sensitivity_profile_id,
      intakeSensitivityProfileId,
    );

    const replayQueueItem = await createSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: ACTOR, now: NOW },
      { ...depsWithAudit, reviewQueueRepository },
    );
    assert.equal(replayQueueItem.ok, true, JSON.stringify(replayQueueItem));

    const replayCandidate = await createSourceCandidateStub(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: ACTOR, now: NOW },
      { ...depsWithAudit, sourceCandidateRepository },
    );
    assert.equal(replayCandidate.ok, true, JSON.stringify(replayCandidate));
    assert.equal(
      replayCandidate.data.sourceCandidate.intake_source_candidate_id,
      intakeSourceCandidateId,
    );

    const convergedCounts = await withClient((client) => client.query(
      `SELECT
         (SELECT count(*)::int FROM kai.data_dictionaries WHERE organization_id = $1) AS dictionaries,
         (SELECT count(*)::int FROM kai.intake_sensitivity_profiles WHERE organization_id = $1) AS sensitivity_profiles,
         (SELECT count(*)::int FROM kai.intake_source_candidates WHERE organization_id = $1) AS candidates,
         (SELECT count(*)::int FROM kai.review_queue_items
           WHERE organization_id = $1 AND NOT (queue_metadata ? 'kai_legacy_generation_target')) AS canonical_queue_rows,
         (SELECT count(*)::int FROM kai.review_queue_items
           WHERE organization_id = $1 AND queue_metadata ? 'kai_legacy_generation_target') AS legacy_queue_rows`,
      [ORG],
    ));
    assert.equal(convergedCounts.rows[0].dictionaries, 1);
    assert.equal(convergedCounts.rows[0].sensitivity_profiles, 1);
    assert.equal(convergedCounts.rows[0].candidates, 1);
    // The pre-existing shared intake_file_review row plus the canonical
    // sensitivity_review and source_candidate_review rows produced above.
    assert.equal(convergedCounts.rows[0].canonical_queue_rows, 3);
    assert.equal(convergedCounts.rows[0].legacy_queue_rows, 4);

    // The preserved legacy graph is completely unaffected by canonical reprocessing.
    const legacyStillIntact = await withClient((client) => client.query(
      `SELECT
         (SELECT count(*)::int FROM kai_legacy_20260817.intake_source_candidates) AS candidates,
         (SELECT count(*)::int FROM kai_legacy_20260817.evidence_items) AS evidence_items,
         (SELECT count(*)::int FROM kai_legacy_20260817.source_locators) AS source_locators`,
    ));
    assert.equal(legacyStillIntact.rows[0].candidates, 1);
    assert.equal(legacyStillIntact.rows[0].evidence_items, 1);
    assert.equal(legacyStillIntact.rows[0].source_locators, 1);
  });
}
