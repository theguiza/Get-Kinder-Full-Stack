import test from "node:test";
import assert from "node:assert/strict";

import pool from "../Backend/db/pg.js";
import { handleKaiMessage, __testables as kaiServiceTestables } from "../Backend/services/kai.js";
import { executeToolCall, __testables as executorTestables } from "../Backend/services/kai-tool-executor.js";
import { IMPACT_EVIDENCE_LIBRARY_SURFACE } from "../Backend/services/kai-tool-definitions.js";

/**
 * KAI Package 4 acceptance: proves the new list_organization_evidence_gaps
 * capability actually works end to end through the real
 * POST /api/kai/impact-library/message composition - handleKaiMessage
 * (surface=impact_evidence_library) -> (real, unstubbed) executeToolCall ->
 * handleGovernedClaimsToolCall -> getClaimTraceabilitySummaryTool ->
 * listOrganizationEvidenceGapsForImpactLibrary -> the real tenant-scoped,
 * single bounded query over kai.gap_log_items - for one identical authorized
 * actor per GK-staff role, using the existing DI seams
 * (resolveKaiRequestContext, Anthropic response, database rows) without
 * stubbing any authorization decision itself.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-0000000000e1";
const USER_ID = 424242;

const CLAIM_ID = "00000000-0000-4000-8000-000000000101";
const GAP_ROW = Object.freeze({
  gap_log_item_id: "00000000-0000-4000-8000-000000002101",
  claim_id: CLAIM_ID,
  dimension_key: "missingness",
  assessment_status: "unresolved",
  validator_key: "VAL-KAI-P2-02-missingness",
});

/**
 * Full current-state fixture for CLAIM_ID's lineage, matching exactly the
 * shape the Package 4 repair
 * (Backend/kai/dictionary/postgresOrganizationEvidenceGapCurrentStateRepository.js)
 * batch-validates against, so GAP_ROW is judged CURRENT (the same judgment
 * get_claim_traceability_summary itself would reach for this claim right
 * now) rather than omitted as stale. Mirrors the fixture already proven
 * correct in __tests__/kai-package-4-organization-evidence-gaps-repair.spec.js.
 */
const EVIDENCE_ITEM_ID = "00000000-0000-4000-8000-000000000201";
const LOCATOR_ID = "00000000-0000-4000-8000-000000000301";
const SOURCE_ID = "00000000-0000-4000-8000-000000000401";
const SOURCE_VERSION_ID = "00000000-0000-4000-8000-000000000501";
const CANDIDATE_ID = "00000000-0000-4000-8000-000000000601";
const DECISION_ID = "00000000-0000-4000-8000-000000000701";
const EVIDENCE_REVIEW_QUEUE_ID = "00000000-0000-4000-8000-000000000801";
const CLAIM_REVIEW_QUEUE_ID = "00000000-0000-4000-8000-000000000901";
const PROFILE_ID = "00000000-0000-4000-8000-000000000a01";
const DICTIONARY_ID = "00000000-0000-4000-8000-000000000b01";
const CLAIM_EVIDENCE_LINK_ID = "00000000-0000-4000-8000-000000000f01";
const SHA = "a".repeat(64);

