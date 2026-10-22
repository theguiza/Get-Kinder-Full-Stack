import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/**
 * KAI P2-01M real-PostgreSQL proof, run only by
 *   node scripts/kai-sprint2-p2-01m-source-record-count-measurement-local-postgres.js
 * against that runner's disposable loopback cluster (with the additive
 * P2-01M migration applied over the existing P2 schema). Skipped otherwise.
 *
 * Real: the P1 deterministic profiler on real synthetic CSV bytes, the
 * P2-01M service/repository/validators, the unchanged P2-01 lineage and
 * allowed-use validators, P2-03 claim proposal, P2-04 gap generation, P2-06
 * traceability, the eligible-claims projection, every SQL statement and
 * constraint, and the required audit row.
 * Simulated: the P1-03 persistence of that profile and the promoted lineage
 * rows (inserted directly with the kernel's own output, the shape the P1
 * worker and P1-07/P1-08 write), and the human actors' identities.
 */
const DATABASE_URL = process.env.KAI_P2_01M_MEASUREMENT_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`P2-01M integration suite refused a non-loopback database URL host: ${host}`);
  }
}

test("P2-01M isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

if (!DATABASE_URL) {
  test("P2-01M record-count measurement integration requires its runner", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(DATABASE_URL);
  await runSuite();
}

async function runSuite() {
  const { Pool } = await import("pg");
  const { profileLocalTrustedFile } = await import("../Backend/kai/profiling/localProfilingKernel.js");
  const { recordSourceRecordCountMeasurement } = await import("../Backend/kai/services/kaiSourceMeasurementService.js");
  const { createPostgresSourceMeasurementRepository } = await import("../Backend/kai/dictionary/postgresSourceMeasurementRepository.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { createPostgresClaimTraceabilityRepository } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");
  const { listEligibleClaimsForAudience } = await import("../Backend/kai/services/kaiEligibleClaimsForAudienceService.js");
  const { createPostgresEligibleClaimsForAudienceRepository } = await import("../Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { createPostgresHumanReviewRepository } = await import("../Backend/kai/dictionary/postgresHumanReviewRepository.js");
  const { acceptInternalCoverageLimitation } = await import("../Backend/kai/services/kaiCoverageReviewDecisionService.js");
  const { createPostgresCoverageReviewDecisionRepository } = await import("../Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js");
  const { completeClientFollowup } = await import("../Backend/kai/services/kaiClientFollowupCompletionService.js");
  const { createPostgresClientFollowupCompletionRepository } = await import("../Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");

  const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
  const ORG = "0e000000-0000-4000-8000-000000000a01";
  const OTHER_ORG = "0e000000-0000-4000-8000-000000000b01";
  // Field-presence lineage created through the real P2-01/P2-03 paths BEFORE
  // the P2-01M migration (the runner's legacy_seed phase).
  const LEGACY_ORG = "0e000000-0000-4000-8000-000000000c01";
  const PHASE = process.env.KAI_P2_01M_PHASE || "main";
  const BATCH = "1e000000-0000-4000-8000-000000000001";
  const NOW = "2026-10-22T12:00:00.000Z";
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false, max: 8 });
  test.after(async () => { await pool.end(); });

  async function withTx(callback) {
    const client = await pool.connect();
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
  const query = async (sql, params = []) => (await pool.query(sql, params)).rows;
  const measurementRepository = createPostgresSourceMeasurementRepository({ runInTransaction: withTx });
  const claimRepository = createPostgresClaimProposalRepository({ runInTransaction: withTx });
  const gapRepository = createPostgresClaimGapFollowupRepository({ runInTransaction: withTx });
  const traceRepository = createPostgresClaimTraceabilityRepository({ runInTransaction: withTx });
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

  const human = (organizationId, roleName, suffix) => ({
    actorType: "human",
    actorUserId: `9e000000-0000-4000-8000-0000000000${suffix}`,
    kaiRoles: [],
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: roleName }],
  });
  const ADMIN = human(ORG, "client_admin", "01");
  const LEGACY_ADMIN = human(LEGACY_ORG, "client_admin", "06");
  const REVIEWER = human(ORG, "client_reviewer", "02");
  const CONTRIBUTOR = human(ORG, "client_contributor", "03");
  const OTHER_ADMIN = human(OTHER_ORG, "client_admin", "04");
  const GK_REVIEWER = human(ORG, "gk_reviewer", "05");

  // Synthetic activity log: one data record per programme session. It has an
  // empty line (not a record), a record with a missing attendee count (still a
  // session), and two identical records (both counted; no rule says a repeated
  // session row is invalid).
  const CSV = [
    "session_date,programme,attendees",
    "2026-09-02,literacy,12",
    "2026-09-09,literacy,",
    "",
    "2026-09-16,mentoring,8",
    "2026-09-16,mentoring,8",
    "2026-09-23,mentoring,11",
    "",
  ].join("\n");
  const DEFINITION = Object.freeze({
    counted_unit: "programme session",
    unit_label: "programme sessions",
    definition_text: "Each row of the session log records one delivered programme session.",
    inclusion_rule: "Every data row after the header row that has at least one value.",
    exclusion_rule: "The header row and empty rows.",
    period_start: "2026-09-01",
    period_end: "2026-09-30",
  });

  // Independent verifier over the same bytes, sharing no code with KAI:
  // non-empty lines after the header.
  function independentRecordCount(text) {
    return text.split(/\r?\n/).slice(1).filter((line) => line.split(",").some((cell) => cell.trim() !== "")).length;
  }

  async function kernelProfile(text) {
    const bytes = new TextEncoder().encode(text);
    return profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: bytes.byteLength, bytes });
  }

  // Distinct id ranges per phase (the two phases are separate processes).
  let seedIndex = PHASE === "legacy_seed" ? 900 : 0;
  async function seedPromotedSource({ organizationId = ORG, profile, allowedUse = "unknown" }) {
    seedIndex += 1;
    const n = String(seedIndex).padStart(12, "0");
    const ids = {
      intakeFileId: `2e000000-0000-4000-8000-${n}`,
      fileProfileId: `5e000000-0000-4000-8000-${n}`,
      dataDictionaryId: `6e000000-0000-4000-8000-${n}`,
      sensitivityProfileId: `8e000000-0000-4000-8000-${n}`,
      candidateId: `9e100000-0000-4000-8000-${n}`,
      sourceId: `ae000000-0000-4000-8000-${n}`,
    };
    const checksum = createHash("sha256").update(`file-${seedIndex}-${organizationId}`).digest("hex");
    const profileSha = createHash("sha256").update(JSON.stringify(profile)).digest("hex");
    await query(
      `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename, checksum, hash_algorithm,
         force_new_version, processing_status, parse_status, file_policy_status, upload_state, object_version_id, verified_checksum,
         verified_size_bytes, verified_at, upload_state_changed_at, upload_expires_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'sessions.csv', 'sessions.csv', $4, 'sha256', true, 'quarantined', 'quarantined', 'passed',
               'confirmed', 'v1', $4, 1024, $5::timestamptz, $5::timestamptz, $5::timestamptz + interval '24 hours', $5::timestamptz)`,
      [ids.intakeFileId, BATCH, organizationId, checksum, NOW]);
    const [run] = await query(
      `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', $4::timestamptz) RETURNING parser_run_id::text`,
      [organizationId, ids.intakeFileId, checksum, NOW]);
    await query(
      `INSERT INTO kai.intake_file_profiles (file_profile_id, organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'kai_local_profiling_kernel', '1.0.0', $5, $6::jsonb, $7)`,
      [ids.fileProfileId, organizationId, ids.intakeFileId, run.parser_run_id, checksum, JSON.stringify(profile), profileSha]);
    await query(
      `INSERT INTO kai.data_dictionaries (data_dictionary_id, organization_id, intake_file_id, file_profile_id, profile_canonical_sha256)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)`,
      [ids.dataDictionaryId, organizationId, ids.intakeFileId, ids.fileProfileId, profileSha]);
    for (const field of (profile.fields || [{ field_key: "field_1" }])) {
      await query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, 'number')`,
        [ids.dataDictionaryId, organizationId, ids.fileProfileId, field.field_key]);
    }
    await query(
      `INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id,
         profile_canonical_sha256, small_cell_risk_status, allowed_use_status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, 'unknown', $7)`,
      [ids.sensitivityProfileId, organizationId, ids.intakeFileId, ids.fileProfileId, ids.dataDictionaryId, profileSha, allowedUse]);
    await query(
      `INSERT INTO kai.intake_source_candidates (intake_source_candidate_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id,
         intake_sensitivity_profile_id, profile_canonical_sha256, candidate_status, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, 'promoted', 'human')`,
      [ids.candidateId, organizationId, ids.intakeFileId, ids.fileProfileId, ids.dataDictionaryId, ids.sensitivityProfileId, profileSha]);
    const [reviewItem] = await query(
      `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status,
         summary, required_action, queue_metadata, created_by_type)
       VALUES ($1::uuid, 'source_candidate_review', 'intake_source_candidate', $2::uuid, 'medium', 'resolved', 'resolved',
               'Review intake source-candidate stub for human classification.', 'Human review is required.', '{"p0_stub":true}'::jsonb, 'human')
       RETURNING review_queue_item_id::text`,
      [organizationId, ids.candidateId]);
    await query(
      `INSERT INTO kai.sources (source_id, organization_id, source_code, reviewed_source_type, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3, 'organization_primary_record', 'human')`,
      [ids.sourceId, organizationId, checksum]);
    const [version] = await query(
      `INSERT INTO kai.source_versions (organization_id, source_id, intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'human') RETURNING source_version_id::text`,
      [organizationId, ids.sourceId, ids.candidateId, ids.sensitivityProfileId, profileSha]);
    await query(
      `INSERT INTO kai.intake_promotion_decisions (organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type,
         decision_status, source_id, source_version_id, promoted_at, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'organization_primary_record', 'promoted', $4::uuid, $5::uuid, $6::timestamptz, 'human')`,
      [organizationId, ids.candidateId, reviewItem.review_queue_item_id, ids.sourceId, version.source_version_id, NOW]);
    return { ...ids, sourceVersionId: version.source_version_id, profileSha };
  }

  const evidenceRepository = createPostgresEvidenceLineageRepository({ runInTransaction: withTx });
  const extractLegacy = (sourceVersionId) => extractEvidenceFromSourceVersion(
    { organizationId: LEGACY_ORG, sourceVersionId, actorContext: LEGACY_ADMIN, now: NOW },
    { env: ENV, evidenceLineageRepository: evidenceRepository, metadataOnlyAudit: noAudit() },
  );
  const proposeLegacy = (evidenceItemId) => proposeClaim(
    { organizationId: LEGACY_ORG, evidenceItemId, actorContext: LEGACY_ADMIN, now: NOW },
    { env: ENV, claimProposalRepository: claimRepository, metadataOnlyAudit: noAudit() },
  );
  const legacyRows = () => query(
    `SELECT e.evidence_item_id::text, e.evidence_type, e.data_class, e.statement, e.statement_fingerprint,
            l.locator_type, l.coordinates, c.claim_id::text, c.statement AS claim_statement, c.statement_fingerprint AS claim_fingerprint
       FROM kai.evidence_items e
       JOIN kai.source_locators l ON l.source_locator_id = e.source_locator_id
       LEFT JOIN kai.claims c ON c.evidence_item_id = e.evidence_item_id AND c.organization_id = e.organization_id
      WHERE e.organization_id = $1::uuid
      ORDER BY e.statement`, [LEGACY_ORG]);

  if (PHASE === "legacy_seed") {
    test("legacy seed (pre-migration schema): real P2-01 field-presence evidence and a real P2-03 claim", async () => {
      const legacy = await seedPromotedSource({
        organizationId: LEGACY_ORG,
        profile: { status: "profiled", format: "csv", counts: { row_count: 2, column_count: 2, field_count: 2 }, fields: [{ field_key: "field_1" }, { field_key: "field_2" }] },
      });
      const extracted = await extractLegacy(legacy.sourceVersionId);
      assert.equal(extracted.ok, true, JSON.stringify(extracted));
      assert.equal(extracted.data.evidenceItems.length, 2);
      const proposal = await proposeLegacy(extracted.data.evidenceItems[0].evidence_item_id);
      assert.equal(proposal.ok, true, JSON.stringify(proposal));
      await query("CREATE TABLE IF NOT EXISTS public.p2_01m_legacy_fixture (source_version_id uuid PRIMARY KEY)");
      await query("INSERT INTO public.p2_01m_legacy_fixture VALUES ($1::uuid)", [legacy.sourceVersionId]);
    });
    return;
  }

  const record = (sourceVersionId, { actor = ADMIN, organizationId = ORG, definition = DEFINITION, env = ENV } = {}) =>
    recordSourceRecordCountMeasurement(
      { organizationId, sourceVersionId, definition, actorContext: actor, now: NOW },
      { env, sourceMeasurementRepository: measurementRepository },
    );
  const propose = (evidenceItemId, actor = ADMIN) =>
    proposeClaim({ organizationId: ORG, evidenceItemId, actorContext: actor, now: NOW },
      { env: ENV, claimProposalRepository: claimRepository, metadataOnlyAudit: noAudit() });
  const trace = (claimId) => getClaimTraceabilitySummary(
    { organizationId: ORG, claimId, requestedAudience: "internal", actorContext: GK_REVIEWER },
    { env: ENV, claimTraceabilityRepository: traceRepository },
  );

  async function measurementCounts() {
    // Scoped to this suite's organizations: other suites share the cluster.
    const [row] = await query(`SELECT
      (SELECT count(*) FROM kai.source_measurement_definitions WHERE organization_id = ANY($1::uuid[]))::int AS definitions,
      (SELECT count(*) FROM kai.evidence_measurements WHERE organization_id = ANY($1::uuid[]))::int AS measurements,
      (SELECT count(*) FROM kai.evidence_items WHERE organization_id = ANY($1::uuid[]) AND evidence_type = 'source_record_count_measurement')::int AS measurement_evidence,
      (SELECT count(*) FROM kai.source_locators WHERE organization_id = ANY($1::uuid[]) AND locator_type = 'source_data_records')::int AS record_locators,
      (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = ANY($1::uuid[]) AND queue_type = 'evidence_review')::int AS evidence_queue,
      (SELECT count(*) FROM kai.audit_events WHERE organization_id = ANY($1::uuid[]) AND action = 'record_source_record_count_measurement')::int AS audits,
      (SELECT count(*) FROM kai.claims WHERE organization_id = ANY($1::uuid[]))::int AS claims,
      (SELECT count(*) FROM kai.gap_log_items WHERE organization_id = ANY($1::uuid[]))::int AS gaps,
      (SELECT count(*) FROM kai.client_followup_items WHERE organization_id = ANY($1::uuid[]))::int AS followups`, [[ORG, OTHER_ORG]]);
    return row;
  }

  const ids = {};

  test("the real P1 profiler counts the session log, and an independent count of the same bytes agrees", async () => {
    const profile = await kernelProfile(CSV);
    assert.equal(profile.status, "profiled");
    assert.equal(profile.format, "csv");
    assert.equal(profile.counts.row_count, 6, "data records after the header, including the empty line");
    assert.equal(profile.counts.blank_record_count, 1);
    assert.equal(profile.counts.duplicate_row_count, 2);
    assert.equal(independentRecordCount(CSV), 5);
    assert.equal(profile.counts.row_count - profile.counts.blank_record_count, independentRecordCount(CSV));
    ids.profile = profile;
    ids.main = await seedPromotedSource({ profile });
  });

  test("without a complete human definition nothing is written and the blocker names what is missing", async () => {
    const before = await measurementCounts();
    for (const [definition, reason] of [
      [null, "measurement_definition_required"],
      [{}, "measurement_definition_incomplete"],
      [{ ...DEFINITION, definition_text: "" }, "measurement_definition_incomplete"],
      [{ ...DEFINITION, counted_unit: "<script>" }, "measurement_definition_label_invalid"],
      [{ ...DEFINITION, inclusion_rule: "see https://example.org" }, "measurement_definition_text_invalid"],
      [{ ...DEFINITION, period_end: undefined }, "measurement_period_incomplete"],
      [{ ...DEFINITION, period_start: "2026-10-01" }, "measurement_period_invalid"],
      [{ ...DEFINITION, period_start: "2026-02-30" }, "measurement_period_invalid"],
      [{ ...DEFINITION, denominator: "households" }, "measurement_definition_unknown_field"],
    ]) {
      const result = await record(ids.main.sourceVersionId, { definition });
      assert.equal(result.ok, false, reason);
      assert.equal(result.error.code, "validation_blocker", reason);
      assert.equal(result.blockers[0].blocking_reason, reason);
    }
    assert.deepEqual(await measurementCounts(), before, "nothing written");
  });

  test("an authorized administrator's definition yields governed measurement evidence with the computed value, definition, version, and locator", async () => {
    const before = await measurementCounts();
    const result = await record(ids.main.sourceVersionId);
    assert.equal(result.ok, true, JSON.stringify(result));
    const { evidenceItem, measurement, definition, sourceLocator, reviewQueueItem, replayed } = result.data;
    assert.equal(replayed, false);
    assert.deepEqual(
      [evidenceItem.evidence_type, evidenceItem.data_class, evidenceItem.sensitivity_level, evidenceItem.support_strength, evidenceItem.evidence_review_status],
      ["source_record_count_measurement", "source_derived_aggregate", "unknown", "unassessed", "needs_gk_review"]);
    assert.deepEqual(
      [evidenceItem.internal_only, evidenceItem.public_use_allowed, evidenceItem.funder_use_allowed, evidenceItem.llm_processing_allowed, evidenceItem.product_learning_allowed],
      [true, false, false, false, false]);
    assert.equal(evidenceItem.source_version_id, ids.main.sourceVersionId);
    assert.equal(evidenceItem.created_by, ADMIN.actorUserId);
    assert.equal(
      evidenceItem.statement,
      "Source version record count: 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30, counting each CSV data record after the header row as one programme session; 1 blank record excluded; 2 exact-duplicate records included.");
    assert.deepEqual(
      [measurement.measured_value, measurement.total_record_count, measurement.blank_record_count, measurement.duplicate_record_count, measurement.unit_label, measurement.calculation_method, measurement.profile_canonical_sha256],
      [independentRecordCount(CSV), 6, 1, 2, "programme sessions", "p1_csv_profile_data_records_excluding_blank_v1", ids.main.profileSha]);
    assert.deepEqual(
      [definition.counted_unit, definition.definition_text, definition.inclusion_rule, definition.exclusion_rule, definition.period_start, definition.period_end, definition.definition_status, definition.created_by, definition.created_by_type],
      [DEFINITION.counted_unit, DEFINITION.definition_text, DEFINITION.inclusion_rule, DEFINITION.exclusion_rule, "2026-09-01", "2026-09-30", "human_confirmed", ADMIN.actorUserId, "human"]);
    assert.equal(measurement.source_measurement_definition_id, definition.source_measurement_definition_id);
    assert.deepEqual([sourceLocator.locator_type, sourceLocator.coordinates], ["source_data_records", { scope: "data_records_after_header" }]);
    assert.equal(evidenceItem.source_locator_id, sourceLocator.source_locator_id);
    assert.deepEqual([reviewQueueItem.queue_type, reviewQueueItem.target_object_id, reviewQueueItem.queue_status], ["evidence_review", evidenceItem.evidence_item_id, "open"]);
    const after = await measurementCounts();
    assert.deepEqual(after, { ...before, definitions: before.definitions + 1, measurements: before.measurements + 1, measurement_evidence: before.measurement_evidence + 1, record_locators: before.record_locators + 1, evidence_queue: before.evidence_queue + 1, audits: before.audits + 1 });
    assert.deepEqual([after.gaps, after.followups], [before.gaps, before.followups], "no gap or client follow-up is created by a measurement");
    const [audit] = await query(
      "SELECT actor_user_id::text, actor_type, organization_id::text, reason_code, metadata->>'object_id' AS object_id FROM kai.audit_events WHERE action = 'record_source_record_count_measurement' AND organization_id = $1::uuid",
      [ORG]);
    assert.deepEqual(audit, { actor_user_id: ADMIN.actorUserId, actor_type: "human", organization_id: ORG, reason_code: "source_record_count_measured", object_id: evidenceItem.evidence_item_id });
    // No row-level value is persisted anywhere by this operation.
    assert.doesNotMatch(JSON.stringify(result.data), /literacy|mentoring|2026-09-16|attendees/);
    ids.measurementEvidenceId = evidenceItem.evidence_item_id;
  });

  test("repeats replay with zero writes, a different definition is refused, and concurrent identical requests converge", async () => {
    const before = await measurementCounts();
    const replay = await record(ids.main.sourceVersionId);
    assert.equal(replay.ok, true);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.evidenceItem.evidence_item_id, ids.measurementEvidenceId);
    const changed = await record(ids.main.sourceVersionId, { definition: { ...DEFINITION, counted_unit: "attendance record" } });
    assert.equal(changed.ok, false);
    assert.equal(changed.error.code, "conflict_current_state_changed");
    assert.equal(changed.blockers[0].blocking_reason, "measurement_definition_already_recorded");
    assert.deepEqual(await measurementCounts(), before);

    const fresh = await seedPromotedSource({ profile: ids.profile });
    const raced = await Promise.all([record(fresh.sourceVersionId), record(fresh.sourceVersionId), record(fresh.sourceVersionId)]);
    assert.ok(raced.every((result) => result.ok), JSON.stringify(raced));
    assert.equal(raced.filter((result) => result.data.replayed === false).length, 1);
    assert.equal(new Set(raced.map((result) => result.data.evidenceItem.evidence_item_id)).size, 1);
    const after = await measurementCounts();
    assert.deepEqual([after.definitions, after.measurements, after.audits], [before.definitions + 1, before.measurements + 1, before.audits + 1]);
  });

  test("unauthorized actors, another tenant, a disabled feature, and non-human actors are refused with zero writes", async () => {
    const before = await measurementCounts();
    for (const actor of [REVIEWER, CONTRIBUTOR]) {
      const refused = await record(ids.main.sourceVersionId, { actor });
      assert.deepEqual([refused.ok, refused.error.code], [false, "authorization_denied"]);
    }
    const crossTenant = await record(ids.main.sourceVersionId, { actor: OTHER_ADMIN });
    assert.deepEqual([crossTenant.ok, crossTenant.error.code], [false, "authorization_denied"]);
    const otherScope = await record(ids.main.sourceVersionId, { actor: OTHER_ADMIN, organizationId: OTHER_ORG });
    assert.deepEqual([otherScope.ok, otherScope.error.code], [false, "not_found"], "another organization's version is never found");
    const system = await record(ids.main.sourceVersionId, { actor: { ...ADMIN, actorType: "system" } });
    assert.deepEqual([system.ok, system.error.code], [false, "authorization_denied"]);
    const disabled = await record(ids.main.sourceVersionId, { env: { KAI_SPRINT2_ENABLED: "false" } });
    assert.deepEqual([disabled.ok, disabled.error.code], [false, "feature_disabled"]);
    assert.deepEqual(await measurementCounts(), before);
  });

  test("prohibited use, a superseded version, a profile without blank counting, and a non-CSV profile are refused", async () => {
    const before = await measurementCounts();
    const prohibited = await seedPromotedSource({ profile: ids.profile, allowedUse: "not_allowed" });
    const refusedUse = await record(prohibited.sourceVersionId);
    assert.equal(refusedUse.ok, false);
    assert.equal(refusedUse.error.code, "validation_blocker");
    assert.equal(refusedUse.blockers[0].blocking_reason, "allowed_use_not_allowed");

    const legacyProfile = { status: "profiled", format: "csv", structural_metadata: { header_row_assumed: true }, counts: { row_count: 3, duplicate_row_count: 0 }, fields: [{ field_key: "field_1" }] };
    const legacy = await seedPromotedSource({ profile: legacyProfile });
    const refusedLegacy = await record(legacy.sourceVersionId);
    assert.equal(refusedLegacy.blockers[0].blocking_reason, "measurement_blank_record_count_not_committed");

    const sheet = await seedPromotedSource({ profile: { status: "profiled", format: "xlsx", sheets: [], fields: [{ field_key: "field_1" }] } });
    const refusedSheet = await record(sheet.sourceVersionId);
    assert.equal(refusedSheet.blockers[0].blocking_reason, "measurement_source_not_single_table_csv");

    const stale = await seedPromotedSource({ profile: ids.profile });
    await query("UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid", [stale.sourceVersionId]);
    const refusedStale = await record(stale.sourceVersionId);
    assert.deepEqual([refusedStale.ok, refusedStale.error.code], [false, "conflict_current_state_changed"]);
    assert.deepEqual(await measurementCounts(), before);
  });

  test("P2-03: the proposed claim states the measured value and definition, stays unreviewed, and creates no follow-up", async () => {
    const before = await measurementCounts();
    const proposal = await propose(ids.measurementEvidenceId);
    assert.equal(proposal.ok, true, JSON.stringify(proposal));
    const { claim } = proposal.data;
    assert.equal(
      claim.statement,
      "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30 (record count: one programme session per CSV data record; 1 blank record excluded, 2 exact-duplicate records included).");
    assert.deepEqual([claim.claim_type, claim.claim_status, claim.claim_review_status, claim.claim_strength, claim.internal_only, claim.export_ready],
      ["finding", "proposed", "needs_gk_review", "unassessed", true, false]);
    assert.equal(claim.evidence_item_id, ids.measurementEvidenceId);
    assert.doesNotMatch(claim.statement, /because|caused|improv|impact|increase|per cent|%|participants|households/i, "no causal, outcome, or denominator language");
    const replay = await propose(ids.measurementEvidenceId);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.claim.claim_id, claim.claim_id);
    const after = await measurementCounts();
    assert.deepEqual([after.claims, after.gaps, after.followups], [before.claims + 1, before.gaps, before.followups], "no premature P2-04 state");
    ids.measurementClaimId = claim.claim_id;
  });

  test("legacy records created before the migration keep their identities, and their P2-01/P2-03 replays are unchanged", async () => {
    const [{ source_version_id: legacyVersionId }] = await query("SELECT source_version_id::text FROM public.p2_01m_legacy_fixture");
    const before = await legacyRows();
    assert.equal(before.length, 2);
    assert.ok(before.every((row) => row.evidence_type === "dictionary_field_presence_fact" && row.data_class === "organization_committed_metadata" && row.locator_type === "column"));
    const extracted = await extractLegacy(legacyVersionId);
    assert.equal(extracted.ok, true, JSON.stringify(extracted));
    assert.equal(extracted.data.replayed, true, "re-extraction under the new schema writes nothing");
    const claimed = before.find((row) => row.claim_id);
    const replay = await proposeLegacy(claimed.evidence_item_id);
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.data.replayed, true);
    assert.deepEqual([replay.data.claim.claim_id, replay.data.claim.statement, replay.data.claim.statement_fingerprint],
      [claimed.claim_id, claimed.claim_statement, claimed.claim_fingerprint]);
    assert.deepEqual(await legacyRows(), before);
    // A measurement can be added beside legacy evidence without touching it.
    assert.equal((await record(legacyVersionId, { actor: LEGACY_ADMIN, organizationId: LEGACY_ORG })).ok, false, "the legacy profile has no blank-record count");
    assert.deepEqual(await legacyRows(), before);
  });

  test("P2-03 legacy: a field-presence claim from the same version keeps its exact template identity", async () => {
    const [locatorRow] = await query(
      `INSERT INTO kai.source_locators (organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
       VALUES ($1::uuid, $2::uuid, 'column', jsonb_build_object('column_name', 'field_1'), $3) RETURNING source_locator_id::text, locator_fingerprint`,
      [ORG, ids.main.sourceVersionId, "c".repeat(64)]);
    const [evidenceRow] = await query(
      `INSERT INTO kai.evidence_items (organization_id, source_id, source_version_id, source_locator_id, evidence_type, data_class,
         sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'dictionary_field_presence_fact', 'organization_committed_metadata', 'unknown', 'unassessed',
               'Source version''s committed data dictionary includes field "field_1" of committed type "number".', $5, 'human')
       RETURNING evidence_item_id::text`,
      [ORG, ids.main.sourceId, ids.main.sourceVersionId, locatorRow.source_locator_id, "d".repeat(64)]);
    await query(
      `INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
       VALUES ($1::uuid, 'evidence_review', 'evidence_item', $2::uuid, 'medium', 'open', 'needs_gk_review', 'New evidence item requires GK review.',
               'Review the evidence item''s lineage, sensitivity, support strength, and audience eligibility before use.', '{}'::jsonb, 'system')`,
      [ORG, evidenceRow.evidence_item_id]);
    const proposal = await propose(evidenceRow.evidence_item_id);
    assert.equal(proposal.ok, true, JSON.stringify(proposal));
    assert.equal(proposal.data.claim.statement,
      `The promoted source contains the committed data-dictionary field "field_1" identified by locator ${locatorRow.locator_fingerprint}.`);
    // The database still rejects a mixed type/class pairing.
    await assert.rejects(() => query(
      `UPDATE kai.evidence_items SET data_class = 'source_derived_aggregate' WHERE evidence_item_id = $1::uuid`, [evidenceRow.evidence_item_id]),
    /evidence_items_p2_01m_type_class_pairing_check/);
  });

  test("P2-06/eligibility: the measured claim needs the explicit P2-04 step, then traces with its value and stays ineligible until GK review", async () => {
    const before = await trace(ids.measurementClaimId);
    console.log(`[p2-01m] traceability before P2-04: ${JSON.stringify(before)}`);
    assert.equal(before.ok, false);
    assert.equal(before.error.code, "conflict_current_state_changed");
    assert.equal(before.data.traceability_conflict_reason, "gap_dimension_requires_missing_p204_state");
    const gaps = await generateClaimGapFollowups(
      { organizationId: ORG, claimId: ids.measurementClaimId, actorContext: ADMIN, now: NOW },
      { env: ENV, claimGapFollowupRepository: gapRepository, metadataOnlyAudit: noAudit() },
    );
    assert.equal(gaps.ok, true, JSON.stringify(gaps));
    const traced = await trace(ids.measurementClaimId);
    assert.equal(traced.ok, true, JSON.stringify(traced));
    console.log(`[p2-01m] traceability after explicit P2-04: eligible=${traced.data.eligible} blockers=${JSON.stringify(traced.data.blockerCodes)}`);
    assert.equal(traced.data.eligible, false, "an unreviewed measured claim is not eligible");
    assert.ok(JSON.stringify(traced.data).includes(ids.measurementEvidenceId), "traceability resolves the measurement evidence lineage");
    const eligible = await listEligibleClaimsForAudience(
      { organizationId: ORG, requestedAudience: "internal", limit: 100, afterClaimId: null, actorContext: GK_REVIEWER },
      { env: ENV, eligibleClaimsForAudienceRepository: createPostgresEligibleClaimsForAudienceRepository({ runInTransaction: withTx }) },
    );
    assert.equal(eligible.ok, true, JSON.stringify(eligible));
    assert.equal(eligible.data.eligibleClaims.some((item) => item.claimId === ids.measurementClaimId), false, "not in the eligible projection before review");
  });

  test("after the human reviews, the existing evaluator and eligible-claims reader consume the measured claim unchanged, value and limitations intact", async () => {
    const humanReviewRepository = createPostgresHumanReviewRepository({ runInTransaction: withTx });
    const reviewDeps = { env: ENV, humanReviewRepository, metadataOnlyAudit: noAudit() };
    const queueFor = async (queueType, targetId) => (await query(
      `SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid`,
      [ORG, queueType, targetId]))[0];
    // GK factual review of the measurement evidence and of the claim (internal only).
    const evidenceQueue = await queueFor("evidence_review", ids.measurementEvidenceId);
    const evidenceReview = await recordEvidenceReviewDecision({
      organizationId: ORG, evidenceItemId: ids.measurementEvidenceId, reviewQueueItemId: evidenceQueue.review_queue_item_id,
      expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported", actorContext: GK_REVIEWER, now: NOW,
    }, reviewDeps);
    assert.equal(evidenceReview.ok, true, JSON.stringify(evidenceReview));
    const claimQueue = await queueFor("claim_review", ids.measurementClaimId);
    const claimReview = await recordClaimReviewDecision({
      organizationId: ORG, claimId: ids.measurementClaimId, reviewQueueItemId: claimQueue.review_queue_item_id,
      expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"],
      actorContext: GK_REVIEWER, now: NOW,
    }, reviewDeps);
    assert.equal(claimReview.ok, true, JSON.stringify(claimReview));
    // Still not eligible: unresolved coverage dimensions and open client follow-ups.
    const reviewed = await trace(ids.measurementClaimId);
    assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
    assert.equal(reviewed.data.eligible, false);
    console.log(`[p2-01m] after GK review: blockers=${JSON.stringify(reviewed.data.blockerCodes)}`);
    // The GK reviewer accepts each unresolved internal limitation; a
    // client_reviewer answers the follow-ups (P2-11 role unchanged).
    const coverageRepository = createPostgresCoverageReviewDecisionRepository({ runInTransaction: withTx });
    const unresolved = Object.entries(reviewed.data.dimensions).filter(([, value]) => value.assessment_status === "unresolved").map(([key]) => key).sort();
    for (const dimensionKey of unresolved) {
      const accepted = await acceptInternalCoverageLimitation(
        { organizationId: ORG, claimId: ids.measurementClaimId, dimensionKey, actorContext: GK_REVIEWER, now: NOW },
        { env: ENV, coverageReviewDecisionRepository: coverageRepository, metadataOnlyAudit: noAudit() },
      );
      assert.equal(accepted.ok, true, `${dimensionKey}: ${JSON.stringify(accepted)}`);
    }
    const followupRepository = createPostgresClientFollowupCompletionRepository({ runInTransaction: withTx });
    const followups = await query(
      `SELECT cfi.client_followup_item_id::text, rq.updated_at FROM kai.client_followup_items cfi
         JOIN kai.review_queue_items rq ON rq.organization_id = cfi.organization_id AND rq.queue_type = 'client_followup'
          AND rq.target_object_type = 'client_followup_item' AND rq.target_object_id = cfi.client_followup_item_id
        WHERE cfi.organization_id = $1::uuid AND cfi.claim_id = $2::uuid`, [ORG, ids.measurementClaimId]);
    for (const row of followups) {
      const completed = await completeClientFollowup({
        organizationId: ORG, claimId: ids.measurementClaimId, clientFollowupItemId: row.client_followup_item_id,
        expectedUpdatedAt: new Date(row.updated_at).toISOString(), actorContext: REVIEWER, now: NOW,
      }, { env: ENV, clientFollowupCompletionRepository: followupRepository, metadataOnlyAudit: noAudit() });
      assert.equal(completed.ok, true, JSON.stringify(completed));
    }
    const eligibleTrace = await trace(ids.measurementClaimId);
    assert.equal(eligibleTrace.ok, true, JSON.stringify(eligibleTrace));
    assert.deepEqual(eligibleTrace.data.blockerCodes, [], JSON.stringify(eligibleTrace.data.blockerCodes));
    assert.equal(eligibleTrace.data.eligible, true);
    // The value, definition, and arithmetic reach the evaluator verbatim, and
    // each accepted limitation stays attached.
    assert.match(eligibleTrace.data.claim.statement, /^The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30/);
    assert.match(eligibleTrace.data.evidence.statement, /1 blank record excluded; 2 exact-duplicate records included\.$/);
    for (const dimensionKey of unresolved) assert.equal(eligibleTrace.data.dimensions[dimensionKey].internal_limitation_accepted, true, dimensionKey);
    // Funder use stays closed: the review approved internal use only.
    const funder = await getClaimTraceabilitySummary(
      { organizationId: ORG, claimId: ids.measurementClaimId, requestedAudience: "funder", actorContext: GK_REVIEWER },
      { env: ENV, claimTraceabilityRepository: traceRepository },
    );
    assert.equal(funder.data.eligible, false);
    const eligible = await listEligibleClaimsForAudience(
      { organizationId: ORG, requestedAudience: "internal", limit: 100, afterClaimId: null, actorContext: GK_REVIEWER },
      { env: ENV, eligibleClaimsForAudienceRepository: createPostgresEligibleClaimsForAudienceRepository({ runInTransaction: withTx }) },
    );
    assert.equal(eligible.ok, true, JSON.stringify(eligible));
    const projected = eligible.data.eligibleClaims.find((item) => item.claimId === ids.measurementClaimId);
    assert.deepEqual(projected && [projected.evidenceItemId, projected.sourceVersionId, projected.supportStrength, projected.claimReviewStatus],
      [ids.measurementEvidenceId, ids.main.sourceVersionId, "reviewed_supported", "reviewed"]);
  });
}
