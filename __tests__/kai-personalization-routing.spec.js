import test from "node:test";
import assert from "node:assert/strict";

import { handleKaiMessage, __testables as kaiServiceTestables } from "../Backend/services/kai.js";
import { getToolDefinitionsForKaiContext } from "../Backend/services/kai-tool-definitions.js";
import { executeToolCall } from "../Backend/services/kai-tool-executor.js";

test("recommendation-style prompts favor get_matched_events", () => {
  const hint = kaiServiceTestables.selectDiscoveryToolHint(
    "What are the best volunteer events for me right now?",
    new Set(["search_events", "get_matched_events"]),
  );

  assert.equal(hint?.toolName, "get_matched_events");
  assert.match(hint?.instruction || "", /personalized recommendation/i);
});

test("generic discovery prompts favor search_events", () => {
  const hint = kaiServiceTestables.selectDiscoveryToolHint(
    "Find environmental volunteer events this weekend in Victoria",
    new Set(["search_events", "get_matched_events"]),
  );

  assert.equal(hint?.toolName, "search_events");
  assert.match(hint?.instruction || "", /explicit discovery/i);
});

test("routing stays neutral when event-discovery tools are unavailable", () => {
  const hint = kaiServiceTestables.selectDiscoveryToolHint(
    "What should I do this weekend?",
    new Set(["platform_faq"]),
  );

  assert.equal(hint, null);
});

test("reporting-readiness routing maps generic discovery language to readiness guidance", () => {
  const hints = kaiServiceTestables.selectReportingReadinessToolHints(
    "What should I do to find the right reporting opportunities for our grant renewal?",
    new Set(["get_reporting_readiness_info", "assess_reporting_readiness_question"]),
  );

  assert.deepEqual(
    hints.map((hint) => hint.toolName),
    ["assess_reporting_readiness_question"],
  );
  assert.match(hints[0]?.instruction || "", /reporting-readiness guidance/i);
});

test("reporting-readiness surface exposes read-only reporting tools for guests", () => {
  const tools = getToolDefinitionsForKaiContext("guest", { surface: "reporting_readiness" })
    .map((tool) => tool.name);

  assert.deepEqual(tools, [
    "platform_faq",
    "get_reporting_readiness_info",
    "assess_reporting_readiness_question",
  ]);
});

test("default guest surface keeps existing event discovery tools", () => {
  const tools = getToolDefinitionsForKaiContext("guest", { surface: "default" })
    .map((tool) => tool.name);

  assert.deepEqual(tools, ["search_events"]);
});

test("reporting-readiness tools are executable for non-signed-in users", async () => {
  const info = await executeToolCall("get_reporting_readiness_info", { topic: "materials" }, null, null);
  assert.equal(info.status, "success");
  assert.equal(info.topic, "materials");
  assert.match(info.data.summary, /grant reports/i);

  const assessment = await executeToolCall(
    "assess_reporting_readiness_question",
    { question: "Our outcome data is in spreadsheets and we have a grant renewal soon." },
    null,
    null,
  );
  assert.equal(assessment.status, "success");
  assert.ok(assessment.signals.includes("reporting_pressure"));
  assert.ok(assessment.signals.includes("scattered_data"));
  assert.ok(assessment.signals.includes("outcome_evidence_gap"));
});

test("reporting-readiness surface sends reporting prompt and tools to Anthropic", async () => {
  const capturedPayloads = [];
  kaiServiceTestables.setAnthropicCreateForTests(async (payload) => {
    capturedPayloads.push(payload);
    return {
      content: [{ type: "text", text: "Reporting readiness response." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });

  try {
    const result = await handleKaiMessage({
      userId: null,
      userMessage: "What materials should we prepare for reporting readiness?",
      conversationId: null,
      tier: "guest",
      surface: "reporting_readiness",
    });

    assert.equal(result.error, undefined);
    assert.equal(result.message, "Reporting readiness response.");
    assert.equal(capturedPayloads.length, 1);
    assert.match(capturedPayloads[0].system, /funder-grade impact reporting/i);
    assert.deepEqual(
      capturedPayloads[0].tools.map((tool) => tool.name),
      ["platform_faq", "get_reporting_readiness_info", "assess_reporting_readiness_question"],
    );
    assert.match(JSON.stringify(capturedPayloads[0].messages), /get_reporting_readiness_info/);
  } finally {
    kaiServiceTestables.resetAnthropicCreateForTests();
  }
});

test("reporting-readiness surface does not expose or hint search_events", async () => {
  const capturedPayloads = [];
  kaiServiceTestables.setAnthropicCreateForTests(async (payload) => {
    capturedPayloads.push(payload);
    return {
      content: [{ type: "text", text: "Reporting readiness response." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });

  try {
    const result = await handleKaiMessage({
      userId: null,
      userMessage: "Find opportunities for us this weekend. What should I do?",
      conversationId: null,
      tier: "guest",
      surface: "reporting_readiness",
    });

    assert.equal(result.error, undefined);
    assert.equal(capturedPayloads.length, 1);
    const toolNames = capturedPayloads[0].tools.map((tool) => tool.name);
    assert.notDeepEqual(toolNames, ["search_events"]);
    assert.equal(toolNames.includes("search_events"), false);

    const serializedMessages = JSON.stringify(capturedPayloads[0].messages);
    assert.doesNotMatch(serializedMessages, /Use the search_events tool/i);
    assert.match(serializedMessages, /assess_reporting_readiness_question/);
  } finally {
    kaiServiceTestables.resetAnthropicCreateForTests();
  }
});
