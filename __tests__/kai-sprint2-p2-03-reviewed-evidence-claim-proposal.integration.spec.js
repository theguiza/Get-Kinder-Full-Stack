import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_01_EVIDENCE_EXTRACTION_HANDOFF_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`reviewed-evidence claim proposal integration suite refused a non-loopback database host: ${host}`);
  }
}

test("reviewed-evidence claim proposal integration isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

test("the assembled proof never writes a claim or a claim-review decision itself and never records a claim review", () => {
  const source = readFileSync(new URL(import.meta.url), "utf8");
  for (const table of ["claims", "claim_evidence_links", "claim_review_decisions", "review_queue_items"]) {
    assert.equal(source.includes(["INSERT INTO kai.", table, " "].join("")), false, `no ${table} row is written by this file`);
  }
  const importLines = source.split("\n").filter((line) => /\bimport\(|\bimport\b.*from/.test(line));
  for (const line of importLines) assert.doesNotMatch(line, /postgresClaimProposalRepository|postgresHumanReviewRepository/);
  assert.equal(source.includes(["recordClaim", "ReviewDecision("].join("")), false, "claim review is never recorded");
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("reviewed-evidence claim proposal integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runReviewedEvidenceClaimProposalSuite();
}

/**
 * KAI reviewed evidence -> P2-02 assessment -> P2-03 proposed claim, against
 * real PostgreSQL. Fresh synthetic lineages are advanced through the real
 * P1-06 review work, cockpit sensitivity decision (P1-07 handoff), and cockpit
 * P1-08 promotion (P2-01 handoff). Evidence review goes through the exact
 * composition the P2-12 route calls (recordEvidenceReviewDecisionWithClaimProposalHandoff
 * with the production evidence-review audit adapter), so every claim, link,
 * and claim_review queue item here is written by the unmodified P2-03 service.
 */
async function runReviewedEvidenceClaimProposalSuite() {
  const { Pool } = await import("pg");
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { submitSensitivityProfileDecision, submitSourceCandidateDecision } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const { getClientEvidencePipeline } = await import("../Backend/kai/services/kaiClientEvidencePipelineService.js");
  const { listOrganizationEvidenceLibrary } = await import("../Backend/kai/services/kaiEvidenceLibraryService.js");
  const { listClaimLibraryCandidates } = await import("../Backend/kai/services/kaiClaimLibraryService.js");
  const { getClaimTraceabilitySummary } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
  const { listClientImpactFacts } = await import("../Backend/kai/services/kaiClientImpactFactsService.js");
  const { assessEvidenceCoverageForSourceVersion } = await import("../Backend/kai/services/kaiEvidenceCoverageAssessmentService.js");
  const { proposeClaim } = await import("../Backend/kai/services/kaiClaimProposalService.js");
  const {
    recordEvidenceReviewDecisionWithClaimProposalHandoff,
    proposeClaimAfterEvidenceReviewDecision,
  } = await import("../Backend/kai/services/kaiEvidenceReviewClaimProposalHandoffService.js");
  const {
    createProductionMetadataOnlyAuditForEvidenceReview,
    createProductionMetadataOnlyAuditForClaimProposal,
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
  const [evidenceA, evidenceB] = projectA.evidenceItemIds;
  const allEvidenceIds = [projectA, projectB, projectC, projectD, org2].flatMap((lineage) => lineage.evidenceItemIds);
  let proposedClaim;
  let proposedClaimQueueId;
  let evidenceAToken;
  let projectBBefore;
  let org2Before;

  test("baseline: every fresh evidence item is unreviewed with no claim, claim_review item, or claim-review decision", async () => {
    assert.deepEqual(await claimsFor(allEvidenceIds), []);
    const [{ count: claimReviewItems }] = await query("SELECT count(*)::int AS count FROM kai.review_queue_items WHERE queue_type = 'claim_review'");
    const [{ count: claimDecisions }] = await query("SELECT count(*)::int AS count FROM kai.claim_review_decisions");
    assert.equal(claimReviewItems, 0);
    assert.equal(claimDecisions, 0);
    projectBBefore = await query(
      `SELECT evidence_item_id::text, evidence_review_status, support_strength FROM kai.evidence_items
        WHERE source_version_id = $1::uuid ORDER BY evidence_item_id`, [projectB.sourceVersionId]);
    org2Before = await kaiTableRowCounts(ORG_2);
  });

  test("P2-02: the assessment is read-only, covers the ten fixed dimensions for the evidence's source_version, and writes nothing", async () => {
    const before = await kaiTableRowCounts();
    const assessment = await assessEvidenceCoverageForSourceVersion(
      { organizationId: ORG, sourceVersionId: projectA.sourceVersionId, actorContext: reviewer }, { env: ENV });
    assert.equal(assessment.ok, true, JSON.stringify(assessment));
    const statuses = Object.fromEntries(Object.entries(assessment.data.dimensions)
      .map(([key, value]) => [key, value.evidence.assessment_status]));
    console.log(`[p2-03-reviewed-claim] P2-02 dimensions ${JSON.stringify(statuses)}`);
    assert.deepEqual(Object.keys(statuses).sort(), [
      "conflicting_source_indicators", "coverage_gaps", "definition_clarity", "denominator_clarity", "duplicates",
      "entity_level_clarity", "missingness", "requirement_alignment", "small_cell_risk", "time_period_clarity",
    ]);
    assert.equal(statuses.coverage_gaps, "resolved_clear", "both committed fields have committed evidence");
    assert.equal(statuses.definition_clarity, "resolved_risk_flagged", "no committed business meaning");
    assert.equal(statuses.denominator_clarity, "unresolved");
    assert.equal(Object.values(assessment.data.dimensions).some((value) => value.severity === "blocker"), false,
      "P2-02 dimensions are informational; none is a blocker");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {}, "P2-02 persists nothing");

    const refused = await assessEvidenceCoverageForSourceVersion(
      { organizationId: ORG, sourceVersionId: projectD.sourceVersionId, actorContext: reviewer }, { env: ENV });
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, "validation_blocker", "allowed_use_status 'not_allowed' fails P2-02 closed");
  });

  test("Evidence A 'supported' through the route composition: P2-02 passes, P2-03 proposes exactly one review-gated claim with its link and claim_review item", async () => {
    const before = await kaiTableRowCounts();
    const { result, coordinates } = await reviewThroughRoute({ evidenceItemId: evidenceA, decision: "supported" });
    evidenceAToken = coordinates;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.decision_outcome, "supported");
    assert.equal(result.data.support_strength, "reviewed_supported");
    const handoff = result.data.claim_proposal_handoff;
    console.log(`[p2-03-reviewed-claim] Evidence A handoff ${JSON.stringify(handoff)}`);
    assert.equal(handoff.status, "created");
    assert.equal(handoff.coverage_assessment.status, "assessed");
    assert.equal(handoff.coverage_assessment.error_code, null);
    assert.equal(handoff.claim_review_status, "needs_gk_review");
    assert.equal(JSON.stringify(handoff).includes("households_served"), false, "the handoff carries no statement text");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), POSITIVE_REVIEW_DELTAS);

    const claims = await claimsFor([evidenceA]);
    assert.equal(claims.length, 1);
    [proposedClaim] = claims;
    assert.equal(proposedClaim.claim_id, handoff.claim_id);
    assert.deepEqual({ ...proposedClaim, claim_id: undefined, statement: undefined }, {
      claim_id: undefined,
      statement: undefined,
      organization_id: ORG,
      evidence_item_id: evidenceA,
      claim_type: "finding",
      claim_status: "proposed",
      claim_review_status: "needs_gk_review",
      claim_strength: "unassessed",
      internal_only: true,
      public_use_allowed: false,
      funder_use_allowed: false,
      llm_processing_allowed: false,
      product_learning_allowed: false,
      export_ready: false,
      created_by: userIds.reviewer,
      created_by_type: "human",
    });
    assert.match(proposedClaim.statement, /^The promoted source contains the committed data-dictionary field "(households_served|programme_month)" identified by locator /);

    const links = await query("SELECT claim_id::text, evidence_item_id::text FROM kai.claim_evidence_links WHERE claim_id = $1::uuid", [proposedClaim.claim_id]);
    assert.deepEqual(links, [{ claim_id: proposedClaim.claim_id, evidence_item_id: evidenceA }]);
    const queue = await query(
      `SELECT review_queue_item_id::text, queue_status, review_status, target_object_type FROM kai.review_queue_items
        WHERE queue_type = 'claim_review' AND target_object_id = $1::uuid`, [proposedClaim.claim_id]);
    assert.equal(queue.length, 1);
    assert.deepEqual({ ...queue[0], review_queue_item_id: undefined },
      { review_queue_item_id: undefined, queue_status: "open", review_status: "needs_gk_review", target_object_type: "claim" });
    proposedClaimQueueId = queue[0].review_queue_item_id;
    assert.equal(handoff.claim_review_queue_item_id, proposedClaimQueueId);
    const [{ count: claimDecisions }] = await query("SELECT count(*)::int AS count FROM kai.claim_review_decisions");
    assert.equal(claimDecisions, 0, "no claim-review decision is recorded");
    const [audit] = await query(
      `SELECT metadata FROM kai.upload_lifecycle_audit WHERE operation = 'claim_proposed' AND metadata->>'claim_id' = $1`,
      [proposedClaim.claim_id]);
    assert.equal(audit.metadata.claim_review_status, "needs_gk_review");
    assert.equal(Object.hasOwn(audit.metadata, "claim_statement"), false);
  });

  test("Phase 8 before Phase 9 downstream: P2-06 recomputes the P2-02 dimensions and fails closed for every audience until P2-04 gap state and human claim review exist", async () => {
    const { listOrganizationReviewQueue } = await import("../Backend/kai/services/kaiClaimTraceabilityService.js");
    const { listEligibleClaimsForAudience } = await import("../Backend/kai/services/kaiEligibleClaimsForAudienceService.js");
    for (const requestedAudience of ["internal", "funder", "public"]) {
      const trace = await getClaimTraceabilitySummary(
        { organizationId: ORG, claimId: proposedClaim.claim_id, requestedAudience, actorContext: reviewer }, { env: ENV });
      // The risk-flagged/unresolved P2-02 dimensions require P2-04 gap state
      // before P2-06 will evaluate the claim at all; P2-04 is not run here.
      assert.equal(trace.ok, false, requestedAudience);
      assert.equal(trace.error.code, "conflict_current_state_changed");
      assert.equal(trace.data.traceability_conflict_reason, "gap_dimension_requires_missing_p204_state");
      const eligible = await listEligibleClaimsForAudience(
        { organizationId: ORG, requestedAudience, limit: 25, afterClaimId: null, actorContext: reviewer }, { env: ENV });
      assert.equal(eligible.ok, true, JSON.stringify(eligible));
      assert.equal(eligible.data.eligibleClaims.some((item) => item.claimId === proposedClaim.claim_id), false, `${requestedAudience}: not eligible`);
    }
    const rollup = await listOrganizationReviewQueue({ organizationId: ORG, actorContext: reviewer }, { env: ENV });
    console.log(`[p2-03-reviewed-claim] review queue rollup ${JSON.stringify({ ok: rollup.ok, items: rollup.data?.items?.length, evaluationErrorCount: rollup.data?.evaluationErrorCount })}`);
    assert.equal(rollup.ok, true, "one fail-closed claim never breaks the organization rollup");
  });

  test("Evidence B 'not_supported': no claim is proposed and nothing claim-side is written", async () => {
    const before = await kaiTableRowCounts();
    const { result } = await reviewThroughRoute({ evidenceItemId: evidenceB, decision: "not_supported" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.support_strength, "reviewed_not_supported");
    assert.equal(result.data.claim_proposal_handoff.status, "not_applicable");
    assert.equal(result.data.claim_proposal_handoff.claim_id, null);
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), EVIDENCE_DECISION_DELTAS);
    assert.deepEqual(await claimsFor([evidenceB]), []);
  });

  test("needs_more_information proposes nothing; a later positive decision on the same item then proposes through the same path", async () => {
    const [c1] = projectC.evidenceItemIds;
    let before = await kaiTableRowCounts();
    const { result: pending } = await reviewThroughRoute({ evidenceItemId: c1, decision: "needs_more_information" });
    assert.equal(pending.ok, true, JSON.stringify(pending));
    assert.equal(pending.data.claim_proposal_handoff.status, "not_applicable");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), EVIDENCE_DECISION_DELTAS);
    assert.deepEqual(await claimsFor([c1]), []);

    before = await kaiTableRowCounts();
    const { result: limited } = await reviewThroughRoute({
      evidenceItemId: c1, decision: "supported_with_limitation", limitationNotes: ["Synthetic limitation: field presence only."],
    });
    assert.equal(limited.ok, true, JSON.stringify(limited));
    assert.equal(limited.data.claim_proposal_handoff.status, "created");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), POSITIVE_REVIEW_DELTAS);
    const [limitedClaim] = await claimsFor([c1]);
    assert.equal(limitedClaim.claim_review_status, "needs_gk_review");
    const [decision] = await query(
      `SELECT limitation_notes FROM kai.evidence_review_decisions
        WHERE evidence_item_id = $1::uuid AND decision_outcome = 'supported_with_limitation'`, [c1]);
    assert.deepEqual(decision.limitation_notes, ["Synthetic limitation: field presence only."], "the limitation stays in the decision ledger");
  });

  test("replay: the identical supported decision replays P2-12 and P2-03 with zero writes and no duplicate claim or claim_review item", async () => {
    const before = await kaiTableRowCounts();
    const { result } = await reviewThroughRoute({ evidenceItemId: evidenceA, decision: "supported", token: evidenceAToken });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.replayed, true);
    assert.equal(result.data.claim_proposal_handoff.status, "replayed");
    assert.equal(result.data.claim_proposal_handoff.claim_id, proposedClaim.claim_id);
    assert.equal(result.data.claim_proposal_handoff.claim_review_queue_item_id, proposedClaimQueueId);
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
    assert.equal((await claimsFor([evidenceA])).length, 1);
  });

  test("stale: a changed decision on an old token conflicts and writes nothing; a non-current source_version blocks P2-02 before any claim", async () => {
    let before = await kaiTableRowCounts();
    const { result: stale } = await reviewThroughRoute({ evidenceItemId: evidenceA, decision: "not_supported", token: evidenceAToken });
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "conflict_current_state_changed");
    assert.equal(stale.data?.claim_proposal_handoff, undefined);
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});

    // Supersede Project C's source_version in this throwaway cluster only.
    const [, c2] = projectC.evidenceItemIds;
    await query("UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid", [projectC.sourceVersionId]);
    before = await kaiTableRowCounts();
    const { result } = await reviewThroughRoute({ evidenceItemId: c2, decision: "supported" });
    assert.equal(result.ok, false, "P2-12 itself refuses a non-current lineage");
    assert.equal(result.error.code, "conflict_current_state_changed");
    assert.equal(result.data?.claim_proposal_handoff, undefined);
    const assessed = await assessEvidenceCoverageForSourceVersion(
      { organizationId: ORG, sourceVersionId: projectC.sourceVersionId, actorContext: reviewer }, { env: ENV });
    assert.equal(assessed.ok, false, "P2-02 refuses a non-current source_version");
    const now = new Date().toISOString();
    const proposed = await proposeClaim({ organizationId: ORG, evidenceItemId: c2, actorContext: reviewer, now }, {
      env: ENV, metadataOnlyAudit: createProductionMetadataOnlyAuditForClaimProposal({ organizationId: ORG, evidenceItemId: c2, actorContext: reviewer, now }),
    });
    assert.equal(proposed.ok, false);
    assert.equal(proposed.error.code, "conflict_current_state_changed", "P2-03C current-source-version gate");
    console.log(`[p2-03-reviewed-claim] non-current source_version ${JSON.stringify({ p2_12: result.error.code, p2_02: assessed.error.code, p2_03: proposed.error.code })}`);
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {}, "nothing is written");
    assert.deepEqual(await claimsFor([c2]), []);
    await query("UPDATE kai.source_versions SET is_current = true WHERE source_version_id = $1::uuid", [projectC.sourceVersionId]);
  });

  test("P2-02 blocker: supported evidence from an allowed_use 'not_allowed' source is reviewed but never proposed", async () => {
    const [d1] = projectD.evidenceItemIds;
    const before = await kaiTableRowCounts();
    const { result } = await reviewThroughRoute({ evidenceItemId: d1, decision: "supported" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.data.claim_proposal_handoff, {
      status: "not_created",
      coverage_assessment: { status: "blocked", unresolved_dimension_count: null, risk_flagged_dimension_count: null, error_code: "validation_blocker" },
      claim_id: null,
      claim_review_status: null,
      claim_review_queue_item_id: null,
      error_code: "validation_blocker",
    });
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), EVIDENCE_DECISION_DELTAS);
    assert.deepEqual(await claimsFor([d1]), []);
  });

  test("authorization: operator, client, system, and AI actors cannot review or propose; nothing is written", async () => {
    const [b1] = projectB.evidenceItemIds;
    const before = await kaiTableRowCounts();
    for (const actorContext of [operator, client, { ...reviewer, actorType: "system" }, { ...reviewer, actorType: "ai" }]) {
      const { result } = await reviewThroughRoute({ evidenceItemId: b1, decision: "supported", actorContext });
      assert.equal(result.ok, false, JSON.stringify(actorContext));
      assert.equal(result.data?.claim_proposal_handoff, undefined);
    }
    // The direct P2-03 route's service refuses the client and every non-human actor.
    for (const actorContext of [client, { ...reviewer, actorType: "system" }, { ...reviewer, actorType: "assistant" }]) {
      const now = new Date().toISOString();
      const proposed = await proposeClaim({ organizationId: ORG, evidenceItemId: b1, actorContext, now }, {
        env: ENV, metadataOnlyAudit: createProductionMetadataOnlyAuditForClaimProposal({ organizationId: ORG, evidenceItemId: b1, actorContext, now }),
      });
      assert.equal(proposed.ok, false, JSON.stringify(actorContext));
    }
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
    assert.deepEqual(await claimsFor([b1]), []);
  });

  test("tenant isolation: cross-organization ids and a forged positive decision for another organization's evidence write nothing", async () => {
    const [o1] = org2.evidenceItemIds;
    const before = await kaiTableRowCounts();
    // Org 1 reviewer, Org 2 evidence under Org 1.
    const { result: crossItem } = await reviewThroughRoute({
      evidenceItemId: o1, decision: "supported", token: await evidenceQueue(ORG_2, o1),
    });
    assert.equal(crossItem.ok, false);
    // Org 2 reviewer against Org 1.
    const { result: crossActor } = await reviewThroughRoute({
      evidenceItemId: projectB.evidenceItemIds[0], decision: "supported", actorContext: reviewer2,
    });
    assert.equal(crossActor.ok, false);
    // The handoff never trusts the decision object: a forged positive result
    // for Org 2 evidence under Org 1 fails the scoped re-read.
    const forged = await proposeClaimAfterEvidenceReviewDecision({
      organizationId: ORG,
      evidenceItemId: o1,
      evidenceReviewDecision: {
        evidence_item_id: o1, decision_outcome: "supported", support_strength: "reviewed_supported", queue_status: "resolved", review_status: "resolved",
      },
      actorContext: reviewer,
      now: new Date().toISOString(),
    }, { env: ENV });
    assert.equal(forged.status, "not_created");
    assert.equal(forged.error_code, "not_found");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
    assert.deepEqual(await claimsFor(org2.evidenceItemIds), []);
  });

  test("no raw/parser shortcut: P2-03 accepts only a governed evidence item - file, parser run, profile, dictionary, candidate, and source_version ids write nothing", async () => {
    const before = await kaiTableRowCounts();
    for (const notEvidenceId of [
      projectB.intakeFileId, projectB.parserRunId, projectB.fileProfileId, projectB.dataDictionaryId,
      projectB.intakeSensitivityProfileId, projectB.intakeSourceCandidateId, projectB.sourceVersionId,
    ]) {
      const now = new Date().toISOString();
      const proposed = await proposeClaim({ organizationId: ORG, evidenceItemId: notEvidenceId, actorContext: reviewer, now }, {
        env: ENV, metadataOnlyAudit: createProductionMetadataOnlyAuditForClaimProposal({ organizationId: ORG, evidenceItemId: notEvidenceId, actorContext: reviewer, now }),
      });
      assert.equal(proposed.ok, false);
      assert.equal(proposed.error.code, "not_found");
    }
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
  });

  test("GK product visibility: the Claim Library shows the proposed claim with its text and open claim_review; the Evidence Library shows A supported and B not supported", async () => {
    const library = await listClaimLibraryCandidates({ organizationId: ORG, limit: 25, actorContext: reviewer }, { env: ENV });
    assert.equal(library.ok, true, JSON.stringify(library));
    const listed = library.data.items.find((item) => item.claimId === proposedClaim.claim_id);
    assert.ok(listed, "the proposed claim is listed");
    assert.equal(listed.evidenceItemId, evidenceA);
    assert.equal(listed.claimReviewStatus, "needs_gk_review");
    assert.equal(listed.claimStatement, proposedClaim.statement);
    assert.deepEqual(listed.reviewQueueItems.filter((item) => item.queue_type === "claim_review").map((item) => item.queue_status), ["open"]);
    assert.equal(library.data.items.some((item) => item.evidenceItemId === evidenceB), false, "no claim rests on not_supported evidence");
    assert.equal(library.data.items.some((item) => org2.evidenceItemIds.includes(item.evidenceItemId)), false);

    const evidence = await listOrganizationEvidenceLibrary({ organizationId: ORG, limit: 25, afterEvidenceItemId: null, actorContext: reviewer }, { env: ENV });
    assert.equal(evidence.ok, true);
    const byId = Object.fromEntries(evidence.data.items.map((item) => [item.evidenceItemId, item]));
    assert.equal(byId[evidenceA].supportStrength, "reviewed_supported");
    assert.equal(byId[evidenceB].supportStrength, "reviewed_not_supported");

    const refused = await listClaimLibraryCandidates({ organizationId: ORG, limit: 25, actorContext: client }, { env: ENV });
    assert.equal(refused.ok, false, "the client cannot read the GK Claim Library");
  });

  test("client pipeline: with the claim proposed but not reviewed, Project A shows evidence review complete and Impact Fact review waiting for Get Kinder, with no internal ids", async () => {
    const { pipeline, file } = await projectFile(ORG, PROJECT_A, projectA.intakeFileId);
    const stages = Object.fromEntries(file.stages.map((entry) => [entry.key, entry.status]));
    console.log(`[p2-03-reviewed-claim] Project A client ${JSON.stringify({ currentStage: file.currentStage, currentStatus: file.currentStatus, reason: file.reason })}`);
    assert.equal(stages.evidence_review, "complete");
    assert.equal(stages.impact_fact_review, "waiting_for_get_kinder");
    assert.equal(file.currentStage, "impact_fact_review");
    assert.equal(file.reason, "impact_fact_review_pending");
    assert.equal(file.reviewedImpactFactCount, 0);
    assert.deepEqual(pipeline.data.reviewedImpactFacts, []);
    const serialized = JSON.stringify(pipeline.data);
    for (const forbidden of [
      proposedClaim.claim_id, proposedClaimQueueId, evidenceA, evidenceB, userIds.reviewer, projectA.sourceVersionId, proposedClaim.statement,
    ]) {
      assert.equal(serialized.includes(forbidden), false, "client pipeline carries no claim/evidence/queue/reviewer id or claim text");
    }
    for (const forbidden of ["decision_outcome", "claim_review", "needs_gk_review", "decided_by", "not_supported"]) {
      assert.equal(serialized.includes(forbidden), false, `client pipeline carries no ${forbidden}`);
    }
    const facts = await listClientImpactFacts({ organizationId: ORG, actorContext: client }, { env: ENV });
    if (facts.ok) assert.equal(facts.data.items.some((item) => item.claimId === proposedClaim.claim_id), false, "a proposal is not an Impact Fact");
  });

  test("isolation and zero approval: Project B and Org 2 are unchanged; no claim is approved, audience-widened, or export-ready", async () => {
    const projectBAfter = await query(
      `SELECT evidence_item_id::text, evidence_review_status, support_strength FROM kai.evidence_items
        WHERE source_version_id = $1::uuid ORDER BY evidence_item_id`, [projectB.sourceVersionId]);
    assert.deepEqual(projectBAfter, projectBBefore);
    assert.deepEqual(await claimsFor(projectB.evidenceItemIds), []);
    assert.deepEqual(deltas(org2Before, await kaiTableRowCounts(ORG_2)), {}, "Org 2 is untouched");
    const { file: fileB } = await projectFile(ORG, PROJECT_B, projectB.intakeFileId);
    assert.equal(fileB.currentStage, "evidence_review");

    const [{ count: claimDecisions }] = await query("SELECT count(*)::int AS count FROM kai.claim_review_decisions");
    assert.equal(claimDecisions, 0);
    const widened = await query(
      `SELECT claim_id FROM kai.claims
        WHERE claim_status <> 'proposed' OR claim_review_status <> 'needs_gk_review' OR claim_strength <> 'unassessed'
           OR internal_only IS NOT TRUE OR public_use_allowed OR funder_use_allowed OR llm_processing_allowed
           OR product_learning_allowed OR export_ready`);
    assert.deepEqual(widened, []);
    const openClaimQueues = await query(
      "SELECT queue_status, review_status FROM kai.review_queue_items WHERE queue_type = 'claim_review' ORDER BY review_queue_item_id");
    assert.deepEqual(openClaimQueues, [
      { queue_status: "open", review_status: "needs_gk_review" },
      { queue_status: "open", review_status: "needs_gk_review" },
    ], "exactly the two proposed claims (Evidence A and Project C) wait for human claim review");
  });
}
