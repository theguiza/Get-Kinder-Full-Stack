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

const GAP_ROW = Object.freeze({
  gap_log_item_id: "00000000-0000-4000-8000-000000002101",
  claim_id: "00000000-0000-4000-8000-000000000101",
  dimension_key: "definition_clarity",
  assessment_status: "unresolved",
  validator_key: "VAL-KAI-P2-02-definition_clarity",
});

function actorContextForRole(role, userIdSuffix) {
  return {
    actorType: "human",
    actorUserId: `90000000-0000-4000-8000-00000000000${userIdSuffix}`,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }],
  };
}

function stubImpactLibraryQueries({ gapRows = [GAP_ROW] } = {}) {
  const originalQuery = pool.query;
  const gapQueryCalls = [];
  pool.query = async (rawSql, params = []) => {
    const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
    const trimmed = sql.trim();

    if (trimmed === "SELECT * FROM userdata WHERE id = $1 LIMIT 1") {
      return { rows: [{ id: params[0], org_rep: false }], rowCount: 1 };
    }
    if (trimmed.includes("FROM kai.gap_log_items")) {
      gapQueryCalls.push({ organizationId: params[0], limit: params[1] });
      return { rows: gapRows, rowCount: gapRows.length };
    }
    throw new Error(`Unhandled query in Package 4 acceptance test: ${trimmed}`);
  };
  return {
    gapQueryCalls,
    restore() {
      pool.query = originalQuery;
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
  pool.query = async (rawSql) => {
    throw new Error(`No database query is expected before tenant-boundary rejection: ${rawSql}`);
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
