import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  REQUIREMENT_KEY,
  REQUIREMENT_ASSESSMENT_STATES,
  CLAIM_CLASSIFICATIONS,
  computeRequirementAssessmentFingerprint,
  deriveRequirementAssessmentState,
  __communicationAccountabilityAssessmentValidatorsTestables,
} from "../Backend/kai/validators/kaiCommunicationAccountabilityAssessmentValidators.js";

const { classifyClaim, isAccountable } = __communicationAccountabilityAssessmentValidatorsTestables;

function claimRow(decisionId, decidedBy = null, decidedByRole = null) {
  return {
    claimId: "22222222-2222-4222-8222-222222222222",
    decisionId,
    decidedBy: decisionId === null ? null : decidedBy,
    decidedByRole: decisionId === null ? null : decidedByRole,
  };
}

test("requirement key and vocabulary", () => {
  assert.equal(REQUIREMENT_KEY, "ir_comm_002");
  assert.deepEqual(
    [...REQUIREMENT_ASSESSMENT_STATES].sort(),
    ["needs_review", "not_satisfied", "partially_satisfied", "satisfied"].sort(),
  );
  assert.deepEqual([...CLAIM_CLASSIFICATIONS].sort(), ["ACCOUNTABLE", "NO_ACCOUNTABILITY"].sort());
});

test("classification is decision-existence-only: decision_outcome is never part of this row shape at all", () => {
  assert.equal(classifyClaim(claimRow(null)), "NO_ACCOUNTABILITY");
  assert.equal(classifyClaim(claimRow("d1", "11111111-1111-4111-8111-111111111111", "gk_reviewer")), "ACCOUNTABLE");
  assert.equal(isAccountable("ACCOUNTABLE"), true);
  assert.equal(isAccountable("NO_ACCOUNTABILITY"), false);
});

test("empty universe (n=0) is not_satisfied, fail-closed - never vacuously satisfied", () => {
  const result = deriveRequirementAssessmentState({ claims: [] });
  assert.equal(result.assessmentState, "not_satisfied");
  assert.equal(result.n, 0);
  assert.equal(result.accountableCount, 0);
});

test("all-accountable -> satisfied", () => {
  const result = deriveRequirementAssessmentState({
    claims: [
      claimRow("d1", "u1", "gk_reviewer"),
      claimRow("d2", "u2", "gk_admin"),
    ],
  });
  assert.equal(result.assessmentState, "satisfied");
  assert.equal(result.accountableCount, 2);
  assert.equal(result.n, 2);
});

test("all-NO_ACCOUNTABILITY -> not_satisfied, NEVER needs_review (the deliberate ir_contrib_002 divergence)", () => {
  const result = deriveRequirementAssessmentState({
    claims: [claimRow(null), claimRow(null)],
  });
  assert.equal(result.assessmentState, "not_satisfied");
  assert.notEqual(result.assessmentState, "needs_review");
  assert.equal(result.accountableCount, 0);
});

test("mixed accountable/no-accountability -> partially_satisfied", () => {
  const result = deriveRequirementAssessmentState({
    claims: [claimRow("d1", "u1", "gk_reviewer"), claimRow(null)],
  });
  assert.equal(result.assessmentState, "partially_satisfied");
});

test("needs_review is unreachable: no combination of inputs ever produces it", () => {
  const scenarios = [
    { claims: [] },
    { claims: [claimRow(null)] },
    { claims: [claimRow(null), claimRow(null)] },
    { claims: [claimRow("d1", "u1", "gk_reviewer")] },
    { claims: [claimRow("d1", "u1", "gk_reviewer"), claimRow(null)] },
  ];
  for (const scenario of scenarios) {
    assert.notEqual(deriveRequirementAssessmentState(scenario).assessmentState, "needs_review");
  }
});

test("decision_outcome content is immaterial to accountability - a rejected/needs_more_information outcome still names an accountable party (decision existence alone matters, so this row shape carries no outcome field at all)", () => {
  // The row shape intentionally has no decisionOutcome field - accountability
  // is proven purely by decisionId/decidedBy/decidedByRole existing.
  assert.equal(classifyClaim(claimRow("d1", "u1", "gk_reviewer")), "ACCOUNTABLE");
});

test("malformed row shapes are rejected with TypeError, fail-closed", () => {
  assert.throws(() => deriveRequirementAssessmentState({ claims: "not-an-array" }), TypeError);
  assert.throws(() => deriveRequirementAssessmentState({ claims: [{ claimId: "x" }] }), TypeError);
  assert.throws(() => computeRequirementAssessmentFingerprint({ claims: [{ claimId: "x", decisionId: "d1" }] }), TypeError);
  // decisionId non-null but decidedBy/decidedByRole null is malformed.
  assert.throws(
    () => deriveRequirementAssessmentState({ claims: [{ claimId: "x", decisionId: "d1", decidedBy: null, decidedByRole: null }] }),
    TypeError,
  );
  // decisionId null but decidedBy non-null is malformed (all three must agree).
  assert.throws(
    () => deriveRequirementAssessmentState({ claims: [{ claimId: "x", decisionId: null, decidedBy: "u1", decidedByRole: null }] }),
    TypeError,
  );
});

test("fingerprint version is exactly c3_b_ir_comm_002_v1 and is material only over claim_id/decision_id/decided_by/decided_by_role", () => {
  const base = { claims: [claimRow("d1", "u1", "gk_reviewer")] };
  const same = { claims: [claimRow("d1", "u1", "gk_reviewer")] };
  assert.equal(computeRequirementAssessmentFingerprint(base), computeRequirementAssessmentFingerprint(same));

  const decisionChanged = { claims: [claimRow("d2", "u1", "gk_reviewer")] };
  assert.notEqual(computeRequirementAssessmentFingerprint(base), computeRequirementAssessmentFingerprint(decisionChanged));

  const decidedByChanged = { claims: [claimRow("d1", "u2", "gk_reviewer")] };
  assert.notEqual(computeRequirementAssessmentFingerprint(base), computeRequirementAssessmentFingerprint(decidedByChanged));

  const roleChanged = { claims: [claimRow("d1", "u1", "gk_admin")] };
  assert.notEqual(computeRequirementAssessmentFingerprint(base), computeRequirementAssessmentFingerprint(roleChanged));

  // Verify the literal version string is baked into the canonical payload.
  const emptyFingerprint = computeRequirementAssessmentFingerprint({ claims: [] });
  const expected = crypto.createHash("sha256").update(JSON.stringify({ fingerprint_version: "c3_b_ir_comm_002_v1", claims: [] })).digest("hex");
  assert.equal(emptyFingerprint, expected);
});

test("fingerprint sorts claims by claim_id ascending regardless of input order", () => {
  const rowA = { claimId: "a", decisionId: null, decidedBy: null, decidedByRole: null };
  const rowB = { claimId: "b", decisionId: "d1", decidedBy: "u1", decidedByRole: "gk_reviewer" };
  const forward = computeRequirementAssessmentFingerprint({ claims: [rowA, rowB] });
  const reversed = computeRequirementAssessmentFingerprint({ claims: [rowB, rowA] });
  assert.equal(forward, reversed);
});
