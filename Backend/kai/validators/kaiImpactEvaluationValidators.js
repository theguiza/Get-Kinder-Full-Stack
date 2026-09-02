import { pass, blocker } from "./types.js";

const VALIDATOR_KEYS = Object.freeze([
  "VAL-IEV-001",
  "VAL-IEV-002",
  "VAL-IEV-003",
  "VAL-IEV-004",
  "VAL-IEV-005",
]);

const ASSESSMENT_STATES = new Set([
  "supported",
  "supported_with_limitation",
  "not_supported",
  "needs_more_information",
  "not_applicable",
]);

const CITATION_REQUIRED_STATES = new Set(["supported", "supported_with_limitation", "not_supported"]);

function isBoundedNonEmptyString(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

/**
 * A2.1 boundary between AI-produced criterion results and anything a caller
 * may act on. `criteria` and `governedEvidence` are server-supplied,
 * tenant-valid, A1-persisted facts; `results` is untrusted model output. No
 * check here may pass a result whose criterion, claim, or evidence reference
 * was not itself supplied by the server.
 */
export function validateImpactEvaluationResults({ criteria, governedEvidence, results } = {}) {
  const criterionIds = new Set((criteria || []).map((criterion) => criterion.criterionId));
  const claimIds = new Set((governedEvidence || []).map((item) => item.claimId));
  const evidenceItemIds = new Set((governedEvidence || []).map((item) => item.evidenceItemId));
  const evidenceKeys = new Set(
    (governedEvidence || []).map((item) => `${item.claimId}:${item.evidenceItemId}`),
  );
  const outcomes = [];

  const resultCriterionIds = Array.isArray(results) ? results.map((result) => result.criterionId) : [];
  const coversAllCriteria =
    Array.isArray(results) &&
    resultCriterionIds.length === criterionIds.size &&
    new Set(resultCriterionIds).size === resultCriterionIds.length &&
    resultCriterionIds.every((criterionId) => criterionIds.has(criterionId));
  outcomes.push(
    coversAllCriteria
      ? pass("VAL-IEV-001", "Every server-supplied criterion has exactly one result.", {
          criterion_count: criterionIds.size,
        })
      : blocker("VAL-IEV-001", "Result set does not exactly match the server-supplied criteria.", {
          object_type: "impact_evaluation_result",
          blocking_reason: "criterion_coverage_mismatch",
        }),
  );

  const validStates = (results || []).every((result) => ASSESSMENT_STATES.has(result.assessmentState));
  outcomes.push(
    validStates
      ? pass("VAL-IEV-002", "Every result carries a recognized assessment state.")
      : blocker("VAL-IEV-002", "Result carries an unrecognized assessment state.", {
          object_type: "impact_evaluation_result",
          blocking_reason: "unknown_assessment_state",
        }),
  );

  const explanationsAndLimitationsOk = (results || []).every((result) => {
    if (!isBoundedNonEmptyString(result.safeExplanation, 2000)) return false;
    if (result.assessmentState === "supported_with_limitation") {
      return isBoundedNonEmptyString(result.limitationNotes, 2000);
    }
    return result.limitationNotes === null || result.limitationNotes === undefined;
  });
  outcomes.push(
    explanationsAndLimitationsOk
      ? pass("VAL-IEV-003", "Every result carries a safe explanation and correctly paired limitation notes.")
      : blocker("VAL-IEV-003", "Result is missing a safe explanation or misuses limitation notes.", {
          object_type: "impact_evaluation_result",
          blocking_reason: "explanation_or_limitation_pairing_invalid",
        }),
  );

  let unauthorizedCitationCount = 0;
  for (const result of results || []) {
    for (const claimId of result.claimIds || []) {
      if (!claimIds.has(claimId)) unauthorizedCitationCount += 1;
    }
    for (const evidenceItemId of result.evidenceItemIds || []) {
      if (!evidenceItemIds.has(evidenceItemId)) unauthorizedCitationCount += 1;
    }
  }
  outcomes.push(
    unauthorizedCitationCount === 0
      ? pass("VAL-IEV-004", "Every cited claim/evidence id was server-supplied and governed.")
      : blocker("VAL-IEV-004", "Result cites an unknown or unsupplied claim/evidence id.", {
          object_type: "impact_evaluation_result",
          blocking_reason: "unauthorized_citation",
          evidence: { unauthorized_count: unauthorizedCitationCount },
        }),
  );

  const citationCoverageOk = (results || []).every((result) => {
    if (!CITATION_REQUIRED_STATES.has(result.assessmentState)) return true;
    const resultClaimIds = result.claimIds || [];
    const resultEvidenceItemIds = result.evidenceItemIds || [];
    if (resultClaimIds.length === 0 || resultEvidenceItemIds.length === 0) return false;
    return resultClaimIds.some((claimId) =>
      resultEvidenceItemIds.some((evidenceItemId) => evidenceKeys.has(`${claimId}:${evidenceItemId}`)),
    );
  });
  outcomes.push(
    citationCoverageOk
      ? pass("VAL-IEV-005", "Every substantive result cites at least one governed claim/evidence pair.")
      : blocker("VAL-IEV-005", "A substantive result cites no governed claim/evidence pair.", {
          object_type: "impact_evaluation_result",
          blocking_reason: "missing_substantive_citation",
        }),
  );

  return {
    ok: outcomes.every((outcome) => outcome.severity === "pass"),
    results: outcomes,
    blockers: outcomes.filter((outcome) => outcome.severity === "blocker"),
  };
}

export const __impactEvaluationValidatorContract = Object.freeze({
  VALIDATOR_KEYS,
  ASSESSMENT_STATES,
  CITATION_REQUIRED_STATES,
});
