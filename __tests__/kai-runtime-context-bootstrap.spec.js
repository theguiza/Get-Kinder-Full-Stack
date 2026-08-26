import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import pool from "../Backend/db/pg.js";
import { handleKaiMessage, __testables as kaiServiceTestables } from "../Backend/services/kai.js";
import { executeToolCall, __testables as executorTestables } from "../Backend/services/kai-tool-executor.js";

/**
 * KAI Context Bootstrap v1: proves the production KAI runtime
 * (handleKaiMessage in Backend/services/kai.js) resolves the governed KAI
 * request context - actor, authorized organization, authorized engagement -
 * exactly once, before any assistant/tool execution, using the existing
 * Sprint-2 composition service, and hands that resolved context down to
 * executeToolCall/handleGovernedClaimsToolCall instead of letting a governed
 * tool call re-derive its own actor context. Also proves the guest path
 * (unauthenticated, no server-side actor) never attempts context
 * resolution, and that ordinary non-Sprint-2 tools are unaffected.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const ORG_B = "00000000-0000-4000-8000-000000000002";
const USER_ID = 424242;

function stubAuthenticatedFlowQueries() {
  const originalQuery = pool.query;
  pool.query = async (rawSql, params = []) => {
    const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
    const trimmed = sql.trim();

    if (trimmed === "SELECT * FROM userdata WHERE id = $1 LIMIT 1") {
      return { rows: [{ id: params[0], role: "volunteer" }], rowCount: 1 };
    }
    if (trimmed === "SELECT id FROM kai_conversations WHERE id = $1 AND user_id = $2 LIMIT 1") {
      return { rows: [{ id: params[0] }], rowCount: 1 };
    }
    if (trimmed.includes("FROM kai_messages") && trimmed.includes("ORDER BY created_at ASC")) {
      return { rows: [], rowCount: 0 };
    }
    if (trimmed.startsWith("INSERT INTO kai_messages")) {
      return { rows: [], rowCount: 1 };
    }
    if (trimmed === "UPDATE kai_conversations SET last_msg_at = NOW() WHERE id = $1") {
      return { rows: [], rowCount: 1 };
    }
    if (trimmed.includes("UPDATE kai_conversations") && trimmed.includes("SET summary = $1")) {
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unhandled kai runtime context bootstrap query: ${trimmed}`);
  };
  return () => {
    pool.query = originalQuery;
  };
}

test.afterEach(() => {
  kaiServiceTestables.resetAnthropicCreateForTests();
  kaiServiceTestables.resetResolveKaiRequestContextForTests();
  executorTestables.resetResolveKaiActorContextForTests();
  executorTestables.resetGetClaimTraceabilitySummaryToolForTests();
});

test("source contract: handleKaiMessage composes governed KAI context through kaiContextService.js before executing tools", () => {
  const source = readFileSync(new URL("../Backend/services/kai.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\.\/kai\/services\/kaiContextService\.js"/);
  assert.match(source, /resolveKaiRequestContextImpl\(/);

  const contextCallIndex = source.indexOf("resolveKaiRequestContextImpl(");
  const toolLoopIndex = source.indexOf("executeToolCall(");
  assert.ok(contextCallIndex > -1 && toolLoopIndex > -1);
  assert.ok(contextCallIndex < toolLoopIndex, "context must be resolved before the tool-execution loop");
});

test("guest requests never attempt to resolve a governed KAI context", async () => {
  let contextCalls = 0;
  kaiServiceTestables.setResolveKaiRequestContextForTests(async () => {
    contextCalls += 1;
    return { ok: true, data: { actorContext: null, organizationContext: null, engagementContext: null }, error: null };
  });
  kaiServiceTestables.setAnthropicCreateForTests(async () => ({
    content: [{ type: "text", text: "Hello guest." }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  }));

  const result = await handleKaiMessage({
    userId: null,
    userMessage: "What events are nearby?",
    conversationId: null,
    tier: "guest",
  });

  assert.equal(result.error, undefined);
  assert.equal(contextCalls, 0);
});

test("ordinary authenticated messages that do not request governed org/engagement context never trigger Package 1 context resolution or its JIT actor provisioning", async () => {
  const restoreQuery = stubAuthenticatedFlowQueries();
  let contextCalls = 0;
  kaiServiceTestables.setResolveKaiRequestContextForTests(async () => {
    contextCalls += 1;
    return { ok: true, data: { actorContext: null, organizationContext: null, engagementContext: null }, error: null };
  });
  kaiServiceTestables.setAnthropicCreateForTests(async () => ({
    content: [{ type: "text", text: "Hi there." }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  }));

  try {
    const result = await handleKaiMessage({
      userId: USER_ID,
      userMessage: "What events are nearby?",
      conversationId: "conv-1",
      tier: "pro",
    });
    assert.equal(result.error, undefined);
    assert.equal(contextCalls, 0, "ordinary chat traffic must not cause Package 1 to resolve/provision an actor");
  } finally {
    restoreQuery();
  }
});

test("a requested governed context that fails to resolve fails closed instead of degrading into ordinary context-less execution", async () => {
  const restoreQuery = stubAuthenticatedFlowQueries();
  kaiServiceTestables.setResolveKaiRequestContextForTests(async () => ({
    ok: false,
    error: { code: "authorization_denied" },
  }));
  kaiServiceTestables.setAnthropicCreateForTests(async () => ({
    content: [{ type: "text", text: "Hi there." }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  }));

  try {
    const result = await handleKaiMessage({
      userId: USER_ID,
      userMessage: "List our governed claims for this org.",
      conversationId: "conv-1",
      tier: "pro",
      requestedOrganizationId: ORG,
    });
    assert.equal(result.error, true, "a requested-but-denied governed context must not silently become an ungoverned success");
  } finally {
    restoreQuery();
  }
});

test("authenticated requests that request governed context resolve it exactly once and pass it into executeToolCall for a governed tool", async () => {
  const restoreQuery = stubAuthenticatedFlowQueries();
  const contextCalls = [];
  const resolvedKaiContext = {
    actorContext: { actorType: "human", actorUserId: "90000000-0000-4000-8000-000000000001" },
    organizationContext: { organizationId: ORG },
    engagementContext: null,
  };
  kaiServiceTestables.setResolveKaiRequestContextForTests(async (input) => {
    contextCalls.push(input);
    return { ok: true, data: resolvedKaiContext, error: null };
  });

  const wrapperCalls = [];
  executorTestables.setGetClaimTraceabilitySummaryToolForTests(async (input) => {
    wrapperCalls.push(input);
    return { ok: true, data: { items: [] }, error: null };
  });
  let resolveActorCalls = 0;
  executorTestables.setResolveKaiActorContextForTests(async () => {
    resolveActorCalls += 1;
    return { ok: false, error_code: "unauthorized" };
  });

  let anthropicCallCount = 0;
  kaiServiceTestables.setAnthropicCreateForTests(async () => {
    anthropicCallCount += 1;
    if (anthropicCallCount === 1) {
      return {
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "list_governed_claims",
            input: { organizationId: ORG, limit: 10, afterClaimId: null },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }
    return {
      content: [{ type: "text", text: "Done." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });

  try {
    const result = await handleKaiMessage({
      userId: USER_ID,
      userMessage: "List our governed claims.",
      conversationId: "conv-1",
      tier: "pro",
      requestedOrganizationId: ORG,
    });

    assert.equal(result.error, undefined);
    assert.equal(contextCalls.length, 1);
    assert.deepEqual(contextCalls[0].req, { id: USER_ID });

    assert.equal(wrapperCalls.length, 1);
    assert.equal(wrapperCalls[0].actorContext.actorType, "human");
    assert.equal(wrapperCalls[0].actorContext.source, "public.userdata");
    assert.equal(resolveActorCalls, 0, "the runtime-resolved context must be reused, not re-derived per tool call");
  } finally {
    restoreQuery();
  }
});

test("executeToolCall denies a governed tool call that tries to switch organization away from the composed Package 1 context, before any governed data read", async () => {
  const wrapperCalls = [];
  executorTestables.setGetClaimTraceabilitySummaryToolForTests(async (input) => {
    wrapperCalls.push(input);
    return { ok: true, data: { items: [] }, error: null };
  });

  const kaiContext = {
    actorContext: { actorType: "human", actorUserId: "actor-authorized-for-both-orgs" },
    organizationContext: { organizationId: ORG },
  };

  const result = await executeToolCall(
    "list_governed_claims",
    { organizationId: ORG_B, limit: 10, afterClaimId: null },
    USER_ID,
    null,
    kaiContext,
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_boundary_violation");
  assert.equal(wrapperCalls.length, 0, "governed data must never be read for the mismatched organization");
});

test("executeToolCall allows a governed tool call whose organizationId matches the composed Package 1 context", async () => {
  const wrapperCalls = [];
  executorTestables.setGetClaimTraceabilitySummaryToolForTests(async (input) => {
    wrapperCalls.push(input);
    return { ok: true, data: { items: [] }, error: null };
  });

  const kaiContext = {
    actorContext: { actorType: "human", actorUserId: "actor" },
    organizationContext: { organizationId: ORG },
  };

  const result = await executeToolCall(
    "list_governed_claims",
    { organizationId: ORG, limit: 10, afterClaimId: null },
    USER_ID,
    null,
    kaiContext,
  );

  assert.equal(result.ok, true);
  assert.equal(wrapperCalls.length, 1);
});

test("executeToolCall reuses a pre-resolved kaiContext actor for governed tools instead of re-resolving it", async () => {
  let resolveActorCalls = 0;
  executorTestables.setResolveKaiActorContextForTests(async () => {
    resolveActorCalls += 1;
    return { ok: true, actorContext: { actorType: "human", actorUserId: "should-not-be-used" } };
  });
  const wrapperCalls = [];
  executorTestables.setGetClaimTraceabilitySummaryToolForTests(async (input) => {
    wrapperCalls.push(input);
    return { ok: true, data: {}, error: null };
  });

  const kaiContext = { actorContext: { actorType: "human", actorUserId: "pre-resolved-actor" } };
  const result = await executeToolCall(
    "list_governed_claims",
    { organizationId: ORG, limit: 10, afterClaimId: null },
    USER_ID,
    null,
    kaiContext,
  );

  assert.equal(result.ok, true);
  assert.equal(resolveActorCalls, 0);
  assert.equal(wrapperCalls.length, 1);
  assert.equal(wrapperCalls[0].actorContext.actorUserId, "pre-resolved-actor");
  assert.equal(wrapperCalls[0].actorContext.source, "public.userdata");
});

test("executeToolCall without a kaiContext still resolves the actor itself, unchanged from prior behavior", async () => {
  let resolveActorCalls = 0;
  executorTestables.setResolveKaiActorContextForTests(async () => {
    resolveActorCalls += 1;
    return { ok: true, actorContext: { actorType: "human", actorUserId: "fallback-resolved-actor" } };
  });
  const wrapperCalls = [];
  executorTestables.setGetClaimTraceabilitySummaryToolForTests(async (input) => {
    wrapperCalls.push(input);
    return { ok: true, data: {}, error: null };
  });

  const result = await executeToolCall(
    "list_governed_claims",
    { organizationId: ORG, limit: 10, afterClaimId: null },
    USER_ID,
    null,
  );

  assert.equal(result.ok, true);
  assert.equal(resolveActorCalls, 1);
  assert.equal(wrapperCalls[0].actorContext.actorUserId, "fallback-resolved-actor");
});

test("non-Sprint-2 tools ignore the kaiContext argument entirely", async () => {
  const result = await executeToolCall(
    "get_reporting_readiness_info",
    { topic: "materials" },
    null,
    null,
    { actorContext: { actorType: "human", actorUserId: "irrelevant" } },
  );
  assert.equal(result.status, "success");
});
