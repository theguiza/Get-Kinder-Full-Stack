import test from "node:test";
import assert from "node:assert/strict";

import { __testables as kaiServiceTestables } from "../Backend/services/kai.js";

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