function currentClaimFixtureTables(organizationId) {
  return {
    claims: [
      {
        claim_id: CLAIM_ID,
        organization_id: organizationId,
        evidence_item_id: EVIDENCE_ITEM_ID,
        claim_type: "outcome",
        claim_status: "draft",
        claim_review_status: "unassessed",
        claim_strength: "unassessed",
        internal_only: true,
        public_use_allowed: false,
        funder_use_allowed: false,
        export_ready: false,
      },
    ],
    claim_evidence_links: [
      {
        claim_evidence_link_id: CLAIM_EVIDENCE_LINK_ID,
        organization_id: organizationId,
        claim_id: CLAIM_ID,
        evidence_item_id: EVIDENCE_ITEM_ID,
      },
    ],
    evidence_items: [
      {
        evidence_item_id: EVIDENCE_ITEM_ID,
        organization_id: organizationId,
        source_id: SOURCE_ID,
        source_version_id: SOURCE_VERSION_ID,
        source_locator_id: LOCATOR_ID,
        evidence_review_status: "unassessed",
        support_strength: "unassessed",
        sensitivity_level: "internal",
      },
    ],
    source_locators: [{ source_locator_id: LOCATOR_ID, organization_id: organizationId, source_version_id: SOURCE_VERSION_ID }],
    sources: [{ source_id: SOURCE_ID, organization_id: organizationId, source_code: "SRC-1" }],
    source_versions: [
      {
        source_version_id: SOURCE_VERSION_ID,
        organization_id: organizationId,
        source_id: SOURCE_ID,
        intake_source_candidate_id: CANDIDATE_ID,
        intake_sensitivity_profile_id: PROFILE_ID,
        profile_canonical_sha256: SHA,
        is_current: true,
      },
    ],
    intake_source_candidates: [
      {
        intake_source_candidate_id: CANDIDATE_ID,
        organization_id: organizationId,
        intake_file_id: "00000000-0000-4000-8000-000000001001",
        file_profile_id: "00000000-0000-4000-8000-000000001101",
        data_dictionary_id: DICTIONARY_ID,
        intake_sensitivity_profile_id: PROFILE_ID,
        profile_canonical_sha256: SHA,
        proposed_source_type: "survey",
        candidate_status: "promoted",
      },
    ],
    intake_promotion_decisions: [
      {
        intake_promotion_decision_id: DECISION_ID,
        organization_id: organizationId,
        intake_source_candidate_id: CANDIDATE_ID,
        source_id: SOURCE_ID,
        source_version_id: SOURCE_VERSION_ID,
        decision_status: "promoted",
      },
    ],
    evidence_review_queue: [
      {
        review_queue_item_id: EVIDENCE_REVIEW_QUEUE_ID,
        organization_id: organizationId,
        queue_type: "evidence_review",
        target_object_type: "evidence_item",
        target_object_id: EVIDENCE_ITEM_ID,
        queue_status: "resolved",
        review_status: "resolved",
      },
    ],
    claim_review_queue: [
      {
        review_queue_item_id: CLAIM_REVIEW_QUEUE_ID,
        organization_id: organizationId,
        queue_type: "claim_review",
        target_object_type: "claim",
        target_object_id: CLAIM_ID,
        queue_status: "resolved",
        review_status: "resolved",
      },
    ],
    intake_sensitivity_profiles: [
      {
        organization_id: organizationId,
        intake_sensitivity_profile_id: PROFILE_ID,
        intake_file_id: "00000000-0000-4000-8000-000000001001",
        file_profile_id: "00000000-0000-4000-8000-000000001101",
        data_dictionary_id: DICTIONARY_ID,
        profile_canonical_sha256: SHA,
        human_review_required: true,
        public_use_allowed: false,
        funder_use_allowed: false,
        llm_processing_allowed: false,
        product_learning_allowed: false,
        retention_posture: "restricted_pending_review",
        small_cell_risk_status: "absent",
        allowed_use_status: "allowed",
      },
    ],
    data_dictionaries: [
      {
        data_dictionary_id: DICTIONARY_ID,
        organization_id: organizationId,
        intake_file_id: "00000000-0000-4000-8000-000000001001",
        file_profile_id: "00000000-0000-4000-8000-000000001101",
        profile_canonical_sha256: SHA,
        dictionary_status: "final",
      },
    ],
    data_dictionary_fields: [
      {
        organization_id: organizationId,
        data_dictionary_id: DICTIONARY_ID,
        data_dictionary_field_id: "00000000-0000-4000-8000-000000001201",
        profile_field_key: "field_a",
        data_type: "string",
        business_meaning: "Defined meaning for field_a.",
        entity_level: "household",
        sensitivity: "low",
      },
    ],
    data_quality_findings: [],
    evidence_field_keys: [{ organization_id: organizationId, source_version_id: SOURCE_VERSION_ID, profile_field_key: "field_a" }],
    gap_log_items: [
      { ...GAP_ROW, organization_id: organizationId, evidence_item_id: EVIDENCE_ITEM_ID, source_version_id: SOURCE_VERSION_ID, safe_summary: "Claim gap requires review for dimension: missingness.", open_finding_count: null, field_count: null, undefined_field_count: null, uncovered_field_count: null },
      { gap_log_item_id: "00000000-0000-4000-8000-000000002102", claim_id: CLAIM_ID, organization_id: organizationId, evidence_item_id: EVIDENCE_ITEM_ID, source_version_id: SOURCE_VERSION_ID, dimension_key: "duplicates", assessment_status: "unresolved", validator_key: "VAL-KAI-P2-02-duplicates", safe_summary: "Claim gap requires review for dimension: duplicates.", open_finding_count: null, field_count: null, undefined_field_count: null, uncovered_field_count: null },
      { gap_log_item_id: "00000000-0000-4000-8000-000000002103", claim_id: CLAIM_ID, organization_id: organizationId, evidence_item_id: EVIDENCE_ITEM_ID, source_version_id: SOURCE_VERSION_ID, dimension_key: "denominator_clarity", assessment_status: "unresolved", validator_key: "VAL-KAI-P2-02-denominator_clarity", safe_summary: "Claim gap requires review for dimension: denominator_clarity.", open_finding_count: null, field_count: null, undefined_field_count: null, uncovered_field_count: null },
      { gap_log_item_id: "00000000-0000-4000-8000-000000002104", claim_id: CLAIM_ID, organization_id: organizationId, evidence_item_id: EVIDENCE_ITEM_ID, source_version_id: SOURCE_VERSION_ID, dimension_key: "time_period_clarity", assessment_status: "unresolved", validator_key: "VAL-KAI-P2-02-time_period_clarity", safe_summary: "Claim gap requires review for dimension: time_period_clarity.", open_finding_count: null, field_count: null, undefined_field_count: null, uncovered_field_count: null },
      { gap_log_item_id: "00000000-0000-4000-8000-000000002105", claim_id: CLAIM_ID, organization_id: organizationId, evidence_item_id: EVIDENCE_ITEM_ID, source_version_id: SOURCE_VERSION_ID, dimension_key: "conflicting_source_indicators", assessment_status: "unresolved", validator_key: "VAL-KAI-P2-02-conflicting_source_indicators", safe_summary: "Claim gap requires review for dimension: conflicting_source_indicators.", open_finding_count: null, field_count: null, undefined_field_count: null, uncovered_field_count: null },
      { gap_log_item_id: "00000000-0000-4000-8000-000000002106", claim_id: CLAIM_ID, organization_id: organizationId, evidence_item_id: EVIDENCE_ITEM_ID, source_version_id: SOURCE_VERSION_ID, dimension_key: "requirement_alignment", assessment_status: "unresolved", validator_key: "VAL-KAI-P2-02-requirement_alignment", safe_summary: "Claim gap requires review for dimension: requirement_alignment.", open_finding_count: null, field_count: null, undefined_field_count: null, uncovered_field_count: null },
    ],
    client_followup_items: [
      { client_followup_item_id: "00000000-0000-4000-8000-000000002201", organization_id: organizationId, claim_id: CLAIM_ID, gap_log_item_id: "00000000-0000-4000-8000-000000002103", dimension_key: "denominator_clarity", question_text: "Confirm the denominator and how it is calculated." },
      { client_followup_item_id: "00000000-0000-4000-8000-000000002202", organization_id: organizationId, claim_id: CLAIM_ID, gap_log_item_id: "00000000-0000-4000-8000-000000002104", dimension_key: "time_period_clarity", question_text: "Confirm the reporting period represented by this source." },
    ],
    client_followup_queue: [
      { review_queue_item_id: "00000000-0000-4000-8000-000000002301", organization_id: organizationId, queue_type: "client_followup", target_object_type: "client_followup_item", target_object_id: "00000000-0000-4000-8000-000000002201", priority: "medium", queue_status: "waiting_on_client", review_status: "proposed", assigned_to: null, due_at: null, summary: "Client clarification is required for an unresolved claim gap.", required_action: "Confirm the denominator and how it is calculated." },
      { review_queue_item_id: "00000000-0000-4000-8000-000000002302", organization_id: organizationId, queue_type: "client_followup", target_object_type: "client_followup_item", target_object_id: "00000000-0000-4000-8000-000000002202", priority: "medium", queue_status: "waiting_on_client", review_status: "proposed", assigned_to: null, due_at: null, summary: "Client clarification is required for an unresolved claim gap.", required_action: "Confirm the reporting period represented by this source." },
    ],
  };
}

