import { createHash } from "node:crypto";

/**
 * KAI C3.B3 requirement-assessment vocabulary, fingerprint, and state rule
 * for `ir_stk_001` ("The stakeholder experiencing the intended outcome is
 * identified"), organization scope only. Same governed object as
 * ir_pur_001 (kai.impact_outcome_contexts) - this rule reads
 * stakeholder_key/stakeholder_label instead of outcome_statement, both also
 * NOT NULL and non-empty-checked at the database level
 * (impact_outcome_contexts_a1_1_stakeholder_key_check /
 * _stakeholder_label_check), so `needs_review`/`partially_satisfied` are
 * UNREACHABLE for the same reason as ir_pur_001.
 */

export const REQUIREMENT_KEY = "ir_stk_001";

export const REQUIREMENT_ASSESSMENT_STATES = Object.freeze([
  "satisfied",
  "partially_satisfied",
  "not_satisfied",
  "needs_review",
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isOutcomeContextRow(row) {
  return Boolean(row) && typeof row === "object"
    && isNonEmptyString(row.impactOutcomeContextId)
    && isNonEmptyString(row.outcomeKey)
    && isNonEmptyString(row.outcomeStatement)
    && isNonEmptyString(row.stakeholderKey)
    && isNonEmptyString(row.stakeholderLabel);
}

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function computeRequirementAssessmentFingerprint({ outcomeContexts }) {
  if (!Array.isArray(outcomeContexts) || !outcomeContexts.every(isOutcomeContextRow)) {
    throw new TypeError("computeRequirementAssessmentFingerprint requires a valid outcomeContexts array.");
  }
  const sorted = [...outcomeContexts]
    .sort((a, b) => compareStrings(a.impactOutcomeContextId, b.impactOutcomeContextId))
    .map((row) => ({
      impact_outcome_context_id: row.impactOutcomeContextId,
      stakeholder_key: row.stakeholderKey,
      stakeholder_label: row.stakeholderLabel,
    }));
  const canonical = JSON.stringify({ fingerprint_version: "c3_b3_ir_stk_001_v1", outcome_contexts: sorted });
  return createHash("sha256").update(canonical).digest("hex");
}

export function deriveRequirementAssessmentState({ outcomeContexts }) {
  if (!Array.isArray(outcomeContexts) || !outcomeContexts.every(isOutcomeContextRow)) {
    throw new TypeError("deriveRequirementAssessmentState requires a valid outcomeContexts array.");
  }
  const n = outcomeContexts.length;
  const assessmentState = n === 0 ? "not_satisfied" : "satisfied";
  const explanation =
    n === 0
      ? "No organization-level impact outcome context is recorded, so no stakeholder is identified."
      : `${n} organization-level impact outcome context(s) are recorded, each with an identified stakeholder.`;
  return { assessmentState, explanation, n };
}

export const __stakeholderIdentifiedAssessmentValidatorsTestables = Object.freeze({ isOutcomeContextRow });
