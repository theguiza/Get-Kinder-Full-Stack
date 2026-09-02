import { createHash } from "node:crypto";

/**
 * KAI C3.A3.B requirement-assessment vocabulary, deterministic fingerprint,
 * and deterministic state-derivation rule for exactly one requirement -
 * `ir_contrib_002` ("Known limitations affecting confidence in a reported
 * result are documented"), organization scope only. Pure, no SQL, no
 * database access, no clock, no randomness, no LLM call. This module is the
 * single authoritative definition of "does current governed organizational
 * knowledge satisfy ir_contrib_002" - both
 * Backend/kai/dictionary/postgresRequirementAssessmentRepository.js's write
 * path and its read-back (recompute-and-compare) path import these exact
 * functions, so an assessment written against one computed fingerprint can
 * only ever be recognized as current by a reread that recomputes the
 * identical fingerprint from the identical governed decision/gap state.
 *
 * C3A3.3/C3A3.B owner decision (replaces the retired C3.A2 N/R algorithm
 * completely - that algorithm counted evidence_items.support_strength /
 * claims.claim_strength as a proxy for "reviewed", which could not
 * distinguish a documented limitation from a plain approval and could not
 * see gap_log_items at all): the governed universe is still every
 * kai.evidence_items row and every kai.claims row for the organization, but
 * each governed object's contribution is now the CURRENT lineage-head
 * decision from the P2-12 append-only ledgers
 * (kai.evidence_review_decisions / kai.claim_review_decisions) - never the
 * strength column, and never a superseded decision - plus, for claims only,
 * every currently-applicable confidence-relevant kai.gap_log_items row (the
 * same current/stale judgment
 * postgresOrganizationEvidenceGapCurrentStateRepository.js's
 * filterCurrentOrganizationEvidenceGaps already establishes for claim
 * traceability - no new currency rule is introduced here). A currently-
 * applicable gap can never be hidden behind a `supported`/`approved`
 * decision: it always upgrades that object's classification to at least
 * `documented_limitation`, and a currently-applicable `unresolved` gap
 * always drives the object's classification to `unresolved`.
 */

export const SUPPORTED_REQUIREMENT_KEY = "ir_contrib_002";

export const REQUIREMENT_ASSESSMENT_STATES = Object.freeze([
  "satisfied",
  "partially_satisfied",
  "not_satisfied",
  "needs_review",
]);

/**
 * Per-object classification vocabulary (C3A3.2 decision truth table, plus
 * the "no current decision at all" case C3A3.3 named explicitly). Ranked
 * worst-to-best is NOT meaningful here - `confidence_failure` is a fully
 * disclosed, resolved outcome (a recorded not_supported/rejected flag is
 * itself the disclosure the requirement's catalogue text accepts), so the
 * only binary distinction the final assessment state ever uses is
 * resolved (anything but `unresolved`) vs `unresolved`.
 */
export const OBJECT_CLASSIFICATIONS = Object.freeze([
  "no_limitation",
  "documented_limitation",
  "confidence_failure",
  "unresolved",
]);

const EVIDENCE_TERMINAL_OUTCOMES = Object.freeze({
  supported: "no_limitation",
  supported_with_limitation: "documented_limitation",
  not_supported: "confidence_failure",
  needs_more_information: "unresolved",
});

const CLAIM_TERMINAL_OUTCOMES = Object.freeze({
  approved: "no_limitation",
  approved_with_limitation: "documented_limitation",
  rejected: "confidence_failure",
  needs_more_information: "unresolved",
});

