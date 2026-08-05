import test from "node:test";
import assert from "node:assert/strict";

import { assertNoFail } from "../scripts/kai-sprint2-p1-05-intake-sensitivity-profile-runner-assertions.js";

test("assertNoFail throws when a returned status cell is exactly FAIL", () => {
  const output = [
    " result_type   | check_name   | object_name                      | status | detail",
    " P1_05_CATALOG | TABLE_EXISTS | kai.intake_sensitivity_profiles  | FAIL   | missing table",
  ].join("\n");
  assert.throws(() => assertNoFail("P1-05 catalog verifier", output), /reported FAIL/);
});

test("assertNoFail does not throw on PASS-only output", () => {
  const output = [
    " result_type   | check_name   | object_name                      | status | detail",
    " P1_05_CATALOG | TABLE_EXISTS | kai.intake_sensitivity_profiles  | PASS   | ok",
  ].join("\n");
  assert.doesNotThrow(() => assertNoFail("P1-05 catalog verifier", output));
});

test("assertNoFail does not throw when a check name merely contains FAIL_CLOSED", () => {
  const output = [
    " result_type | check_name                    | object_name                      | status | detail",
    " P1_05_SMOKE | FAIL_CLOSED_DEFAULTS_ONLY     | kai.intake_sensitivity_profiles  | PASS   | pii_status defaults to unknown",
  ].join("\n");
  assert.doesNotThrow(() => assertNoFail("P1-05 smoke verifier", output));
});
