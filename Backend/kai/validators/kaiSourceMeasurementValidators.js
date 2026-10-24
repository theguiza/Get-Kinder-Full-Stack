import { createHash } from "node:crypto";
import { __evidenceCoverageAssessmentValidatorsTestables } from "./kaiEvidenceCoverageAssessmentValidators.js";

const { dimensionResult } = __evidenceCoverageAssessmentValidatorsTestables;

/**
 * KAI P2-01M source record-count measurement: pure validators and the
 * deterministic composition of the measurement, its evidence statement, and
 * its claim statement. Nothing here reads a database, a file, or caller text
 * beyond the explicit human definition; the measured value comes only from the
 * committed P1 profile counts of the exact profile bound to the source version.
 */

export const MEASUREMENT_TYPE_RECORD_COUNT = "source_record_count";
export const MEASUREMENT_EVIDENCE_TYPE = "source_record_count_measurement";
export const MEASUREMENT_DATA_CLASS = "source_derived_aggregate";
export const MEASUREMENT_LOCATOR_TYPE = "source_data_records";
export const MEASUREMENT_LOCATOR_COORDINATES = Object.freeze({ scope: "data_records_after_header" });
export const MEASUREMENT_CALCULATION_METHOD = "p1_csv_profile_data_records_excluding_blank_v1";
export const MEASUREMENT_DEFINITION_STATUS = "human_confirmed";
export const MEASUREMENT_VALIDATOR_KEY = "VAL-KAI-P2-01M-001";

const DEFINITION_KEYS = Object.freeze([
  "counted_unit",
  "unit_label",
  "definition_text",
  "inclusion_rule",
  "exclusion_rule",
  "period_start",
  "period_end",
]);
const REQUIRED_DEFINITION_KEYS = new Set(["counted_unit", "unit_label", "definition_text", "inclusion_rule", "exclusion_rule"]);
const LABEL_RE = /^[A-Za-z][A-Za-z0-9 '()-]{0,79}$/;
const MAX_RULE_LENGTH = 300;
// The same unsafe-content pattern the evidence_items/claims statement CHECKs apply.
const UNSAFE_TEXT_RE = /(https?:\/\/|\/Users\/|\/private\/|\/var\/|\/etc\/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])/i;
const CONTROL_CHARACTER_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STATEMENT_LENGTH = 500;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function blocker(blockingReason, message, requiredFix, { objectType = "source_measurement_definition", objectId = null } = {}) {
  return {
    validator_key: MEASUREMENT_VALIDATOR_KEY,
    severity: "blocker",
    object_type: objectType,
    object_code: "record_source_record_count_measurement",
    object_id: objectId,
    message,
    blocking_reason: blockingReason,
    required_fix: requiredFix,
    evidence: {},
  };
}

