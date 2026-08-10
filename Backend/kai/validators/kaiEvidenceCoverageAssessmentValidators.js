import { createValidatorResult } from "./types.js";
import { validateEvidenceHasSourceLineage } from "./kaiEvidenceLineageValidators.js";

/**
 * KAI P2-02 deterministic evidence-coverage-assessment validators: pure
 * predicates and pure dimension-assessment functions over already-read,
 * committed rows. No SQL, no database access, no clock, no randomness - every
 * row inspected here must already have been read, fresh and authoritative, by
 * the caller (the P2-02 repository). Assessment never infers a fact from a
 * filename, field name, sample value, AI output, external lookup, or absence:
 * a dimension is only ever "resolved" when a committed row already states an
 * explicit fact for it. Everything else, including every dimension for which
 * no committed schema fact currently exists at all, stays "unresolved".
 *
 * Each dimension-assessment function returns one `createValidatorResult`-
 * shaped object (the same shape `Backend/kai/validators/types.js` already
 * defines), with the three-state assessment outcome carried in
 * `evidence.assessment_status`:
 *   - "resolved_clear": a committed fact was found and it discloses no risk.
 *   - "resolved_risk_flagged": a committed fact was found and it discloses a
 *     risk, gap, or clarity issue that a human reviewer should see.
 *   - "unresolved": no committed fact establishes either outcome yet.
 * `severity` stays within the existing pass/warning vocabulary
 * ("warning" only for resolved_risk_flagged, "pass" otherwise) - this package
 * never introduces a "blocker" severity for an informational assessment
 * dimension.
 */

