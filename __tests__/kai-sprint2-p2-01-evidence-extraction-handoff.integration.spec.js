import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_P2_01_EVIDENCE_EXTRACTION_HANDOFF_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const host = new URL(urlString).hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`P2-01 handoff integration suite refused a non-loopback KAI_P2_01_EVIDENCE_EXTRACTION_HANDOFF_DATABASE_URL host: ${host}`);
  }
}

test("P2-01 handoff integration isolation: a non-loopback runner URL is refused", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
});

test("the assembled proof never invokes P2-01 itself: it imports no evidence-lineage seam", () => {
  const source = readFileSync(new URL(import.meta.url), "utf8");
  const importLines = source.split("\n").filter((line) => /\bimport\b/.test(line));
  for (const line of importLines) {
    assert.doesNotMatch(line, /kaiEvidenceLineageService|postgresEvidenceLineageRepository|evidence-extraction/);
  }
  assert.equal(source.includes(["extractEvidence", "FromSourceVersion"].join("")), false, "the P2-01 service name never appears in this file");
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("P2-01 evidence-extraction handoff integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runHandoffIntegrationSuite();
}

/**
 * KAI P1-08 -> P2-01 handoff, against real PostgreSQL: a fresh synthetic lineage
 * is advanced through the real P1-06 review work, the real cockpit sensitivity
 * decision, and its real P1-07 handoff to a reviewable source candidate. Then ONE
 * real cockpit P1-08 promotion is performed, and every downstream object is read
 * back. This file never calls the P2-01 service or route: every source_locator,
 * evidence_item, and evidence_review queue item observed here was created by the
 * cockpit's post-promotion handoff, through the default production repositories
 * and audit composition (the runner points the ambient pool at its cluster).
 */
async function runHandoffIntegrationSuite() {
  const { Pool } = await import("pg");
  const { findOrCreateKaiUserByLegacyPublicUserdataId } = await import("../Backend/kai/db/kaiQueries.js");
  const { ensureSensitivityReviewQueueItem } = await import("../Backend/kai/services/kaiReviewQueueService.js");
  const {
    submitSensitivityProfileDecision,
    submitSourceCandidateDecision,
    getReviewCockpitSourceCandidateDetail,
  } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const { getClientEvidencePipeline } = await import("../Backend/kai/services/kaiClientEvidencePipelineService.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-0000000000f2";
  const BATCH = "10000000-0000-4000-8000-0000000000e1";
  const ENGAGEMENT = "7c000000-0000-4000-8000-0000000000e1";
  const NOW = "2026-09-26T10:00:00.000Z";
  const ENV = { KAI_SPRINT2_ENABLED: "true" };
  const FIELD_KEYS = ["households_served", "programme_month"];

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 4 });
  const query = async (sql, params = []) => (await pool.query(sql, params)).rows;

  test.after(async () => {
    await pool.end();
    const { default: ambientPool } = await import("../Backend/db/pg.js");
    await ambientPool.end().catch(() => {});
  });

  await query(`INSERT INTO kai.organizations (organization_id, name, organization_code) VALUES ($1::uuid, 'Harbourline Synthetic Society', 'harbourline-synthetic')
               ON CONFLICT (organization_id) DO NOTHING`, [ORG]);
  await query("INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code, project_metadata) VALUES ($1::uuid, $2::uuid, 'Project Handoff', '{}'::jsonb)",
    [ENGAGEMENT, ORG]);
  await query(`INSERT INTO kai.intake_batches (intake_batch_id, organization_id, engagement_id, batch_code, processing_status, review_status)
               VALUES ($1::uuid, $2::uuid, $3::uuid, 'handoff-intake-2026', 'received', 'not_reviewed')`, [BATCH, ORG, ENGAGEMENT]);

  const userIds = {};
  for (const [legacyId, role] of [[951, "gk_reviewer"], [952, "client_admin"]]) {
    await query("INSERT INTO public.userdata (id) VALUES ($1) ON CONFLICT DO NOTHING", [legacyId]);
    const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: legacyId, email: `user${legacyId}@harbourline.test` });
    userIds[role] = kaiUser.user_id;
    await query("INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1::uuid, $2::uuid, $3, 'active')",
      [ORG, kaiUser.user_id, role]);
  }
  const actor = (role, overrides = {}) => ({
    actorType: "human",
    actorUserId: userIds[role],
    source: "public.userdata",
    kaiRoles: role.startsWith("gk_") ? [role] : [],
    platformSuperuser: false,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }],
    ...overrides,
  });
  const reviewer = actor("gk_reviewer");
  const noAudit = () => ({ prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } });

  function fileId(index) {
    return `20000000-0000-4000-8000-0000000000e${index}`;
  }

  /**
   * P1-03..P1-05 fixture rows for one fresh confirmed file (the P1 worker's
   * output), with two committed dictionary fields. Everything from P1-06 on is
   * produced by real services.
   */
  async function seedFreshProfile(index) {
    const intakeFileId = fileId(index);
    const checksum = String(index).repeat(63) + "e";
    await query(
      `INSERT INTO kai.intake_files (intake_file_id, intake_batch_id, organization_id, engagement_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
         mime_type, file_size_bytes, malware_scan_status, review_status, file_policy_status, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $5, $6, 'sha256', 'confirmed', 'synthetic-v1', $6, 512, $7::timestamptz,
         'text/csv', 512, 'clean', 'not_reviewed', 'passed', $7::timestamptz)`,
      [intakeFileId, BATCH, ORG, ENGAGEMENT, `handoff-outcomes-${index}.csv`, checksum, NOW],
    );
    const [run] = await query(
      `INSERT INTO kai.intake_parser_runs (organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at)
       VALUES ($1::uuid, $2::uuid, 'kai_local_profiling_kernel', '1.0.0', $3, 'running', $4::timestamptz) RETURNING parser_run_id::text`,
      [ORG, intakeFileId, checksum, NOW],
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
      [ORG, intakeFileId, run.parser_run_id, checksum, JSON.stringify(profile), NOW],
    );
    await query(
      `UPDATE kai.intake_parser_runs SET parser_status = 'completed', completed_at = $2::timestamptz, output_profile_id = $3::uuid
        WHERE parser_run_id = $1::uuid`,
      [run.parser_run_id, NOW, fileProfile.file_profile_id],
    );
    const [dictionary] = await query(
      `INSERT INTO kai.data_dictionaries (organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz) RETURNING data_dictionary_id::text`,
      [ORG, intakeFileId, fileProfile.file_profile_id, fileProfile.profile_canonical_sha256, NOW],
    );
    for (const key of FIELD_KEYS) {
      await query(
        `INSERT INTO kai.data_dictionary_fields (data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, 'number', $5::timestamptz)`,
        [dictionary.data_dictionary_id, ORG, fileProfile.file_profile_id, key, NOW],
      );
    }
    const [sensitivity] = await query(
      `INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::timestamptz) RETURNING intake_sensitivity_profile_id::text`,
      [ORG, intakeFileId, fileProfile.file_profile_id, dictionary.data_dictionary_id, fileProfile.profile_canonical_sha256, NOW],
    );
    return { intakeFileId, intakeSensitivityProfileId: sensitivity.intake_sensitivity_profile_id };
  }

  /** Real P1-06 review work + real cockpit 'reviewed' decision + its real P1-07 handoff. */
  async function reachReviewableSourceCandidate(index) {
    const lineage = await seedFreshProfile(index);
    const ensured = await ensureSensitivityReviewQueueItem(
      { organizationId: ORG, intakeSensitivityProfileId: lineage.intakeSensitivityProfileId, actorContext: reviewer, now: new Date().toISOString() },
      { env: ENV, metadataOnlyAudit: noAudit() },
    );
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    const [item] = await query("SELECT updated_at FROM kai.review_queue_items WHERE review_queue_item_id = $1::uuid",
      [ensured.data.reviewQueueItem.review_queue_item_id]);
    const decided = await submitSensitivityProfileDecision({
      organizationId: ORG,
      intakeSensitivityProfileId: lineage.intakeSensitivityProfileId,
      actorContext: reviewer,
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
    assert.equal(decided.data.source_candidate_handoff.status, "created", JSON.stringify(decided.data.source_candidate_handoff));
    assert.equal(decided.data.source_candidate_handoff.candidate_status, "needs_gk_review");
    return { ...lineage, intakeSourceCandidateId: decided.data.source_candidate_handoff.intake_source_candidate_id };
  }

  function promote(intakeSourceCandidateId, actorContext = reviewer, organizationId = ORG) {
    return submitSourceCandidateDecision({
      organizationId,
      intakeSourceCandidateId,
      actorContext,
      payload: { outcome: "promoted", reviewed_source_type: "organization_primary_record" },
    }, { env: ENV });
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

  async function lineageState(intakeSourceCandidateId) {
    const versions = await query(
      `SELECT source_version_id::text, source_id::text, is_current, intake_source_candidate_id::text
         FROM kai.source_versions WHERE organization_id = $1::uuid AND intake_source_candidate_id = $2::uuid`,
      [ORG, intakeSourceCandidateId],
    );
    const versionIds = versions.map((row) => row.source_version_id);
    const evidence = await query(
      `SELECT evidence_item_id::text, source_id::text, source_version_id::text, source_locator_id::text, evidence_type, data_class,
              sensitivity_level, support_strength, evidence_review_status, internal_only, public_use_allowed, funder_use_allowed,
              llm_processing_allowed, created_by::text, created_by_type
         FROM kai.evidence_items WHERE organization_id = $1::uuid AND source_version_id = ANY($2::uuid[]) ORDER BY evidence_item_id`,
      [ORG, versionIds],
    );
    const locators = await query(
      `SELECT source_locator_id::text, locator_type FROM kai.source_locators
        WHERE organization_id = $1::uuid AND source_version_id = ANY($2::uuid[])`, [ORG, versionIds],
    );
    const queue = await query(
      `SELECT review_queue_item_id::text, target_object_id::text, queue_status, review_status FROM kai.review_queue_items
        WHERE organization_id = $1::uuid AND queue_type = 'evidence_review' AND target_object_type = 'evidence_item'
          AND target_object_id = ANY($2::uuid[])`,
      [ORG, evidence.map((row) => row.evidence_item_id)],
    );
    return { versions, evidence, locators, queue };
  }

  const NO_DOWNSTREAM_TABLES = ["claims", "evidence_review_decisions", "claim_review_decisions"];

  let promotedCase;

  test("A/E/H: ONE human P1-08 promotion creates the source, its current source_version, and - through the cockpit handoff alone - the P2-01 evidence and its evidence_review queue; the identical replay writes nothing", async () => {
    const lineage = await reachReviewableSourceCandidate(1);
    const [candidate] = await query(
      "SELECT candidate_status FROM kai.intake_source_candidates WHERE intake_source_candidate_id = $1::uuid", [lineage.intakeSourceCandidateId]);
    assert.equal(candidate.candidate_status, "needs_gk_review");
    assert.deepEqual((await lineageState(lineage.intakeSourceCandidateId)).versions, [], "no source_version before promotion");

    const before = await kaiTableRowCounts();
    for (const table of NO_DOWNSTREAM_TABLES) assert.ok(table in before, `kai.${table} exists in this schema`);
    const promoted = await promote(lineage.intakeSourceCandidateId);
    const after = await kaiTableRowCounts();
    assert.equal(promoted.ok, true, JSON.stringify(promoted));
    assert.equal(promoted.data.replayed, false);
    assert.equal(promoted.data.promotion_decision.decision_status, "promoted");
    const sourceVersionId = promoted.data.source_version.source_version_id;
    assert.equal(promoted.data.promotion_decision.source_version_id, sourceVersionId);
    assert.deepEqual(promoted.data.evidence_extraction_handoff, {
      status: "created",
      source_version_id: sourceVersionId,
      evidence_item_count: FIELD_KEYS.length,
      review_queue_item_count: FIELD_KEYS.length,
      error_code: null,
    });

    const changed = deltas(before, after);
    console.log(`[p2-01-handoff] candidate ${lineage.intakeSourceCandidateId} first-promotion deltas ${JSON.stringify(changed)}`);
    assert.deepEqual(changed, {
      audit_events: 2,
      evidence_items: FIELD_KEYS.length,
      intake_promotion_decisions: 1,
      review_queue_items: FIELD_KEYS.length,
      source_locators: FIELD_KEYS.length,
      source_versions: 1,
      sources: 1,
      upload_lifecycle_audit: 2,
    });
    for (const table of NO_DOWNSTREAM_TABLES) assert.equal(after[table], before[table], `kai.${table} +0`);

    const state = await lineageState(lineage.intakeSourceCandidateId);
    assert.equal(state.versions.length, 1);
    assert.deepEqual(state.versions[0], {
      source_version_id: sourceVersionId,
      source_id: promoted.data.source.source_id,
      is_current: true,
      intake_source_candidate_id: lineage.intakeSourceCandidateId,
    });
    const [decisionRow] = await query(
      `SELECT decision_status, source_id::text, source_version_id::text, created_by::text, created_by_type
         FROM kai.intake_promotion_decisions WHERE intake_source_candidate_id = $1::uuid`, [lineage.intakeSourceCandidateId]);
    assert.deepEqual(decisionRow, {
      decision_status: "promoted", source_id: promoted.data.source.source_id, source_version_id: sourceVersionId,
      created_by: userIds.gk_reviewer, created_by_type: "human",
    });
    assert.equal(state.evidence.length, FIELD_KEYS.length);
    assert.equal(state.locators.length, FIELD_KEYS.length);
    assert.equal(state.queue.length, FIELD_KEYS.length);
    const locatorIds = new Set(state.locators.map((row) => row.source_locator_id));
    for (const row of state.evidence) {
      assert.equal(row.source_id, promoted.data.source.source_id);
      assert.equal(row.source_version_id, sourceVersionId);
      assert.ok(locatorIds.has(row.source_locator_id), "one locator per evidence lineage coordinate");
      assert.equal(row.evidence_type, "dictionary_field_presence_fact");
      assert.equal(row.data_class, "organization_committed_metadata");
      assert.equal(row.sensitivity_level, "unknown");
      assert.equal(row.support_strength, "unassessed");
      assert.equal(row.evidence_review_status, "needs_gk_review");
      assert.equal(row.internal_only, true);
      assert.equal(row.public_use_allowed, false);
      assert.equal(row.funder_use_allowed, false);
      assert.equal(row.llm_processing_allowed, false);
      assert.equal(row.created_by, userIds.gk_reviewer, "created by the same human who promoted");
      assert.equal(row.created_by_type, "human");
    }
    for (const row of state.locators) assert.equal(row.locator_type, "column");
    for (const row of state.queue) {
      assert.equal(row.queue_status, "open");
      assert.equal(row.review_status, "needs_gk_review");
    }
    assert.deepEqual(new Set(state.queue.map((row) => row.target_object_id)), new Set(state.evidence.map((row) => row.evidence_item_id)));

    // The P2-01 extraction audit was written by the handoff's production adapter.
    const audits = await query(
      "SELECT action, actor_type, actor_user_id::text FROM kai.audit_events WHERE metadata->>'object_id' = $1", [sourceVersionId]);
    assert.deepEqual(audits, [{ action: "evidence_lineage_extracted", actor_type: "human", actor_user_id: userIds.gk_reviewer }]);

    // E: the identical replay.
    const replay = await promote(lineage.intakeSourceCandidateId);
    const afterReplay = await kaiTableRowCounts();
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.source.source_id, promoted.data.source.source_id);
    assert.equal(replay.data.source_version.source_version_id, sourceVersionId);
    assert.deepEqual(replay.data.evidence_extraction_handoff, {
      status: "replayed",
      source_version_id: sourceVersionId,
      evidence_item_count: FIELD_KEYS.length,
      review_queue_item_count: FIELD_KEYS.length,
      error_code: null,
    });
    assert.deepEqual(deltas(after, afterReplay), {}, "the identical replay writes nothing anywhere");
    assert.deepEqual(await lineageState(lineage.intakeSourceCandidateId), state);

    // The GK candidate detail reads the promoted source/source_version.
    const detail = await getReviewCockpitSourceCandidateDetail(
      { organizationId: ORG, intakeSourceCandidateId: lineage.intakeSourceCandidateId, actorContext: reviewer }, { env: ENV });
    assert.equal(detail.ok, true, JSON.stringify(detail));
    assert.equal(detail.data.source_version.source_version_id, sourceVersionId);
    assert.equal(detail.data.source_version.is_current, true);

    // H: the client Project pipeline advances to GK evidence review, with no
    // reviewed Impact Fact.
    const pipeline = await getClientEvidencePipeline(
      { organizationId: ORG, engagementId: ENGAGEMENT, actorContext: actor("client_admin") }, { env: ENV });
    assert.equal(pipeline.ok, true, JSON.stringify(pipeline));
    const file = pipeline.data.files.find((entry) => entry.intakeFileId === lineage.intakeFileId);
    assert.ok(file, "the fresh file is in its Project pipeline");
    console.log(`[p2-01-handoff] client pipeline file ${JSON.stringify({ currentStage: file.currentStage, currentStatus: file.currentStatus, reason: file.reason, evidenceItemCount: file.evidenceItemCount })}`);
    assert.equal(file.currentStage, "evidence_review");
    assert.equal(file.currentStatus, "waiting_for_get_kinder");
    assert.equal(file.reason, "evidence_awaiting_review");
    assert.equal(file.evidenceItemCount, FIELD_KEYS.length);
    assert.equal(file.reviewedImpactFactCount, 0);
    assert.deepEqual(pipeline.data.reviewedImpactFacts, []);
    const serialized = JSON.stringify(pipeline.data);
    for (const hidden of [sourceVersionId, promoted.data.source.source_id, ...state.evidence.map((row) => row.evidence_item_id), "dictionary_field_presence_fact", userIds.gk_reviewer]) {
      assert.ok(!serialized.includes(hidden), `client DTO hides ${hidden}`);
    }
    promotedCase = { lineage, sourceVersionId };
  });

  test("B: needs_more_information and then rejected decisions create no source, source_version, or evidence", async () => {
    const lineage = await reachReviewableSourceCandidate(2);
    const before = await kaiTableRowCounts();
    for (const payload of [{ outcome: "needs_more_information" }, { outcome: "rejected" }]) {
      const result = await submitSourceCandidateDecision(
        { organizationId: ORG, intakeSourceCandidateId: lineage.intakeSourceCandidateId, actorContext: reviewer, payload }, { env: ENV });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.evidence_extraction_handoff.status, "not_applicable", payload.outcome);
    }
    const after = await kaiTableRowCounts();
    for (const table of ["sources", "source_versions", "source_locators", "evidence_items", ...NO_DOWNSTREAM_TABLES]) {
      assert.equal(after[table], before[table], `kai.${table} +0`);
    }
    assert.equal(after.intake_promotion_decisions - before.intake_promotion_decisions, 1);
  });

  test("D: a P2-01 failure after a committed promotion leaves the promotion, source, and source_version committed, reports not_created, and the identical replay recovers", async () => {
    const lineage = await reachReviewableSourceCandidate(3);
    // Throwaway-cluster-only fault injection: every evidence insert raises, so
    // P2-01's own transaction rolls back after P1-08 has committed.
    await query(`CREATE FUNCTION kai.p2_01_handoff_test_fail_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
                 BEGIN RAISE EXCEPTION 'synthetic P2-01 fault'; END $$`);
    await query(`CREATE TRIGGER p2_01_handoff_test_fail_evidence BEFORE INSERT ON kai.evidence_items
                 FOR EACH ROW EXECUTE FUNCTION kai.p2_01_handoff_test_fail_evidence()`);
    let failed;
    let before;
    let afterFailure;
    try {
      before = await kaiTableRowCounts();
      failed = await promote(lineage.intakeSourceCandidateId);
      afterFailure = await kaiTableRowCounts();
    } finally {
      await query("DROP TRIGGER p2_01_handoff_test_fail_evidence ON kai.evidence_items");
      await query("DROP FUNCTION kai.p2_01_handoff_test_fail_evidence()");
    }
    assert.equal(failed.ok, true, JSON.stringify(failed));
    assert.equal(failed.data.promotion_decision.decision_status, "promoted");
    const sourceVersionId = failed.data.source_version.source_version_id;
    assert.deepEqual(failed.data.evidence_extraction_handoff, {
      status: "not_created",
      source_version_id: sourceVersionId,
      evidence_item_count: null,
      review_queue_item_count: null,
      error_code: "validation_blocker",
    });
    assert.ok(!JSON.stringify(failed).includes("synthetic P2-01 fault"), "the raw database message is never returned");
    const failureDeltas = deltas(before, afterFailure);
    assert.deepEqual(failureDeltas, {
      audit_events: 1, intake_promotion_decisions: 1, source_versions: 1, sources: 1, upload_lifecycle_audit: 1,
    }, "only the committed P1-08 promotion remains");
    const [version] = (await lineageState(lineage.intakeSourceCandidateId)).versions;
    assert.equal(version.is_current, true);

    const recovered = await promote(lineage.intakeSourceCandidateId);
    const afterRecovery = await kaiTableRowCounts();
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(recovered.data.replayed, true, "P1-08 replays with no new decision");
    assert.equal(recovered.data.evidence_extraction_handoff.status, "created");
    assert.deepEqual(deltas(afterFailure, afterRecovery), {
      audit_events: 1,
      evidence_items: FIELD_KEYS.length,
      review_queue_items: FIELD_KEYS.length,
      source_locators: FIELD_KEYS.length,
      upload_lifecycle_audit: 1,
    });
  });

  test("F: a stale (non-current) source_version is never used by the handoff, and a cross-organization request writes nothing", async () => {
    assert.ok(promotedCase, "depends on the A/E/H promotion");
    const { lineage, sourceVersionId } = promotedCase;
    await query("UPDATE kai.source_versions SET is_current = false WHERE source_version_id = $1::uuid", [sourceVersionId]);
    try {
      const before = await kaiTableRowCounts();
      const replay = await promote(lineage.intakeSourceCandidateId);
      assert.equal(replay.ok, true, JSON.stringify(replay));
      assert.deepEqual(replay.data.evidence_extraction_handoff, {
        status: "not_created",
        source_version_id: sourceVersionId,
        evidence_item_count: null,
        review_queue_item_count: null,
        error_code: "conflict_current_state_changed",
      });
      assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
    } finally {
      await query("UPDATE kai.source_versions SET is_current = true WHERE source_version_id = $1::uuid", [sourceVersionId]);
    }

    const before = await kaiTableRowCounts();
    const foreign = await promote(lineage.intakeSourceCandidateId, reviewer, OTHER_ORG);
    assert.equal(foreign.ok, false);
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});
  });

  test("G: client, system, AI, and cross-organization actors cannot promote or reach the handoff; nothing is written", async () => {
    const lineage = await reachReviewableSourceCandidate(4);
    const before = await kaiTableRowCounts();
    for (const [label, actorContext] of [
      ["client_admin", actor("client_admin")],
      ["client_admin claiming a GK global role", actor("client_admin", { kaiRoles: [] })],
      ["system actor", { ...reviewer, actorType: "system" }],
      ["AI actor", { ...reviewer, actorType: "ai" }],
      ["cross-organization GK", { ...reviewer, organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_reviewer" }] }],
    ]) {
      const result = await promote(lineage.intakeSourceCandidateId, actorContext);
      assert.equal(result.ok, false, label);
    }
    assert.deepEqual(deltas(before, await kaiTableRowCounts()), {});

    const promoted = await promote(lineage.intakeSourceCandidateId);
    assert.equal(promoted.ok, true, JSON.stringify(promoted));
    assert.equal(promoted.data.evidence_extraction_handoff.status, "created");
  });
}
