import { createHash } from "node:crypto";

/**
 * KAI C3.A2 requirement-assessment vocabulary, deterministic fingerprint, and
 * deterministic state-derivation rule for exactly one requirement -
 * `ir_contrib_002` ("Known limitations affecting confidence in a reported
 * result are documented"), organization scope only. Pure, no SQL, no
 * database access, no clock, no randomness, no LLM call. This module is the
 * single authoritative definition of "does current governed organizational
 * knowledge satisfy ir_contrib_002" - both
 * Backend/kai/dictionary/postgresRequirementAssessmentRepository.js's write
 * path and its read-back (recompute-and-compare) path import these exact
 * functions, so an assessment written against one computed fingerprint can
 * only ever be recognized as current by a reread that recomputes the
 * identical fingerprint from the identical governed evidence/claim state.
 *
 * C3.A1 selected this exact rule (owner-authorized, not re-derived here):
 * every kai.evidence_items row (field support_strength) and every
 * kai.claims row (field claim_strength) for the organization is a governed
 * input. N = count(evidence_items) + count(claims). R = count of those rows
 * whose strength field is NOT 'unassessed' (i.e. 'reviewed_supported' or
 * 'reviewed_not_supported'). This never inspects statement text, source
 * content, or any LLM output.
 */

export const SUPPORTED_REQUIREMENT_KEY = "ir_contrib_002";

export const REQUIREMENT_ASSESSMENT_STATES = Object.freeze([
  "satisfied",
  "partially_satisfied",
  "not_satisfied",
  "needs_review",
]);

const STRENGTH_VALUES = new Set(["unassessed", "reviewed_supported", "reviewed_not_supported"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isStrengthValue(value) {
  return STRENGTH_VALUES.has(value);
}

function isEvidenceItemRow(row) {
  return Boolean(row) && typeof row === "object"
    && isNonEmptyString(row.evidenceItemId)
    && isStrengthValue(row.supportStrength);
}

function isClaimRow(row) {
  return Boolean(row) && typeof row === "object"
    && isNonEmptyString(row.claimId)
    && isStrengthValue(row.claimStrength);
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Deterministic, canonical (id, strength) encoding, sorted by id ascending
 * within each collection, fixed field order/key names, SHA-256 hex digest.
 * Never includes created_at, any generated id (requirement_assessment_id,
 * link ids, audit ids), statement_fingerprint, source identity,
 * sensitivity/audience booleans, review_status text fields, or any
 * review-decision-ledger content. Only requirement scope (bound by the
 * caller, not hashed here) plus the (id, strength) pairs below determine the
 * value: two calls with identical evidence/claim strength state for the same
 * org+requirement MUST produce the identical fingerprint, and any change to
 * the strength enum on any row, or any addition/removal of a row, MUST
 * change it.
 */
export function computeRequirementAssessmentFingerprint({ evidenceItems, claims }) {
  if (!Array.isArray(evidenceItems) || !evidenceItems.every(isEvidenceItemRow)) {
    throw new TypeError("computeRequirementAssessmentFingerprint requires a valid evidenceItems array.");
  }
  if (!Array.isArray(claims) || !claims.every(isClaimRow)) {
    throw new TypeError("computeRequirementAssessmentFingerprint requires a valid claims array.");
  }

  const sortedEvidence = [...evidenceItems]
    .sort((a, b) => compareStrings(a.evidenceItemId, b.evidenceItemId))
    .map((row) => ({ evidence_item_id: row.evidenceItemId, support_strength: row.supportStrength }));
  const sortedClaims = [...claims]
    .sort((a, b) => compareStrings(a.claimId, b.claimId))
    .map((row) => ({ claim_id: row.claimId, claim_strength: row.claimStrength }));

  const canonical = JSON.stringify({
    fingerprint_version: "c3_a2_ir_contrib_002_v1",
    evidence_items: sortedEvidence,
    claims: sortedClaims,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Deterministic N/R state-mapping rule (C3.A1's owner-authorized design):
 *   N = 0                 -> not_satisfied
 *   N > 0, R = 0           -> needs_review
 *   N > 0, 0 < R < N       -> partially_satisfied
 *   N > 0, R = N           -> satisfied
 * assessment_explanation is built only from the N/R counts - never from
 * statement text, source content, or any LLM output.
 */
export function deriveRequirementAssessmentState({ evidenceItems, claims }) {
  if (!Array.isArray(evidenceItems) || !evidenceItems.every(isEvidenceItemRow)) {
    throw new TypeError("deriveRequirementAssessmentState requires a valid evidenceItems array.");
  }
  if (!Array.isArray(claims) || !claims.every(isClaimRow)) {
    throw new TypeError("deriveRequirementAssessmentState requires a valid claims array.");
  }

  const n = evidenceItems.length + claims.length;
  const reviewedCount = (rows, strengthKey) =>
    rows.filter((row) => row[strengthKey] !== "unassessed").length;
  const r = reviewedCount(evidenceItems, "supportStrength") + reviewedCount(claims, "claimStrength");

  let assessmentState;
  if (n === 0) {
    assessmentState = "not_satisfied";
  } else if (r === 0) {
    assessmentState = "needs_review";
  } else if (r < n) {
    assessmentState = "partially_satisfied";
  } else {
    assessmentState = "satisfied";
  }

  const explanation =
    `${r} of ${n} governed evidence/claim items for this organization have a documented review outcome ` +
    `(support_strength or claim_strength other than 'unassessed').`;

  return { assessmentState, explanation, n, r };
}

export const __requirementAssessmentValidatorsTestables = Object.freeze({
  isEvidenceItemRow,
  isClaimRow,
  isStrengthValue,
});
