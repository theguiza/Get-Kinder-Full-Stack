import { createHash } from "node:crypto";

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