/**
 * Fake pg-pool `connect()` client answering every batched
 * current-state-repository query (see
 * postgresOrganizationEvidenceGapCurrentStateRepository.js) plus BEGIN/
 * COMMIT/ROLLBACK/isolation-level statements, by filtering the in-memory
 * fixture tables above by the organization_id/id-array parameters each real
 * query sends - so this test never opens a real database connection while
 * still exercising the real filterCurrentOrganizationEvidenceGaps batching
 * logic end to end.
 */
function makeFakeTransactionClient(tables) {
  function scoped(rows, organizationId, idColumn, ids) {
    const idSet = new Set(ids);
    return rows.filter((row) => row.organization_id === organizationId && idSet.has(row[idColumn]));
  }
  return {
    async query(rawSql, params = []) {
      const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql.trim())) return { rows: [] };
      if (sql.startsWith("SET TRANSACTION ISOLATION LEVEL")) return { rows: [] };
      const [organizationId, ids] = params;

      if (sql.includes("candidate_claims")) return { rows: [] };
      if (sql.includes("FROM kai.claims")) return { rows: scoped(tables.claims, organizationId, "claim_id", ids) };
      if (sql.includes("FROM kai.claim_evidence_links")) return { rows: scoped(tables.claim_evidence_links, organizationId, "claim_id", ids) };
      if (sql.includes("FROM kai.evidence_items e")) return { rows: scoped(tables.evidence_field_keys, organizationId, "source_version_id", ids) };
      if (sql.includes("FROM kai.evidence_items")) return { rows: scoped(tables.evidence_items, organizationId, "evidence_item_id", ids) };
      if (sql.includes("FROM kai.source_locators")) return { rows: scoped(tables.source_locators, organizationId, "source_locator_id", ids) };
      if (sql.includes("FROM kai.sources")) return { rows: scoped(tables.sources, organizationId, "source_id", ids) };
      if (sql.includes("FROM kai.source_versions")) return { rows: scoped(tables.source_versions, organizationId, "source_version_id", ids) };
      if (sql.includes("FROM kai.intake_source_candidates")) return { rows: scoped(tables.intake_source_candidates, organizationId, "intake_source_candidate_id", ids) };
      if (sql.includes("FROM kai.intake_promotion_decisions")) return { rows: scoped(tables.intake_promotion_decisions, organizationId, "source_version_id", ids) };
      if (sql.includes("queue_type = 'evidence_review'")) return { rows: scoped(tables.evidence_review_queue, organizationId, "target_object_id", ids) };
      if (sql.includes("queue_type = 'claim_review'")) return { rows: scoped(tables.claim_review_queue, organizationId, "target_object_id", ids) };
      if (sql.includes("queue_type = 'client_followup'")) return { rows: scoped(tables.client_followup_queue, organizationId, "target_object_id", ids) };
      if (sql.includes("queue_type = 'conflict_resolution'")) return { rows: [] };
      if (sql.includes("FROM kai.intake_sensitivity_profiles")) return { rows: scoped(tables.intake_sensitivity_profiles, organizationId, "intake_sensitivity_profile_id", ids) };
      if (sql.includes("FROM kai.data_dictionary_fields")) return { rows: scoped(tables.data_dictionary_fields, organizationId, "data_dictionary_id", ids) };
      if (sql.includes("FROM kai.data_quality_findings")) return { rows: scoped(tables.data_quality_findings, organizationId, "data_dictionary_id", ids) };
      if (sql.includes("FROM kai.data_dictionaries")) return { rows: scoped(tables.data_dictionaries, organizationId, "data_dictionary_id", ids) };
      if (sql.includes("FROM kai.gap_log_items") && sql.includes("ORDER BY claim_id ASC")) {
        return { rows: scoped(tables.gap_log_items, organizationId, "claim_id", ids) };
      }
      if (sql.includes("FROM kai.client_followup_items")) return { rows: scoped(tables.client_followup_items, organizationId, "claim_id", ids) };

      throw new Error(`Unhandled fake-transaction-client query in Package 4 acceptance test: ${sql}`);
    },
    release() {},
  };
}

