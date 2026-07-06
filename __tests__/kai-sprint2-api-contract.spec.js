import test from "node:test";
import assert from "node:assert/strict";

import { __testables } from "../Backend/kai/routes/sprint2IntakeApi.js";

test("validator blockers map to 422 route behavior", () => {
  let statusCode = null;
  let jsonBody = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(body) {
      jsonBody = body;
      return body;
    },
  };

  __testables.sendServiceResult(res, {
    ok: false,
    error: { code: "validation_blocker", message: "blocked", status: 422 },
    blockers: [{ validator_key: "VAL-STO-001", severity: "blocker" }],
  });

  assert.equal(statusCode, 422);
  assert.equal(jsonBody.error.code, "validation_blocker");
});

test("api contract exposes Pass 2 status and admin metadata route shape", async () => {
  const { default: router } = await import("../Backend/kai/routes/sprint2IntakeApi.js");
  const statusLayer = router.stack.find((layer) => layer.route?.path === "/status");
  const batchLayer = router.stack.find((layer) => layer.route?.path === "/admin/batches");
  const fileLayer = router.stack.find((layer) => layer.route?.path === "/admin/batches/:intakeBatchId/file-reservations");
  assert.ok(statusLayer);
  assert.ok(batchLayer);
  assert.ok(fileLayer);
  assert.equal(Object.hasOwn(statusLayer.route.methods, "get"), true);
  assert.equal(Object.hasOwn(batchLayer.route.methods, "post"), true);
  assert.equal(Object.hasOwn(fileLayer.route.methods, "post"), true);
});
