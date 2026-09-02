import { createHash } from "node:crypto";

/**
 * KAI C3.B2 requirement-assessment vocabulary, deterministic fingerprint,
 * and deterministic state-derivation rule for exactly one requirement -
 * `ir_comm_002` ("A reported result can be traced back to who is
 * accountable for its accuracy"), organization scope only. Pure, no SQL,
 * no database access, no clock, no randomness, no LLM call. Mirrors
 * Backend/kai/validators/kaiRequirementAssessmentValidators.js's structure
 * (ir_contrib_002) for style/shape only - the governed universe, per-claim
 * classification, and state-mapping rule below are this requirement's own,
 * deliberately different, semantics.
 *
 * Governed universe: every `kai.claims` row for the organization (no
 * evidence items - this requirement is about claim accountability, not
 * evidence/limitation disclosure).
 *
 * Accountability fact: the CURRENT (non-superseded) lineage-head row in
 * `kai.claim_review_decisions` for a claim. Accountability is established
 * by decision EXISTENCE alone (decision_id/decided_by/decided_by_role are
 * NOT NULL on every ledger row) - `decision_outcome` is never consulted,
 * because even a `rejected` or `needs_more_information` decision still
 * names an accountable decided_by/decided_by_role for that claim.
 *
 * Per-claim classification (only two are reachable in this governed
 * model):
 *   ACCOUNTABLE       - a current decision exists for the claim.
 *   NO_ACCOUNTABILITY - no current decision exists for the claim. This is a
 *                        DEFINITE fact (proven by absence-of-row under the
 *                        same-transaction lineage-head query), never an
 *                        indeterminate/pending state.
 * `UNRESOLVED` is deliberately absent from this vocabulary: there is no
 * indeterminate/ambiguous accountability signal in this model. Decision
 * content is not material to accountability, and the P2-12 ledger
 * guarantees exactly one lineage head per claim (never an ambiguous
 * multi-head state), so no per-claim UNRESOLVED trigger can ever arise.
 */

export const REQUIREMENT_KEY = "ir_comm_002";

export const REQUIREMENT_ASSESSMENT_STATES = Object.freeze([
  "satisfied",
  "partially_satisfied",
  "not_satisfied",
  "needs_review",
]);

export const CLAIM_CLASSIFICATIONS = Object.freeze(["ACCOUNTABLE", "NO_ACCOUNTABILITY"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNullableNonEmptyString(value) {
  return value === null || isNonEmptyString(value);
}

function isClaimRow(row) {
  if (!row || typeof row !== "object") return false;
  if (!isNonEmptyString(row.claimId)) return false;
  if (!isNullableNonEmptyString(row.decisionId)) return false;
  if (!isNullableNonEmptyString(row.decidedBy)) return false;
  if (!isNullableNonEmptyString(row.decidedByRole)) return false;
  if (row.decisionId === null) {
    if (row.decidedBy !== null || row.decidedByRole !== null) return false;
  } else if (row.decidedBy === null || row.decidedByRole === null) {
    return false;
  }
  return true;
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function classifyClaim(row) {
  return row.decisionId === null ? "NO_ACCOUNTABILITY" : "ACCOUNTABLE";
}

function isAccountable(classification) {
  return classification === "ACCOUNTABLE";
}

/**
 * Deterministic, canonical encoding of exactly the material state this
 * requirement establishes: for each governed claim, its current
 * decision_id/decided_by/decided_by_role (or all three null when no current
 * decision exists). Sorted by claim_id ascending. Never includes
 * decision_outcome (immaterial to accountability - a same-lineage-head
 * outcome cannot even change without a new decision_id anyway), evidence
 * items, or gaps (this rule's universe is claims only).
 * fingerprint_version is a wholly new string (`c3_b_ir_comm_002_v1`),
 * distinct from every ir_contrib_002 fingerprint version, so the two
 * requirements' fingerprints can never collide or be mistaken for one
 * another.
 */
export function computeRequirementAssessmentFingerprint({ claims }) {
  if (!Array.isArray(claims) || !claims.every(isClaimRow)) {
    throw new TypeError("computeRequirementAssessmentFingerprint requires a valid claims array.");
  }

  const sortedClaims = [...claims]
    .sort((a, b) => compareStrings(a.claimId, b.claimId))
    .map((row) => ({
      claim_id: row.claimId,
      decision_id: row.decisionId,
      decided_by: row.decidedBy,
      decided_by_role: row.decidedByRole,
    }));

  const canonical = JSON.stringify({
    fingerprint_version: "c3_b_ir_comm_002_v1",
    claims: sortedClaims,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Deterministic state-mapping rule for ir_comm_002. This intentionally
 * diverges from ir_contrib_002's shape in exactly one place: an
 * all-NO_ACCOUNTABILITY universe is `not_satisfied`, never `needs_review`.
 * ir_contrib_002's "all-unresolved -> needs_review" branch exists because
 * that requirement's per-object UNRESOLVED state is an indeterminate/
 * pending signal (a decision or gap that has not yet been made). This
 * requirement has no such indeterminate signal - NO_ACCOUNTABILITY is a
 * DEFINITE, proven fact (no current decision row exists at all), so an
 * all-absent universe is definite non-satisfaction, not "needs review".
 * `needs_review` is therefore UNREACHABLE for this rule: there is no
 * per-claim UNRESOLVED/indeterminate state to ever drive it to.
 *
 *   n === 0                                    -> not_satisfied
 *   n > 0, every claim ACCOUNTABLE              -> satisfied
 *   n > 0, every claim NO_ACCOUNTABILITY        -> not_satisfied
 *   n > 0, a mix of ACCOUNTABLE/NO_ACCOUNTABILITY -> partially_satisfied
 */
export function deriveRequirementAssessmentState({ claims }) {
  if (!Array.isArray(claims) || !claims.every(isClaimRow)) {
    throw new TypeError("deriveRequirementAssessmentState requires a valid claims array.");
  }

  const n = claims.length;
  const claimClassifications = claims.map(classifyClaim);
  const accountableCount = claimClassifications.filter(isAccountable).length;

  let assessmentState;
  if (n === 0) {
    assessmentState = "not_satisfied";
  } else if (accountableCount === n) {
    assessmentState = "satisfied";
  } else if (accountableCount === 0) {
    assessmentState = "not_satisfied";
  } else {
    assessmentState = "partially_satisfied";
  }

  const explanation =
    `${accountableCount} of ${n} governed claims for this organization currently have a current review-decision ` +
    `naming an accountable decided_by/decided_by_role; ` +
    `${n - accountableCount} have no current decision at all and therefore no accountable party of record.`;

  return {
    assessmentState,
    explanation,
    n,
    accountableCount,
    claimClassifications,
  };
}

export const __communicationAccountabilityAssessmentValidatorsTestables = Object.freeze({
  isClaimRow,
  classifyClaim,
  isAccountable,
});
