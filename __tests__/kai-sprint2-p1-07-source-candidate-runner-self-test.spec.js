import test from "node:test";
import assert from "node:assert/strict";

import { assertNoFail } from "../scripts/kai-sprint2-p1-07-source-candidate-runner-assertions.js";

test("assertNoFail throws when a returned status cell is exactly FAIL", () => {
  const output = [
    " result_type   | check_name   | object_name                    | status | detail",
    " P1_07_CATALOG | TABLE_EXISTS | kai.intake_source_candidates   | FAIL   | missing table",
  ].join("\n");
  assert.throws(() => assertNoFail("P1-07 catalog verifier", output), /reported FAIL/);
});

test("assertNoFail does not throw on PASS-only output", () => {
  const output = [
    " result_type   | check_name   | object_name                    | status | detail",
    " P1_07_CATALOG | TABLE_EXISTS | kai.intake_source_candidates   | PASS   | ok",
  ].join("\n");
  assert.doesNotThrow(() => assertNoFail("P1-07 catalog verifier", output));
});

test("assertNoFail does not throw when a check name merely contains FAIL_CLOSED", () => {
  const output = [
    " result_type | check_name                | object_name                   | status | detail",
    " P1_07_SMOKE | FAIL_CLOSED_DEFAULTS_ONLY | kai.intake_source_candidates  | PASS   | candidate_status defaults to needs_gk_review",
  ].join("\n");
  assert.doesNotThrow(() => assertNoFail("P1-07 smoke verifier", output));
});
