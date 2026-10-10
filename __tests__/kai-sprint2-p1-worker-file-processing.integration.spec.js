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
  const { processKaiP1IntakeFile, runKaiP1WorkerTick } = await import("../Backend/kai/parsing/p1WorkerRuntime.js");
  const { createProductionMetadataOnlyAudit } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");

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
      "TRUNCATE kai.intake_p1_downstream_attempts, kai.audit_events, kai.upload_lifecycle_audit, kai.upload_policy_decision_replay, " +
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

  /**
   * One "instance": every transaction and read bound to its own pool, and
   * otherwise the production default composition - the eligibility-guarded
   * P1-03/P1-04/P1-05 repositories and the downstream recovery repository
   * are all built by the runtime itself around that callback-only
   * `runInTransaction`.
   */
  function instanceDependencies(pool, byteSource, overrides = {}) {
    return {
      env: ENABLED_ENV,
      now: () => NOW,
      runInTransaction: (callback) => withTransaction(callback, pool),
      getScopedIntakeFileParserProfileEligibilityFacts: (identity) =>
        getScopedIntakeFileParserProfileEligibilityFacts(identity, pool),
      listActionableKaiP1WorkCandidates: (options) => listActionableKaiP1WorkCandidates(pool, options),
      objectVersionByteSource: byteSource.dependency,
      ...overrides,
    };
  }

  function at(offsetSeconds) {
    return new Date(Date.parse(NOW) + offsetSeconds * 1000).toISOString();
  }

  /**
   * The real production audit composition, except that the P1-04 stage's
   * own required audit is rejected - a deterministic, non-retryable P1-04
   * failure whose transaction rolls back completely, while the recovery
   * bookkeeping audits still commit.
   */
  function rejectingStageAudit(options) {
    const real = createProductionMetadataOnlyAudit(options);
    return {
      prepareMetadataOnlyAudit(input) {
        if (input?.payload?.attempted_operation === "data_dictionary_draft_persisted") return { ok: false };
        return real.prepareMetadataOnlyAudit(input);
      },
    };
  }

  const transientStageFailure = async () => ({ ok: false, data: null, error: { code: "system_error" } });

  async function recoveryRows(intakeFileId) {
    const { rows } = await query(
      `SELECT stage, recovery_state, attempt_count, last_error_code,
              next_eligible_at, claim_token::text AS claim_token, claim_expires_at
         FROM kai.intake_p1_downstream_attempts
        WHERE intake_file_id = $1::uuid
        ORDER BY stage`,
      [intakeFileId],
    );
    return rows.map((row) => ({
      ...row,
      next_eligible_at: row.next_eligible_at ? row.next_eligible_at.toISOString() : null,
      claim_expires_at: row.claim_expires_at ? row.claim_expires_at.toISOString() : null,
    }));
  }

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
      recoveryRows: await scalar("SELECT count(*) FROM kai.intake_p1_downstream_attempts WHERE intake_file_id = $1::uuid"),
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
    assert.deepEqual(await listActionableKaiP1WorkCandidates(poolA, { now: NOW }), []);
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
      recoveryRows: 0,
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
      (await listActionableKaiP1WorkCandidates(poolA, { now: NOW })).map((row) => row.intake_file_id),
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
      if (result.data.stoppedAt === "parser_profile_activation") {
        assert.equal(result.data.result.error.code, "conflict_current_state_changed");
      } else {
        // Arrived after P1-03 completed, while another instance held the
        // PostgreSQL downstream claim.
        assert.equal(result.data.recovery.at(-1).decision, "busy");
      }
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

    // P1-04 recovery: P1-03 completed, P1-04 failed transiently (retry scheduled).
    const dictionaryBytes = csvBytesFor(80);
    const dictionaryFile = await seedFile({ intakeFileId: fileId(80), bytes: dictionaryBytes });
    byteSource.register(dictionaryFile.objectVersionId, dictionaryBytes);
    const first = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: dictionaryFile.intakeFileId },
      instanceDependencies(poolA, byteSource, { createDraftDataDictionary: transientStageFailure }),
    );
    assert.equal(first.data.stoppedAt, "draft_data_dictionary");
    assert.equal(first.data.recovery[0].decision, "retry_scheduled");
    assert.equal((await counts(dictionaryFile.intakeFileId)).dictionaries, 0);

    // P1-05 recovery: P1-03 and P1-04 completed, P1-05 failed transiently.
    const sensitivityBytes = csvBytesFor(81);
    const sensitivityFile = await seedFile({ intakeFileId: fileId(81), bytes: sensitivityBytes });
    byteSource.register(sensitivityFile.objectVersionId, sensitivityBytes);
    const partial = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: sensitivityFile.intakeFileId },
      instanceDependencies(poolA, byteSource, { persistIntakeSensitivityProfile: transientStageFailure }),
    );
    assert.equal(partial.data.stoppedAt, "persist_intake_sensitivity_profile");
    assert.equal(partial.data.recovery[1].decision, "retry_scheduled");
    const partialDictionaryId = partial.data.dataDictionary.data.dictionary.data_dictionary_id;

    assert.equal(byteSource.reads.length, 2);
    const readsBeforeReplay = byteSource.reads.length;
    const afterCooldown = { now: () => at(61) };

    for (const [file, stage] of [[dictionaryFile, "p1_04_data_dictionary"], [sensitivityFile, "p1_05_sensitivity_profile"]]) {
      const replays = await Promise.all([poolA, poolB, poolA, poolB, poolA, poolB].map((pool) =>
        processKaiP1IntakeFile({ organizationId: ORG, intakeFileId: file.intakeFileId }, instanceDependencies(pool, byteSource, afterCooldown))));

      assert.ok(replays.every((result) => result.ok === true));
      for (const result of replays) {
        assert.equal(result.data.result.data.activated, false, "a completed run is replayed, never re-claimed");
        assert.equal(result.data.result.data.run.replayed, true);
      }
      const completed = replays.filter((result) => result.data.stoppedAt === undefined);
      assert.ok(completed.length >= 1);
      for (const result of replays.filter((entry) => entry.data.stoppedAt !== undefined)) {
        assert.equal(result.data.recovery.at(-1).decision, "busy", "a concurrent replay never runs a claimed stage twice");
      }
      const dictionaryIds = new Set(completed.map((result) => result.data.dataDictionary.data.dictionary.data_dictionary_id));
      const sensitivityIds = new Set(completed.map((result) =>
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
      const retried = (await recoveryRows(file.intakeFileId)).find((row) => row.stage === stage);
      assert.equal(retried.recovery_state, "succeeded");
      assert.equal(retried.attempt_count, 2, "one failed attempt plus exactly one successful retry");

      // A further concurrent replay round reconciles committed outputs and changes nothing.
      const again = await Promise.all([poolA, poolB].map((pool) =>
        processKaiP1IntakeFile({ organizationId: ORG, intakeFileId: file.intakeFileId }, instanceDependencies(pool, byteSource, afterCooldown))));
      assert.ok(again.every((result) => result.data.stoppedAt === undefined));
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
      (await listActionableKaiP1WorkCandidates(poolA, { now: NOW })).some((row) => row.intake_file_id === failedFile.intakeFileId),
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
      createProductionMetadataOnlyAudit: rejectingStageAudit,
    });
    const firstTick = await runKaiP1WorkerTick(persistentlyFailing);
    const entry = firstTick.data.activated.find((item) => item.intakeFileId === downstreamFile.intakeFileId);
    assert.equal(entry.stoppedAt, "draft_data_dictionary");
    assert.equal(entry.dataDictionary.error.code, "validation_blocker");
    assert.deepEqual(entry.recovery, [{ stage: "p1_04_data_dictionary", decision: "operator_attention", code: "validation_blocker", attempt: 1 }]);
    // A non-retryable failure is excluded from automatic selection at once.
    const laterTick = await runKaiP1WorkerTick({ ...persistentlyFailing, now: () => at(24 * 3600) });
    assert.equal(laterTick.data.activated.some((item) => item.intakeFileId === downstreamFile.intakeFileId), false);
    assert.equal(byteSource.reads.length, 1, "the downstream failure never re-profiled the completed run");
    assert.deepEqual(
      (await parserRun(downstreamFile.intakeFileId)).map(({ parser_status: status, retry_count: retries, error_code: code }) => ({ status, retries, code })),
      [{ status: "completed", retries: 0, code: null }],
    );
    const afterFailures = await counts(downstreamFile.intakeFileId);
    assert.equal(afterFailures.dictionaries, 0);
    assert.equal(afterFailures.lifecycleAudit.data_dictionary_draft_persisted, undefined);
    assert.deepEqual(
      (await recoveryRows(downstreamFile.intakeFileId)).map(({ stage, recovery_state: state, attempt_count: attempts, last_error_code: code }) => ({ stage, state, attempts, code })),
      [{ stage: "p1_04_data_dictionary", state: "operator_attention", attempts: 1, code: "validation_blocker" }],
    );
    assert.equal(
      (await listActionableKaiP1WorkCandidates(poolA, { now: at(24 * 3600) })).some((row) => row.intake_file_id === downstreamFile.intakeFileId),
      false,
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
    assert.equal((await listActionableKaiP1WorkCandidates(poolA, { now: NOW })).length, 25);
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
    assert.deepEqual((await listActionableKaiP1WorkCandidates(poolA, { now: NOW })).map((row) => row.intake_file_id), [file.intakeFileId]);
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
        createProductionMetadataOnlyAudit: rejectingStageAudit,
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
    assert.deepEqual(lines, ["[kai-p1-dispatch] outcome=operator_attention stage=draft_data_dictionary code=validation_blocker"]);
    assert.deepEqual(dispatcher.stats(), {
      running: 0, waiting: 0, scheduled: 1, coalesced: 0, saturated: 0, disabled: 0, invalid: 0, started: 1, settled: 1,
    });
    assert.deepEqual(
      (await parserRun(failingFile.intakeFileId)).map(({ parser_status: status, retry_count: retries }) => ({ status, retries })),
      [{ status: "completed", retries: 0 }],
    );
    assert.equal((await counts(failingFile.intakeFileId)).dictionaries, 0);
    // Recorded for operator attention: the scheduled sweep never selects it again.
    assert.equal(
      (await listActionableKaiP1WorkCandidates(poolA, { now: at(24 * 3600) })).some((row) => row.intake_file_id === failingFile.intakeFileId),
      false,
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
      (await listActionableKaiP1WorkCandidates(poolA, { now: NOW })).map((row) => row.intake_file_id),
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

  // ---------------------------------------------------------------------
  // Package 3: durable, bounded P1 recovery and the one-minute fallback.
  // Clocks are controlled through `now`; crashes are real child processes
  // killed with SIGKILL (their connections and memory die with them).
  // ---------------------------------------------------------------------
  const { spawnSync } = await import("node:child_process");
  const { createDraftDataDictionary: realCreateDraftDataDictionary } = await import("../Backend/kai/services/kaiDataDictionaryService.js");
  const { persistIntakeSensitivityProfile: realPersistIntakeSensitivityProfile } = await import(
    "../Backend/kai/services/kaiIntakeSensitivityProfileService.js"
  );
  const { createPostgresP1DownstreamRecoveryRepository } = await import(
    "../Backend/kai/parsing/postgresP1DownstreamRecoveryRepository.js"
  );
  const { getKaiP1RecoveryStatus } = await import("../Backend/kai/services/kaiP1RecoveryStatusService.js");
  const { registerKaiP1WorkerCron } = await import("../Backend/kai/parsing/p1WorkerCron.js");

  const PARSER_LEASE_SECONDS = 15 * 60;

  function tickAt(pool, byteSource, offsetSeconds, overrides = {}) {
    return runKaiP1WorkerTick(instanceDependencies(pool, byteSource, { now: () => at(offsetSeconds), ...overrides }));
  }

  function activatedIds(tick) {
    return tick.data.activated.map((entry) => entry.intakeFileId);
  }

  /** Wraps a real stage, recording calls and failing the first `failTimes` calls per profile. */
  function countingStage(realStage, { failWith, failTimes = Infinity } = {}) {
    const calls = [];
    const stage = async (input, dependencies) => {
      calls.push(input);
      const priorCalls = calls.filter((call) => call.fileProfileId === input.fileProfileId).length - 1;
      if (failWith && priorCalls < failTimes) return failWith();
      return realStage(input, dependencies);
    };
    stage.calls = calls;
    return stage;
  }

  async function profileIdFor(intakeFileId) {
    const { rows } = await query(
      "SELECT output_profile_id::text AS id FROM kai.intake_parser_runs WHERE intake_file_id = $1::uuid AND parser_status = 'completed'",
      [intakeFileId],
    );
    return rows[0]?.id ?? null;
  }

  async function auditActionCount(action) {
    const { rows } = await query("SELECT count(*)::int AS count FROM kai.audit_events WHERE action = $1", [action]);
    return rows[0].count;
  }

  function runCrashChild({ mode, file, bytes, offsetSeconds = 0 }) {
    const child = spawnSync(process.execPath, [
      new URL("./support/kaiP1WorkerCrashChild.js", import.meta.url).pathname,
      JSON.stringify({
        mode,
        databaseUrl: DATABASE_URL,
        organizationId: file.organizationId,
        intakeFileId: file.intakeFileId,
        now: at(offsetSeconds),
        bytesBase64: Buffer.from(bytes).toString("base64"),
      }),
    ], { encoding: "utf8", env: process.env, timeout: 60_000 });
    assert.equal(child.signal, "SIGKILL", `child must die at ${mode} (status=${child.status})`);
  }

  function systemAudit(file) {
    return createProductionMetadataOnlyAudit({
      organizationId: file.organizationId,
      intakeFileId: file.intakeFileId,
      actorContext: { actorType: "system", actorUserId: null },
      now: NOW,
    });
  }

  test("P3-2/3. a passed file whose immediate dispatch was lost or refused is recovered by the next scheduled sweep without a repeated confirmation", async () => {
    await resetTables();
    const storage = createSyntheticStorage();
    const files = [];
    for (const index of [400, 401]) {
      const bytes = csvBytesFor(index);
      const file = await seedUploadedUnconfirmed({ index, bytes });
      storage.put(file.objectVersionId, bytes);
      files.push(file);
    }
    const [lostFile, refusedFile] = files;

    // Accepted, then lost with its process: the in-memory job never runs.
    let lostDispatches = 0;
    const lostDispatcher = { dispatch: () => { lostDispatches += 1; return { scheduled: true, reason: null }; } };
    const refusingDispatcher = createKaiP1FileDispatcher({ maxWaiting: 0, processFile: async () => assert.fail("must not run"), log: () => {} });
    assert.equal((await confirmViaProductionComposition(lostFile, { storage, extra: { kaiP1FileDispatcher: lostDispatcher } })).ok, true);
    assert.equal((await confirmViaProductionComposition(refusedFile, { storage, extra: { kaiP1FileDispatcher: refusingDispatcher } })).ok, true);
    assert.equal(lostDispatches, 1);
    assert.equal(refusingDispatcher.stats().saturated, 1);
    for (const file of files) {
      assert.equal((await filePolicy(file.intakeFileId)).file_policy_status, "passed");
      assert.equal((await counts(file.intakeFileId)).parserRuns, 0);
    }

    const tick = await tickAt(poolA, { dependency: storage.adapter }, 120);
    assert.deepEqual(activatedIds(tick).sort(), files.map((file) => file.intakeFileId).sort());
    for (const file of files) {
      assert.equal((await counts(file.intakeFileId)).sensitivityProfiles, 1);
      assert.equal(await policyAuditCount(file.intakeFileId), 1, "the confirmation was never repeated");
    }
  });

  test("P3-5. a transient P1-04 failure observes its 1- then 5-minute cooldowns and completes on its third and last attempt without re-profiling", async () => {
    await resetTables();
    const bytes = csvBytesFor(410);
    const file = await seedFile({ intakeFileId: fileId(410), bytes });
    const byteSource = createByteSource();
    byteSource.register(file.objectVersionId, bytes);
    const dictionary = countingStage(realCreateDraftDataDictionary, { failWith: transientStageFailure, failTimes: 2 });
    const overrides = { createDraftDataDictionary: dictionary };

    const first = await tickAt(poolA, byteSource, 0, overrides);
    assert.deepEqual(first.data.activated[0].recovery, [{ stage: "p1_04_data_dictionary", decision: "retry_scheduled", code: "system_error", attempt: 1 }]);
    assert.equal((await recoveryRows(file.intakeFileId))[0].next_eligible_at, at(60));

    assert.deepEqual(activatedIds(await tickAt(poolA, byteSource, 30, overrides)), [], "cooling down: not selected");
    const early = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: file.intakeFileId },
      instanceDependencies(poolA, byteSource, { ...overrides, now: () => at(30) }),
    );
    assert.equal(early.data.recovery[0].decision, "deferred", "even a direct dispatch respects the cooldown");
    assert.equal(dictionary.calls.length, 1);

    const second = await tickAt(poolA, byteSource, 61, overrides);
    assert.equal(second.data.activated[0].recovery[0].decision, "retry_scheduled");
    assert.equal((await recoveryRows(file.intakeFileId))[0].next_eligible_at, at(361));
    assert.deepEqual(activatedIds(await tickAt(poolA, byteSource, 360, overrides)), []);

    const third = await tickAt(poolA, byteSource, 362, overrides);
    assert.equal(third.data.activated[0].stoppedAt, undefined);
    assert.equal(dictionary.calls.length, 3);
    assert.deepEqual(
      (await recoveryRows(file.intakeFileId)).map(({ stage, recovery_state: state, attempt_count: attempts }) => ({ stage, state, attempts })),
      [
        { stage: "p1_04_data_dictionary", state: "succeeded", attempts: 3 },
        { stage: "p1_05_sensitivity_profile", state: "succeeded", attempts: 1 },
      ],
    );
    assert.equal(byteSource.reads.length, 1, "P1-03 ran once; retries never re-profile");
    const settled = await counts(file.intakeFileId);
    assert.equal(settled.dictionaries, 1);
    assert.equal(settled.sensitivityProfiles, 1);
  });

  test("P3-6. a transient P1-05 failure retries independently without re-running P1-03 or P1-04", async () => {
    await resetTables();
    const bytes = csvBytesFor(420);
    const file = await seedFile({ intakeFileId: fileId(420), bytes });
    const byteSource = createByteSource();
    byteSource.register(file.objectVersionId, bytes);
    const dictionary = countingStage(realCreateDraftDataDictionary);
    const sensitivity = countingStage(realPersistIntakeSensitivityProfile, { failWith: transientStageFailure, failTimes: 1 });
    const overrides = { createDraftDataDictionary: dictionary, persistIntakeSensitivityProfile: sensitivity };

    const first = await tickAt(poolA, byteSource, 0, overrides);
    assert.equal(first.data.activated[0].stoppedAt, "persist_intake_sensitivity_profile");
    assert.deepEqual(activatedIds(await tickAt(poolA, byteSource, 59, overrides)), []);
    const second = await tickAt(poolA, byteSource, 61, overrides);
    assert.equal(second.data.activated[0].stoppedAt, undefined);
    assert.deepEqual(second.data.activated[0].recovery.map((record) => record.decision), ["already_succeeded", "succeeded"]);

    assert.equal(dictionary.calls.length, 1, "P1-04 was reconciled, not re-run");
    assert.equal(sensitivity.calls.length, 2);
    assert.equal(byteSource.reads.length, 1);
    assert.equal((await counts(file.intakeFileId)).sensitivityProfiles, 1);
  });

  test("P3-7. a persistent retryable failure exhausts its three attempts and is never selected or invoked again", async () => {
    await resetTables();
    const bytes = csvBytesFor(430);
    const file = await seedFile({ intakeFileId: fileId(430), bytes });
    const byteSource = createByteSource();
    byteSource.register(file.objectVersionId, bytes);
    const dictionary = countingStage(realCreateDraftDataDictionary, { failWith: transientStageFailure });
    const overrides = { createDraftDataDictionary: dictionary };

    for (const offset of [0, 61, 362]) await tickAt(poolA, byteSource, offset, overrides);
    assert.deepEqual(
      (await recoveryRows(file.intakeFileId)).map(({ recovery_state: state, attempt_count: attempts, last_error_code: code }) => ({ state, attempts, code })),
      [{ state: "exhausted", attempts: 3, code: "system_error" }],
    );
    assert.deepEqual(activatedIds(await tickAt(poolA, byteSource, 7 * 24 * 3600, overrides)), []);
    const direct = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: file.intakeFileId },
      instanceDependencies(poolA, byteSource, { ...overrides, now: () => at(7 * 24 * 3600) }),
    );
    assert.equal(direct.data.recovery[0].decision, "exhausted");
    assert.equal(dictionary.calls.length, 3, "never a fourth attempt");
    assert.equal(await auditActionCount("p1_04_data_dictionary_attempts_exhausted"), 1);
    assert.deepEqual(
      (await parserRun(file.intakeFileId)).map(({ parser_status: status, retry_count: retries }) => ({ status, retries })),
      [{ status: "completed", retries: 0 }],
      "the completed profile is preserved and never failed",
    );
  });

  test("P3-8. non-retryable, unrecognized, and thrown stage failures go straight to operator attention", async () => {
    await resetTables();
    const byteSource = createByteSource();
    const cases = [
      { index: 440, stage: async () => ({ ok: false, data: null, error: { code: "conflict_current_state_changed" } }), code: "conflict_current_state_changed" },
      { index: 441, stage: async () => ({ ok: false, data: null, error: { code: "some_future_code" } }), code: "unclassified_stage_failure" },
      { index: 442, stage: async () => { throw new Error("synthetic stage defect"); }, code: "unclassified_stage_exception" },
      { index: 443, stage: async () => ({ ok: true, data: { dictionary: {} }, error: null }), code: "unclassified_stage_failure" },
    ];
    for (const entry of cases) {
      const bytes = csvBytesFor(entry.index);
      const file = await seedFile({ intakeFileId: fileId(entry.index), bytes });
      byteSource.register(file.objectVersionId, bytes);
      const result = await processKaiP1IntakeFile(
        { organizationId: ORG, intakeFileId: file.intakeFileId },
        instanceDependencies(poolA, byteSource, { createDraftDataDictionary: entry.stage }),
      );
      assert.deepEqual(result.data.recovery, [{ stage: "p1_04_data_dictionary", decision: "operator_attention", code: entry.code, attempt: 1 }]);
    }
    assert.deepEqual(activatedIds(await tickAt(poolA, byteSource, 24 * 3600)), []);
  });

  test("P3-9. a rejected required audit never persists a false success; a lost acknowledgment is reconciled from the committed output", async () => {
    await resetTables();
    const byteSource = createByteSource();

    const stageBytes = csvBytesFor(450);
    const stageFile = await seedFile({ intakeFileId: fileId(450), bytes: stageBytes });
    byteSource.register(stageFile.objectVersionId, stageBytes);
    await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: stageFile.intakeFileId },
      instanceDependencies(poolA, byteSource, { createProductionMetadataOnlyAudit: rejectingStageAudit }),
    );
    assert.equal((await counts(stageFile.intakeFileId)).dictionaries, 0);
    assert.equal((await recoveryRows(stageFile.intakeFileId))[0].recovery_state, "operator_attention");

    const ackBytes = csvBytesFor(451);
    const ackFile = await seedFile({ intakeFileId: fileId(451), bytes: ackBytes });
    byteSource.register(ackFile.objectVersionId, ackBytes);
    const rejectingAcknowledgment = (options) => {
      const real = createProductionMetadataOnlyAudit(options);
      return {
        prepareMetadataOnlyAudit(input) {
          if (input?.payload?.attempted_operation === "p1_04_data_dictionary_attempt_succeeded") return { ok: false };
          return real.prepareMetadataOnlyAudit(input);
        },
      };
    };
    const lostAck = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: ackFile.intakeFileId },
      instanceDependencies(poolA, byteSource, {
        createProductionMetadataOnlyAudit: rejectingAcknowledgment,
        persistIntakeSensitivityProfile: transientStageFailure,
      }),
    );
    assert.equal(lostAck.data.recovery[0].decision, "unacknowledged");
    const pending = (await recoveryRows(ackFile.intakeFileId)).find((row) => row.stage === "p1_04_data_dictionary");
    assert.equal(pending.recovery_state, "in_progress", "the success was not recorded without its audit");
    assert.equal((await counts(ackFile.intakeFileId)).dictionaries, 1);

    const dictionary = countingStage(realCreateDraftDataDictionary);
    const recovered = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: ackFile.intakeFileId },
      instanceDependencies(poolA, byteSource, { now: () => at(400), createDraftDataDictionary: dictionary }),
    );
    assert.equal(recovered.data.stoppedAt, undefined);
    assert.equal(recovered.data.recovery[0].decision, "already_succeeded");
    assert.equal(dictionary.calls.length, 0);
    const reconciled = (await recoveryRows(ackFile.intakeFileId)).find((row) => row.stage === "p1_04_data_dictionary");
    assert.deepEqual([reconciled.recovery_state, reconciled.attempt_count], ["succeeded", 1]);
    assert.equal((await counts(ackFile.intakeFileId)).dictionaries, 1);
    assert.equal(await auditActionCount("p1_04_data_dictionary_output_reconciled"), 1);
  });

  test("P3-10. a process killed right after reserving a P1-04 attempt keeps that attempt counted; recovery waits out the lease", async () => {
    await resetTables();
    const bytes = csvBytesFor(460);
    const file = await seedFile({ intakeFileId: fileId(460), bytes });
    runCrashChild({ mode: "kill_after_downstream_reservation", file, bytes });

    const reserved = await recoveryRows(file.intakeFileId);
    assert.deepEqual([reserved[0].recovery_state, reserved[0].attempt_count], ["in_progress", 1]);
    assert.equal((await counts(file.intakeFileId)).dictionaries, 0);

    const byteSource = createByteSource();
    assert.deepEqual(activatedIds(await tickAt(poolA, byteSource, 100)), [], "the dead worker's claim is still leased");
    const recovered = await tickAt(poolA, byteSource, 121);
    assert.equal(recovered.data.activated[0].stoppedAt, undefined);
    const settled = await recoveryRows(file.intakeFileId);
    assert.deepEqual([settled[0].recovery_state, settled[0].attempt_count], ["succeeded", 2], "the crashed attempt was not forgotten");
    assert.equal(byteSource.reads.length, 0, "P1-03 was never re-run");
  });

  test("P3-11. a process killed after P1-04 committed but before acknowledging is reconciled with no second dictionary", async () => {
    await resetTables();
    const bytes = csvBytesFor(470);
    const file = await seedFile({ intakeFileId: fileId(470), bytes });
    runCrashChild({ mode: "kill_after_downstream_commit", file, bytes });

    assert.equal((await counts(file.intakeFileId)).dictionaries, 1);
    assert.equal((await recoveryRows(file.intakeFileId))[0].recovery_state, "in_progress");

    const byteSource = createByteSource();
    const dictionary = countingStage(realCreateDraftDataDictionary);
    const recovered = await tickAt(poolA, byteSource, 121, { createDraftDataDictionary: dictionary });
    assert.equal(recovered.data.activated[0].stoppedAt, undefined);
    assert.equal(recovered.data.activated[0].recovery[0].decision, "already_succeeded");
    assert.equal(dictionary.calls.length, 0);
    const settled = await counts(file.intakeFileId);
    assert.equal(settled.dictionaries, 1);
    assert.equal(settled.lifecycleAudit.data_dictionary_draft_persisted, 1);
    assert.equal(settled.sensitivityProfiles, 1);
    assert.deepEqual(
      (await recoveryRows(file.intakeFileId)).map(({ recovery_state: state, attempt_count: attempts }) => [state, attempts]),
      [["succeeded", 1], ["succeeded", 1]],
    );
  });

  test("P3-12/13. competing instances get one downstream claim; an expired claim is recovered and a stale owner can never overwrite newer state", async () => {
    await resetTables();
    const bytes = csvBytesFor(480);
    const file = await seedFile({ intakeFileId: fileId(480), bytes });
    const byteSource = createByteSource();
    byteSource.register(file.objectVersionId, bytes);
    await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: file.intakeFileId },
      instanceDependencies(poolA, byteSource, { createDraftDataDictionary: transientStageFailure }),
    );
    const identity = { organizationId: ORG, intakeFileId: file.intakeFileId, fileProfileId: await profileIdFor(file.intakeFileId), stage: "p1_04_data_dictionary" };
    const repositories = [poolA, poolB].map((pool) =>
      createPostgresP1DownstreamRecoveryRepository({ runInTransaction: (callback) => withTransaction(callback, pool) }));
    const audit = systemAudit(file);

    const claims = await Promise.all([0, 1, 0, 1, 0, 1, 0, 1].map((index) =>
      repositories[index].claimDownstreamAttempt({ identity, now: at(61), metadataOnlyAudit: audit })));
    const winners = claims.filter((claim) => claim.data.decision === "claimed");
    assert.equal(winners.length, 1);
    assert.ok(claims.filter((claim) => claim.data.decision !== "claimed").every((claim) => claim.data.decision === "busy"));
    const staleToken = winners[0].data.claimToken;
    assert.equal(winners[0].data.attemptNumber, 2);

    // The holder dies. After its 120-second lease, its attempt counts as a
    // failure; the 5-minute cooldown after attempt 2 still applies.
    const afterLease = await repositories[1].claimDownstreamAttempt({ identity, now: at(182), metadataOnlyAudit: audit });
    assert.equal(afterLease.data.decision, "deferred");
    assert.equal(afterLease.data.errorCode, "attempt_lease_expired");
    const staleAck = await repositories[0].completeDownstreamAttempt({
      identity, claimToken: staleToken, outcome: "succeeded", errorCode: null, now: at(183), metadataOnlyAudit: audit,
    });
    assert.deepEqual([staleAck.data.acknowledged, staleAck.data.reason], [false, "stale_claim"]);

    const fresh = await repositories[1].claimDownstreamAttempt({ identity, now: at(362), metadataOnlyAudit: audit });
    assert.deepEqual([fresh.data.decision, fresh.data.attemptNumber], ["claimed", 3]);
    const staleAgain = await repositories[0].completeDownstreamAttempt({
      identity, claimToken: staleToken, outcome: "non_retryable_failure", errorCode: "validation_blocker", now: at(363), metadataOnlyAudit: audit,
    });
    assert.equal(staleAgain.data.acknowledged, false, "the stale owner cannot overwrite the newer claim");
    const freshAck = await repositories[1].completeDownstreamAttempt({
      identity, claimToken: fresh.data.claimToken, outcome: "retryable_failure", errorCode: "system_error", now: at(364), metadataOnlyAudit: audit,
    });
    assert.deepEqual([freshAck.data.acknowledged, freshAck.data.recoveryState], [true, "exhausted"]);
    assert.equal((await counts(file.intakeFileId)).dictionaries, 0);
  });

  test("P3-14. twenty-five persistently failing older files cannot keep a newer eligible file out of the 25-file window", async () => {
    await resetTables();
    const byteSource = createByteSource();
    const failing = new Set();
    for (let index = 0; index < 25; index += 1) {
      const bytes = csvBytesFor(500 + index);
      const file = await seedFile({ intakeFileId: fileId(500 + index), bytes, createdAt: at(-3600 + index) });
      byteSource.register(file.objectVersionId, bytes);
      failing.add(file.intakeFileId);
    }
    const newerBytes = csvBytesFor(600);
    const newer = await seedFile({ intakeFileId: fileId(600), bytes: newerBytes, createdAt: at(0) });
    byteSource.register(newer.objectVersionId, newerBytes);

    const attemptsByFile = new Map();
    const dictionary = async (input, dependencies) => {
      const { rows } = await query("SELECT intake_file_id::text AS id FROM kai.intake_file_profiles WHERE file_profile_id = $1::uuid", [input.fileProfileId]);
      const intakeFileId = rows[0].id;
      attemptsByFile.set(intakeFileId, (attemptsByFile.get(intakeFileId) || 0) + 1);
      if (failing.has(intakeFileId)) return transientStageFailure();
      return realCreateDraftDataDictionary(input, dependencies);
    };
    const overrides = { createDraftDataDictionary: dictionary };

    const first = await tickAt(poolA, byteSource, 0, overrides);
    assert.equal(first.data.activated.length, 25);
    assert.equal(activatedIds(first).includes(newer.intakeFileId), false, "the window is full of older failing files");

    const second = await tickAt(poolA, byteSource, 10, overrides);
    assert.deepEqual(activatedIds(second), [newer.intakeFileId], "older files cooling down leave the window to newer work");
    assert.equal(second.data.activated[0].stoppedAt, undefined);

    await tickAt(poolA, byteSource, 61, overrides);
    await tickAt(poolA, byteSource, 362, overrides);
    assert.deepEqual(activatedIds(await tickAt(poolA, byteSource, 30 * 24 * 3600, overrides)), [], "exhausted files never return");
    for (const intakeFileId of failing) {
      assert.equal(attemptsByFile.get(intakeFileId), 3);
      assert.equal((await recoveryRows(intakeFileId))[0].recovery_state, "exhausted");
    }
    assert.equal(attemptsByFile.get(newer.intakeFileId), 1);
  });

  test("P3-15. recovery state, claims, and the operator read stay tenant-isolated", async () => {
    await resetTables();
    const byteSource = createByteSource();
    const aBytes = csvBytesFor(610);
    const aFile = await seedFile({ intakeFileId: fileId(610), bytes: aBytes });
    const bBytes = csvBytesFor(611);
    const bFile = await seedFile({ intakeFileId: fileId(611), organizationId: OTHER_ORG, bytes: bBytes });
    byteSource.register(aFile.objectVersionId, aBytes);
    byteSource.register(bFile.objectVersionId, bBytes);
    const dictionary = async (input, dependencies) =>
      (input.organizationId === ORG ? { ok: false, data: null, error: { code: "validation_blocker" } } : realCreateDraftDataDictionary(input, dependencies));
    await tickAt(poolA, byteSource, 0, { createDraftDataDictionary: dictionary });

    assert.equal((await recoveryRows(aFile.intakeFileId))[0].recovery_state, "operator_attention");
    assert.equal((await counts(bFile.intakeFileId)).sensitivityProfiles, 1, "another tenant's failure never blocks this one");

    const repository = createPostgresP1DownstreamRecoveryRepository({ runInTransaction: (callback) => withTransaction(callback, poolA) });
    const crossTenantClaim = await repository.claimDownstreamAttempt({
      identity: { organizationId: OTHER_ORG, intakeFileId: aFile.intakeFileId, fileProfileId: await profileIdFor(aFile.intakeFileId), stage: "p1_04_data_dictionary" },
      now: at(10),
      metadataOnlyAudit: systemAudit(bFile),
    });
    assert.equal(crossTenantClaim.error.code, "not_found");
    const crossTenantRead = await repository.readP1RecoveryStatus({ organizationId: OTHER_ORG, intakeFileId: aFile.intakeFileId });
    assert.deepEqual(crossTenantRead.data, { downstream: [], parser_runs: [] });

    const operator = (organizationId, roleName = "gk_operator") => ({
      actorType: "human",
      actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
      kaiRoles: [roleName],
      organizationMemberships: [{ organization_id: organizationId, role_name: roleName, membership_status: "active" }],
    });
    const statusDependencies = { env: ENABLED_ENV, p1DownstreamRecoveryRepository: repository };
    const visible = await getKaiP1RecoveryStatus({ organizationId: ORG, intakeFileId: aFile.intakeFileId, actorContext: operator(ORG) }, statusDependencies);
    assert.equal(visible.ok, true);
    assert.deepEqual(
      visible.data.downstream.map(({ stage, recovery_state: state, last_error_code: code }) => ({ stage, state, code })),
      [{ stage: "p1_04_data_dictionary", state: "operator_attention", code: "validation_blocker" }],
    );
    assert.equal(visible.data.parser_runs[0].parser_status, "completed");
    const otherTenant = await getKaiP1RecoveryStatus({ organizationId: ORG, intakeFileId: aFile.intakeFileId, actorContext: operator(OTHER_ORG) }, statusDependencies);
    assert.equal(otherTenant.ok, false);
    const systemActor = await getKaiP1RecoveryStatus(
      { organizationId: ORG, intakeFileId: aFile.intakeFileId, actorContext: { actorType: "system", actorUserId: null } },
      statusDependencies,
    );
    assert.equal(systemActor.error.code, "authorization_denied");
  });

  test("P3-16. repeated scheduled ticks on two instances plus an immediate dispatch create no duplicate records or audits", async () => {
    await resetTables();
    const bytes = csvBytesFor(620);
    const file = await seedFile({ intakeFileId: fileId(620), bytes });
    const byteSource = createByteSource({ delayMs: 80 });
    byteSource.register(file.objectVersionId, bytes);
    const dispatcher = instanceDispatcher(poolA, byteSource);
    dispatcher.dispatch({ organizationId: ORG, intakeFileId: file.intakeFileId, expectedFileFacts: expectedFor(file) }, { env: ENABLED_ENV });
    await Promise.all([
      dispatcher.whenIdle(),
      tickAt(poolA, byteSource, 0),
      tickAt(poolB, byteSource, 0),
      tickAt(poolB, byteSource, 1),
    ]);
    await tickAt(poolA, byteSource, 60);
    await tickAt(poolB, byteSource, 120);

    assert.equal(byteSource.reads.length, 1);
    const settled = await counts(file.intakeFileId);
    assert.deepEqual(
      [settled.parserRuns, settled.fileProfiles, settled.dictionaries, settled.sensitivityProfiles],
      [1, 1, 1, 1],
    );
    assert.equal(settled.lifecycleAudit.file_profile_persisted, 1);
    assert.equal(settled.lifecycleAudit.data_dictionary_draft_persisted, 1);
    assert.equal(settled.lifecycleAudit.intake_sensitivity_profile_persisted, 1);
    assert.equal(await auditActionCount("p1_04_data_dictionary_attempt_succeeded"), 1);
    assert.equal(await auditActionCount("p1_05_sensitivity_profile_attempt_succeeded"), 1);
    assert.equal(await auditActionCount("p1_04_data_dictionary_attempt_claimed"), 1);
  });

  test("P3-17/19. an orphaned P1-03 run is reclaimed only after its lease, is counted, and after three orphanings becomes an ordinary failed run that is never retried", async () => {
    await resetTables();
    const bytes = csvBytesFor(630);
    const file = await seedFile({ intakeFileId: fileId(630), bytes });
    runCrashChild({ mode: "kill_during_parse", file, bytes });
    assert.deepEqual((await parserRun(file.intakeFileId)).map(({ parser_status: s, retry_count: r }) => [s, r]), [["running", 0]]);

    const byteSource = createByteSource();
    byteSource.register(file.objectVersionId, bytes);
    assert.deepEqual(activatedIds(await tickAt(poolA, byteSource, 60)), [], "lease live: another worker may still own it");
    const leased = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: file.intakeFileId },
      instanceDependencies(poolA, byteSource, { now: () => at(60) }),
    );
    assert.deepEqual([leased.data.stoppedAt, leased.data.result.data.lease_active], ["parser_profile_activation", true]);

    const recovered = await tickAt(poolA, byteSource, PARSER_LEASE_SECONDS);
    assert.equal(recovered.data.activated[0].stoppedAt, undefined);
    assert.deepEqual((await parserRun(file.intakeFileId)).map(({ parser_status: s, retry_count: r }) => [s, r]), [["completed", 1]]);
    assert.equal((await counts(file.intakeFileId)).fileProfiles, 1);
    assert.equal(await auditActionCount("parser_run_lease_expired_requeued"), 1);

    // Bounded: three consecutive orphaned attempts exhaust the parser budget.
    const poison = csvBytesFor(631);
    const poisonFile = await seedFile({ intakeFileId: fileId(631), bytes: poison });
    runCrashChild({ mode: "kill_during_parse", file: poisonFile, bytes: poison, offsetSeconds: 0 });
    runCrashChild({ mode: "kill_during_parse", file: poisonFile, bytes: poison, offsetSeconds: PARSER_LEASE_SECONDS });
    runCrashChild({ mode: "kill_during_parse", file: poisonFile, bytes: poison, offsetSeconds: 2 * PARSER_LEASE_SECONDS });
    assert.deepEqual((await parserRun(poisonFile.intakeFileId)).map(({ parser_status: s, retry_count: r }) => [s, r]), [["running", 2]]);
    const exhausted = await tickAt(poolA, byteSource, 3 * PARSER_LEASE_SECONDS);
    assert.equal(exhausted.data.activated.find((entry) => entry.intakeFileId === poisonFile.intakeFileId).stoppedAt, "parser_profile_activation");
    assert.deepEqual(
      (await parserRun(poisonFile.intakeFileId)).map(({ parser_status: s, retry_count: r, error_code: c }) => [s, r, c]),
      [["failed", 3, "parser_run_lease_expired"]],
    );
    assert.deepEqual(activatedIds(await tickAt(poolA, byteSource, 30 * 24 * 3600)), [], "an ordinary failed run is never retried automatically");
    const status = await createPostgresP1DownstreamRecoveryRepository({ runInTransaction: (callback) => withTransaction(callback, poolA) })
      .readP1RecoveryStatus({ organizationId: ORG, intakeFileId: poisonFile.intakeFileId });
    assert.equal(status.data.parser_runs[0].requires_manual_review, true);
  });

  test("P3-18/20. a stalled parser worker whose lease was taken over is fenced out even while the new owner is still running, and completed runs are never re-profiled", async () => {
    await resetTables();
    const bytes = csvBytesFor(640);
    const file = await seedFile({ intakeFileId: fileId(640), bytes });

    function gatedSource() {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const source = {
        reads: [],
        release: () => release(),
        dependency: {
          async readObjectVersion() {
            source.reads.push(1);
            await gate;
            return { ok: true, data: { bytes: new Uint8Array(bytes) }, error: null };
          },
        },
      };
      return source;
    }
    async function waitForRead(source) {
      while (source.reads.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Worker A claims at t=0 and stalls mid-profile.
    const staleSource = gatedSource();
    const stale = processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: file.intakeFileId },
      instanceDependencies(poolA, staleSource, { now: () => at(0) }),
    );
    await waitForRead(staleSource);

    // After the lease, worker B recovers the run, claims it, and also stalls:
    // the run is `running` again, under B's claim.
    const ownerSource = gatedSource();
    const owner = processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: file.intakeFileId },
      instanceDependencies(poolB, ownerSource, { now: () => at(PARSER_LEASE_SECONDS + 1) }),
    );
    await waitForRead(ownerSource);
    assert.deepEqual((await parserRun(file.intakeFileId)).map(({ parser_status: s, retry_count: r }) => [s, r]), [["running", 1]]);

    // A finishes first: same run id, still `running` - only the fence refuses it.
    staleSource.release();
    const staleResult = await stale;
    assert.equal(staleResult.data.stoppedAt, "parser_profile_activation");
    assert.equal(staleResult.data.result.error.code, "conflict_current_state_changed", "the fenced worker's completion was refused");
    assert.equal((await counts(file.intakeFileId)).fileProfiles, 0, "no profile from the stale worker");
    assert.deepEqual((await parserRun(file.intakeFileId)).map(({ parser_status: s }) => s), ["running"]);

    ownerSource.release();
    const ownerResult = await owner;
    assert.equal(ownerResult.data.stoppedAt, undefined);

    const settled = await counts(file.intakeFileId);
    assert.equal(settled.fileProfiles, 1);
    assert.equal(settled.lifecycleAudit.file_profile_persisted, 1);
    assert.deepEqual((await parserRun(file.intakeFileId)).map(({ parser_status: s, retry_count: r }) => [s, r]), [["completed", 1]]);

    const replaySource = createByteSource();
    replaySource.register(file.objectVersionId, bytes);
    await tickAt(poolA, replaySource, 2 * PARSER_LEASE_SECONDS);
    await processKaiP1IntakeFile({ organizationId: ORG, intakeFileId: file.intakeFileId }, instanceDependencies(poolA, replaySource));
    assert.equal(replaySource.reads.length, 0, "a completed run is replayed, never re-profiled");
  });

  test("P3-21/22. the one-minute cron fallback, registered only with both gates, recovers work and never overlaps itself", async () => {
    await resetTables();
    const bytes = csvBytesFor(650);
    const file = await seedFile({ intakeFileId: fileId(650), bytes });
    const byteSource = createByteSource({ delayMs: 100 });
    byteSource.register(file.objectVersionId, bytes);

    const scheduled = [];
    const cronLib = { schedule: (expression, handler, options) => { scheduled.push({ expression, handler, options }); return { stop() {} }; } };
    for (const env of [{ KAI_SPRINT2_ENABLED: "true" }, { KAI_WORKER_ENABLED: "true" }]) {
      assert.equal(registerKaiP1WorkerCron({ env, cronLib }).scheduled, false);
    }
    assert.equal(scheduled.length, 0);

    let ticks = 0;
    const lines = [];
    const registration = registerKaiP1WorkerCron({
      env: ENABLED_ENV,
      cronLib,
      createRuntimeDependencies: () => instanceDependencies(poolA, byteSource),
      runTick: (dependencies) => {
        ticks += 1;
        return runKaiP1WorkerTick(dependencies);
      },
      log: (line) => lines.push(line),
    });
    assert.equal(registration.scheduled, true);
    assert.deepEqual([scheduled[0].expression, scheduled[0].options.timezone], ["* * * * *", "America/Vancouver"]);

    // Two fires overlap (a minute boundary while the first tick still runs).
    await Promise.all([scheduled[0].handler(), scheduled[0].handler()]);
    assert.equal(ticks, 1, "the overlapping fire was skipped, not queued");
    assert.ok(lines.includes("[kai-p1-worker] tick skipped: previous tick still running"));
    assert.ok(lines.some((line) => /^\[kai-p1-worker\] candidates=1 completed_through_p1_05=1$/.test(line)), lines.join("\n"));
    assert.equal((await counts(file.intakeFileId)).sensitivityProfiles, 1);

    await scheduled[0].handler();
    assert.equal(ticks, 2, "the next fire runs once the previous tick finished");
    for (const line of lines) assert.doesNotMatch(line, /[0-9a-f]{8}-[0-9a-f]{4}-|synthetic|ov-|gs:\/\//);
  });

  test("P3-24. an upload blocked after its eligibility check can neither complete P1-03 nor commit P1-04 output", async () => {
    await resetTables();
    const block = (intakeFileId) => poolB.query(
      "UPDATE kai.intake_files SET upload_state = 'policy_blocked', file_policy_status = 'blocked' WHERE intake_file_id = $1::uuid",
      [intakeFileId],
    );

    // Blocked while P1-03 is profiling.
    const parseBytes = csvBytesFor(660);
    const parseFile = await seedFile({ intakeFileId: fileId(660), bytes: parseBytes });
    const blockingSource = {
      dependency: {
        async readObjectVersion() {
          await block(parseFile.intakeFileId);
          return { ok: true, data: { bytes: new Uint8Array(parseBytes) }, error: null };
        },
      },
    };
    const parsed = await processKaiP1IntakeFile({ organizationId: ORG, intakeFileId: parseFile.intakeFileId }, instanceDependencies(poolA, blockingSource));
    assert.equal(parsed.data.stoppedAt, "parser_profile_activation");
    assert.equal((await counts(parseFile.intakeFileId)).fileProfiles, 0, "no profile committed for a blocked upload");

    // Blocked between P1-03 and the P1-04 commit.
    const dictBytes = csvBytesFor(661);
    const dictFile = await seedFile({ intakeFileId: fileId(661), bytes: dictBytes });
    const byteSource = createByteSource();
    byteSource.register(dictFile.objectVersionId, dictBytes);
    const blockingDictionary = async (input, dependencies) => {
      await block(dictFile.intakeFileId);
      return realCreateDraftDataDictionary(input, dependencies);
    };
    const stopped = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: dictFile.intakeFileId },
      instanceDependencies(poolA, byteSource, { createDraftDataDictionary: blockingDictionary }),
    );
    assert.equal(stopped.data.stoppedAt, "draft_data_dictionary");
    const after = await counts(dictFile.intakeFileId);
    assert.deepEqual([after.dictionaries, after.sensitivityProfiles], [0, 0]);

    const later = await processKaiP1IntakeFile(
      { organizationId: ORG, intakeFileId: dictFile.intakeFileId },
      instanceDependencies(poolA, byteSource, { now: () => at(3600) }),
    );
    assert.equal(later.data.result.data.reason, "not_eligible_for_p1");
    const repository = createPostgresP1DownstreamRecoveryRepository({ runInTransaction: (callback) => withTransaction(callback, poolA) });
    const claim = await repository.claimDownstreamAttempt({
      identity: { organizationId: ORG, intakeFileId: dictFile.intakeFileId, fileProfileId: await profileIdFor(dictFile.intakeFileId), stage: "p1_04_data_dictionary" },
      now: at(3600),
      metadataOnlyAudit: systemAudit(dictFile),
    });
    assert.equal(claim.data.decision, "not_eligible");
    assert.deepEqual(activatedIds(await tickAt(poolA, byteSource, 3600)), []);
  });
}
