import { __testables as boundedFileSecurityAssessorTestables } from "./boundedFileSecurityAssessor.js";

const { ASSESSOR_FAILED_CATEGORY_CLASSIFICATIONS } = boundedFileSecurityAssessorTestables;

export const POLICY_ELIGIBLE_FAILED_CATEGORIES = Object.freeze(
  new Set(
    Object.entries(ASSESSOR_FAILED_CATEGORY_CLASSIFICATIONS)
      .filter(([, classification]) => classification.policyFailureEligible === true)
      .map(([category]) => category),
  ),
);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Maps a bounded-assessor result to a policy-decision outcome:
 * "passed" | "blocked" | "failed" -> eligible for a terminal policy mutation;
 * null -> assessment ran but is not policy-decision-eligible (e.g. malware
 * scanning not configured), so the file must stay pending/quarantined;
 * undefined -> the result shape is unclassified and must be treated as a
 * fail-closed error, never as a policy pass.
 */
export function policyDecisionOutcomeForAssessmentResult(result) {
  if (
    isPlainObject(result) &&
    result.ok === false &&
    result.integrity_failure?.type === "assessment_read_integrity_failure"
  ) {
    return null;
  }
  if (isPlainObject(result) && Object.keys(result).length === 1 && result.policy === "pass") {
    return "passed";
  }
  if (
    isPlainObject(result) &&
    Object.keys(result).length === 2 &&
    result.policy === "block" &&
    typeof result.category === "string"
  ) {
    return "blocked";
  }
  if (
    isPlainObject(result) &&
    Object.keys(result).length === 2 &&
    result.status === "failed" &&
    typeof result.category === "string"
  ) {
    if (POLICY_ELIGIBLE_FAILED_CATEGORIES.has(result.category)) return "failed";
    if (Object.hasOwn(ASSESSOR_FAILED_CATEGORY_CLASSIFICATIONS, result.category)) return null;
    return undefined;
  }
  return undefined;
}

export const __testables = Object.freeze({
  POLICY_ELIGIBLE_FAILED_CATEGORIES,
  policyDecisionOutcomeForAssessmentResult,
});
