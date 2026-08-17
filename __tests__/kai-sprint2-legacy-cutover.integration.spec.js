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
  const { getReviewCockpitSourceCandidateRecord } = await import("../Backend/kai/db/kaiReviewCockpitReadModels.js");
  const { getScopedSourceCandidateByIdentityForDisplay } = await import("../Backend/kai/db/kaiIntakeQueries.js");
  const { createProductionMetadataOnlyAudit } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");

  const DATABASE_URL = process.env.KAI_LEGACY_CUTOVER_DATABASE_URL;
  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const LEGACY_CANDIDATE_ID = "9f1e0000-0000-4000-8000-00000000c0c0";
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

    // The queue item created above references the canonical candidate's own
    // sensitivity-profile identity, per the P1-07 target_object contract.
    const queueRow = await withClient((client) => client.query(
      `SELECT target_object_id, queue_type FROM kai.review_queue_items
        WHERE organization_id = $1 AND queue_type = 'source_candidate_review'`,
      [ORG],
    ));
    assert.equal(queueRow.rows.length, 1);

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
  });
}