const GAP_ASSESSMENT_STATUSES = new Set(["resolved_risk_flagged", "unresolved"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNullableNonEmptyString(value) {
  return value === null || isNonEmptyString(value);
}

function isEvidenceItemRow(row) {
  return Boolean(row) && typeof row === "object"
    && isNonEmptyString(row.evidenceItemId)
    && isNullableNonEmptyString(row.decisionId)
    && (row.decisionId === null
      ? row.decisionOutcome === null
      : Object.hasOwn(EVIDENCE_TERMINAL_OUTCOMES, row.decisionOutcome));
}

function isGapRow(row) {
  return Boolean(row) && typeof row === "object"
    && isNonEmptyString(row.gapLogItemId)
    && GAP_ASSESSMENT_STATUSES.has(row.assessmentStatus);
}

function isClaimRow(row) {
  if (!row || typeof row !== "object") return false;
  if (!isNonEmptyString(row.claimId)) return false;
  if (!isNullableNonEmptyString(row.decisionId)) return false;
  if (row.decisionId === null) {
    if (row.decisionOutcome !== null) return false;
  } else if (!Object.hasOwn(CLAIM_TERMINAL_OUTCOMES, row.decisionOutcome)) {
    return false;
  }
  if (!Array.isArray(row.gaps) || !row.gaps.every(isGapRow)) return false;
  return true;
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function classifyEvidenceItem(row) {
  return row.decisionId === null ? "unresolved" : EVIDENCE_TERMINAL_OUTCOMES[row.decisionOutcome];
}

function classifyGapOverlay(gaps) {
  if (gaps.length === 0) return null;
  if (gaps.some((gap) => gap.assessmentStatus === "unresolved")) return "unresolved";
  return "documented_limitation";
}

/**
 * A currently-applicable gap can only ever make a claim's classification at
 * least as unresolved/disclosed as it already was - it never hides an
 * existing confidence_failure or documented_limitation decision behind a
 * weaker gap signal, and a decision alone can never suppress a currently-
 * applicable gap.
 */
function classifyClaim(row) {
  const decisionClassification = row.decisionId === null ? null : CLAIM_TERMINAL_OUTCOMES[row.decisionOutcome];
  const gapClassification = classifyGapOverlay(row.gaps);

  if (decisionClassification === null && gapClassification === null) return "unresolved";
  if (gapClassification === "unresolved") return "unresolved";
  if (decisionClassification === "unresolved") return "unresolved";
  if (decisionClassification === null) return gapClassification;
  if (gapClassification === null) return decisionClassification;
  // gapClassification === "documented_limitation" and decisionClassification
  // is one of no_limitation/documented_limitation/confidence_failure here.
  if (decisionClassification === "no_limitation") return "documented_limitation";
  return decisionClassification;
}

function isResolved(classification) {
  return classification !== "unresolved";
}

/**
 * Deterministic, canonical encoding of exactly the material state C3A3.3
 * established: for each governed evidence item, its current decision_id +
 * decision_outcome (or both null); for each governed claim, the same plus
 * every currently-applicable gap's (gap_log_item_id, dimension_key,
 * assessment_status). Sorted by id ascending within each collection and
 * within each claim's gap list. Never includes created_at, any generated
 * link/audit id, statement/statement_fingerprint, source identity,
 * sensitivity/audience booleans, superseded decision ids, or stale gap rows
 * - a superseded decision or a stale gap is invisible to this fingerprint by
 * construction, because the repository never loads one into evidenceItems/
 * claims in the first place. fingerprint_version is bumped from the retired
 * `c3_a2_ir_contrib_002_v1` so no v1 row (computed from a wholly different
 * strength-count input) can ever collide with, or be mistaken as current
 * for, a v2 fingerprint.
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
    .map((row) => ({
      evidence_item_id: row.evidenceItemId,
      decision_id: row.decisionId,
      decision_outcome: row.decisionOutcome,
    }));
  const sortedClaims = [...claims]
    .sort((a, b) => compareStrings(a.claimId, b.claimId))
    .map((row) => ({
      claim_id: row.claimId,
      decision_id: row.decisionId,
      decision_outcome: row.decisionOutcome,
      current_gaps: [...row.gaps]
        .sort((a, b) => compareStrings(a.gapLogItemId, b.gapLogItemId))
        .map((gap) => ({
          gap_log_item_id: gap.gapLogItemId,
          dimension_key: gap.dimensionKey,
          assessment_status: gap.assessmentStatus,
        })),
    }));

  const canonical = JSON.stringify({
    fingerprint_version: "c3_a3_b_ir_contrib_002_v2",
    evidence_items: sortedEvidence,
    claims: sortedClaims,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Deterministic state-mapping rule (C3A3.3's Final State Rule, replacing
 * the retired N/R count entirely):
 *   no governed objects (N = 0)                -> not_satisfied
 *   N > 0, every object unresolved              -> needs_review
 *   N > 0, every object resolved                -> satisfied
 *   N > 0, a mix of resolved and unresolved      -> partially_satisfied
 * "resolved" means the object's classification is no_limitation,
 * documented_limitation, or confidence_failure (any disclosed, non-
 * `unresolved` outcome) - never a re-derivation of the retired
 * count-of-non-'unassessed' rule.
 */
export function deriveRequirementAssessmentState({ evidenceItems, claims }) {
  if (!Array.isArray(evidenceItems) || !evidenceItems.every(isEvidenceItemRow)) {
    throw new TypeError("deriveRequirementAssessmentState requires a valid evidenceItems array.");
  }
  if (!Array.isArray(claims) || !claims.every(isClaimRow)) {
    throw new TypeError("deriveRequirementAssessmentState requires a valid claims array.");
  }

  const n = evidenceItems.length + claims.length;
  const evidenceClassifications = evidenceItems.map(classifyEvidenceItem);
  const claimClassifications = claims.map(classifyClaim);
  const allClassifications = [...evidenceClassifications, ...claimClassifications];
  const resolvedCount = allClassifications.filter(isResolved).length;

  let assessmentState;
  if (n === 0) {
    assessmentState = "not_satisfied";
  } else if (resolvedCount === 0) {
    assessmentState = "needs_review";
  } else if (resolvedCount < n) {
    assessmentState = "partially_satisfied";
  } else {
    assessmentState = "satisfied";
  }

  const explanation =
    `${resolvedCount} of ${n} governed evidence/claim items for this organization currently resolve to a ` +
    `disclosed confidence outcome (a current review-decision head and/or a currently-applicable gap); ` +
    `${n - resolvedCount} remain unresolved (no current decision, needs_more_information, or an unresolved ` +
    `currently-applicable gap).`;

  return {
    assessmentState,
    explanation,
    n,
    resolvedCount,
    evidenceClassifications,
    claimClassifications,
  };
}

export const __requirementAssessmentValidatorsTestables = Object.freeze({
  isEvidenceItemRow,
  isClaimRow,
  isGapRow,
  classifyEvidenceItem,
  classifyClaim,
  classifyGapOverlay,
  isResolved,
  EVIDENCE_TERMINAL_OUTCOMES,
  CLAIM_TERMINAL_OUTCOMES,
});
