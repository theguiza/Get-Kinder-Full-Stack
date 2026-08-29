import test from "node:test";
import assert from "node:assert/strict";

/**
 * Real-database proof for `listActionableKaiP1WorkCandidates`
 * (`Backend/kai/db/kaiIntakeQueries.js`): that it selects exactly the
 * ACTIONABLE_AUTOMATIC_P1_WORK states - the ones
 * `activateParserProfileWorkForIntakeFile(..., retry: false)` can actually
 * advance on its own, scoped to each file's CURRENT parser-run identity - and
 * that its global chronological (`created_at`) ordering bounds
 * cross-organization starvation even when more than 25 organizations have
 * actionable work at once. Skipped without its own opt-in database URL,
 * following this repository's existing `.integration.spec.js` convention
 * (every `KAI_<SUITE>_DATABASE_URL`-gated spec).
 */
if (!process.env.KAI_P1_WORKER_CANDIDATE_DISCOVERY_DATABASE_URL) {
  test("P1 worker actionable-candidate discovery integration requires the runner-owned database", { skip: true }, () => {});
} else {
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const { listActionableKaiP1WorkCandidates } = await import("../Backend/kai/db/kaiIntakeQueries.js");

  const DATABASE_URL = process.env.KAI_P1_WORKER_CANDIDATE_DISCOVERY_DATABASE_URL;
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const BASE_TIME = Date.parse("2026-08-29T10:00:00.000Z");
  const PARSER = { parserName: "kai_local_profiling_kernel", parserVersion: "1.0.0" };
  const MAX_PARSER_RETRY_COUNT = 3;

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 8 });
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
      "TRUNCATE kai.intake_sensitivity_profiles, kai.data_dictionaries, kai.intake_file_profiles, kai.intake_parser_runs, kai.intake_files",
    ));
  }

  function checksumFor(seed) {
    return String(seed % 10).repeat(64).slice(0, 63) + "a";
  }

  function timeOffset(offsetSeconds) {
    return new Date(BASE_TIME + offsetSeconds * 1000).toISOString();
  }

  async function seedIntakeFile(client, { intakeFileId, organizationId, checksum, filePolicyStatus = "passed", createdAt = timeOffset(0) }) {
    // `verified_checksum` (not `checksum`, the declared pre-confirm value) is
    // the column `listActionableKaiP1WorkCandidates` actually reads - it is
    // the field set once at the real `confirmed` transition
    // (`transitionUploadLifecycle` in `postgresUploadLifecycleRepository.js`)
    // and never overwritten afterward. A `file_policy_status = 'passed'` file
    // always has a non-null `verified_checksum` in production, so it must be
    // populated here too, or the query's checksum-scoped exclusion can never
    // match anything.
    await client.query(
      `INSERT INTO kai.intake_files (
         intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
         checksum, verified_checksum, hash_algorithm, force_new_version, processing_status, parse_status,
         file_policy_status, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'fixture', 'fixture', $4, $4, 'sha256', true,
               'quarantined', 'quarantined', $5, $6::timestamptz)`,
      [intakeFileId, BATCH, organizationId, checksum, filePolicyStatus, createdAt],
    );
  }

  async function seedParserRun(client, { organizationId, intakeFileId, checksum, parserStatus, retryCount = 0, now = timeOffset(0) }) {
    const result = await client.query(
      `INSERT INTO kai.intake_parser_runs (
         organization_id, intake_file_id, parser_name, parser_version, checksum,
         parser_status, retry_count, started_at, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::timestamptz, $8::timestamptz)
       RETURNING parser_run_id::text AS parser_run_id`,
      [organizationId, intakeFileId, PARSER.parserName, PARSER.parserVersion, checksum, parserStatus, retryCount, now],
    );
    return result.rows[0].parser_run_id;
  }

  async function completeParserRun(client, { organizationId, intakeFileId, checksum, parserRunId, now = timeOffset(0) }) {
    const profileInsert = await client.query(
      `INSERT INTO kai.intake_file_profiles (
         organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum,
         profile, profile_canonical_sha256, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, encode(digest($7::jsonb::text, 'sha256'), 'hex'), $8::timestamptz)
       RETURNING file_profile_id::text AS file_profile_id`,
      [organizationId, intakeFileId, parserRunId, PARSER.parserName, PARSER.parserVersion, checksum, JSON.stringify({ status: "profiled" }), now],
    );
    const fileProfileId = profileInsert.rows[0].file_profile_id;
    await client.query(
      `UPDATE kai.intake_parser_runs
          SET parser_status = 'completed', completed_at = $1::timestamptz, output_profile_id = $2::uuid
        WHERE parser_run_id = $3::uuid`,
      [now, fileProfileId, parserRunId],
    );
    return fileProfileId;
  }

  async function seedDictionary(client, { organizationId, intakeFileId, fileProfileId, now = timeOffset(0) }) {
    const result = await client.query(
      `INSERT INTO kai.data_dictionaries (
         organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz)
       RETURNING data_dictionary_id::text AS data_dictionary_id`,
      [organizationId, intakeFileId, fileProfileId, "a".repeat(64), now],
    );
    return result.rows[0].data_dictionary_id;
  }

  async function seedSensitivityProfile(client, { organizationId, intakeFileId, fileProfileId, dataDictionaryId, now = timeOffset(0) }) {
    await client.query(
      `INSERT INTO kai.intake_sensitivity_profiles (
         organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::timestamptz)`,
      [organizationId, intakeFileId, fileProfileId, dataDictionaryId, "a".repeat(64), now],
    );
  }

  /**
   * Drives one actionable file all the way through the automatic chain to its
   * terminal, automatically-satisfied P1-05 state - used only to simulate "this
   * candidate has already been fully processed by a prior tick" between
   * `listActionableKaiP1WorkCandidates` calls in the fairness tests below.
   */
  async function satisfyFile(client, { organizationId, intakeFileId, checksum }) {
    const runId = await seedParserRun(client, { organizationId, intakeFileId, checksum, parserStatus: "running" });
    const fileProfileId = await completeParserRun(client, { organizationId, intakeFileId, checksum, parserRunId: runId });
    const dataDictionaryId = await seedDictionary(client, { organizationId, intakeFileId, fileProfileId });
    await seedSensitivityProfile(client, { organizationId, intakeFileId, fileProfileId, dataDictionaryId });
  }

  test("A-I: only states that activateParserProfileWorkForIntakeFile(retry:false) can actually advance, for the file's CURRENT checksum identity, are selected", async () => {
    await resetTables();

    const ORG = "00000000-0000-4000-8000-00000000a001";
    const files = {
      noParserRun: "20000000-0000-4000-8000-000000000001",
      queued: "20000000-0000-4000-8000-000000000002",
      running: "20000000-0000-4000-8000-000000000003",
      completedNoDictionary: "20000000-0000-4000-8000-000000000004",
      completedDictionaryNoSensitivity: "20000000-0000-4000-8000-000000000005",
      failedRetryLtMax: "20000000-0000-4000-8000-000000000006",
      failedRetryAtMax: "20000000-0000-4000-8000-000000000007",
      cancelled: "20000000-0000-4000-8000-000000000008",
      completedWithSensitivity: "20000000-0000-4000-8000-000000000009",
      historicalFailedDifferentIdentity: "20000000-0000-4000-8000-00000000000a",
      historicalCancelledDifferentIdentity: "20000000-0000-4000-8000-00000000000b",
      historicalRunningDifferentIdentity: "20000000-0000-4000-8000-00000000000c",
    };
    // The file's CURRENT confirmed checksum for the two "historical, different
    // identity" cases - distinct from the checksum any historical parser run
    // below is seeded under, simulating a corrected re-intake that superseded
    // an old confirmed version.
    const CURRENT_CHECKSUM_FOR_HISTORICAL = checksumFor(50);
    const SUPERSEDED_CHECKSUM = checksumFor(51);

    await withClient(async (client) => {
      let seed = 1;
      for (const [key, intakeFileId] of Object.entries(files)) {
        const checksum = key.startsWith("historical") ? CURRENT_CHECKSUM_FOR_HISTORICAL : checksumFor(seed);
        // eslint-disable-next-line no-await-in-loop
        await seedIntakeFile(client, { intakeFileId, organizationId: ORG, checksum });
        seed += 1;
      }

      await seedParserRun(client, {
        organizationId: ORG, intakeFileId: files.queued, checksum: checksumFor(2), parserStatus: "queued",
      });
      await seedParserRun(client, {
        organizationId: ORG, intakeFileId: files.running, checksum: checksumFor(3), parserStatus: "running",
      });
      await seedParserRun(client, {
        organizationId: ORG, intakeFileId: files.failedRetryLtMax, checksum: checksumFor(6), parserStatus: "failed", retryCount: 1,
      });
      await seedParserRun(client, {
        organizationId: ORG, intakeFileId: files.failedRetryAtMax, checksum: checksumFor(7), parserStatus: "failed", retryCount: MAX_PARSER_RETRY_COUNT,
      });
      await seedParserRun(client, {
        organizationId: ORG, intakeFileId: files.cancelled, checksum: checksumFor(8), parserStatus: "cancelled",
      });

      // Historical rows under a SUPERSEDED checksum: must never block the
      // file's current identity, since a fresh activation call always
      // re-derives its identity from the file's CURRENT checksum and would
      // insert a brand-new, independent `queued` row regardless of these.
      await seedParserRun(client, {
        organizationId: ORG, intakeFileId: files.historicalFailedDifferentIdentity, checksum: SUPERSEDED_CHECKSUM, parserStatus: "failed",
      });
      await seedParserRun(client, {
        organizationId: ORG, intakeFileId: files.historicalCancelledDifferentIdentity, checksum: SUPERSEDED_CHECKSUM, parserStatus: "cancelled",
      });
      await seedParserRun(client, {
        organizationId: ORG, intakeFileId: files.historicalRunningDifferentIdentity, checksum: SUPERSEDED_CHECKSUM, parserStatus: "running",
      });

      const runNoDict = await seedParserRun(client, {
        organizationId: ORG, intakeFileId: files.completedNoDictionary, checksum: checksumFor(4), parserStatus: "running",
      });
      await completeParserRun(client, {
        organizationId: ORG, intakeFileId: files.completedNoDictionary, checksum: checksumFor(4), parserRunId: runNoDict,
      });

      const runWithDict = await seedParserRun(client, {
        organizationId: ORG, intakeFileId: files.completedDictionaryNoSensitivity, checksum: checksumFor(5), parserStatus: "running",
      });
      const dictOnlyProfileId = await completeParserRun(client, {
        organizationId: ORG, intakeFileId: files.completedDictionaryNoSensitivity, checksum: checksumFor(5), parserRunId: runWithDict,
      });
      await seedDictionary(client, { organizationId: ORG, intakeFileId: files.completedDictionaryNoSensitivity, fileProfileId: dictOnlyProfileId });

      await satisfyFile(client, { organizationId: ORG, intakeFileId: files.completedWithSensitivity, checksum: checksumFor(9) });
    });

    const result = await listActionableKaiP1WorkCandidates(pool);
    const selected = new Set(result.map((row) => row.intake_file_id));

    assert.equal(selected.has(files.noParserRun), true, "fresh P1-03 (no parser run) must be selected");
    assert.equal(selected.has(files.queued), true, "a queued run is claimable and must be selected");
    assert.equal(selected.has(files.completedNoDictionary), true, "P1-04 recovery must be selected");
    assert.equal(selected.has(files.completedDictionaryNoSensitivity), true, "P1-05 recovery must be selected");

    assert.equal(selected.has(files.running), false, "a running run for the current identity can never be reclaimed under retry:false and must be excluded");
    assert.equal(selected.has(files.failedRetryLtMax), false, "a failed run for the current identity requires explicit retry:true and must be excluded");
    assert.equal(selected.has(files.failedRetryAtMax), false, "a retry-exhausted failed run for the current identity must be excluded regardless of retry_count");
    assert.equal(selected.has(files.cancelled), false, "a cancelled run for the current identity is terminal/non-resumable and must be excluded");
    assert.equal(selected.has(files.completedWithSensitivity), false, "automatically satisfied work must be excluded");

    assert.equal(
      selected.has(files.historicalFailedDifferentIdentity),
      true,
      "a historical failed run under a SUPERSEDED checksum must never block the file's current identity",
    );
    assert.equal(
      selected.has(files.historicalCancelledDifferentIdentity),
      true,
      "a historical cancelled run under a SUPERSEDED checksum must never block the file's current identity",
    );
    assert.equal(
      selected.has(files.historicalRunningDifferentIdentity),
      true,
      "a historical running run under a SUPERSEDED checksum must never block the file's current identity",
    );
  });

  test("J: every candidate carries its own persisted organization_id/intake_file_id across two organizations", async () => {
    await resetTables();
    const ORG_A = "00000000-0000-4000-8000-00000000a002";
    const ORG_B = "00000000-0000-4000-8000-00000000b002";
    const fileA = "20000000-0000-4000-8000-0000000000a1";
    const fileB = "20000000-0000-4000-8000-0000000000b1";

    await withClient(async (client) => {
      await seedIntakeFile(client, { intakeFileId: fileA, organizationId: ORG_A, checksum: checksumFor(1) });
      await seedIntakeFile(client, { intakeFileId: fileB, organizationId: ORG_B, checksum: checksumFor(2) });
    });

    const result = await listActionableKaiP1WorkCandidates(pool);
    const byFile = new Map(result.map((row) => [row.intake_file_id, row.organization_id]));
    assert.equal(byFile.get(fileA), ORG_A);
    assert.equal(byFile.get(fileB), ORG_B);
  });

  test(">25 organizations: bounded progression - a tick's own 25-row limit is respected, and the remaining organizations are reached once earlier ones are satisfied", async () => {
    await resetTables();

    const organizationFor = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const fileFor = (index) => `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const TOTAL_ORGS = 30;

    await withClient(async (client) => {
      for (let index = 0; index < TOTAL_ORGS; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        await seedIntakeFile(client, {
          intakeFileId: fileFor(index),
          organizationId: organizationFor(index),
          checksum: checksumFor(index),
          createdAt: timeOffset(index),
        });
      }
    });

    const firstTick = await listActionableKaiP1WorkCandidates(pool);
    assert.equal(firstTick.length, 25, "the bounded per-tick limit must still be respected");
    const firstTickOrgs = new Set(firstTick.map((row) => row.organization_id));
    for (let index = 0; index < 25; index += 1) {
      assert.equal(firstTickOrgs.has(organizationFor(index)), true, `the 25 oldest organizations (index ${index}) must be selected first`);
    }
    for (let index = 25; index < TOTAL_ORGS; index += 1) {
      assert.equal(firstTickOrgs.has(organizationFor(index)), false, `organization index ${index} must not yet be reached`);
    }

    // Simulate the first tick's 25 candidates having been fully, successfully
    // processed by a prior tick.
    await withClient(async (client) => {
      for (let index = 0; index < 25; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        await satisfyFile(client, { organizationId: organizationFor(index), intakeFileId: fileFor(index), checksum: checksumFor(index) });
      }
    });

    const secondTick = await listActionableKaiP1WorkCandidates(pool);
    const secondTickOrgs = new Set(secondTick.map((row) => row.organization_id));
    assert.equal(secondTick.length, TOTAL_ORGS - 25, "exactly the remaining organizations must now be actionable");
    for (let index = 25; index < TOTAL_ORGS; index += 1) {
      assert.equal(
        secondTickOrgs.has(organizationFor(index)),
        true,
        `organization index ${index} must be reached once the earlier 25 organizations are satisfied, proving no more than 25 distinct organizations can be indefinitely ahead of it`,
      );
    }
  });

  test("sustained single-organization backlog cannot indefinitely starve a fixed candidate in another organization", async () => {
    await resetTables();

    const ORG_HEAVY = "00000000-0000-4000-8000-00000000ea01";
    const FIXED_ORG = "00000000-0000-4000-8000-00000000fa01";
    const FIXED_FILE = "60000000-0000-4000-8000-000000000fa1";
    const heavyFileFor = (index) => `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

    await withClient(async (client) => {
      // ORG_HEAVY's initial backlog, all strictly older than FIXED_ORG's file.
      for (let index = 0; index < 30; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        await seedIntakeFile(client, {
          intakeFileId: heavyFileFor(index),
          organizationId: ORG_HEAVY,
          checksum: checksumFor(index),
          createdAt: timeOffset(index),
        });
      }
      // FIXED_ORG's one candidate, newer than ORG_HEAVY's initial 30-row backlog.
      await seedIntakeFile(client, {
        intakeFileId: FIXED_FILE, organizationId: FIXED_ORG, checksum: checksumFor(999), createdAt: timeOffset(30),
      });
    });

    const firstTick = await listActionableKaiP1WorkCandidates(pool);
    assert.equal(firstTick.length, 25, "the bounded per-tick limit must still be respected");
    assert.equal(
      firstTick.some((row) => row.intake_file_id === FIXED_FILE),
      false,
      "FIXED_FILE is genuinely newer than ORG_HEAVY's existing backlog, so it is correctly not yet due on the first tick",
    );

    // Simulate the first tick's 25 oldest ORG_HEAVY candidates being fully
    // processed, AND ORG_HEAVY's backlog being "continuously sustained" by 10
    // brand-new arrivals - each necessarily newer than FIXED_FILE, since a
    // newly created row can never be assigned an earlier timestamp than one
    // that already exists.
    await withClient(async (client) => {
      for (let index = 0; index < 25; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        await satisfyFile(client, { organizationId: ORG_HEAVY, intakeFileId: heavyFileFor(index), checksum: checksumFor(index) });
      }
      for (let index = 31; index < 41; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        await seedIntakeFile(client, {
          intakeFileId: heavyFileFor(index),
          organizationId: ORG_HEAVY,
          checksum: checksumFor(index),
          createdAt: timeOffset(index),
        });
      }
    });

    const secondTick = await listActionableKaiP1WorkCandidates(pool);
    assert.equal(
      secondTick.some((row) => row.intake_file_id === FIXED_FILE),
      true,
      "FIXED_FILE must be reached once the candidates strictly older than it are cleared, even though ORG_HEAVY's backlog keeps being replenished with newer work",
    );
  });
}
