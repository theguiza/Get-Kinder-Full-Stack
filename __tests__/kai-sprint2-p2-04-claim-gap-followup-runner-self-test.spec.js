import test from "node:test";
import assert from "node:assert/strict";

import { assertNoFail } from "../scripts/kai-sprint2-p2-04-claim-gap-followup-runner-assertions.js";

test("assertNoFail throws when a returned status cell is exactly FAIL", () => {
  const output = [
    " result_type   | check_name   | object_name         | status | detail",
    " P2_04_CATALOG | TABLE_EXISTS | kai.gap_log_items    | FAIL   | missing table",
  ].join("\n");
  assert.throws(() => assertNoFail("P2-04 catalog verifier", output), /reported FAIL/);
});

test("assertNoFail does not throw on PASS-only output", () => {
  const output = [
    " result_type   | check_name   | object_name         | status | detail",
    " P2_04_CATALOG | TABLE_EXISTS | kai.gap_log_items    | PASS   | ok",
  ].join("\n");
  assert.doesNotThrow(() => assertNoFail("P2-04 catalog verifier", output));
});

test("assertNoFail does not throw when a check name merely contains FAIL_CLOSED", () => {
  const output = [
    " result_type | check_name                     | object_name          | status | detail",
    " P2_04_SMOKE | FAIL_CLOSED_PERMISSION_DEFAULT | kai.gap_log_items    | PASS   | permission predicate reapplied",
  ].join("\n");
  assert.doesNotThrow(() => assertNoFail("P2-04 smoke verifier", output));
});
