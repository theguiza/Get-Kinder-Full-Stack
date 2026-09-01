import test from "node:test";
import assert from "node:assert/strict";

import pool from "../Backend/db/pg.js";
import { handleKaiMessage, __testables as kaiServiceTestables } from "../Backend/services/kai.js";
import { executeToolCall, __testables as executorTestables } from "../Backend/services/kai-tool-executor.js";
import { IMPACT_EVIDENCE_LIBRARY_SURFACE } from "../Backend/services/kai-tool-definitions.js";

/**
 * KAI Package 3 repair acceptance: proves the repaired
 * list_client_followup_workflows capability (commit 13677f7) actually works
 * end to end through the real POST /api/kai/impact-library/message
 * composition - handleKaiMessage(surface=impact_evidence_library) ->
 * (real, unstubbed) executeToolCall -> handleGovernedClaimsToolCall ->
 * getClaimTraceabilitySummaryTool -> listClientFollowupWorkflowsForImpactLibrary
 * -> the real tenant-scoped read - for one identical authorized actor per
 * GK-staff role, using the existing DI seams (resolveKaiRequestContext,
 * Anthropic response, database rows) without stubbing any authorization
 * decision itself. This is acceptance testing of the existing repair, not a
 * new authorization design.
 *
 * The HTTP route (Backend/routes/kaiApi.js POST /impact-library/message) is
 * a thin, already-tested (kai-sprint2-impact-library-kai-surface.spec.js)
 * wrapper around exactly this resolveKaiRequestContext -> handleKaiMessage
 * composition; handleKaiMessage is the same seam used by every other
 * composition-level KAI test in this repository
 * (kai-runtime-context-bootstrap.spec.js, kai-runtime-governed-claims.spec.js).
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const ENGAGEMENT = "00000000-0000-4000-8000-0000000000e1";
const USER_ID = 424242;

const FOLLOWUP_ROW = Object.freeze({
  claim_id: "00000000-0000-4000-8000-000000000101",
  client_followup_item_id: "00000000-0000-4000-8000-000000001101",
  dimension_key: "definition_clarity",
  question_text: "Confirm the business meaning of the unresolved field or measure.",
  review_queue_item_id: "00000000-0000-4000-8000-000000001201",
  queue_status: "waiting_on_client",
  review_status: "needs_gk_review",
  updated_at: "2026-08-22T20:00:00.000Z",
});

function actorContextForRole(role, userIdSuffix) {
  return {
    actorType: "human",
    actorUserId: `90000000-0000-4000-8000-00000000000${userIdSuffix}`,
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: role }],
  };
}

function stubImpactLibraryQueries({ followupRows = [FOLLOWUP_ROW] } = {}) {
  const originalQuery = pool.query;
  const followupQueryCalls = [];
  pool.query = async (rawSql, params = []) => {
    const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
    const trimmed = sql.trim();

    if (trimmed === "SELECT * FROM userdata WHERE id = $1 LIMIT 1") {
      return { rows: [{ id: params[0], org_rep: false }], rowCount: 1 };
    }
    if (trimmed.includes("FROM kai.client_followup_items")) {
      followupQueryCalls.push({ organizationId: params[0] });
      return { rows: followupRows, rowCount: followupRows.length };
    }
    throw new Error(`Unhandled query in Package 3 repair acceptance test: ${trimmed}`);
  };
  return {
    followupQueryCalls,
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

/**
 * Drives one identical, real /api/kai/impact-library/message-shaped request
 * for the given actorContext: resolveKaiRequestContext is stubbed to return
 * the server-authorized organization/engagement/actor exactly as the real
 * route composes it (this is context resolution, not an authorization
 * decision); the model is stubbed to request list_client_followup_workflows
 * once and then finish; executeToolCall, handleGovernedClaimsToolCall,
 * getClaimTraceabilitySummaryTool, and listClientFollowupWorkflowsForImpactLibrary
 * all run for real and unstubbed.
 */
async function runImpactLibraryFollowupRequest({ actorContext, requestedOrganizationId = ORG, toolOrganizationId = ORG }) {
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
            name: "list_client_followup_workflows",
            input: { organizationId: toolOrganizationId },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }
    return {
      content: [{ type: "text", text: "Here are the open client follow-ups." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });

  const result = await handleKaiMessage({
    userId: USER_ID,
    userMessage: "What client follow-ups are still open?",
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
  test(`${role}: the real /impact-library composition resolves context, exposes and executes list_client_followup_workflows, and returns the minimized DTO`, async (t) => {
    withEnabledEnv(t);
    const { followupQueryCalls, restore } = stubImpactLibraryQueries();
    let resolveActorCalls = 0;
    executorTestables.setResolveKaiActorContextForTests(async () => {
      resolveActorCalls += 1;
      return { ok: false, error_code: "unauthorized" };
    });

    try {
      const actorContext = actorContextForRole(role, suffix);
      const { result, contextCalls, anthropicCalls, toolResult } = await runImpactLibraryFollowupRequest({
        actorContext,
      });

      // 1. request context resolves for the requested organization/engagement
      assert.equal(contextCalls.length, 1);
      assert.equal(contextCalls[0].requestedOrganizationId, ORG);
      assert.equal(contextCalls[0].requestedEngagementId, ENGAGEMENT);

      // 2/3. impact_evidence_library exposes the tool and the model stub requested it
      const firstCallTools = (anthropicCalls[0]?.tools || []).map((tool) => tool.name);
      assert.ok(firstCallTools.includes("list_client_followup_workflows"));
      assert.equal(anthropicCalls[0]?.tools?.length > 0, true);

      // 4. executeToolCall received the resolved KAI context (never re-derived the actor)
      assert.equal(resolveActorCalls, 0, "the runtime-resolved actorContext must be reused, not re-derived per tool call");

      // 6. the repaired assistant authorization accepted this actor - proven by
      // reaching the real tenant-scoped read (not a denial)
      // 7. the existing tenant-scoped follow-up read actually executed
      assert.equal(followupQueryCalls.length, 1);
      assert.deepEqual(followupQueryCalls[0], { organizationId: ORG });

      // 8. the minimized governed DTO is returned successfully
      assert.equal(toolResult.ok, true);
      assert.deepEqual(toolResult.data, { items: [FOLLOWUP_ROW] });
      assert.equal(result.error, undefined);
    } finally {
      restore();
    }
  });
}

test("client_admin: establishing /impact-library organization/engagement context does not itself grant the governed follow-up tool", async (t) => {
  withEnabledEnv(t);
  const { followupQueryCalls, restore } = stubImpactLibraryQueries();
  try {
    const actorContext = actorContextForRole("client_admin", "3");
    const { result, contextCalls, toolResult } = await runImpactLibraryFollowupRequest({ actorContext });

    // context resolution (Set A authority) succeeds independently of tool authorization (Set B/C)
    assert.equal(contextCalls.length, 1);
    assert.equal(result.error, undefined);

    // the real wrapper still denies the follow-up read for this role
    assert.equal(toolResult.ok, false);
    assert.equal(toolResult.error.code, "authorization_denied");
    assert.equal(followupQueryCalls.length, 0, "no tenant-scoped read may occur for a denied actor");
  } finally {
    restore();
  }
});

test("cross-tenant: a model-supplied organizationId that differs from the server-authorized organization is rejected before any follow-up read", async () => {
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
      "list_client_followup_workflows",
      { organizationId: OTHER_ORG },
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
