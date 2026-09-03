import { createHash } from "node:crypto";

/**
 * KAI C3.B3 requirement-assessment vocabulary, fingerprint, and state rule
 * for `ir_contrib_003` ("Unresolved conflicts or gaps affecting a claim are
 * tracked to a decision before use"), organization scope only.
 *
 * State/assessment universe is IDENTICAL to ir_data_002's (every currently-
 * applicable kai.gap_log_items row for the organization, any
 * dimension_key, classified resolved_risk_flagged vs unresolved) - a
 * kai.conflict_groups pairing is always backed by its own
 * conflicting_source_indicators-dimension gap_log_items row on each side
 * (P2-05), so that gap's own resolution status already carries the
 * "conflict tracked to a resolution status" fact for state purposes. What
 * this rule ADDS beyond ir_data_002 is provenance: every kai.conflict_groups
 * row whose lower_claim_id/higher_claim_id is a governed claim of this
 * organization is also cited (ra_conflict_resolution_links), proving the
 * conflict PAIRING itself (not just its gap) was known at assessment time.
 * Conflict-group membership does not change assessment_state (it is fully
 * redundant with the gap universe for that purpose), but it IS included in
 * the fingerprint so a newly-opened conflict for an already-fully-resolved
 * claim always triggers a fresh assessment (and therefore a fresh
 * provenance citation) rather than being silently absorbed into a replay
 * of an unrelated, unchanged gap fingerprint.
 */

export const REQUIREMENT_KEY = "ir_contrib_003";

export const REQUIREMENT_ASSESSMENT_STATES = Object.freeze([
  "satisfied",
  "partially_satisfied",
  "not_satisfied",
  "needs_review",
]);

const GAP_ASSESSMENT_STATUSES = new Set(["resolved_risk_flagged", "unresolved"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isGapRow(row) {
  return Boolean(row) && typeof row === "object"
    && isNonEmptyString(row.gapLogItemId)
    && isNonEmptyString(row.claimId)
    && isNonEmptyString(row.evidenceItemId)
    && isNonEmptyString(row.sourceVersionId)
    && isNonEmptyString(row.dimensionKey)
    && GAP_ASSESSMENT_STATUSES.has(row.assessmentStatus);
}

function isConflictLinkRow(row) {
  return Boolean(row) && typeof row === "object"
    && isNonEmptyString(row.conflictGroupId)
    && isNonEmptyString(row.claimId);
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isResolved(row) {
  return row.assessmentStatus === "resolved_risk_flagged";
}

export function computeRequirementAssessmentFingerprint({ gaps, conflictLinks }) {
  if (!Array.isArray(gaps) || !gaps.every(isGapRow)) {
    throw new TypeError("computeRequirementAssessmentFingerprint requires a valid gaps array.");
  }
  if (!Array.isArray(conflictLinks) || !conflictLinks.every(isConflictLinkRow)) {
    throw new TypeError("computeRequirementAssessmentFingerprint requires a valid conflictLinks array.");
  }
  const sortedGaps = [...gaps]
    .sort((a, b) => compareStrings(a.gapLogItemId, b.gapLogItemId))
    .map((row) => ({
      gap_log_item_id: row.gapLogItemId,
      claim_id: row.claimId,
      evidence_item_id: row.evidenceItemId,
      source_version_id: row.sourceVersionId,
      dimension_key: row.dimensionKey,
      assessment_status: row.assessmentStatus,
    }));
  const sortedConflicts = [...conflictLinks]
    .sort((a, b) => compareStrings(`${a.conflictGroupId}:${a.claimId}`, `${b.conflictGroupId}:${b.claimId}`))
    .map((row) => ({ conflict_group_id: row.conflictGroupId, claim_id: row.claimId }));
  const canonical = JSON.stringify({
    fingerprint_version: "c3_b3_ir_contrib_003_v1",
    gaps: sortedGaps,
    conflict_links: sortedConflicts,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function deriveRequirementAssessmentState({ gaps }) {
  if (!Array.isArray(gaps) || !gaps.every(isGapRow)) {
    throw new TypeError("deriveRequirementAssessmentState requires a valid gaps array.");
  }
  const n = gaps.length;
  const resolvedCount = gaps.filter(isResolved).length;

  let assessmentState;
  if (n === 0) assessmentState = "not_satisfied";
  else if (resolvedCount === 0) assessmentState = "needs_review";
  else if (resolvedCount < n) assessmentState = "partially_satisfied";
  else assessmentState = "satisfied";

  const explanation =
    `${resolvedCount} of ${n} currently-applicable conflicts/gaps for this organization are tracked to a ` +
    `resolution status (resolved_risk_flagged); ${n - resolvedCount} remain unresolved.`;

  return { assessmentState, explanation, n, resolvedCount };
}

export const __conflictGapTrackedAssessmentValidatorsTestables = Object.freeze({ isGapRow, isConflictLinkRow, isResolved });
