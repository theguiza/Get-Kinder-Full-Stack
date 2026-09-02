import test from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_REQUIREMENT_KEY,
  REQUIREMENT_ASSESSMENT_STATES,
  computeRequirementAssessmentFingerprint,
  deriveRequirementAssessmentState,
  __requirementAssessmentValidatorsTestables,
} from "../Backend/kai/validators/kaiRequirementAssessmentValidators.js";

const { classifyEvidenceItem, classifyClaim, classifyGapOverlay, isResolved } = __requirementAssessmentValidatorsTestables;

function evidenceRow(decisionId, decisionOutcome) {
  return { evidenceItemId: "11111111-1111-4111-8111-111111111111", decisionId, decisionOutcome };
}

function claimRow(decisionId, decisionOutcome, gaps = []) {
  return { claimId: "22222222-2222-4222-8222-222222222222", decisionId, decisionOutcome, gaps };
}

function gap(gapLogItemId, assessmentStatus, dimensionKey = "missingness") {
  return { gapLogItemId, dimensionKey, assessmentStatus };
}

test("this is the pure algorithm C3A3.B replaces the retired N/R count with entirely", () => {
  assert.equal(SUPPORTED_REQUIREMENT_KEY, "ir_contrib_002");
  assert.deepEqual([...REQUIREMENT_ASSESSMENT_STATES].sort(), ["needs_review", "not_satisfied", "partially_satisfied", "satisfied"].sort());
});

test("no governed objects follows final contract: N = 0 -> not_satisfied", () => {
  const result = deriveRequirementAssessmentState({ evidenceItems: [], claims: [] });
  assert.equal(result.assessmentState, "not_satisfied");
  assert.equal(result.n, 0);
  assert.equal(result.resolvedCount, 0);
});

test("governed object with no current decision follows final contract: unresolved, contributes toward needs_review/partially_satisfied", () => {
  assert.equal(classifyEvidenceItem(evidenceRow(null, null)), "unresolved");
  assert.equal(classifyClaim(claimRow(null, null, [])), "unresolved");

  const allUnresolved = deriveRequirementAssessmentState({
    evidenceItems: [evidenceRow(null, null)],
    claims: [claimRow(null, null, [])],
  });
  assert.equal(allUnresolved.assessmentState, "needs_review");

  const mixed = deriveRequirementAssessmentState({
    evidenceItems: [evidenceRow("d1", "supported")],
    claims: [claimRow(null, null, [])],
  });
  assert.equal(mixed.assessmentState, "partially_satisfied");
});

test("not_supported/rejected follows final contract: a fully-decided negative outcome is resolved (confidence_failure), not unresolved", () => {
  assert.equal(classifyEvidenceItem(evidenceRow("d1", "not_supported")), "confidence_failure");
  assert.equal(classifyClaim(claimRow("d1", "rejected", [])), "confidence_failure");
  assert.equal(isResolved("confidence_failure"), true);

  const result = deriveRequirementAssessmentState({
    evidenceItems: [evidenceRow("d1", "not_supported")],
    claims: [claimRow("d2", "rejected", [])],
  });
  assert.equal(result.assessmentState, "satisfied");
  assert.equal(result.resolvedCount, 2);
});

test("needs_more_information is unresolved for both evidence and claim decisions", () => {
  assert.equal(classifyEvidenceItem(evidenceRow("d1", "needs_more_information")), "unresolved");
  assert.equal(classifyClaim(claimRow("d1", "needs_more_information", [])), "unresolved");
  assert.equal(isResolved("unresolved"), false);
});

test("_with_limitation uses current decision: supported_with_limitation/approved_with_limitation classify as documented_limitation and are resolved", () => {
  assert.equal(classifyEvidenceItem(evidenceRow("d1", "supported_with_limitation")), "documented_limitation");
  assert.equal(classifyClaim(claimRow("d1", "approved_with_limitation", [])), "documented_limitation");
  assert.equal(isResolved("documented_limitation"), true);
});

test("supported/approved cannot hide a current gap: an unresolved current gap always wins over an approved/supported decision", () => {
  assert.equal(classifyGapOverlay([gap("g1", "unresolved")]), "unresolved");
  assert.equal(classifyClaim(claimRow("d1", "approved", [gap("g1", "unresolved")])), "unresolved");
});

