import test from "node:test";
import assert from "node:assert/strict";

import { isKaiSprint2Enabled, requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";

test("feature flag treats only true, 1, yes, or on as enabled", () => {
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "true" }), true);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "1" }), true);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "yes" }), true);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "on" }), true);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "enabled" }), false);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "" }), false);
});

test("feature flag disabled blocks Sprint 2 route middleware", () => {
  const previous = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "false";
  let statusCode = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      return body;
    },
  };

  const body = requireKaiSprint2Enabled({}, res, () => {
    throw new Error("next should not be called");
  });

  assert.equal(statusCode, 403);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "feature_disabled");
  assert.equal(body.error.status, 403);
  process.env.KAI_SPRINT2_ENABLED = previous;
});

test("feature flag enabled allows middleware to pass", () => {
  const previous = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "1";
  let called = false;
  requireKaiSprint2Enabled({}, {}, () => {
    called = true;
  });
  assert.equal(called, true);
  process.env.KAI_SPRINT2_ENABLED = previous;
});
