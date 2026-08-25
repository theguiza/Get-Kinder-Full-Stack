import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { getToolDefinitionsForKaiContext } from "../Backend/services/kai-tool-definitions.js";
import { executeToolCall, __testables as executorTestables } from "../Backend/services/kai-tool-executor.js";

/**
 * Package 14-03c: proves the existing production KAI runtime (tool
 * definitions + tool executor) exposes and dispatches the three Sprint-2
 * governed-claims assistant operations through
 * kaiAssistantClaimTraceabilityTool.js, using only server-resolved
 * actorContext, without bypassing or re-deriving the wrapper's own
 * authorization/output-validation logic (already proven by
 * kai-sprint2-p2-07-assistant-claim-traceability-tool-boundary.spec.js).
 */

const GOVERNED_CLAIMS_TOOL_NAMES = [
  "list_governed_claims",
  "get_claim_traceability_summary",
  "list_eligible_claims_for_audience",
];

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const CLAIM = "00000000-0000-4000-8000-000000000101";
const USER_ID = 424242;

function staffActorResolution(overrides = {}) {
  return {
    ok: true,
    actorContext: {
      actorType: "human",
      actorUserId: "90000000-0000-4000-8000-000000000001",
      legacyPublicUserdataId: USER_ID,
      email: "reviewer@example.org",
      firstname: "Rae",
      lastname: "Viewer",
      kaiUserStatus: "active",
      kaiRoles: [],
      organizationMemberships: [
        { organization_id: ORG, membership_status: "active", role_name: "gk_reviewer" },
      ],
      platformSuperuser: false,
      platformSuperuserAuthority: null,
      safeLegacyUser: { id: USER_ID, email: "reviewer@example.org", firstname: "Rae", lastname: "Viewer" },
      ...overrides,
    },
  };
}

test.afterEach(() => {
  executorTestables.resetResolveKaiActorContextForTests();
  executorTestables.resetGetClaimTraceabilitySummaryToolForTests();
});

test("runtime: production tool-definition set exposes the three Sprint-2 operations with the tested wrapper argument schemas for authenticated tiers", () => {
  for (const tier of ["free", "plus", "pro", "agent", "org_growth", "org_enterprise"]) {
    const tools = getToolDefinitionsForKaiContext(tier, { surface: "default" });
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    for (const name of GOVERNED_CLAIMS_TOOL_NAMES) {
      assert.ok(byName[name], `${tier} tier should include ${name}`);
    }

    assert.deepEqual(Object.keys(byName.list_governed_claims.input_schema.properties).sort(), [
      "afterClaimId",
      "limit",
      "organizationId",
    ]);
    assert.deepEqual(byName.list_governed_claims.input_schema.required.sort(), [
      "afterClaimId",
      "limit",
      "organizationId",
    ]);

    assert.deepEqual(Object.keys(byName.get_claim_traceability_summary.input_schema.properties).sort(), [
      "claimId",
      "organizationId",
      "requestedAudience",
    ]);
    assert.deepEqual(byName.get_claim_traceability_summary.input_schema.required.sort(), [
      "claimId",
      "organizationId",
      "requestedAudience",
    ]);

    assert.deepEqual(Object.keys(byName.list_eligible_claims_for_audience.input_schema.properties).sort(), [
      "afterClaimId",
      "limit",
      "organizationId",
      "requestedAudience",
    ]);
    assert.deepEqual(byName.list_eligible_claims_for_audience.input_schema.required.sort(), [
      "afterClaimId",
      "limit",
      "organizationId",
      "requestedAudience",
    ]);
  }
});

test("runtime: guest tier and the reporting-readiness surface never expose the governed-claims tools", () => {
  const guestDefault = getToolDefinitionsForKaiContext("guest", { surface: "default" }).map((t) => t.name);
  const guestReadiness = getToolDefinitionsForKaiContext("guest", { surface: "reporting_readiness" }).map((t) => t.name);
  const proReadiness = getToolDefinitionsForKaiContext("pro", { surface: "reporting_readiness" }).map((t) => t.name);

  for (const name of GOVERNED_CLAIMS_TOOL_NAMES) {
    assert.equal(guestDefault.includes(name), false);
    assert.equal(guestReadiness.includes(name), false);
    assert.equal(proReadiness.includes(name), false);
  }
});

test("runtime: no governed-claims tool schema exposes actorContext, role, membership, tenant, or raw-file/storage fields", () => {
  const tools = getToolDefinitionsForKaiContext("pro", { surface: "default" });
  const prohibited = /actorContext|actorUserId|role|membership|tenant|rawFile|storage|signedUrl|approval/i;
  for (const name of GOVERNED_CLAIMS_TOOL_NAMES) {
    const tool = tools.find((t) => t.name === name);
    const propertyNames = Object.keys(tool.input_schema.properties);
    for (const propertyName of propertyNames) {
      assert.doesNotMatch(propertyName, prohibited, `${name}.${propertyName}`);
    }
  }
});