function actorContextForRole(role, userIdSuffix) {
  return {
    actorType: "human",
    actorUserId: `90000000-0000-4000-8000-00000000000${userIdSuffix}`,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }],
  };
}

function stubImpactLibraryQueries({ gapRows = [GAP_ROW], organizationId = ORG } = {}) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const gapQueryCalls = [];
  // The candidate-page query (kaiOrganizationEvidenceGapReadModels.js) still
  // runs through this same transaction client (it is passed the tx, not
  // pool, by kaiOrganizationEvidenceGapReadService.js) - handled below by
  // ordering the "LIMIT $2::int" / no-ORDER-BY-claim_id shape check before
  // the fixture-table candidate-set read.
  pool.query = async (rawSql, params = []) => {
    const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
    const trimmed = sql.trim();
    if (trimmed === "SELECT * FROM userdata WHERE id = $1 LIMIT 1") {
      return { rows: [{ id: params[0], org_rep: false }], rowCount: 1 };
    }
    throw new Error(`Unhandled pool.query in Package 4 acceptance test (expected all gap-read queries to run through pool.connect()'s transaction client): ${trimmed}`);
  };
  const tables = currentClaimFixtureTables(organizationId);
  pool.connect = async () => {
    const fakeClient = makeFakeTransactionClient(tables);
    const originalClientQuery = fakeClient.query;
    fakeClient.query = async (rawSql, params = []) => {
      const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
      if (sql.includes("FROM kai.gap_log_items") && sql.includes("LIMIT $2::int")) {
        gapQueryCalls.push({ organizationId: params[0], limit: params[1] });
        return { rows: gapRows, rowCount: gapRows.length };
      }
      return originalClientQuery(rawSql, params);
    };
    return fakeClient;
  };
  return {
    gapQueryCalls,
    restore() {
      pool.query = originalQuery;
      pool.connect = originalConnect;
    },
  };
}

