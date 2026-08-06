import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_03_CLAIM_PROPOSAL_DATABASE_URL;

/**
 * PostgreSQL isolation (P2-01C pattern reapplied): the runner-owned database URL
 * is validated as loopback-only synchronously, before this file performs a
 * single dynamic import of `pg`, `Backend/kai/db/kaiDb.js`, or any P2-03 module -
 * and `Backend/kai/db/kaiDb.js` (which imports `Backend/db/pg.js`, itself
 * capable of import-time construction of the ambient application connection
 * pool from whatever DATABASE_URL/DATABASE_URL_LOCAL/etc happens to be set in
 * the process environment) is never imported anywhere in this file. A
 * non-loopback URL is rejected here, synchronously, before any connection
 * attempt of any kind.
 */
function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P2-03 integration suite refused a non-loopback KAI_P2_03_CLAIM_PROPOSAL_DATABASE_URL host: ${host}`);
  }
}

test("P2-03 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  for (const url of ["postgresql://user@example.com:5432/db", "postgresql://user@10.0.0.5:5432/db", "postgresql://user@my-internal-host.internal:5432/db"]) {
    assert.throws(() => assertLoopbackDatabaseUrl(url), /refused a non-loopback/);
  }
  for (const url of ["postgresql://user@127.0.0.1:59123/db", "postgresql://user@localhost:59123/db"]) {
    assert.doesNotThrow(() => assertLoopbackDatabaseUrl(url));
  }
});

test("P2-03 PostgreSQL isolation: this file imports no database module at its top level and never imports Backend/kai/db/kaiDb.js", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresClaimProposalRepository\.js|kaiClaimProposalService\.js/.test(line)),
    "expected every database-capable module to be imported dynamically, never at the top level");
  assert.doesNotMatch(ownSource, /from\s+["']\.\.\/Backend\/kai\/db\/kaiDb\.js["']/,
    "the P2-03 integration suite must never import the ambient kaiDb.js pool - it uses a test-local transaction wrapper over its own runner-owned Pool instead");
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P2-03 claim-proposal integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runClaimProposalIntegrationSuite();
}

async function runClaimProposalIntegrationSuite() {
  const { Pool } = await import("pg");
  const { createPostgresClaimProposalRepository } = await import(
    "../Backend/kai/dictionary/postgresClaimProposalRepository.js"
  );
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");

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

  const repository = createPostgresClaimProposalRepository({
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

  // A distinct id namespace ('c...') unused by any chained smoke-seed fixture,
  // avoiding any collision with committed Gate A/P1-04 through P2-01 smoke-seed
  // rows in this package's own local-postgres runner.
  function fileId(index) {
    return `c1000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function candidateId(index) {
    return `c2000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function sensitivityId(index) {
    return `c3000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function fileProfileId(index) {
    return `c4000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function dictionaryId(index) {
    return `c5000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function sourceId(index) {
    return `c6000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
  }
  function checksumFor(index) {
    const hex = index.toString(16).padStart(2, "0");
    return hex.repeat(32).slice(0, 64);
  }

  async function seedPromotedEvidenceItem(index, { organizationId = ORG } = {}) {
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
    await withClient((client) => client.query(
      `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'email', 'email', 'text')`,
      [dataDictionaryId, organizationId, fileProfileIdValue],
    ));
    const intakeSensitivityProfileId = sensitivityId(index);
    await withClient((client) => client.query(
      `INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::timestamptz)`,
      [intakeSensitivityProfileId, organizationId, intakeFileId, fileProfileIdValue, dataDictionaryId, checksum, NOW],
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

    // P2-01 evidence lineage: one locator + one evidence item + one open
    // evidence_review queue item, bound to the committed 'email' field.
    const locatorFingerprint = checksumFor(index + 1000);
    const statement = `Source version's committed data dictionary includes field "email" of committed type "text".`;
    const statementFingerprint = checksumFor(index + 2000);
    const locatorResult = await withClient((client) => client.query(
      `INSERT INTO kai.source_locators (organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
       VALUES ($1::uuid, $2::uuid, 'column', jsonb_build_object('column_name', 'email'), $3)
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
      [organizationId, sourceIdValue, sourceVersionId, sourceLocatorId, statement, statementFingerprint],
    ));
    const evidenceItemId = evidenceResult.rows[0].evidence_item_id;
    await withClient((client) => client.query(
      `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
       VALUES ($1::uuid, 'evidence_review', 'evidence_item', $2::uuid, 'normal', 'open', 'needs_gk_review', 'New evidence item requires GK review.',
               'Review the evidence item''s lineage, sensitivity, support strength, and audience eligibility before use.', '{}'::jsonb, 'system')`,
      [organizationId, evidenceItemId],
    ));

    return { organizationId, intakeFileId, intakeSourceCandidateId, sourceId: sourceIdValue, sourceVersionId, evidenceItemId, sourceLocatorId, locatorFingerprint };
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

  test("P2-03 (a): first proposal creates one claim, one canonical claim-evidence link, one open claim_review queue item with the exact required_action, one warning, and exactly one audit row", async () => {
    const seed = await seedPromotedEvidenceItem(1);
    const audit = createAuditProbe();

    const result = await repository.proposeClaim({
      organizationId: ORG,
      evidenceItemId: seed.evidenceItemId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.replayed, false);
    // Two warnings always fire in this package's current world: the evidence
    // item's own support_strength stays 'unassessed' and its evidence_review is
    // unresolved (VAL-KAI-P2-03-001), and requirement coverage is always
    // unresolved (VAL-KAI-P2-03-003, since no requirement-binding table exists
    // yet).
    assert.equal(result.data.warnings.length, 2);
    assert.equal(result.data.claim.claim_type, "finding");
    assert.equal(result.data.claim.claim_status, "proposed");
    assert.equal(result.data.claim.claim_review_status, "needs_gk_review");
    assert.equal(result.data.claim.claim_strength, "unassessed");
    assert.equal(result.data.claim.internal_only, true);
    assert.equal(result.data.claim.public_use_allowed, false);
    assert.equal(result.data.claim.funder_use_allowed, false);
    assert.equal(result.data.claim.llm_processing_allowed, false);
    assert.equal(result.data.claim.product_learning_allowed, false);
    assert.equal(result.data.claim.export_ready, false);
    assert.match(result.data.claim.statement, /^The promoted source contains the committed data-dictionary field "email" identified by locator /);
    assert.equal(result.data.claimEvidenceLink.claim_id, result.data.claim.claim_id);
    assert.equal(result.data.claimEvidenceLink.evidence_item_id, seed.evidenceItemId);
    assert.equal(result.data.reviewQueueItem.queue_status, "open");
    assert.equal(
      result.data.reviewQueueItem.required_action,
      "Review the claim's evidence lineage, support strength, limitations, requirement coverage, and audience eligibility before any use.",
    );
    assert.equal(audit.published.length, 1);

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`, [ORG, seed.evidenceItemId]),
      client.query(`SELECT count(*)::int AS count FROM kai.claim_evidence_links WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, result.data.claim.claim_id]),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'claim_proposed' AND organization_id = $1::uuid AND intake_file_id = $2::uuid`, [ORG, seed.intakeFileId]),
    ]));
    assert.equal(counts[0].rows[0].count, 1);
    assert.equal(counts[1].rows[0].count, 1);
    assert.equal(counts[2].rows[0].count, 1);

    const auditRow = await withClient((client) => client.query(
      `SELECT metadata FROM kai.upload_lifecycle_audit WHERE operation = 'claim_proposed' AND organization_id = $1::uuid AND intake_file_id = $2::uuid`,
      [ORG, seed.intakeFileId],
    ));
    assert.deepEqual(
      Object.keys(auditRow.rows[0].metadata).sort(),
      [
        "claim_id", "claim_review_status", "claim_status", "claim_type", "contract", "evidence_item_id",
        "fresh_write_count", "metadata_only", "requirement_coverage_status", "review_queue_item_count",
        "validator_key", "warning_count",
      ],
    );
    assert.equal(auditRow.rows[0].metadata.claim_id, result.data.claim.claim_id);
    assert.ok(!("claim_statement" in auditRow.rows[0].metadata));
  });

  test("P2-03 (b): replaying the identical call is a full no-op - zero new rows, zero new audit rows, replayed: true", async () => {
    const seed = await seedPromotedEvidenceItem(2);
    const first = await repository.proposeClaim({
      organizationId: ORG,
      evidenceItemId: seed.evidenceItemId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(first.ok, true, JSON.stringify(first));

    const secondAudit = createAuditProbe();
    const second = await repository.proposeClaim({
      organizationId: ORG,
      evidenceItemId: seed.evidenceItemId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: secondAudit.dependency,
    });
    assert.equal(second.ok, true);
    assert.equal(second.data.replayed, true);
    assert.equal(secondAudit.published.length, 0);
    assert.equal(second.data.claim.claim_id, first.data.claim.claim_id);

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`, [ORG, seed.evidenceItemId]),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'claim_proposed' AND organization_id = $1::uuid AND intake_file_id = $2::uuid`, [ORG, seed.intakeFileId]),
    ]));
    assert.equal(counts[0].rows[0].count, 1);
    assert.equal(counts[1].rows[0].count, 1);
  });

  test("P2-03 (c): two genuinely overlapping proposal calls for the same evidence_item converge to the same claim with exactly one audit row published between them", async () => {
    const seed = await seedPromotedEvidenceItem(3);

    let arrived = 0;
    let openGate;
    const gateOpened = new Promise((resolve) => { openGate = resolve; });
    async function gate() {
      arrived += 1;
      if (arrived >= 2) openGate();
      await gateOpened;
    }
    const racingRepository = createPostgresClaimProposalRepository({
      runInTransaction: (callback) => withRunnerOwnedTransaction(callback, pool),
      beforeInsert: gate,
    });

    const firstAudit = createAuditProbe();
    const secondAudit = createAuditProbe();
    const [first, second] = await Promise.all([
      racingRepository.proposeClaim({
        organizationId: ORG,
        evidenceItemId: seed.evidenceItemId,
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: firstAudit.dependency,
      }),
      racingRepository.proposeClaim({
        organizationId: ORG,
        evidenceItemId: seed.evidenceItemId,
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: secondAudit.dependency,
      }),
    ]);
    assert.equal(arrived, 2);

    assert.equal(first.ok, true, `first call failed: ${JSON.stringify(first.error)}`);
    assert.equal(second.ok, true, `second call failed: ${JSON.stringify(second.error)}`);
    assert.equal(first.data.claim.claim_id, second.data.claim.claim_id);
    const replayFlags = [first.data.replayed, second.data.replayed].sort();
    assert.deepEqual(replayFlags, [false, true]);
    assert.equal(firstAudit.published.length + secondAudit.published.length, 1);

    const rows = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`, [ORG, seed.evidenceItemId]),
      client.query(`SELECT count(*)::int AS count FROM kai.claim_evidence_links WHERE organization_id = $1::uuid AND claim_id = $2::uuid`, [ORG, first.data.claim.claim_id]),
    ]));
    assert.equal(rows[0].rows[0].count, 1);
    assert.equal(rows[1].rows[0].count, 1);
  });

  test("P2-03 (d): tenant isolation - a different organizationId with a matching evidenceItemId returns not_found and creates nothing", async () => {
    const seed = await seedPromotedEvidenceItem(4);
    const result = await repository.proposeClaim({
      organizationId: OTHER_ORG,
      evidenceItemId: seed.evidenceItemId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");

    const rowCount = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.claims WHERE organization_id = $1::uuid`,
      [OTHER_ORG],
    ));
    assert.equal(rowCount.rows[0].count, 0);
  });

  test("P2-03 (e): an unknown evidence_item_id is rejected as not_found without creating any row", async () => {
    const result = await repository.proposeClaim({
      organizationId: ORG,
      evidenceItemId: "a9999999-0000-4000-8000-000000000999",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
  });

  test("P2-03 (e): a missing evidence_review queue item is rejected as not_found without creating any row", async () => {
    const seed = await seedPromotedEvidenceItem(5);
    await withClient((client) => client.query(
      `DELETE FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_id = $2::uuid`,
      [ORG, seed.evidenceItemId],
    ));
    const result = await repository.proposeClaim({
      organizationId: ORG,
      evidenceItemId: seed.evidenceItemId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: createAuditProbe().dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
    const count = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.claims WHERE evidence_item_id = $1::uuid`,
      [seed.evidenceItemId],
    ));
    assert.equal(count.rows[0].count, 0);
  });

  // NOTE: the evidence_review-pair compatibility check inside
  // validateClaimHasLoadBearingEvidence (queue_type/target_object_type/
  // target_object_id equality) has no reachable real-row failure mode at this
  // integration layer, exactly like P2-01's own documented precedent for its
  // check 9 - the repository's own getScopedEvidenceReviewQueueItemByEvidenceItemId
  // lookup already filters on queue_type = 'evidence_review' AND
  // target_object_type = 'evidence_item' AND target_object_id = evidenceItemId,
  // so any row it returns already satisfies the compatibility check by
  // construction; mutating any of those columns on a committed row only makes
  // the lookup return null (not_found), never an incompatible-but-found row.
  // This check's full failure-mode coverage lives in
  // kai-sprint2-p2-03-claim-proposal-boundary.spec.js ("an evidence_review pair
  // with mismatched target identity returns conflict_current_state_changed"),
  // which exercises it directly against synthetic row objects.

  test("P2-03 (f): a rejected required-audit prepare rolls back every write", async () => {
    const seed = await seedPromotedEvidenceItem(8);
    const audit = createAuditProbe({ prepareOk: false });
    const result = await repository.proposeClaim({
      organizationId: ORG,
      evidenceItemId: seed.evidenceItemId,
      actorUserId: "90000000-0000-4000-8000-000000000001",
      now: NOW,
      metadataOnlyAudit: audit.dependency,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "validation_blocker");

    const counts = await withClient((client) => Promise.all([
      client.query(`SELECT count(*)::int AS count FROM kai.claims WHERE evidence_item_id = $1::uuid`, [seed.evidenceItemId]),
      client.query(`SELECT count(*)::int AS count FROM kai.claim_evidence_links WHERE evidence_item_id = $1::uuid`, [seed.evidenceItemId]),
      client.query(`SELECT count(*)::int AS count FROM kai.upload_lifecycle_audit WHERE operation = 'claim_proposed' AND intake_file_id = $1::uuid`, [seed.intakeFileId]),
    ]));
    assert.equal(counts[0].rows[0].count, 0);
    assert.equal(counts[1].rows[0].count, 0);
    assert.equal(counts[2].rows[0].count, 0);
  });

  for (const [label, probeOptions, seedIndex] of [
    ["a synchronous publish() throw", { publishThrows: true }, 9],
    ["a rejected publish() promise", { publishRejects: true }, 10],
  ]) {
    test(`P2-03 (f): ${label} rolls back every write together`, async () => {
      const seed = await seedPromotedEvidenceItem(seedIndex);
      const audit = createAuditProbe(probeOptions);
      const result = await repository.proposeClaim({
        organizationId: ORG,
        evidenceItemId: seed.evidenceItemId,
        actorUserId: "90000000-0000-4000-8000-000000000001",
        now: NOW,
        metadataOnlyAudit: audit.dependency,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "system_error");

      const count = await withClient((client) => client.query(
        `SELECT count(*)::int AS count FROM kai.claims WHERE evidence_item_id = $1::uuid`,
        [seed.evidenceItemId],
      ));
      assert.equal(count.rows[0].count, 0);
    });
  }

  test("P2-03 (g): disabled KAI_SPRINT2_ENABLED returns feature_disabled with zero repository/DB activity", async () => {
    const seed = await seedPromotedEvidenceItem(11);
    const result = await proposeClaim(
      { organizationId: ORG, evidenceItemId: seed.evidenceItemId, actorContext: humanActor(), now: NOW },
      { env: {}, claimProposalRepository: repository, metadataOnlyAudit: createAuditProbe().dependency },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "feature_disabled");

    const count = await withClient((client) => client.query(
      `SELECT count(*)::int AS count FROM kai.claims WHERE evidence_item_id = $1::uuid`,
      [seed.evidenceItemId],
    ));
    assert.equal(count.rows[0].count, 0);
  });

  test("P2-03: end-to-end via the service seam with KAI_SPRINT2_ENABLED, AUTH-KAI-003, and VAL-TEN-001, using the postgres repository", async () => {
    const seed = await seedPromotedEvidenceItem(12);

    const result = await proposeClaim(
      { organizationId: ORG, evidenceItemId: seed.evidenceItemId, actorContext: humanActor(), now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: repository, metadataOnlyAudit: createAuditProbe().dependency },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.claim.evidence_item_id, seed.evidenceItemId);

    const deniedResult = await proposeClaim(
      { organizationId: ORG, evidenceItemId: seed.evidenceItemId, actorContext: humanActor({ actorType: "ai" }), now: NOW },
      { env: { KAI_SPRINT2_ENABLED: "true" }, claimProposalRepository: repository, metadataOnlyAudit: createAuditProbe().dependency },
    );
    assert.equal(deniedResult.ok, false);
    assert.equal(deniedResult.error.code, "authorization_denied");
  });

  test("P2-03 catalog verifier: every expected check name appears exactly once with no FAIL", async () => {
    const verifierSql = readFileSync(
      new URL("../scripts/kai-sprint2-p2-03-claim-proposal-verifier.sql", import.meta.url),
      "utf8",
    );
    const result = await pool.query(verifierSql);
    const keys = result.rows.map((row) => `${row.check_name}::${row.object_name}`);
    assert.equal(keys.length, new Set(keys).size, "duplicate catalog-check rows found");
    assert.ok(!result.rows.some((row) => row.status === "FAIL"), "catalog verifier reported an unexpected FAIL");
  });
}
