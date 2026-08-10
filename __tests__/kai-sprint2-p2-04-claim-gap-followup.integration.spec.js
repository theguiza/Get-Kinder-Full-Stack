import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_04_CLAIM_GAP_FOLLOWUP_DATABASE_URL;

/**
 * PostgreSQL isolation (P2-01C pattern reapplied): the runner-owned database
 * URL is validated as loopback-only synchronously, before this file performs a
 * single dynamic import of `pg`, `Backend/kai/db/kaiDb.js`, or any P2-04
 * module - and `Backend/kai/db/kaiDb.js` is never imported anywhere in this
 * file. A non-loopback URL is rejected here, synchronously, before any
 * connection attempt of any kind.
 */
function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P2-04 integration suite refused a non-loopback KAI_P2_04_CLAIM_GAP_FOLLOWUP_DATABASE_URL host: ${host}`);
  }
}

test("P2-04 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  for (const url of ["postgresql://user@example.com:5432/db", "postgresql://user@10.0.0.5:5432/db", "postgresql://user@my-internal-host.internal:5432/db"]) {
    assert.throws(() => assertLoopbackDatabaseUrl(url), /refused a non-loopback/);
  }
  for (const url of ["postgresql://user@127.0.0.1:59123/db", "postgresql://user@localhost:59123/db"]) {
    assert.doesNotThrow(() => assertLoopbackDatabaseUrl(url));
  }
});

test("P2-04 PostgreSQL isolation: this file imports no database module at its top level and never imports Backend/kai/db/kaiDb.js", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresClaimGapFollowupRepository\.js|kaiClaimGapFollowupService\.js/.test(line)),
    "expected every database-capable module to be imported dynamically, never at the top level");
  assert.doesNotMatch(ownSource, /from\s+["']\.\.\/Backend\/kai\/db\/kaiDb\.js["']/,
    "the P2-04 integration suite must never import the ambient kaiDb.js pool - it uses a test-local transaction wrapper over its own runner-owned Pool instead");
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P2-04 claim-gap/client-followup integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runClaimGapFollowupIntegrationSuite();
}

async function runClaimGapFollowupIntegrationSuite() {
  const { Pool } = await import("pg");
  const { createPostgresClaimGapFollowupRepository } = await import(
    "../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js"
  );
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");

  const DATABASE_URL = RUNNER_OWNED_DATABASE_URL;
  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const BATCH = "10000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-06T10:00:00.000Z";
  const REVIEWED_TYPE = "organization_primary_record";

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 8 });

  async function withRunnerOwnedTransaction(callback, ownPool = pool) {
    const client = await ownPool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const repository = createPostgresClaimGapFollowupRepository({
    runInTransaction: (callback) => withRunnerOwnedTransaction(callback, pool),
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

  // A distinct id namespace ('d1'..'d6' prefixes) unused by any chained smoke-seed fixture,
  // avoiding any collision with committed Gate A/P1-04 through P2-03 smoke-seed
  // rows in this package's own local-postgres runner.
  function fileId(index) {
    return `d1000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function candidateId(index) {
    return `d2000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function sensitivityId(index) {
    return `d3000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function fileProfileId(index) {
    return `d4000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function dictionaryId(index) {
    return `d5000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function sourceId(index) {
    return `d6000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function checksumFor(index) {
    const hex = index.toString(16).padStart(2, "0");
    return hex.repeat(32).slice(0, 64);
  }

  async function seedPromotedClaim(index, { organizationId = ORG, allClear = false } = {}) {
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
    const profile = { status: "profiled", format: "csv", counts: { row_count: 1, column_count: 1, field_count: 1 } };
    const fileProfileIdValue = fileProfileId(index);
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_file_profiles (
         file_profile_id, organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'kai_local_profiling_kernel', '1.0.0', $5, $6::jsonb, $7, $8::timestamptz)`,
      [fileProfileIdValue, organizationId, intakeFileId, parserRunId, checksum, JSON.stringify(profile), checksum, NOW],
    ));
    const dataDictionaryId = dictionaryId(index);
    await withClient((client) => client.query(
      `INSERT INTO kai.data_dictionaries (data_dictionary_id, organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::timestamptz)`,
      [dataDictionaryId, organizationId, intakeFileId, fileProfileIdValue, checksum, NOW],
    ));
    if (allClear) {
      await withClient((client) => client.query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type, business_meaning, entity_level)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'field_1', 'field_1', 'number', 'a defined business meaning', 'organization')`,
        [dataDictionaryId, organizationId, fileProfileIdValue],
      ));
    } else {
      await withClient((client) => client.query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'field_1', 'field_1', 'number')`,
        [dataDictionaryId, organizationId, fileProfileIdValue],
      ));
    }
    const intakeSensitivityProfileId = sensitivityId(index);
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_sensitivity_profiles (
         intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id,
         profile_canonical_sha256, small_cell_risk_status, allowed_use_status, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9::timestamptz)`,
      [intakeSensitivityProfileId, organizationId, intakeFileId, fileProfileIdValue, dataDictionaryId, checksum, allClear ? "absent" : "unknown", "unknown", NOW],
    ));
    const intakeSourceCandidateId = candidateId(index);
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_source_candidates (
         intake_source_candidate_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id,
         intake_sensitivity_profile_id, profile_canonical_sha256, candidate_status, created_by_type
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, 'promoted', 'human')`,
      [intakeSourceCandidateId, organizationId, intakeFileId, fileProfileIdValue, dataDictionaryId, intakeSensitivityProfileId, checksum],
    ));
    const reviewItemResult = await withClient((client) => client.query(
      `INSERT INTO kai.review_queue_items (
         organization_id, queue_type, target_object_type, target_object_id,
         priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
       ) VALUES ($1::uuid, 'source_candidate_review', 'intake_source_candidate', $2::uuid,
                 'normal', 'resolved', 'resolved', 'Review intake source-candidate stub for human classification.',
                 'Human review is required.', '{"p0_stub":true}'::jsonb, 'human')
       RETURNING review_queue_item_id::text AS review_queue_item_id`,
      [organizationId, intakeSourceCandidateId],
    ));
    const reviewQueueItemId = reviewItemResult.rows[0].review_queue_item_id;
    const sourceIdValue = sourceId(index);
    await withClient((client) => client.query(
      `INSERT INTO kai.sources (source_id, organization_id, source_code, reviewed_source_type, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3, $4, 'human')`,
      [sourceIdValue, organizationId, checksum, REVIEWED_TYPE],
    ));
    const sourceVersionResult = await withClient((client) => client.query(
      `INSERT INTO kai.source_versions (organization_id, source_id, intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'human')
       RETURNING source_version_id::text AS source_version_id`,
      [organizationId, sourceIdValue, intakeSourceCandidateId, intakeSensitivityProfileId, checksum],
    ));
    const sourceVersionId = sourceVersionResult.rows[0].source_version_id;
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_promotion_decisions (
         organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type,
         decision_status, source_id, source_version_id, promoted_at, created_by_type
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'promoted', $5::uuid, $6::uuid, $7::timestamptz, 'human')`,
      [organizationId, intakeSourceCandidateId, reviewQueueItemId, REVIEWED_TYPE, sourceIdValue, sourceVersionId, NOW],
    ));

    const locatorFingerprint = checksumFor(index + 1000);
    const evidenceStatement = `Source version's committed data dictionary includes field "field_1" of committed type "number".`;
    const evidenceFingerprint = checksumFor(index + 2000);
    const locatorResult = await withClient((client) => client.query(
      `INSERT INTO kai.source_locators (organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
       VALUES ($1::uuid, $2::uuid, 'column', jsonb_build_object('column_name', 'field_1'), $3)
       RETURNING source_locator_id::text AS source_locator_id`,
      [organizationId, sourceVersionId, locatorFingerprint],
    ));
    const sourceLocatorId = locatorResult.rows[0].source_locator_id;
    const evidenceResult = await withClient((client) => client.query(
      `INSERT INTO kai.evidence_items (
         organization_id, source_id, source_version_id, source_locator_id, evidence_type, data_class,
         sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'dictionary_field_presence_fact', 'organization_committed_metadata',
                 'unknown', 'unassessed', $5, $6, 'human')
       RETURNING evidence_item_id::text AS evidence_item_id`,
      [organizationId, sourceIdValue, sourceVersionId, sourceLocatorId, evidenceStatement, evidenceFingerprint],
    ));
    const evidenceItemId = evidenceResult.rows[0].evidence_item_id;
    await withClient((client) => client.query(
      `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
       VALUES ($1::uuid, 'evidence_review', 'evidence_item', $2::uuid, 'normal', 'open', 'needs_gk_review', 'New evidence item requires GK review.',
               'Review the evidence item''s lineage, sensitivity, support strength, and audience eligibility before use.', '{}'::jsonb, 'system')`,
      [organizationId, evidenceItemId],
    ));

    const claimStatement = `The promoted source contains the committed data-dictionary field "field_1" identified by locator ${locatorFingerprint}.`;
    const claimFingerprint = checksumFor(index + 3000);
    const claimResult = await withClient((client) => client.query(
      `INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
       VALUES ($1::uuid, $2::uuid, 'finding', 'proposed', 'needs_gk_review', 'unassessed', $3, $4, 'human')
       RETURNING claim_id::text AS claim_id`,
      [organizationId, evidenceItemId, claimStatement, claimFingerprint],
    ));
    const claimId = claimResult.rows[0].claim_id;
    await withClient((client) => client.query(
      `INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'system')`,
      [organizationId, claimId, evidenceItemId],
    ));

    return { organizationId, intakeFileId, sourceVersionId, evidenceItemId, claimId };
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

  test("P2-04 (a): first generation creates nine gaps, four client follow-ups, four client_followup queue items, and exactly one audit row", async () => {
    const seed = await seedPromotedClaim(1);
    const audit = createAuditProbe();

    const result = await repository.generateClaimGapsAndFollowups({
      organizationId: ORG,
      claimId: seed.claimId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.gapItems.length, 9);
    assert.equal(result.data.clientFollowupItems.length, 4);
    assert.equal(result.data.reviewQueueItems.length, 4);
    const gapByDimension = new Map(result.data.gapItems.map((gap) => [gap.dimension_key, gap]));
    const followupById = new Map(result.data.clientFollowupItems.map((followup) => [followup.client_followup_item_id, followup]));
    for (const followup of result.data.clientFollowupItems) {
      assert.ok(followup.client_followup_item_id, "fresh follow-up identity must be server-owned and non-null");
      const gap = gapByDimension.get(followup.dimension_key);
      assert.ok(gap?.gap_log_item_id, "fresh routed gap identity must be real and non-null");
      assert.equal(followup.gap_log_item_id, gap.gap_log_item_id);
      assert.equal(followup.organization_id, ORG);
      assert.equal(followup.claim_id, seed.claimId);
    }
    assert.ok(!result.data.gapItems.some((g) => g.dimension_key === "coverage_gaps"));
    assert.deepEqual(
      result.data.clientFollowupItems.map((f) => f.dimension_key).sort(),
      ["definition_clarity", "denominator_clarity", "entity_level_clarity", "time_period_clarity"],
    );
    for (const queueItem of result.data.reviewQueueItems) {
      const followup = followupById.get(queueItem.target_object_id);
      assert.ok(followup, "client_followup queue target must be the follow-up ID");
      assert.equal(queueItem.queue_status, "waiting_on_client");
      assert.equal(queueItem.review_status, "proposed");
      assert.equal(queueItem.priority, "normal");
      assert.equal(queueItem.assigned_to, null);
      assert.equal(queueItem.due_at, null);
    }
    assert.equal(audit.published.length, 1);

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.gap_log_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, seed.claimId]),
      client.query(`SELECT count(*)::int AS count FROM kai.client_followup_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, seed.claimId]),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'claim_gap_and_followup_generated' AND organization_id = $1::uuid AND intake_file_id = $2::uuid`, [ORG, seed.intakeFileId]),
    ]));
    assert.equal(counts[0].rows[0].count, 9);
    assert.equal(counts[1].rows[0].count, 4);
    assert.equal(counts[2].rows[0].count, 1);

    const auditRow = await withClient((client) => client.query(
      `SELECT metadata FROM kai.upload_lifecycle_audit WHERE operation = 'claim_gap_and_followup_generated' AND organization_id = $1::uuid AND intake_file_id = $2::uuid`,
      [ORG, seed.intakeFileId],
    ));
    assert.deepEqual(
      Object.keys(auditRow.rows[0].metadata).sort(),
      [
        "claim_id", "client_followup_count", "client_followup_dimension_keys", "contract",
        "evidence_item_id", "fresh_write_count", "gap_count", "gap_dimension_keys",
        "metadata_only", "review_queue_item_count", "source_version_id", "validator_key",
      ],
    );
    assert.ok(!("question_text" in auditRow.rows[0].metadata));
    assert.ok(!("summary" in auditRow.rows[0].metadata));
  });

  test("P2-04 (b): replaying the identical call is a full no-op - zero new rows, zero new audit rows, replayed: true", async () => {
    const seed = await seedPromotedClaim(2);
    const first = await repository.generateClaimGapsAndFollowups({
      organizationId: ORG,
      claimId: seed.claimId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(first.ok, true, JSON.stringify(first));

    const secondAudit = createAuditProbe();
    const second = await repository.generateClaimGapsAndFollowups({
      organizationId: ORG,
      claimId: seed.claimId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: secondAudit.dependency,
    });
    assert.equal(second.ok, true);
    assert.equal(second.data.replayed, true);
    assert.equal(secondAudit.published.length, 0);
    assert.equal(second.data.gapItems.length, 9);
    assert.equal(second.data.clientFollowupItems.length, 4);
    assert.equal(second.data.reviewQueueItems.length, 4);

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.gap_log_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, seed.claimId]),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'claim_gap_and_followup_generated' AND organization_id = $1::uuid AND intake_file_id = $2::uuid`, [ORG, seed.intakeFileId]),
    ]));
    assert.equal(counts[0].rows[0].count, 9);
    assert.equal(counts[1].rows[0].count, 1);
  });

  test("P2-04 (c): two genuinely overlapping generation calls for the same claim converge to the same complete set with exactly one audit row published between them", async () => {
    const seed = await seedPromotedClaim(3);

    let arrived = 0;
    let openGate;
    const gateOpened = new Promise((resolve) => { openGate = resolve; });
    async function gate() {
      arrived += 1;
      if (arrived >= 2) openGate();
      await gateOpened;
    }
    const racingRepository = createPostgresClaimGapFollowupRepository({
      runInTransaction: (callback) => withRunnerOwnedTransaction(callback, pool),
      beforeInsert: gate,
    });

    const firstAudit = createAuditProbe();
    const secondAudit = createAuditProbe();
    const [first, second] = await Promise.all([
      racingRepository.generateClaimGapsAndFollowups({
        organizationId: ORG,
        claimId: seed.claimId,
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: firstAudit.dependency,
      }),
      racingRepository.generateClaimGapsAndFollowups({
        organizationId: ORG,
        claimId: seed.claimId,
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: secondAudit.dependency,
      }),
    ]);
    assert.equal(arrived, 2);

    assert.equal(first.ok, true, `first call failed: ${JSON.stringify(first.error)}`);
    assert.equal(second.ok, true, `second call failed: ${JSON.stringify(second.error)}`);
    const replayFlags = [first.data.replayed, second.data.replayed].sort();
    assert.deepEqual(replayFlags, [false, true]);
    assert.equal(firstAudit.published.length + secondAudit.published.length, 1);

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.gap_log_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, seed.claimId]),
      client.query(`SELECT count(*)::int AS count FROM kai.client_followup_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, seed.claimId]),
    ]));
    assert.equal(counts[0].rows[0].count, 9);
    assert.equal(counts[1].rows[0].count, 4);
  });

  test("P2-04 (d): tenant isolation - a different organizationId with a matching claimId returns not_found and creates nothing", async () => {
    const seed = await seedPromotedClaim(4);
    const result = await repository.generateClaimGapsAndFollowups({
      organizationId: OTHER_ORG,
      claimId: seed.claimId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");

    const rowCount = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.gap_log_items WHERE organization_id = $1::uuid`,
      [OTHER_ORG],
    ));
    assert.equal(rowCount.rows[0].count, 0);
  });

  test("P2-04 (e): an unknown claim_id is rejected as not_found without creating any row", async () => {
    const result = await repository.generateClaimGapsAndFollowups({
      organizationId: ORG,
      claimId: "c9999999-0000-4000-8000-000000000999",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P2-04 (e): a superseded (non-current) source_version returns conflict_current_state_changed without creating any row", async () => {
    const seed = await seedPromotedClaim(5);
    await withClient((client) => client.query(
      `UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid`,
      [seed.sourceVersionId],
    ));
    const audit = createAuditProbe();

    const result = await repository.generateClaimGapsAndFollowups({
      organizationId: ORG,
      claimId: seed.claimId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "conflict_current_state_changed");
    assert.equal(audit.published.length, 0);

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.gap_log_items WHERE claim_id = $1::uuid`, [seed.claimId]),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'claim_gap_and_followup_generated' AND organization_id = $1::uuid AND intake_file_id = $2::uuid`, [ORG, seed.intakeFileId]),
    ]));
    assert.equal(counts[0].rows[0].count, 0);
    assert.equal(counts[1].rows[0].count, 0);
  });

  test("P2-04 (h): an all-clear assessment returns empty collections with zero writes and zero audit", async () => {
    // missingness/duplicates (never resolved_clear from a real committed
    // kai.data_quality_findings row - see
    // Backend/kai/validators/kaiEvidenceCoverageAssessmentValidators.js, which
    // only ever returns "unresolved" or "resolved_risk_flagged" for these two
    // dimensions) and denominator_clarity/time_period_clarity/
    // conflicting_source_indicators/requirement_alignment (always unresolved,
    // by P2-02 design, regardless of seeded state) make a genuinely real
    // all-resolved_clear source_version unreachable today. This test therefore
    // injects the ten-dimension result directly via the repository's
    // `computeDimensions` test seam - proving the P2-04 empty-expected-set
    // precheck/success path exactly as P2-02 already documents it will apply
    // once every dimension has an affirmative resolved_clear fact - while every
    // other integration test in this suite exercises the real P2-02 dimension
    // functions unmodified.
    const seed = await seedPromotedClaim(6);
    const audit = createAuditProbe();
    const allClearRepository = createPostgresClaimGapFollowupRepository({
      runInTransaction: (callback) => withRunnerOwnedTransaction(callback, pool),
      computeDimensions: () => {
        const clear = { validator_key: "VAL-KAI-P2-02-x", evidence: { assessment_status: "resolved_clear" } };
        return {
          missingness: clear, duplicates: clear, definition_clarity: clear, denominator_clarity: clear,
          time_period_clarity: clear, entity_level_clarity: clear, small_cell_risk: clear,
          conflicting_source_indicators: clear, requirement_alignment: clear, coverage_gaps: clear,
        };
      },
    });

    const result = await allClearRepository.generateClaimGapsAndFollowups({
      organizationId: ORG,
      claimId: seed.claimId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.gapItems.length, 0);
    assert.equal(result.data.clientFollowupItems.length, 0);
    assert.equal(result.data.reviewQueueItems.length, 0);
    assert.equal(audit.published.length, 0);

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.gap_log_items WHERE claim_id = $1::uuid`, [seed.claimId]),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'claim_gap_and_followup_generated' AND organization_id = $1::uuid AND intake_file_id = $2::uuid`, [ORG, seed.intakeFileId]),
    ]));
    assert.equal(counts[0].rows[0].count, 0);
    assert.equal(counts[1].rows[0].count, 0);
  });

  test("P2-04 (i): partial expected-set state (only some rows already exist) returns conflict_current_state_changed without repair", async () => {
    const seed = await seedPromotedClaim(7);
    await withClient((client) => client.query(
      `INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'missingness', 'unresolved', 'VAL-KAI-P2-02-missingness', 'Claim gap requires review for dimension: missingness.')`,
      [ORG, seed.claimId, seed.evidenceItemId, seed.sourceVersionId],
    ));
    const audit = createAuditProbe();

    const result = await repository.generateClaimGapsAndFollowups({
      organizationId: ORG,
      claimId: seed.claimId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "conflict_current_state_changed");
    assert.equal(audit.published.length, 0);

    const gapCount = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.gap_log_items WHERE claim_id = $1::uuid`,
      [seed.claimId],
    ));
    assert.equal(gapCount.rows[0].count, 1, "the pre-existing partial row must not be repaired into a complete set");
  });

  test("P2-04 (i): malformed existing routing state returns conflict_current_state_changed without repair", async () => {
    const seed = await seedPromotedClaim(14);
    const first = await repository.generateClaimGapsAndFollowups({
      organizationId: ORG,
      claimId: seed.claimId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    await withClient((client) => client.query(
      `DELETE FROM kai.review_queue_items
        WHERE organization_id = $1::uuid
          AND queue_type = 'client_followup'
          AND target_object_id = $2::uuid`,
      [ORG, first.data.reviewQueueItems[0].target_object_id],
    ));

    const audit = createAuditProbe();
    const result = await repository.generateClaimGapsAndFollowups({
      organizationId: ORG,
      claimId: seed.claimId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "conflict_current_state_changed");
    assert.equal(audit.published.length, 0);

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.client_followup_items WHERE claim_id = $1::uuid`, [seed.claimId]),
      client.query(
        `SELECT count(*)::int AS count
           FROM kai.review_queue_items q
           JOIN kai.client_followup_items f ON f.client_followup_item_id = q.target_object_id
          WHERE f.claim_id = $1::uuid`,
        [seed.claimId],
      ),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'claim_gap_and_followup_generated' AND intake_file_id = $1::uuid`, [seed.intakeFileId]),
    ]));
    assert.equal(counts[0].rows[0].count, 4);
    assert.equal(counts[1].rows[0].count, 3, "the missing queue row must not be repaired");
    assert.equal(counts[2].rows[0].count, 1, "only the original successful audit row should exist");
  });

  test("P2-04 (j): a rejected required-audit prepare rolls back every write", async () => {
    const seed = await seedPromotedClaim(8);
    const audit = createAuditProbe({ prepareOk: false });
    const result = await repository.generateClaimGapsAndFollowups({
      organizationId: ORG,
      claimId: seed.claimId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.gap_log_items WHERE claim_id = $1::uuid`, [seed.claimId]),
      client.query(`SELECT count(*)::int AS count FROM kai.client_followup_items WHERE claim_id = $1::uuid`, [seed.claimId]),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'claim_gap_and_followup_generated' AND intake_file_id = $1::uuid`, [seed.intakeFileId]),
    ]));
    assert.equal(counts[0].rows[0].count, 0);
    assert.equal(counts[1].rows[0].count, 0);
    assert.equal(counts[2].rows[0].count, 0);
  });

  test("P2-04 (j): a forced routing blocker rolls back gaps, follow-ups, queue rows, audit rows, and audit publication", async () => {
    const seed = await seedPromotedClaim(13);
    const audit = createAuditProbe();
    const blockingRepository = createPostgresClaimGapFollowupRepository({
      runInTransaction: (callback) => withRunnerOwnedTransaction(callback, pool),
      mutateRoutingPlansForTesting({ followupPlans, queuePlans }) {
        return {
          followupPlans,
          queuePlans: queuePlans.map((plan, index) =>
            index === 0
              ? { ...plan, target_object_id: "e9999999-0000-4000-8000-000000000099" }
              : plan,
          ),
        };
      },
    });

    const result = await blockingRepository.generateClaimGapsAndFollowups({
      organizationId: ORG,
      claimId: seed.claimId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, "validation_blocker");
    assert.equal(audit.published.length, 0);

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.gap_log_items WHERE claim_id = $1::uuid`, [seed.claimId]),
      client.query(`SELECT count(*)::int AS count FROM kai.client_followup_items WHERE claim_id = $1::uuid`, [seed.claimId]),
      client.query(
        `SELECT count(*)::int AS count
           FROM kai.review_queue_items q
           JOIN kai.client_followup_items f ON f.client_followup_item_id = q.target_object_id
          WHERE f.claim_id = $1::uuid`,
        [seed.claimId],
      ),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'claim_gap_and_followup_generated' AND intake_file_id = $1::uuid`, [seed.intakeFileId]),
    ]));
    assert.equal(counts[0].rows[0].count, 0);
    assert.equal(counts[1].rows[0].count, 0);
    assert.equal(counts[2].rows[0].count, 0);
    assert.equal(counts[3].rows[0].count, 0);
  });

  for (const [label, probeOptions, seedIndex] of [
    ["a synchronous publish() throw", { publishThrows: true }, 9],
    ["a rejected publish() promise", { publishRejects: true }, 10],
  ]) {
    test(`P2-04 (j): ${label} rolls back every write together`, async () => {
      const seed = await seedPromotedClaim(seedIndex);
      const audit = createAuditProbe(probeOptions);
      const result = await repository.generateClaimGapsAndFollowups({
        organizationId: ORG,
        claimId: seed.claimId,
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: audit.dependency,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "system_error");

      const count = await withClient((client) => client.query(
        `SELECT count(*)::int AS count FROM kai.gap_log_items WHERE claim_id = $1::uuid`,
        [seed.claimId],
      ));
      assert.equal(count.rows[0].count, 0);
    });
  }

  test("P2-04 (k): disabled KAI_SPRINT2_ENABLED returns feature_disabled with zero repository/DB activity", async () => {
    const seed = await seedPromotedClaim(11);
    const result = await generateClaimGapFollowups(
      { organizationId: ORG, claimId: seed.claimId, actorContext: humanActor(), now: NOW },
      { env: {}, claimGapFollowupRepository: repository, metadataOnlyAudit: createAuditProbe().dependency },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "feature_disabled");

    const count = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.gap_log_items WHERE claim_id = $1::uuid`,
      [seed.claimId],
    ));
    assert.equal(count.rows[0].count, 0);
  });

  test("P2-04: end-to-end via the service seam with KAI_SPRINT2_ENABLED, AUTH-KAI-003, and VAL-TEN-001, using the postgres repository", async () => {
    const seed = await seedPromotedClaim(12);

    const result = await generateClaimGapFollowups(
      { organizationId: ORG, claimId: seed.claimId, actorContext: humanActor(), now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: repository, metadataOnlyAudit: createAuditProbe().dependency },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.gapItems.length, 9);

    const deniedResult = await generateClaimGapFollowups(
      { organizationId: ORG, claimId: seed.claimId, actorContext: humanActor({ actorType: "ai" }), now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimGapFollowupRepository: repository, metadataOnlyAudit: createAuditProbe().dependency },
    );
    assert.equal(deniedResult.ok, false);
    assert.equal(deniedResult.error.code, "authorization_denied");
  });

  test("P2-04 catalog verifier: every expected check name appears exactly once with no FAIL", async () => {
    const verifierSql = readFileSync(
      new URL("../scripts/kai-sprint2-p2-04-claim-gap-followup-verifier.sql", import.meta.url),
      "utf8",
    );
    const result = await pool.query(verifierSql);
    const keys = result.rows.map((row) => `${row.check_name}::${row.object_name}`);
    assert.equal(keys.length, new Set(keys).size, "duplicate catalog-check rows found");
    assert.ok(!result.rows.some((row) => row.status === "FAIL"), "catalog verifier reported an unexpected FAIL");
  });
}
