import { createHash } from "node:crypto";

/**
 * KAI C3.B3 requirement-assessment vocabulary, fingerprint, and state rule
 * for `ir_pur_001` ("Intended outcome is explicitly defined"), organization
 * scope only. Pure, no SQL/DB/clock/randomness. Mirrors
 * kaiRequirementAssessmentValidators.js's structure for shape only.
 *
 * Governed universe: every kai.impact_outcome_contexts row for the
 * organization at organization scope (engagement_id IS NULL), mirroring
 * every other requirement in this package. `outcome_statement` is NOT NULL
 * and non-empty-checked at the database level
 * (impact_outcome_contexts_a1_1_outcome_statement_check), so every row that
 * exists already carries a defined outcome statement - there is no
 * indeterminate/partial per-row signal for this specific requirement.
 * `needs_review` and `partially_satisfied` are therefore UNREACHABLE: the
 * only two reachable states are `not_satisfied` (no outcome context exists
 * at all) and `satisfied` (at least one exists, and by construction its
 * outcome_statement is always defined).
 */

export const REQUIREMENT_KEY = "ir_pur_001";

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
      outcome_key: row.outcomeKey,
      outcome_statement: row.outcomeStatement,
    }));
  const canonical = JSON.stringify({ fingerprint_version: "c3_b3_ir_pur_001_v1", outcome_contexts: sorted });
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
      ? "No organization-level impact outcome context is recorded, so no intended outcome is defined."
      : `${n} organization-level impact outcome context(s) are recorded, each with a defined outcome_statement.`;
  return { assessmentState, explanation, n };
}

export const __outcomeDefinedAssessmentValidatorsTestables = Object.freeze({ isOutcomeContextRow });