test("supported/approved cannot hide a current gap: a resolved_risk_flagged current gap upgrades a no-limitation decision to documented_limitation", () => {
  assert.equal(classifyGapOverlay([gap("g1", "resolved_risk_flagged")]), "documented_limitation");
  assert.equal(classifyClaim(claimRow("d1", "approved", [gap("g1", "resolved_risk_flagged")])), "documented_limitation");
});

test("a current gap never downgrades an already-disclosed decision (confidence_failure/documented_limitation stay as-is)", () => {
  assert.equal(classifyClaim(claimRow("d1", "rejected", [gap("g1", "resolved_risk_flagged")])), "confidence_failure");
  assert.equal(classifyClaim(claimRow("d1", "approved_with_limitation", [gap("g1", "resolved_risk_flagged")])), "documented_limitation");
});

test("no current decision plus a currently-applicable gap is representable and resolved via the gap alone (documented, not undocumented)", () => {
  assert.equal(classifyClaim(claimRow(null, null, [gap("g1", "resolved_risk_flagged")])), "documented_limitation");
  assert.equal(classifyClaim(claimRow(null, null, [gap("g1", "unresolved")])), "unresolved");
});

test("all four final states are reachable and none is derived by counting non-'unassessed' strength rows", () => {
  assert.equal(deriveRequirementAssessmentState({ evidenceItems: [], claims: [] }).assessmentState, "not_satisfied");
  assert.equal(
    deriveRequirementAssessmentState({ evidenceItems: [evidenceRow(null, null)], claims: [] }).assessmentState,
    "needs_review",
  );
  assert.equal(
    deriveRequirementAssessmentState({
      evidenceItems: [evidenceRow("d1", "supported"), evidenceRow(null, null)],
      claims: [],
    }).assessmentState,
    "partially_satisfied",
  );
  assert.equal(
    deriveRequirementAssessmentState({ evidenceItems: [evidenceRow("d1", "supported")], claims: [] }).assessmentState,
    "satisfied",
  );
});

test("fingerprint is material only over current decision id/outcome and currently-applicable gap id/dimension/status", () => {
  const base = {
    evidenceItems: [evidenceRow("d1", "supported")],
    claims: [claimRow("d2", "approved", [gap("g1", "resolved_risk_flagged")])],
  };
  const same = {
    evidenceItems: [evidenceRow("d1", "supported")],
    claims: [claimRow("d2", "approved", [gap("g1", "resolved_risk_flagged")])],
  };
  assert.equal(computeRequirementAssessmentFingerprint(base), computeRequirementAssessmentFingerprint(same));

  const decisionChanged = {
    evidenceItems: [evidenceRow("d1", "supported")],
    claims: [claimRow("d3", "approved", [gap("g1", "resolved_risk_flagged")])],
  };
  assert.notEqual(computeRequirementAssessmentFingerprint(base), computeRequirementAssessmentFingerprint(decisionChanged));

  const gapChanged = {
    evidenceItems: [evidenceRow("d1", "supported")],
    claims: [claimRow("d2", "approved", [gap("g1", "unresolved")])],
  };
  assert.notEqual(computeRequirementAssessmentFingerprint(base), computeRequirementAssessmentFingerprint(gapChanged));

  const gapRemoved = {
    evidenceItems: [evidenceRow("d1", "supported")],
    claims: [claimRow("d2", "approved", [])],
  };
  assert.notEqual(computeRequirementAssessmentFingerprint(base), computeRequirementAssessmentFingerprint(gapRemoved));
});

test("old v1 assessment is not current: the retired strength-count input shape is no longer a valid fingerprint input at all", () => {
  const v1ShapedEvidence = [{ evidenceItemId: "11111111-1111-4111-8111-111111111111", supportStrength: "reviewed_supported" }];
  assert.throws(() => computeRequirementAssessmentFingerprint({ evidenceItems: v1ShapedEvidence, claims: [] }), TypeError);
  assert.throws(() => deriveRequirementAssessmentState({ evidenceItems: v1ShapedEvidence, claims: [] }), TypeError);
});
