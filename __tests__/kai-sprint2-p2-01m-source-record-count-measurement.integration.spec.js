import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import express from "express";

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
  const { recordSourceRecordCountMeasurement, getSourceRecordCountMeasurementBasis } = await import("../Backend/kai/services/kaiSourceMeasurementService.js");
  const { createPostgresSourceMeasurementRepository } = await import("../Backend/kai/dictionary/postgresSourceMeasurementRepository.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { createPostgresClaimProposalRepository } = await import("../Backend/kai/dictionary/postgresClaimProposalRepository.js");
  const { generateClaimGapFollowups } = await import("../Backend/kai/services/kaiClaimGapFollowupService.js");
  const { createPostgresClaimGapFollowupRepository } = await import("../Backend/kai/dictionary/postgresClaimGapFollowupRepository.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { createPostgresClaimTraceabilityRepository } = await import("../Backend/kai/dictionary/postgresClaimTraceabilityRepository.js");
  const { listEligibleClaimsForAudience } = await import("../Backend/kai/services/kaiEligibleClaimsForAudienceService.js");
  const { filterCurrentOrganizationEvidenceGaps } = await import("../Backend/kai/dictionary/postgresOrganizationEvidenceGapCurrentStateRepository.js");
  const { createPostgresEligibleClaimsForAudienceRepository } = await import("../Backend/kai/dictionary/postgresEligibleClaimsForAudienceRepository.js");
  const { extractEvidenceFromSourceVersion } = await import("../Backend/kai/services/kaiEvidenceLineageService.js");
  const { recordEvidenceReviewDecision, recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { createPostgresHumanReviewRepository } = await import("../Backend/kai/dictionary/postgresHumanReviewRepository.js");
  const { acceptInternalCoverageLimitation } = await import("../Backend/kai/services/kaiCoverageReviewDecisionService.js");
  const { createPostgresCoverageReviewDecisionRepository } = await import("../Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js");
  const { completeClientFollowup } = await import("../Backend/kai/services/kaiClientFollowupCompletionService.js");
  const { readEffectiveAiProcessingProhibitionsForClaims } = await import("../Backend/kai/dictionary/postgresEffectiveAllowedUseResolver.js");
  const { validateEffectiveAllowedUsePermitsOperation } = await import("../Backend/kai/validators/kaiEffectiveAllowedUseValidators.js");
  const { ensureSensitivityReviewQueueItemAfterProfiling } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { createPostgresReviewQueueRepository } = await import("../Backend/kai/dictionary/postgresReviewQueueRepository.js");
  const { recordSensitivityAllowedUseDecision } = await import("../Backend/kai/services/kaiSensitivityAllowedUseReviewService.js");
  const { createPostgresSensitivityAllowedUseReviewRepository } = await import("../Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js");
  const { createPostgresClientFollowupCompletionRepository } = await import("../Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js");
  const { createPostgresEvidenceLineageRepository } = await import("../Backend/kai/dictionary/postgresEvidenceLineageRepository.js");
  const { createEvidenceSummaryDraft } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
  const { createPostgresGeneratedContentRepository } = await import("../Backend/kai/dictionary/postgresGeneratedContentRepository.js");
  const { createProductionEvidenceSummaryDraftGenerator } = await import("../Backend/kai/services/kaiEvidenceSummaryDraftGenerator.js");
  const { getEngagementForOrganization } = await import("../Backend/kai/db/kaiQueries.js");
  const { default: sprint2IntakeApiRouter, __testables: routeTestables } = await import("../Backend/kai/routes/sprint2IntakeApi.js");
  const { startGeneratedContentReview, completeGeneratedContentReview, getGeneratedDraftReviewPacket } = await import("../Backend/kai/services/kaiGeneratedContentService.js");
  const { requestGeneratedDraftExportReview, startGeneratedDraftExportReview, completeGeneratedDraftExportReview } = await import("../Backend/kai/services/kaiExportReviewService.js");
  const { confirmGeneratedDraftLimitationSnapshot, confirmGeneratedDraftLimitationSnapshotFromCitedPairs, createGeneratedDraftExportCandidate } = await import("../Backend/kai/services/kaiExportCandidateService.js");
  const { createPostgresExportCandidateRepository } = await import("../Backend/kai/dictionary/postgresExportCandidateRepository.js");
  const { recordHumanFinalReleaseAuthorityDecision } = await import("../Backend/kai/services/kaiHumanAuthorityDecisionService.js");
  const { createPostgresHumanAuthorityDecisionRepository } = await import("../Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js");
  const { createExportManifest } = await import("../Backend/kai/services/kaiExportManifestService.js");
  const { createPostgresExportManifestRepository } = await import("../Backend/kai/dictionary/postgresExportManifestRepository.js");
  const { createPostgresExportManifestRenderModelRepository } = await import("../Backend/kai/dictionary/postgresExportManifestRenderModelRepository.js");
  const { serializeExportManifestToMarkdown } = await import("../Backend/kai/services/kaiExportManifestMarkdownSerializer.js");
  const audits = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");
  const { getClientInternalDraft, getClientReleasedReportMarkdown, approveClientInternalDraftFactualReview, releaseClientInternalReport } = await import("../Backend/kai/services/kaiClientGeneratedContentService.js");
  const { createPostgresOrganizationInternalReviewRepository, ORGANIZATION_REVIEW_COMPLETION_AUDIT_CONTRACT } = await import("../Backend/kai/dictionary/postgresOrganizationInternalReviewRepository.js");
  const { createPostgresClientReleasedReportRepository } = await import("../Backend/kai/dictionary/postgresClientReleasedReportRepository.js");
  const { readGeneratedDraftEngagementId } = await import("../Backend/kai/db/kaiGeneratedDraftLibraryReadModels.js");
  const { insertRequiredSuccessfulAuditEvent } = await import("../Backend/kai/db/kaiAuditQueries.js");

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
  const cleanups = [];
  test.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    await pool.end();
  });

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
  const GK_ADMIN = human(ORG, "gk_admin", "07");
  const OTHER_GK_ADMIN = human(OTHER_ORG, "gk_admin", "08");

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
      { env: ENV, claimProposalRepository: claimRepository, metadataOnlyAudit: noAudit(), claimGapFollowupRepository: gapRepository, claimGapFollowupMetadataOnlyAudit: noAudit() });
  const gapStateOf = async (claimId) => ({
    gaps: (await query("SELECT dimension_key, assessment_status FROM kai.gap_log_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid ORDER BY dimension_key", [ORG, claimId]))
      .map((row) => [row.dimension_key, row.assessment_status]),
    followups: (await query("SELECT dimension_key FROM kai.client_followup_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid ORDER BY dimension_key", [ORG, claimId]))
      .map((row) => row.dimension_key),
  });
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

  // Measured-claim gap state as P2-04 records it at proposal (Prompt 5): the
  // human definition answers definition, entity level, denominator, and
  // period; the period stays a visible, attested-not-verified limitation;
  // missingness and duplicates are the committed counts; small-cell risk,
  // conflicting sources, requirement alignment, and field coverage are the
  // unchanged source-level dimensions.
  const MEASURED_GAPS = [
    ["conflicting_source_indicators", "unresolved"],
    ["duplicates", "resolved_risk_flagged"],
    ["missingness", "resolved_risk_flagged"],
    ["requirement_alignment", "unresolved"],
    ["small_cell_risk", "unresolved"],
    ["time_period_clarity", "resolved_risk_flagged"],
  ];

  test("P2-03: the proposed claim states the measured value, gets its deterministic gap state in the same command, and creates no client follow-up", async () => {
    const before = await measurementCounts();
    const proposal = await propose(ids.measurementEvidenceId);
    assert.equal(proposal.ok, true, JSON.stringify(proposal));
    const { claim } = proposal.data;
    assert.equal(
      claim.statement,
      "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30 (record count: one programme session per CSV data record; 1 blank record excluded, 2 exact-duplicate records included).");
    assert.deepEqual([claim.claim_type, claim.claim_status, claim.claim_review_status, claim.claim_strength, claim.internal_only, claim.export_ready],
      ["finding", "proposed", "needs_gk_review", "unassessed", true, false]);
    assert.deepEqual([claim.llm_processing_allowed, claim.public_use_allowed, claim.funder_use_allowed], [false, false, false]);
    assert.equal(claim.evidence_item_id, ids.measurementEvidenceId);
    assert.doesNotMatch(claim.statement, /because|caused|improv|impact|increase|per cent|%|participants|households/i, "no causal, outcome, or denominator language");
    assert.deepEqual(proposal.data.claim_gap_state, { status: "generated", gap_item_count: MEASURED_GAPS.length, client_followup_item_count: 0, error_code: null });
    assert.deepEqual(await gapStateOf(claim.claim_id), { gaps: MEASURED_GAPS, followups: [] });
    const replay = await propose(ids.measurementEvidenceId);
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.claim.claim_id, claim.claim_id);
    assert.equal(replay.data.claim_gap_state.status, "replayed", "repeated preparation is idempotent");
    const after = await measurementCounts();
    assert.deepEqual([after.claims, after.gaps, after.followups], [before.claims + 1, before.gaps + MEASURED_GAPS.length, before.followups], "no client follow-up for a measured claim");
    ids.measurementClaimId = claim.claim_id;
  });

  // Plan A Prompt 8: the organization administrator's read-only basis.
  const basisOf = (sourceVersionId, { actor = ADMIN, organizationId = ORG, env = ENV } = {}) => getSourceRecordCountMeasurementBasis(
    { organizationId, sourceVersionId, actorContext: actor }, { env, sourceMeasurementRepository: measurementRepository });

  test("basis: the administrator reads the authoritative counts, the recorded definition, the measurement, its limitations, and the claim; unauthorized, other-tenant, unknown, and stale versions fail safely", async () => {
    const basis = await basisOf(ids.main.sourceVersionId);
    assert.equal(basis.ok, true, JSON.stringify(basis));
    const { basis: counts, recorded } = basis.data;
    assert.deepEqual(counts, {
      measurable: true, calculation_method: "p1_csv_profile_data_records_excluding_blank_v1",
      data_record_count: 6, blank_record_count: 1, duplicate_record_count: 2, counted_record_count: independentRecordCount(CSV),
    });
    assert.equal(recorded.definition.counted_unit, DEFINITION.counted_unit);
    assert.deepEqual([recorded.measurement.measured_value, recorded.measurement.evidence_item_id], [5, ids.measurementEvidenceId]);
    assert.deepEqual(recorded.limitations.map((entry) => entry.code), [
      "measurement.blank_records_excluded", "measurement.duplicate_records_included",
      "measurement.period_human_attested_not_row_verified", "measurement.record_meaning_human_defined",
    ]);
    assert.ok(recorded.limitations.every((entry) => typeof entry.description === "string" && entry.description.length > 20));
    assert.deepEqual([recorded.claim.claim_id, recorded.claim.claim_status, recorded.claim.claim_review_status], [ids.measurementClaimId, "proposed", "needs_gk_review"]);
    assert.doesNotMatch(JSON.stringify(basis.data), /literacy|mentoring|2026-09-16|attendees/, "no row values");

    const fresh = await seedPromotedSource({ profile: ids.profile });
    const unrecorded = await basisOf(fresh.sourceVersionId);
    assert.deepEqual([unrecorded.ok, unrecorded.data.recorded, unrecorded.data.basis.counted_record_count], [true, null, 5]);
    const sheet = await seedPromotedSource({ profile: { status: "profiled", format: "xlsx", sheets: [], fields: [{ field_key: "field_1" }] } });
    const unmeasurable = await basisOf(sheet.sourceVersionId);
    assert.equal(unmeasurable.data.basis.measurable, false);
    assert.equal(unmeasurable.data.basis.blockers[0].blocking_reason, "measurement_source_not_single_table_csv");

    const before = await measurementCounts();
    for (const [label, options, code] of [
      ["client_reviewer", { actor: REVIEWER }, "authorization_denied"],
      ["client_contributor", { actor: CONTRIBUTOR }, "authorization_denied"],
      ["another organization's administrator", { actor: OTHER_ADMIN }, "authorization_denied"],
      ["inactive administrator", { actor: { ...ADMIN, organizationMemberships: [{ ...ADMIN.organizationMemberships[0], membership_status: "inactive" }] } }, "authorization_denied"],
      ["system actor", { actor: { ...ADMIN, actorType: "system" } }, "authorization_denied"],
      ["feature off", { env: { KAI_SPRINT2_ENABLED: "false" } }, "feature_disabled"],
    ]) {
      const refused = await basisOf(ids.main.sourceVersionId, options);
      assert.deepEqual([refused.ok, refused.error.code], [false, code], label);
    }
    const otherScope = await basisOf(ids.main.sourceVersionId, { actor: OTHER_ADMIN, organizationId: OTHER_ORG });
    assert.deepEqual([otherScope.ok, otherScope.error.code], [false, "not_found"], "another organization's version is never found");
    assert.equal((await basisOf("0e000000-0000-4000-8000-0000000ffff1")).error.code, "not_found");
    const prohibited = await seedPromotedSource({ profile: ids.profile, allowedUse: "not_allowed" });
    const refusedUse = await basisOf(prohibited.sourceVersionId);
    assert.equal(refusedUse.blockers[0].blocking_reason, "allowed_use_not_allowed");
    const stale = await seedPromotedSource({ profile: ids.profile });
    await query("UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid", [stale.sourceVersionId]);
    assert.equal((await basisOf(stale.sourceVersionId)).error.code, "conflict_current_state_changed");
    // A conflicting second definition is refused, and the basis still shows the recorded one.
    const conflict = await record(ids.main.sourceVersionId, { definition: { ...DEFINITION, counted_unit: "attendance record" } });
    assert.deepEqual([conflict.ok, conflict.error.code, conflict.blockers[0].blocking_reason], [false, "conflict_current_state_changed", "measurement_definition_already_recorded"]);
    assert.match(conflict.blockers[0].required_fix, /upload a new intake version/);
    assert.equal((await basisOf(ids.main.sourceVersionId)).data.recorded.definition.counted_unit, DEFINITION.counted_unit);
    assert.deepEqual(await measurementCounts(), before, "reads and refusals write nothing");
  });

  test("zero counts are clear, positive counts stay visible, and a definition without a period is a recorded limitation, not a client question", async () => {
    const cleanCsv = "session_date,programme,attendees\n2026-09-02,literacy,12\n2026-09-09,mentoring,9\n";
    const clean = await seedPromotedSource({ profile: await kernelProfile(cleanCsv) });
    const noPeriod = { ...DEFINITION };
    delete noPeriod.period_start;
    delete noPeriod.period_end;
    const recorded = await record(clean.sourceVersionId, { definition: noPeriod });
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    assert.deepEqual([recorded.data.measurement.measured_value, recorded.data.measurement.blank_record_count, recorded.data.measurement.duplicate_record_count], [2, 0, 0]);
    const proposal = await propose(recorded.data.evidenceItem.evidence_item_id);
    assert.equal(proposal.ok, true, JSON.stringify(proposal));
    assert.match(proposal.data.claim.statement, /records 2 programme sessions with no reporting period defined/);
    const state = await gapStateOf(proposal.data.claim.claim_id);
    assert.deepEqual(state.followups, []);
    const gapKeys = state.gaps.map(([key]) => key);
    assert.equal(gapKeys.includes("missingness"), false, "zero missing values in counted records is clear");
    assert.equal(gapKeys.includes("duplicates"), false, "zero duplicates is clear");
    assert.ok(state.gaps.some(([key, status]) => key === "time_period_clarity" && status === "resolved_risk_flagged"), "no period stays a limitation");
    const traced = await trace(proposal.data.claim.claim_id);
    assert.equal(traced.ok, true, JSON.stringify(traced));
    assert.equal(traced.data.dimensions.missingness.assessment_status, "resolved_clear");
    assert.equal(traced.data.dimensions.duplicates.assessment_status, "resolved_clear");
    assert.equal(traced.data.dimensions.denominator_clarity.assessment_status, "resolved_clear");
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
    ids.legacyFieldClaimId = proposal.data.claim.claim_id;
    ids.legacyFieldEvidenceId = evidenceRow.evidence_item_id;
    assert.equal(proposal.data.claim.statement,
      `The promoted source contains the committed data-dictionary field "field_1" identified by locator ${locatorRow.locator_fingerprint}.`);
    // A field-presence claim keeps today's lifecycle: no gap state at
    // proposal, P2-06 still needs the explicit P2-04 step, and that step still
    // routes its unresolved client-answerable dimensions as follow-ups.
    assert.equal(proposal.data.claim_gap_state, undefined);
    assert.equal(proposal.data.measurementClaim, undefined);
    const untraced = await trace(proposal.data.claim.claim_id);
    assert.equal(untraced.data?.traceability_conflict_reason, "gap_dimension_requires_missing_p204_state");
    const legacyGaps = await generateClaimGapFollowups(
      { organizationId: ORG, claimId: proposal.data.claim.claim_id, actorContext: ADMIN, now: NOW },
      { env: ENV, claimGapFollowupRepository: gapRepository, metadataOnlyAudit: noAudit() },
    );
    assert.equal(legacyGaps.ok, true, JSON.stringify(legacyGaps));
    assert.deepEqual(legacyGaps.data.clientFollowupItems.map((row) => row.dimension_key).sort(),
      ["definition_clarity", "denominator_clarity", "entity_level_clarity", "time_period_clarity"]);
    const legacyState = await gapStateOf(proposal.data.claim.claim_id);
    // Same source version, legacy rule unchanged: with no committed P1-04
    // finding, missingness and duplicates stay unresolved for the field claim.
    assert.ok(legacyState.gaps.some(([key, status]) => key === "missingness" && status === "unresolved"), JSON.stringify(legacyState));
    assert.ok(legacyState.gaps.some(([key, status]) => key === "duplicates" && status === "unresolved"), JSON.stringify(legacyState));
    assert.equal((await trace(proposal.data.claim.claim_id)).ok, true);
    // The database still rejects a mixed type/class pairing.
    await assert.rejects(() => query(
      `UPDATE kai.evidence_items SET data_class = 'source_derived_aggregate' WHERE evidence_item_id = $1::uuid`, [evidenceRow.evidence_item_id]),
    /evidence_items_p2_01m_type_class_pairing_check/);
  });

  test("P2-06: the measured claim traces at once (no manual P2-04), its snapshot agrees with recomputation, and an explicit P2-04 replays", async () => {
    const traced = await trace(ids.measurementClaimId);
    assert.equal(traced.ok, true, JSON.stringify(traced));
    console.log(`[p2-01m] traceability after proposal: eligible=${traced.data.eligible} blockers=${JSON.stringify(traced.data.blockerCodes)}`);
    assert.equal(traced.data.eligible, false, "an unreviewed measured claim is not eligible");
    const dims = Object.fromEntries(Object.entries(traced.data.dimensions).map(([key, value]) => [key, value.assessment_status]));
    assert.deepEqual(dims, {
      missingness: "resolved_risk_flagged",
      duplicates: "resolved_risk_flagged",
      definition_clarity: "resolved_clear",
      denominator_clarity: "resolved_clear",
      time_period_clarity: "resolved_risk_flagged",
      entity_level_clarity: "resolved_clear",
      small_cell_risk: "unresolved",
      conflicting_source_indicators: "unresolved",
      requirement_alignment: "unresolved",
      coverage_gaps: "resolved_clear",
    });
    const before = await measurementCounts();
    const explicit = await generateClaimGapFollowups(
      { organizationId: ORG, claimId: ids.measurementClaimId, actorContext: ADMIN, now: NOW },
      { env: ENV, claimGapFollowupRepository: gapRepository, metadataOnlyAudit: noAudit() },
    );
    assert.deepEqual([explicit.ok, explicit.data.replayed], [true, true]);
    assert.deepEqual(await measurementCounts(), before);
    // The organization gap view applies the same rule: every persisted gap of
    // the measured claim is current.
    const gapRows = await query("SELECT * FROM kai.gap_log_items WHERE organization_id = $1::uuid AND claim_id = $2::uuid", [ORG, ids.measurementClaimId]);
    const current = await withTx((tx) => filterCurrentOrganizationEvidenceGaps(tx, { organizationId: ORG, candidateGapRows: gapRows }));
    assert.equal(current.length, gapRows.length);
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
    // Still not eligible: only the unresolved source-level coverage dimensions
    // remain; no client follow-up exists or is needed.
    const reviewed = await trace(ids.measurementClaimId);
    assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
    assert.equal(reviewed.data.eligible, false);
    assert.deepEqual(reviewed.data.blockerCodes, ["coverage_dimension_unresolved"]);
    console.log(`[p2-01m] after GK review: blockers=${JSON.stringify(reviewed.data.blockerCodes)}`);
    // The GK reviewer accepts each unresolved internal limitation; a
    // client_reviewer answers the follow-ups (P2-11 role unchanged).
    const coverageRepository = createPostgresCoverageReviewDecisionRepository({ runInTransaction: withTx });
    const unresolved = Object.entries(reviewed.data.dimensions).filter(([, value]) => value.assessment_status === "unresolved").map(([key]) => key).sort();
    assert.deepEqual(unresolved, ["conflicting_source_indicators", "requirement_alignment", "small_cell_risk"]);
    for (const dimensionKey of unresolved) {
      const accepted = await acceptInternalCoverageLimitation(
        { organizationId: ORG, claimId: ids.measurementClaimId, dimensionKey, actorContext: GK_REVIEWER, now: NOW },
        { env: ENV, coverageReviewDecisionRepository: coverageRepository, metadataOnlyAudit: noAudit() },
      );
      assert.equal(accepted.ok, true, `${dimensionKey}: ${JSON.stringify(accepted)}`);
    }
    // The organization administrator cannot make the GK coverage decision.
    const adminAcceptance = await acceptInternalCoverageLimitation(
      { organizationId: ORG, claimId: ids.measurementClaimId, dimensionKey: "small_cell_risk", actorContext: ADMIN, now: NOW },
      { env: ENV, coverageReviewDecisionRepository: createPostgresCoverageReviewDecisionRepository({ runInTransaction: withTx }), metadataOnlyAudit: noAudit() },
    );
    assert.deepEqual([adminAcceptance.ok, adminAcceptance.error?.code], [false, "authorization_denied"]);
    const followupRepository = createPostgresClientFollowupCompletionRepository({ runInTransaction: withTx });
    const followups = await query(
      `SELECT cfi.client_followup_item_id::text, rq.updated_at FROM kai.client_followup_items cfi
         JOIN kai.review_queue_items rq ON rq.organization_id = cfi.organization_id AND rq.queue_type = 'client_followup'
          AND rq.target_object_type = 'client_followup_item' AND rq.target_object_id = cfi.client_followup_item_id
        WHERE cfi.organization_id = $1::uuid AND cfi.claim_id = $2::uuid`, [ORG, ids.measurementClaimId]);
    assert.equal(followups.length, 0, "a measured claim never waits on a client reviewer");
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

  // Synthetic human sensitivity decision through the real P1-06 queue and the
  // real decision service (never an inserted decision row).
  async function decideSensitivity(sensitivityProfileId, decision, snapshot) {
    const queue = await ensureSensitivityReviewQueueItemAfterProfiling(
      { organizationId: ORG, intakeSensitivityProfileId: sensitivityProfileId, now: NOW },
      { env: ENV, reviewQueueRepository: createPostgresReviewQueueRepository({ runInTransaction: withTx }), metadataOnlyAudit: noAudit() },
    );
    assert.equal(queue.ok, true, `queue: ${JSON.stringify(queue)}`);
    const [item] = await query(
      "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid",
      [ORG, sensitivityProfileId]);
    const decided = await recordSensitivityAllowedUseDecision({
      organizationId: ORG,
      intakeSensitivityProfileId: sensitivityProfileId,
      reviewQueueItemId: item.review_queue_item_id,
      expectedUpdatedAt: new Date(item.updated_at).toISOString(),
      decision,
      ...(snapshot ? { reviewedSnapshot: snapshot } : {}),
      actorContext: { ...GK_REVIEWER, kaiRoles: ["gk_reviewer"] },
      now: NOW,
    }, { env: ENV, sensitivityAllowedUseReviewRepository: createPostgresSensitivityAllowedUseReviewRepository({ runInTransaction: withTx }), metadataOnlyAudit: noAudit() });
    assert.equal(decided.ok, true, `decision: ${JSON.stringify(decided)}`);
  }
  const reviewedSnapshot = (overrides) => ({
    reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent",
    reviewed_health_housing_justice_immigration_status: "absent", reviewed_indigenous_governance_status: "absent",
    reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent", reviewed_small_cell_risk_status: "absent",
    reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "present", reviewed_allowed_use_status: "allowed",
    reviewed_llm_processing_allowed: false, reviewed_product_learning_allowed: false,
    reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
    ...overrides,
  });

  test("generation permission is the source's effective AI decision, independent of eligibility: none, permitted, and prohibited", async () => {
    // The pinned evidence/claim AI flags are false on every row (legacy too)
    // and are not what generation reads: VAL-KAI-B1A-02-004 reads the file's
    // current human AI decision (readEffectiveAiProcessingProhibitionsForClaims).
    const [flags] = await query("SELECT e.llm_processing_allowed AS evidence, c.llm_processing_allowed AS claim FROM kai.claims c JOIN kai.evidence_items e ON e.evidence_item_id = c.evidence_item_id WHERE c.claim_id = $1::uuid", [ids.measurementClaimId]);
    assert.deepEqual(flags, { evidence: false, claim: false });
    const verdict = async (claimId) => withTx(async (tx) => {
      const prohibitions = await readEffectiveAiProcessingProhibitionsForClaims(tx, { organizationId: ORG, claimIds: [claimId] });
      const prohibition = prohibitions.has(claimId) ? prohibitions.get(claimId) : "claim_lineage_missing";
      const checked = validateEffectiveAllowedUsePermitsOperation(prohibition, { operation: "create_evidence_summary_draft", objectType: "claim", objectId: claimId });
      return { prohibition, permitted: checked.ok, code: checked.ok ? null : checked.code };
    });
    // No human sensitivity decision on this synthetic source: the existing
    // rule does not prohibit (eligible=true does not decide this either way).
    assert.deepEqual(await verdict(ids.measurementClaimId), { prohibition: null, permitted: true, code: null });

    async function measuredClaimWithDecision(llmAllowed) {
      const seeded = await seedPromotedSource({ profile: ids.profile });
      const queue = await ensureSensitivityReviewQueueItemAfterProfiling(
        { organizationId: ORG, intakeSensitivityProfileId: seeded.sensitivityProfileId, now: NOW },
        { env: ENV, reviewQueueRepository: createPostgresReviewQueueRepository({ runInTransaction: withTx }), metadataOnlyAudit: noAudit() },
      );
      assert.equal(queue.ok, true, `queue: ${JSON.stringify(queue)}`);
      const [item] = await query(
        "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'sensitivity_review' AND target_object_id = $2::uuid",
        [ORG, seeded.sensitivityProfileId]);
      const decided = await recordSensitivityAllowedUseDecision({
        organizationId: ORG,
        intakeSensitivityProfileId: seeded.sensitivityProfileId,
        reviewQueueItemId: item.review_queue_item_id,
        expectedUpdatedAt: new Date(item.updated_at).toISOString(),
        decision: "reviewed",
        reviewedSnapshot: {
          reviewed_personal_data_status: "absent", reviewed_minor_data_status: "absent",
          reviewed_health_housing_justice_immigration_status: "absent", reviewed_indigenous_governance_status: "absent",
          reviewed_staff_notes_status: "absent", reviewed_story_testimonial_status: "absent", reviewed_small_cell_risk_status: "absent",
          reviewed_financial_records_status: "absent", reviewed_consent_basis_status: "present", reviewed_allowed_use_status: "allowed",
          reviewed_llm_processing_allowed: llmAllowed, reviewed_product_learning_allowed: false,
          reviewed_public_use_allowed: false, reviewed_funder_use_allowed: false,
        },
        actorContext: { ...GK_REVIEWER, kaiRoles: ["gk_reviewer"] },
        now: NOW,
      }, { env: ENV, sensitivityAllowedUseReviewRepository: createPostgresSensitivityAllowedUseReviewRepository({ runInTransaction: withTx }), metadataOnlyAudit: noAudit() });
      assert.equal(decided.ok, true, `decision: ${JSON.stringify(decided)}`);
      const recorded = await record(seeded.sourceVersionId);
      assert.equal(recorded.ok, true, `measurement under either AI decision: ${JSON.stringify(recorded)}`);
      const proposal = await propose(recorded.data.evidenceItem.evidence_item_id);
      assert.equal(proposal.ok, true, `proposal: ${JSON.stringify(proposal)}`);
      // The AI-permitted source is an ordinary one (every section 7.2
      // high-risk category 'absent'); the organization-review test uses it.
      if (llmAllowed) {
        ids.ordinary = { claimId: proposal.data.claim.claim_id, evidenceItemId: recorded.data.evidenceItem.evidence_item_id, sourceVersionId: seeded.sourceVersionId };
      }
      return proposal.data.claim.claim_id;
    }
    const permittedClaim = await measuredClaimWithDecision(true);
    assert.deepEqual(await verdict(permittedClaim), { prohibition: null, permitted: true, code: null });
    const prohibitedClaim = await measuredClaimWithDecision(false);
    const refused = await verdict(prohibitedClaim);
    assert.equal(refused.prohibition, "reviewed_llm_processing_not_allowed");
    assert.equal(refused.permitted, false);
    // The prohibited claim is still traceable for its non-AI uses.
    assert.equal((await trace(prohibitedClaim)).ok, true);
  });

  // ---- Plan A Prompt 6: the measured claim through the real evidence_summary
  // generation service. Real: the service, flags, role and tenant checks, the
  // engagement read, the AI gate, P2-06 revalidation, the production
  // generator adapter (request payload, prompt, JSON parsing), every VAL-GEN
  // validator, and persistence. Simulated: only the provider call
  // (createMessage), which records the payload and returns a fixed response.
  const ENGAGEMENT = "0e000000-0000-4000-8000-00000000ea01";
  const OTHER_ENGAGEMENT = "0e000000-0000-4000-8000-00000000eb01";
  const GEN_ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "true" });
  const MEASURED_LIMITATION_CODES = [
    "coverage.conflicting_source_indicators.accepted_internal_limitation",
    "coverage.duplicates.resolved_risk_flagged",
    "coverage.missingness.resolved_risk_flagged",
    "coverage.requirement_alignment.accepted_internal_limitation",
    "coverage.small_cell_risk.accepted_internal_limitation",
    "coverage.time_period_clarity.resolved_risk_flagged",
    "measurement.blank_records_excluded",
    "measurement.duplicate_records_included",
    "measurement.period_human_attested_not_row_verified",
    "measurement.record_meaning_human_defined",
  ];
  // Every number is from the cited claim statement; every limitation is
  // stated; the records are not called distinct and the period not verified.
  const COMPLIANT_TEXT = "The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30. "
    + "This is a count of source records, each counted as one programme session under the human-confirmed definition; "
    + "the period is attested in that definition and not verified against record dates. "
    + "1 blank record was excluded and 2 exact-duplicate records were included. "
    + "Internal limitations: small-cell risk, conflicting source indicators, and requirement alignment were accepted for internal use only.";
  const LEGACY_SYSTEM_PROMPT = [
    "You generate internal evidence summaries for Get Kinder.",
    "Use only the supplied governed claim projection.",
    "Every block must cite at least one supplied claim/evidence pair.",
    "Do not add numbers or causal language unless it appears in a cited claim statement.",
  ].join(" ");

  function providerDouble(respond) {
    const calls = [];
    const createMessage = async (payload) => {
      calls.push(payload);
      return { content: [{ type: "text", text: JSON.stringify(respond(JSON.parse(payload.messages[0].content))) }] };
    };
    return { calls, draftGenerator: createProductionEvidenceSummaryDraftGenerator({ createMessage }) };
  }
  const measuredBlock = (text, claimId = ids.measurementClaimId, evidenceItemId = ids.measurementEvidenceId) =>
    ({ text, citations: [{ claimId, evidenceItemId }] });
  const replying = (...blocks) => providerDouble(() => ({ blocks }));

  let idempotency = 0;
  const generate = (claimIds, provider, { actor = ADMIN, organizationId = ORG, engagementId = ENGAGEMENT, env = GEN_ENV } = {}) => createEvidenceSummaryDraft({
    organizationId, engagementId, requestedAudience: "internal", claimIds: [...claimIds].sort(),
    idempotencyKey: `p2-01m-generation-${++idempotency}`, actorContext: actor, now: NOW,
  }, {
    env,
    getEngagementForOrganization: (args) => getEngagementForOrganization(args, pool),
    claimGapFollowupRepository: gapRepository,
    claimGapFollowupMetadataOnlyAuditFactory: () => noAudit(),
    generatedContentRepository: createPostgresGeneratedContentRepository({ runInTransaction: withTx }),
    draftGenerator: provider.draftGenerator,
    metadataOnlyAudit: noAudit(),
  });
  async function generationCounts() {
    const [row] = await query(`SELECT
      (SELECT count(*) FROM kai.generation_runs WHERE organization_id = ANY($1::uuid[]))::int AS runs,
      (SELECT count(*) FROM kai.generated_content_drafts WHERE organization_id = ANY($1::uuid[]))::int AS drafts,
      (SELECT count(*) FROM kai.generated_content_blocks WHERE organization_id = ANY($1::uuid[]))::int AS blocks,
      (SELECT count(*) FROM kai.generated_content_citations WHERE organization_id = ANY($1::uuid[]))::int AS citations`, [[ORG, OTHER_ORG]]);
    return row;
  }
  const blockerKeys = (result) => (result.blockers || []).filter((item) => item.severity === "blocker").map((item) => item.validator_key);

  test("generation: the eligible measured claim reaches the generator with its value, definition, and every limitation, and a compliant response persists a review-gated internal draft", async () => {
    // The normal chain's pre-migration base has the real engagement ->
    // organization foreign key; the P2-01M runner's engagement mirror does not.
    if ((await query("SELECT to_regclass('kai.organizations') IS NOT NULL AS present"))[0].present) {
      await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES
        ($1::uuid, 'Riverside Literacy Collective (synthetic)', 'plan-a-synthetic'), ($2::uuid, 'Other Synthetic Organization', 'plan-a-other')
        ON CONFLICT (organization_id) DO NOTHING`, [ORG, OTHER_ORG]);
    }
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code) VALUES ($1::uuid, $2::uuid, 'p2-01m'), ($3::uuid, $4::uuid, 'p2-01m-other')",
      [ENGAGEMENT, ORG, OTHER_ENGAGEMENT, OTHER_ORG]);
    const before = await generationCounts();
    // The response also claims an approval: the adapter keeps only text and
    // citations, so the model cannot approve, finalize, or export anything.
    const provider = providerDouble(() => ({ blocks: [measuredBlock(COMPLIANT_TEXT)], approved: true, draftStatus: "approved", exportReady: true }));
    const result = await generate([ids.measurementClaimId], provider);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(provider.calls.length, 1);
    const [payload] = provider.calls;
    const sent = JSON.parse(payload.messages[0].content);
    assert.deepEqual([sent.contentType, sent.requestedAudience, sent.claims.length], ["evidence_summary", "internal", 1]);
    const [claim] = sent.claims;
    assert.deepEqual([claim.claimId, claim.evidenceItemId, claim.sourceVersionId], [ids.measurementClaimId, ids.measurementEvidenceId, ids.main.sourceVersionId]);
    assert.match(claim.claimStatement, /^The promoted source records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30 \(record count: one programme session per CSV data record; 1 blank record excluded, 2 exact-duplicate records included\)\.$/);
    assert.deepEqual(claim.limitationCodes, MEASURED_LIMITATION_CODES);
    ids.generatorClaimStatement = claim.claimStatement;
    assert.equal(payload.system.startsWith(LEGACY_SYSTEM_PROMPT), true, "the existing instructions are kept");
    assert.match(payload.system, /count of source records under the human-confirmed record definition/);
    assert.match(payload.system, /never call the records distinct or the period verified/);
    // Only the governed projection is sent: no row values, file names, or ids beyond the projection.
    assert.doesNotMatch(payload.messages[0].content, /literacy|mentoring|attendees|sessions\.csv|2026-09-16/);

    const { data } = result;
    assert.equal(data.requestedAudience, "internal");
    assert.equal(data.replayed, false);
    assert.equal(data.blocks.length, 1);
    assert.equal(data.blocks[0].text, COMPLIANT_TEXT);
    assert.deepEqual(data.blocks[0].citations.map((citation) => [citation.claimId, citation.evidenceItemId]), [[ids.measurementClaimId, ids.measurementEvidenceId]]);
    const [draft] = await query(
      `SELECT d.content_type, d.draft_status, d.review_status, d.requested_audience, d.validator_results, q.queue_type, q.queue_status, q.review_status AS queue_review_status
         FROM kai.generated_content_drafts d
         JOIN kai.review_queue_items q ON q.review_queue_item_id = $2::uuid AND q.target_object_id = d.generated_content_draft_id
        WHERE d.generated_content_draft_id = $1::uuid`, [data.generatedContentDraftId, data.reviewQueueItemId]);
    console.log(`[p2-01m] persisted draft: status=${draft.draft_status} review=${draft.review_status} queue=${draft.queue_type}/${draft.queue_status}/${draft.queue_review_status}`);
    assert.deepEqual([draft.content_type, draft.requested_audience, draft.draft_status, draft.review_status], ["evidence_summary", "internal", data.draftStatus, data.reviewStatus]);
    assert.notEqual(draft.draft_status, "approved");
    assert.equal(draft.queue_status, "open", "a human still has to review it");
    const validators = Object.fromEntries((draft.validator_results.results || draft.validator_results).map((item) => [item.validator_key, item.severity]));
    for (const key of ["VAL-GEN-001", "VAL-GEN-002", "VAL-GEN-003", "VAL-GEN-004", "VAL-GEN-005", "VAL-GEN-008"]) assert.equal(validators[key], "pass", `${key}: ${JSON.stringify(draft.validator_results)}`);
    const [persistedBlock] = await query(
      `SELECT b.text, c.claim_id::text, c.evidence_item_id::text FROM kai.generated_content_blocks b
         JOIN kai.generated_content_citations c ON c.generated_content_block_id = b.generated_content_block_id
        WHERE b.generated_content_draft_id = $1::uuid`, [data.generatedContentDraftId]);
    assert.deepEqual(persistedBlock, { text: COMPLIANT_TEXT, claim_id: ids.measurementClaimId, evidence_item_id: ids.measurementEvidenceId });
    assert.deepEqual(await generationCounts(), { runs: before.runs + 1, drafts: before.drafts + 1, blocks: before.blocks + 1, citations: before.citations + 1 });
    ids.measuredDraftId = data.generatedContentDraftId;
  });

  test("generation: fabricated numbers, causal language, missing citations, undisclosed limitations, and 'distinct'/'verified' wording are rejected with nothing persisted", async () => {
    const before = await generationCounts();
    const cases = [
      ["fabricated count", COMPLIANT_TEXT.replace("records 5 programme", "records 6 programme"), ["VAL-GEN-004"]],
      ["fabricated rate", `${COMPLIANT_TEXT} That is 83% of planned sessions.`, ["VAL-GEN-004"]],
      ["causal language", `${COMPLIANT_TEXT} The programme improves literacy.`, ["VAL-GEN-004"]],
      ["no blank or duplicate disclosure", COMPLIANT_TEXT.replace("1 blank record was excluded and 2 exact-duplicate records were included. ", ""), ["VAL-GEN-008"]],
      ["no coverage limitation", COMPLIANT_TEXT.replace(/ Internal limitations:.*$/, ""), ["VAL-GEN-008"]],
      ["period called verified", COMPLIANT_TEXT.replace("is attested in that definition and not verified against record dates", "was verified against the record dates"), ["VAL-GEN-008"]],
      ["records called distinct sessions", `${COMPLIANT_TEXT} These are 5 distinct sessions delivered.`, ["VAL-GEN-008"]],
    ];
    for (const [label, text, expected] of cases) {
      const provider = replying(measuredBlock(text));
      const result = await generate([ids.measurementClaimId], provider);
      assert.deepEqual([result.ok, result.error?.code], [false, "validation_blocker"], `${label}: ${JSON.stringify(result)}`);
      assert.equal(provider.calls.length, 1, label);
      for (const key of expected) assert.ok(blockerKeys(result).includes(key), `${label}: ${JSON.stringify(result.blockers)}`);
    }
    // An uncited block (even beside a compliant one) is not accepted.
    const uncited = await generate([ids.measurementClaimId], replying(measuredBlock(COMPLIANT_TEXT), { text: "The source records 5 programme sessions.", citations: [] }));
    assert.equal(uncited.ok, false);
    // Refused by the generator-result contract, before the VAL-GEN set runs.
    assert.ok(blockerKeys(uncited).some((key) => key === "VAL-GEN-002" || key === "VAL-GEN-RESULT-P0-001"), JSON.stringify(uncited.blockers));
    // A citation to evidence that is not the claim's is not accepted.
    const wrongPair = await generate([ids.measurementClaimId], replying(measuredBlock(COMPLIANT_TEXT, ids.measurementClaimId, ids.legacyFieldEvidenceId)));
    assert.equal(wrongPair.ok, false);
    assert.ok(blockerKeys(wrongPair).includes("VAL-GEN-003"), JSON.stringify(wrongPair.blockers));
    assert.deepEqual(await generationCounts(), before, "no rejected draft is persisted");
  });

  test("generation: unauthorized roles, another tenant, and disabled flags never reach the provider", async () => {
    const before = await generationCounts();
    for (const [label, options, code] of [
      ["client_reviewer", { actor: REVIEWER }, "authorization_denied"],
      ["client_contributor", { actor: CONTRIBUTOR }, "authorization_denied"],
      ["another organization's administrator", { actor: OTHER_ADMIN }, "authorization_denied"],
      ["system actor", { actor: { ...ADMIN, actorType: "system" } }, "authorization_denied"],
      ["generation flag off", { env: { KAI_SPRINT2_ENABLED: "true", KAI_GENERATION_ENABLED: "false" } }, "feature_disabled"],
      ["Sprint 2 flag off", { env: { KAI_SPRINT2_ENABLED: "false", KAI_GENERATION_ENABLED: "true" } }, "feature_disabled"],
      ["another organization's engagement", { engagementId: OTHER_ENGAGEMENT }, "tenant_boundary_violation"],
    ]) {
      const provider = replying(measuredBlock(COMPLIANT_TEXT));
      const result = await generate([ids.measurementClaimId], provider, options);
      assert.deepEqual([result.ok, result.error?.code], [false, code], `${label}: ${JSON.stringify(result)}`);
      assert.equal(provider.calls.length, 0, label);
    }
    // The other organization, in its own scope, cannot reach this claim.
    const provider = replying(measuredBlock(COMPLIANT_TEXT));
    const crossScope = await generate([ids.measurementClaimId], provider, { actor: OTHER_ADMIN, organizationId: OTHER_ORG, engagementId: OTHER_ENGAGEMENT });
    console.log(`[p2-01m] cross-organization generation: ${crossScope.error?.code}`);
    assert.equal(crossScope.ok, false);
    assert.equal(provider.calls.length, 0);
    assert.deepEqual(await generationCounts(), before);
  });

  test("generation: a source whose human decision prohibits AI, or leaves it unknown or unresolved, is refused before the provider", async () => {
    const before = await generationCounts();
    for (const [label, decision, snapshot] of [
      ["reviewed, AI not permitted", "reviewed", reviewedSnapshot({ reviewed_llm_processing_allowed: false })],
      ["reviewed, allowed use unknown", "reviewed", reviewedSnapshot({ reviewed_allowed_use_status: "unknown", reviewed_consent_basis_status: "unknown" })],
      ["needs more information", "needs_more_information", null],
    ]) {
      const seeded = await seedPromotedSource({ profile: ids.profile });
      await decideSensitivity(seeded.sensitivityProfileId, decision, snapshot);
      const recorded = await record(seeded.sourceVersionId);
      assert.equal(recorded.ok, true, `${label}: ${JSON.stringify(recorded)}`);
      const proposal = await propose(recorded.data.evidenceItem.evidence_item_id);
      assert.equal(proposal.ok, true, `${label}: ${JSON.stringify(proposal)}`);
      const provider = replying(measuredBlock(COMPLIANT_TEXT, proposal.data.claim.claim_id, recorded.data.evidenceItem.evidence_item_id));
      const result = await generate([proposal.data.claim.claim_id], provider);
      assert.deepEqual([result.ok, result.error?.code], [false, "validation_blocker"], `${label}: ${JSON.stringify(result)}`);
      assert.deepEqual(result.blockers.map((item) => [item.validator_key, item.blocking_reason]), [["VAL-KAI-B1A-02-004", "ai_processing_not_permitted"]], label);
      assert.equal(provider.calls.length, 0, label);
    }
    assert.deepEqual(await generationCounts(), before);
  });

  test("generation: an unreviewed or rejected measured claim is refused before the provider; GK review authority is unchanged", async () => {
    const before = await generationCounts();
    const seeded = await seedPromotedSource({ profile: ids.profile });
    const recorded = await record(seeded.sourceVersionId);
    const proposal = await propose(recorded.data.evidenceItem.evidence_item_id);
    const claimId = proposal.data.claim.claim_id;
    const evidenceItemId = recorded.data.evidenceItem.evidence_item_id;
    // Unreviewed: unlike an internal field-presence claim (Package 14-05), a
    // count is never summarized before it is eligible.
    const unreviewedProvider = replying(measuredBlock(COMPLIANT_TEXT, claimId, evidenceItemId));
    const unreviewed = await generate([claimId], unreviewedProvider);
    assert.deepEqual([unreviewed.ok, unreviewed.error?.code], [false, "validation_blocker"], JSON.stringify(unreviewed));
    assert.deepEqual(unreviewed.blockers.map((item) => [item.validator_key, item.blocking_reason]), [["VAL-GEN-MEASURED-P2-01M-001", "measured_claim_not_currently_eligible"]]);
    assert.equal(unreviewedProvider.calls.length, 0);
    // The organization administrator who requests drafts cannot review the
    // claim; a GK reviewer supports the evidence, then rejects the claim.
    const humanReviewRepository = createPostgresHumanReviewRepository({ runInTransaction: withTx });
    const [evidenceQueue] = await query(
      "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_id = $2::uuid",
      [ORG, evidenceItemId]);
    const evidenceReview = await recordEvidenceReviewDecision({
      organizationId: ORG, evidenceItemId, reviewQueueItemId: evidenceQueue.review_queue_item_id,
      expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported", actorContext: GK_REVIEWER, now: NOW,
    }, { env: ENV, humanReviewRepository, metadataOnlyAudit: noAudit() });
    assert.equal(evidenceReview.ok, true, JSON.stringify(evidenceReview));
    const [claimQueue] = await query(
      "SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items WHERE organization_id = $1::uuid AND queue_type = 'claim_review' AND target_object_id = $2::uuid",
      [ORG, claimId]);
    const reviewInput = (actorContext, decision) => ({
      organizationId: ORG, claimId, reviewQueueItemId: claimQueue.review_queue_item_id,
      expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision, actorContext, now: NOW,
    });
    const adminReview = await recordClaimReviewDecision(reviewInput(ADMIN, "rejected"), { env: ENV, humanReviewRepository, metadataOnlyAudit: noAudit() });
    assert.deepEqual([adminReview.ok, adminReview.error?.code], [false, "authorization_denied"]);
    const rejected = await recordClaimReviewDecision(reviewInput(GK_REVIEWER, "rejected"), { env: ENV, humanReviewRepository, metadataOnlyAudit: noAudit() });
    assert.equal(rejected.ok, true, JSON.stringify(rejected));
    const rejectedProvider = replying(measuredBlock(COMPLIANT_TEXT, claimId, evidenceItemId));
    const refused = await generate([claimId], rejectedProvider);
    assert.deepEqual([refused.ok, refused.error?.code], [false, "claim_reviewed_not_supported"], JSON.stringify(refused));
    assert.equal(rejectedProvider.calls.length, 0);
    assert.deepEqual(await generationCounts(), before);
  });

  test("generation: a field-presence claim keeps today's internal generation exactly (prompt, limitation codes, validators)", async () => {
    const provider = replying({ text: "The promoted source contains a committed data-dictionary field.", citations: [{ claimId: ids.legacyFieldClaimId, evidenceItemId: ids.legacyFieldEvidenceId }] });
    const result = await generate([ids.legacyFieldClaimId], provider);
    assert.equal(result.ok, true, JSON.stringify(result));
    const [payload] = provider.calls;
    assert.equal(payload.system, LEGACY_SYSTEM_PROMPT, "the internal system prompt is byte-for-byte unchanged");
    const [claim] = JSON.parse(payload.messages[0].content).claims;
    assert.equal(claim.limitationCodes.some((code) => code.startsWith("measurement.") || code.startsWith("coverage.")), false, JSON.stringify(claim.limitationCodes));
    const [draft] = await query("SELECT validator_results FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [result.data.generatedContentDraftId]);
    const keys = (draft.validator_results.results || draft.validator_results).map((item) => item.validator_key);
    assert.equal(keys.includes("VAL-GEN-008"), false, JSON.stringify(keys));
  });

  // ---- Plan A Prompt 7: the persisted measured draft through the existing GK
  // review, export review, limitation snapshot, export candidate, final-release
  // authority, manifest, render model, Markdown serializer, and the Markdown
  // delivery route. Runs only on the normal migration chain (the P2-01M
  // runner's adjusted schema has no export tables). Every human decision is a
  // service call by an authorized synthetic actor; nothing is written by SQL.
  const NORMAL_CHAIN = process.env.KAI_PLAN_A_NORMAL_CHAIN === "1";
  const onNormalChain = { skip: NORMAL_CHAIN ? false : "needs the Plan A normal migration chain (export schema)" };
  const EXPORT_ENV = Object.freeze({ ...GEN_ENV, KAI_PUBLIC_EXPORT_ENABLED: "true" });
  const AI_ACTOR = { ...GK_ADMIN, actorType: "ai" };
  let clock = Date.parse("2026-10-22T13:00:00.000Z");
  const tick = () => new Date(clock += 1000).toISOString();
  const queueRow = async (queueType, targetId) => (await query(
    `SELECT review_queue_item_id::text, queue_status, review_status, updated_at FROM kai.review_queue_items
      WHERE organization_id = $1::uuid AND queue_type = $2 AND target_object_id = $3::uuid`, [ORG, queueType, targetId]))[0];
  const generatedRepository = () => createPostgresGeneratedContentRepository({ runInTransaction: withTx });
  const candidateRepository = () => createPostgresExportCandidateRepository({ runInTransaction: withTx });
  const authorityRepository = () => createPostgresHumanAuthorityDecisionRepository({ runInTransaction: withTx });
  const renderRepository = () => createPostgresExportManifestRenderModelRepository({ runInTransaction: withTx });
  const auditEvents = async () => (await query("SELECT action FROM kai.audit_events WHERE organization_id = $1::uuid ORDER BY audit_event_id", [ORG])).map((row) => row.action);
  // Each release helper acts on `target` (default: the measured draft and
  // its export ids); the organization-review test passes its own draft.
  const reviewStep = (fn, queueType, actor, now = tick(), target = ids) => async () => {
    const queue = await queueRow(queueType, target.measuredDraftId);
    return fn({
      organizationId: ORG, generatedContentDraftId: target.measuredDraftId,
      ...(queueType === "generated_content_review" ? { reviewQueueItemId: queue.review_queue_item_id } : { exportReviewQueueItemId: queue.review_queue_item_id }),
      expectedUpdatedAt: new Date(queue.updated_at).toISOString(), actorContext: actor, now,
    }, {
      env: EXPORT_ENV,
      generatedContentRepository: generatedRepository(),
      metadataOnlyAudit: queueType === "generated_content_review"
        ? auditFor(audits.createProductionMetadataOnlyAuditForGeneratedContentReview, { organizationId: ORG, generatedContentDraftId: target.measuredDraftId, reviewQueueItemId: queue.review_queue_item_id, actorContext: actor, now })
        : auditFor(audits.createProductionMetadataOnlyAuditForGeneratedDraftExportReview, { organizationId: ORG, generatedContentDraftId: target.measuredDraftId, actorContext: actor, now, route: "p3_09_export_review_start" }),
    });
  };
  const requestExportReview = (actor, requestedExportAudience = "internal", now = tick(), target = ids) => requestGeneratedDraftExportReview(
    { organizationId: ORG, generatedContentDraftId: target.measuredDraftId, requestedExportAudience, actorContext: actor, now },
    { env: EXPORT_ENV, generatedContentRepository: generatedRepository(), metadataOnlyAudit: auditFor(audits.createProductionMetadataOnlyAuditForGeneratedDraftExportReview, { organizationId: ORG, generatedContentDraftId: target.measuredDraftId, actorContext: actor, now }) });
  const confirmSnapshot = (actor, now = tick(), target = ids) => confirmGeneratedDraftLimitationSnapshotFromCitedPairs(
    { organizationId: ORG, generatedContentDraftId: target.measuredDraftId, actorContext: actor, now },
    { env: EXPORT_ENV, exportCandidateRepository: candidateRepository(), metadataOnlyAudit: auditFor(audits.createProductionMetadataOnlyAuditForGeneratedDraftLimitationSnapshot, { organizationId: ORG, generatedContentDraftId: target.measuredDraftId, actorContext: actor, now }) });
  const createCandidate = (actor, now = tick(), target = ids) => createGeneratedDraftExportCandidate(
    { organizationId: ORG, generatedContentDraftId: target.measuredDraftId, actorContext: actor, now },
    { env: EXPORT_ENV, exportCandidateRepository: candidateRepository(), metadataOnlyAudit: auditFor(audits.createProductionMetadataOnlyAuditForGeneratedDraftExportCandidate, { organizationId: ORG, generatedContentDraftId: target.measuredDraftId, actorContext: actor, now }) });
  const decideAuthority = (actor, decisionAction, requestedAudience = "internal", now = tick(), target = ids) => recordHumanFinalReleaseAuthorityDecision(
    { organizationId: ORG, exportCandidateId: target.exportCandidateId, requestedAudience, decisionAction, actorContext: actor, now },
    { env: EXPORT_ENV, humanAuthorityDecisionRepository: authorityRepository(), metadataOnlyAudit: auditFor(audits.createProductionMetadataOnlyAuditForHumanFinalReleaseAuthority, { organizationId: ORG, exportCandidateId: target.exportCandidateId, actorContext: actor, now }) });
  const releaseManifest = (actor, now = tick(), target = ids) => createExportManifest(
    { organizationId: ORG, exportCandidateId: target.exportCandidateId, exportReviewQueueItemId: target.exportReviewQueueItemId, actorContext: actor },
    { env: EXPORT_ENV, now, repository: createPostgresExportManifestRepository({ runInTransaction: withTx }), metadataOnlyAudit: auditFor(audits.createProductionMetadataOnlyAuditForExportManifest, { organizationId: ORG, exportCandidateId: target.exportCandidateId, actorContext: actor, now }) });
  // The production metadata-only audit writer, bound to this suite's pool (in
  // production it writes through the ambient pool, which here is the sentinel).
  const auditFor = (factory, options) => factory({ ...options, insertAuditEvent: (metadata) => insertRequiredSuccessfulAuditEvent(metadata, pool) });
  // The organization administrator's client reads, bound to this suite's pool.
  const clientDependencies = () => ({
    env: EXPORT_ENV,
    getEngagementForOrganization: (args) => getEngagementForOrganization(args, pool),
    readGeneratedDraftEngagementId: (organizationId, draftId) => readGeneratedDraftEngagementId(organizationId, draftId, pool),
    generatedContentRepository: generatedRepository(),
    releasedReportRepository: createPostgresClientReleasedReportRepository({ runInTransaction: withTx }),
    renderModelRepository: renderRepository(),
    organizationReviewRepository: createPostgresOrganizationInternalReviewRepository({ runInTransaction: withTx }),
  });
  const clientDraft = (actor, target = ids) => getClientInternalDraft(
    { organizationId: ORG, engagementId: ENGAGEMENT, generatedContentDraftId: target.measuredDraftId, actorContext: actor }, clientDependencies());
  // The organization administrator's factual approval through the real
  // service and repositories, with the production audit factory the route uses.
  const approveFactualReview = (actor, target, { decision = "approved", env = EXPORT_ENV, engagementId = ENGAGEMENT } = {}) => approveClientInternalDraftFactualReview(
    { organizationId: ORG, engagementId, generatedContentDraftId: target.measuredDraftId, decision, actorContext: actor },
    {
      ...clientDependencies(),
      env,
      createReviewAudit: ({ reviewQueueItemId, now }) => auditFor(audits.createProductionMetadataOnlyAuditForGeneratedContentReview,
        { organizationId: ORG, generatedContentDraftId: target.measuredDraftId, reviewQueueItemId, actorContext: actor, now }),
    });
  // The organization administrator's own release through the real service
  // and repositories, with the production audits the route composes.
  const releaseInternal = (actor, target, { decision = "release_for_internal_use", limitationsConfirmed = true, env = EXPORT_ENV, engagementId = ENGAGEMENT } = {}) => releaseClientInternalReport(
    { organizationId: ORG, engagementId, generatedContentDraftId: target.measuredDraftId, decision, limitationsConfirmed, actorContext: actor },
    {
      ...clientDependencies(),
      env,
      exportCandidateRepository: candidateRepository(),
      humanAuthorityDecisionRepository: authorityRepository(),
      exportManifestRepository: createPostgresExportManifestRepository({ runInTransaction: withTx }),
      now: tick,
      createReleaseAudit: audits.createProductionMetadataOnlyAuditsForOrganizationInternalRelease({
        organizationId: ORG, generatedContentDraftId: target.measuredDraftId, actorContext: actor,
        insertAuditEvent: (metadata) => insertRequiredSuccessfulAuditEvent(metadata, pool),
      }),
    });
  const exportCounts = async () => (await query(`SELECT
      (SELECT count(*) FROM kai.limitation_snapshots WHERE organization_id = $1::uuid)::int AS snapshots,
      (SELECT count(*) FROM kai.export_candidates WHERE organization_id = $1::uuid)::int AS candidates,
      (SELECT count(*) FROM kai.human_authority_decisions WHERE organization_id = $1::uuid)::int AS decisions,
      (SELECT count(*) FROM kai.export_manifests WHERE organization_id = $1::uuid)::int AS manifests`, [ORG]))[0];

  test("review: the persisted measured draft, its citation and limitations are read back; only a GK reviewer completes its review; nothing is releasable before", onNormalChain, async () => {
    const packet = await getGeneratedDraftReviewPacket(
      { organizationId: ORG, generatedContentDraftId: ids.measuredDraftId, actorContext: GK_REVIEWER },
      { env: EXPORT_ENV, generatedContentRepository: generatedRepository() });
    assert.equal(packet.ok, true, JSON.stringify(packet));
    assert.equal(packet.data.blocks.length, 1);
    assert.equal(packet.data.blocks[0].text, COMPLIANT_TEXT);
    assert.deepEqual(packet.data.blocks[0].citations.map((citation) => [citation.claimId, citation.evidenceItemId]), [[ids.measurementClaimId, ids.measurementEvidenceId]]);
    const [draftRow] = await query("SELECT validator_results FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [ids.measuredDraftId]);
    const vals = draftRow.validator_results.results || draftRow.validator_results;
    assert.equal(vals.find((item) => item.validator_key === "VAL-GEN-008").severity, "pass", "the limitation-disclosure check is recorded with the draft");

    // Before any review: no export review can be accepted and no candidate created.
    const before = await exportCounts();
    const early = await requestExportReview(GK_ADMIN);
    console.log(`[p2-01m] export review requested before GK review: ${JSON.stringify(early.error || early.data?.exportReviewRequestAccepted)}`);
    assert.ok(!early.ok || early.data.exportReviewRequestAccepted === false, `an unreviewed draft is not ready for export review: ${JSON.stringify(early)}`);
    assert.equal(await queueRow("export_review", ids.measuredDraftId), undefined, "no export review exists");
    const earlyCandidate = await createCandidate(GK_ADMIN);
    assert.equal(earlyCandidate.ok, false, JSON.stringify(earlyCandidate));
    assert.deepEqual(await exportCounts(), before);

    // The drafting organization administrator and the AI cannot review.
    for (const actor of [ADMIN, AI_ACTOR, OTHER_ADMIN]) {
      const refused = await reviewStep(startGeneratedContentReview, "generated_content_review", actor)();
      assert.equal(refused.ok, false, JSON.stringify(refused));
      assert.equal(refused.error.code, "authorization_denied");
    }
    const started = await reviewStep(startGeneratedContentReview, "generated_content_review", GK_REVIEWER)();
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.deepEqual([started.data.queueStatus, started.data.reviewStatus], ["in_progress", "needs_gk_review"]);
    const aiComplete = await reviewStep(completeGeneratedContentReview, "generated_content_review", AI_ACTOR)();
    assert.deepEqual([aiComplete.ok, aiComplete.error?.code], [false, "authorization_denied"], "AI cannot complete a review");
    assert.deepEqual((await clientDraft(ADMIN)).data.release, { state: "awaiting_get_kinder_review", releasedReportId: null }, "before the review is complete");
    const completed = await reviewStep(completeGeneratedContentReview, "generated_content_review", GK_REVIEWER)();
    assert.equal(completed.ok, true, JSON.stringify(completed));
    assert.deepEqual([completed.data.queueStatus, completed.data.reviewStatus], ["resolved", "resolved"]);
    assert.deepEqual((await clientDraft(ADMIN)).data.release, { state: "awaiting_get_kinder_release", releasedReportId: null }, "reviewed but not released");
    assert.ok((await auditEvents()).length > 0, "metadata-only audit events were written");
  });

  test("export review: only a GK administrator requests, starts, and completes it, for the draft's own audience only", onNormalChain, async () => {
    const before = await exportCounts();
    const byAdmin = await requestExportReview(ADMIN);
    assert.deepEqual([byAdmin.ok, byAdmin.error?.code], [false, "authorization_denied"]);
    const byReviewer = await requestExportReview(GK_REVIEWER);
    assert.deepEqual([byReviewer.ok, byReviewer.error?.code], [false, "authorization_denied"]);
    const flagOff = await requestGeneratedDraftExportReview(
      { organizationId: ORG, generatedContentDraftId: ids.measuredDraftId, requestedExportAudience: "internal", actorContext: GK_ADMIN, now: tick() },
      { env: GEN_ENV, generatedContentRepository: generatedRepository() });
    assert.deepEqual([flagOff.ok, flagOff.error?.code], [false, "feature_disabled"], "export stays behind KAI_PUBLIC_EXPORT_ENABLED");
    const wrongAudience = await requestExportReview(GK_ADMIN, "funder");
    assert.equal(wrongAudience.ok, true, JSON.stringify(wrongAudience));
    assert.equal(wrongAudience.data.exportReviewRequestAccepted, false, "a funder export of an internal draft is not accepted");
    const accepted = await requestExportReview(GK_ADMIN);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.equal(accepted.data.exportReviewRequestAccepted, true, JSON.stringify(accepted.data.validatorResult));
    ids.exportReviewQueueItemId = accepted.data.reviewQueueItemId;
    const startedByReviewer = await reviewStep(startGeneratedDraftExportReview, "export_review", GK_REVIEWER)();
    assert.deepEqual([startedByReviewer.ok, startedByReviewer.error?.code], [false, "authorization_denied"]);
    const started = await reviewStep(startGeneratedDraftExportReview, "export_review", GK_ADMIN)();
    assert.equal(started.ok, true, JSON.stringify(started));
    const completed = await reviewStep(completeGeneratedDraftExportReview, "export_review", GK_ADMIN)();
    assert.equal(completed.ok, true, JSON.stringify(completed));
    assert.deepEqual([completed.data.queueStatus, completed.data.reviewStatus], ["resolved", "resolved"]);
    assert.deepEqual(await exportCounts(), before);
  });

  test("limitation snapshot and candidate: the measured claim's material limitations are snapshotted and cannot be confirmed away; only a GK administrator creates the candidate", onNormalChain, async () => {
    const byAdmin = await confirmSnapshot(ADMIN);
    assert.deepEqual([byAdmin.ok, byAdmin.error?.code], [false, "authorization_denied"]);
    // A hand-built confirmation that drops the limitations is refused.
    const discarded = await confirmGeneratedDraftLimitationSnapshot(
      { organizationId: ORG, generatedContentDraftId: ids.measuredDraftId, entries: [{ claimId: ids.measurementClaimId, evidenceItemId: ids.measurementEvidenceId, limitationCodes: [] }], actorContext: GK_REVIEWER, now: tick() },
      { env: EXPORT_ENV, exportCandidateRepository: candidateRepository(), metadataOnlyAudit: auditFor(audits.createProductionMetadataOnlyAuditForGeneratedDraftLimitationSnapshot, { organizationId: ORG, generatedContentDraftId: ids.measuredDraftId, actorContext: GK_REVIEWER, now: NOW }) });
    assert.deepEqual([discarded.ok, discarded.error?.code], [false, "validation_blocker"], JSON.stringify(discarded));
    const wrongPair = await confirmGeneratedDraftLimitationSnapshot(
      { organizationId: ORG, generatedContentDraftId: ids.measuredDraftId, entries: [{ claimId: ids.measurementClaimId, evidenceItemId: ids.legacyFieldEvidenceId, limitationCodes: MEASURED_LIMITATION_CODES }], actorContext: GK_REVIEWER, now: tick() },
      { env: EXPORT_ENV, exportCandidateRepository: candidateRepository(), metadataOnlyAudit: auditFor(audits.createProductionMetadataOnlyAuditForGeneratedDraftLimitationSnapshot, { organizationId: ORG, generatedContentDraftId: ids.measuredDraftId, actorContext: GK_REVIEWER, now: NOW }) });
    assert.deepEqual([wrongPair.ok, wrongPair.error?.code], [false, "validation_blocker"], "an incorrect citation pair is refused");
    assert.equal((await exportCounts()).snapshots, 0);

    const snapshot = await confirmSnapshot(GK_REVIEWER);
    assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
    assert.equal(snapshot.data.citedPairCount, 1);
    const entries = await query("SELECT claim_id::text, evidence_item_id::text, limitation_codes FROM kai.limitation_snapshot_entries WHERE limitation_snapshot_id = $1::uuid", [snapshot.data.limitationSnapshotId]);
    assert.deepEqual(entries, [{ claim_id: ids.measurementClaimId, evidence_item_id: ids.measurementEvidenceId, limitation_codes: MEASURED_LIMITATION_CODES }]);

    for (const actor of [ADMIN, GK_REVIEWER, AI_ACTOR]) {
      const refused = await createCandidate(actor);
      assert.deepEqual([refused.ok, refused.error?.code], [false, "authorization_denied"], JSON.stringify(refused));
    }
    const candidate = await createCandidate(GK_ADMIN);
    assert.equal(candidate.ok, true, JSON.stringify(candidate));
    assert.deepEqual([candidate.data.requestedAudience, candidate.data.limitationSnapshotId], ["internal", snapshot.data.limitationSnapshotId]);
    ids.exportCandidateId = candidate.data.exportCandidateId;
  });

  test("release: without authority nothing is released; only a GK administrator's final-release decision, for the candidate's audience, permits the manifest", onNormalChain, async () => {
    const before = await exportCounts();
    const unauthorized = await releaseManifest(GK_ADMIN);
    assert.deepEqual([unauthorized.ok, unauthorized.error?.code], [false, "validation_blocker"], JSON.stringify(unauthorized));
    for (const actor of [ADMIN, GK_REVIEWER, AI_ACTOR, OTHER_GK_ADMIN]) {
      const refused = await decideAuthority(actor, "grant");
      assert.equal(refused.ok, false, JSON.stringify(refused));
      assert.equal(refused.error.code, "authorization_denied");
    }
    const wrongAudience = await decideAuthority(GK_ADMIN, "grant", "funder");
    assert.equal(wrongAudience.ok, false, "authority for another audience is refused");
    for (const actor of [ADMIN, GK_REVIEWER, AI_ACTOR]) {
      const refused = await releaseManifest(actor);
      assert.deepEqual([refused.ok, refused.error?.code], [false, "authorization_denied"], JSON.stringify(refused));
    }
    assert.deepEqual(await exportCounts(), before);

    const granted = await decideAuthority(GK_ADMIN, "grant");
    assert.equal(granted.ok, true, JSON.stringify(granted));
    assert.deepEqual([granted.data.effective, granted.data.decidedByRole, granted.data.requestedAudience], [true, "gk_admin", "internal"]);
    const manifest = await releaseManifest(GK_ADMIN);
    assert.equal(manifest.ok, true, JSON.stringify(manifest));
    assert.equal(manifest.data.effectiveAuthorityDecisionId, granted.data.decisionId);
    ids.exportManifestId = manifest.data.exportManifestId;
    const replay = await releaseManifest(GK_ADMIN);
    assert.deepEqual([replay.ok, replay.data?.exportManifestId, replay.data?.replayed], [true, ids.exportManifestId, true]);
    const actions = await auditEvents();
    console.log(`[p2-01m] audit_events actions: ${[...new Set(actions)].join(", ")}`);
  });

  // Independent reading of a rendered or stored text: the number of
  // programme sessions it states.
  const statedCount = (text) => Number((/(\d+) programme sessions/.exec(text) || [])[1]);

  test("Markdown: retrieved through the delivery route, the document states the same independently computed count, qualified, cited, and with every material limitation", onNormalChain, async () => {
    const app = express();
    const actors = {
      gk_admin: GK_ADMIN, client_admin: ADMIN, gk_reviewer: GK_REVIEWER, other_gk_admin: OTHER_GK_ADMIN, ai: AI_ACTOR,
      client_reviewer: REVIEWER, client_contributor: CONTRIBUTOR, other_admin: OTHER_ADMIN,
    };
    // Real route (path validation, actor mapping, attachment, error mapping)
    // and real service/repositories; only the database binding (the ambient
    // pool is the sentinel here) and the signed-in actor are supplied, as in
    // the existing route tests.
    cleanups.push(routeTestables.setIntakeServiceForTest({
      serializeExportManifestToMarkdown: (input) => serializeExportManifestToMarkdown(input, { renderModelDependencies: { env: EXPORT_ENV, repository: renderRepository() } }),
      getClientReleasedReportMarkdown: (input) => getClientReleasedReportMarkdown(input, clientDependencies()),
    }));
    cleanups.push(routeTestables.setActorContextMiddlewareForTest((req, _res, next) => { req.kaiSprint2ActorContext = actors[req.headers["x-plan-a-actor"]]; next(); }));
    const previous = process.env.KAI_SPRINT2_ENABLED;
    process.env.KAI_SPRINT2_ENABLED = "true";
    cleanups.push(() => { if (previous === undefined) delete process.env.KAI_SPRINT2_ENABLED; else process.env.KAI_SPRINT2_ENABLED = previous; });
    app.use((req, _res, next) => { req.user = { id: 1 }; req.isAuthenticated = () => true; next(); });
    app.use(sprint2IntakeApiRouter);
    const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    cleanups.push(() => new Promise((resolve) => server.close(resolve)));
    const get = (organizationId, actor) => new Promise((resolve, reject) => {
      http.get({ hostname: "127.0.0.1", port: server.address().port, path: `/admin/organizations/${organizationId}/export-manifests/${ids.exportManifestId}/markdown`, headers: { "x-plan-a-actor": actor } }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
      }).on("error", reject);
    });
    ids.getMarkdown = get;
    ids.getClientMarkdown = (organizationId, engagementId, exportManifestId, actor) => new Promise((resolve, reject) => {
      http.get({
        hostname: "127.0.0.1", port: server.address().port, headers: { "x-plan-a-actor": actor },
        path: `/admin/organizations/${organizationId}/engagements/${engagementId}/client-released-reports/${exportManifestId}/markdown`,
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
      }).on("error", reject);
    });

    const delivered = await get(ORG, "gk_admin");
    assert.equal(delivered.statusCode, 200, delivered.body);
    assert.match(delivered.headers["content-type"], /markdown/);
    assert.match(delivered.headers["content-disposition"], /attachment; filename="kai-export-manifest\.md"/);
    const markdown = delivered.body;
    ids.gkMarkdown = markdown;
    console.log(`[p2-01m] delivered Markdown:\n${markdown}`);

    // Original file -> evidence -> claim -> generator input -> draft -> reviewed content -> Markdown.
    const expected = independentRecordCount(CSV);
    const [stored] = await query(
      `SELECT m.measured_value, e.statement AS evidence, c.statement AS claim, b.text AS block
         FROM kai.evidence_measurements m JOIN kai.evidence_items e ON e.evidence_item_id = m.evidence_item_id
         JOIN kai.claims c ON c.evidence_item_id = e.evidence_item_id
         JOIN kai.generated_content_citations gc ON gc.claim_id = c.claim_id
         JOIN kai.generated_content_blocks b ON b.generated_content_block_id = gc.generated_content_block_id
        WHERE b.generated_content_draft_id = $1::uuid`, [ids.measuredDraftId]);
    const packet = await getGeneratedDraftReviewPacket({ organizationId: ORG, generatedContentDraftId: ids.measuredDraftId, actorContext: GK_ADMIN }, { env: EXPORT_ENV, generatedContentRepository: generatedRepository() });
    const stages = {
      file: expected,
      measurement: Number(stored.measured_value),
      evidence: Number((/record count: (\d+) programme sessions/.exec(stored.evidence) || [])[1]),
      claim: statedCount(stored.claim),
      generatorInput: statedCount(ids.generatorClaimStatement),
      draft: statedCount(stored.block),
      reviewed: statedCount(packet.data.blocks[0].text),
      markdown: statedCount(markdown),
    };
    console.log(`[p2-01m] count by stage: ${JSON.stringify(stages)}`);
    for (const [stage, value] of Object.entries(stages)) assert.equal(value, 5, stage);

    // Context, qualified count, definition, blanks, duplicates, period.
    assert.match(markdown, new RegExp(`Organization: Riverside Literacy Collective \\(synthetic\\) \\(\`${ORG}\`\\)`));
    assert.match(markdown, new RegExp(`Engagement: \`p2-01m\` \\(\`${ENGAGEMENT}\`\\)`));
    assert.match(markdown, /Requested audience: `internal`/);
    assert.match(markdown, /records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30/);
    assert.match(markdown, /count of source records, each counted as one programme session under the human-confirmed definition/);
    assert.match(markdown, /1 blank record was excluded/);
    assert.match(markdown, /2 exact-duplicate records were included/);
    assert.match(markdown, /period is attested in that definition and not verified against record dates/);
    // Citation to the claim, the measurement evidence, the source, and the version.
    assert.match(markdown, /References: \[CIT-001\]/);
    assert.ok(markdown.includes(`- [CIT-001] Claim \`${ids.measurementClaimId}\`; evidence \`${ids.measurementEvidenceId}\`; source \`${ids.main.sourceId}\`; source version \`${ids.main.sourceVersionId}\`.`), markdown);
    // Every material limitation, by code, attached to that citation.
    const limitationLine = markdown.split("\n").find((line) => line.startsWith("- [CIT-001] limitation codes:"));
    assert.ok(limitationLine, markdown);
    for (const code of MEASURED_LIMITATION_CODES) assert.ok(limitationLine.includes(`\`${code}\``), code);
    // Nothing the evidence does not support.
    const prose = markdown.split("## Citation Appendix")[0];
    assert.doesNotMatch(prose, /\b(distinct|unique|individuals?|people|participants?|attendees|households?|rate|per cent|percent|outcomes?|because|caused?|improv\w*|impact\w*|increase\w*|led to|result\w* in)\b|%/i);
    assert.doesNotMatch(prose.replace(/not verified/g, ""), /\bverified\b/i);
    assert.doesNotMatch(markdown, /literacy|mentoring|2026-09-16|sessions\.csv/, "no row values or file names");
  });

  test("customer receipt: the organization administrator sees the release and retrieves the same released Markdown through the client route; nothing else can", onNormalChain, async () => {
    const detail = await clientDraft(ADMIN);
    assert.equal(detail.ok, true, JSON.stringify(detail));
    assert.equal(detail.data.reviewState, "reviewed_by_get_kinder");
    assert.deepEqual(detail.data.release, { state: "released_for_internal_use", releasedReportId: ids.exportManifestId });
    const received = await ids.getClientMarkdown(ORG, ENGAGEMENT, ids.exportManifestId, "client_admin");
    assert.equal(received.statusCode, 200, received.body);
    assert.match(received.headers["content-disposition"], /attachment; filename="kai-export-manifest\.md"/);
    assert.equal(received.body, ids.gkMarkdown, "the organization receives exactly the document Get Kinder released");
    assert.equal(statedCount(received.body), independentRecordCount(CSV));
    for (const code of MEASURED_LIMITATION_CODES) assert.ok(received.body.includes(`\`${code}\``), code);
    assert.match(received.body, /Missing values: a known limitation of this source, recorded and not removed\./);
    assert.match(received.body, /Exact-duplicate records are included in the count; they were not removed or merged, so the count is not of distinct events\./);
    assert.match(received.body, /The reporting period was stated in that definition; it was not checked against dates in the records\./);
    assert.match(received.body, /Small-number \(small-cell\) risk: not resolved; accepted as a limitation for internal use only\./);

    const [otherEngagement] = await query("INSERT INTO kai.engagements (organization_id, engagement_code) VALUES ($1::uuid, 'p2-01m-second') RETURNING engagement_id::text", [ORG]);
    for (const [label, organizationId, engagementId, manifestId, actor, status] of [
      ["client_reviewer", ORG, ENGAGEMENT, ids.exportManifestId, "client_reviewer", 403],
      ["client_contributor", ORG, ENGAGEMENT, ids.exportManifestId, "client_contributor", 403],
      ["GK reviewer (not a customer receipt role)", ORG, ENGAGEMENT, ids.exportManifestId, "gk_reviewer", 403],
      ["AI actor", ORG, ENGAGEMENT, ids.exportManifestId, "ai", 403],
      ["another organization's administrator", ORG, ENGAGEMENT, ids.exportManifestId, "other_admin", 403],
      ["another organization's path", OTHER_ORG, OTHER_ENGAGEMENT, ids.exportManifestId, "other_admin", 404],
      ["another Project of the same organization", ORG, otherEngagement.engagement_id, ids.exportManifestId, "client_admin", 404],
      ["no such report", ORG, ENGAGEMENT, "0e000000-0000-4000-8000-0000000fff01", "client_admin", 404],
    ]) {
      const refused = await ids.getClientMarkdown(organizationId, engagementId, manifestId, actor);
      assert.equal(refused.statusCode, status, `${label}: ${refused.body}`);
      assert.doesNotMatch(refused.body, /programme sessions/, label);
    }
    // The customer route never reaches the GK delivery route or any GK decision.
    assert.equal((await ids.getMarkdown(ORG, "client_admin")).statusCode, 403);
    for (const attempt of [() => decideAuthority(ADMIN, "grant"), () => decideAuthority(ADMIN, "revoke"), () => releaseManifest(ADMIN)]) {
      const refused = await attempt();
      assert.deepEqual([refused.ok, refused.error?.code], [false, "authorization_denied"]);
    }
  });

  test("retrieval: the organization administrator, a GK reviewer, another organization, and the AI cannot retrieve; a revoked release cannot be retrieved until re-granted", onNormalChain, async () => {
    for (const [organizationId, actor, status] of [
      [ORG, "client_admin", 403], [ORG, "gk_reviewer", 403], [ORG, "other_gk_admin", 403], [OTHER_ORG, "other_gk_admin", 404], [ORG, "ai", 403],
    ]) {
      const refused = await ids.getMarkdown(organizationId, actor);
      assert.equal(refused.statusCode, status, `${actor}@${organizationId}: ${refused.body}`);
      assert.doesNotMatch(refused.body, /programme sessions/);
    }
    const before = await exportCounts();
    const revoked = await decideAuthority(GK_ADMIN, "revoke");
    assert.equal(revoked.ok, true, JSON.stringify(revoked));
    assert.equal(revoked.data.effective, false);
    const afterRevoke = await ids.getMarkdown(ORG, "gk_admin");
    assert.equal(afterRevoke.statusCode, 409, afterRevoke.body);
    const clientAfterRevoke = await ids.getClientMarkdown(ORG, ENGAGEMENT, ids.exportManifestId, "client_admin");
    assert.equal(clientAfterRevoke.statusCode, 409, clientAfterRevoke.body);
    assert.doesNotMatch(clientAfterRevoke.body, /programme sessions/);
    assert.deepEqual((await clientDraft(ADMIN)).data.release, { state: "release_no_longer_valid", releasedReportId: null });
    assert.match(afterRevoke.body, /conflict_current_state_changed/);
    assert.doesNotMatch(afterRevoke.body, /programme sessions/);
    const noNewRelease = await releaseManifest(GK_ADMIN, tick());
    assert.equal(noNewRelease.ok, false, "no new manifest while authority is revoked");
    const regranted = await decideAuthority(GK_ADMIN, "grant");
    assert.equal(regranted.ok, true, JSON.stringify(regranted));
    assert.equal(regranted.data.effective, true);
    assert.equal((await ids.getMarkdown(ORG, "gk_admin")).statusCode, 200);
    assert.equal((await ids.getClientMarkdown(ORG, ENGAGEMENT, ids.exportManifestId, "client_admin")).statusCode, 200);
    assert.equal((await clientDraft(ADMIN)).data.release.state, "released_for_internal_use");
    const after = await exportCounts();
    assert.deepEqual([after.snapshots, after.candidates, after.manifests], [before.snapshots, before.candidates, before.manifests]);
    assert.equal(after.decisions, before.decisions + 2, "revoke and re-grant are two appended decisions");
  });

  test("organization review and release: the administrator reviews, then separately releases, an ordinary internal evidence summary under their own identity through the real chain; Get Kinder keeps the high-risk review and release and can withdraw it; the administrator receives the released Markdown", onNormalChain, async () => {
    const ordinary = { ...ids.ordinary };
    assert.ok(ordinary.claimId, "the AI-permitted, all-absent source's measured claim exists");
    const exportCountsAtStart = await exportCounts();
    // The claim becomes eligible through the same GK steps as the measured claim.
    const reviewDeps = { env: ENV, humanReviewRepository: createPostgresHumanReviewRepository({ runInTransaction: withTx }), metadataOnlyAudit: noAudit() };
    const evidenceQueue = await queueRow("evidence_review", ordinary.evidenceItemId);
    assert.equal((await recordEvidenceReviewDecision({
      organizationId: ORG, evidenceItemId: ordinary.evidenceItemId, reviewQueueItemId: evidenceQueue.review_queue_item_id,
      expectedUpdatedAt: new Date(evidenceQueue.updated_at).toISOString(), decision: "supported", actorContext: GK_REVIEWER, now: NOW,
    }, reviewDeps)).ok, true);
    const claimQueue = await queueRow("claim_review", ordinary.claimId);
    assert.equal((await recordClaimReviewDecision({
      organizationId: ORG, claimId: ordinary.claimId, reviewQueueItemId: claimQueue.review_queue_item_id,
      expectedUpdatedAt: new Date(claimQueue.updated_at).toISOString(), decision: "approved", approvedAudiences: ["internal"], actorContext: GK_REVIEWER, now: NOW,
    }, reviewDeps)).ok, true);
    const reviewed = await trace(ordinary.claimId);
    for (const [dimensionKey, value] of Object.entries(reviewed.data.dimensions)) {
      if (value.assessment_status !== "unresolved") continue;
      const accepted = await acceptInternalCoverageLimitation(
        { organizationId: ORG, claimId: ordinary.claimId, dimensionKey, actorContext: GK_REVIEWER, now: NOW },
        { env: ENV, coverageReviewDecisionRepository: createPostgresCoverageReviewDecisionRepository({ runInTransaction: withTx }), metadataOnlyAudit: noAudit() });
      assert.equal(accepted.ok, true, `${dimensionKey}: ${JSON.stringify(accepted)}`);
    }
    assert.equal((await trace(ordinary.claimId)).data.eligible, true);

    // The administrator generates the ordinary draft; the provider double's
    // approval fields change nothing.
    const generated = await generate([ordinary.claimId], providerDouble(() => ({
      blocks: [measuredBlock(COMPLIANT_TEXT, ordinary.claimId, ordinary.evidenceItemId)], approved: true, draftStatus: "approved", reviewStatus: "resolved",
    })));
    assert.equal(generated.ok, true, JSON.stringify(generated));
    ordinary.measuredDraftId = generated.data.generatedContentDraftId;
    // A second draft from the measured claim, whose source has no completed
    // sensitivity review: Get Kinder's alone.
    const heldDraft = await generate([ids.measurementClaimId], replying(measuredBlock(COMPLIANT_TEXT)));
    assert.equal(heldDraft.ok, true, JSON.stringify(heldDraft));
    const held = { measuredDraftId: heldDraft.data.generatedContentDraftId };

    // Read back: the actual text, its citation and limitations, and who may review.
    const detail = await clientDraft(ADMIN, ordinary);
    assert.equal(detail.ok, true, JSON.stringify(detail));
    assert.equal(detail.data.blocks[0].text, COMPLIANT_TEXT);
    assert.deepEqual(detail.data.blocks[0].supportingClaimIds, [ordinary.claimId]);
    assert.equal(detail.data.reviewState, "awaiting_organization_review");
    assert.deepEqual(detail.data.factualReview, { actorMayApprove: true, getKinderReviewReasons: [], blockedReasons: [] });
    assert.deepEqual(detail.data.release, { state: "awaiting_organization_review", releasedReportId: null });
    const heldDetail = await clientDraft(ADMIN, held);
    assert.equal(heldDetail.data.reviewState, "awaiting_get_kinder_review");
    assert.deepEqual(heldDetail.data.factualReview, { actorMayApprove: false, getKinderReviewReasons: ["sensitivity_review_not_complete"], blockedReasons: [] });

    const lifecycleAudits = async (draftId) => query(
      `SELECT operation, metadata->>'actor_id' AS actor_id, metadata->>'contract' AS contract FROM kai.upload_lifecycle_audit
        WHERE organization_id = $1::uuid AND metadata->>'generated_content_draft_id' = $2 AND operation LIKE 'generated_content_review_%' ORDER BY created_at, operation`,
      [ORG, draftId]);
    const reviewEvents = async () => (await query(
      "SELECT action, actor_user_id::text AS actor FROM kai.audit_events WHERE organization_id = $1::uuid AND action IN ('generated_content_review_started', 'generated_content_review_completed') ORDER BY audit_event_id",
      [ORG])).map((row) => `${row.action}:${row.actor}`);

    // GK-only: the high-risk draft is refused with the structured blocker and nothing is written.
    const queueBefore = await queueRow("generated_content_review", held.measuredDraftId);
    const refusedHeld = await approveFactualReview(ADMIN, held);
    assert.deepEqual([refusedHeld.ok, refusedHeld.error?.code, refusedHeld.error?.status], [false, "blocked", 422], JSON.stringify(refusedHeld));
    assert.deepEqual(refusedHeld.blockers, [{ validator_key: "VAL-KAI-ORG-REVIEW-001", severity: "blocker", blocking_reason: "sensitivity_review_not_complete" }]);
    assert.deepEqual(await queueRow("generated_content_review", held.measuredDraftId), queueBefore);
    assert.deepEqual(await lifecycleAudits(held.measuredDraftId), []);

    // Unreviewed: no export review is accepted for the ordinary draft yet.
    const early = await requestExportReview(GK_ADMIN, "internal", tick(), ordinary);
    assert.ok(!early.ok || early.data.exportReviewRequestAccepted === false, JSON.stringify(early));

    // Refused before any write: other roles, GK (its own route), another
    // organization, an inactive administrator, the AI, other decisions, flags off, another Project.
    const eventsBefore = await reviewEvents();
    const INACTIVE_ADMIN = { ...ADMIN, organizationMemberships: [{ ...ADMIN.organizationMemberships[0], membership_status: "inactive" }] };
    for (const [label, actor] of [["client_reviewer", REVIEWER], ["client_contributor", CONTRIBUTOR], ["gk_reviewer", GK_REVIEWER], ["gk_admin", GK_ADMIN],
      ["another organization's administrator", OTHER_ADMIN], ["inactive administrator", INACTIVE_ADMIN], ["AI", { ...ADMIN, actorType: "ai" }]]) {
      const refused = await approveFactualReview(actor, ordinary);
      assert.deepEqual([refused.ok, refused.error?.status], [false, 403], `${label}: ${JSON.stringify(refused)}`);
    }
    for (const decision of ["rejected", "needs_changes"]) {
      assert.equal((await approveFactualReview(ADMIN, ordinary, { decision })).error?.code, "validation_blocker", decision);
    }
    assert.equal((await approveFactualReview(ADMIN, ordinary, { env: ENV })).error?.code, "feature_disabled", "generation flag off");
    const [secondProject] = await query("INSERT INTO kai.engagements (organization_id, engagement_code) VALUES ($1::uuid, 'p2-01m-org-review') RETURNING engagement_id::text", [ORG]);
    assert.equal((await approveFactualReview(ADMIN, ordinary, { engagementId: secondProject.engagement_id })).error?.code, "not_found");
    assert.deepEqual(await reviewEvents(), eventsBefore);
    assert.deepEqual(await lifecycleAudits(ordinary.measuredDraftId), []);

    // The administrator's approval: the existing start and completion, attributed to the human.
    const approved = await approveFactualReview(ADMIN, ordinary);
    assert.equal(approved.ok, true, JSON.stringify(approved));
    assert.deepEqual(approved.data, { generatedContentDraftId: ordinary.measuredDraftId, reviewState: "reviewed_by_your_organization", replayed: false });
    const queue = await queueRow("generated_content_review", ordinary.measuredDraftId);
    assert.deepEqual([queue.queue_status, queue.review_status], ["resolved", "resolved"]);
    assert.deepEqual(await lifecycleAudits(ordinary.measuredDraftId), [
      { operation: "generated_content_review_started", actor_id: ADMIN.actorUserId, contract: "p3_stage_b_generated_content_review_start_v1" },
      { operation: "generated_content_review_completed", actor_id: ADMIN.actorUserId, contract: ORGANIZATION_REVIEW_COMPLETION_AUDIT_CONTRACT },
    ]);
    assert.deepEqual((await reviewEvents()).slice(eventsBefore.length),
      [`generated_content_review_started:${ADMIN.actorUserId}`, `generated_content_review_completed:${ADMIN.actorUserId}`]);
    const [draftRow] = await query("SELECT draft_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = $1::uuid", [ordinary.measuredDraftId]);
    assert.equal(draftRow.draft_status, "draft", "the draft itself is unchanged; nothing is approved for release");
    const replay = await approveFactualReview(ADMIN, ordinary);
    assert.deepEqual([replay.ok, replay.data?.replayed], [true, true]);
    assert.equal((await lifecycleAudits(ordinary.measuredDraftId)).length, 2, "a repeat records nothing");
    const reviewedDetail = await clientDraft(ADMIN, ordinary);
    assert.equal(reviewedDetail.data.reviewState, "reviewed_by_your_organization");
    // Reviewed is not released: release is the separate decision below.
    assert.deepEqual(reviewedDetail.data.release, { state: "awaiting_organization_release", releasedReportId: null });
    assert.deepEqual(reviewedDetail.data.organizationRelease, { actorMayRelease: true, getKinderReleaseReasons: [], blockedReasons: [], releasedBy: null });
    assert.deepEqual(await exportCounts(), exportCountsAtStart, "the factual review writes no release record");
    console.log(`[p2-01m] organization review: ${JSON.stringify(approved.data)}; held draft blockers=${JSON.stringify(refusedHeld.blockers.map((b) => b.blocking_reason))}`);

    // The GK release routes stay Get Kinder's, for every audience.
    for (const audience of ["internal", "funder", "public"]) {
      const refused = await requestExportReview(ADMIN, audience, tick(), ordinary);
      assert.deepEqual([refused.ok, refused.error?.code], [false, "authorization_denied"], audience);
    }
    assert.deepEqual([(await confirmSnapshot(ADMIN, tick(), ordinary)).error?.code, (await createCandidate(ADMIN, tick(), ordinary)).error?.code],
      ["authorization_denied", "authorization_denied"]);

    // Refused before any write: other roles (GK releases through its own
    // routes), another organization, an inactive administrator, the AI, an
    // unconfirmed or other decision, the export flag off, another Project.
    const countsBefore = await exportCounts();
    const INACTIVE_RELEASER = { ...ADMIN, organizationMemberships: [{ ...ADMIN.organizationMemberships[0], membership_status: "inactive" }] };
    for (const [label, actor] of [["client_reviewer", REVIEWER], ["client_contributor", CONTRIBUTOR], ["gk_reviewer", GK_REVIEWER], ["gk_admin", GK_ADMIN],
      ["another organization's administrator", OTHER_ADMIN], ["inactive administrator", INACTIVE_RELEASER], ["AI", { ...ADMIN, actorType: "ai" }]]) {
      const refused = await releaseInternal(actor, ordinary);
      assert.deepEqual([refused.ok, refused.error?.status], [false, 403], `${label}: ${JSON.stringify(refused)}`);
    }
    for (const [label, options] of [["unconfirmed", { limitationsConfirmed: false }], ["approved", { decision: "approved" }], ["funder", { decision: "release_for_funder_use" }]]) {
      assert.equal((await releaseInternal(ADMIN, ordinary, options)).error?.code, "validation_blocker", label);
    }
    const flagOff = await releaseInternal(ADMIN, ordinary, { env: GEN_ENV });
    assert.equal(flagOff.error?.code, "feature_disabled", "KAI_PUBLIC_EXPORT_ENABLED off: no internal release");
    assert.equal((await releaseInternal(ADMIN, ordinary, { engagementId: secondProject.engagement_id })).error?.code, "not_found");
    // The held draft: unreviewed, and its source has no sensitivity decision.
    const heldRelease = await releaseInternal(ADMIN, held);
    assert.deepEqual([heldRelease.error?.code, heldRelease.blockers?.map((b) => b.blocking_reason)],
      ["blocked", ["sensitivity_review_not_complete", "factual_review_not_complete"]], JSON.stringify(heldRelease));
    assert.deepEqual(await exportCounts(), countsBefore, "nothing written by any refusal");

    // The release decision: the existing chain under the administrator's identity.
    const released = await releaseInternal(ADMIN, ordinary);
    assert.equal(released.ok, true, JSON.stringify(released));
    assert.deepEqual({ ...released.data, releasedReportId: undefined }, {
      generatedContentDraftId: ordinary.measuredDraftId, releaseState: "released_for_internal_use", releasedReportId: undefined, releasedBy: "your_organization", replayed: false,
    });
    const manifestId = released.data.releasedReportId;
    const [decisionRow] = await query(
      `SELECT d.decision_id::text, d.decided_by::text, d.decided_by_role, d.decision_type, d.decision_action, d.created_by_type,
              c.export_candidate_id::text, c.created_by::text AS candidate_by, c.requested_audience, c.content_type,
              s.confirmed_by::text AS snapshot_by, s.confirmed_by_role, m.created_by::text AS manifest_by, m.export_review_queue_item_id::text
         FROM kai.export_manifests m
         JOIN kai.human_authority_decisions d ON d.decision_id = m.effective_authority_decision_id
         JOIN kai.export_candidates c ON c.export_candidate_id = m.export_candidate_id
         JOIN kai.limitation_snapshots s ON s.limitation_snapshot_id = c.limitation_snapshot_id
        WHERE m.export_manifest_id = $1::uuid`, [manifestId]);
    assert.deepEqual(
      [decisionRow.decided_by, decisionRow.decided_by_role, decisionRow.decision_type, decisionRow.decision_action, decisionRow.created_by_type],
      [ADMIN.actorUserId, "client_admin", "export_authority_granted", "grant", "human"], "the final-release decision is the administrator's own");
    assert.deepEqual([decisionRow.snapshot_by, decisionRow.confirmed_by_role], [ADMIN.actorUserId, "client_admin"], "the limitation snapshot is the administrator's own");
    assert.deepEqual([decisionRow.candidate_by, decisionRow.manifest_by, decisionRow.requested_audience, decisionRow.content_type],
      [ADMIN.actorUserId, ADMIN.actorUserId, "internal", "evidence_summary"]);
    ordinary.exportCandidateId = decisionRow.export_candidate_id;
    ordinary.exportReviewQueueItemId = decisionRow.export_review_queue_item_id;
    const exportQueue = await queueRow("export_review", ordinary.measuredDraftId);
    assert.deepEqual([exportQueue.queue_status, exportQueue.review_status], ["resolved", "resolved"]);
    const releaseAudits = await query(
      `SELECT operation, metadata->>'actor_id' AS actor_id, metadata->>'decided_by' AS decided_by,
              coalesce(metadata->>'decided_by_role', metadata->>'confirmed_by_role') AS role
         FROM kai.upload_lifecycle_audit
        WHERE organization_id = $1::uuid AND operation IN ('export_review_requested', 'export_review_started', 'export_review_completed',
              'limitation_snapshot_confirmed', 'export_candidate_created', 'human_authority_decision_recorded')
          AND (metadata->>'generated_content_draft_id' = $2 OR metadata->>'export_candidate_id' = $3)
        ORDER BY created_at, operation`, [ORG, ordinary.measuredDraftId, ordinary.exportCandidateId]);
    assert.deepEqual(releaseAudits.map((row) => row.operation), [
      "export_review_requested", "export_review_started", "export_review_completed", "limitation_snapshot_confirmed", "export_candidate_created", "human_authority_decision_recorded",
    ]);
    for (const row of releaseAudits) assert.equal(row.actor_id ?? row.decided_by, ADMIN.actorUserId, `${row.operation} is attributed to the administrator`);
    assert.deepEqual(releaseAudits.filter((row) => row.role).map((row) => `${row.operation}:${row.role}`),
      ["limitation_snapshot_confirmed:client_admin", "human_authority_decision_recorded:client_admin"]);
    const releaseEvents = await query(
      `SELECT action, actor_user_id::text AS actor FROM kai.audit_events WHERE organization_id = $1::uuid
          AND action IN ('export_review_requested', 'export_review_started', 'export_review_completed', 'limitation_snapshot_confirmed', 'export_candidate_created', 'human_authority_decision_recorded', 'export_manifest_created')
          AND actor_user_id = $2::uuid ORDER BY audit_event_id`, [ORG, ADMIN.actorUserId]);
    assert.deepEqual(releaseEvents.map((row) => row.action), [
      "export_review_requested", "export_review_started", "export_review_completed", "limitation_snapshot_confirmed", "export_candidate_created", "human_authority_decision_recorded", "export_manifest_created",
    ], "one kai.audit_events row per step, as the administrator");
    console.log(`[p2-01m] organization release: decision=${JSON.stringify(decisionRow)}; audits=${JSON.stringify(releaseAudits)}; events=${JSON.stringify(releaseEvents.map((row) => `${row.action}:${row.actor}`))}`);

    // A repeat writes nothing; the detail shows the organization's release.
    const countsAfter = await exportCounts();
    const repeat = await releaseInternal(ADMIN, ordinary);
    assert.deepEqual([repeat.ok, repeat.data?.replayed, repeat.data?.releasedReportId], [true, true, manifestId]);
    assert.deepEqual(await exportCounts(), countsAfter);
    const releasedDetail = await clientDraft(ADMIN, ordinary);
    assert.deepEqual([releasedDetail.data.reviewState, releasedDetail.data.release], ["reviewed_by_your_organization", { state: "released_for_internal_use", releasedReportId: manifestId }]);
    assert.deepEqual(releasedDetail.data.organizationRelease, { actorMayRelease: false, getKinderReleaseReasons: [], blockedReasons: [], releasedBy: "your_organization" });

    // The same administrator opens the released Markdown through the client route.
    const received = await ids.getClientMarkdown(ORG, ENGAGEMENT, manifestId, "client_admin");
    assert.equal(received.statusCode, 200, received.body);
    assert.match(received.headers["content-disposition"], /attachment; filename="kai-export-manifest\.md"/);
    const markdown = received.body;
    console.log(`[p2-01m] organization-released Markdown:\n${markdown}`);
    assert.equal(statedCount(markdown), independentRecordCount(CSV));
    assert.match(markdown, /records 5 programme sessions for the reporting period 2026-09-01 to 2026-09-30/);
    assert.match(markdown, /period is attested in that definition and not verified against record dates/);
    assert.ok(markdown.includes(`- [CIT-001] Claim \`${ordinary.claimId}\`; evidence \`${ordinary.evidenceItemId}\`; source `), markdown);
    assert.ok(markdown.includes(`source version \`${ordinary.sourceVersionId}\`.`), markdown);
    const limitationLine = markdown.split("\n").find((line) => line.startsWith("- [CIT-001] limitation codes:"));
    for (const code of MEASURED_LIMITATION_CODES.filter((code) => code.startsWith("measurement."))) assert.ok(limitationLine.includes(`\`${code}\``), code);
    const [snapshotRow] = await query("SELECT limitation_snapshot_id::text FROM kai.export_candidates WHERE export_candidate_id = $1::uuid", [ordinary.exportCandidateId]);
    const entries = await query("SELECT limitation_codes FROM kai.limitation_snapshot_entries WHERE limitation_snapshot_id = $1::uuid", [snapshotRow.limitation_snapshot_id]);
    assert.equal(entries.length, 1, "one cited pair");
    for (const code of entries[0].limitation_codes) assert.ok(limitationLine.includes(`\`${code}\``), `snapshotted ${code} is in the report`);
    ids.organizationReviewedLimitationCodes = entries[0].limitation_codes;
    const prose = markdown.split("## Citation Appendix")[0];
    assert.doesNotMatch(prose, /\b(distinct|unique|individuals?|people|participants?|attendees|households?|rate|per cent|percent|outcomes?|because|caused?|improv\w*|impact\w*|increase\w*|led to|result\w* in)\b|%/i);
    assert.doesNotMatch(markdown, /literacy|mentoring|2026-09-16|sessions\.csv/, "no row values or file names");

    // Get Kinder keeps authority over it: a GK revocation withdraws it, the
    // organization cannot re-grant what Get Kinder withdrew, and only a GK
    // re-grant restores it.
    assert.equal((await decideAuthority(GK_ADMIN, "revoke", "internal", tick(), ordinary)).ok, true);
    assert.equal((await ids.getClientMarkdown(ORG, ENGAGEMENT, manifestId, "client_admin")).statusCode, 409);
    const withdrawnDetail = await clientDraft(ADMIN, ordinary);
    assert.deepEqual([withdrawnDetail.data.release.state, withdrawnDetail.data.organizationRelease.releasedBy], ["release_no_longer_valid", "your_organization"]);
    const reRelease = await releaseInternal(ADMIN, ordinary);
    assert.deepEqual([reRelease.error?.code, reRelease.blockers?.map((b) => b.blocking_reason)], ["blocked", ["release_withdrawn_by_get_kinder"]], JSON.stringify(reRelease));
    assert.equal((await decideAuthority(GK_ADMIN, "grant", "internal", tick(), ordinary)).ok, true);
    assert.equal((await ids.getClientMarkdown(ORG, ENGAGEMENT, manifestId, "client_admin")).statusCode, 200);

    // Get Kinder's release, unchanged, for the draft the organization may not
    // release: GK reviews and releases it through its own routes.
    assert.equal((await reviewStep(startGeneratedContentReview, "generated_content_review", GK_REVIEWER, tick(), held)()).ok, true);
    assert.equal((await reviewStep(completeGeneratedContentReview, "generated_content_review", GK_REVIEWER, tick(), held)()).ok, true);
    const heldReviewed = await clientDraft(ADMIN, held);
    assert.deepEqual([heldReviewed.data.reviewState, heldReviewed.data.release.state], ["reviewed_by_get_kinder", "awaiting_get_kinder_release"]);
    assert.deepEqual(heldReviewed.data.organizationRelease, { actorMayRelease: false, getKinderReleaseReasons: ["sensitivity_review_not_complete"], blockedReasons: [], releasedBy: null });
    const heldRefused = await releaseInternal(ADMIN, held);
    assert.deepEqual([heldRefused.error?.code, heldRefused.blockers?.map((b) => b.blocking_reason)], ["blocked", ["sensitivity_review_not_complete"]]);
    const heldAccepted = await requestExportReview(GK_ADMIN, "internal", tick(), held);
    assert.equal(heldAccepted.data?.exportReviewRequestAccepted, true, JSON.stringify(heldAccepted));
    held.exportReviewQueueItemId = heldAccepted.data.reviewQueueItemId;
    assert.equal((await reviewStep(startGeneratedDraftExportReview, "export_review", GK_ADMIN, tick(), held)()).ok, true);
    assert.equal((await reviewStep(completeGeneratedDraftExportReview, "export_review", GK_ADMIN, tick(), held)()).ok, true);
    const heldSnapshot = await confirmSnapshot(GK_REVIEWER, tick(), held);
    assert.equal(heldSnapshot.data?.confirmedByRole, "gk_reviewer", JSON.stringify(heldSnapshot));
    const heldCandidate = await createCandidate(GK_ADMIN, tick(), held);
    held.exportCandidateId = heldCandidate.data.exportCandidateId;
    const heldGrant = await decideAuthority(GK_ADMIN, "grant", "internal", tick(), held);
    assert.deepEqual([heldGrant.ok, heldGrant.data?.decidedByRole], [true, "gk_admin"]);
    const heldManifest = await releaseManifest(GK_ADMIN, tick(), held);
    assert.equal(heldManifest.ok, true, JSON.stringify(heldManifest));
    const heldReleased = await clientDraft(ADMIN, held);
    assert.deepEqual([heldReleased.data.release.state, heldReleased.data.organizationRelease.releasedBy], ["released_for_internal_use", "get_kinder"]);
    assert.equal((await ids.getClientMarkdown(ORG, ENGAGEMENT, heldManifest.data.exportManifestId, "client_admin")).statusCode, 200);

    // The database itself admits client_admin only as an internal
    // evidence_summary limitation snapshot or export_authority_granted grant.
    // Each probe runs in a transaction that is always rolled back. BEFORE
    // INSERT triggers run before CHECKs, so each refusal names the first
    // layer that refuses it: funder_ready / public_ready on this internal
    // candidate hit the P3-17 audience trigger (P0001), and on a funder
    // candidate the new scope trigger; types and actions that pass both
    // triggers reach the widened role CHECK.
    const probe = async (statements) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const [sql, params] of statements.slice(0, -1)) await client.query(sql, params);
        const [sql, params] = statements.at(-1);
        await client.query(sql, params);
        return "accepted";
      } catch (error) {
        return `${error.code}:${error.constraint || "trigger"}`;
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    };
    const decisionInsert = (role, type, action, candidateId = ordinary.exportCandidateId, supersedes = null) => [
      `INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7::uuid)`, [ORG, candidateId, type, action, ADMIN.actorUserId, role, supersedes]];
    const [head] = await query(
      `SELECT d.decision_id::text FROM kai.human_authority_decisions d WHERE d.export_candidate_id = $1::uuid AND d.decision_type = 'export_authority_granted'
          AND NOT EXISTS (SELECT 1 FROM kai.human_authority_decisions s WHERE s.supersedes_decision_id = d.decision_id)`, [ordinary.exportCandidateId]);
    const ROLE_CHECK = "23514:human_authority_decisions_p3_17_role_by_type_check";
    const FUNDER_CANDIDATE = "0e000000-0000-4000-8000-0000000fc001";
    const funderCandidate = [
      `INSERT INTO kai.export_candidates (export_candidate_id, organization_id, generated_content_draft_id, content_type, requested_audience, limitation_snapshot_id,
         fingerprint_contract_version, canonical_fingerprint, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'evidence_summary', 'funder', $4::uuid, 'kai-sprint2-p3-16-export-candidate-fingerprint-v1', repeat('a', 64), $5::uuid)`,
      [FUNDER_CANDIDATE, ORG, ordinary.measuredDraftId, snapshotRow.limitation_snapshot_id, GK_ADMIN.actorUserId]];
    const probes = {
      "client_admin funder_ready": await probe([decisionInsert("client_admin", "funder_ready", "grant")]),
      "client_admin public_ready": await probe([decisionInsert("client_admin", "public_ready", "grant")]),
      "client_admin funder_ready on a funder candidate": await probe([funderCandidate, decisionInsert("client_admin", "funder_ready", "grant", FUNDER_CANDIDATE)]),
      "client_admin client_reviewed": await probe([decisionInsert("client_admin", "client_reviewed", "grant")]),
      "client_admin revoke": await probe([decisionInsert("client_admin", "export_authority_granted", "revoke", ordinary.exportCandidateId, head.decision_id)]),
      "gk_reviewer export_authority_granted": await probe([decisionInsert("gk_reviewer", "export_authority_granted", "revoke", ordinary.exportCandidateId, head.decision_id)]),
      "client_admin grant on a funder candidate": await probe([funderCandidate, decisionInsert("client_admin", "export_authority_granted", "grant", FUNDER_CANDIDATE)]),
      "client_admin snapshot on a funder draft": await probe([
        ["UPDATE kai.generated_content_drafts SET requested_audience = 'funder' WHERE generated_content_draft_id = $1::uuid", [ordinary.measuredDraftId]],
        [`INSERT INTO kai.limitation_snapshots (organization_id, generated_content_draft_id, confirmed_by, confirmed_by_role, entries_fingerprint, supersedes_snapshot_id)
          VALUES ($1::uuid, $2::uuid, $3::uuid, 'client_admin', repeat('b', 64), $4::uuid)`, [ORG, ordinary.measuredDraftId, ADMIN.actorUserId, snapshotRow.limitation_snapshot_id]],
      ]),
      "client_reviewer snapshot": await probe([[`INSERT INTO kai.limitation_snapshots (organization_id, generated_content_draft_id, confirmed_by, confirmed_by_role, entries_fingerprint, supersedes_snapshot_id)
          VALUES ($1::uuid, $2::uuid, $3::uuid, 'client_reviewer', repeat('b', 64), $4::uuid)`, [ORG, ordinary.measuredDraftId, REVIEWER.actorUserId, snapshotRow.limitation_snapshot_id]]]),
      // Existing combinations are unchanged.
      "client_reviewer client_reviewed": await probe([decisionInsert("client_reviewer", "client_reviewed", "grant")]),
      "gk_admin funder_ready on a funder candidate": await probe([funderCandidate, decisionInsert("gk_admin", "funder_ready", "grant", FUNDER_CANDIDATE)]),
      "gk_admin export_authority_granted revoke": await probe([decisionInsert("gk_admin", "export_authority_granted", "revoke", ordinary.exportCandidateId, head.decision_id)]),
    };
    console.log(`[p2-01m] organization release constraint probes: ${JSON.stringify(probes)}`);
    assert.deepEqual(probes, {
      "client_admin funder_ready": "P0001:trigger",
      "client_admin public_ready": "P0001:trigger",
      "client_admin funder_ready on a funder candidate": "23514:trigger",
      "client_admin client_reviewed": ROLE_CHECK,
      "client_admin revoke": ROLE_CHECK,
      "gk_reviewer export_authority_granted": ROLE_CHECK,
      "client_admin grant on a funder candidate": "23514:trigger",
      "client_admin snapshot on a funder draft": "23514:trigger",
      "client_reviewer snapshot": "23514:limitation_snapshots_p3_16_confirmed_by_role_check",
      "client_reviewer client_reviewed": "accepted",
      "gk_admin funder_ready on a funder candidate": "accepted",
      "gk_admin export_authority_granted revoke": "accepted",
    });
    const [ledger] = await query(`SELECT
        (SELECT count(*) FROM kai.human_authority_decisions WHERE decided_by_role NOT IN ('gk_admin', 'client_admin'))::int AS other_roles,
        (SELECT count(*) FROM kai.export_candidates WHERE export_candidate_id = $1::uuid)::int AS probe_candidates`, [FUNDER_CANDIDATE]);
    assert.deepEqual(ledger, { other_roles: 0, probe_candidates: 0 }, "every probe was rolled back");
  });

  test("generation: once the measured source version is superseded, the claim is stale and is refused before the provider", async () => {
    const before = await generationCounts();
    await query("UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid", [ids.main.sourceVersionId]);
    const provider = replying(measuredBlock(COMPLIANT_TEXT));
    const result = await generate([ids.measurementClaimId], provider);
    console.log(`[p2-01m] stale measured claim: ${result.error?.code} ${JSON.stringify(result.blockers)}`);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(provider.calls.length, 0);
    assert.deepEqual(await generationCounts(), before);
    if (NORMAL_CHAIN) {
      // The released document is no longer retrievable, and nothing new can be released.
      const retrieval = await ids.getMarkdown(ORG, "gk_admin");
      assert.equal(retrieval.statusCode, 409, retrieval.body);
      assert.doesNotMatch(retrieval.body, /programme sessions/);
      const release = await releaseManifest(GK_ADMIN);
      assert.equal(release.ok, false, JSON.stringify(release));
      const clientRetrieval = await ids.getClientMarkdown(ORG, ENGAGEMENT, ids.exportManifestId, "client_admin");
      assert.equal(clientRetrieval.statusCode, 409, clientRetrieval.body);
      assert.doesNotMatch(clientRetrieval.body, /programme sessions/);
    }
  });
}
