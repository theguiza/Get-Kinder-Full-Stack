import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import pool from "../Backend/db/pg.js";
import { handleKaiMessage, __testables as kaiServiceTestables } from "../Backend/services/kai.js";
import {
  getToolDefinitionsForKaiContext,
  IMPACT_EVIDENCE_LIBRARY_SURFACE,
} from "../Backend/services/kai-tool-definitions.js";
import { getImpactEvidenceLibrarySystemPrompt } from "../Backend/services/kai-prompts.js";

/**
 * Package 2: proves the governed Impact Evidence Library KAI surface -
 * ephemeral single-turn execution (Mode B), the surface-scoped governed
 * tool allowlist, and the sanitized model-visible context - without
 * touching the general/default KAI surface or Package 1's context
 * resolution/tenant-boundary behavior (covered by
 * kai-runtime-context-bootstrap.spec.js).
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "00000000-0000-4000-8000-0000000000e1";
const USER_ID = 424242;

test.afterEach(() => {
  kaiServiceTestables.resetAnthropicCreateForTests();
  kaiServiceTestables.resetResolveKaiRequestContextForTests();
});

function stubUserOnlyQuery() {
  const originalQuery = pool.query;
  pool.query = async (rawSql, params = []) => {
    const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
    const trimmed = sql.trim();
    if (trimmed === "SELECT * FROM userdata WHERE id = $1 LIMIT 1") {
      return { rows: [{ id: params[0], role: "volunteer" }], rowCount: 1 };
    }
    throw new Error(`Unhandled query in ephemeral-surface test: ${trimmed}`);
  };
  return () => {
    pool.query = originalQuery;
  };
}

test("Impact Evidence Library surface exposes only the governed evidence tools", () => {
  const tools = getToolDefinitionsForKaiContext("pro", { surface: IMPACT_EVIDENCE_LIBRARY_SURFACE });
  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "get_claim_traceability_summary",
    "list_client_followup_workflows",
    "list_eligible_claims_for_audience",
    "list_governed_claims",
    "list_organization_evidence_gaps",
  ]);
});

test("default surface and reporting_readiness surface are not widened by the new client-followup tool", () => {
  const defaultTools = getToolDefinitionsForKaiContext("pro", {}).map((tool) => tool.name);
  const guestTools = getToolDefinitionsForKaiContext("guest", {}).map((tool) => tool.name);
  const reportingTools = getToolDefinitionsForKaiContext("pro", { surface: "reporting_readiness" }).map(
    (tool) => tool.name,
  );
  assert.ok(!defaultTools.includes("list_client_followup_workflows"));
  assert.ok(!guestTools.includes("list_client_followup_workflows"));
  assert.ok(!reportingTools.includes("list_client_followup_workflows"));
});

test("Impact Evidence Library surface tool allowlist is unaffected by tier", () => {
  const proTools = getToolDefinitionsForKaiContext("pro", { surface: IMPACT_EVIDENCE_LIBRARY_SURFACE });
  const agentTools = getToolDefinitionsForKaiContext("agent", { surface: IMPACT_EVIDENCE_LIBRARY_SURFACE });
  assert.deepEqual(proTools.map((tool) => tool.name).sort(), agentTools.map((tool) => tool.name).sort());
});

test("default surface tool set is unchanged by the new Impact Evidence Library branch", () => {
  const defaultTools = getToolDefinitionsForKaiContext("pro", {}).map((tool) => tool.name).sort();
  assert.ok(defaultTools.includes("search_events"));
  assert.ok(defaultTools.includes("list_governed_claims"));
});

test("getImpactEvidenceLibrarySystemPrompt exposes only the authorized organization/engagement ids, never fabricated metadata", () => {
  const prompt = getImpactEvidenceLibrarySystemPrompt(null, {
    organizationContext: { organizationId: ORG },
    engagementContext: { engagementId: ENGAGEMENT },
  });
  assert.match(prompt, new RegExp(`Organization ID: ${ORG}`));
  assert.match(prompt, new RegExp(`Engagement ID: ${ENGAGEMENT}`));
  assert.doesNotMatch(prompt, /email/i);
  assert.doesNotMatch(prompt, /membership/i);
  assert.doesNotMatch(prompt, /role/i);
});

test("getImpactEvidenceLibrarySystemPrompt does not fabricate a display name when only ids are available", () => {
  const prompt = getImpactEvidenceLibrarySystemPrompt(null, {
    organizationContext: { organizationId: ORG },
    engagementContext: null,
  });
  assert.match(prompt, /Engagement ID: not set/);
});

test("getImpactEvidenceLibrarySystemPrompt forbids the confirmed gap-status over-interpretations", () => {
  const prompt = getImpactEvidenceLibrarySystemPrompt(null, {
    organizationContext: { organizationId: ORG },
    engagementContext: { engagementId: ENGAGEMENT },
  });

  // unresolved != unassessed / human-review-not-occurred
  assert.match(prompt, /"unresolved" means only that no committed governed fact yet establishes an outcome/);
  assert.match(prompt, /Do not describe it as "unassessed"/);

  // unresolved != client action required
  assert.match(prompt, /or as meaning client action is required/);

  // resolved_risk_flagged != human reviewed / cleared
  assert.match(prompt, /"resolved_risk_flagged" means only that a committed governed fact discloses a risk, gap, or clarity issue/);
  assert.match(prompt, /Do not describe it as meaning a human reviewed it, that client action is required, or that the issue is cleared/);

  // gap status alone != audience blocker
  assert.match(prompt, /Never state or imply that a gap status blocks or affects eligibility for an audience/);
  assert.match(prompt, /Only say that if governed traceability or eligibility output for that claim actually establishes it/);

  // gap status alone != client action required (separate boundary line)
  assert.match(prompt, /Never state or imply that client input or action is required because of a gap's status alone/);
  assert.match(prompt, /Only say that if a governed client-follow-up result establishes an outstanding workflow/);

  // gap presence/status != governed priority ranking
  assert.match(prompt, /list_organization_evidence_gaps does not rank gaps by importance, severity, or priority/);
  assert.match(prompt, /report the gaps using their actual properties \(claim, dimension, assessment status\)/);
  assert.match(prompt, /do not present list order, status, or count as a priority ranking/);
});

test("source contract: handleKaiMessage's legacy org prompt path cannot be reached for the Impact Evidence Library surface", () => {
  const source = readFileSync(new URL("../Backend/services/kai.js", import.meta.url), "utf8");
  const promptSelectionIndex = source.indexOf("let systemPrompt = isImpactEvidenceLibrarySurface");
  assert.ok(promptSelectionIndex > -1);
  const branchSlice = source.slice(promptSelectionIndex, promptSelectionIndex + 400);
  assert.match(branchSlice, /getImpactEvidenceLibrarySystemPrompt\(user, kaiContext\)/);
});

test("ephemeral (persistConversation: false) requests never resolve/create a conversationId, load history, or persist messages", async () => {
  const restoreQuery = stubUserOnlyQuery();
  kaiServiceTestables.setResolveKaiRequestContextForTests(async () => ({
    ok: true,
    data: {
      actorContext: { actorType: "human", actorUserId: "actor-1" },
      organizationContext: { organizationId: ORG },
      engagementContext: { engagementId: ENGAGEMENT, organizationId: ORG },
    },
    error: null,
  }));
  kaiServiceTestables.setAnthropicCreateForTests(async () => ({
    content: [{ type: "text", text: "Here is what the governed claims show." }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  }));

  try {
    const result = await handleKaiMessage({
      userId: USER_ID,
      userMessage: "What claims are eligible for the funder audience?",
      conversationId: null,
      tier: "pro",
      surface: IMPACT_EVIDENCE_LIBRARY_SURFACE,
      requestedOrganizationId: ORG,
      requestedEngagementId: ENGAGEMENT,
      persistConversation: false,
    });

    assert.equal(result.error, undefined);
    assert.equal(result.conversationId, null, "no conversationId is ever returned in ephemeral mode");
    // stubUserOnlyQuery throws on any query other than the userdata lookup;
    // reaching this point without throwing proves no kai_conversations/
    // kai_messages read or write occurred.
  } finally {
    restoreQuery();
  }
});

test("a conversationId supplied by the caller is ignored in ephemeral mode (never reused, never echoed back)", async () => {
  const restoreQuery = stubUserOnlyQuery();
  kaiServiceTestables.setResolveKaiRequestContextForTests(async () => ({
    ok: true,
    data: {
      actorContext: { actorType: "human", actorUserId: "actor-1" },
      organizationContext: { organizationId: ORG },
      engagementContext: { engagementId: ENGAGEMENT, organizationId: ORG },
    },
    error: null,
  }));
  kaiServiceTestables.setAnthropicCreateForTests(async () => ({
    content: [{ type: "text", text: "Ok." }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  }));

  try {
    const result = await handleKaiMessage({
      userId: USER_ID,
      userMessage: "Hi",
      conversationId: "some-other-conversation",
      tier: "pro",
      surface: IMPACT_EVIDENCE_LIBRARY_SURFACE,
      requestedOrganizationId: ORG,
      requestedEngagementId: ENGAGEMENT,
      persistConversation: false,
    });
    assert.equal(result.conversationId, null);
  } finally {
    restoreQuery();
  }
});

test("general/default KAI requests are unaffected by persistConversation defaulting to true", () => {
  const source = readFileSync(new URL("../Backend/services/kai.js", import.meta.url), "utf8");
  assert.match(source, /persistConversation = true,/);
  assert.match(source, /if \(persistConversation\) \{/);
});

test("Backend/routes/kaiApi.js registers POST /impact-library/message with organization/engagement validation and no conversationId acceptance", () => {
  const source = readFileSync(new URL("../Backend/routes/kaiApi.js", import.meta.url), "utf8");
  assert.match(source, /router\.post\("\/impact-library\/message"/);
  const routeIndex = source.indexOf('router.post("/impact-library/message"');
  const nextRouteIndex = source.indexOf('router.post("/guest"', routeIndex);
  const routeSlice = source.slice(routeIndex, nextRouteIndex);
  assert.match(routeSlice, /resolveAuthenticatedKaiUser\(req\)/, "must require authentication");
  assert.doesNotMatch(
    routeSlice,
    /req\.body[^;]*conversationId|const \{[^}]*conversationId[^}]*\} = req\.body/,
    "must never destructure/read a conversationId from the request body",
  );
  assert.match(routeSlice, /conversationId: null/, "conversationId passed to handleKaiMessage is server-fixed, never client-supplied");
  assert.match(routeSlice, /organizationId.*engagementId|engagementId.*organizationId/s, "must require org+engagement");
  assert.match(routeSlice, /resolveKaiRequestContext\(/, "must resolve governed context before model execution");
  assert.match(routeSlice, /persistConversation: false/);
  assert.match(routeSlice, /surface: IMPACT_EVIDENCE_LIBRARY_SURFACE/);
});
