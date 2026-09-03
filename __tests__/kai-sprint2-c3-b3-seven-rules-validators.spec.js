import test from "node:test";
import assert from "node:assert/strict";

import * as pur001 from "../Backend/kai/validators/kaiOutcomeDefinedAssessmentValidators.js";
import * as stk001 from "../Backend/kai/validators/kaiStakeholderIdentifiedAssessmentValidators.js";
import * as data001 from "../Backend/kai/validators/kaiSourceGovernanceAssessmentValidators.js";
import * as data002 from "../Backend/kai/validators/kaiDataQualityDocumentedAssessmentValidators.js";
import * as data003 from "../Backend/kai/validators/kaiClaimEvidenceTraceabilityAssessmentValidators.js";
import * as contrib003 from "../Backend/kai/validators/kaiConflictGapTrackedAssessmentValidators.js";
import * as comm001 from "../Backend/kai/validators/kaiAudiencePermissionKnownAssessmentValidators.js";

function outcomeContext(overrides = {}) {
  return {
    impactOutcomeContextId: "11111111-1111-1111-1111-111111111111",
    outcomeKey: "outcome_a",
    outcomeStatement: "Stakeholders achieve X.",
    stakeholderKey: "stakeholder_a",
    stakeholderLabel: "Stakeholder A",
    ...overrides,
  };
}

test("ir_pur_001: empty universe -> not_satisfied; non-empty -> satisfied; fingerprint is deterministic and order-independent", () => {
  assert.equal(pur001.deriveRequirementAssessmentState({ outcomeContexts: [] }).assessmentState, "not_satisfied");
  assert.equal(pur001.deriveRequirementAssessmentState({ outcomeContexts: [outcomeContext()] }).assessmentState, "satisfied");
  const a = outcomeContext({ impactOutcomeContextId: "11111111-1111-1111-1111-111111111111" });
  const b = outcomeContext({ impactOutcomeContextId: "22222222-2222-2222-2222-222222222222" });
  const fp1 = pur001.computeRequirementAssessmentFingerprint({ outcomeContexts: [a, b] });
  const fp2 = pur001.computeRequirementAssessmentFingerprint({ outcomeContexts: [b, a] });
  assert.equal(fp1, fp2);
  const changed = pur001.computeRequirementAssessmentFingerprint({ outcomeContexts: [{ ...a, outcomeStatement: "Changed." }, b] });
  assert.notEqual(fp1, changed);
});

test("ir_stk_001: empty universe -> not_satisfied; non-empty -> satisfied; fingerprint material only over stakeholder fields", () => {
  assert.equal(stk001.deriveRequirementAssessmentState({ outcomeContexts: [] }).assessmentState, "not_satisfied");
  assert.equal(stk001.deriveRequirementAssessmentState({ outcomeContexts: [outcomeContext()] }).assessmentState, "satisfied");
  const base = outcomeContext();
  const fp1 = stk001.computeRequirementAssessmentFingerprint({ outcomeContexts: [base] });
  const sameStakeholderDifferentStatement = stk001.computeRequirementAssessmentFingerprint({
    outcomeContexts: [{ ...base, outcomeStatement: "A wholly different statement." }],
  });
  assert.equal(fp1, sameStakeholderDifferentStatement, "outcome_statement is not material to ir_stk_001's fingerprint");
  const differentStakeholder = stk001.computeRequirementAssessmentFingerprint({
    outcomeContexts: [{ ...base, stakeholderLabel: "Different Stakeholder" }],
  });
  assert.notEqual(fp1, differentStakeholder);
});

function evidenceSource(overrides = {}) {
  return {
    evidenceItemId: "e1",
    sourceId: "s1",
    sourceVersionId: "sv1",
    intakeSourceCandidateId: "c1",
    intakePromotionDecisionId: "d1",
    isCurrent: true,
    decisionStatus: "promoted",
    reviewedSourceType: "organization_primary_record",
    ...overrides,
  };
}

test("ir_data_001: N=0 not_satisfied; all current satisfied; all superseded needs_review; mixed partially_satisfied", () => {
  assert.equal(data001.deriveRequirementAssessmentState({ evidenceSources: [] }).assessmentState, "not_satisfied");
  assert.equal(
    data001.deriveRequirementAssessmentState({ evidenceSources: [evidenceSource()] }).assessmentState,
    "satisfied",
  );
  assert.equal(
    data001.deriveRequirementAssessmentState({ evidenceSources: [evidenceSource({ isCurrent: false })] }).assessmentState,
    "needs_review",
  );
  assert.equal(
    data001.deriveRequirementAssessmentState({
      evidenceSources: [evidenceSource({ evidenceItemId: "e1" }), evidenceSource({ evidenceItemId: "e2", isCurrent: false })],
    }).assessmentState,
    "partially_satisfied",
  );
});

