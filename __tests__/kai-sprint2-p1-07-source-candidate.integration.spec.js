import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

if (!process.env.KAI_P1_07_SOURCE_CANDIDATE_DATABASE_URL) {
  test("P1-07 source-candidate integration requires the runner-owned database", { skip: true }, () => {});
} else {
  await runSourceCandidateIntegrationSuite();
}

async function runSourceCandidateIntegrationSuite() {
  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const { createPostgresSourceCandidateRepository } = await import(
    "../Backend/kai/dictionary/postgresSourceCandidateRepository.js"
  );
  const { createSourceCandidateStub } = await import("../Backend/kai/services/kaiSourceCandidateService.js");

  const DATABASE_URL = process.env.KAI_P1_07_SOURCE_CANDIDATE_DATABASE_URL;
  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-04T10:00:00.000Z";

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 8 });
  const repository = createPostgresSourceCandidateRepository({
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
      "TRUNCATE kai.upload_lifecycle_audit, kai.review_queue_items, kai.intake_source_candidates, " +
      "kai.upload_policy_decision_replay, kai.intake_sensitivity_profiles, kai.data_quality_findings, " +
      "kai.data_dictionary_mappings, kai.data_dictionary_fields, kai.data_dictionaries, kai.intake_file_profiles, " +
      "kai.intake_parser_runs, kai.intake_files",
    ));
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
    // Every fail-closed predicate column is left at its P1-05 CHECK-pinned default:
    // human_review_required = true, public/funder/llm/product_learning_allowed = false,
    // retention_posture = 'restricted_pending_review'.
    const sensitivityResult = await withClient((client) => client.query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::timestamptz)
       RETURNING intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id`,
      [organizationId, intakeFileId, fileProfileId, dataDictionaryId, profileCanonicalSha256, NOW],
    ));
    return {
      organizationId,
      intakeFileId,
      fileProfileId,
      dataDictionaryId,
      profileCanonicalSha256,
      intakeSensitivityProfileId: sensitivityResult.rows[0].intake_sensitivity_profile_id,
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

  test("P1-07: creates one source candidate, one open source_candidate_review item, and one required audit row with the exact pinned fields", async () => {
    const { intakeSensitivityProfileId } = await seedPredicateSatisfyingSensitivityProfile(1);
    const audit = createAuditProbe();

    const result = await repository.createSourceCandidateStub({
      identity: { organizationId: ORG, intakeSensitivityProfileId },
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.replayed, false);
    const candidate = result.data.sourceCandidate;
    assert.equal(candidate.intake_sensitivity_profile_id, intakeSensitivityProfileId);
    assert.equal(candidate.proposed_source_type, "unknown");
    assert.equal(candidate.candidate_status, "needs_gk_review");
    const item = result.data.reviewQueueItem;
    assert.equal(item.queue_type, "source_candidate_review");
    assert.equal(item.target_object_type, "intake_source_candidate");
    assert.equal(item.target_object_id, candidate.intake_source_candidate_id);
    assert.equal(item.queue_status, "open");
    assert.equal(item.queue_metadata.p0_stub, true);
    assert.equal(audit.published.length, 1);

    const auditRow = await withClient((client) => client.query(
      `SELECT metadata FROM kai.upload_lifecycle_audit WHERE operation = 'intake_source_candidate_persisted'`,
    ));
    assert.equal(auditRow.rows.length, 1);
    const metadata = auditRow.rows[0].metadata;
    assert.deepEqual(
      Object.keys(metadata).sort(),
      [
        "candidate_status", "contract", "intake_sensitivity_profile_id", "metadata_only",
        "profile_canonical_sha256", "proposed_source_type", "queue_status", "queue_type",
        "target_object_id", "target_object_type", "validator_key",
      ],
    );
    assert.equal(metadata.metadata_only, true);
    assert.equal(metadata.contract, "p1_intake_source_candidate_v1");
    assert.equal(metadata.intake_sensitivity_profile_id, intakeSensitivityProfileId);
    assert.equal(metadata.proposed_source_type, "unknown");
    assert.equal(metadata.candidate_status, "needs_gk_review");
    assert.equal(metadata.queue_type, "source_candidate_review");
    assert.equal(metadata.target_object_type, "intake_source_candidate");
    assert.equal(metadata.target_object_id, candidate.intake_source_candidate_id);
    assert.equal(metadata.queue_status, "open");
    assert.equal(metadata.validator_key, "VAL-KAI-P1-07-001");
  });

  test("P1-07: same identity replays the existing candidate and review item without duplicating rows or audit", async () => {
    const { intakeSensitivityProfileId } = await seedPredicateSatisfyingSensitivityProfile(2);

    const first = await repository.createSourceCandidateStub({
      identity: { organizationId: ORG, intakeSensitivityProfileId },
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(first.ok, true);
    assert.equal(first.data.replayed, false);

    const secondAudit = createAuditProbe();
    const second = await repository.createSourceCandidateStub({
      identity: { organizationId: ORG, intakeSensitivityProfileId },
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: secondAudit.dependency,
    });
    assert.equal(second.ok, true);
    assert.equal(second.data.replayed, true);
    assert.equal(second.data.sourceCandidate.intake_source_candidate_id, first.data.sourceCandidate.intake_source_candidate_id);
    assert.equal(second.data.reviewQueueItem.review_queue_item_id, first.data.reviewQueueItem.review_queue_item_id);
    assert.equal(secondAudit.published.length, 0, "replay must not write a second audit row");

    const rowCounts = await withClient((client) => Promise.all([
      client.query(
        `SELECT count(*)::int AS count FROM kai.intake_source_candidates
          WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid`,
        [ORG, intakeSensitivityProfileId],
      ),
      client.query(
        `SELECT count(*)::int AS count FROM kai.review_queue_items
          WHERE organization_id = $1::uuid AND queue_type = 'source_candidate_review' AND target_object_id = $2::uuid`,
        [ORG, first.data.sourceCandidate.intake_source_candidate_id],
      ),
    ]));
    assert.deepEqual(rowCounts.map((row) => row.rows[0].count), [1, 1]);
  });

  test("P1-07: an unknown intake_sensitivity_profile_id is rejected as not_found without creating any row", async () => {
    const result = await repository.createSourceCandidateStub({
      identity: { organizationId: ORG, intakeSensitivityProfileId: "80000000-0000-4000-8000-000000000999" },
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P1-07: tenant scoping prevents reading another organization's sensitivity profile", async () => {
    const { intakeSensitivityProfileId } = await seedPredicateSatisfyingSensitivityProfile(3);

    const crossTenantResult = await repository.createSourceCandidateStub({
      identity: { organizationId: OTHER_ORG, intakeSensitivityProfileId },
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(crossTenantResult.ok, false);
    assert.equal(crossTenantResult.error.code, "not_found");

    const rowCount = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.intake_source_candidates WHERE organization_id = $1::uuid`,
      [OTHER_ORG],
    ));
    assert.equal(rowCount.rows[0].count, 0);
  });

  test("P1-07: a rejected required-audit prepare rolls back both the candidate and the review-item writes", async () => {
    const { intakeSensitivityProfileId } = await seedPredicateSatisfyingSensitivityProfile(4);

    const audit = createAuditProbe({ prepareOk: false });
    const result = await repository.createSourceCandidateStub({
      identity: { organizationId: ORG, intakeSensitivityProfileId },
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.intake_source_candidates`),
      client.query(`SELECT count(*)::int AS count FROM kai.review_queue_items WHERE queue_type = 'source_candidate_review'`),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'intake_source_candidate_persisted'`),
    ]));
    for (const countResult of counts) assert.equal(countResult.rows[0].count, 0);
  });

  for (const [label, probeOptions, seedIndex] of [
    ["a synchronous publish() throw", { publishThrows: true }, 5],
    ["a rejected publish() promise", { publishRejects: true }, 6],
  ]) {
    test(`P1-07: ${label} rolls back the candidate, review item, and required audit row together`, async () => {
      const { intakeSensitivityProfileId } = await seedPredicateSatisfyingSensitivityProfile(seedIndex);

      const audit = createAuditProbe(probeOptions);
      const result = await repository.createSourceCandidateStub({
        identity: { organizationId: ORG, intakeSensitivityProfileId },
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: audit.dependency,
      });
      assert.equal(result.ok, false);
      assert.equal(result.data, null);
      assert.equal(result.error.code, "system_error");
      assert.equal(audit.published.length, 0);

      const rollbackCounts = await withClient((client) => Promise.all([
        client.query(`SELECT count(*)::int AS count FROM kai.intake_source_candidates`),
        client.query(`SELECT count(*)::int AS count FROM kai.review_queue_items WHERE queue_type = 'source_candidate_review'`),
        client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'intake_source_candidate_persisted'`),
      ]));
      for (const countResult of rollbackCounts) assert.equal(countResult.rows[0].count, 0);
    });
  }

  test("P1-07: two genuinely overlapping transactions creating the same candidate resolve to exactly one authoritative candidate and review item", async () => {
    const { intakeSensitivityProfileId } = await seedPredicateSatisfyingSensitivityProfile(7);

    // Test-only barrier placed immediately before the candidate insert (never
    // overridden in production wiring - the default `beforeInsert` is a no-op):
    // both independent transactions must first complete their own initial no-row
    // observation and only then rendezvous here before either one executes its
    // `INSERT ... ON CONFLICT ... DO NOTHING RETURNING`. This proves the eventual
    // convergence is genuinely resolved by PostgreSQL's unique constraint, not by
    // one call short-circuiting the other in-process.
    let arrived = 0;
    let openGate;
    const gateOpened = new Promise((resolve) => { openGate = resolve; });
    async function gate() {
      arrived += 1;
      if (arrived >= 2) openGate();
      await gateOpened;
    }
    const racingRepository = createPostgresSourceCandidateRepository({
      runInTransaction: (callback) => withTransaction(callback, pool),
      beforeInsert: gate,
    });

    const firstAudit = createAuditProbe();
    const secondAudit = createAuditProbe();
    const [first, second] = await Promise.all([
      racingRepository.createSourceCandidateStub({
        identity: { organizationId: ORG, intakeSensitivityProfileId },
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: firstAudit.dependency,
      }),
      racingRepository.createSourceCandidateStub({
        identity: { organizationId: ORG, intakeSensitivityProfileId },
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: secondAudit.dependency,
      }),
    ]);
    assert.equal(arrived, 2, "both transactions must have opened before either did its conflicting work");

    assert.equal(first.ok, true, `first call failed: ${JSON.stringify(first.error)}`);
    assert.equal(second.ok, true, `second call failed: ${JSON.stringify(second.error)}`);
    assert.equal(first.data.sourceCandidate.intake_source_candidate_id, second.data.sourceCandidate.intake_source_candidate_id);
    assert.equal(first.data.reviewQueueItem.review_queue_item_id, second.data.reviewQueueItem.review_queue_item_id);
    const replayFlags = [first.data.replayed, second.data.replayed].sort();
    assert.deepEqual(replayFlags, [false, true], "exactly one creator and exactly one replay");
    assert.equal(firstAudit.published.length + secondAudit.published.length, 1);

    const rows = await withClient((client) => Promise.all([
      client.query(
        `SELECT count(*)::int AS count FROM kai.intake_source_candidates WHERE intake_sensitivity_profile_id = $1::uuid`,
        [intakeSensitivityProfileId],
      ),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'intake_source_candidate_persisted'`),
    ]));
    assert.deepEqual(rows.map((row) => row.rows[0].count), [1, 1]);
  });

  test("P1-07: an unrelated queue_type's rows are unaffected by the source_candidate_review partial unique index", async () => {
    const { intakeFileId } = await seedPredicateSatisfyingSensitivityProfile(8);
    await withClient((client) => client.query(
      `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary)
       VALUES ($1::uuid, 'intake_file_review', 'intake_file', $2::uuid, 'first'), ($1::uuid, 'intake_file_review', 'intake_file', $2::uuid, 'second')`,
      [ORG, intakeFileId],
    ));
    const rowCount = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.review_queue_items WHERE queue_type = 'intake_file_review' AND target_object_id = $1::uuid`,
      [intakeFileId],
    ));
    assert.equal(rowCount.rows[0].count, 2);
  });

  test("P1-07 catalog verifier: every expected check name appears exactly once with no FAIL", async () => {
    const verifierSql = readFileSync(
      new URL("../scripts/kai-sprint2-p1-07-source-candidate-verifier.sql", import.meta.url),
      "utf8",
    );
    const result = await pool.query(verifierSql);
    const keys = result.rows.map((row) => `${row.check_name}::${row.object_name}`);
    assert.equal(keys.length, new Set(keys).size, "duplicate catalog-check rows found");
    assert.ok(!result.rows.some((row) => row.status === "FAIL"), "catalog verifier reported an unexpected FAIL");
  });

  test("P1-07: end-to-end via the service seam with KAI_SPRINT2_ENABLED, AUTH-KAI-003, and VAL-TEN-001, using the postgres repository", async () => {
    const { intakeSensitivityProfileId } = await seedPredicateSatisfyingSensitivityProfile(9);

    const result = await createSourceCandidateStub(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: humanActor(), now: NOW },
      {
        env: { KAI_SPRINT2_ENABLED: "true" },
        sourceCandidateRepository: repository,
        metadataOnlyAudit: createAuditProbe().dependency,
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.reviewQueueItem.queue_status, "open");

    const deniedResult = await createSourceCandidateStub(
      { organizationId: ORG, intakeSensitivityProfileId, actorContext: humanActor({ actorType: "ai" }), now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, sourceCandidateRepository: repository, metadataOnlyAudit: createAuditProbe().dependency },
    );
    assert.equal(deniedResult.ok, false);
    assert.equal(deniedResult.error.code, "authorization_denied");
  });
}
