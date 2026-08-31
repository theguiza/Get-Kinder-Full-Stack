import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_B1A_02_PHASE5_ALLOWED_USE_DECISION_LEDGER_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`B1A-2 integration suite refused a non-loopback KAI_B1A_02_PHASE5_ALLOWED_USE_DECISION_LEDGER_DATABASE_URL host: ${host}`);
  }
}

test("B1A-2 PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

test("B1A-2 PostgreSQL isolation: this file imports no database module at top level", () => {
  const ownSource = readFileSync(new URL(import.meta.url), "utf8");
  const topLevelImports = ownSource.split("\n").filter((line) => /^import\b/.test(line));
  assert.ok(topLevelImports.every((line) => !/"pg"|kaiDb\.js|postgresSensitivityAllowedUse/.test(line)));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("B1A-2 phase-5 decision-ledger integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runB1A02IntegrationSuite();
}

// NOTE ON FIXTURE BUDGET: the P1-05/P1-06 synthetic smoke seeds commit exactly two
// sensitivity profiles for ORG (sensitivity1 = 8...001, sensitivity2 = 8...002), both
// with every P1-05 column at its pinned fail-closed value. sensitivity1 carries the
// full decision-lineage narrative (root -> successor -> restrictive successor);
// sensitivity2 is reserved for the scenarios that must start from a pristine
// no-decision state.
async function runB1A02IntegrationSuite() {
  const { Pool } = await import("pg");
  const { createPostgresReviewQueueRepository } = await import("../Backend/kai/dictionary/postgresReviewQueueRepository.js");
  const { createPostgresSensitivityAllowedUseReviewRepository } = await import("../Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js");
  const { recordSensitivityAllowedUseDecision } = await import("../Backend/kai/services/kaiSensitivityAllowedUseReviewService.js");
  const { getReviewCockpitSensitivityProfileDetail, submitSensitivityProfileDecision } = await import("../Backend/kai/services/kaiReviewCockpitService.js");
  const {
    getReviewCockpitSensitivityProfileRecord,
    getReviewCockpitSensitivityDecisionRecord,
  } = await import("../Backend/kai/db/kaiReviewCockpitReadModels.js");
  const { sensitivityAuthorityFromCurrentDecision } = await import("../Backend/kai/dictionary/sensitivityAllowedUseDecisionContract.js");
  const { __sourceCandidateRepositoryTestables } = await import("../Backend/kai/dictionary/postgresSourceCandidateRepository.js");
  const { __sourcePromotionRepositoryTestables } = await import("../Backend/kai/dictionary/postgresSourcePromotionRepository.js");

  const ORG = "00000000-0000-4000-8000-000000000001";
  const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
  const SENSITIVITY_1 = "80000000-0000-4000-8000-000000000001";
  const SENSITIVITY_2 = "80000000-0000-4000-8000-000000000002";
  const REVIEWER = "90000000-0000-4000-8000-000000000001";
  const NOW = "2026-08-31T10:00:00.000Z";
  const T1 = "2026-08-31T10:05:00.000Z";
  const T2 = "2026-08-31T10:10:00.000Z";
  const T3 = "2026-08-31T10:15:00.000Z";
  const T4 = "2026-08-31T10:20:00.000Z";
  const ENV = { KAI_SPRINT2_ENABLED: "true" };

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 10 });

  async function withRunnerOwnedTransaction(callback) {
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

  async function query(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }

  test.after(async () => {
    await pool.end();
  });

  const reviewerActor = {
    actorType: "human",
    actorUserId: REVIEWER,
    kaiRoles: ["gk_reviewer"],
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };
  const unauthorizedActor = {
    actorType: "human",
    actorUserId: "90000000-0000-4000-8000-000000000002",
    kaiRoles: [],
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_viewer" }],
  };
  const systemActor = {
    actorType: "system",
    actorUserId: REVIEWER,
    kaiRoles: ["gk_reviewer"],
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" }],
  };
  const assistantActor = { ...systemActor, actorType: "assistant" };

  function auditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: true, async publish() {} }; } };
  }
  function rejectingAuditRecorder() {
    return { prepareMetadataOnlyAudit() { return { ok: false }; } };
  }
  function failingPublishAuditRecorder() {
    return {
      prepareMetadataOnlyAudit() {
        return { ok: true, async publish() { throw new Error("synthetic audit publish failure"); } };
      },
    };
  }

  const reviewQueueRepository = createPostgresReviewQueueRepository({ runInTransaction: withRunnerOwnedTransaction });
  const decisionRepository = createPostgresSensitivityAllowedUseReviewRepository({
    runInTransaction: withRunnerOwnedTransaction,
  });

  function internalOnlySnapshot(overrides = {}) {
    return {
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
      ...overrides,
    };
  }

  async function ensureQueueItem(intakeSensitivityProfileId) {
    const result = await reviewQueueRepository.createSensitivityReviewQueueItem({
      identity: { organizationId: ORG, intakeSensitivityProfileId },
      actorUserId: REVIEWER,
      now: NOW,
      metadataOnlyAudit: auditRecorder(),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.data.reviewQueueItem.review_queue_item_id;
  }

  async function queueRow(intakeSensitivityProfileId) {
    const rows = await query(
      `SELECT review_queue_item_id::text AS review_queue_item_id, queue_status, review_status, updated_at
         FROM kai.review_queue_items
        WHERE organization_id = $1::uuid
          AND queue_type = 'sensitivity_review'
          AND target_object_type = 'intake_sensitivity_profile'
          AND target_object_id = $2::uuid`,
      [ORG, intakeSensitivityProfileId],
    );
    return rows[0];
  }

  async function decide(intakeSensitivityProfileId, overrides = {}, dependencyOverrides = {}) {
    const item = await queueRow(intakeSensitivityProfileId);
    return recordSensitivityAllowedUseDecision(
      {
        organizationId: ORG,
        intakeSensitivityProfileId,
        reviewQueueItemId: item.review_queue_item_id,
        expectedUpdatedAt: new Date(item.updated_at).toISOString(),
        decision: "needs_more_information",
        actorContext: reviewerActor,
        now: NOW,
        ...overrides,
      },
      {
        env: ENV,
        sensitivityAllowedUseReviewRepository: decisionRepository,
        metadataOnlyAudit: auditRecorder(),
        ...dependencyOverrides,
      },
    );
  }

  async function decisionRows(intakeSensitivityProfileId) {
    return query(
      `SELECT decision_id::text AS decision_id, decision_outcome, supersedes_decision_id::text AS supersedes_decision_id,
              reviewed_funder_use_allowed, reviewed_public_use_allowed, reviewed_llm_processing_allowed,
              reviewed_product_learning_allowed, reviewed_allowed_use_status, reviewed_consent_basis_status,
              reviewed_indigenous_governance_status, created_by_type, decided_by_role, created_at
         FROM kai.intake_sensitivity_review_decisions
        WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid
        ORDER BY created_at, decision_id`,
      [ORG, intakeSensitivityProfileId],
    );
  }

  async function currentHead(intakeSensitivityProfileId) {
    const record = await getReviewCockpitSensitivityDecisionRecord(ORG, intakeSensitivityProfileId, pool);
    assert.equal(record.lineageAmbiguous, false);
    return record.currentDecision;
  }

  async function pinnedProfileRow(intakeSensitivityProfileId) {
    const rows = await query(
      `SELECT human_review_required, public_use_allowed, funder_use_allowed, llm_processing_allowed,
              product_learning_allowed, retention_posture, pii_status, minor_data_status,
              health_housing_justice_immigration_status, indigenous_governance_status, staff_notes_status,
              story_testimonial_status, small_cell_risk_status, financial_records_status,
              consent_basis_status, allowed_use_status
         FROM kai.intake_sensitivity_profiles
        WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = $2::uuid`,
      [ORG, intakeSensitivityProfileId],
    );
    return rows[0];
  }

  /**
   * Whole-schema row-count snapshot: proves this package writes ONLY to its own
   * ledger, the one bound sensitivity_review queue row, and the two audit tables -
   * never to a claim, evidence, generated-content, export, source, promotion, or
   * release-authority table (all of which exist in this runner's schema).
   */
  async function schemaRowCounts() {
    const tables = await query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'kai' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    const counts = {};
    for (const { table_name: tableName } of tables) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await query(`SELECT count(*)::int AS count FROM kai.${tableName}`);
      counts[tableName] = rows[0].count;
    }
    return counts;
  }

  function changedTables(before, after) {
    return Object.keys(after).filter((table) => before[table] !== after[table]).sort();
  }

  test("B1A-2 (1)(2) no decision head means no authority, and a resolved queue alone cannot manufacture one", async () => {
    const queueItemId = await ensureQueueItem(SENSITIVITY_1);
    assert.ok(queueItemId);

    assert.equal(await currentHead(SENSITIVITY_1), null);
    assert.deepEqual({ ...sensitivityAuthorityFromCurrentDecision(await currentHead(SENSITIVITY_1)) }, {
      review_complete: false,
      llm_processing_allowed: false,
      product_learning_allowed: false,
      public_use_allowed: false,
      funder_use_allowed: false,
    });

    // Simulate the legacy pre-B1A-2 world: the queue item is marked resolved with NO
    // decision row anywhere. A queue status is not an authority record.
    await query(
      `UPDATE kai.review_queue_items SET queue_status = 'resolved', review_status = 'resolved'
        WHERE review_queue_item_id = $1::uuid`,
      [queueItemId],
    );
    const resolvedQueue = await queueRow(SENSITIVITY_1);
    assert.equal(resolvedQueue.queue_status, "resolved");
    assert.equal(await currentHead(SENSITIVITY_1), null);
    assert.equal(
      sensitivityAuthorityFromCurrentDecision(await currentHead(SENSITIVITY_1)).review_complete,
      false,
    );
    assert.equal((await decisionRows(SENSITIVITY_1)).length, 0);

    // Return the item to its fresh state for the scenarios below.
    await query(
      `UPDATE kai.review_queue_items SET queue_status = 'open', review_status = 'needs_gk_review'
        WHERE review_queue_item_id = $1::uuid`,
      [queueItemId],
    );
  });

  test("B1A-2 (3)(17)(18)(19)(20)(21) an authorized human records reviewed internal-only state; only this package's own rows change and every P1-05/P1-07/P1-08 fact is untouched", async () => {
    const beforeProfile = await pinnedProfileRow(SENSITIVITY_1);
    const beforeCounts = await schemaRowCounts();

    const result = await decide(SENSITIVITY_1, {
      decision: "reviewed",
      reviewedSnapshot: internalOnlySnapshot(),
      now: T1,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.decision.decision_outcome, "reviewed");
    assert.equal(result.data.decision.supersedes_decision_id, null);
    assert.equal(result.data.decision.created_by_type, "human");
    assert.equal(result.data.decision.decided_by_role, "gk_reviewer");
    assert.equal(result.data.replayed, false);
    // A reviewed decision with every permissive boolean false is a complete,
    // legitimate classification - reviewed never implies permitted.
    assert.equal(result.data.decision.reviewed_public_use_allowed, false);
    assert.equal(result.data.decision.reviewed_funder_use_allowed, false);
    assert.equal(result.data.decision.reviewed_llm_processing_allowed, false);
    assert.equal(result.data.decision.reviewed_product_learning_allowed, false);
    const recordedAuthority = sensitivityAuthorityFromCurrentDecision(result.data.decision);
    assert.equal(recordedAuthority.review_complete, true);
    assert.equal(recordedAuthority.funder_use_allowed, false);
    // 'unknown' is preserved exactly, never upgraded.
    assert.equal(result.data.decision.reviewed_indigenous_governance_status, "unknown");
    assert.equal(result.data.decision.reviewed_allowed_use_status, "unknown");
    // The terminal decision resolved the sensitivity_review queue item.
    assert.equal(result.data.reviewQueueItem.queue_status, "resolved");
    assert.equal(result.data.reviewQueueItem.review_status, "resolved");

    // (17) every pinned P1-05 column is byte-for-byte unchanged.
    assert.deepEqual(await pinnedProfileRow(SENSITIVITY_1), beforeProfile);
    assert.equal(beforeProfile.human_review_required, true);
    assert.equal(beforeProfile.public_use_allowed, false);
    assert.equal(beforeProfile.funder_use_allowed, false);
    assert.equal(beforeProfile.llm_processing_allowed, false);
    assert.equal(beforeProfile.product_learning_allowed, false);
    assert.equal(beforeProfile.retention_posture, "restricted_pending_review");

    // (18)(19) the P1-07 and P1-08 predicates still evaluate exactly as before
    // against the same, unchanged profile row.
    const predicateRow = {
      human_review_required: beforeProfile.human_review_required,
      public_use_allowed: beforeProfile.public_use_allowed,
      funder_use_allowed: beforeProfile.funder_use_allowed,
      llm_processing_allowed: beforeProfile.llm_processing_allowed,
      product_learning_allowed: beforeProfile.product_learning_allowed,
      retention_posture: beforeProfile.retention_posture,
    };
    assert.equal(__sourceCandidateRepositoryTestables.satisfiesCreationTriggerPredicate(predicateRow), true);
    assert.equal(__sourcePromotionRepositoryTestables.satisfiesPermissionPredicate(predicateRow), true);

    // (20)(21) only this package's ledger, the bound queue row, and the audit
    // tables changed. No claim, evidence, source, promotion, generated-content,
    // export, or release authority row was created anywhere.
    const afterCounts = await schemaRowCounts();
    const changed = changedTables(beforeCounts, afterCounts);
    assert.deepEqual(changed, ["intake_sensitivity_review_decisions", "upload_lifecycle_audit"]);
    assert.equal(
      afterCounts.intake_sensitivity_review_decisions - beforeCounts.intake_sensitivity_review_decisions,
      1,
    );
    for (const table of Object.keys(afterCounts)) {
      if (changed.includes(table)) continue;
      assert.equal(afterCounts[table], beforeCounts[table], `kai.${table} must not have been written`);
    }
  });

  test("B1A-2 (7)(8)(4) a re-review appends a successor; only the head is current, and explicit reviewed funder permission is representable", async () => {
    const rootRows = await decisionRows(SENSITIVITY_1);
    assert.equal(rootRows.length, 1);
    const rootDecisionId = rootRows[0].decision_id;

    const funderResult = await decide(SENSITIVITY_1, {
      decision: "reviewed",
      reviewedSnapshot: internalOnlySnapshot({
        reviewed_allowed_use_status: "allowed",
        reviewed_funder_use_allowed: true,
      }),
      now: T2,
    });
    assert.equal(funderResult.ok, true, JSON.stringify(funderResult));
    assert.equal(funderResult.data.decision.supersedes_decision_id, rootDecisionId);
    assert.equal(funderResult.data.decision.reviewed_funder_use_allowed, true);
    const funderAuthority = sensitivityAuthorityFromCurrentDecision(funderResult.data.decision);
    assert.equal(funderAuthority.funder_use_allowed, true);
    // Funder-use permission is not, and never becomes, export/release authority:
    // nothing else in this result or ledger grants one.
    assert.equal(funderAuthority.public_use_allowed, false);

    const rows = await decisionRows(SENSITIVITY_1);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].decision_id, rootDecisionId);
    assert.equal(rows[1].supersedes_decision_id, rootDecisionId);

    // (8) the superseded root is never returned as current.
    const head = await currentHead(SENSITIVITY_1);
    assert.equal(head.decision_id, funderResult.data.decision.decision_id);
    assert.notEqual(head.decision_id, rootDecisionId);

    // Append-only proof: the superseded row is still present and immutable.
    await assert.rejects(
      query(
        `UPDATE kai.intake_sensitivity_review_decisions SET decision_outcome = 'needs_more_information'
          WHERE decision_id = $1::uuid`,
        [rootDecisionId],
      ),
      /append-only/,
    );
    await assert.rejects(
      query(`DELETE FROM kai.intake_sensitivity_review_decisions WHERE decision_id = $1::uuid`, [rootDecisionId]),
      /append-only/,
    );
  });

  test("B1A-2 (9) a restrictive successor removes the previously recorded permissive authority", async () => {
    const before = await currentHead(SENSITIVITY_1);
    assert.equal(before.reviewed_funder_use_allowed, true);

    const restrictive = await decide(SENSITIVITY_1, {
      decision: "reviewed",
      reviewedSnapshot: internalOnlySnapshot({ reviewed_allowed_use_status: "not_allowed" }),
      now: T3,
    });
    assert.equal(restrictive.ok, true, JSON.stringify(restrictive));
    assert.equal(restrictive.data.decision.supersedes_decision_id, before.decision_id);

    const head = await currentHead(SENSITIVITY_1);
    assert.equal(head.decision_id, restrictive.data.decision.decision_id);
    assert.equal(head.reviewed_funder_use_allowed, false);
    assert.deepEqual({ ...sensitivityAuthorityFromCurrentDecision(head) }, {
      review_complete: true,
      llm_processing_allowed: false,
      product_learning_allowed: false,
      public_use_allowed: false,
      funder_use_allowed: false,
    });
  });

  test("B1A-2 (6) needs_more_information grants no new authority and leaves the review active", async () => {
    const priorHead = await currentHead(SENSITIVITY_1);
    const result = await decide(SENSITIVITY_1, { decision: "needs_more_information", now: T4 });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.data.decision.decision_outcome, "needs_more_information");
    assert.equal(result.data.decision.supersedes_decision_id, priorHead.decision_id);
    // The review is active again (never resolved) ...
    assert.equal(result.data.reviewQueueItem.queue_status, "open");
    assert.equal(result.data.reviewQueueItem.review_status, "needs_gk_review");
    // ... and every reviewed field is NULL, so no permission can be read back.
    for (const [key, value] of Object.entries(result.data.decision)) {
      if (!key.startsWith("reviewed_")) continue;
      assert.equal(value, null, `${key} must be null on a needs_more_information decision`);
    }
    assert.deepEqual({ ...sensitivityAuthorityFromCurrentDecision(await currentHead(SENSITIVITY_1)) }, {
      review_complete: false,
      llm_processing_allowed: false,
      product_learning_allowed: false,
      public_use_allowed: false,
      funder_use_allowed: false,
    });
  });

  test("B1A-2 (5) public permission fails closed when the submitted facts cannot establish the required basis, and persists nothing", async () => {
    const beforeRows = await decisionRows(SENSITIVITY_1);
    const beforeQueue = await queueRow(SENSITIVITY_1);

    for (const snapshot of [
      internalOnlySnapshot({ reviewed_allowed_use_status: "allowed", reviewed_public_use_allowed: true }),
      internalOnlySnapshot({
        reviewed_allowed_use_status: "allowed",
        reviewed_consent_basis_status: "absent",
        reviewed_public_use_allowed: true,
      }),
      internalOnlySnapshot({
        reviewed_allowed_use_status: "unknown",
        reviewed_consent_basis_status: "present",
        reviewed_public_use_allowed: true,
      }),
      // Allowed-use allowed and consent present are not enough on their own:
      // an Indigenous/governance-sensitive status of "present" or "unknown"
      // must independently fail closed even when the other two conditions
      // are met.
      internalOnlySnapshot({
        reviewed_allowed_use_status: "allowed",
        reviewed_consent_basis_status: "present",
        reviewed_indigenous_governance_status: "present",
        reviewed_public_use_allowed: true,
      }),
      internalOnlySnapshot({
        reviewed_allowed_use_status: "allowed",
        reviewed_consent_basis_status: "present",
        reviewed_indigenous_governance_status: "unknown",
        reviewed_public_use_allowed: true,
      }),
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const result = await decide(SENSITIVITY_1, { decision: "reviewed", reviewedSnapshot: snapshot, now: T4 });
      assert.equal(result.ok, false, `expected a fail-closed rejection for ${JSON.stringify(snapshot)}`);
      assert.equal(result.error.code, "validation_blocker");
    }

    assert.deepEqual(await decisionRows(SENSITIVITY_1), beforeRows);
    const afterQueue = await queueRow(SENSITIVITY_1);
    assert.equal(afterQueue.queue_status, beforeQueue.queue_status);
    assert.equal(afterQueue.review_status, beforeQueue.review_status);

    // The ledger's own CHECK constraint independently rejects the same thing, so a
    // direct insert cannot bypass the service.
    await assert.rejects(query(
      `INSERT INTO kai.intake_sensitivity_review_decisions (
         organization_id, intake_sensitivity_profile_id, review_queue_item_id, decision_outcome,
         reviewed_personal_data_status, reviewed_minor_data_status,
         reviewed_health_housing_justice_immigration_status, reviewed_indigenous_governance_status,
         reviewed_staff_notes_status, reviewed_story_testimonial_status,
         reviewed_small_cell_risk_status, reviewed_financial_records_status,
         reviewed_consent_basis_status, reviewed_allowed_use_status,
         reviewed_llm_processing_allowed, reviewed_product_learning_allowed,
         reviewed_public_use_allowed, reviewed_funder_use_allowed,
         decided_by, decided_by_role, target_updated_at
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'reviewed',
         'absent','absent','absent','absent','absent','absent','absent','absent',
         'unknown','allowed', false, false, true, false,
         $4::uuid, 'gk_reviewer', now())`,
      [ORG, SENSITIVITY_1, beforeQueue.review_queue_item_id, REVIEWER],
    ));
  });

  test("B1A-2 (10) a system or assistant actor can never decide, at the service boundary and at the DB CHECK", async () => {
    const beforeRows = await decisionRows(SENSITIVITY_1);
    for (const actorContext of [systemActor, assistantActor]) {
      // eslint-disable-next-line no-await-in-loop
      const result = await decide(SENSITIVITY_1, {
        actorContext,
        decision: "reviewed",
        reviewedSnapshot: internalOnlySnapshot(),
        now: T4,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "authorization_denied");
    }
    assert.deepEqual(await decisionRows(SENSITIVITY_1), beforeRows);

    const item = await queueRow(SENSITIVITY_1);
    await assert.rejects(query(
      `INSERT INTO kai.intake_sensitivity_review_decisions (
         organization_id, intake_sensitivity_profile_id, review_queue_item_id, decision_outcome,
         decided_by, decided_by_role, target_updated_at, created_by_type
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'needs_more_information', $4::uuid, 'gk_reviewer', now(), 'system')`,
      [ORG, SENSITIVITY_1, item.review_queue_item_id, REVIEWER],
    ));
    await assert.rejects(query(
      `INSERT INTO kai.intake_sensitivity_review_decisions (
         organization_id, intake_sensitivity_profile_id, review_queue_item_id, decision_outcome,
         decided_by, decided_by_role, target_updated_at, created_by_type
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'needs_more_information', $4::uuid, 'client_admin', now(), 'human')`,
      [ORG, SENSITIVITY_1, item.review_queue_item_id, REVIEWER],
    ));
  });

  test("B1A-2 (11) an unauthorized role cannot decide", async () => {
    const beforeRows = await decisionRows(SENSITIVITY_1);
    const result = await decide(SENSITIVITY_1, {
      actorContext: unauthorizedActor,
      decision: "reviewed",
      reviewedSnapshot: internalOnlySnapshot(),
      now: T4,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "authorization_denied");
    assert.deepEqual(await decisionRows(SENSITIVITY_1), beforeRows);
  });

  test("B1A-2 (12) a cross-tenant decision attempt fails and persists nothing", async () => {
    const beforeRows = await decisionRows(SENSITIVITY_1);
    const item = await queueRow(SENSITIVITY_1);
    const result = await recordSensitivityAllowedUseDecision(
      {
        organizationId: OTHER_ORG,
        intakeSensitivityProfileId: SENSITIVITY_1,
        reviewQueueItemId: item.review_queue_item_id,
        expectedUpdatedAt: new Date(item.updated_at).toISOString(),
        decision: "reviewed",
        reviewedSnapshot: internalOnlySnapshot(),
        actorContext: {
          ...reviewerActor,
          organizationMemberships: [{ organization_id: OTHER_ORG, membership_status: "active", role_name: "gk_reviewer" }],
        },
        now: T4,
      },
      { env: ENV, sensitivityAllowedUseReviewRepository: decisionRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "not_found");
    assert.deepEqual(await decisionRows(SENSITIVITY_1), beforeRows);
  });

  test("B1A-2 (13) a stale expected_updated_at fails the optimistic-concurrency check", async () => {
    const beforeRows = await decisionRows(SENSITIVITY_1);
    const result = await decide(SENSITIVITY_1, {
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
      decision: "reviewed",
      reviewedSnapshot: internalOnlySnapshot(),
      now: T4,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "conflict_current_state_changed");
    assert.deepEqual(await decisionRows(SENSITIVITY_1), beforeRows);
  });

  test("B1A-2 (14) a required-audit failure rolls back both the decision insert and the queue transition", async () => {
    const beforeRows = await decisionRows(SENSITIVITY_1);
    const beforeQueue = await queueRow(SENSITIVITY_1);

    for (const recorder of [rejectingAuditRecorder(), failingPublishAuditRecorder()]) {
      // eslint-disable-next-line no-await-in-loop
      const result = await decide(
        SENSITIVITY_1,
        { decision: "reviewed", reviewedSnapshot: internalOnlySnapshot(), now: T4 },
        { metadataOnlyAudit: recorder },
      );
      assert.equal(result.ok, false);
      // eslint-disable-next-line no-await-in-loop
      assert.deepEqual(await decisionRows(SENSITIVITY_1), beforeRows, "no decision row may survive");
      // eslint-disable-next-line no-await-in-loop
      const afterQueue = await queueRow(SENSITIVITY_1);
      assert.equal(afterQueue.queue_status, beforeQueue.queue_status, "the queue transition must roll back");
      assert.equal(afterQueue.review_status, beforeQueue.review_status);
      assert.equal(
        new Date(afterQueue.updated_at).toISOString(),
        new Date(beforeQueue.updated_at).toISOString(),
        "the queue OCC stamp must roll back",
      );
    }
  });

  test("B1A-2 (15) an identical re-sent request replays the same decision instead of appending a duplicate", async () => {
    const queueItemId = await ensureQueueItem(SENSITIVITY_2);
    assert.ok(queueItemId);
    const item = await queueRow(SENSITIVITY_2);
    const expectedUpdatedAt = new Date(item.updated_at).toISOString();

    const first = await recordSensitivityAllowedUseDecision(
      {
        organizationId: ORG,
        intakeSensitivityProfileId: SENSITIVITY_2,
        reviewQueueItemId: item.review_queue_item_id,
        expectedUpdatedAt,
        decision: "reviewed",
        reviewedSnapshot: internalOnlySnapshot(),
        actorContext: reviewerActor,
        now: T1,
      },
      { env: ENV, sensitivityAllowedUseReviewRepository: decisionRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.data.replayed, false);

    const replay = await recordSensitivityAllowedUseDecision(
      {
        organizationId: ORG,
        intakeSensitivityProfileId: SENSITIVITY_2,
        reviewQueueItemId: item.review_queue_item_id,
        expectedUpdatedAt,
        decision: "reviewed",
        reviewedSnapshot: internalOnlySnapshot(),
        actorContext: reviewerActor,
        now: T2,
      },
      { env: ENV, sensitivityAllowedUseReviewRepository: decisionRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.data.replayed, true);
    assert.equal(replay.data.decision.decision_id, first.data.decision.decision_id);
    assert.equal((await decisionRows(SENSITIVITY_2)).length, 1);
  });

  test("B1A-2 (16) the Review Cockpit GET returns the current decision only, and never a superseded one", async () => {
    const rows = await decisionRows(SENSITIVITY_1);
    assert.ok(rows.length >= 3, "expected a multi-row lineage from the scenarios above");
    const head = rows.find((row) => !rows.some((other) => other.supersedes_decision_id === row.decision_id));
    const superseded = rows.filter((row) => row.decision_id !== head.decision_id);
    assert.ok(superseded.length >= 2);

    const detail = await getReviewCockpitSensitivityProfileDetail(
      { organizationId: ORG, intakeSensitivityProfileId: SENSITIVITY_1, actorContext: reviewerActor },
      {
        env: ENV,
        getReviewCockpitSensitivityProfileRecord: (organizationId, profileId) =>
          getReviewCockpitSensitivityProfileRecord(organizationId, profileId, pool),
      },
    );
    assert.equal(detail.ok, true, JSON.stringify(detail));
    assert.equal(detail.data.current_decision.decision_id, head.decision_id);
    for (const row of superseded) {
      assert.notEqual(detail.data.current_decision.decision_id, row.decision_id);
    }
    // The profile itself is still read-only and still fully pinned in the readback.
    assert.equal(detail.data.read_only, true);
    assert.equal(detail.data.allowed_use_restrictions.public_use_allowed, false);
    assert.equal(detail.data.allowed_use_restrictions.funder_use_allowed, false);
    assert.equal(detail.data.allowed_use_restrictions.llm_processing_allowed, false);
    assert.equal(detail.data.allowed_use_restrictions.product_learning_allowed, false);
    assert.equal(detail.data.allowed_use_restrictions.human_review_required, true);
    assert.equal(detail.data.allowed_use_restrictions.retention_posture, "restricted_pending_review");
    // The queue state is exposed only as the OCC stamp the cockpit needs.
    assert.equal(detail.data.sensitivity_review_queue_item.queue_type, "sensitivity_review");
    assert.ok(detail.data.sensitivity_review_queue_item.updated_at);

    // A profile with no decision at all reads back as null, never fabricated.
    const pristine = await getReviewCockpitSensitivityDecisionRecord(ORG, SENSITIVITY_1, pool);
    assert.equal(pristine.lineageAmbiguous, false);
    assert.ok(pristine.currentDecision);
  });

  test("B1A-2 the cockpit decision endpoint service rejects a caller-supplied reviewer identity and marshals only the current head", async () => {
    const item = await queueRow(SENSITIVITY_2);
    const spoofed = await submitSensitivityProfileDecision(
      {
        organizationId: ORG,
        intakeSensitivityProfileId: SENSITIVITY_2,
        actorContext: reviewerActor,
        payload: {
          expected_updated_at: new Date(item.updated_at).toISOString(),
          review_queue_item_id: item.review_queue_item_id,
          decision: "needs_more_information",
          decided_by: "90000000-0000-4000-8000-000000000099",
        },
      },
      { env: ENV, sensitivityAllowedUseReviewRepository: decisionRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(spoofed.ok, false);
    assert.equal(spoofed.error.code, "validation_blocker");

    const accepted = await submitSensitivityProfileDecision(
      {
        organizationId: ORG,
        intakeSensitivityProfileId: SENSITIVITY_2,
        actorContext: reviewerActor,
        payload: {
          expected_updated_at: new Date(item.updated_at).toISOString(),
          review_queue_item_id: item.review_queue_item_id,
          decision: "needs_more_information",
        },
      },
      { env: ENV, sensitivityAllowedUseReviewRepository: decisionRepository, metadataOnlyAudit: auditRecorder() },
    );
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.equal(accepted.data.current_decision.decision_outcome, "needs_more_information");
    assert.equal(accepted.data.current_decision.decided_by, REVIEWER);
    assert.equal(accepted.data.sensitivity_review_queue_item.queue_status, "open");
    assert.equal(accepted.data.current_decision.authority.review_complete, false);
  });
}
