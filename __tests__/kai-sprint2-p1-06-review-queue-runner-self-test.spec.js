import test from "node:test";
import assert from "node:assert/strict";

import { assertNoFail } from "../scripts/kai-sprint2-p1-06-review-queue-runner-assertions.js";

test("assertNoFail throws when a returned status cell is exactly FAIL", () => {
  const output = [
    " result_type   | check_name   | object_name              | status | detail",
    " P1_06_CATALOG | TABLE_EXISTS | kai.review_queue_items   | FAIL   | missing table",
  ].join("\n");
  assert.throws(() => assertNoFail("P1-06 catalog verifier", output), /reported FAIL/);
});

test("assertNoFail does not throw on PASS-only output", () => {
  const output = [
    " result_type   | check_name   | object_name              | status | detail",
    " P1_06_CATALOG | TABLE_EXISTS | kai.review_queue_items   | PASS   | ok",
  ].join("\n");
  assert.doesNotThrow(() => assertNoFail("P1-06 catalog verifier", output));
});

test("assertNoFail does not throw when a check name merely contains FAIL_CLOSED", () => {
  const output = [
    " result_type | check_name                | object_name             | status | detail",
    " P1_06_SMOKE | FAIL_CLOSED_DEFAULTS_ONLY | kai.review_queue_items  | PASS   | queue_status defaults to open",
  ].join("\n");
  assert.doesNotThrow(() => assertNoFail("P1-06 smoke verifier", output));
});
