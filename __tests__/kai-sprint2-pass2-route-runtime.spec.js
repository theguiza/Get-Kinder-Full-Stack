import test from "node:test";
import assert from "node:assert/strict";

import { requireKaiSprint2Enabled } from "../Backend/kai/config/kaiSprint2Config.js";
import router from "../Backend/kai/routes/sprint2IntakeApi.js";

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
  };
}

test("feature flag OFF returns 403 feature_disabled before Sprint 2 route execution", () => {
  const original = process.env.KAI_SPRINT2_ENABLED;
  process.env.KAI_SPRINT2_ENABLED = "false";
  const res = createResponse();
  let nextCalled = false;

  requireKaiSprint2Enabled({}, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error.code, "feature_disabled");
  assert.equal(res.body.data, null);
  process.env.KAI_SPRINT2_ENABLED = original;
});

test("Pass 2 router exposes only metadata-intake admin surface", () => {
  const routePaths = router.stack.map((layer) => layer.route?.path).filter(Boolean);
  assert.deepEqual(routePaths.sort(), [
    "/admin/access-check",
    "/admin/batches",
    "/admin/batches/:intakeBatchId/file-reservations",
    "/status",
  ]);
});
