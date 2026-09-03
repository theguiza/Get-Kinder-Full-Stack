import { createHash } from "node:crypto";

/**
 * KAI C3.B3 requirement-assessment vocabulary, fingerprint, and state rule
 * for `ir_comm_001` ("Who a result is permitted to be shared with is known
 * before it is communicated"), organization scope only. Mirrors
 * kaiCommunicationAccountabilityAssessmentValidators.js's structure
 * (ir_comm_002) for shape - same governed universe (claims), same current-
 * lineage-head decision source, same style of divergence.
 *
 * Governed universe: every kai.claims row for the organization.
 * Per-claim classification: KNOWN (a current kai.claim_review_decisions
 * row exists with a non-null, non-empty approved_audiences array - only
 * populated when decision_outcome IN ('approved','approved_with_limitation')
 * per claim_review_decisions_p2_12_approved_audiences_check) vs UNKNOWN
 * (no current decision at all, OR a current decision with no approved
 * audience yet - e.g. rejected/needs_more_information). Both UNKNOWN cases
 * are definite, proven facts, not an indeterminate signal, so
 * `needs_review` is UNREACHABLE here, exactly like ir_comm_002.
 */

export const REQUIREMENT_KEY = "ir_comm_001";

export const REQUIREMENT_ASSESSMENT_STATES = Object.freeze([
  "satisfied",
  "partially_satisfied",
  "not_satisfied",
  "needs_review",
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNullableNonEmptyString(value) {
  return value === null || isNonEmptyString(value);
}

function isApprovedAudiencesValue(value) {
  return value === null || (Array.isArray(value) && value.every(isNonEmptyString));
}

function isClaimAudienceRow(row) {
  if (!row || typeof row !== "object") return false;
  if (!isNonEmptyString(row.claimId)) return false;
  if (!isNullableNonEmptyString(row.decisionId)) return false;
  if (!isApprovedAudiencesValue(row.approvedAudiences)) return false;
  if (row.decisionId === null && row.approvedAudiences !== null) return false;
  return true;
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isAudienceKnown(row) {
  return Array.isArray(row.approvedAudiences) && row.approvedAudiences.length > 0;
}

export function computeRequirementAssessmentFingerprint({ claims }) {
  if (!Array.isArray(claims) || !claims.every(isClaimAudienceRow)) {
    throw new TypeError("computeRequirementAssessmentFingerprint requires a valid claims array.");
  }
  const sorted = [...claims]
    .sort((a, b) => compareStrings(a.claimId, b.claimId))
    .map((row) => ({
      claim_id: row.claimId,
      decision_id: row.decisionId,
      approved_audiences: Array.isArray(row.approvedAudiences) ? [...row.approvedAudiences].sort(compareStrings) : null,
    }));
  const canonical = JSON.stringify({ fingerprint_version: "c3_b3_ir_comm_001_v1", claims: sorted });
  return createHash("sha256").update(canonical).digest("hex");
}

export function deriveRequirementAssessmentState({ claims }) {
  if (!Array.isArray(claims) || !claims.every(isClaimAudienceRow)) {
    throw new TypeError("deriveRequirementAssessmentState requires a valid claims array.");
  }
  const n = claims.length;
  const knownCount = claims.filter(isAudienceKnown).length;

  let assessmentState;
  if (n === 0) assessmentState = "not_satisfied";
  else if (knownCount === n) assessmentState = "satisfied";
  else if (knownCount === 0) assessmentState = "not_satisfied";
  else assessmentState = "partially_satisfied";

  const explanation =
    `${knownCount} of ${n} governed claims for this organization have a current review-decision naming at least ` +
    `one permitted audience; ${n - knownCount} have no permitted audience recorded yet.`;

  return { assessmentState, explanation, n, knownCount };
}

export const __audiencePermissionKnownAssessmentValidatorsTestables = Object.freeze({ isClaimAudienceRow, isAudienceKnown });
