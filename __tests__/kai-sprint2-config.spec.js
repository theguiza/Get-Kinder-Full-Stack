import test from "node:test";
import assert from "node:assert/strict";

import { isKaiSprint2Enabled, requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";

function restoreSprint2Flag(previous) {
  if (previous === undefined) {
    delete process.env.KAI_SPRINT2_ENABLED;
  } else {
    process.env.KAI_SPRINT2_ENABLED = previous;
  }
}

test("feature flag defaults disabled", () => {
  assert.equal(isKaiSprint2Enabled({}), false);
});

test("feature flag treats only true, 1, yes, or on as enabled", () => {
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "true" }), true);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "TRUE" }), true);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "1" }), true);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "yes" }), true);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "on" }), true);
});

test("feature flag false, missing, and unknown values fail closed", () => {
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "false" }), false);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "0" }), false);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "no" }), false);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "off" }), false);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "enabled" }), false);
  assert.equal(isKaiSprint2Enabled({ KAI_SPRINT2_ENABLED: "" }), false);
  assert.equal(isKaiSprint2Enabled({}), false);
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
  assert.equal(body.error.message, "KAI Sprint 2 intake is not enabled.");
  assert.equal(body.error.status, 403);
  assert.deepEqual(body.data, null);
  assert.deepEqual(body.blockers, []);
  assert.deepEqual(body.warnings, []);
  restoreSprint2Flag(previous);
});

test("feature flag enabled allows middleware to pass", () => {
  const previous = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "1";
  let called = false;
  requireKaiSprint2Enabled({}, {}, () => {
    called = true;
  });
  assert.equal(called, true);
  restoreSprint2Flag(previous);
});
