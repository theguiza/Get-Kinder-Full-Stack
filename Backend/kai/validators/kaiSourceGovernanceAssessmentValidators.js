import { createHash } from "node:crypto";

/**
 * KAI C3.B3 requirement-assessment vocabulary, fingerprint, and state rule
 * for `ir_data_001` ("The source and provenance of data used as evidence
 * is known and governed"), organization scope only.
 *
 * Governed universe: every kai.evidence_items row for the organization.
 * Every evidence_item's source_version_id/source_id are NOT NULL and only
 * ever populated by a `promoted` kai.intake_promotion_decisions row (the
 * promoted_binding_check constraint), so decision_status is always
 * effectively 'promoted' by the time evidence exists - the real currentness
 * signal is kai.source_versions.is_current, which flips to false once a
 * newer source_version is promoted for the same source. An evidence item
 * still citing a superseded (is_current = false) source_version is exactly
 * the "not currently governed" case this requirement targets.
 *
 * Per-item classification: CURRENT (is_current = true) vs SUPERSEDED
 * (is_current = false). SUPERSEDED is a genuine indeterminate/needs-
 * re-verification signal (unlike ir_comm_002's definite absence), so
 * `needs_review` IS reachable here, mirroring ir_contrib_002's shape.
 */

export const REQUIREMENT_KEY = "ir_data_001";

export const REQUIREMENT_ASSESSMENT_STATES = Object.freeze([
  "satisfied",
  "partially_satisfied",
  "not_satisfied",
  "needs_review",
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isEvidenceSourceRow(row) {
  return Boolean(row) && typeof row === "object"
    && isNonEmptyString(row.evidenceItemId)
    && isNonEmptyString(row.sourceId)
    && isNonEmptyString(row.sourceVersionId)
    && isNonEmptyString(row.intakeSourceCandidateId)
    && isNonEmptyString(row.intakePromotionDecisionId)
    && typeof row.isCurrent === "boolean"
    && isNonEmptyString(row.decisionStatus)
    && isNonEmptyString(row.reviewedSourceType);
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function classify(row) {
  return row.isCurrent ? "current" : "superseded";
}

export function computeRequirementAssessmentFingerprint({ evidenceSources }) {
  if (!Array.isArray(evidenceSources) || !evidenceSources.every(isEvidenceSourceRow)) {
    throw new TypeError("computeRequirementAssessmentFingerprint requires a valid evidenceSources array.");
  }
  const sorted = [...evidenceSources]
    .sort((a, b) => compareStrings(a.evidenceItemId, b.evidenceItemId))
    .map((row) => ({
      evidence_item_id: row.evidenceItemId,
      source_id: row.sourceId,
      source_version_id: row.sourceVersionId,
      intake_source_candidate_id: row.intakeSourceCandidateId,
      intake_promotion_decision_id: row.intakePromotionDecisionId,
      is_current: row.isCurrent,
      decision_status: row.decisionStatus,
      reviewed_source_type: row.reviewedSourceType,
    }));
  const canonical = JSON.stringify({ fingerprint_version: "c3_b3_ir_data_001_v1", evidence_sources: sorted });
  return createHash("sha256").update(canonical).digest("hex");
}

export function deriveRequirementAssessmentState({ evidenceSources }) {
  if (!Array.isArray(evidenceSources) || !evidenceSources.every(isEvidenceSourceRow)) {
    throw new TypeError("deriveRequirementAssessmentState requires a valid evidenceSources array.");
  }
  const n = evidenceSources.length;
  const classifications = evidenceSources.map(classify);
  const currentCount = classifications.filter((c) => c === "current").length;

  let assessmentState;
  if (n === 0) assessmentState = "not_satisfied";
  else if (currentCount === 0) assessmentState = "needs_review";
  else if (currentCount < n) assessmentState = "partially_satisfied";
  else assessmentState = "satisfied";

  const explanation =
    `${currentCount} of ${n} governed evidence items for this organization are sourced from a currently-promoted, ` +
    `non-superseded source_version; ${n - currentCount} are sourced from a superseded source_version.`;

  return { assessmentState, explanation, n, currentCount, classifications };
}

export const __sourceGovernanceAssessmentValidatorsTestables = Object.freeze({ isEvidenceSourceRow, classify });