function dimensionResult(objectCode, status, message, evidence = {}) {
  return createValidatorResult({
    validator_key: `VAL-KAI-P2-02-${objectCode}`,
    severity: status === "resolved_risk_flagged" ? "warning" : "pass",
    object_type: "evidence_coverage_dimension",
    object_code: objectCode,
    message,
    evidence: { assessment_status: status, ...evidence },
  });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * VAL-KAI-P2-02-000 (assessment-permitted gate): reuses the P2-01 lineage/
 * promotion-completeness/cross-row-equality/checksum-completeness/permission
 * predicate wholesale (`validateEvidenceHasSourceLineage`) rather than
 * reimplementing it, then adds exactly one additional P2-02-owned check: the
 * committed `allowed_use_status` fact on the same sensitivity-profile row.
 * `'not_allowed'` fails closed; `'unknown'` and `'allowed'` do not - an
 * unresolved allowed-use fact is not itself a prohibition, it only leaves the
 * `requirement_alignment`/`conflicting_source_indicators` dimensions
 * unresolved below.
 */
export function validateEvidenceCoverageAssessmentIsPermitted(rows) {
  const lineage = validateEvidenceHasSourceLineage(rows);
  if (!lineage.ok) return lineage;

  if (rows.profileRow.allowed_use_status === "not_allowed") {
    return { ok: false, code: "validation_blocker" };
  }

  return { ok: true };
}

/**
 * missingness: a committed `finding_type = 'missingness'` row on
 * `kai.data_quality_findings` is the only fact this dimension ever assesses.
 * Absence of such a row is not treated as proof of "no missingness" - it only
 * means no committed finding exists yet - so it stays unresolved.
 */
export function assessMissingness(qualityFindingRows) {
  const rows = Array.isArray(qualityFindingRows) ? qualityFindingRows : [];
  const findings = rows.filter((row) => row?.finding_type === "missingness" && row?.finding_status === "open");
  if (findings.length === 0) {
    return dimensionResult("missingness", "unresolved", "No committed missingness finding exists for this dictionary.");
  }
  return dimensionResult(
    "missingness",
    "resolved_risk_flagged",
    "A committed data-quality finding declares missingness.",
    { open_finding_count: findings.length },
  );
}

/**
 * duplicates: a committed `finding_type = 'duplicate_rows'` row is the only
 * fact this dimension ever assesses. Same absence rule as missingness.
 */
export function assessDuplicates(qualityFindingRows) {
  const rows = Array.isArray(qualityFindingRows) ? qualityFindingRows : [];
  const findings = rows.filter((row) => row?.finding_type === "duplicate_rows" && row?.finding_status === "open");
  if (findings.length === 0) {
    return dimensionResult("duplicates", "unresolved", "No committed duplicate-rows finding exists for this dictionary.");
  }
  return dimensionResult(
    "duplicates",
    "resolved_risk_flagged",
    "A committed data-quality finding declares duplicate rows.",
    { open_finding_count: findings.length },
  );
}

/**
 * definition_clarity: `kai.data_dictionary_fields.business_meaning` defaults
 * to the literal 'unknown' and is only ever replaced by an explicit committed
 * value. A field is "defined" only when its committed value is not 'unknown'.
 */
export function assessDefinitionClarity(dictionaryFieldRows) {
  const rows = Array.isArray(dictionaryFieldRows) ? dictionaryFieldRows : [];
  if (rows.length === 0) {
    return dimensionResult("definition_clarity", "unresolved", "No committed data-dictionary fields exist to assess.");
  }
  const undefinedFields = rows.filter((row) => row?.business_meaning === "unknown" || !isNonEmptyString(row?.business_meaning));
  if (undefinedFields.length === 0) {
    return dimensionResult(
      "definition_clarity",
      "resolved_clear",
      "Every committed dictionary field has a defined business meaning.",
      { field_count: rows.length },
    );
  }
  return dimensionResult(
    "definition_clarity",
    "resolved_risk_flagged",
    "One or more committed dictionary fields have no defined business meaning.",
    { field_count: rows.length, undefined_field_count: undefinedFields.length },
  );
}

/**
 * denominator_clarity: no currently committed schema fact (P1-04/P1-05) ever
 * records a denominator. This package never infers one from a field name, a
 * sample value, or a filename, so this dimension is always unresolved.
 */
export function assessDenominatorClarity() {
  return dimensionResult("denominator_clarity", "unresolved", "No committed fact establishes a denominator for this source version.");
}

/**
 * time_period_clarity: no currently committed schema fact ever records a
 * reporting period. Always unresolved, for the same reason as
 * denominator_clarity.
 */
export function assessTimePeriodClarity() {
  return dimensionResult("time_period_clarity", "unresolved", "No committed fact establishes a reporting time period for this source version.");
}

/**
 * entity_level_clarity: `kai.data_dictionary_fields.entity_level` defaults to
 * the literal 'unknown' and is only ever replaced by an explicit committed
 * value, exactly like business_meaning.
 */
export function assessEntityLevelClarity(dictionaryFieldRows) {
  const rows = Array.isArray(dictionaryFieldRows) ? dictionaryFieldRows : [];
  if (rows.length === 0) {
    return dimensionResult("entity_level_clarity", "unresolved", "No committed data-dictionary fields exist to assess.");
  }
  const undefinedFields = rows.filter((row) => row?.entity_level === "unknown" || !isNonEmptyString(row?.entity_level));
  if (undefinedFields.length === 0) {
    return dimensionResult(
      "entity_level_clarity",
      "resolved_clear",
      "Every committed dictionary field has a defined entity level.",
      { field_count: rows.length },
    );
  }
  return dimensionResult(
    "entity_level_clarity",
    "resolved_risk_flagged",
    "One or more committed dictionary fields have no defined entity level.",
    { field_count: rows.length, undefined_field_count: undefinedFields.length },
  );
}

/**
 * small_cell_risk: `kai.intake_sensitivity_profiles.small_cell_risk_status`
 * is the only committed fact this dimension ever assesses - a 3-state
 * ('unknown' | 'present' | 'absent') CHECK-enforced column already
 * authoritative for this exact question.
 */
export function assessSmallCellRisk(profileRow) {
  const status = profileRow?.small_cell_risk_status;
  if (status === "present") {
    return dimensionResult("small_cell_risk", "resolved_risk_flagged", "The committed sensitivity profile declares small-cell risk present.");
  }
  if (status === "absent") {
    return dimensionResult("small_cell_risk", "resolved_clear", "The committed sensitivity profile declares small-cell risk absent.");
  }
  return dimensionResult("small_cell_risk", "unresolved", "The committed sensitivity profile does not yet resolve small-cell risk.");
}

/**
 * conflicting_source_indicators: this dimension may only be resolved from an
 * authoritative engagement or requirement relationship. Fresh repository
 * inspection (recorded in this package's own ExecPlan evidence block) found
 * no such relationship committed anywhere in the current schema - no
 * engagement/requirement table exists, and `kai.review_queue_items
 * .engagement_id` is an uncorrelated nullable column with no FK to any
 * requirement or engagement entity. This function therefore never scans
 * another source and never invents a requirement identity, mapping, or
 * funder alignment: it always returns unresolved.
 */
export function assessConflictingSourceIndicators() {
  return dimensionResult(
    "conflicting_source_indicators",
    "unresolved",
    "No authoritative engagement or requirement relationship is committed for this source version.",
  );
}

/**
 * requirement_alignment: same authoritative-relationship requirement as
 * conflicting_source_indicators, and the same fresh-inspection finding of no
 * such relationship in the current schema. Always unresolved.
 */
export function assessRequirementAlignment() {
  return dimensionResult(
    "requirement_alignment",
    "unresolved",
    "No authoritative requirement relationship is committed for this source version.",
  );
}

/**
 * coverage_gaps: compares the committed set of `kai.data_dictionary_fields
 * .profile_field_key` values against the set of field keys the current
 * `kai.source_versions`' own committed P2-01 evidence already covers (derived
 * only from each `kai.evidence_items` row's bound `kai.source_locators
 * .coordinates.column_name` - never from a sample, filename, or inference).
 */
export function assessCoverageGaps(dictionaryFieldRows, evidenceFieldKeys) {
  const fields = Array.isArray(dictionaryFieldRows) ? dictionaryFieldRows : [];
  if (fields.length === 0) {
    return dimensionResult("coverage_gaps", "unresolved", "No committed data-dictionary fields exist to assess.");
  }
  const covered = new Set(Array.isArray(evidenceFieldKeys) ? evidenceFieldKeys : []);
  const missing = fields.filter((row) => !covered.has(row?.profile_field_key)).map((row) => row.profile_field_key);
  if (missing.length === 0) {
    return dimensionResult(
      "coverage_gaps",
      "resolved_clear",
      "Every committed dictionary field has at least one committed evidence item.",
      { field_count: fields.length },
    );
  }
  return dimensionResult(
    "coverage_gaps",
    "resolved_risk_flagged",
    "One or more committed dictionary fields have no committed evidence item.",
    { field_count: fields.length, uncovered_field_count: missing.length, uncovered_field_keys: missing },
  );
}

export const __evidenceCoverageAssessmentValidatorsTestables = Object.freeze({
  dimensionResult,
});
