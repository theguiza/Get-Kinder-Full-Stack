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

  // ---------------------------------------------------------------------
  // Package 2: immediate file-scoped dispatch after a committed `passed`
  // security-policy decision. The production confirmation path below runs
  // on the application's own default pool, which the runner points at this
  // same ephemeral database (empty connection strings + DB_HOST/DB_PORT).
  // ---------------------------------------------------------------------
  const { performance } = await import("node:perf_hooks");
  const { default: appPool } = await import("../Backend/db/pg.js");
  const runtimeService = await import("../Backend/kai/services/kaiIntakeRuntimeService.js");
  const { __testables: intakeServiceTestables } = await import("../Backend/kai/services/kaiIntakeService.js");
  const { createPostgresUploadLifecycleRepository } = await import("../Backend/kai/upload/postgresUploadLifecycleRepository.js");
  const { createKaiP1FileDispatcher, getKaiP1FileDispatcher } = await import("../Backend/kai/parsing/p1FileDispatch.js");
  const { POLICY_ELIGIBLE_FAILED_CATEGORIES } = await import("../Backend/kai/security/assessmentPolicyOutcome.js");
  const { getScopedIntakeFileSecurityAssessmentFacts } = await import("../Backend/kai/db/kaiIntakeQueries.js");
  const applyConfirmedSecurityAssessment = intakeServiceTestables.applyConfirmedSecurityAssessment;

  test.after(async () => {
    await appPool.end();
  });

  const UPLOAD_ENV = Object.freeze({ ...ENABLED_ENV, KAI_FILE_UPLOAD_ENABLED: "true" });
  const CONFIRM_NOW = new Date(Date.parse(NOW) + 60_000).toISOString();
  const ACTOR = Object.freeze({
    actorType: "human",
    actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
    kaiRoles: ["gk_operator"],
    organizationMemberships: [{ organization_id: ORG, role_name: "gk_operator", membership_status: "active" }],
  });
  const PASS = Object.freeze({ policy: "pass" });

  function providerNeutralObjectVersionId(index) {
    return `ov_${String(index).padStart(32, "0")}`;
  }

  /** A reservation whose bytes are uploaded but not yet confirmed. */
  async function seedUploadedUnconfirmed({ index, bytes, organizationId = ORG }) {
    const intakeFileId = fileId(index);
    const objectVersionId = providerNeutralObjectVersionId(index);
    await query(
      `INSERT INTO kai.intake_files (
         intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         checksum, hash_algorithm, force_new_version, processing_status, parse_status,
         file_policy_status, upload_state, object_version_id,
         upload_state_changed_at, upload_expires_at, created_at,
         mime_type, file_extension, file_size_bytes, storage_provider, storage_bucket, storage_object_key
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, 'synthetic.csv', 'synthetic.csv',
               $4, 'sha256', true, 'quarantined', 'quarantined',
               'pending', 'uploaded_unconfirmed', $5,
               $6::timestamptz, $6::timestamptz + interval '24 hours', $6::timestamptz,
               'text/csv', '.csv', $7::bigint, 'local', 'synthetic-bucket', $8)`,
      [intakeFileId, BATCH, organizationId, sha256(bytes), objectVersionId, NOW, bytes.byteLength, `synthetic/${intakeFileId}`],
    );
    return { intakeFileId, organizationId, objectVersionId, checksum: sha256(bytes), size: bytes.byteLength };
  }

  /** Synthetic exact-version storage: streamed reads for verification/assessment, whole reads for P1. */
  function createSyntheticStorage() {
    const objects = new Map();
    const p1Reads = [];
    return {
      p1Reads,
      put(objectVersionId, bytes) {
        objects.set(objectVersionId, bytes);
      },
      adapter: {
        async openObjectVersionReadStream({ objectVersionId }) {
          const bytes = objects.get(objectVersionId);
          if (!bytes) return { ok: false, error: { code: "not_found" } };
          return {
            ok: true,
            data: {
              object_version_id: objectVersionId,
              size_bytes: bytes.byteLength,
              byte_source: {
                [Symbol.asyncIterator]() {
                  let done = false;
                  return {
                    async next() {
                      if (done) return { done: true, value: undefined };
                      done = true;
                      return { done: false, value: bytes };
                    },
                  };
                },
                async close() {},
              },
            },
          };
        },
        async readObjectVersion({ objectVersionId }) {
          p1Reads.push(objectVersionId);
          const bytes = objects.get(objectVersionId);
          if (!bytes) return { ok: false, data: null, error: { code: "not_found" } };
          return { ok: true, data: { bytes: new Uint8Array(bytes) }, error: null };
        },
      },
    };
  }

  /** Synthetic stand-in for the ClamAV-backed executor seam; the policy mapping stays production. */
  function syntheticExecutor(result) {
    return {
      seamKind: "kai_sprint2_internal_security_assessment_executor",
      identity: { actorType: "internal_service", serviceIdentity: "kai_file_security_executor", operationGroup: "file_security_assessment" },
      async execute() {
        return result;
      },
    };
  }

  async function confirmViaProductionComposition(file, { executorResult = PASS, env = UPLOAD_ENV, storage, extra = {} } = {}) {
    return runtimeService.confirmUpload(
      { organizationId: file.organizationId, intakeFileId: file.intakeFileId, actorContext: ACTOR, now: CONFIRM_NOW },
      {
        env,
        storageAdapter: storage.adapter,
        internalSecurityAssessmentExecutor: syntheticExecutor(executorResult),
        ...extra,
      },
    );
  }

  async function filePolicy(intakeFileId) {
    const { rows } = await query(
      "SELECT upload_state, file_policy_status FROM kai.intake_files WHERE intake_file_id = $1::uuid",
      [intakeFileId],
    );
    return rows[0];
  }

  async function policyAuditCount(intakeFileId) {
    const { rows } = await query(
      `SELECT count(*)::int AS count FROM kai.audit_events
        WHERE action = 'apply_security_assessment_policy_decision' AND metadata->>'object_id' = $1`,
      [intakeFileId],
    );
    return rows[0].count;
  }

  // The production composition with no GCS providers built from the ambient
  // environment: only the Postgres lifecycle repository on the app pool.
  const restoreRuntime = runtimeService.setKaiIntakeRuntimeDependenciesForTest(Object.freeze({
    env: UPLOAD_ENV,
    uploadLifecycleRepository: createPostgresUploadLifecycleRepository(),
  }));
  test.after(() => restoreRuntime());

  test("9. production composition: a fresh confirmation whose policy commits passed runs P1 through P1-05 via the process-wide dispatcher, without cron; a replay adds nothing", async () => {
    await resetTables();
    const storage = createSyntheticStorage();
    const bytes = csvBytesFor(300);
    const file = await seedUploadedUnconfirmed({ index: 300, bytes });
    storage.put(file.objectVersionId, bytes);
    const dispatcher = getKaiP1FileDispatcher();
    const before = dispatcher.stats();

    const confirmed = await confirmViaProductionComposition(file, { storage });

    // Observed in the same turn the confirmation resolved: the decision is
    // committed and the job is scheduled, but P1 has not started.
    assert.equal(confirmed.ok, true);
    assert.deepEqual(
      Object.keys(confirmed.data).sort(),
      ["intake_batch_id", "intake_file_id", "object_version_id", "organization_id", "replayed", "upload_state", "verified_size_bytes"].sort(),
    );
    assert.equal(confirmed.data.upload_state, "confirmed");
    const atReturn = dispatcher.stats();
    assert.equal(atReturn.scheduled, before.scheduled + 1);
    assert.equal(atReturn.started, before.started, "confirmation returned before P1 started");
    assert.deepEqual(await filePolicy(file.intakeFileId), { upload_state: "confirmed", file_policy_status: "passed" });
    assert.equal(await policyAuditCount(file.intakeFileId), 1);

    const waitStart = performance.now();
    await dispatcher.whenIdle();
    const confirmReturnToP105Ms = performance.now() - waitStart;

    const runs = await parserRun(file.intakeFileId);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].parser_status, "completed");
    assert.equal(runs[0].checksum, file.checksum);
    const after = await counts(file.intakeFileId);
    assert.equal(after.fileProfiles, 1);
    assert.equal(after.dictionaries, 1);
    assert.equal(after.sensitivityProfiles, 1);
    assert.deepEqual(storage.p1Reads, [file.objectVersionId]);
    assert.equal(dispatcher.stats().started, before.started + 1);
    console.log(`P1_DISPATCH_TIMING production_composition confirm_return_to_p1_05_complete_ms=${confirmReturnToP105Ms.toFixed(1)}`);

    // Replay of an already-passed confirmation: no new dispatch, no new work.
    const replay = await confirmViaProductionComposition(file, { storage });
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);
    await dispatcher.whenIdle();
    assert.equal(dispatcher.stats().scheduled, before.scheduled + 1);
    assert.deepEqual(await counts(file.intakeFileId), after);
    assert.equal(await policyAuditCount(file.intakeFileId), 1);
    assert.deepEqual(storage.p1Reads, [file.objectVersionId]);
  });

  test("10. against real PostgreSQL, blocked, failed-policy, pending, rolled-back, and conflicting decisions dispatch nothing", async () => {
    await resetTables();
    const storage = createSyntheticStorage();
    const dispatcher = getKaiP1FileDispatcher();
    const before = dispatcher.stats();
    const failedCategory = [...POLICY_ELIGIBLE_FAILED_CATEGORIES][0];
    assert.ok(failedCategory, "an eligible failed category exists");

    const cases = [
      { index: 310, executorResult: { policy: "block", category: "malware_failed" }, expected: "blocked" },
      { index: 311, executorResult: { status: "failed", category: failedCategory }, expected: "failed" },
      { index: 312, executorResult: { status: "failed", category: "malware_scan_not_configured" }, expected: "pending" },
      // Required audit rejected: the policy transaction rolls back.
      {
        index: 313,
        executorResult: PASS,
        expected: "pending",
        extra: { insertRequiredSuccessfulAuditEvent: async () => ({ ok: false }) },
      },
    ];
    for (const entry of cases) {
      const bytes = csvBytesFor(entry.index);
      const file = await seedUploadedUnconfirmed({ index: entry.index, bytes });
      storage.put(file.objectVersionId, bytes);
      const result = await confirmViaProductionComposition(file, { storage, executorResult: entry.executorResult, extra: entry.extra });
      assert.equal(result.ok, true, `confirmation itself succeeds (${entry.expected})`);
      assert.deepEqual(await filePolicy(file.intakeFileId), { upload_state: "confirmed", file_policy_status: entry.expected });
    }

    // A CAS conflict: another writer already moved the file to passed, but
    // this attempt observed it as pending. The real CAS updates no row.
    const conflictBytes = csvBytesFor(314);
    const conflict = await seedUploadedUnconfirmed({ index: 314, bytes: conflictBytes });
    storage.put(conflict.objectVersionId, conflictBytes);
    await confirmViaProductionComposition(conflict, { storage, env: { ...UPLOAD_ENV, KAI_WORKER_ENABLED: "false" } });
    assert.equal((await filePolicy(conflict.intakeFileId)).file_policy_status, "passed");
    const conflictDispatcher = createKaiP1FileDispatcher({ processFile: async () => assert.fail("must not run"), log: () => {} });
    await applyConfirmedSecurityAssessment(
      {
        organizationId: ORG,
        intakeFileId: conflict.intakeFileId,
        objectVersionId: conflict.objectVersionId,
        verifiedChecksum: conflict.checksum,
        verifiedSizeBytes: conflict.size,
        requestId: "request_conflict",
        actorContext: ACTOR,
      },
      {
        env: UPLOAD_ENV,
        storageAdapter: storage.adapter,
        internalSecurityAssessmentExecutor: syntheticExecutor(PASS),
        kaiP1FileDispatcher: conflictDispatcher,
        async getScopedIntakeFileSecurityAssessmentFacts(identity) {
          return { ...(await getScopedIntakeFileSecurityAssessmentFacts(identity)), file_policy_status: "pending" };
        },
      },
    );
    assert.equal(conflictDispatcher.stats().scheduled, 0);
    assert.equal(await policyAuditCount(conflict.intakeFileId), 1, "the losing attempt wrote no audit");

    await dispatcher.whenIdle();
    const after = dispatcher.stats();
    assert.equal(after.scheduled, before.scheduled);
    assert.equal(after.disabled, before.disabled + 1, "only the gated-off pass reached the dispatcher");
    const { rows } = await query("SELECT count(*)::int AS count FROM kai.intake_parser_runs");
    assert.equal(rows[0].count, 0);
  });

  test("11. with the worker gate off, a passed decision still commits but runs no P1 work, and the file stays visible to the scheduled sweep", async () => {
    await resetTables();
    const storage = createSyntheticStorage();
    const bytes = csvBytesFor(320);
    const file = await seedUploadedUnconfirmed({ index: 320, bytes });
    storage.put(file.objectVersionId, bytes);
    const dispatcher = getKaiP1FileDispatcher();
    const before = dispatcher.stats();

    for (const env of [{ ...UPLOAD_ENV, KAI_WORKER_ENABLED: "false" }]) {
      const result = await confirmViaProductionComposition(file, { storage, env });
      assert.equal(result.ok, true);
    }
    await dispatcher.whenIdle();
    assert.equal((await filePolicy(file.intakeFileId)).file_policy_status, "passed");
    assert.equal(dispatcher.stats().scheduled, before.scheduled);
    assert.equal(dispatcher.stats().disabled, before.disabled + 1);
    assert.equal((await counts(file.intakeFileId)).parserRuns, 0);
    assert.deepEqual(storage.p1Reads, []);
    assert.deepEqual((await listActionableKaiP1WorkCandidates(poolA)).map((row) => row.intake_file_id), [file.intakeFileId]);
  });

  test("12. measured: committed passed decision -> file-scoped P1 start, and -> P1-05 completion", async () => {
    await resetTables();
    const storage = createSyntheticStorage();
    const samples = [];
    for (let index = 0; index < 5; index += 1) {
      const bytes = csvBytesFor(330 + index);
      const file = await seedUploadedUnconfirmed({ index: 330 + index, bytes });
      storage.put(file.objectVersionId, bytes);

      let committedAt = null;
      let startedAt = null;
      const dispatcher = createKaiP1FileDispatcher({
        processFile: (input, dependencies) => {
          startedAt = performance.now();
          return processKaiP1IntakeFile(input, dependencies);
        },
        log: () => {},
      });
      const result = await confirmViaProductionComposition(file, {
        storage,
        extra: {
          kaiP1FileDispatcher: dispatcher,
          // The real transaction on the app pool, timestamped once COMMIT resolved.
          runInTransaction: (callback) => withTransaction(callback).then((value) => {
            committedAt = performance.now();
            return value;
          }),
        },
      });
      assert.equal(result.ok, true);
      assert.equal(startedAt, null, "P1 had not started when confirmation returned");
      await dispatcher.whenIdle();
      const completedAt = performance.now();
      assert.ok(committedAt !== null && startedAt !== null && startedAt >= committedAt);
      assert.equal((await counts(file.intakeFileId)).sensitivityProfiles, 1);
      samples.push({ startMs: startedAt - committedAt, completeMs: completedAt - committedAt });
    }
    const max = (key) => Math.max(...samples.map((sample) => sample[key]));
    const median = (key) => [...samples.map((sample) => sample[key])].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
    console.log(
      `P1_DISPATCH_TIMING samples=${samples.length} commit_to_p1_start_ms median=${median("startMs").toFixed(2)} max=${max("startMs").toFixed(2)} `
      + `commit_to_p1_05_complete_ms median=${median("completeMs").toFixed(1)} max=${max("completeMs").toFixed(1)}`,
    );
    assert.ok(max("startMs") < 1000, "dispatch starts well inside one second of the committed decision");
  });

  /** A dispatcher standing in for one application instance, bound to its own pool. */
  function instanceDispatcher(pool, byteSource, { overrides = {}, maxConcurrent, maxWaiting, onStart, lines } = {}) {
    return createKaiP1FileDispatcher({
      processFile: async (input, dependencies) => {
        onStart?.(input);
        try {
          return await processKaiP1IntakeFile(input, { ...instanceDependencies(pool, byteSource, overrides), env: dependencies.env });
        } finally {
          onStart?.(null);
        }
      },
      ...(maxConcurrent ? { maxConcurrent } : {}),
      ...(maxWaiting !== undefined ? { maxWaiting } : {}),
      log: (line) => lines?.push(line),
    });
  }

  function expectedFor(file) {
    return { objectVersionId: file.objectVersionId, verifiedChecksum: file.checksum, verifiedSizeBytes: file.size };
  }

  test("13. competing notifications from two instances plus a concurrent scheduled sweep never duplicate parser, dictionary, or sensitivity records", async () => {
    await resetTables();
    const bytes = csvBytesFor(340);
    const file = await seedFile({ intakeFileId: fileId(340), bytes });
    const byteSource = createByteSource({ delayMs: 100 });
    byteSource.register(file.objectVersionId, bytes);

    const instanceA = instanceDispatcher(poolA, byteSource);
    const instanceB = instanceDispatcher(poolB, byteSource);
    const notification = { organizationId: ORG, intakeFileId: file.intakeFileId, expectedFileFacts: expectedFor(file) };
    assert.equal(instanceA.dispatch(notification, { env: ENABLED_ENV }).scheduled, true);
    assert.equal(instanceB.dispatch(notification, { env: ENABLED_ENV }).scheduled, true);
    assert.equal(instanceA.dispatch(notification, { env: ENABLED_ENV }).reason, "already_dispatched");
    const sweep = runKaiP1WorkerTick(instanceDependencies(poolB, byteSource));
    await Promise.all([instanceA.whenIdle(), instanceB.whenIdle(), sweep]);

    assert.equal(byteSource.reads.length, 1, "parsed exactly once");
    const after = await counts(file.intakeFileId);
    assert.equal(after.parserRuns, 1);
    assert.equal(after.fileProfiles, 1);
    assert.equal(after.dictionaries, 1);
    assert.equal(after.sensitivityProfiles, 1);
    assert.equal(after.lifecycleAudit.data_dictionary_draft_persisted, 1);
    assert.equal(after.lifecycleAudit.intake_sensitivity_profile_persisted, 1);
  });

  test("14. a stale expectation fails closed before parsing, and a P1-04 failure is attempted exactly once with no re-dispatch", async () => {
    await resetTables();
    const byteSource = createByteSource();

    const staleBytes = csvBytesFor(350);
    const staleFile = await seedFile({ intakeFileId: fileId(350), bytes: staleBytes });
    byteSource.register(staleFile.objectVersionId, staleBytes);
    const staleLines = [];
    const staleDispatcher = instanceDispatcher(poolA, byteSource, { lines: staleLines });
    staleDispatcher.dispatch(
      { organizationId: ORG, intakeFileId: staleFile.intakeFileId, expectedFileFacts: { ...expectedFor(staleFile), verifiedChecksum: sha256(Buffer.from("superseded")) } },
      { env: ENABLED_ENV },
    );
    await staleDispatcher.whenIdle();
    assert.deepEqual(staleLines, ["[kai-p1-dispatch] outcome=stopped stage=parser_profile_activation code=conflict_current_state_changed"]);
    assert.equal((await counts(staleFile.intakeFileId)).parserRuns, 0);
    assert.deepEqual(byteSource.reads, []);

    const failingBytes = csvBytesFor(351);
    const failingFile = await seedFile({ intakeFileId: fileId(351), bytes: failingBytes });
    byteSource.register(failingFile.objectVersionId, failingBytes);
    let dictionaryAttempts = 0;
    const lines = [];
    const dispatcher = instanceDispatcher(poolA, byteSource, {
      lines,
      overrides: {
        createProductionMetadataOnlyAudit: rejectingDownstreamAudit,
        createDraftDataDictionary: async (input, dependencies) => {
          dictionaryAttempts += 1;
          const { createDraftDataDictionary } = await import("../Backend/kai/services/kaiDataDictionaryService.js");
          return createDraftDataDictionary(input, dependencies);
        },
      },
    });
    dispatcher.dispatch({ organizationId: ORG, intakeFileId: failingFile.intakeFileId, expectedFileFacts: expectedFor(failingFile) }, { env: ENABLED_ENV });
    await dispatcher.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.equal(dictionaryAttempts, 1, "no recursive or immediate repeat");
    assert.deepEqual(lines, ["[kai-p1-dispatch] outcome=stopped stage=draft_data_dictionary code=validation_blocker"]);
    assert.deepEqual(dispatcher.stats(), {
      running: 0, waiting: 0, scheduled: 1, coalesced: 0, saturated: 0, disabled: 0, invalid: 0, started: 1, settled: 1,
    });
    assert.deepEqual(
      (await parserRun(failingFile.intakeFileId)).map(({ parser_status: status, retry_count: retries }) => ({ status, retries })),
      [{ status: "completed", retries: 0 }],
    );
    assert.equal((await counts(failingFile.intakeFileId)).dictionaries, 0);
    // Inherited Package 1 behaviour: the scheduled sweep will select it again.
    assert.equal(
      (await listActionableKaiP1WorkCandidates(poolA)).some((row) => row.intake_file_id === failingFile.intakeFileId),
      true,
    );
  });

  test("15. a burst of distinct confirmed files is processed with bounded concurrency; overflow is left for the scheduled sweep", async () => {
    await resetTables();
    const byteSource = createByteSource({ delayMs: 60 });
    const files = [];
    for (let index = 0; index < 6; index += 1) {
      const bytes = csvBytesFor(360 + index);
      const file = await seedFile({ intakeFileId: fileId(360 + index), bytes });
      byteSource.register(file.objectVersionId, bytes);
      files.push(file);
    }

    let running = 0;
    let peak = 0;
    const dispatcher = instanceDispatcher(poolA, byteSource, {
      maxConcurrent: 2,
      maxWaiting: 5,
      onStart: (input) => {
        running += input ? 1 : -1;
        peak = Math.max(peak, running);
      },
    });
    const outcomes = files.map((file) =>
      dispatcher.dispatch({ organizationId: ORG, intakeFileId: file.intakeFileId, expectedFileFacts: expectedFor(file) }, { env: ENABLED_ENV }));
    assert.deepEqual(outcomes.map((outcome) => outcome.reason), [null, null, null, null, null, "dispatcher_saturated"]);
    await dispatcher.whenIdle();

    assert.equal(peak, 2);
    for (const file of files.slice(0, 5)) {
      assert.equal((await counts(file.intakeFileId)).sensitivityProfiles, 1);
    }
    const overflow = files[5];
    assert.equal((await counts(overflow.intakeFileId)).parserRuns, 0);
    assert.deepEqual(
      (await listActionableKaiP1WorkCandidates(poolA)).map((row) => row.intake_file_id),
      [overflow.intakeFileId],
      "the refused file stays persisted and visible to the scheduled sweep",
    );
  });

  test("16. P1-06 and later stay unreachable: dispatched work writes nothing beyond P1-03/P1-04/P1-05 and their audits", async () => {
    await resetTables();
    const storage = createSyntheticStorage();
    const bytes = csvBytesFor(370);
    const file = await seedUploadedUnconfirmed({ index: 370, bytes });
    storage.put(file.objectVersionId, bytes);
    await confirmViaProductionComposition(file, { storage });
    await getKaiP1FileDispatcher().whenIdle();
    assert.equal((await counts(file.intakeFileId)).sensitivityProfiles, 1);

    const { rows } = await query(
      `SELECT DISTINCT action FROM kai.audit_events WHERE metadata->>'intake_file_id' = $1 OR metadata->>'object_id' = $1 ORDER BY action`,
      [file.intakeFileId],
    );
    const actions = rows.map((row) => row.action);
    assert.ok(actions.includes("apply_security_assessment_policy_decision"));
    for (const action of actions) {
      assert.doesNotMatch(action, /review_queue|source_candidate|source_promotion|evidence|claim_|generat|export/i, action);
    }
    const tables = await query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'kai' AND table_name ~ '(review_queue|source_candidate|evidence|claim)'`,
    );
    assert.deepEqual(tables.rows, [], "no P1-06+ substrate exists in this synthetic database to be written to");
  });
}
