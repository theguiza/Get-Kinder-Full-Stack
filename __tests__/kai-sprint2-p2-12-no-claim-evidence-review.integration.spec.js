import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_01_EVIDENCE_EXTRACTION_HANDOFF_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P2-12 no-claim evidence review integration suite refused a non-loopback database host: ${host}`);
  }
}

test("P2-12 no-claim integration isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

test("the assembled proof never creates a claim and never calls P2-01 directly", () => {
  const source = readFileSync(new URL(import.meta.url), "utf8");
  const importLines = source.split("\n").filter((line) => /\bimport\(|\bimport\b.*from/.test(line));
  for (const line of importLines) {
    assert.doesNotMatch(line, /kaiEvidenceLineageService|postgresEvidenceLineageRepository|kaiClaimProposalService|postgresClaimProposalRepository/);
  }
  assert.equal(source.includes(["INSERT INTO kai.", "claims"].join("")), false, "no claim row is ever written by this file");
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P2-12 no-claim evidence review integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runNoClaimEvidenceReviewSuite();
}

/**
 * KAI P2-12 human evidence review of evidence that has NO claim, against real
 * PostgreSQL. Fresh synthetic lineages are advanced through the real P1-06
 * review work, cockpit sensitivity decision (P1-07 handoff), and cockpit P1-08
 * promotion (P2-01 handoff), so every evidence item and evidence_review queue
 * item here was created by production services. The GK reviewer then discovers
 * the work through the Knowledge Studio Evidence Library read and records
 * decisions through the unmodified P2-12 service with the same production
 * audit adapter the P2-12 route composes. No claim exists at any point.
 */
async function runNoClaimEvidenceReviewSuite() {
  const { Pool } = await import("pg");
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const { submitSensitivityProfileDecision, submitSourceCandidateDecision } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const { getClientEvidencePipeline } = await import("../Backend/kai/services/kaiClientEvidencePipelineService.js");
  const { listOrganizationEvidenceLibrary } = await import("../Backend/kai/services/kaiEvidenceLibraryService.js");
  const { recordEvidenceReviewDecision } = await import("../Backend/kai/services/kaiHumanReviewService.js");
  const { createProductionMetadataOnlyAuditForEvidenceReview } = await import("../Backend/kai/services/kaiMetadataOnlyAuditComposition.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const ORG_2 = "00000000-0000-4000-8000-0000000000d2";
  const PROJECT_A = "7c000000-0000-4000-8000-0000000000a1";
  const PROJECT_B = "7c000000-0000-4000-8000-0000000000b1";
  const PROJECT_ORG_2 = "7c000000-0000-4000-8000-0000000000d1";
  const BATCH_A = "10000000-0000-4000-8000-0000000000a1";
  const BATCH_B = "10000000-0000-4000-8000-0000000000b1";
  const BATCH_ORG_2 = "10000000-0000-4000-8000-0000000000d1";
  const NOW = "2026-09-26T11:00:00.000Z";
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const FIELD_KEYS = ["households_served", "programme_month"];
  const SYNTHETIC_LIMITATION_NOTE = "Synthetic limitation: field presence only, not an outcome count.";

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
  for (const [engagementId, organizationId, code] of [
    [PROJECT_A, ORG, "Project A"], [PROJECT_B, ORG, "Project B"], [PROJECT_ORG_2, ORG_2, "Org 2 Project"],
  ]) {
    await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, $3, '{}'::jsonb)",
      [engagementId, organizationId, code]);
  }
  for (const [batchId, organizationId, engagementId] of [
    [BATCH_A, ORG, PROJECT_A], [BATCH_B, ORG, PROJECT_B], [BATCH_ORG_2, ORG_2, PROJECT_ORG_2],
  ]) {
    await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'received', 'not_reviewed')`, [batchId, organizationId, engagementId, `batch-${batchId.slice(-2)}`]);
  }

  const userIds = {};
  for (const [legacyId, key, organizationId, role] of [
    [961, "reviewer", ORG, "gk_reviewer"],
    [962, "client", ORG, "client_admin"],
    [963, "operator", ORG, "gk_operator"],
    [964, "reviewer2", ORG_2, "gk_reviewer"],
  ]) {
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
    const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@no-claim.test` });
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
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

  /** P1-03..P1-05 fixture rows (the P1 worker's output); everything after is a real service. */
  async function seedFreshProfile({ index, organizationId, engagementId, batchId }) {
    const intakeFileId = `21000000-0000-4000-8000-00000000000${index}`;
    const checksum = String(index).repeat(63) + "f";
    await query(
      `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
         mime_type, file_size_bytes, malware_scan_status, review_status, file_policy_status, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, $6, 'sha256', 'confirmed', 'synthetic-v1', $6, 512, $7::timestamptz,
         'text/csv', 512, 'clean', 'not_reviewed', 'passed', $7::timestamptz)`,
      [intakeFileId, batchId, organizationId, engagementId, `no-claim-outcomes-${index}.csv`, checksum, NOW],
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
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::timestamptz) RETURNING intake_sensitivity_profile_id::text`,
      [organizationId, intakeFileId, fileProfile.file_profile_id, dictionary.data_dictionary_id, fileProfile.profile_canonical_sha256, NOW],
    );
    return { intakeFileId, intakeSensitivityProfileId: sensitivity.intake_sensitivity_profile_id };
  }

  /** Real P1-06 -> P1-07 -> P1-08 -> P2-01 handoff chain; returns the file and its evidence ids. */
  async function reachPromotedEvidence({ index, organizationId, engagementId, batchId, actorContext }) {
    const lineage = await seedFreshProfile({ index, organizationId, engagementId, batchId });
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
      intakeFileId: lineage.intakeFileId,
      sourceVersionId: promoted.data.source_version.source_version_id,
      evidenceItemIds: evidence.map((row) => row.evidence_item_id),
    };
  }

  async function kaiTableRowCounts() {
    const tables = await query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'kai' AND table_type = 'BASE TABLE' ORDER BY table_name",
    );
    const counts = {};
    for (const { table_name: tableName } of tables) {
      // eslint-disable-next-line no-await-in-loop
      counts[tableName] = (await query(`SELECT count(*)::int AS count FROM kai.${tableName}`))[0].count;
    }
    return counts;
  }
  function deltas(before, after) {
    return Object.fromEntries(Object.keys(after).filter((table) => after[table] !== before[table]).sort()
      .map((table) => [table, after[table] - before[table]]));
  }

  async function evidenceState(organizationId, evidenceItemId) {
    const [evidence] = await query(
      `SELECT evidence_review_status, support_strength, internal_only, public_use_allowed, funder_use_allowed, llm_processing_allowed
         FROM kai.evidence_items WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid`,
      [organizationId, evidenceItemId],
    );
    const queue = await query(
      `SELECT review_queue_item_id::text, queue_status, review_status, updated_at FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_type = 'evidence_item'
          AND target_object_id = $2::uuid`,
      [organizationId, evidenceItemId],
    );
    const decisions = await query(
      `SELECT decision_id::text, decision_outcome, limitation_notes, decided_by::text, decided_by_role, target_updated_at,
              supersedes_decision_id::text, review_queue_item_id::text
         FROM kai.evidence_review_decisions WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid ORDER BY created_at`,
      [organizationId, evidenceItemId],
    );
    return { evidence, queue, decisions };
  }

  /** The GK Knowledge Studio Evidence read (all pages), exactly as the Evidence tab calls it. */
  async function readEvidenceLibrary(organizationId, actorContext) {
    const items = [];
    let afterEvidenceItemId = null;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const page = await listOrganizationEvidenceLibrary({ organizationId, limit: 25, afterEvidenceItemId, actorContext }, { env: ENV });
      if (!page.ok) return page;
      items.push(...page.data.items);
      if (!page.data.truncated) return { ok: true, items, capabilities: page.data.capabilities };
      afterEvidenceItemId = page.data.nextAfterEvidenceItemId;
    }
  }

  /** Exactly what the P2-12 route does: the service plus the production audit adapter. */
  function decide({ organizationId = ORG, evidenceItemId, reviewQueueItemId, expectedUpdatedAt, decision, limitationNotes, actorContext = reviewer }) {
    const now = new Date().toISOString();
    return recordEvidenceReviewDecision({
      organizationId,
      evidenceItemId,
      reviewQueueItemId,
      expectedUpdatedAt,
      decision,
      ...(limitationNotes === undefined ? {} : { limitationNotes }),
      actorContext,
      now,
    }, {
      env: ENV,
      metadataOnlyAudit: createProductionMetadataOnlyAuditForEvidenceReview({ organizationId, evidenceItemId, actorContext, now }),
    });
  }

  async function projectFile(engagementId, intakeFileId) {
    const pipeline = await getClientEvidencePipeline(
      { organizationId: ORG, engagementId, actorContext: actor("client", ORG, "client_admin") }, { env: ENV });
    assert.equal(pipeline.ok, true, JSON.stringify(pipeline));
    const file = pipeline.data.files.find((entry) => entry.intakeFileId === intakeFileId);
    assert.ok(file, "the file is in its own Project pipeline");
    return { pipeline, file };
  }

  const DECISION_WRITE_DELTAS = { audit_events: 1, evidence_review_decisions: 1, upload_lifecycle_audit: 1 };

  const projectA = await reachPromotedEvidence({ index: 1, organizationId: ORG, engagementId: PROJECT_A, batchId: BATCH_A, actorContext: reviewer });
  const projectB = await reachPromotedEvidence({ index: 2, organizationId: ORG, engagementId: PROJECT_B, batchId: BATCH_B, actorContext: reviewer });
  const org2 = await reachPromotedEvidence({ index: 3, organizationId: ORG_2, engagementId: PROJECT_ORG_2, batchId: BATCH_ORG_2, actorContext: reviewer2 });
  const [a1, a2] = projectA.evidenceItemIds;
  const [b1] = projectB.evidenceItemIds;
  const allReviewedIds = [...projectA.evidenceItemIds, ...projectB.evidenceItemIds, ...org2.evidenceItemIds];
  const clientForbiddenIds = [
    ...allReviewedIds, projectA.sourceVersionId, projectB.sourceVersionId, userIds.reviewer, userIds.reviewer2,
  ];
  let a1Discovered;

  test("baseline: the fresh evidence has no claim, one open evidence_review item each, and the client Project waits for Get Kinder evidence review", async () => {
    const [{ count: claimCount }] = await query(
      "SELECT count(*)::int AS count FROM kai.claims WHERE evidence_item_id = ANY($1::uuid[])", [allReviewedIds]);
    assert.equal(claimCount, 0, "no claim exists for any evidence item under review");
    for (const evidenceItemId of projectA.evidenceItemIds) {
      const state = await evidenceState(ORG, evidenceItemId);
      assert.equal(state.evidence.evidence_review_status, "needs_gk_review");
      assert.equal(state.evidence.support_strength, "unassessed");
      assert.equal(state.queue.length, 1);
      assert.equal(state.queue[0].queue_status, "open");
      assert.equal(state.queue[0].review_status, "needs_gk_review");
      assert.deepEqual(state.decisions, []);
    }
    for (const [engagementId, project] of [[PROJECT_A, projectA], [PROJECT_B, projectB]]) {
      const { file } = await projectFile(engagementId, project.intakeFileId);
      const stages = Object.fromEntries(file.stages.map((entry) => [entry.key, entry.status]));
      assert.equal(stages.evidence_extraction, "complete");
      assert.equal(stages.evidence_review, "waiting_for_get_kinder");
      assert.equal(file.currentStage, "evidence_review");
      assert.equal(file.reason, "evidence_awaiting_review");
    }
  });

  test("discover + safe detail: the GK Evidence Library lists each no-claim evidence item with its own evidence_review queue item and concurrency token, and nothing GK-private", async () => {
    const library = await readEvidenceLibrary(ORG, reviewer);
    assert.equal(library.ok, true, JSON.stringify(library));
    const byId = new Map(library.items.map((item) => [item.evidenceItemId, item]));
    for (const evidenceItemId of org2.evidenceItemIds) assert.equal(byId.has(evidenceItemId), false, "Organization 2 evidence never appears");
    for (const evidenceItemId of [...projectA.evidenceItemIds, ...projectB.evidenceItemIds]) {
      const item = byId.get(evidenceItemId);
      assert.ok(item, "discoverable through the organization's Evidence Library");
      const state = await evidenceState(ORG, evidenceItemId);
      assert.deepEqual(Object.keys(item).sort(), [
        "dataClass", "evidenceItemId", "evidenceReview", "evidenceReviewStatus", "evidenceType", "funderUseAllowed",
        "internalOnly", "publicUseAllowed", "sensitivityLevel", "sourceId", "sourceVersionId", "statement", "supportStrength",
      ]);
      assert.deepEqual(item.evidenceReview, {
        reviewQueueItemId: state.queue[0].review_queue_item_id,
        queueStatus: "open",
        reviewStatus: "needs_gk_review",
        expectedUpdatedAt: new Date(state.queue[0].updated_at).toISOString(),
        currentDecisionOutcome: null,
      });
      assert.equal(item.evidenceReviewStatus, "needs_gk_review");
      assert.equal(item.supportStrength, "unassessed");
      assert.equal(item.evidenceType, "dictionary_field_presence_fact");
      assert.equal(item.sensitivityLevel, "unknown");
      assert.equal(item.internalOnly, true);
    }
    const serialized = JSON.stringify(library.items);
    for (const forbidden of ["decided_by", "decidedBy", "limitation", "queue_metadata", "summary", "object_key", "storage", "signed", "safe_filename", userIds.reviewer]) {
      assert.equal(serialized.includes(forbidden), false, `Evidence Library DTO never carries ${forbidden}`);
    }
    assert.deepEqual(library.capabilities, { canRecordEvidenceReviewDecision: true });
    a1Discovered = byId.get(a1);

    const operatorLibrary = await readEvidenceLibrary(ORG, actor("operator", ORG, "gk_operator"));
    assert.equal(operatorLibrary.ok, true, "gk_operator keeps its Evidence Library read");
    assert.deepEqual(operatorLibrary.capabilities, { canRecordEvidenceReviewDecision: false });
    const operatorA1 = operatorLibrary.items.find((item) => item.evidenceItemId === a1);
    assert.deepEqual(operatorA1.evidenceReview, { queueStatus: "open", reviewStatus: "needs_gk_review", currentDecisionOutcome: null },
      "a read-only operator sees the review posture but no P2-12 write coordinates");
    for (const item of operatorLibrary.items) {
      assert.equal(item.evidenceReview === null || !("reviewQueueItemId" in item.evidenceReview), true);
      assert.equal(item.evidenceReview === null || !("expectedUpdatedAt" in item.evidenceReview), true);
    }
  });

  test("authorization: only a GK reviewer/admin of the evidence's own organization may decide; every other actor, cross-tenant id, and mismatched queue writes nothing", async () => {
    assert.ok(a1Discovered);
    const token = a1Discovered.evidenceReview.expectedUpdatedAt;
    const queueId = a1Discovered.evidenceReview.reviewQueueItemId;
    const before = await kaiTableRowCounts();
    const cases = [
      ["client_admin", { actorContext: actor("client", ORG, "client_admin") }, "authorization_denied"],
      ["gk_operator (read-only for P2-12)", { actorContext: actor("operator", ORG, "gk_operator") }, "authorization_denied"],
      ["system actor", { actorContext: { ...reviewer, actorType: "system" } }, "authorization_denied"],
      ["AI actor", { actorContext: { ...reviewer, actorType: "ai" } }, "authorization_denied"],
      ["assistant actor", { actorContext: { ...reviewer, actorType: "assistant" } }, "authorization_denied"],
      ["inactive membership", {
        actorContext: actor("reviewer", ORG, "gk_reviewer", {
          organizationMemberships: [{ organization_id: ORG, membership_status: "inactive", role_name: "gk_reviewer" }],
        }),
      }, "authorization_denied"],
      ["cross-organization GK reviewer", { actorContext: reviewer2 }, "authorization_denied"],
      ["Organization 1 reviewer naming Organization 2", { organizationId: ORG_2 }, "authorization_denied"],
      ["Organization 2 evidence id under Organization 1", { evidenceItemId: org2.evidenceItemIds[0] }, "not_found"],
      ["Project B queue item for Project A evidence", {
        reviewQueueItemId: (await evidenceState(ORG, b1)).queue[0].review_queue_item_id,
      }, "not_found"],
    ];
    for (const [label, overrides, expectedCode] of cases) {
      const result = await decide({ evidenceItemId: a1, reviewQueueItemId: queueId, expectedUpdatedAt: token, decision: "supported", ...overrides });
      assert.equal(result.ok, false, label);
      assert.equal(result.error.code, expectedCode, `${label}: ${JSON.stringify(result.error)}`);
    }
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {}, "no refused request wrote anything");
    const denied = await readEvidenceLibrary(ORG_2, reviewer);
    assert.equal(denied.ok, false, "Organization 1 cannot read Organization 2's Evidence Library");
    assert.equal(denied.error.code, "authorization_denied");
  });

  test("positive: 'supported' on no-claim evidence resolves its queue item and records one decision; no claim, no new queue item, no audience change; the identical replay writes nothing", async () => {
    const before = await kaiTableRowCounts();
    const result = await decide({
      evidenceItemId: a1,
      reviewQueueItemId: a1Discovered.evidenceReview.reviewQueueItemId,
      expectedUpdatedAt: a1Discovered.evidenceReview.expectedUpdatedAt,
      decision: "supported",
    });
    const after = await kaiTableRowCounts();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(Object.keys(result.data).sort(), [
      "decision_id", "decision_outcome", "evidence_item_id", "evidence_review_status", "queue_status", "replayed",
      "review_queue_item_id", "review_status", "support_strength",
    ]);
    assert.equal(result.data.evidence_review_status, "reviewed");
    assert.equal(result.data.support_strength, "reviewed_supported");
    assert.equal(result.data.queue_status, "resolved");
    assert.equal(result.data.review_status, "resolved");
    assert.equal(result.data.replayed, false);
    assert.deepEqual(deltas(before, after), DECISION_WRITE_DELTAS, "exactly one decision + its audits; claims, queue rows, and Impact Facts +0");

    const state = await evidenceState(ORG, a1);
    assert.deepEqual(state.evidence, {
      evidence_review_status: "reviewed", support_strength: "reviewed_supported",
      internal_only: true, public_use_allowed: false, funder_use_allowed: false, llm_processing_allowed: false,
    }, "audience posture is untouched");
    assert.equal(state.queue.length, 1, "the existing queue item was updated, not duplicated");
    assert.equal(state.queue[0].review_queue_item_id, a1Discovered.evidenceReview.reviewQueueItemId);
    assert.deepEqual([state.queue[0].queue_status, state.queue[0].review_status], ["resolved", "resolved"]);
    assert.equal(state.decisions.length, 1);
    assert.equal(state.decisions[0].decision_outcome, "supported");
    assert.equal(state.decisions[0].decided_by, userIds.reviewer);
    assert.equal(state.decisions[0].decided_by_role, "gk_reviewer");
    assert.equal(state.decisions[0].supersedes_decision_id, null);
    assert.equal(new Date(state.decisions[0].target_updated_at).toISOString(), a1Discovered.evidenceReview.expectedUpdatedAt);
    const [audit] = await query(
      `SELECT operation, metadata FROM kai.upload_lifecycle_audit
        WHERE organization_id = $1::uuid AND intake_file_id = $2::uuid AND operation = 'evidence_review_completed'`,
      [ORG, projectA.intakeFileId],
    );
    assert.equal(audit.metadata.decision_outcome, "supported");
    assert.equal(audit.metadata.resulting_support_strength, "reviewed_supported");
    assert.equal(audit.metadata.metadata_only, true);

    const replay = await decide({
      evidenceItemId: a1,
      reviewQueueItemId: a1Discovered.evidenceReview.reviewQueueItemId,
      expectedUpdatedAt: a1Discovered.evidenceReview.expectedUpdatedAt,
      decision: "supported",
    });
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.decision_id, result.data.decision_id);
    assert.deepEqual(deltas(after, await kaiTableRowCounts()), {}, "replay is a zero-write read back");

    const library = await readEvidenceLibrary(ORG, reviewer);
    const refreshed = library.items.find((item) => item.evidenceItemId === a1);
    assert.equal(refreshed.evidenceReviewStatus, "reviewed");
    assert.equal(refreshed.evidenceReview.queueStatus, "resolved");
    assert.equal(refreshed.evidenceReview.currentDecisionOutcome, "supported");
  });

  test("aggregation + isolation: with one of Project A's two items reviewed, Project A still waits for evidence review and Project B is unchanged", async () => {
    const { file: fileA } = await projectFile(PROJECT_A, projectA.intakeFileId);
    const evidenceReviewA = fileA.stages.find((entry) => entry.key === "evidence_review");
    assert.equal(evidenceReviewA.status, "waiting_for_get_kinder");
    assert.equal(fileA.currentStage, "evidence_review");
    const { file: fileB } = await projectFile(PROJECT_B, projectB.intakeFileId);
    assert.equal(fileB.currentStage, "evidence_review");
    assert.equal(fileB.stages.find((entry) => entry.key === "evidence_review").status, "waiting_for_get_kinder");
    for (const evidenceItemId of projectB.evidenceItemIds) {
      const state = await evidenceState(ORG, evidenceItemId);
      assert.equal(state.evidence.evidence_review_status, "needs_gk_review", "Project B evidence untouched");
      assert.deepEqual(state.decisions, []);
    }
  });

  test("limiting + stale: 'needs_more_information' keeps the item open, a stale token then conflicts with zero writes, and 'not_supported' with the fresh token resolves it", async () => {
    const [discovered] = (await readEvidenceLibrary(ORG, reviewer)).items.filter((item) => item.evidenceItemId === a2);
    const firstToken = discovered.evidenceReview.expectedUpdatedAt;
    const queueId = discovered.evidenceReview.reviewQueueItemId;

    let before = await kaiTableRowCounts();
    const needsMore = await decide({ evidenceItemId: a2, reviewQueueItemId: queueId, expectedUpdatedAt: firstToken, decision: "needs_more_information" });
    assert.equal(needsMore.ok, true, JSON.stringify(needsMore));
    assert.equal(needsMore.data.evidence_review_status, "needs_gk_review");
    assert.equal(needsMore.data.support_strength, "unassessed");
    assert.equal(needsMore.data.queue_status, "open");
    assert.equal(needsMore.data.review_status, "needs_gk_review");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), DECISION_WRITE_DELTAS);

    before = await kaiTableRowCounts();
    const stale = await decide({ evidenceItemId: a2, reviewQueueItemId: queueId, expectedUpdatedAt: firstToken, decision: "not_supported" });
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "conflict_current_state_changed");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {}, "a stale token writes nothing");

    const [rediscovered] = (await readEvidenceLibrary(ORG, reviewer)).items.filter((item) => item.evidenceItemId === a2);
    assert.equal(rediscovered.evidenceReview.currentDecisionOutcome, "needs_more_information");
    assert.equal(rediscovered.evidenceReview.queueStatus, "open");
    assert.notEqual(rediscovered.evidenceReview.expectedUpdatedAt, firstToken, "the refreshed read carries the new token");

    before = await kaiTableRowCounts();
    const notSupported = await decide({
      evidenceItemId: a2, reviewQueueItemId: queueId, expectedUpdatedAt: rediscovered.evidenceReview.expectedUpdatedAt, decision: "not_supported",
    });
    assert.equal(notSupported.ok, true, JSON.stringify(notSupported));
    assert.equal(notSupported.data.evidence_review_status, "reviewed");
    assert.equal(notSupported.data.support_strength, "reviewed_not_supported");
    assert.equal(notSupported.data.queue_status, "resolved");
    assert.equal(notSupported.data.review_status, "resolved");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), DECISION_WRITE_DELTAS);
    const state = await evidenceState(ORG, a2);
    assert.deepEqual(state.decisions.map((row) => row.decision_outcome), ["needs_more_information", "not_supported"]);
    assert.equal(state.decisions[1].supersedes_decision_id, state.decisions[0].decision_id, "append-only lineage");
    assert.equal(state.evidence.public_use_allowed, false);
    assert.equal(state.evidence.funder_use_allowed, false);
    assert.equal(state.queue.length, 1);
  });

  test("aggregation: once both Project A items are reviewed, the persisted derivation completes evidence review; Project B still waits; no Impact Fact appears", async () => {
    const { pipeline, file: fileA } = await projectFile(PROJECT_A, projectA.intakeFileId);
    const evidenceReviewA = fileA.stages.find((entry) => entry.key === "evidence_review");
    console.log(`[p2-12-no-claim] Project A after both reviews ${JSON.stringify({ currentStage: fileA.currentStage, currentStatus: fileA.currentStatus, reason: fileA.reason })}`);
    assert.equal(evidenceReviewA.status, "complete");
    assert.notEqual(fileA.currentStage, "evidence_review");
    assert.equal(fileA.reviewedImpactFactCount, 0);
    assert.deepEqual(pipeline.data.reviewedImpactFacts, []);
    const serialized = JSON.stringify(pipeline.data);
    for (const forbidden of clientForbiddenIds) assert.equal(serialized.includes(forbidden), false, "client pipeline carries no GK/evidence/source/reviewer id");
    for (const forbidden of ["decision_outcome", "not_supported", "needs_more_information", "review_queue", "decided_by", "limitation"]) {
      assert.equal(serialized.includes(forbidden), false, `client pipeline carries no ${forbidden}`);
    }
    const { file: fileB } = await projectFile(PROJECT_B, projectB.intakeFileId);
    assert.equal(fileB.currentStage, "evidence_review", "reviewing Project A never advances Project B");
  });

  test("limitation: 'supported_with_limitation' requires notes, persists them in the ledger only, and resolves the item", async () => {
    const [discovered] = (await readEvidenceLibrary(ORG, reviewer)).items.filter((item) => item.evidenceItemId === b1);
    const base = { evidenceItemId: b1, reviewQueueItemId: discovered.evidenceReview.reviewQueueItemId, expectedUpdatedAt: discovered.evidenceReview.expectedUpdatedAt };
    let before = await kaiTableRowCounts();
    const missingNotes = await decide({ ...base, decision: "supported_with_limitation" });
    assert.equal(missingNotes.ok, false);
    assert.equal(missingNotes.error.code, "validation_blocker");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});

    before = await kaiTableRowCounts();
    const limited = await decide({ ...base, decision: "supported_with_limitation", limitationNotes: [SYNTHETIC_LIMITATION_NOTE] });
    assert.equal(limited.ok, true, JSON.stringify(limited));
    assert.equal(limited.data.support_strength, "reviewed_supported");
    assert.equal(limited.data.evidence_review_status, "reviewed");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), DECISION_WRITE_DELTAS);
    const state = await evidenceState(ORG, b1);
    assert.deepEqual(state.decisions[0].limitation_notes, [SYNTHETIC_LIMITATION_NOTE]);

    const library = await readEvidenceLibrary(ORG, reviewer);
    assert.equal(JSON.stringify(library.items).includes(SYNTHETIC_LIMITATION_NOTE), false, "notes are never returned by the Evidence Library");
    const { pipeline, file: fileB } = await projectFile(PROJECT_B, projectB.intakeFileId);
    assert.equal(fileB.currentStage, "evidence_review", "one of two Project B items reviewed: still waiting");
    assert.equal(JSON.stringify(pipeline.data).includes(SYNTHETIC_LIMITATION_NOTE), false);

    const [{ count: claimCount }] = await query(
      "SELECT count(*)::int AS count FROM kai.claims WHERE evidence_item_id = ANY($1::uuid[])", [allReviewedIds]);
    assert.equal(claimCount, 0, "no decision created a claim");
    const [{ count: queueCount }] = await query(
      "SELECT count(*)::int AS count FROM kai.review_queue_items WHERE queue_type = 'evidence_review' AND target_object_id = ANY($1::uuid[])",
      [allReviewedIds]);
    assert.equal(queueCount, allReviewedIds.length, "still exactly one evidence_review item per evidence item");
    for (const evidenceItemId of org2.evidenceItemIds) {
      const org2State = await evidenceState(ORG_2, evidenceItemId);
      assert.deepEqual(org2State.decisions, [], "Organization 2 evidence was never reviewed");
      assert.equal(org2State.evidence.evidence_review_status, "needs_gk_review");
    }
  });

  // Runs last: it deliberately breaks the runner-owned throwaway database.
  test("ambiguous lineage: two current evidence-review decision heads fail the Evidence Library read closed (for every reader) and P2-12 refuses the item; nothing is mutated", async () => {
    const [, b2] = projectB.evidenceItemIds;
    const [discovered] = (await readEvidenceLibrary(ORG, reviewer)).items.filter((item) => item.evidenceItemId === b2);
    assert.equal(discovered.evidenceReview.currentDecisionOutcome, null);
    // The ledger's own root-per-lineage unique index makes two heads
    // unrepresentable, so the synthetic malformed state needs it dropped in
    // this runner-owned database only (never a migration). The two rows are a
    // fixture; no product code writes or repairs them.
    await query("DROP INDEX kai.ux_evidence_review_decisions_p2_12_root_per_lineage");
    for (const outcome of ["supported", "not_supported"]) {
      await query(
        `INSERT INTO kai.evidence_review_decisions (organization_id, evidence_item_id, review_queue_item_id, decision_outcome,
           decided_by, decided_by_role, target_updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, 'gk_reviewer', $6::timestamptz)`,
        [ORG, b2, discovered.evidenceReview.reviewQueueItemId, outcome, userIds.reviewer, discovered.evidenceReview.expectedUpdatedAt],
      );
    }
    const [{ count: heads }] = await query(
      `SELECT count(*)::int AS count FROM kai.evidence_review_decisions d
        WHERE d.evidence_item_id = $1::uuid
          AND NOT EXISTS (SELECT 1 FROM kai.evidence_review_decisions s WHERE s.supersedes_decision_id = d.decision_id)`, [b2]);
    assert.equal(heads, 2, "synthetic ambiguous lineage: two unsuperseded heads");

    const before = await kaiTableRowCounts();
    const snapshot = JSON.stringify(await evidenceState(ORG, b2));
    for (const [label, actorContext] of [["gk_reviewer", reviewer], ["gk_operator", actor("operator", ORG, "gk_operator")]]) {
      const read = await listOrganizationEvidenceLibrary({ organizationId: ORG, limit: 25, afterEvidenceItemId: null, actorContext }, { env: ENV });
      assert.equal(read.ok, false, `${label}: the read never chooses one head`);
      assert.equal(read.error.code, "system_error");
      const serialized = JSON.stringify(read);
      assert.equal(serialized.includes(b2), false, "no evidence id from the ambiguous read");
      assert.equal(serialized.includes(discovered.evidenceReview.reviewQueueItemId), false, "no P2-12 write coordinates from the ambiguous read");
      for (const outcome of ["supported", "not_supported"]) assert.equal(serialized.includes(`"${outcome}"`), false);
    }
    const refused = await decide({
      evidenceItemId: b2,
      reviewQueueItemId: discovered.evidenceReview.reviewQueueItemId,
      expectedUpdatedAt: discovered.evidenceReview.expectedUpdatedAt,
      decision: "supported",
    });
    assert.equal(refused.ok, false, "P2-12 itself refuses ambiguous lineage");
    assert.equal(refused.error.code, "system_error");
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {}, "nothing was written or repaired");
    assert.equal(JSON.stringify(await evidenceState(ORG, b2)), snapshot, "the evidence item, queue item, and malformed decisions are untouched");
  });
}
