import test from "node:test";
import assert from "node:assert/strict";

import { validateAssistantBoundary } from "../Backend/kai/validators/assistantBoundaryValidators.js";

test("assistant boundary blocks restricted system/assistant operations", () => {
  const result = validateAssistantBoundary({
    actorContext: { actorType: "system" },
    operation: "issue_signed_read_url",
  });

  assert.equal(result.severity, "blocker");
  assert.equal(result.blocking_reason, "assistant_boundary");
});

test("assistant boundary permits non-restricted metadata operation", () => {
  const result = validateAssistantBoundary({
    actorContext: { actorType: "assistant" },
    operation: "read_intake",
  });

  assert.equal(result.severity, "pass");
});