test("runtime: source contract - kai-tool-executor.js never imports the underlying Sprint-2 services directly, only the assistant wrapper", () => {
  const source = readFileSync(new URL("../Backend/services/kai-tool-executor.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /kaiClaimLibraryService\.js|kaiClaimTraceabilityService\.js|kaiEligibleClaimsForAudienceService\.js/);
  assert.match(source, /from "\.\.\/kai\/services\/kaiAssistantClaimTraceabilityTool\.js"/);
});

test("runtime: guest/unauthenticated calls to governed-claims tools never resolve an actor or reach the wrapper", async () => {
  let resolveCalls = 0;
  let wrapperCalls = 0;
  executorTestables.setResolveKaiActorContextForTests(async () => {
    resolveCalls += 1;
    return staffActorResolution();
  });
  executorTestables.setGetClaimTraceabilitySummaryToolForTests(async () => {
    wrapperCalls += 1;
    return { ok: true, data: {}, error: null };
  });

  for (const name of GOVERNED_CLAIMS_TOOL_NAMES) {
    const result = await executeToolCall(name, { organizationId: ORG, limit: 10, afterClaimId: null }, null, null);
    assert.equal(result.code, "login_required");
  }
  assert.equal(resolveCalls, 0);
  assert.equal(wrapperCalls, 0);
});

test("runtime: each governed-claims tool dispatches exactly once through kaiAssistantClaimTraceabilityTool with server-resolved actorContext, not the underlying services", async () => {
  const resolveCalls = [];
  const wrapperCalls = [];
  executorTestables.setResolveKaiActorContextForTests(async (input) => {
    resolveCalls.push(input);
    return staffActorResolution();
  });
  executorTestables.setGetClaimTraceabilitySummaryToolForTests(async (input) => {
    wrapperCalls.push(input);
    return { ok: true, data: { marker: input.toolName }, error: null };
  });

  const argumentsByTool = {
    list_governed_claims: { organizationId: ORG, limit: 10, afterClaimId: null },
    get_claim_traceability_summary: { organizationId: ORG, claimId: CLAIM, requestedAudience: "internal" },
    list_eligible_claims_for_audience: { organizationId: ORG, requestedAudience: "internal", limit: 10, afterClaimId: null },
  };

  for (const name of GOVERNED_CLAIMS_TOOL_NAMES) {
    const result = await executeToolCall(name, argumentsByTool[name], USER_ID, null);
    assert.equal(result.data.marker, name);
  }

  assert.equal(resolveCalls.length, 3);
  for (const call of resolveCalls) {
    assert.deepEqual(call, { id: USER_ID });
  }

  assert.equal(wrapperCalls.length, 3);
  for (let i = 0; i < GOVERNED_CLAIMS_TOOL_NAMES.length; i += 1) {
    const call = wrapperCalls[i];
    assert.equal(call.toolName, GOVERNED_CLAIMS_TOOL_NAMES[i]);
    assert.deepEqual(call.arguments, argumentsByTool[GOVERNED_CLAIMS_TOOL_NAMES[i]]);
    assert.equal(call.actorContext.source, "public.userdata");
    assert.equal(call.actorContext.actorType, "human");
    assert.equal(call.actorContext.actorUserId, "90000000-0000-4000-8000-000000000001");
  }
});

test("runtime: an unmapped/unresolved actor is passed to the wrapper as null, never fabricated", async () => {
  executorTestables.setResolveKaiActorContextForTests(async () => ({
    ok: false,
    error_code: "mapped_kai_user_required",
  }));
  const wrapperCalls = [];
  executorTestables.setGetClaimTraceabilitySummaryToolForTests(async (input) => {
    wrapperCalls.push(input);
    return { ok: false, error: { code: "authorization_denied", status: 403 } };
  });

  const result = await executeToolCall(
    "list_governed_claims",
    { organizationId: ORG, limit: 10, afterClaimId: null },
    USER_ID,
    null,
  );

  assert.equal(result.error.code, "authorization_denied");
  assert.equal(wrapperCalls.length, 1);
  assert.equal(wrapperCalls[0].actorContext, null);
});

test("runtime: model/tool arguments cannot smuggle actorContext, role, or membership overrides past the real wrapper's exact-key argument validation", async (t) => {
  const originalSprint2 = process.env.KAI_SPRINT2_ENABLED;
  const originalAssistant = process.env.KAI_ASSISTANT_TOOLS_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  process.env.KAI_ASSISTANT_TOOLS_ENABLED = "true";
  t.after(() => {
    process.env.KAI_SPRINT2_ENABLED = originalSprint2;
    process.env.KAI_ASSISTANT_TOOLS_ENABLED = originalAssistant;
  });

  executorTestables.setResolveKaiActorContextForTests(async () => staffActorResolution());

  const spoofedArguments = {
    organizationId: ORG,
    limit: 10,
    afterClaimId: null,
    actorContext: {
      actorType: "human",
      actorUserId: "evil-actor",
      source: "public.userdata",
      organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
    },
  };

  const result = await executeToolCall("list_governed_claims", spoofedArguments, USER_ID, null);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("runtime: a resolved actor without an active org membership for the requested organization is denied by the real wrapper before any governed data read", async (t) => {
  const originalSprint2 = process.env.KAI_SPRINT2_ENABLED;
  const originalAssistant = process.env.KAI_ASSISTANT_TOOLS_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  process.env.KAI_ASSISTANT_TOOLS_ENABLED = "true";
  t.after(() => {
    process.env.KAI_SPRINT2_ENABLED = originalSprint2;
    process.env.KAI_ASSISTANT_TOOLS_ENABLED = originalAssistant;
  });

  executorTestables.setResolveKaiActorContextForTests(async () =>
    staffActorResolution({ organizationMemberships: [] }),
  );

  const result = await executeToolCall(
    "list_governed_claims",
    { organizationId: ORG, limit: 10, afterClaimId: null },
    USER_ID,
    null,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_boundary_violation");
});

test("runtime: a resolved actor with membership in a different organization is denied for a cross-tenant request by the real wrapper", async (t) => {
  const originalSprint2 = process.env.KAI_SPRINT2_ENABLED;
  const originalAssistant = process.env.KAI_ASSISTANT_TOOLS_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "true";
  process.env.KAI_ASSISTANT_TOOLS_ENABLED = "true";
  t.after(() => {
    process.env.KAI_SPRINT2_ENABLED = originalSprint2;
    process.env.KAI_ASSISTANT_TOOLS_ENABLED = originalAssistant;
  });

  executorTestables.setResolveKaiActorContextForTests(async () => staffActorResolution());

  const result = await executeToolCall(
    "list_governed_claims",
    { organizationId: OTHER_ORG, limit: 10, afterClaimId: null },
    USER_ID,
    null,
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "tenant_boundary_violation");
});

test("runtime: three-way Phase-14 separation survives runtime dispatch unmodified through executeToolCall", async () => {
  const governedResult = {
    ok: true,
    data: {
      items: [
        {
          claimId: CLAIM,
          evidenceItemId: "00000000-0000-4000-8000-000000000201",
          claimType: "finding",
          claimStatus: "proposed",
          claimReviewStatus: "needs_gk_review",
          claimStrength: "unassessed",
          reviewQueueItems: [],
        },
      ],
      limit: 10,
      afterClaimId: null,
      truncated: false,
      nextAfterClaimId: null,
    },
    error: null,
  };
  const eligibleResult = {
    ok: true,
    data: { requestedAudience: "internal", eligibleClaims: [], limit: 10, afterClaimId: null, truncated: false, nextAfterClaimId: null },
    error: null,
  };
  const traceabilityResult = {
    ok: true,
    data: {
      claim: { claim_id: CLAIM },
      eligible: false,
      blockerCodes: ["claim_review_unresolved"],
    },
    error: null,
  };

  executorTestables.setResolveKaiActorContextForTests(async () => staffActorResolution());
  executorTestables.setGetClaimTraceabilitySummaryToolForTests(async (input) => {
    if (input.toolName === "list_governed_claims") return governedResult;
    if (input.toolName === "list_eligible_claims_for_audience") return eligibleResult;
    return traceabilityResult;
  });

  const governed = await executeToolCall(
    "list_governed_claims",
    { organizationId: ORG, limit: 10, afterClaimId: null },
    USER_ID,
    null,
  );
  assert.ok(governed.data.items.some((item) => item.claimId === CLAIM));

  const eligible = await executeToolCall(
    "list_eligible_claims_for_audience",
    { organizationId: ORG, requestedAudience: "internal", limit: 10, afterClaimId: null },
    USER_ID,
    null,
  );
  assert.equal(eligible.data.eligibleClaims.some((entry) => entry.claimId === CLAIM), false);

  const traceability = await executeToolCall(
    "get_claim_traceability_summary",
    { organizationId: ORG, claimId: CLAIM, requestedAudience: "internal" },
    USER_ID,
    null,
  );
  assert.equal(traceability.data.eligible, false);
  assert.deepEqual(traceability.data.blockerCodes, ["claim_review_unresolved"]);
});

test("runtime: existing non-Sprint-2 tools and unknown tool names are unaffected by the new dispatch registration", async () => {
  const reportingInfo = await executeToolCall("get_reporting_readiness_info", { topic: "materials" }, null, null);
  assert.equal(reportingInfo.status, "success");

  const unknown = await executeToolCall("not_a_real_tool", {}, USER_ID, null);
  assert.equal(unknown.error, true);
  assert.match(unknown.message, /Unknown tool/);
});