function refuse(blockingReason, message, requiredFix, options) {
  return { ok: false, code: "validation_blocker", blockers: [blocker(blockingReason, message, requiredFix, options)] };
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isSafeRuleText(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= MAX_RULE_LENGTH
    && value === value.trim()
    && !CONTROL_CHARACTER_RE.test(value)
    && !UNSAFE_TEXT_RE.test(value);
}

/**
 * The human definition of one counted record. Every meaning-bearing field is
 * required: without an explicit statement of what one record is, a count is
 * not a measurement, and nothing is inferred from a header, a filename, or a
 * value. The reporting period is optional but, when given, both dates must be
 * real calendar dates with end >= start.
 */
export function validateRecordCountDefinition(definition) {
  if (!isPlainObject(definition)) {
    return refuse(
      "measurement_definition_required",
      "A record-count measurement needs a human definition of what one data record represents.",
      "Provide counted_unit, unit_label, definition_text, inclusion_rule, and exclusion_rule.",
    );
  }
  const keys = Object.keys(definition);
  if (!keys.every((key) => DEFINITION_KEYS.includes(key))) {
    return refuse("measurement_definition_unknown_field", "The measurement definition has an unsupported field.", "Send only the documented definition fields.");
  }
  const missing = [...REQUIRED_DEFINITION_KEYS].filter((key) => typeof definition[key] !== "string" || definition[key].trim().length === 0);
  if (missing.length > 0) {
    return refuse(
      "measurement_definition_incomplete",
      "The measurement definition does not say what one record represents, its unit, or what is included and excluded.",
      `Provide a non-empty value for: ${missing.join(", ")}.`,
    );
  }
  if (!LABEL_RE.test(definition.counted_unit) || !LABEL_RE.test(definition.unit_label) || UNSAFE_TEXT_RE.test(`${definition.counted_unit} ${definition.unit_label}`)) {
    return refuse(
      "measurement_definition_label_invalid",
      "The counted unit and unit label must be short plain-text labels.",
      "Use letters, digits, spaces, apostrophes, hyphens, or parentheses (at most 80 characters, starting with a letter).",
    );
  }
  for (const key of ["definition_text", "inclusion_rule", "exclusion_rule"]) {
    if (!isSafeRuleText(definition[key])) {
      return refuse(
        "measurement_definition_text_invalid",
        `The measurement definition's ${key} is not acceptable plain text.`,
        `Provide ${key} as plain text of at most ${MAX_RULE_LENGTH} characters, without links, paths, or credentials.`,
      );
    }
  }
  const periodStart = definition.period_start ?? null;
  const periodEnd = definition.period_end ?? null;
  if ((periodStart === null) !== (periodEnd === null)) {
    return refuse("measurement_period_incomplete", "A reporting period needs both a start and an end date.", "Provide both period_start and period_end, or neither.");
  }
  if (periodStart !== null && (!isCalendarDate(periodStart) || !isCalendarDate(periodEnd) || periodEnd < periodStart)) {
    return refuse("measurement_period_invalid", "The reporting period is not a valid date range.", "Use YYYY-MM-DD dates with period_end on or after period_start.");
  }
  const normalized = {
    countedUnit: definition.counted_unit,
    unitLabel: definition.unit_label,
    definitionText: definition.definition_text,
    inclusionRule: definition.inclusion_rule,
    exclusionRule: definition.exclusion_rule,
    periodStart,
    periodEnd,
  };
  return { ok: true, definition: Object.freeze(normalized) };
}

export function computeDefinitionFingerprint({ organizationId, sourceVersionId, definition }) {
  return createHash("sha256")
    .update(JSON.stringify([
      organizationId,
      sourceVersionId,
      MEASUREMENT_TYPE_RECORD_COUNT,
      definition.countedUnit,
      definition.unitLabel,
      definition.definitionText,
      definition.inclusionRule,
      definition.exclusionRule,
      definition.periodStart,
      definition.periodEnd,
    ]))
    .digest("hex");
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * The record count from one committed P1 profile: data records after the
 * header row, as parsed by the deterministic P1 profiler from the exact
 * confirmed bytes, minus records whose every field is empty. Exact-duplicate
 * records are counted (no rule identifies them as invalid) and reported.
 * Only a single-table CSV profile that states every count qualifies; a profile
 * that lacks the blank-record count (profiled before it existed) is refused
 * rather than assumed to have none.
 */
export function deriveRecordCountMeasurement(profile) {
  if (!isPlainObject(profile) || profile.status !== "profiled" || profile.format !== "csv") {
    return refuse(
      "measurement_source_not_single_table_csv",
      "A record count is available only for a profiled single-table CSV source.",
      "Use a CSV source; other formats have no committed record count.",
      { objectType: "source_version" },
    );
  }
  const counts = profile.counts;
  if (profile.structural_metadata?.header_row_assumed !== true) {
    return refuse("measurement_header_not_established", "The profile does not establish a header row.", "Re-profile the source.", { objectType: "source_version" });
  }
  if (!isPlainObject(counts) || !isCount(counts.row_count) || !isCount(counts.duplicate_row_count)) {
    return refuse("measurement_counts_not_committed", "The committed profile does not state the record counts.", "Re-profile the source.", { objectType: "source_version" });
  }
  if (!isCount(counts.blank_record_count)) {
    return refuse(
      "measurement_blank_record_count_not_committed",
      "This source was profiled before blank records were counted, so its record count cannot exclude them.",
      "Upload the file again as a new intake version so it is profiled with blank-record counting.",
      { objectType: "source_version" },
    );
  }
  if (counts.blank_record_count > counts.row_count || counts.duplicate_row_count > counts.row_count) {
    return refuse("measurement_counts_inconsistent", "The committed profile counts are inconsistent.", "Re-profile the source.", { objectType: "source_version" });
  }
  return {
    ok: true,
    measurement: Object.freeze({
      totalRecordCount: counts.row_count,
      blankRecordCount: counts.blank_record_count,
      duplicateRecordCount: counts.duplicate_row_count,
      measuredValue: counts.row_count - counts.blank_record_count,
    }),
  };
}

function periodPhrase(definition) {
  return definition.periodStart
    ? `for the reporting period ${definition.periodStart} to ${definition.periodEnd}`
    : "with no reporting period defined";
}

function plural(count, singular) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * Evidence statement: the value, unit, counted unit, period, and the
 * arithmetic, composed only from the measurement and the human definition.
 */
export function composeMeasurementEvidenceStatement({ measurement, definition }) {
  return `Source version record count: ${measurement.measuredValue} ${definition.unitLabel} ${periodPhrase(definition)}, `
    + `counting each CSV data record after the header row as one ${definition.countedUnit}; `
    + `${plural(measurement.blankRecordCount, "blank record")} excluded; `
    + `${plural(measurement.duplicateRecordCount, "exact-duplicate record")} included.`;
}

/**
 * Claim statement: composed from the persisted measurement and definition
 * rows - never from the evidence statement text. States only the counted
 * value and its definition; no outcome, cause, participant, or rate.
 */
export function composeMeasurementClaimStatement({ measurementRow, definitionRow }) {
  const definition = {
    periodStart: definitionRow.period_start,
    periodEnd: definitionRow.period_end,
  };
  return `The promoted source records ${measurementRow.measured_value} ${definitionRow.unit_label} ${periodPhrase(definition)} `
    + `(record count: one ${definitionRow.counted_unit} per CSV data record; `
    + `${plural(Number(measurementRow.blank_record_count), "blank record")} excluded, `
    + `${plural(Number(measurementRow.duplicate_record_count), "exact-duplicate record")} included).`;
}

export function validateComposedStatement(statement) {
  if (typeof statement !== "string" || statement.length === 0 || statement.length > MAX_STATEMENT_LENGTH || UNSAFE_TEXT_RE.test(statement)) {
    return refuse(
      "measurement_statement_not_composable",
      "The measurement cannot be stated within the evidence statement limits.",
      "Shorten the counted unit or unit label.",
    );
  }
  return { ok: true };
}

/**
 * P2-03 basis for a measurement claim: the persisted measurement must belong
 * to exactly this evidence item, organization, and current source version,
 * carry its human-confirmed definition for the same version, sit on the
 * whole-version data-records locator, keep its own arithmetic, and still be
 * bound to the profile the source version was promoted from. Anything else
 * fails closed; a claim is never composed from the evidence statement text.
 */
export function validateMeasurementClaimBasis({ evidenceItemRow, locatorRow, sourceVersionRow, measurementRow }) {
  const ok = Boolean(measurementRow)
    && evidenceItemRow?.evidence_type === MEASUREMENT_EVIDENCE_TYPE
    && evidenceItemRow.data_class === MEASUREMENT_DATA_CLASS
    && measurementRow.evidence_item_id === evidenceItemRow.evidence_item_id
    && measurementRow.organization_id === evidenceItemRow.organization_id
    && measurementRow.source_version_id === evidenceItemRow.source_version_id
    && measurementRow.definition_source_version_id === evidenceItemRow.source_version_id
    && measurementRow.measurement_type === MEASUREMENT_TYPE_RECORD_COUNT
    && measurementRow.definition_status === MEASUREMENT_DEFINITION_STATUS
    && measurementRow.calculation_method === MEASUREMENT_CALCULATION_METHOD
    && measurementRow.unit_label === measurementRow.definition_unit_label
    && isCount(measurementRow.measured_value)
    && measurementRow.measured_value === measurementRow.total_record_count - measurementRow.blank_record_count
    && locatorRow?.locator_type === MEASUREMENT_LOCATOR_TYPE
    && locatorRow?.coordinates?.scope === MEASUREMENT_LOCATOR_COORDINATES.scope
    && measurementRow.profile_canonical_sha256 === sourceVersionRow?.profile_canonical_sha256;
  if (!ok) {
    return refuse(
      "measurement_claim_basis_invalid",
      "This evidence item's measurement is missing or no longer matches its source version.",
      "Record the measurement again for the current source version.",
      { objectType: "evidence_item", objectId: evidenceItemRow?.evidence_item_id ?? null },
    );
  }
  return { ok: true };
}

/**
 * The client-answerable coverage questions a human-confirmed record-count
 * definition already answers: what one record means, its entity level, that
 * a count has no denominator, and the reporting period (stated, or recorded
 * as not defined). A measured claim never routes these to a client follow-up;
 * the gap of a stated-but-unverified period stays visible as a limitation.
 */
export const MEASUREMENT_ANSWERED_DIMENSION_KEYS = Object.freeze([
  "definition_clarity",
  "denominator_clarity",
  "time_period_clarity",
  "entity_level_clarity",
]);

function measurementMissingnessDimension(measurementRow) {
  const counts = measurementRow.profile_field_missing_counts;
  const blank = measurementRow.blank_record_count;
  // Each field's committed missing_count includes the excluded blank records.
  if (!Array.isArray(counts) || counts.length === 0 || !isCount(blank)
    || !counts.every((value) => isCount(value) && value >= blank)) {
    return dimensionResult("missingness", "unresolved", "The committed profile does not state missing values for the counted records.");
  }
  const fieldsWithMissing = counts.filter((value) => value - blank > 0).length;
  if (fieldsWithMissing === 0) {
    return dimensionResult("missingness", "resolved_clear", "The committed profile records no missing values in the counted records.", { field_count: counts.length });
  }
  return dimensionResult(
    "missingness",
    "resolved_risk_flagged",
    "The committed profile records missing values in some counted records; each record is still counted.",
    { open_finding_count: fieldsWithMissing, field_count: counts.length },
  );
}

function measurementDuplicatesDimension(measurementRow) {
  const duplicates = measurementRow.duplicate_record_count;
  if (!isCount(duplicates)) return dimensionResult("duplicates", "unresolved", "The committed profile does not state duplicate records.");
  if (duplicates === 0) return dimensionResult("duplicates", "resolved_clear", "The committed profile records no exact-duplicate records.");
  return dimensionResult(
    "duplicates",
    "resolved_risk_flagged",
    "The committed profile records exact-duplicate records; they are counted, not removed.",
    { open_finding_count: duplicates },
  );
}

/**
 * Coverage dimensions for a claim on P2-01M measurement evidence: the
 * source-level dimensions (small-cell risk, conflicting sources, requirement
 * alignment) are kept exactly as assessed; the seven that the measurement and
 * its human definition decide are assessed from them. A missing or
 * inconsistent measurement leaves every one of the seven unresolved.
 * Legacy field-presence claims never reach this function.
 */
export function applyMeasurementCoverageDimensions(dimensions, measurementRow) {
  const valid = isPlainObject(measurementRow)
    && measurementRow.definition_status === MEASUREMENT_DEFINITION_STATUS
    && measurementRow.measurement_type === MEASUREMENT_TYPE_RECORD_COUNT;
  if (!valid) {
    const unresolved = (key) => dimensionResult(key, "unresolved", "The measurement or its human definition is not available.");
    return {
      ...dimensions,
      coverage_gaps: unresolved("coverage_gaps"),
      missingness: unresolved("missingness"),
      duplicates: unresolved("duplicates"),
      definition_clarity: unresolved("definition_clarity"),
      denominator_clarity: unresolved("denominator_clarity"),
      time_period_clarity: unresolved("time_period_clarity"),
      entity_level_clarity: unresolved("entity_level_clarity"),
    };
  }
  return {
    ...dimensions,
    missingness: measurementMissingnessDimension(measurementRow),
    duplicates: measurementDuplicatesDimension(measurementRow),
    definition_clarity: dimensionResult(
      "definition_clarity",
      "resolved_clear",
      "A human-confirmed definition states what one counted record represents.",
      { field_count: 1 },
    ),
    denominator_clarity: dimensionResult(
      "denominator_clarity",
      "resolved_clear",
      "The measurement is a record count; it states no rate, so no denominator applies.",
    ),
    time_period_clarity: measurementRow.period_start
      ? dimensionResult(
        "time_period_clarity",
        "resolved_risk_flagged",
        "The reporting period is attested in the human definition; it is not verified against record dates.",
      )
      : dimensionResult(
        "time_period_clarity",
        "resolved_risk_flagged",
        "The human definition records no reporting period; the count is not bounded to a period.",
      ),
    entity_level_clarity: dimensionResult(
      "entity_level_clarity",
      "resolved_clear",
      "A human-confirmed definition states the counted unit.",
      { field_count: 1 },
    ),
    // Field coverage asks whether each dictionary field has field-presence
    // evidence; a record count's evidence is the whole-version data-records
    // locator, so later field evidence can never change this claim's coverage.
    coverage_gaps: dimensionResult(
      "coverage_gaps",
      "resolved_clear",
      "The measurement evidence covers every data record of the source version.",
      { field_count: 1 },
    ),
  };
}

/**
 * Generator-input limitation codes for a measured claim (Plan A Prompt 6): the
 * facts the model must carry beside the claim statement. They separate what
 * a human established (the meaning of a record, the reporting period) from
 * what the P1 parser established (record, blank, and duplicate counts), and
 * name every coverage dimension that is not clear, including those GK
 * accepted as an internal limitation. Derived only from the persisted
 * measurement and the claim's current P2-06 dimensions; nothing is inferred.
 */
export const MEASUREMENT_LIMITATION_CODES = Object.freeze({
  RECORD_MEANING_HUMAN_DEFINED: "measurement.record_meaning_human_defined",
  PERIOD_HUMAN_ATTESTED: "measurement.period_human_attested_not_row_verified",
  NO_REPORTING_PERIOD: "measurement.no_reporting_period",
  BLANK_RECORDS_EXCLUDED: "measurement.blank_records_excluded",
  DUPLICATE_RECORDS_INCLUDED: "measurement.duplicate_records_included",
});

export function measurementLimitationCodes({ measurementRow, dimensions }) {
  const codes = [MEASUREMENT_LIMITATION_CODES.RECORD_MEANING_HUMAN_DEFINED];
  codes.push(measurementRow.period_start ? MEASUREMENT_LIMITATION_CODES.PERIOD_HUMAN_ATTESTED : MEASUREMENT_LIMITATION_CODES.NO_REPORTING_PERIOD);
  if (measurementRow.blank_record_count > 0) codes.push(MEASUREMENT_LIMITATION_CODES.BLANK_RECORDS_EXCLUDED);
  if (measurementRow.duplicate_record_count > 0) codes.push(MEASUREMENT_LIMITATION_CODES.DUPLICATE_RECORDS_INCLUDED);
  for (const [dimensionKey, dimension] of Object.entries(isPlainObject(dimensions) ? dimensions : {})) {
    const status = dimension?.assessment_status;
    if (typeof status !== "string" || status === "resolved_clear") continue;
    codes.push(dimension.internal_limitation_accepted === true
      ? `coverage.${dimensionKey}.accepted_internal_limitation`
      : `coverage.${dimensionKey}.${status}`);
  }
  return [...new Set(codes)].sort();
}

/**
 * What a generated block citing a measured claim must say for each of its
 * limitation codes (VAL-GEN-008), and what it must not say. Deliberately
 * wording-tolerant: it checks that a limitation is disclosed, not how.
 * `requires` is one pattern or a list that must all match.
 */
export const MEASUREMENT_DISCLOSURE_RULES = Object.freeze([
  // The count is of source records under a human's definition: "records"
  // alone is not enough, since the claim statement itself says "the source
  // records 5 ...".
  Object.freeze({ code: MEASUREMENT_LIMITATION_CODES.RECORD_MEANING_HUMAN_DEFINED, requires: [/\bcount of (?:\w+ )?records\b/i, /\bhuman[- ](?:confirmed|defined)\b/i] }),
  Object.freeze({ code: MEASUREMENT_LIMITATION_CODES.PERIOD_HUMAN_ATTESTED, requires: /\b(attested|as stated|stated in the definition|reported period|not (?:been )?verified|unverified)\b/i, forbids: /(?<!not |un|n't |not been )\bverified\b/i }),
  Object.freeze({ code: MEASUREMENT_LIMITATION_CODES.NO_REPORTING_PERIOD, requires: /\bno reporting period\b|\bnot (?:bounded|tied|limited) to a (?:reporting )?period\b/i }),
  Object.freeze({ code: MEASUREMENT_LIMITATION_CODES.BLANK_RECORDS_EXCLUDED, requires: /\bblank\b/i }),
  Object.freeze({ code: MEASUREMENT_LIMITATION_CODES.DUPLICATE_RECORDS_INCLUDED, requires: /\bduplicate/i, forbids: /\b(distinct|unique|deduplicated)\b/i }),
  Object.freeze({ codePrefix: "coverage.", requires: /\blimitations?\b/i }),
]);

export function isMeasurementLimitationCode(code) {
  return typeof code === "string" && (code.startsWith("measurement.") || code.startsWith("coverage."));
}

// Plain-language meaning of each measured-claim limitation code (Plan A
// Prompt 8), the one description the released document and the
// organization's measurement screen both show. A code keeps its exact
// meaning: an accepted limitation stays a limitation, never a resolved fact.
const MEASUREMENT_LIMITATION_DESCRIPTIONS = Object.freeze({
  [MEASUREMENT_LIMITATION_CODES.RECORD_MEANING_HUMAN_DEFINED]:
    "What one record represents was defined by a person at the organization; KAI counted the records but did not verify what they represent.",
  [MEASUREMENT_LIMITATION_CODES.PERIOD_HUMAN_ATTESTED]:
    "The reporting period was stated in that definition; it was not checked against dates in the records.",
  [MEASUREMENT_LIMITATION_CODES.NO_REPORTING_PERIOD]: "No reporting period was defined for the count.",
  [MEASUREMENT_LIMITATION_CODES.BLANK_RECORDS_EXCLUDED]: "Blank records were excluded from the count.",
  [MEASUREMENT_LIMITATION_CODES.DUPLICATE_RECORDS_INCLUDED]:
    "Exact-duplicate records are included in the count; they were not removed or merged, so the count is not of distinct events.",
});
const COVERAGE_DIMENSION_LABELS = Object.freeze({
  missingness: "Missing values",
  duplicates: "Duplicate records",
  definition_clarity: "Record definition",
  denominator_clarity: "Denominator",
  time_period_clarity: "Reporting period",
  entity_level_clarity: "What is counted",
  small_cell_risk: "Small-number (small-cell) risk",
  conflicting_source_indicators: "Conflicting sources",
  requirement_alignment: "Alignment with funder requirements",
  coverage_gaps: "Field coverage",
});
const COVERAGE_STATUS_DESCRIPTIONS = Object.freeze({
  resolved_risk_flagged: "a known limitation of this source, recorded and not removed",
  unresolved: "not yet resolved",
  // Accepted by Get Kinder or by the organization's own administrator; the
  // code does not say which, so the description does not either.
  accepted_internal_limitation: "not resolved; accepted as a limitation for internal use only",
});

/** The plain-language description of a measurement./coverage. limitation code, or null. */
export function describeMeasurementLimitationCode(code) {
  if (typeof code !== "string") return null;
  if (MEASUREMENT_LIMITATION_DESCRIPTIONS[code]) return MEASUREMENT_LIMITATION_DESCRIPTIONS[code];
  const match = /^coverage\.([a-z_]+)\.([a-z_]+)$/.exec(code);
  if (!match || !COVERAGE_DIMENSION_LABELS[match[1]] || !COVERAGE_STATUS_DESCRIPTIONS[match[2]]) return null;
  return `${COVERAGE_DIMENSION_LABELS[match[1]]}: ${COVERAGE_STATUS_DESCRIPTIONS[match[2]]}.`;
}