function withEnabledEnv(t) {
  const originalSprint2 = process.env.KAI_SPRINT2_ENABLED;
  const originalAssistant = process.env.KAI_ASSISTANT_TOOLS_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  process.env.KAI_ASSISTANT_TOOLS_ENABLED = "true";
  t.after(() => {
    process.env.KAI_SPRINT2_ENABLED = originalSprint2;
    process.env.KAI_ASSISTANT_TOOLS_ENABLED = originalAssistant;
  });
}

async function runImpactLibraryGapsRequest({ actorContext, requestedOrganizationId = ORG, toolOrganizationId = ORG }) {
  const contextCalls = [];
  kaiServiceTestables.setResolveKaiRequestContextForTests(async (input) => {
    contextCalls.push(input);
    return {
      ok: true,
      data: {
        actorContext,
        organizationContext: { organizationId: ORG },
        engagementContext: { engagementId: ENGAGEMENT, organizationId: ORG },
      },
      error: null,
    };
  });

  const anthropicCalls = [];
  let anthropicCallCount = 0;
  kaiServiceTestables.setAnthropicCreateForTests(async (payload) => {
    anthropicCallCount += 1;
    anthropicCalls.push(payload);
    if (anthropicCallCount === 1) {
      return {
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "list_organization_evidence_gaps",
            input: { organizationId: toolOrganizationId, limit: 10, afterGapLogItemId: null },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }
    return {
      content: [{ type: "text", text: "Here are the organization's open evidence gaps." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });

  const result = await handleKaiMessage({
    userId: USER_ID,
    userMessage: "What evidence gaps are open across the organization?",
    conversationId: null,
    tier: "pro",
    surface: IMPACT_EVIDENCE_LIBRARY_SURFACE,
    requestedOrganizationId,
    requestedEngagementId: ENGAGEMENT,
    persistConversation: false,
  });

  const secondCallMessages = anthropicCalls[1]?.messages || [];
  const toolResultBlock = secondCallMessages
    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
    .find((block) => block.type === "tool_result");
  const toolResult = toolResultBlock ? JSON.parse(toolResultBlock.content) : null;

  return { result, contextCalls, anthropicCalls, toolResult };
}

test.afterEach(() => {
  kaiServiceTestables.resetAnthropicCreateForTests();
  kaiServiceTestables.resetResolveKaiRequestContextForTests();
  executorTestables.resetResolveKaiActorContextForTests();
  executorTestables.resetGetClaimTraceabilitySummaryToolForTests();
});

for (const [role, suffix] of [
  ["gk_admin", "1"],
  ["gk_operator", "2"],
]) {
  test(`${role}: the real /impact-library composition resolves context, exposes and executes list_organization_evidence_gaps, and returns the minimized DTO via a single bounded query`, async (t) => {
    withEnabledEnv(t);
    const { gapQueryCalls, restore } = stubImpactLibraryQueries();
    let resolveActorCalls = 0;
    executorTestables.setResolveKaiActorContextForTests(async () => {
      resolveActorCalls += 1;
      return { ok: false, error_code: "unauthorized" };
    });

    try {
      const actorContext = actorContextForRole(role, suffix);
      const { result, contextCalls, anthropicCalls, toolResult } = await runImpactLibraryGapsRequest({
        actorContext,
      });

      assert.equal(contextCalls.length, 1);
      assert.equal(contextCalls[0].requestedOrganizationId, ORG);
      assert.equal(contextCalls[0].requestedEngagementId, ENGAGEMENT);

      const firstCallTools = (anthropicCalls[0]?.tools || []).map((tool) => tool.name);
      assert.ok(firstCallTools.includes("list_organization_evidence_gaps"));

      assert.equal(resolveActorCalls, 0, "the runtime-resolved actorContext must be reused, not re-derived per tool call");

      // exactly one bounded organization-scoped query - no per-claim fan-out
      assert.equal(gapQueryCalls.length, 1);
      assert.equal(gapQueryCalls[0].organizationId, ORG);

      assert.equal(toolResult.ok, true);
      assert.deepEqual(toolResult.data, {
        items: [GAP_ROW],
        limit: 10,
        afterGapLogItemId: null,
        truncated: false,
        nextAfterGapLogItemId: null,
      });
      assert.equal(result.error, undefined);
    } finally {
      restore();
    }
  });
}

test("client_admin: establishing /impact-library organization/engagement context does not itself grant the governed evidence-gap tool", async (t) => {
  withEnabledEnv(t);
  const { gapQueryCalls, restore } = stubImpactLibraryQueries();
  try {
    const actorContext = actorContextForRole("client_admin", "3");
    const { result, contextCalls, toolResult } = await runImpactLibraryGapsRequest({ actorContext });

    assert.equal(contextCalls.length, 1);
    assert.equal(result.error, undefined);

    assert.equal(toolResult.ok, false);
    assert.equal(toolResult.error.code, "authorization_denied");
    assert.equal(gapQueryCalls.length, 0, "no tenant-scoped read may occur for a denied actor");
  } finally {
    restore();
  }
});

test("cross-tenant: a model-supplied organizationId that differs from the server-authorized organization is rejected before any gap read", async () => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = async (rawSql) => {
    throw new Error(`No database query is expected before tenant-boundary rejection: ${rawSql}`);
  };
  pool.connect = async () => {
    throw new Error("No database connection is expected before tenant-boundary rejection");
  };

  try {
    const actorContext = actorContextForRole("gk_admin", "4");
    const kaiContext = {
      actorContext,
      organizationContext: { organizationId: ORG },
      engagementContext: { engagementId: ENGAGEMENT, organizationId: ORG },
    };

    const result = await executeToolCall(
      "list_organization_evidence_gaps",
      { organizationId: OTHER_ORG, limit: 10, afterGapLogItemId: null },
      USER_ID,
      null,
      kaiContext,
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "tenant_boundary_violation");
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
});

test("organization A's gap read cannot return organization B's rows: the query is parameterized by the server-authorized organizationId only", async (t) => {
  withEnabledEnv(t);
  const { gapQueryCalls, restore } = stubImpactLibraryQueries({ gapRows: [GAP_ROW] });
  try {
    const actorContext = actorContextForRole("gk_admin", "5");
    const { toolResult } = await runImpactLibraryGapsRequest({ actorContext });
    assert.equal(toolResult.ok, true);
    assert.equal(gapQueryCalls.length, 1);
    assert.equal(gapQueryCalls[0].organizationId, ORG, "the stub query only ever received the server-authorized ORG, never OTHER_ORG");
  } finally {
    restore();
  }
});
