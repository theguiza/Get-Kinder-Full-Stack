import test from "node:test";
import assert from "node:assert/strict";

import { assertNoFail } from "../scripts/kai-sprint2-p1-08-source-promotion-runner-assertions.js";

test("assertNoFail throws when a returned status cell is exactly FAIL", () => {
  const output = [
    " result_type   | check_name   | object_name                       | status | detail",
    " P1_08_CATALOG | TABLE_EXISTS | kai.intake_promotion_decisions    | FAIL   | missing table",
  ].join("\n");
  assert.throws(() => assertNoFail("P1-08 catalog verifier", output), /reported FAIL/);
});

test("assertNoFail does not throw on PASS-only output", () => {
  const output = [
    " result_type   | check_name   | object_name                       | status | detail",
    " P1_08_CATALOG | TABLE_EXISTS | kai.intake_promotion_decisions    | PASS   | ok",
  ].join("\n");
  assert.doesNotThrow(() => assertNoFail("P1-08 catalog verifier", output));
});

test("assertNoFail does not throw when a check name merely contains FAIL_CLOSED", () => {
  const output = [
    " result_type | check_name                     | object_name                    | status | detail",
    " P1_08_SMOKE | FAIL_CLOSED_PERMISSION_DEFAULT | kai.intake_promotion_decisions | PASS   | permission predicate reapplied",
  ].join("\n");
  assert.doesNotThrow(() => assertNoFail("P1-08 smoke verifier", output));
});
