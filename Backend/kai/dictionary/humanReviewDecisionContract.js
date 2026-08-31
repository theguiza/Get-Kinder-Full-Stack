/**
 * KAI P2-12 (Problem A1) human-review-decision vocabulary. Mirrors
 * humanAuthorityDecisionContract.js's style exactly: frozen exports, no
 * side effects, no database access. This is the single source of truth for
 * the outcome vocabulary admitted by kai.evidence_review_decisions /
 * kai.claim_review_decisions (see
 * migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql) and for the
 * domain-column projections those decisions drive on kai.evidence_items /
 * kai.claims (see Backend/kai/dictionary/postgresHumanReviewRepository.js).
 */
export const EVIDENCE_REVIEW_DECISION_OUTCOMES = Object.freeze([
  "supported",
  "supported_with_limitation",
  "not_supported",
  "needs_more_information",
]);

export const CLAIM_REVIEW_DECISION_OUTCOMES = Object.freeze([
  "approved",
  "approved_with_limitation",
  "rejected",
  "needs_more_information",
]);

export const CLAIM_REVIEW_APPROVED_AUDIENCE_VALUES = Object.freeze(["internal", "funder", "public"]);

export const EVIDENCE_REVIEW_TERMINAL_OUTCOMES = Object.freeze([
  "supported",
  "supported_with_limitation",
  "not_supported",
]);

export const CLAIM_REVIEW_TERMINAL_OUTCOMES = Object.freeze([
  "approved",
  "approved_with_limitation",
  "rejected",
]);

export const EVIDENCE_REVIEW_LIMITATION_REQUIRED_OUTCOMES = Object.freeze(["supported_with_limitation"]);

export const CLAIM_REVIEW_LIMITATION_REQUIRED_OUTCOMES = Object.freeze(["approved_with_limitation"]);

export const CLAIM_REVIEW_AUDIENCE_REQUIRED_OUTCOMES = Object.freeze(["approved", "approved_with_limitation"]);

export const DECISION_ALLOWED_ROLES = Object.freeze(["gk_reviewer", "gk_admin"]);

export function isEvidenceReviewDecisionOutcome(value) {
  return EVIDENCE_REVIEW_DECISION_OUTCOMES.includes(value);
}

export function isClaimReviewDecisionOutcome(value) {
  return CLAIM_REVIEW_DECISION_OUTCOMES.includes(value);
}

export function isEvidenceReviewTerminalOutcome(outcome) {
  return EVIDENCE_REVIEW_TERMINAL_OUTCOMES.includes(outcome);
}

export function isClaimReviewTerminalOutcome(outcome) {
  return CLAIM_REVIEW_TERMINAL_OUTCOMES.includes(outcome);
}

export function evidenceReviewLimitationNotesRequired(outcome) {
  return EVIDENCE_REVIEW_LIMITATION_REQUIRED_OUTCOMES.includes(outcome);
}

export function claimReviewLimitationNotesRequired(outcome) {
  return CLAIM_REVIEW_LIMITATION_REQUIRED_OUTCOMES.includes(outcome);
}

export function claimReviewApprovedAudiencesRequired(outcome) {
  return CLAIM_REVIEW_AUDIENCE_REQUIRED_OUTCOMES.includes(outcome);
}

/**
 * Domain-column projections: what evidence_items.evidence_review_status /
 * claims.claim_review_status become after a decision of this outcome is
 * recorded. A terminal outcome resolves the review; needs_more_information
 * reopens (or leaves open) the review.
 */
export function evidenceReviewStatusForOutcome(outcome) {
  return isEvidenceReviewTerminalOutcome(outcome) ? "reviewed" : "needs_gk_review";
}

export function claimReviewStatusForOutcome(outcome) {
  return isClaimReviewTerminalOutcome(outcome) ? "reviewed" : "needs_gk_review";
}

/**
 * Domain-column projections for evidence_items.support_strength /
 * claims.claim_strength. A positive terminal outcome resolves to
 * 'reviewed_supported'; a negative terminal outcome resolves to
 * 'reviewed_not_supported' (permanently ineligible, never treated as
 * unassessed); needs_more_information resolves to 'unassessed' (no strength
 * finding has been made yet).
 */
export function supportStrengthForOutcome(outcome) {
  if (outcome === "supported" || outcome === "supported_with_limitation") return "reviewed_supported";
  if (outcome === "not_supported") return "reviewed_not_supported";
  return "unassessed";
}

export function claimStrengthForOutcome(outcome) {
  if (outcome === "approved" || outcome === "approved_with_limitation") return "reviewed_supported";
  if (outcome === "rejected") return "reviewed_not_supported";
  return "unassessed";
}

export const __humanReviewDecisionContractTestables = Object.freeze({
  EVIDENCE_REVIEW_DECISION_OUTCOMES,
  CLAIM_REVIEW_DECISION_OUTCOMES,
});
