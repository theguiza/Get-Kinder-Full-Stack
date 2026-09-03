import { createHash } from "node:crypto";

/**
 * KAI C3.B3 requirement-assessment vocabulary, fingerprint, and state rule
 * for `ir_data_003` ("A reported outcome-performance statement has
 * traceable supporting evidence"), organization scope only.
 *
 * Governed universe: every kai.claims row for the organization. Per-claim
 * classification: TRACED (a kai.claim_evidence_links row exists for the
 * claim - at most one, per
 * claim_evidence_links_p2_03_one_link_per_claim_unique) vs UNTRACED (no
 * such link). UNTRACED is a definite, proven fact (proven by absence-of-row
 * in the same transaction), not an indeterminate signal - mirrors
 * ir_comm_002's "no current decision" reasoning, so `needs_review` is
 * UNREACHABLE here: an all-UNTRACED universe is `not_satisfied`, not
 * `needs_review`.
 */

export const REQUIREMENT_KEY = "ir_data_003";

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

function isClaimTraceabilityRow(row) {
  return Boolean(row) && typeof row === "object"
    && isNonEmptyString(row.claimId)
    && isNullableNonEmptyString(row.evidenceItemId);
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isTraced(row) {
  return row.evidenceItemId !== null;
}

export function computeRequirementAssessmentFingerprint({ claims }) {
  if (!Array.isArray(claims) || !claims.every(isClaimTraceabilityRow)) {
    throw new TypeError("computeRequirementAssessmentFingerprint requires a valid claims array.");
  }
  const sorted = [...claims]
    .sort((a, b) => compareStrings(a.claimId, b.claimId))
    .map((row) => ({ claim_id: row.claimId, evidence_item_id: row.evidenceItemId }));
  const canonical = JSON.stringify({ fingerprint_version: "c3_b3_ir_data_003_v1", claims: sorted });
  return createHash("sha256").update(canonical).digest("hex");
}

export function deriveRequirementAssessmentState({ claims }) {
  if (!Array.isArray(claims) || !claims.every(isClaimTraceabilityRow)) {
    throw new TypeError("deriveRequirementAssessmentState requires a valid claims array.");
  }
  const n = claims.length;
  const tracedCount = claims.filter(isTraced).length;

  let assessmentState;
  if (n === 0) assessmentState = "not_satisfied";
  else if (tracedCount === n) assessmentState = "satisfied";
  else if (tracedCount === 0) assessmentState = "not_satisfied";
  else assessmentState = "partially_satisfied";

  const explanation =
    `${tracedCount} of ${n} governed claims for this organization are traced to a specific supporting evidence ` +
    `item via claim_evidence_links; ${n - tracedCount} have no traceable evidence link.`;

  return { assessmentState, explanation, n, tracedCount };
}

export const __claimEvidenceTraceabilityAssessmentValidatorsTestables = Object.freeze({ isClaimTraceabilityRow, isTraced });
