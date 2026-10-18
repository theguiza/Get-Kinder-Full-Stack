import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_01_EVIDENCE_EXTRACTION_HANDOFF_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`J3-3 decision-bound claim proposal integration suite refused a non-loopback database host: ${host}`);
  }
}

test("J3-3 decision-bound claim proposal isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

test("J3-3: no route reaches the decision-bound entries; only the P2-12 handoff calls them", () => {
  const routes = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  assert.doesNotMatch(routes, /FromEvidenceReviewDecision/);
  const handoff = readFileSync("Backend/kai/services/kaiEvidenceReviewClaimProposalHandoffService.js", "utf8");
  assert.match(handoff, /import \{ assessEvidenceCoverageFromEvidenceReviewDecision \} from "\.\/kaiEvidenceCoverageAssessmentService\.js";/);
  assert.match(handoff, /import \{ proposeClaimFromEvidenceReviewDecision \} from "\.\/kaiClaimProposalService\.js";/);
  // The direct entries keep their own P2-02/P2-03 role sets without global roles.
  for (const file of ["Backend/kai/services/kaiEvidenceCoverageAssessmentService.js", "Backend/kai/services/kaiClaimProposalService.js"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /\{ allowedRoles: (EVIDENCE_COVERAGE_ASSESSMENT|CLAIM_PROPOSAL)_ALLOWED_ROLES \}/);
    assert.equal((source.match(/combineGlobalRoles: true/g) || []).length, 1, `${file}: only the decision-bound entry combines global roles`);
  }
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("J3-3 decision-bound claim proposal integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runDecisionBoundClaimProposalSuite();
}

/**
 * KAI J3-3 / Decision C Option A, against real PostgreSQL. A mixed-role human
 * (global gk_reviewer, Org A client_admin membership, no organization GK role)
 * records a P2-12 evidence review through the exact composition the P2-12
 * route calls; the downstream P2-02 assessment and P2-03 proposal run as the
 * governed continuation bound to that persisted decision. The mixed actor's
 * own direct P2-02/P2-03 access, library reads, and every forged or stale
 * authority path stay refused with nothing written.
 */
async function runDecisionBoundClaimProposalSuite() {
  const { Pool } = await import("pg");
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { submitSensitivityProfileDecision, submitSourceCandidateDecision } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const { getClientEvidencePipeline } = await import("../Backend/kai/services/kaiClientEvidencePipelineService.js");
  const { listOrganizationEvidenceLibrary } = await import("../Backend/kai/services/kaiEvidenceLibraryService.js");
  const { listClaimLibraryCandidates } = await import("../Backend/kai/services/kaiClaimLibraryService.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { listClientImpactFacts } = await import("../Backend/kai/services/kaiClientImpactFactsService.js");
  const {
    assessEvidenceCoverageForSourceVersion,
    assessEvidenceCoverageFromEvidenceReviewDecision,
  } = await import("../Backend/kai/services/kaiEvidenceCoverageAssessmentService.js");
  const { proposeClaim, proposeClaimFromEvidenceReviewDecision } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const { recordClaimReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const {
    recordEvidenceReviewDecisionWithClaimProposalHandoff,
    proposeClaimAfterEvidenceReviewDecision,
  } = await import("../Backend/kai/services/kaiEvidenceReviewClaimProposalHandoffService.js");
  const {
    createProductionMetadataOnlyAuditForEvidenceReview,
    createProductionMetadataOnlyAuditForClaimProposal,
    createProductionMetadataOnlyAuditForClaimReview,
  } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const ORG_2 = "00000000-0000-4000-8000-0000000000d2";
  const PROJECT_A = "7d000000-0000-4000-8000-0000000000a1";
  const PROJECT_B = "7d000000-0000-4000-8000-0000000000b1";
  const PROJECT_C = "7d000000-0000-4000-8000-0000000000c1";
  const PROJECT_D = "7d000000-0000-4000-8000-0000000000e1";
  const PROJECT_ORG_2 = "7d000000-0000-4000-8000-0000000000d1";
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const NOW = "2026-09-26T12:00:00.000Z";
  const FIELD_KEYS = ["households_served", "programme_month"];

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 4 });
  const query = async (sql, params = []) => (await pool.query(sql, params)).rows;

  test.after(async () => {
    await pool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  });

  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES
                 ($1::uuid, 'Harbourline Synthetic Society', 'harbourline-synthetic'),
                 ($2::uuid, 'Second Synthetic Collective', 'second-synthetic')
               ON CONFLICT (organization_id) DO NOTHING`, [ORG, ORG_2]);
  const projects = [
    [PROJECT_A, ORG, "Project A", 1],
    [PROJECT_B, ORG, "Project B", 2],
    [PROJECT_C, ORG, "Project C", 3],
    [PROJECT_D, ORG, "Project D", 4],
    [PROJECT_ORG_2, ORG_2, "Org 2 Project", 5],
  ];
  for (const [engagementId, organizationId, code, index] of projects) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)",
      [engagementId, organizationId, code]);
    await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'received', 'not_reviewed')`,
      [`11000000-0000-4000-8000-00000000000${index}`, organizationId, engagementId, `batch-${index}`]);
  }
  const batchFor = (index) => `11000000-0000-4000-8000-00000000000${index}`;

  const userIds = {};
  for (const [legacyId, key, organizationId, role] of [
    [971, "reviewer", ORG, "gk_reviewer"],
    [972, "client", ORG, "client_admin"],
    [973, "operator", ORG, "gk_operator"],
    [974, "reviewer2", ORG_2, "gk_reviewer"],
    [975, "admin", ORG, "gk_admin"],
    // J3-3: global gk_reviewer, Org A client_admin membership, no organization GK role.
    [976, "mixed", ORG, "client_admin"],
    [977, "mixed2", ORG, "client_admin"],
  ]) {
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
    const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@claim-proposal.test` });
    userIds[key] = kaiUser.user_id;
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
      [organizationId, kaiUser.user_id, role]);
  }
  const actor = (key, organizationId, role, overrides = {}) => ({
    actorType: "human",
    actorUserId: userIds[key],
    source: "public.userdata",
    kaiRoles: role.startsWith("gk_") ? [role] : [],
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: role }],
    ...overrides,
  });
  const reviewer = actor("reviewer", ORG, "gk_reviewer");
  const reviewer2 = actor("reviewer2", ORG_2, "gk_reviewer");
  const mixed = actor("mixed", ORG, "client_admin", { kaiRoles: ["gk_reviewer"] });
  const mixed2 = actor("mixed2", ORG, "client_admin", { kaiRoles: ["gk_reviewer"] });
  const operator = actor("operator", ORG, "gk_operator");
  const client = actor("client", ORG, "client_admin");
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

  /** P1-03..P1-05 fixture rows (the P1 worker's output); everything after is a real service. */
  async function seedFreshProfile({ index, organizationId, engagementId, batchId, allowedUseStatus = "unknown" }) {
    const intakeFileId = `22000000-0000-4000-8000-00000000000${index}`;
    const checksum = String(index).repeat(63) + "e";
    await query(
      `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
         mime_type, file_size_bytes, malware_scan_status, review_status, file_policy_status, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, $6, 'sha256', 'confirmed', 'synthetic-v1', $6, 512, $7::timestamptz,
         'text/csv', 512, 'clean', 'not_reviewed', 'passed', $7::timestamptz)`,
      [intakeFileId, batchId, organizationId, engagementId, `claim-proposal-outcomes-${index}.csv`, checksum, NOW],
    );
    const [run] = await query(
      `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', $4::timestamptz) RETURNING parser_run_id::text`,
      [organizationId, intakeFileId, checksum, NOW],
    );
    const profile = {
      status: "profiled", format: "csv",
      counts: { row_count: 1, column_count: FIELD_KEYS.length, field_count: FIELD_KEYS.length },
      fields: FIELD_KEYS.map((key) => ({ field_key: key })),
    };
    const [fileProfile] = await query(
      `INSERT INTO kai.intake_file_profiles (organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'kai_local_profiling_kernel', '1.0.0', $4, $5::jsonb, encode(digest($5::jsonb::text, 'sha256'), 'hex'), $6::timestamptz)
       RETURNING file_profile_id::text, profile_canonical_sha256`,
      [organizationId, intakeFileId, run.parser_run_id, checksum, JSON.stringify(profile), NOW],
    );
    await query(
      `UPDATE kai.intake_parser_runs SET parser_status = 'completed', completed_at = $2::timestamptz, output_profile_id = $3::uuid
        WHERE parser_run_id = $1::uuid`,
      [run.parser_run_id, NOW, fileProfile.file_profile_id],
    );
    const [dictionary] = await query(
      `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz) RETURNING data_dictionary_id::text`,
      [organizationId, intakeFileId, fileProfile.file_profile_id, fileProfile.profile_canonical_sha256, NOW],
    );
    for (const key of FIELD_KEYS) {
      await query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, 'number', $5::timestamptz)`,
        [dictionary.data_dictionary_id, organizationId, fileProfile.file_profile_id, key, NOW],
      );
    }
    const [sensitivity] = await query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, allowed_use_status, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::timestamptz) RETURNING intake_sensitivity_profile_id::text`,
      [organizationId, intakeFileId, fileProfile.file_profile_id, dictionary.data_dictionary_id, fileProfile.profile_canonical_sha256, allowedUseStatus, NOW],
    );
    return {
      intakeFileId,
      parserRunId: run.parser_run_id,
      fileProfileId: fileProfile.file_profile_id,
      dataDictionaryId: dictionary.data_dictionary_id,
      intakeSensitivityProfileId: sensitivity.intake_sensitivity_profile_id,
    };
  }

  /** Real P1-06 -> P1-07 -> P1-08 -> P2-01 handoff chain; returns the file and its evidence ids. */
  async function reachPromotedEvidence({ index, organizationId, engagementId, actorContext, allowedUseStatus }) {
    const lineage = await seedFreshProfile({ index, organizationId, engagementId, batchId: batchFor(index), allowedUseStatus });
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId, intakeSensitivityProfileId: lineage.intakeSensitivityProfileId, actorContext, now: new Date().toISOString() },
      { env: ENV, metadataOnlyAudit: noAudit() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const [item] = await query("SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid",
      [ensured.data.reviewQueueItem.review_queue_item_id]);
    const decided = await submitSensitivityProfileDecision({
      organizationId,
      intakeSensitivityProfileId: lineage.intakeSensitivityProfileId,
      actorContext,
      payload: {
        expected_updated_at: new Date(item.updated_at).toISOString(),
        review_queue_item_id: ensured.data.reviewQueueItem.review_queue_item_id,
        decision: "reviewed",
        reviewed_snapshot: {
          reviewed_personal_data_status: "present",
          reviewed_minor_data_status: "absent",
          reviewed_health_housing_justice_immigration_status: "absent",
          reviewed_indigenous_governance_status: "unknown",
          reviewed_staff_notes_status: "absent",
          reviewed_story_testimonial_status: "absent",
          reviewed_small_cell_risk_status: "unknown",
          reviewed_financial_records_status: "absent",
          reviewed_consent_basis_status: "unknown",
          reviewed_allowed_use_status: "unknown",
          reviewed_llm_processing_allowed: false,
          reviewed_product_learning_allowed: false,
          reviewed_public_use_allowed: false,
          reviewed_funder_use_allowed: false,
        },
      },
    }, { env: ENV });
    assert.equal(decided.ok, true, JSON.stringify(decided));
    const intakeSourceCandidateId = decided.data.source_candidate_handoff.intake_source_candidate_id;
    const promoted = await submitSourceCandidateDecision({
      organizationId,
      intakeSourceCandidateId,
      actorContext,
      payload: { outcome: "promoted", reviewed_source_type: "organization_primary_record" },
    }, { env: ENV });
    assert.equal(promoted.ok, true, JSON.stringify(promoted));
    assert.equal(promoted.data.evidence_extraction_handoff.status, "created");
    const evidence = await query(
      `SELECT evidence_item_id::text FROM kai.evidence_items
        WHERE organization_id = $1::uuid AND source_version_id = $2::uuid ORDER BY evidence_item_id`,
      [organizationId, promoted.data.source_version.source_version_id],
    );
    assert.equal(evidence.length, FIELD_KEYS.length);
    return {
      ...lineage,
      intakeSourceCandidateId,
      sourceVersionId: promoted.data.source_version.source_version_id,
      evidenceItemIds: evidence.map((row) => row.evidence_item_id),
    };
  }

  async function kaiTableRowCounts(organizationId = null) {
    const tables = await query(
      `SELECT c.table_name, EXISTS (
                SELECT 1 FROM information_schema.columns k
                 WHERE k.table_schema = 'kai' AND k.table_name = c.table_name AND k.column_name = 'organization_id') AS scoped
         FROM information_schema.tables c
        WHERE c.table_schema = 'kai' AND c.table_type = 'BASE TABLE' ORDER BY c.table_name`,
    );
    const counts = {};
    for (const { table_name: tableName, scoped } of tables) {
      if (organizationId && !scoped) continue;
      // eslint-disable-next-line no-await-in-loop
      counts[tableName] = (await query(
        organizationId
          ? `SELECT count(*)::int AS count FROM kai.${tableName} WHERE organization_id = $1::uuid`
          : `SELECT count(*)::int AS count FROM kai.${tableName}`,
        organizationId ? [organizationId] : [],
      ))[0].count;
    }
    return counts;
  }
  function deltas(before, after) {
    return Object.fromEntries(Object.keys(after).filter((table) => after[table] !== before[table]).sort()
      .map((table) => [table, after[table] - before[table]]));
  }

  async function claimsFor(evidenceItemIds) {
    return query(
      `SELECT claim_id::text, organization_id::text, evidence_item_id::text, claim_type, claim_status, claim_review_status,
              claim_strength, statement, internal_only, public_use_allowed, funder_use_allowed, llm_processing_allowed,
              product_learning_allowed, export_ready, created_by::text, created_by_type
         FROM kai.claims WHERE evidence_item_id = ANY($1::uuid[]) ORDER BY claim_id`,
      [evidenceItemIds],
    );
  }

  async function evidenceQueue(organizationId, evidenceItemId) {
    const [row] = await query(
      `SELECT review_queue_item_id::text, updated_at FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_type = 'evidence_item'
          AND target_object_id = $2::uuid`,
      [organizationId, evidenceItemId],
    );
    return { reviewQueueItemId: row.review_queue_item_id, expectedUpdatedAt: new Date(row.updated_at).toISOString() };
  }

  /** Exactly what the P2-12 evidence-review route calls: the composing service plus the production audit adapter. */
  async function reviewThroughRoute({ organizationId = ORG, evidenceItemId, decision, limitationNotes, actorContext = reviewer, token = null }) {
    const coordinates = token || await evidenceQueue(organizationId, evidenceItemId).catch(() => ({
      reviewQueueItemId: "d9000000-0000-4000-8000-000000000009", expectedUpdatedAt: NOW,
    }));
    const now = new Date().toISOString();
    const result = await recordEvidenceReviewDecisionWithClaimProposalHandoff({
      organizationId,
      evidenceItemId,
      reviewQueueItemId: coordinates.reviewQueueItemId,
      expectedUpdatedAt: coordinates.expectedUpdatedAt,
      decision,
      ...(limitationNotes === undefined ? {} : { limitationNotes }),
      actorContext,
      now,
    }, {
      env: ENV,
      metadataOnlyAudit: createProductionMetadataOnlyAuditForEvidenceReview({ organizationId, evidenceItemId, actorContext, now }),
    });
    return { result, coordinates };
  }

  async function projectFile(organizationId, engagementId, intakeFileId, actorContext = client) {
    const pipeline = await getClientEvidencePipeline({ organizationId, engagementId, actorContext }, { env: ENV });
    assert.equal(pipeline.ok, true, JSON.stringify(pipeline));
    const file = pipeline.data.files.find((entry) => entry.intakeFileId === intakeFileId);
    assert.ok(file, "the file is in its own Project pipeline");
    return { pipeline, file };
  }

  const EVIDENCE_DECISION_DELTAS = { audit_events: 1, evidence_review_decisions: 1, upload_lifecycle_audit: 1 };
  // P2-12 decision (ledger + audit) plus the P2-03 proposal (claim, link,
  // claim_review queue item, and its own audit). Nothing else.
  const POSITIVE_REVIEW_DELTAS = {
    audit_events: 2,
    claim_evidence_links: 1,
    claims: 1,
    evidence_review_decisions: 1,
    review_queue_items: 1,
    upload_lifecycle_audit: 2,
  };

  const projectA = await reachPromotedEvidence({ index: 1, organizationId: ORG, engagementId: PROJECT_A, actorContext: reviewer });
  const projectB = await reachPromotedEvidence({ index: 2, organizationId: ORG, engagementId: PROJECT_B, actorContext: reviewer });
  const projectC = await reachPromotedEvidence({ index: 3, organizationId: ORG, engagementId: PROJECT_C, actorContext: reviewer });
  const projectD = await reachPromotedEvidence({
    index: 4, organizationId: ORG, engagementId: PROJECT_D, actorContext: reviewer, allowedUseStatus: "not_allowed",
  });
  const org2 = await reachPromotedEvidence({ index: 5, organizationId: ORG_2, engagementId: PROJECT_ORG_2, actorContext: reviewer2 });
  const [a1, a2] = projectA.evidenceItemIds;
  const [b1, b2] = projectB.evidenceItemIds;
  const [c1, c2] = projectC.evidenceItemIds;
  const [d1, d2] = projectD.evidenceItemIds;
  const [o1] = org2.evidenceItemIds;

  // The incomplete-handoff seam: the committed P2-12 decision stands, and the
  // continuation's P2-03 step fails as an infrastructure failure would.
  const failingProposal = { async proposeClaimFromEvidenceReviewDecision() { return { ok: false, error: { code: "system_error", status: 500 } }; } };

  async function review({ evidenceItemId, decision, actorContext = mixed, token = null, extraDeps = {} }) {
    const coordinates = token || await evidenceQueue(ORG, evidenceItemId);
    const now = new Date().toISOString();
    const result = await recordEvidenceReviewDecisionWithClaimProposalHandoff({
      organizationId: ORG,
      evidenceItemId,
      reviewQueueItemId: coordinates.reviewQueueItemId,
      expectedUpdatedAt: coordinates.expectedUpdatedAt,
      decision,
      actorContext,
      now,
    }, {
      env: ENV,
      metadataOnlyAudit: createProductionMetadataOnlyAuditForEvidenceReview({ organizationId: ORG, evidenceItemId, actorContext, now }),
      ...extraDeps,
    });
    return { result, coordinates };
  }

  async function continueDirectly(evidenceItemId, actorContext = mixed, organizationId = ORG) {
    const now = new Date().toISOString();
    const assessed = await assessEvidenceCoverageFromEvidenceReviewDecision({ organizationId, evidenceItemId, actorContext }, { env: ENV });
    const proposed = await proposeClaimFromEvidenceReviewDecision({ organizationId, evidenceItemId, actorContext, now }, {
      env: ENV,
      metadataOnlyAudit: createProductionMetadataOnlyAuditForClaimProposal({ organizationId, evidenceItemId, actorContext, now }),
    });
    return { assessed, proposed };
  }

  async function headDecision(evidenceItemId) {
    const [row] = await query(
      `SELECT d.decision_id::text, d.decided_by::text, d.decided_by_role, d.decision_outcome
         FROM kai.evidence_review_decisions d
        WHERE d.organization_id = $1::uuid AND d.evidence_item_id = $2::uuid
          AND NOT EXISTS (SELECT 1 FROM kai.evidence_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)`,
      [ORG, evidenceItemId],
    );
    return row ?? null;
  }

  async function claimProposedAudit(claimId) {
    return query(
      `SELECT actor_user_id::text, actor_type, action, metadata FROM kai.audit_events
        WHERE action = 'claim_proposed' AND metadata->>'object_id' = $1`,
      [claimId],
    );
  }

  const blockingReason = (result) => result?.blockers?.[0]?.blocking_reason ?? null;
  // P2-03 continuation alone: claim, link, claim_review item, and its two audits.
  const CONTINUATION_DELTAS = { audit_events: 1, claim_evidence_links: 1, claims: 1, review_queue_items: 1, upload_lifecycle_audit: 1 };
  let a1Token;
  let a1Claim;

  test("J3-3 baseline: the mixed actor's direct P2-02 request stays role_not_allowed, direct P2-03 is admitted only by its organization client_admin membership, and the library reads succeed, writing nothing", async () => {
    const before = await kaiTableRowCounts();
    const assessed = await assessEvidenceCoverageForSourceVersion(
      { organizationId: ORG, sourceVersionId: projectA.sourceVersionId, actorContext: mixed }, { env: ENV });
    assert.equal(assessed.ok, false);
    assert.deepEqual([assessed.error.code, blockingReason(assessed)], ["authorization_denied", "role_not_allowed"]);
    const now = new Date().toISOString();
    // Owner decision 2026-10-18: an organization client_admin may propose
    // directly. Proven against a recording repository so this baseline writes
    // nothing and the decision-bound continuation below still creates the claim.
    const admitted = [];
    const proposed = await proposeClaim({ organizationId: ORG, evidenceItemId: a1, actorContext: mixed, now }, {
      env: ENV,
      metadataOnlyAudit: createProductionMetadataOnlyAuditForClaimProposal({ organizationId: ORG, evidenceItemId: a1, actorContext: mixed, now }),
      claimProposalRepository: { async proposeClaim(input) { admitted.push(input.organizationId); return { ok: false, error: { code: "not_found", status: 404 } }; } },
    });
    assert.deepEqual([proposed.error.code, admitted], ["not_found", [ORG]]);
    const globalOnly = { ...mixed, organizationMemberships: mixed.organizationMemberships.map((membership) => ({ ...membership, role_name: "client_contributor" })) };
    const refused = await proposeClaim({ organizationId: ORG, evidenceItemId: a1, actorContext: globalOnly, now }, {
      env: ENV, metadataOnlyAudit: createProductionMetadataOnlyAuditForClaimProposal({ organizationId: ORG, evidenceItemId: a1, actorContext: globalOnly, now }),
    });
    assert.deepEqual([refused.ok, refused.error.code, blockingReason(refused)], [false, "authorization_denied", "role_not_allowed"], "the global gk_reviewer role alone never admits P2-03");
    const claimLibrary = await listClaimLibraryCandidates({ organizationId: ORG, limit: 25, actorContext: mixed }, { env: ENV });
    const evidenceLibrary = await listOrganizationEvidenceLibrary({ organizationId: ORG, limit: 25, afterEvidenceItemId: null, actorContext: mixed }, { env: ENV });
    assert.deepEqual([claimLibrary.ok, evidenceLibrary.ok], [true, true], "the October 14 workspace policy grants reads independently of Decision C");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
  });

  test("J3-3 no decision, no authority: the decision-bound entries refuse an evidence item without this actor's decision, another organization's item, and forged input markers, writing nothing", async () => {
    const before = await kaiTableRowCounts();
    const undecided = await continueDirectly(b1);
    for (const result of [undecided.assessed, undecided.proposed]) {
      assert.deepEqual([result.ok, result.error.code, blockingReason(result)], [false, "authorization_denied", "evidence_review_decision_required"]);
    }
    // Org 2 evidence under Org A: no Org A decision exists for it.
    const crossItem = await continueDirectly(o1);
    for (const result of [crossItem.assessed, crossItem.proposed]) {
      assert.deepEqual([result.ok, result.error.code, blockingReason(result)], [false, "authorization_denied", "evidence_review_decision_required"]);
    }
    // Org 2 scope: the mixed actor has no Org 2 membership.
    const crossOrg = await continueDirectly(o1, mixed, ORG_2);
    for (const result of [crossOrg.assessed, crossOrg.proposed]) {
      assert.deepEqual([result.ok, result.error.code, blockingReason(result)], [false, "authorization_denied", "missing_active_organization_membership"]);
    }
    // Caller-supplied markers are not part of either input contract.
    const now = new Date().toISOString();
    for (const marker of [{ internalHandoff: true }, { decisionBound: true }, { skipAuthorization: true }, { evidenceReviewDecisionId: "f2000000-0000-4000-8000-000000000001" }]) {
      const assessed = await assessEvidenceCoverageFromEvidenceReviewDecision({ organizationId: ORG, evidenceItemId: b1, actorContext: mixed, ...marker }, { env: ENV });
      const proposed = await proposeClaimFromEvidenceReviewDecision({ organizationId: ORG, evidenceItemId: b1, actorContext: mixed, now, ...marker }, {
        env: ENV, metadataOnlyAudit: createProductionMetadataOnlyAuditForClaimProposal({ organizationId: ORG, evidenceItemId: b1, actorContext: mixed, now }),
      });
      const direct = await proposeClaim({ organizationId: ORG, evidenceItemId: b1, actorContext: mixed, now, ...marker }, {
        env: ENV, metadataOnlyAudit: createProductionMetadataOnlyAuditForClaimProposal({ organizationId: ORG, evidenceItemId: b1, actorContext: mixed, now }),
      });
      for (const result of [assessed, proposed, direct]) assert.equal(result.error.code, "validation_blocker", JSON.stringify(marker));
    }
    // A marker on the actor context is ignored: authority is still the persisted decision.
    const forgedActor = { ...mixed, internalHandoff: true, decisionBound: true, skipAuthorization: true };
    const forged = await continueDirectly(b1, forgedActor);
    assert.equal(blockingReason(forged.proposed), "evidence_review_decision_required");
    // A fabricated positive decision object handed to the server workflow is only a trigger.
    const fabricated = await proposeClaimAfterEvidenceReviewDecision({
      organizationId: ORG,
      evidenceItemId: b1,
      evidenceReviewDecision: {
        evidence_item_id: b1, decision_id: "f2000000-0000-4000-8000-000000000001", decision_outcome: "supported",
        support_strength: "reviewed_supported", queue_status: "resolved", review_status: "resolved",
      },
      actorContext: mixed,
      now,
    }, { env: ENV });
    assert.deepEqual([fabricated.status, fabricated.error_code], ["not_created", "conflict_current_state_changed"]);
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
    assert.deepEqual(await claimsFor([b1, o1]), []);
  });

  test("J3-3 positive: the mixed actor's supported review commits once and the decision-bound continuation creates exactly one review-gated claim, link, and open claim_review item", async () => {
    const before = await kaiTableRowCounts();
    const { result, coordinates } = await review({ evidenceItemId: a1, decision: "supported" });
    a1Token = coordinates;
    assert.equal(result.ok, true, JSON.stringify(result));
    const handoff = result.data.claim_proposal_handoff;
    console.log(`[j3-3] mixed positive handoff ${JSON.stringify(handoff)}`);
    assert.equal(handoff.status, "created");
    assert.equal(handoff.coverage_assessment.status, "assessed");
    assert.equal(handoff.claim_review_status, "needs_gk_review");
    assert.equal(handoff.blocking_reason, null);
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), POSITIVE_REVIEW_DELTAS);

    const decision = await headDecision(a1);
    assert.deepEqual({ ...decision, decision_id: undefined },
      { decision_id: undefined, decided_by: userIds.mixed, decided_by_role: "gk_reviewer", decision_outcome: "supported" });
    assert.equal(result.data.decision_id, decision.decision_id);

    [a1Claim] = await claimsFor([a1]);
    assert.equal(a1Claim.claim_id, handoff.claim_id);
    assert.deepEqual(
      [a1Claim.claim_status, a1Claim.claim_review_status, a1Claim.claim_strength, a1Claim.internal_only, a1Claim.public_use_allowed,
        a1Claim.funder_use_allowed, a1Claim.export_ready, a1Claim.created_by],
      ["proposed", "needs_gk_review", "unassessed", true, false, false, false, userIds.mixed],
    );
    const links = await query("SELECT evidence_item_id::text FROM kai.claim_evidence_links WHERE claim_id = $1::uuid", [a1Claim.claim_id]);
    assert.deepEqual(links, [{ evidence_item_id: a1 }]);
    const queue = await query(
      "SELECT review_queue_item_id::text, queue_status, review_status FROM kai.review_queue_items WHERE queue_type = 'claim_review' AND target_object_id = $1::uuid",
      [a1Claim.claim_id]);
    assert.deepEqual(queue.map((row) => [row.review_queue_item_id, row.queue_status, row.review_status]),
      [[handoff.claim_review_queue_item_id, "open", "needs_gk_review"]]);

    // Provenance: the human is the actor, and the authority is the
    // evidence-review decision - never a P2-03 organization role.
    const audits = await claimProposedAudit(a1Claim.claim_id);
    assert.equal(audits.length, 1);
    const [audit] = audits;
    console.log(`[j3-3] claim_proposed audit ${JSON.stringify(audit)}`);
    assert.deepEqual([audit.actor_user_id, audit.actor_type], [userIds.mixed, "human"]);
    assert.equal(audit.metadata.authority_source, "evidence_review_decision");
    assert.equal(audit.metadata.decision_type, "evidence_review");
    assert.equal(audit.metadata.decision_id, decision.decision_id);
    assert.equal(audit.metadata.decided_by_role, "gk_reviewer");
    assert.equal(Object.hasOwn(audit.metadata, "role_name"), false);
    const [{ count: claimDecisions }] = await query("SELECT count(*)::int AS count FROM kai.claim_review_decisions WHERE claim_id = $1::uuid", [a1Claim.claim_id]);
    assert.equal(claimDecisions, 0, "no automatic claim review");
  });

  test("J3-3 replay: the identical decision replays P2-12 and the continuation with zero writes", async () => {
    const before = await kaiTableRowCounts();
    const { result } = await review({ evidenceItemId: a1, decision: "supported", token: a1Token });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.replayed, true);
    assert.deepEqual([result.data.claim_proposal_handoff.status, result.data.claim_proposal_handoff.claim_id], ["replayed", a1Claim.claim_id]);
    const direct = await continueDirectly(a1);
    assert.equal(direct.proposed.ok, true);
    assert.equal(direct.proposed.data.replayed, true);
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {}, "no duplicate claim, link, queue item, or audit");
    assert.equal((await claimProposedAudit(a1Claim.claim_id)).length, 1);
  });

  test("J3-3 recovery: a committed decision whose continuation failed reports not_created, and the reviewer's identical resubmission completes it exactly once", async () => {
    let before = await kaiTableRowCounts();
    const { result, coordinates } = await review({ evidenceItemId: b1, decision: "supported", extraDeps: failingProposal });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual([result.data.claim_proposal_handoff.status, result.data.claim_proposal_handoff.error_code, result.data.claim_proposal_handoff.claim_id],
      ["not_created", "system_error", null], "the incomplete handoff is reported, never as a claim");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), EVIDENCE_DECISION_DELTAS, "the human decision alone is committed");
    assert.deepEqual(await claimsFor([b1]), []);
    const decision = await headDecision(b1);

    before = await kaiTableRowCounts();
    const { result: recovered } = await review({ evidenceItemId: b1, decision: "supported", token: coordinates });
    assert.equal(recovered.data.replayed, true, "the decision is replayed, not re-recorded");
    assert.equal(recovered.data.decision_id, decision.decision_id);
    assert.equal(recovered.data.claim_proposal_handoff.status, "created");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), CONTINUATION_DELTAS);
    const [claim] = await claimsFor([b1]);
    const [audit] = await claimProposedAudit(claim.claim_id);
    assert.equal(audit.metadata.decision_id, decision.decision_id);

    before = await kaiTableRowCounts();
    const { result: again } = await review({ evidenceItemId: b1, decision: "supported", token: coordinates });
    assert.equal(again.data.claim_proposal_handoff.status, "replayed");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
  });

  test("J3-3 concurrency: two simultaneous recoveries of the same incomplete decision converge on one claim, link, queue item, and audit", async () => {
    const { coordinates } = await review({ evidenceItemId: c1, decision: "supported", extraDeps: failingProposal });
    const before = await kaiTableRowCounts();
    const results = await Promise.all([
      review({ evidenceItemId: c1, decision: "supported", token: coordinates }),
      review({ evidenceItemId: c1, decision: "supported", token: coordinates }),
    ]);
    const statuses = results.map(({ result }) => result.data.claim_proposal_handoff.status).sort();
    console.log(`[j3-3] concurrent recovery ${JSON.stringify(statuses)}`);
    assert.deepEqual(statuses, ["created", "replayed"]);
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), CONTINUATION_DELTAS);
    assert.equal((await claimsFor([c1])).length, 1);
  });

  test("J3-3 stale lineage: after the source_version stops being current, the committed decision's continuation is blocked and writes nothing", async () => {
    const { coordinates } = await review({ evidenceItemId: c2, decision: "supported", extraDeps: failingProposal });
    await query("UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid", [projectC.sourceVersionId]);
    try {
      const before = await kaiTableRowCounts();
      const { result } = await review({ evidenceItemId: c2, decision: "supported", token: coordinates });
      const workflow = await proposeClaimAfterEvidenceReviewDecision({
        organizationId: ORG, evidenceItemId: c2, evidenceReviewDecision: { ...(await headDecision(c2)), evidence_item_id: c2,
          support_strength: "reviewed_supported", queue_status: "resolved", review_status: "resolved" },
        actorContext: mixed, now: new Date().toISOString(),
      }, { env: ENV });
      const direct = await continueDirectly(c2);
      console.log(`[j3-3] stale lineage ${JSON.stringify({ p2_12: result.ok ? result.data.claim_proposal_handoff : result.error.code, workflow, p2_02: direct.assessed.error?.code, p2_03: direct.proposed.error?.code })}`);
      if (result.ok) assert.equal(result.data.claim_proposal_handoff.status, "not_created");
      assert.equal(workflow.status, "not_created");
      assert.equal(direct.assessed.ok, false);
      assert.deepEqual([direct.proposed.ok, direct.proposed.error.code], [false, "conflict_current_state_changed"]);
      assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
      assert.deepEqual(await claimsFor([c2]), []);
    } finally {
      await query("UPDATE kai.source_versions SET is_current = true WHERE source_version_id = $1::uuid", [projectC.sourceVersionId]);
    }
  });

  test("J3-3 superseded: once another reviewer's decision supersedes the mixed actor's, the mixed actor's continuation is refused; the new decider's own continuation proceeds", async () => {
    const { coordinates: mixedToken } = await review({ evidenceItemId: b2, decision: "supported", extraDeps: failingProposal });
    const reReview = await review({ evidenceItemId: b2, decision: "supported", actorContext: reviewer, extraDeps: failingProposal });
    assert.equal(reReview.result.ok, true, JSON.stringify(reReview.result));
    assert.equal(reReview.result.data.replayed, false, "the re-review supersedes the mixed decision");
    assert.equal((await headDecision(b2)).decided_by, userIds.reviewer);

    const before = await kaiTableRowCounts();
    const { result: oldReplay } = await review({ evidenceItemId: b2, decision: "supported", token: mixedToken });
    assert.equal(oldReplay.ok, false, "the superseded decision no longer replays");
    const direct = await continueDirectly(b2);
    for (const result of [direct.assessed, direct.proposed]) {
      assert.deepEqual([result.ok, result.error.code, blockingReason(result)], [false, "authorization_denied", "evidence_review_decision_not_by_actor"]);
    }
    // Another mixed-role human cannot ride on the reviewer's decision either.
    const other = await continueDirectly(b2, mixed2);
    assert.equal(blockingReason(other.proposed), "evidence_review_decision_not_by_actor");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
    assert.deepEqual(await claimsFor([b2]), []);

    const own = await continueDirectly(b2, reviewer);
    assert.equal(own.proposed.ok, true, JSON.stringify(own.proposed));
    const [audit] = await claimProposedAudit(own.proposed.data.claim.claim_id);
    assert.equal(audit.actor_user_id, userIds.reviewer);
    assert.equal(audit.metadata.decision_id, (await headDecision(b2)).decision_id);
  });

  test("J3-3 revoked authority: without the global role or the active membership, the mixed actor's own committed decision no longer continues", async () => {
    const before = await kaiTableRowCounts();
    const withoutRole = await continueDirectly(a1, { ...mixed, kaiRoles: [] });
    for (const result of [withoutRole.assessed, withoutRole.proposed]) {
      assert.deepEqual([result.error.code, blockingReason(result)], ["authorization_denied", "role_not_allowed"]);
    }
    const inactive = await continueDirectly(a1, {
      ...mixed, organizationMemberships: [{ organization_id: ORG, membership_status: "inactive", role_name: "client_admin" }],
    });
    for (const result of [inactive.assessed, inactive.proposed]) {
      assert.deepEqual([result.error.code, blockingReason(result)], ["authorization_denied", "missing_active_organization_membership"]);
    }
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
  });

  test("J3-3 unsupported and ineligible evidence: not_supported proposes nothing; an allowed_use 'not_allowed' source is reviewed but blocked by P2-02", async () => {
    let before = await kaiTableRowCounts();
    const { result: negative } = await review({ evidenceItemId: a2, decision: "not_supported" });
    assert.equal(negative.ok, true, JSON.stringify(negative));
    assert.equal(negative.data.claim_proposal_handoff.status, "not_applicable");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), EVIDENCE_DECISION_DELTAS);
    before = await kaiTableRowCounts();
    const direct = await continueDirectly(a2);
    for (const result of [direct.assessed, direct.proposed]) {
      assert.deepEqual([result.error.code, blockingReason(result)], ["authorization_denied", "evidence_review_decision_not_positive"]);
    }
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});

    before = await kaiTableRowCounts();
    const { result: blocked } = await review({ evidenceItemId: d1, decision: "supported" });
    assert.equal(blocked.ok, true, JSON.stringify(blocked));
    assert.deepEqual(
      [blocked.data.claim_proposal_handoff.status, blocked.data.claim_proposal_handoff.error_code, blocked.data.claim_proposal_handoff.blocking_reason],
      ["not_created", "validation_blocker", "allowed_use_not_allowed"], "an independent eligibility blocker is reported as-is, with its reason");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), EVIDENCE_DECISION_DELTAS);
    assert.equal((await headDecision(d1)).decision_outcome, "supported", "the human decision is unchanged");
    assert.deepEqual(await claimsFor([a2, d1]), []);
  });

  test("J3-3 another human's decision: the mixed actor cannot continue a positive decision recorded by a different reviewer", async () => {
    await review({ evidenceItemId: d2, decision: "supported", actorContext: reviewer, extraDeps: failingProposal });
    const before = await kaiTableRowCounts();
    const handed = await proposeClaimAfterEvidenceReviewDecision({
      organizationId: ORG, evidenceItemId: d2,
      evidenceReviewDecision: { ...(await headDecision(d2)), evidence_item_id: d2, support_strength: "reviewed_supported", queue_status: "resolved", review_status: "resolved" },
      actorContext: mixed, now: new Date().toISOString(),
    }, { env: ENV });
    assert.deepEqual([handed.status, handed.error_code, handed.blocking_reason],
      ["not_created", "authorization_denied", "evidence_review_decision_not_by_actor"]);
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
  });

  test("J3-3 non-human actors cannot initiate the review or the continuation", async () => {
    const before = await kaiTableRowCounts();
    for (const actorType of ["system", "ai", "assistant", "import"]) {
      const actorContext = { ...mixed, actorType };
      const { result } = await review({ evidenceItemId: a1, decision: "supported", actorContext, token: a1Token });
      assert.equal(result.ok, false, actorType);
      assert.equal(result.data?.claim_proposal_handoff, undefined);
      const direct = await continueDirectly(a1, actorContext);
      assert.deepEqual([direct.assessed.error.code, direct.proposed.error.code], ["authorization_denied", "authorization_denied"]);
    }
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
  });

  test("J3-3 separate human claim review: an independently authorized GK reviewer finds the open claim_review item and records the review; the client sees no Impact Fact before it", async () => {
    const facts = await listClientImpactFacts({ organizationId: ORG, actorContext: client }, { env: ENV });
    if (facts.ok) assert.equal(facts.data.items.some((item) => item.claimId === a1Claim.claim_id), false, "an unreviewed proposal is not an Impact Fact");
    const { file } = await projectFile(ORG, PROJECT_A, projectA.intakeFileId);
    assert.equal(file.reviewedImpactFactCount, 0);

    const library = await listClaimLibraryCandidates({ organizationId: ORG, limit: 25, actorContext: reviewer }, { env: ENV });
    assert.equal(library.ok, true, JSON.stringify(library));
    const listed = library.data.items.find((item) => item.claimId === a1Claim.claim_id);
    assert.ok(listed, "the GK reviewer discovers the proposed claim");
    const claimQueue = listed.reviewQueueItems.find((item) => item.queue_type === "claim_review");
    assert.equal(claimQueue.queue_status, "open");
    const [queueRow] = await query("SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid", [claimQueue.review_queue_item_id]);
    const now = new Date().toISOString();
    const reviewed = await recordClaimReviewDecision({
      organizationId: ORG,
      claimId: a1Claim.claim_id,
      reviewQueueItemId: claimQueue.review_queue_item_id,
      expectedUpdatedAt: new Date(queueRow.updated_at).toISOString(),
      decision: "approved",
      approvedAudiences: ["internal"],
      actorContext: reviewer,
      now,
    }, {
      env: ENV,
      metadataOnlyAudit: createProductionMetadataOnlyAuditForClaimReview({ organizationId: ORG, claimId: a1Claim.claim_id, actorContext: reviewer, now }),
    });
    assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
    const decisions = await query("SELECT decided_by::text, decided_by_role FROM kai.claim_review_decisions WHERE claim_id = $1::uuid", [a1Claim.claim_id]);
    assert.deepEqual(decisions, [{ decided_by: userIds.reviewer, decided_by_role: "gk_reviewer" }]);
  });

  test("J3-3 isolation and zero approval elsewhere: Org 2 is untouched and no other claim is approved, widened, or export-ready", async () => {
    assert.deepEqual(await claimsFor(org2.evidenceItemIds), []);
    const [{ count: org2Decisions }] = await query("SELECT count(*)::int AS count FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid", [ORG_2]);
    assert.equal(org2Decisions, 0);
    const widened = await query(
      `SELECT claim_id::text FROM kai.claims
        WHERE claim_id <> $1::uuid AND (claim_review_status <> 'needs_gk_review' OR internal_only IS NOT TRUE OR public_use_allowed
           OR funder_use_allowed OR llm_processing_allowed OR product_learning_allowed OR export_ready)`, [a1Claim.claim_id]);
    assert.deepEqual(widened, []);
    const [{ count: claimDecisions }] = await query("SELECT count(*)::int AS count FROM kai.claim_review_decisions WHERE claim_id <> $1::uuid", [a1Claim.claim_id]);
    assert.equal(claimDecisions, 0);
  });
}