function gap(overrides = {}) {
  return {
    gapLogItemId: "g1",
    claimId: "c1",
    evidenceItemId: "e1",
    sourceVersionId: "sv1",
    dimensionKey: "missingness",
    assessmentStatus: "resolved_risk_flagged",
    ...overrides,
  };
}

test("ir_data_002: N=0 not_satisfied; all resolved satisfied; all unresolved needs_review; mixed partially_satisfied", () => {
  assert.equal(data002.deriveRequirementAssessmentState({ gaps: [] }).assessmentState, "not_satisfied");
  assert.equal(data002.deriveRequirementAssessmentState({ gaps: [gap()] }).assessmentState, "satisfied");
  assert.equal(
    data002.deriveRequirementAssessmentState({ gaps: [gap({ assessmentStatus: "unresolved" })] }).assessmentState,
    "needs_review",
  );
  assert.equal(
    data002.deriveRequirementAssessmentState({
      gaps: [gap({ gapLogItemId: "g1" }), gap({ gapLogItemId: "g2", assessmentStatus: "unresolved" })],
    }).assessmentState,
    "partially_satisfied",
  );
});

test("ir_data_003: N=0 not_satisfied; all traced satisfied; all untraced not_satisfied (needs_review unreachable); mixed partially_satisfied", () => {
  assert.equal(data003.deriveRequirementAssessmentState({ claims: [] }).assessmentState, "not_satisfied");
  assert.equal(
    data003.deriveRequirementAssessmentState({ claims: [{ claimId: "c1", evidenceItemId: "e1" }] }).assessmentState,
    "satisfied",
  );
  assert.equal(
    data003.deriveRequirementAssessmentState({ claims: [{ claimId: "c1", evidenceItemId: null }] }).assessmentState,
    "not_satisfied",
  );
  assert.equal(
    data003.deriveRequirementAssessmentState({
      claims: [{ claimId: "c1", evidenceItemId: "e1" }, { claimId: "c2", evidenceItemId: null }],
    }).assessmentState,
    "partially_satisfied",
  );
});

test("ir_contrib_003: state mirrors ir_data_002's gap universe; conflictLinks are material to the fingerprint but not to state", () => {
  assert.equal(contrib003.deriveRequirementAssessmentState({ gaps: [] }).assessmentState, "not_satisfied");
  assert.equal(contrib003.deriveRequirementAssessmentState({ gaps: [gap()] }).assessmentState, "satisfied");
  assert.equal(
    contrib003.deriveRequirementAssessmentState({ gaps: [gap({ assessmentStatus: "unresolved" })] }).assessmentState,
    "needs_review",
  );
  const fpNoConflict = contrib003.computeRequirementAssessmentFingerprint({ gaps: [gap()], conflictLinks: [] });
  const fpWithConflict = contrib003.computeRequirementAssessmentFingerprint({
    gaps: [gap()],
    conflictLinks: [{ conflictGroupId: "cg1", claimId: "c1" }],
  });
  assert.notEqual(fpNoConflict, fpWithConflict, "conflict_group membership must be material to the fingerprint");
});

test("ir_comm_001: N=0 not_satisfied; all-known satisfied; all-unknown not_satisfied (needs_review unreachable); mixed partially_satisfied", () => {
  assert.equal(comm001.deriveRequirementAssessmentState({ claims: [] }).assessmentState, "not_satisfied");
  assert.equal(
    comm001.deriveRequirementAssessmentState({
      claims: [{ claimId: "c1", decisionId: "d1", approvedAudiences: ["internal"] }],
    }).assessmentState,
    "satisfied",
  );
  assert.equal(
    comm001.deriveRequirementAssessmentState({ claims: [{ claimId: "c1", decisionId: null, approvedAudiences: null }] })
      .assessmentState,
    "not_satisfied",
  );
  assert.equal(
    comm001.deriveRequirementAssessmentState({
      claims: [{ claimId: "c1", decisionId: "d1", approvedAudiences: ["internal"] }, { claimId: "c2", decisionId: null, approvedAudiences: null }],
    }).assessmentState,
    "partially_satisfied",
  );
  // A current decision that names no approved audience yet (e.g. rejected) is
  // also UNKNOWN, not an error.
  assert.equal(
    comm001.deriveRequirementAssessmentState({ claims: [{ claimId: "c1", decisionId: "d1", approvedAudiences: null }] })
      .assessmentState,
    "not_satisfied",
  );
});
