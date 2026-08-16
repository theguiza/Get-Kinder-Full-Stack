import { createHash } from "node:crypto";

/**
 * KAI P2-10 coverage-review-decision vocabulary and fingerprint: pure, no SQL,
 * no database access, no clock, no randomness. This is the single
 * authoritative definition of "current state" a GK reviewer's
 * accepted_internal_with_limitation decision is bound to - both
 * Backend/kai/dictionary/postgresCoverageReviewDecisionRepository.js (write
 * path) and Backend/kai/dictionary/postgresClaimTraceabilityRepository.js
 * (P2-06 read path) import this exact function, so a decision written against
 * one computed fingerprint can only ever be recognized as current by a reread
 * that recomputes the identical fingerprint from the identical fields. If any
 * bound fact changes (the dimension's own assessment_status/validator_key, its
 * P2-04 gap row, the claim/evidence review resolution, or the underlying
 * claim/evidence-item support-strength state), the recomputed fingerprint
 * differs and the old decision row silently stops matching - it is never
 * mutated, revoked, or deleted, it simply falls out of scope. This is the only
 * mechanism that makes a stale acceptance impossible; no separate "current"
 * flag or expiry column is required.
 */

export const COVERAGE_REVIEW_DECISION_TYPE = "accepted_internal_with_limitation";
export const COVERAGE_REVIEW_DECISION_ROLE = "gk_reviewer";

export const COVERAGE_REVIEW_DIMENSION_KEYS = Object.freeze([
  "missingness",
  "duplicates",
  "definition_clarity",
  "denominator_clarity",
  "time_period_clarity",
  "entity_level_clarity",
  "small_cell_risk",
  "conflicting_source_indicators",
  "requirement_alignment",
  "coverage_gaps",
]);

export function isCoverageReviewDimensionKey(value) {
  return COVERAGE_REVIEW_DIMENSION_KEYS.includes(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * Computes the deterministic state_fingerprint bound at write time and
 * recomputed at every read time. Every input must already be an authoritative,
 * freshly-read fact - never a caller-supplied or cached value.
 */
export function computeCoverageReviewDecisionFingerprint({
  claimId,
  dimensionKey,
  evidenceItemId,
  sourceVersionId,
  dimensionAssessmentStatus,
  dimensionValidatorKey,
  gapLogItemId,
  gapAssessmentStatus,
  claimReviewStatus,
  evidenceReviewStatus,
  claimStrength,
  supportStrength,
}) {
  const canonical = JSON.stringify({
    claim_id: claimId,
    dimension_key: dimensionKey,
    evidence_item_id: evidenceItemId,
    source_version_id: sourceVersionId,
    dimension_assessment_status: dimensionAssessmentStatus,
    dimension_validator_key: dimensionValidatorKey,
    gap_log_item_id: gapLogItemId,
    gap_assessment_status: gapAssessmentStatus,
    claim_review_status: claimReviewStatus,
    evidence_review_status: evidenceReviewStatus,
    claim_strength: claimStrength,
    support_strength: supportStrength,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function isValidStateFingerprint(value) {
  return isNonEmptyString(value) && /^[0-9a-f]{64}$/.test(value);
}

export const __coverageReviewDecisionValidatorsTestables = Object.freeze({
  isNonEmptyString,
});
