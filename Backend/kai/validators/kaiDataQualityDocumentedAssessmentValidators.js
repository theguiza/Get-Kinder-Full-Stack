import { createHash } from "node:crypto";

/**
 * KAI C3.B3 requirement-assessment vocabulary, fingerprint, and state rule
 * for `ir_data_002` ("Known limitations or quality issues in the
 * underlying data are documented"), organization scope only.
 *
 * Governed universe: every currently-applicable kai.gap_log_items row for
 * the organization (any dimension_key), using the exact same currency gate
 * claim traceability and ir_contrib_002 already use
 * (filterCurrentOrganizationEvidenceGaps,
 * postgresOrganizationEvidenceGapCurrentStateRepository.js) - no new
 * currency rule. Per-gap classification is the gap's own
 * assessment_status: `resolved_risk_flagged` (documented/reviewed) vs
 * `unresolved` (an indeterminate, needs-review signal).
 */

export const REQUIREMENT_KEY = "ir_data_002";

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

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isResolved(row) {
  return row.assessmentStatus === "resolved_risk_flagged";
}

export function computeRequirementAssessmentFingerprint({ gaps }) {
  if (!Array.isArray(gaps) || !gaps.every(isGapRow)) {
    throw new TypeError("computeRequirementAssessmentFingerprint requires a valid gaps array.");
  }
  const sorted = [...gaps]
    .sort((a, b) => compareStrings(a.gapLogItemId, b.gapLogItemId))
    .map((row) => ({
      gap_log_item_id: row.gapLogItemId,
      claim_id: row.claimId,
      evidence_item_id: row.evidenceItemId,
      source_version_id: row.sourceVersionId,
      dimension_key: row.dimensionKey,
      assessment_status: row.assessmentStatus,
    }));
  const canonical = JSON.stringify({ fingerprint_version: "c3_b3_ir_data_002_v1", gaps: sorted });
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
    `${resolvedCount} of ${n} currently-applicable data-quality gaps for this organization are documented ` +
    `(resolved_risk_flagged); ${n - resolvedCount} remain unresolved.`;

  return { assessmentState, explanation, n, resolvedCount };
}

export const __dataQualityDocumentedAssessmentValidatorsTestables = Object.freeze({ isGapRow, isResolved });
