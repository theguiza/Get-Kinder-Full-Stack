import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/**
 * Real-database proof for the shared file-scoped P1 operation
 * (`processKaiP1IntakeFile` in `Backend/kai/parsing/p1WorkerRuntime.js`) and
 * the scheduled tick that delegates to it, composed over the real P1-03
 * parser-run, P1-04 data-dictionary, and P1-05 sensitivity-profile PostgreSQL
 * repositories and the real production metadata-only audit composition.
 *
 * Cross-instance safety is exercised with two independent `pg` pools, each
 * with its own repository instances, standing in for two application
 * instances: nothing in-process is shared between them except the database.
 * Every row is synthetic. Skipped without its own opt-in database URL,
 * following this repository's existing `.integration.spec.js` convention.
 */
if (!process.env.KAI_P1_WORKER_FILE_PROCESSING_DATABASE_URL) {
  test("P1 worker file-processing integration requires the runner-owned database", { skip: true }, () => {});
} else {
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const {
    getScopedIntakeFileParserProfileEligibilityFacts,
    listActionableKaiP1WorkCandidates,
  } = await import("../Backend/kai/db/kaiIntakeQueries.js");
  const { createPostgresParserRunRepository } = await import("../Backend/kai/parsing/postgresParserRunRepository.js");
  const { createPostgresDataDictionaryRepository } = await import(
    "../Backend/kai/dictionary/postgresDataDictionaryRepository.js"
  );
  const { createPostgresIntakeSensitivityProfileRepository } = await import(
    "../Backend/kai/dictionary/postgresIntakeSensitivityProfileRepository.js"
  );
  const { processKaiP1IntakeFile, runKaiP1WorkerTick } = await import("../Backend/kai/parsing/p1WorkerRuntime.js");

  const DATABASE_URL = process.env.KAI_P1_WORKER_FILE_PROCESSING_DATABASE_URL;
  const ORG = "00000000-0000-4000-8000-00000000c001";
  const OTHER_ORG = "00000000-0000-4000-8000-00000000c002";
  const BATCH = "10000000-0000-4000-8000-00000000c001";
  const NOW = "2026-10-10T12:00:00.000Z";
  const ENABLED_ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_WORKER_ENABLED: "true" });

  // Two independent pools: the only thing two "instances" share is PostgreSQL.
  const poolA = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 4 });
  const poolB = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 4 });
  test.after(async () => {
    await poolA.end();
    await poolB.end();
  });

  async function query(text, params) {
    return poolA.query(text, params);
  }

  async function resetTables() {
    await query(
      "TRUNCATE kai.audit_events, kai.upload_lifecycle_audit, kai.upload_policy_decision_replay, " +
      "kai.intake_sensitivity_profiles, kai.data_quality_findings, kai.data_dictionary_mappings, " +
      "kai.data_dictionary_fields, kai.data_dictionaries, kai.intake_file_profiles, kai.intake_parser_runs, " +
      "kai.intake_files CASCADE",
    );
  }

  function fileId(index) {
    return `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  }

  function csvBytesFor(index) {
    return Buffer.from(`program,participants\nsynthetic_${index},${10 + index}\nsynthetic_${index}_b,${20 + index}\n`);
  }

  function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
  }

  /**
   * Seeds one synthetic intake file directly in the requested lifecycle state.
   * Confirmed rows carry the full verified object-version identity the Gate A
   * state/fact consistency constraint requires.
   */
  async function seedFile({
    intakeFileId,
    organizationId = ORG,
    bytes,
    uploadState = "confirmed",
    filePolicyStatus = "passed",
    declaredChecksum,
    createdAt = NOW,
  }) {
    const checksum = sha256(bytes);
    const confirmedFacts = uploadState === "confirmed" || uploadState === "policy_blocked";
    const objectVersionId = uploadState === "reserved" || uploadState === "upload_started" ? null : `ov-${intakeFileId}`;
    await query(
      `INSERT INTO kai.intake_files (
         intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         checksum, hash_algorithm, force_new_version, processing_status, parse_status,
         file_policy_status, upload_state, object_version_id, verified_checksum, verified_size_bytes,
         verified_at, upload_state_changed_at, upload_expires_at, created_at,
         mime_type, file_extension, file_size_bytes, storage_provider, storage_object_key
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, 'synthetic.csv', 'synthetic.csv',
               $4, 'sha256', true, 'quarantined', 'quarantined',
               $5, $6, $7, $8, $9::bigint,
               $10::timestamptz, $11::timestamptz, $11::timestamptz + interval '24 hours', $11::timestamptz,
               'text/csv', '.csv', $12::bigint, 'local', $13)`,
      [
        intakeFileId,
        BATCH,
        organizationId,
        declaredChecksum || checksum,
        filePolicyStatus,
        uploadState,
        objectVersionId,
        confirmedFacts ? checksum : null,
        confirmedFacts ? bytes.byteLength : null,
        confirmedFacts ? createdAt : null,
        createdAt,
        bytes.byteLength,
        `synthetic/${intakeFileId}`,
      ],
    );
    return { intakeFileId, organizationId, objectVersionId, checksum, size: bytes.byteLength };
  }

  /** Synthetic exact-version byte source shared by both "instances". */
  function createByteSource({ delayMs = 0, unreadable = false } = {}) {
    const bytesByObjectVersion = new Map();
    const reads = [];
    return {
      reads,
      register(objectVersionId, bytes) {
        bytesByObjectVersion.set(objectVersionId, bytes);
      },
      dependency: {
        async readObjectVersion({ objectVersionId }) {
          reads.push(objectVersionId);
          if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
          if (unreadable) return { ok: false, data: null, error: { code: "byte_source_unavailable" } };
          const bytes = bytesByObjectVersion.get(objectVersionId);
          if (!bytes) return { ok: false, data: null, error: { code: "not_found" } };
          return { ok: true, data: { bytes: new Uint8Array(bytes) }, error: null };
        },
      },
    };
  }

  /** One "instance": repositories bound only to its own pool. */
  function instanceDependencies(pool, byteSource, overrides = {}) {
    const runInTransaction = (callback) => withTransaction(callback, pool);
    return {
      env: ENABLED_ENV,
      now: () => NOW,
      getScopedIntakeFileParserProfileEligibilityFacts: (identity) =>
        getScopedIntakeFileParserProfileEligibilityFacts(identity, pool),
      listActionableKaiP1WorkCandidates: () => listActionableKaiP1WorkCandidates(pool),
      parserRunRepository: createPostgresParserRunRepository({ runInTransaction }),
      dataDictionaryRepository: createPostgresDataDictionaryRepository({ runInTransaction }),
      intakeSensitivityProfileRepository: createPostgresIntakeSensitivityProfileRepository({ runInTransaction }),
      objectVersionByteSource: byteSource.dependency,
      ...overrides,
    };
  }

  const rejectingDownstreamAudit = () => ({ prepareMetadataOnlyAudit: () => ({ ok: false }) });

  async function counts(intakeFileId) {
    const scalar = async (sql) => Number((await query(sql, [intakeFileId])).rows[0].count);
    const lifecycle = await query(
      `SELECT operation, count(*)::int AS count
         FROM kai.upload_lifecycle_audit
        WHERE intake_file_id = $1::uuid
        GROUP BY operation`,
      [intakeFileId],
    );
    return {
      parserRuns: await scalar("SELECT count(*) FROM kai.intake_parser_runs WHERE intake_file_id = $1::uuid"),
      fileProfiles: await scalar("SELECT count(*) FROM kai.intake_file_profiles WHERE intake_file_id = $1::uuid"),
      dictionaries: await scalar("SELECT count(*) FROM kai.data_dictionaries WHERE intake_file_id = $1::uuid"),
      dictionaryFields: await scalar(
        `SELECT count(*) FROM kai.data_dictionary_fields f
           JOIN kai.data_dictionaries d ON d.data_dictionary_id = f.data_dictionary_id
          WHERE d.intake_file_id = $1::uuid`,
      ),
      sensitivityProfiles: await scalar("SELECT count(*) FROM kai.intake_sensitivity_profiles WHERE intake_file_id = $1::uuid"),
      auditEvents: await scalar("SELECT count(*) FROM kai.audit_events WHERE metadata->>'intake_file_id' = $1::text"),
      lifecycleAudit: Object.fromEntries(lifecycle.rows.map((row) => [row.operation, row.count])),
    };
  }

  async function parserRun(intakeFileId) {
    const { rows } = await query(
      `SELECT parser_status, retry_count, error_code, output_profile_id::text AS output_profile_id, checksum
         FROM kai.intake_parser_runs
        WHERE intake_file_id = $1::uuid`,
      [intakeFileId],
    );
    return rows;
  }

  test("1. an eligible confirmed/passed file runs P1-03 -> P1-04 -> P1-05 through the shared operation with required audits", async () => {
    await resetTables();
    const bytes = csvBytesFor(1);
    const file = await seedFile({ intakeFileId: fileId(1), bytes });
    const byteSource = createByteSource();
    byteSource.register(file.objectVersionId, bytes);

    const result = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: file.intakeFileId },
      instanceDependencies(poolA, byteSource),
    );

    assert.equal(result.ok, true);
    assert.equal(result.data.stoppedAt, undefined);
    assert.equal(result.data.result.data.run.run.parser_status, "completed");
    assert.equal(result.data.dataDictionary.ok, true);
    assert.equal(result.data.sensitivityProfile.ok, true);
    assert.deepEqual(byteSource.reads, [file.objectVersionId]);

    const runs = await parserRun(file.intakeFileId);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].checksum, file.checksum, "parser identity is bound to the verified checksum");

    const after = await counts(file.intakeFileId);
    assert.equal(after.parserRuns, 1);
    assert.equal(after.fileProfiles, 1);
    assert.equal(after.dictionaries, 1);
    assert.ok(after.dictionaryFields >= 1);
    assert.equal(after.sensitivityProfiles, 1);
    assert.equal(after.lifecycleAudit.file_profile_persisted, 1);
    assert.equal(after.lifecycleAudit.data_dictionary_draft_persisted, 1);
    assert.equal(after.lifecycleAudit.intake_sensitivity_profile_persisted, 1);
    assert.ok(after.auditEvents >= 4, "claim, completion, dictionary, and sensitivity required audits are durable");
  });

  test("2. unconfirmed, pending, blocked, and failed-policy files cannot enter the shared operation", async () => {
    await resetTables();
    const cases = [
      { uploadState: "confirmed", filePolicyStatus: "pending" },
      { uploadState: "confirmed", filePolicyStatus: "blocked" },
      { uploadState: "confirmed", filePolicyStatus: "failed" },
      { uploadState: "reserved", filePolicyStatus: "passed" },
      { uploadState: "upload_started", filePolicyStatus: "passed" },
      { uploadState: "uploaded_unconfirmed", filePolicyStatus: "passed" },
      { uploadState: "policy_blocked", filePolicyStatus: "passed" },
      { uploadState: "abandoned", filePolicyStatus: "passed" },
      { uploadState: "expired", filePolicyStatus: "passed" },
    ];
    const byteSource = createByteSource();

    for (const [index, entry] of cases.entries()) {
      const bytes = csvBytesFor(20 + index);
      const file = await seedFile({ intakeFileId: fileId(20 + index), bytes, ...entry });
      if (file.objectVersionId) byteSource.register(file.objectVersionId, bytes);

      const result = await processKaiP1IntakeFile(
        { organizationId: ORG, intakeFileId: file.intakeFileId },
        instanceDependencies(poolA, byteSource),
      );
      assert.equal(result.ok, true, JSON.stringify(entry));
      assert.equal(result.data.stoppedAt, "parser_profile_activation", JSON.stringify(entry));
      assert.equal(result.data.result.data.reason, "not_eligible_for_p1", JSON.stringify(entry));
      assert.equal(result.data.dataDictionary, undefined);

      const after = await counts(file.intakeFileId);
      assert.equal(after.parserRuns, 0, JSON.stringify(entry));
      assert.equal(after.auditEvents, 0, JSON.stringify(entry));
      assert.deepEqual(after.lifecycleAudit, {}, JSON.stringify(entry));
    }

    assert.equal(byteSource.reads.length, 0);
    assert.deepEqual(await listActionableKaiP1WorkCandidates(poolA), []);
  });

  test("3. stale object-version/checksum records and cross-tenant identities cannot enter the shared operation", async () => {
    await resetTables();
    const byteSource = createByteSource();

    const bytes = csvBytesFor(40);
    const file = await seedFile({ intakeFileId: fileId(40), bytes });
    byteSource.register(file.objectVersionId, bytes);
    const current = { objectVersionId: file.objectVersionId, verifiedChecksum: file.checksum, verifiedSizeBytes: file.size };

    for (const stale of [
      { ...current, objectVersionId: "ov-superseded" },
      { ...current, verifiedChecksum: sha256(Buffer.from("superseded")) },
      { ...current, verifiedSizeBytes: file.size + 1 },
    ]) {
      const result = await processKaiP1IntakeFile(
        { organizationId: ORG, intakeFileId: file.intakeFileId, expectedFileFacts: stale },
        instanceDependencies(poolA, byteSource),
      );
      assert.equal(result.data.stoppedAt, "parser_profile_activation");
      assert.equal(result.data.result.error.code, "conflict_current_state_changed");
    }

    const crossTenant = await processKaiP1IntakeFile(
      { organizationId: OTHER_ORG, intakeFileId: file.intakeFileId },
      instanceDependencies(poolB, byteSource),
    );
    assert.equal(crossTenant.data.result.error.code, "not_found");
    assert.deepEqual(await counts(file.intakeFileId), {
      parserRuns: 0,
      fileProfiles: 0,
      dictionaries: 0,
      dictionaryFields: 0,
      sensitivityProfiles: 0,
      auditEvents: 0,
      lifecycleAudit: {},
    });

    // A confirmed/passed row whose verified checksum no longer equals the
    // declared checksum it was confirmed against is inconsistent: refused by
    // the operation and never selected by the scheduled sweep.
    const inconsistentBytes = csvBytesFor(41);
    const inconsistent = await seedFile({
      intakeFileId: fileId(41),
      bytes: inconsistentBytes,
      declaredChecksum: sha256(Buffer.from("declared-but-never-verified")),
    });
    byteSource.register(inconsistent.objectVersionId, inconsistentBytes);
    const refused = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: inconsistent.intakeFileId },
      instanceDependencies(poolA, byteSource),
    );
    assert.equal(refused.data.result.error.code, "validation_blocker");
    assert.equal((await counts(inconsistent.intakeFileId)).parserRuns, 0);
    assert.deepEqual(
      (await listActionableKaiP1WorkCandidates(poolA)).map((row) => row.intake_file_id),
      [file.intakeFileId],
    );

    // A matching expectation is accepted and binds the run to that identity.
    const accepted = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: file.intakeFileId, expectedFileFacts: current },
      instanceDependencies(poolA, byteSource),
    );
    assert.equal(accepted.data.stoppedAt, undefined);
    assert.equal((await parserRun(file.intakeFileId))[0].checksum, file.checksum);
    assert.equal(byteSource.reads.length, 1);
  });

  test("4. concurrent attempts from two independent instances never duplicate parser work", async () => {
    await resetTables();
    const bytes = csvBytesFor(60);
    const file = await seedFile({ intakeFileId: fileId(60), bytes });
    // A slow exact-version read keeps the winning claim `running` while the
    // other attempts arrive, so they race the claim rather than a completed run.
    const byteSource = createByteSource({ delayMs: 150 });
    byteSource.register(file.objectVersionId, bytes);

    const attempts = [poolA, poolB, poolA, poolB, poolA, poolB].map((pool) =>
      processKaiP1IntakeFile({ organizationId: ORG, intakeFileId: file.intakeFileId }, instanceDependencies(pool, byteSource)));
    const results = await Promise.all(attempts);

    assert.equal(byteSource.reads.length, 1, "exactly one attempt read the object version and profiled it");
    assert.ok(results.every((result) => result.ok === true));
    const completed = results.filter((result) => result.data.stoppedAt === undefined);
    assert.ok(completed.length >= 1, "at least one attempt carried the file through P1-05");
    for (const result of results.filter((entry) => entry.data.stoppedAt !== undefined)) {
      assert.equal(result.data.stoppedAt, "parser_profile_activation");
      assert.equal(result.data.result.error.code, "conflict_current_state_changed");
    }

    const runs = await parserRun(file.intakeFileId);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].parser_status, "completed");
    assert.equal(runs[0].retry_count, 0);

    const after = await counts(file.intakeFileId);
    assert.equal(after.parserRuns, 1);
    assert.equal(after.fileProfiles, 1);
    assert.equal(after.dictionaries, 1);
    assert.equal(after.sensitivityProfiles, 1);
    assert.equal(after.lifecycleAudit.file_profile_persisted, 1);
    assert.equal(after.lifecycleAudit.data_dictionary_draft_persisted, 1);
    assert.equal(after.lifecycleAudit.intake_sensitivity_profile_persisted, 1);
  });

  test("5. concurrent completed-parser replays from two instances neither corrupt nor duplicate P1-04/P1-05 results", async () => {
    await resetTables();
    const byteSource = createByteSource();

    // P1-04 recovery: P1-03 completed, P1-04 rolled back (rejected required audit).
    const dictionaryBytes = csvBytesFor(80);
    const dictionaryFile = await seedFile({ intakeFileId: fileId(80), bytes: dictionaryBytes });
    byteSource.register(dictionaryFile.objectVersionId, dictionaryBytes);
    const first = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: dictionaryFile.intakeFileId },
      instanceDependencies(poolA, byteSource, { createProductionMetadataOnlyAudit: rejectingDownstreamAudit }),
    );
    assert.equal(first.data.stoppedAt, "draft_data_dictionary");
    assert.equal((await counts(dictionaryFile.intakeFileId)).dictionaries, 0);

    // P1-05 recovery: P1-03 and P1-04 completed, P1-05 never ran.
    const sensitivityBytes = csvBytesFor(81);
    const sensitivityFile = await seedFile({ intakeFileId: fileId(81), bytes: sensitivityBytes });
    byteSource.register(sensitivityFile.objectVersionId, sensitivityBytes);
    const partial = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: sensitivityFile.intakeFileId },
      instanceDependencies(poolA, byteSource, {
        persistIntakeSensitivityProfile: async () => ({ ok: false, data: null, error: { code: "system_error" } }),
      }),
    );
    assert.equal(partial.data.stoppedAt, "persist_intake_sensitivity_profile");
    const partialDictionaryId = partial.data.dataDictionary.data.dictionary.data_dictionary_id;

    assert.equal(byteSource.reads.length, 2);
    const readsBeforeReplay = byteSource.reads.length;

    for (const file of [dictionaryFile, sensitivityFile]) {
      const replays = await Promise.all([poolA, poolB, poolA, poolB, poolA, poolB].map((pool) =>
        processKaiP1IntakeFile({ organizationId: ORG, intakeFileId: file.intakeFileId }, instanceDependencies(pool, byteSource))));

      assert.ok(replays.every((result) => result.ok === true && result.data.stoppedAt === undefined));
      for (const result of replays) {
        assert.equal(result.data.result.data.activated, false, "a completed run is replayed, never re-claimed");
        assert.equal(result.data.result.data.run.replayed, true);
      }
      const dictionaryIds = new Set(replays.map((result) => result.data.dataDictionary.data.dictionary.data_dictionary_id));
      const sensitivityIds = new Set(replays.map((result) =>
        result.data.sensitivityProfile.data.sensitivityProfile.intake_sensitivity_profile_id));
      assert.equal(dictionaryIds.size, 1);
      assert.equal(sensitivityIds.size, 1);
      if (file === sensitivityFile) assert.deepEqual([...dictionaryIds], [partialDictionaryId]);

      const settled = await counts(file.intakeFileId);
      assert.equal(settled.parserRuns, 1);
      assert.equal(settled.fileProfiles, 1);
      assert.equal(settled.dictionaries, 1);
      assert.equal(settled.sensitivityProfiles, 1);
      assert.equal(settled.lifecycleAudit.data_dictionary_draft_persisted, 1);
      assert.equal(settled.lifecycleAudit.intake_sensitivity_profile_persisted, 1);

      // A further concurrent replay round changes nothing at all.
      await Promise.all([poolA, poolB].map((pool) =>
        processKaiP1IntakeFile({ organizationId: ORG, intakeFileId: file.intakeFileId }, instanceDependencies(pool, byteSource))));
      assert.deepEqual(await counts(file.intakeFileId), settled);
    }

    assert.equal(byteSource.reads.length, readsBeforeReplay, "no completed parser run was re-profiled");
  });

  test("6. parser failure and manual-retry restrictions are intact, and a downstream failure never fails the completed parser run", async () => {
    await resetTables();

    const failedBytes = csvBytesFor(100);
    const failedFile = await seedFile({ intakeFileId: fileId(100), bytes: failedBytes });
    const unreadable = createByteSource({ unreadable: true });
    const failed = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: failedFile.intakeFileId },
      instanceDependencies(poolA, unreadable),
    );
    assert.equal(failed.data.stoppedAt, "parser_profile_activation");
    assert.deepEqual(
      (await parserRun(failedFile.intakeFileId)).map(({ parser_status: status, retry_count: retries, error_code: code }) => ({ status, retries, code })),
      [{ status: "failed", retries: 1, code: "byte_source_unavailable" }],
    );

    // Later automatic attempts from both instances never re-queue, re-read, or
    // re-count a failed run: only an explicit retry may, and the operation
    // cannot express one.
    const readable = createByteSource();
    readable.register(failedFile.objectVersionId, failedBytes);
    const again = await Promise.all([poolA, poolB].map((pool) =>
      processKaiP1IntakeFile({ organizationId: ORG, intakeFileId: failedFile.intakeFileId }, instanceDependencies(pool, readable))));
    for (const result of again) {
      assert.equal(result.data.stoppedAt, "parser_profile_activation");
      assert.equal(result.data.result.error.code, "conflict_current_state_changed");
    }
    const retryRequest = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: failedFile.intakeFileId, retry: true },
      instanceDependencies(poolA, readable),
    );
    assert.equal(retryRequest.ok, false);
    assert.equal(retryRequest.error.code, "validation_blocker");
    assert.equal(readable.reads.length, 0);
    assert.deepEqual(
      (await parserRun(failedFile.intakeFileId)).map(({ parser_status: status, retry_count: retries }) => ({ status, retries })),
      [{ status: "failed", retries: 1 }],
    );
    assert.equal((await counts(failedFile.intakeFileId)).fileProfiles, 0);
    assert.equal(
      (await listActionableKaiP1WorkCandidates(poolA)).some((row) => row.intake_file_id === failedFile.intakeFileId),
      false,
      "a failed current-identity run is excluded from automatic selection",
    );

    // A persistent P1-04 failure (required audit rejected -> full rollback)
    // stops the chain but leaves the completed parser run completed.
    const downstreamBytes = csvBytesFor(101);
    const downstreamFile = await seedFile({ intakeFileId: fileId(101), bytes: downstreamBytes });
    const byteSource = createByteSource();
    byteSource.register(downstreamFile.objectVersionId, downstreamBytes);
    const persistentlyFailing = instanceDependencies(poolA, byteSource, {
      createProductionMetadataOnlyAudit: rejectingDownstreamAudit,
    });
    const firstTick = await runKaiP1WorkerTick(persistentlyFailing);
    const secondTick = await runKaiP1WorkerTick(persistentlyFailing);
    for (const tick of [firstTick, secondTick]) {
      const entry = tick.data.activated.find((item) => item.intakeFileId === downstreamFile.intakeFileId);
      assert.equal(entry.stoppedAt, "draft_data_dictionary");
      assert.equal(entry.dataDictionary.error.code, "validation_blocker");
    }
    assert.equal(byteSource.reads.length, 1, "the downstream failure never re-profiled the completed run");
    assert.deepEqual(
      (await parserRun(downstreamFile.intakeFileId)).map(({ parser_status: status, retry_count: retries, error_code: code }) => ({ status, retries, code })),
      [{ status: "completed", retries: 0, code: null }],
    );
    const afterFailures = await counts(downstreamFile.intakeFileId);
    assert.equal(afterFailures.dictionaries, 0);
    assert.equal(afterFailures.lifecycleAudit.data_dictionary_draft_persisted, undefined);
    // Current, documented behaviour: with no durable downstream attempt
    // state, the file stays a recovery candidate and every sweep attempts
    // P1-04 once more.
    assert.equal(
      (await listActionableKaiP1WorkCandidates(poolA)).some((row) => row.intake_file_id === downstreamFile.intakeFileId),
      true,
    );
  });

  test("7. disabled feature gates block execution with zero reads or writes", async () => {
    await resetTables();
    const bytes = csvBytesFor(120);
    const file = await seedFile({ intakeFileId: fileId(120), bytes });
    const byteSource = createByteSource();
    byteSource.register(file.objectVersionId, bytes);

    for (const env of [
      { KAI_SPRINT2_ENABLED: "false", KAI_WORKER_ENABLED: "true" },
      { KAI_SPRINT2_ENABLED: "true", KAI_WORKER_ENABLED: "false" },
      {},
    ]) {
      let factsReads = 0;
      const dependencies = instanceDependencies(poolA, byteSource, {
        env,
        getScopedIntakeFileParserProfileEligibilityFacts: async (identity) => {
          factsReads += 1;
          return getScopedIntakeFileParserProfileEligibilityFacts(identity, poolA);
        },
      });
      const result = await processKaiP1IntakeFile({ organizationId: ORG, intakeFileId: file.intakeFileId }, dependencies);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "feature_disabled");
      const tick = await runKaiP1WorkerTick(dependencies);
      assert.deepEqual(tick.data, { activated: [], reason: "worker_disabled" });
      assert.equal(factsReads, 0);
    }
    assert.equal(byteSource.reads.length, 0);
    assert.equal((await counts(file.intakeFileId)).parserRuns, 0);
  });

  test("8. the scheduled tick keeps its oldest-first order and bounded window and completes eligible files via the shared operation", async () => {
    await resetTables();
    const byteSource = createByteSource();
    const eligible = [];
    for (let index = 0; index < 3; index += 1) {
      const bytes = csvBytesFor(140 + index);
      // Seeded newest-first so the expected order is not insertion order.
      const file = await seedFile({
        intakeFileId: fileId(140 + index),
        organizationId: index === 1 ? OTHER_ORG : ORG,
        bytes,
        createdAt: new Date(Date.parse(NOW) - index * 60_000).toISOString(),
      });
      byteSource.register(file.objectVersionId, bytes);
      eligible.push(file);
    }
    const pendingBytes = csvBytesFor(150);
    await seedFile({ intakeFileId: fileId(150), bytes: pendingBytes, filePolicyStatus: "pending" });

    const first = await runKaiP1WorkerTick(instanceDependencies(poolA, byteSource));
    assert.equal(first.ok, true);
    assert.deepEqual(
      first.data.activated.map((entry) => [entry.organizationId, entry.intakeFileId]),
      [...eligible].reverse().map((file) => [file.organizationId, file.intakeFileId]),
      "oldest created_at first, each with its own persisted organization_id",
    );
    assert.ok(first.data.activated.every((entry) => entry.stoppedAt === undefined));

    const second = await runKaiP1WorkerTick(instanceDependencies(poolB, byteSource));
    assert.deepEqual(second.data.activated, [], "satisfied files leave the window");
    assert.equal(byteSource.reads.length, 3);

    // The window stays bounded at 25 per sweep.
    for (let index = 0; index < 27; index += 1) {
      await seedFile({ intakeFileId: fileId(200 + index), bytes: csvBytesFor(200 + index) });
    }
    assert.equal((await listActionableKaiP1WorkCandidates(poolA)).length, 25);
  });
}
