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
// The XLSX method: the data rows after the header row of the workbook's only
// worksheet, from the P1 worksheet record-count basis (localProfilingKernel).
export const MEASUREMENT_XLSX_CALCULATION_METHOD = "p1_xlsx_single_worksheet_data_rows_excluding_blank_v1";
export const MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD = "p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1";
export const MEASUREMENT_XLSX_RECORD_COUNT_BASIS_VERSION = "kai_xlsx_worksheet_record_basis_v1";
export const MEASUREMENT_CALCULATION_METHODS = Object.freeze([MEASUREMENT_CALCULATION_METHOD, MEASUREMENT_XLSX_CALCULATION_METHOD, MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD]);
const SHEET_KEY_RE = /^sheet_[1-9][0-9]{0,3}$/;
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

// The same label, plain-text, and calendar-date rules for every human
// measurement definition (the paired-outcome definition reuses them).
export const __measurementDefinitionTextRules = Object.freeze({ LABEL_RE, isSafeRuleText, isCalendarDate, MAX_RULE_LENGTH });

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

function isCountAtMost(value, total) {
  return isCount(value) && value <= total;
}

/**
 * The exact-duplicate structure of the counted records, from the committed
 * profile's tabular measurement basis of the same table (CSV) or worksheet
 * (XLSX): how many counted records belong to groups of identical records
 * (members) and how many are copies beyond the first of their group (excess
 * copies). Two pairs are 4 members and 2 excess copies. Only when that basis
 * was assessed over exactly the counted records and is internally consistent
 * (M members in G >= 1 groups of two or more: excess = M - G); otherwise
 * null, and the statement says the excess is not recorded. The P1 profile's
 * duplicate_row_count is members over every data row, blank rows included.
 */
export function countedDuplicateGroups(tabularBasis, countedRecords) {
  const duplicates = isPlainObject(tabularBasis) ? tabularBasis.exact_duplicates : null;
  if (!isPlainObject(tabularBasis) || tabularBasis.status !== "assessed" || tabularBasis.record_count !== countedRecords || !isPlainObject(duplicates)) return null;
  const { group_count: groups, member_record_count: members, excess_copy_count: excess } = duplicates;
  if (![groups, members, excess].every(isCount) || members > countedRecords || excess !== members - groups) return null;
  if (groups === 0 ? members !== 0 : members < 2 * groups) return null;
  return Object.freeze({ memberRecordCount: members, excessCopyCount: excess });
}

const UNCOUNTABLE_WORKSHEET_CONDITIONS = Object.freeze([
  ["formula_cell_count", "measurement_xlsx_formula_cells_present",
    "The worksheet has formula cells; KAI does not evaluate formulas, so it cannot tell which rows hold values.",
    "Replace the formulas with their values in a copy of the workbook and upload that copy."],
  ["merged_range_count", "measurement_xlsx_merged_cells_present",
    "The worksheet has merged cells, so where one record ends and the next begins is ambiguous.",
    "Unmerge the cells in a copy of the workbook and upload that copy."],
  ["hidden_row_count", "measurement_xlsx_hidden_rows_or_columns_present",
    "The worksheet has hidden rows, which would be counted without being seen.",
    "Unhide or delete the hidden rows in a copy of the workbook and upload that copy."],
  ["hidden_column_count", "measurement_xlsx_hidden_rows_or_columns_present",
    "The worksheet has hidden columns, which would be counted without being seen.",
    "Unhide or delete the hidden columns in a copy of the workbook and upload that copy."],
  ["values_outside_header_columns_count", "measurement_xlsx_not_single_table",
    "The worksheet has values in columns with no header, so it may hold more than one table.",
    "Keep one table with a header for every column on the worksheet, then upload the workbook again."],
  ["unresolved_value_count", "measurement_xlsx_values_unresolved",
    "Some worksheet cells refer to text the workbook does not contain.",
    "Save the workbook again from the spreadsheet application and upload it again."],
]);

function deriveCsvRecordCount(profile) {
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
      calculationMethod: MEASUREMENT_CALCULATION_METHOD,
      locatorCoordinates: MEASUREMENT_LOCATOR_COORDINATES,
      sheetKey: null,
      totalRecordCount: counts.row_count,
      blankRecordCount: counts.blank_record_count,
      duplicateRecordCount: counts.duplicate_row_count,
      countedDuplicates: countedDuplicateGroups(profile.tabular_measurement_basis, counts.row_count - counts.blank_record_count),
      measuredValue: counts.row_count - counts.blank_record_count,
    }),
  };
}

// A workbook profile qualifies only when the selected worksheet's committed
// record-count basis establishes the header row and records none of the
// conditions that make the table ambiguous. Workbook-wide row counts are
// never used for worksheet measurements.
function deriveXlsxRecordCount(profile, selectedWorksheetKey = null) {
  const sheets = profile.sheets;
  if (!Array.isArray(sheets) || sheets.length === 0 || profile.counts?.sheet_count !== sheets.length) {
    return refuse(
      "measurement_xlsx_worksheet_profile_invalid",
      "The workbook does not have a complete committed worksheet profile.",
      "Upload the workbook again so KAI can profile each worksheet.",
      { objectType: "source_version" },
    );
  }
  if (sheets.length > 1 && !SHEET_KEY_RE.test(selectedWorksheetKey ?? "")) {
    return refuse(
      "measurement_xlsx_worksheet_selection_required",
      "Choose one worksheet to count. KAI never combines worksheets.",
      "Select the intended worksheet from this workbook.",
      { objectType: "source_version" },
    );
  }
  if (selectedWorksheetKey !== null && !sheets.some((sheet) => sheet.sheet_key === selectedWorksheetKey)) {
    return refuse(
      "measurement_xlsx_worksheet_selection_invalid",
      "The selected worksheet is not part of this workbook profile.",
      "Select one of the listed worksheets.",
      { objectType: "source_version" },
    );
  }
  const sheet = sheets.length === 1 ? sheets[0] : sheets.find((candidate) => candidate.sheet_key === selectedWorksheetKey);
  const basis = sheet?.record_count_basis;
  if (!isPlainObject(basis) || basis.basis_version !== MEASUREMENT_XLSX_RECORD_COUNT_BASIS_VERSION || !SHEET_KEY_RE.test(sheet.sheet_key ?? "")) {
    return refuse(
      "measurement_xlsx_record_basis_not_committed",
      "This workbook was profiled before worksheet records were counted, so it states no header row or blank rows to count from.",
      "In Files, choose the same workbook again and select \"Upload again as a new intake version\"; the new version is profiled with worksheet record counting.",
      { objectType: "source_version" },
    );
  }
  if (basis.header_row_established !== true || basis.header_row_position !== 1) {
    return refuse(
      "measurement_header_not_established",
      "The worksheet's first row is not a header row of text column names, so KAI cannot tell headers from records.",
      "Put one header row of column names in the worksheet's first row, then upload the workbook again.",
      { objectType: "source_version" },
    );
  }
  for (const [key, blockingReason, message, requiredFix] of UNCOUNTABLE_WORKSHEET_CONDITIONS) {
    if (!isCount(basis[key])) {
      return refuse("measurement_counts_not_committed", "The committed profile does not state the record counts.", "Upload the workbook again.", { objectType: "source_version" });
    }
    if (basis[key] > 0) return refuse(blockingReason, message, requiredFix, { objectType: "source_version" });
  }
  const total = basis.data_record_count;
  if (!isCount(total) || !isCountAtMost(basis.blank_record_count, total) || !isCountAtMost(basis.duplicate_record_count, total)) {
    return refuse("measurement_counts_inconsistent", "The committed profile counts are inconsistent.", "Upload the workbook again.", { objectType: "source_version" });
  }
  return {
    ok: true,
    measurement: Object.freeze({
      calculationMethod: sheets.length > 1 ? MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD : MEASUREMENT_XLSX_CALCULATION_METHOD,
      locatorCoordinates: Object.freeze({ scope: MEASUREMENT_LOCATOR_COORDINATES.scope, sheet_key: sheet.sheet_key }),
      sheetKey: sheet.sheet_key,
      sheetName: sheet.safe_sheet_name ?? `Worksheet ${sheet.sheet_key.replace("sheet_", "")}`,
      totalRecordCount: total,
      blankRecordCount: basis.blank_record_count,
      duplicateRecordCount: basis.duplicate_record_count,
      countedDuplicates: countedDuplicateGroups(sheet.tabular_measurement_basis, total - basis.blank_record_count),
      measuredValue: total - basis.blank_record_count,
    }),
  };
}

/**
 * The record count from one committed P1 profile: data records after the
 * header row, as parsed by the deterministic P1 profiler from the exact
 * confirmed bytes, minus records whose every field is empty. Exact-duplicate
 * records remain counted and reported. Multi-worksheet XLSX requires one
 * explicitly selected stable worksheet key; worksheets are never combined.
 */
export function deriveRecordCountMeasurement(profile, selectedWorksheetKey = null) {
  if (isPlainObject(profile) && profile.status === "profiled" && profile.format === "csv") return deriveCsvRecordCount(profile);
  if (isPlainObject(profile) && profile.status === "profiled" && profile.format === "xlsx") return deriveXlsxRecordCount(profile, selectedWorksheetKey);
  return refuse(
    "measurement_source_not_single_table",
    "A record count is available only for a profiled single-table CSV file or a supported Excel worksheet.",
    "Use a CSV file or an Excel workbook with a committed worksheet record-count basis.",
    { objectType: "source_version" },
  );
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

// What one counted record is, by calculation method.
const RECORD_NOUN = Object.freeze({
  [MEASUREMENT_CALCULATION_METHOD]: "CSV data record",
  [MEASUREMENT_XLSX_CALCULATION_METHOD]: "worksheet data row",
  [MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD]: "selected worksheet data row",
});

function recordNoun(calculationMethod) {
  return RECORD_NOUN[calculationMethod] ?? RECORD_NOUN[MEASUREMENT_CALCULATION_METHOD];
}

/** The calculation a method names, in the words the internal report uses. */
export function describeMeasurementCalculationMethod(calculationMethod) {
  return calculationMethod === MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD
    ? "every data row after the header row of the explicitly selected worksheet of the exact promoted source version is one record; rows none of whose cells has a value are excluded."
    : calculationMethod === MEASUREMENT_XLSX_CALCULATION_METHOD
    ? "every data row after the header row of the only worksheet of the exact promoted source version is one record; rows none of whose cells has a value are excluded."
    : "every CSV data record after the header row of the exact promoted source version is one record; records whose every field is empty are excluded.";
}

/**
 * Measurement-to-claim factual integrity (owner Package 1, 2026-11-10). The
 * P2-01M calculation establishes exactly one thing: how many physical data
 * records (rows after the header row, blank ones excluded) the exact source
 * version holds. It applies no status, date, period, roster, inclusion or
 * exclusion predicate and removes no duplicate. The person's definition
 * (counted unit, unit label, period, inclusion and exclusion rules) is
 * recorded and attributed to the organization; it never becomes the counted
 * entity, an applied period or an applied rule. A stronger measurement
 * (records with a status, in a period, distinct people) is a source-derived
 * measurement whose method executes those conditions.
 *
 * Duplicates: the committed profile states how many records belong to groups
 * of identical records (group members) and, for profiles committed since,
 * how many are copies beyond the first of their group (excess copies). The
 * record count removes neither.
 */
export const MEASURED_RECORD_UNIT = "source records";

// The duplicate policy the record count applied (none: every counted record
// stays counted), with the committed duplicate structure. dataRowMembers is
// the measurement's own group-member count over every data row.
function duplicatePhrase(countedDuplicates, dataRowMembers) {
  if (countedDuplicates) {
    return countedDuplicates.memberRecordCount === 0
      ? "no exact duplicates"
      : `${countedDuplicates.memberRecordCount} in exact-duplicate groups `
        + `(${plural(countedDuplicates.excessCopyCount, "excess copy", "excess copies")}), not removed`;
  }
  return !isCount(dataRowMembers) || dataRowMembers === 0
    ? "no exact duplicates"
    : `${dataRowMembers} data records in exact-duplicate groups (excess copies not recorded), not removed`;
}

function definitionAttribution({ countedUnit, periodStart, periodEnd }) {
  return periodStart
    ? `Not applied by KAI: the organization's description of each record as one ${countedUnit}, its stated period ${periodStart} to ${periodEnd}, and its inclusion and exclusion rules.`
    : `Not applied by KAI: the organization's description of each record as one ${countedUnit} and its inclusion and exclusion rules; no reporting period was defined.`;
}

/**
 * Evidence statement: the calculated count of source records, with the
 * method's own blank and duplicate handling, then the person's definition
 * attributed to the organization and explicitly not applied. The unit label
 * stays on the recorded definition.
 */
export function composeMeasurementEvidenceStatement({ measurement, definition }) {
  const sheetCitation = measurement.calculationMethod === MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD
    ? ` from selected worksheet ${measurement.sheetKey}`
    : "";
  return `Source version record count: ${measurement.measuredValue} ${MEASURED_RECORD_UNIT}${sheetCitation} `
    + `(each ${recordNoun(measurement.calculationMethod)} after the header row; `
    + `${plural(measurement.blankRecordCount, "blank record")} excluded; `
    + `${duplicatePhrase(measurement.countedDuplicates ?? null, measurement.duplicateRecordCount)}). `
    + definitionAttribution(definition);
}

/**
 * Claim statement: composed from the persisted measurement and definition
 * rows - never from the evidence statement text. Asserts only the number of
 * source records the calculation established; the counted unit and period
 * the person defined are attributed to the organization as not applied. No
 * outcome, cause, participant, status, period or rate is asserted.
 */
export function composeMeasurementClaimStatement({ measurementRow, definitionRow, locatorCoordinates = null }) {
  const sheetCitation = measurementRow.calculation_method === MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD
    ? ` in selected worksheet ${locatorCoordinates?.sheet_key ?? "(unavailable)"}`
    : "";
  const countedDuplicates = countedDuplicateGroups(measurementRow.profile_tabular_duplicates ?? null, measurementRow.measured_value);
  return `The promoted source has ${measurementRow.measured_value} ${MEASURED_RECORD_UNIT}${sheetCitation} `
    + `(record count: one record per ${recordNoun(measurementRow.calculation_method)}; `
    + `${plural(Number(measurementRow.blank_record_count), "blank record")} excluded; `
    + `${duplicatePhrase(countedDuplicates, Number(measurementRow.duplicate_record_count))}). `
    + definitionAttribution({ countedUnit: definitionRow.counted_unit, periodStart: definitionRow.period_start, periodEnd: definitionRow.period_end });
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
// A CSV count sits on the whole-version data-records locator; an XLSX count
// on the data records of exactly one named worksheet.
function locatorMatchesCalculationMethod(coordinates, calculationMethod) {
  const keys = Object.keys(coordinates).sort().join(",");
  if ([MEASUREMENT_XLSX_CALCULATION_METHOD, MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD].includes(calculationMethod)) return keys === "scope,sheet_key" && SHEET_KEY_RE.test(coordinates.sheet_key);
  return keys === "scope";
}

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
    && MEASUREMENT_CALCULATION_METHODS.includes(measurementRow.calculation_method)
    && measurementRow.unit_label === measurementRow.definition_unit_label
    && isCount(measurementRow.measured_value)
    && measurementRow.measured_value === measurementRow.total_record_count - measurementRow.blank_record_count
    && locatorRow?.locator_type === MEASUREMENT_LOCATOR_TYPE
    && locatorRow?.coordinates?.scope === MEASUREMENT_LOCATOR_COORDINATES.scope
    && locatorMatchesCalculationMethod(locatorRow.coordinates, measurementRow.calculation_method)
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
    "What one record represents, and its inclusion and exclusion rules, were defined by a person at the organization; KAI counted the records but did not apply those rules or verify what the records represent.",
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

// Evidence Summary disclosure (owner prompt "KAI — Reproduce and repair
// Evidence Summary VAL-GEN-008", 2026-11-01). The server appends this to a
// block citing an ordinary measured claim, so the model never has to guess
// wording VAL-GEN-008 accepts. Composed only from the claim's limitation
// codes: no numbers, worksheet, label, or other free text, and none of the
// words a released document's prose must not use, even negated (distinct,
// unique, participants, outcomes, ...).
const EVIDENCE_SUMMARY_DISCLOSURES = Object.freeze({
  [MEASUREMENT_LIMITATION_CODES.RECORD_MEANING_HUMAN_DEFINED]:
    "It is a count of source records only, and one record is not necessarily one separate person, event or result; "
    + "what one counted record represents is human-defined by the organization and was not verified by KAI.",
  [MEASUREMENT_LIMITATION_CODES.PERIOD_HUMAN_ATTESTED]:
    "The reporting period is attested in the record definition and was not verified against dates in the records.",
  [MEASUREMENT_LIMITATION_CODES.NO_REPORTING_PERIOD]: "No reporting period was defined for the count.",
  [MEASUREMENT_LIMITATION_CODES.BLANK_RECORDS_EXCLUDED]: "Blank records were excluded from the count.",
  [MEASUREMENT_LIMITATION_CODES.DUPLICATE_RECORDS_INCLUDED]:
    "Exact-duplicate records are included in the count; they were not removed or merged.",
});

/**
 * The Evidence Summary disclosure for one measured claim's measurement./
 * coverage. codes, or null when it cannot be composed safely: the record
 * meaning and exactly one period state are required, and every code must
 * have a known description.
 */
export function composeMeasurementDisclosure(codes) {
  const present = new Set(codes);
  const known = new Set(Object.values(MEASUREMENT_LIMITATION_CODES));
  if (!present.has(MEASUREMENT_LIMITATION_CODES.RECORD_MEANING_HUMAN_DEFINED)
    || present.has(MEASUREMENT_LIMITATION_CODES.PERIOD_HUMAN_ATTESTED) === present.has(MEASUREMENT_LIMITATION_CODES.NO_REPORTING_PERIOD)
    || [...present].some((code) => code.startsWith("measurement.") && !known.has(code))) {
    return null;
  }
  const coverage = [...present].filter((code) => code.startsWith("coverage.")).sort().map(describeMeasurementLimitationCode);
  if (coverage.includes(null)) return null;
  const sentences = Object.keys(EVIDENCE_SUMMARY_DISCLOSURES).filter((code) => present.has(code)).map((code) => EVIDENCE_SUMMARY_DISCLOSURES[code]);
  if (coverage.length > 0) sentences.push(`Coverage limitations: ${coverage.join(" ")}`);
  return sentences.join(" ");
}

// Evidence Summary VAL-GEN-008: a forbidden word is a contradiction only when
// asserted. It is negated when directly preceded by not/never/n't/non-,
// optionally through these few qualifiers ("not independently verified",
// "not necessarily unique"); anything else ("not only verified") asserts it.
const NEGATED_PREFIX = /(?:\bnot|\bnever|n't|\bnon-)(?:\s+(?:been|be|yet|independently|necessarily|formally|separately|externally))*\s*$/i;

/** The words of `pattern` that `text` asserts rather than negates. */
export function affirmativeMatches(text, pattern) {
  const source = String(text || "");
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return [...source.matchAll(global)]
    .filter((match) => !NEGATED_PREFIX.test(source.slice(Math.max(0, match.index - 80), match.index)))
    .map((match) => match[0]);
}

// A measured count is of source records; it never establishes that they are
// distinct people, events, or outcomes.
export const MEASUREMENT_UNIQUENESS_PATTERN = /\b(distinct|unique|deduplicated)\b/i;

// How an Evidence Summary block names each coverage dimension; each matches
// its COVERAGE_DIMENSION_LABELS wording.
const COVERAGE_DIMENSION_NAME_PATTERNS = Object.freeze({
  missingness: /\bmissing values?\b/i,
  duplicates: /\bduplicate/i,
  definition_clarity: /\brecord definition\b/i,
  denominator_clarity: /\bdenominator\b/i,
  time_period_clarity: /\breporting[- ]period\b/i,
  entity_level_clarity: /\bwhat is counted\b|\bcounted unit\b/i,
  small_cell_risk: /\bsmall[- ](?:cell|number)\b/i,
  conflicting_source_indicators: /\bconflicting sources?\b/i,
  requirement_alignment: /\brequirements? alignment\b|\balignment with (?:\w+ )?requirements\b/i,
  coverage_gaps: /\bfield coverage\b/i,
});

/** Whether `text` names the dimension of a coverage.<dimension>.<status> code. */
export function namesCoverageDimension(text, code) {
  const dimensionKey = String(code).split(".")[1] || "";
  const pattern = COVERAGE_DIMENSION_NAME_PATTERNS[dimensionKey]
    ?? new RegExp(`\\b${dimensionKey.split("_").join("[ -]")}\\b`, "i");
  return dimensionKey.length > 0 && pattern.test(String(text || ""));
}

// Evidence Summary VAL-GEN-008 contradiction checks (owner prompt "KAI
// VAL-GEN-008 — Final local safety acceptance", 2026-11-01). They read only
// the model-authored text, so the appended disclosure can never neutralize
// them, and each matches an affirmative form only: a negated statement
// ("was not defined", "has not been resolved") does not fit the pattern.

// A reporting period asserted to exist, for a claim with no reporting period.
export const REPORTING_PERIOD_ASSERTION_PATTERNS = Object.freeze([
  /\b(?:a|the|its)\s+(?:formal\s+)?reporting[- ]period\s+(?:was|is|has been|had been)(?:\s+(?:formally|clearly|already|explicitly))*\s+(?:defined|established|set|specified|stated|attested|provided|recorded|identified|given|confirmed|verified)\b/i,
  /\b(?:defined|established|specified|attested)\s+(?:a|the)\s+reporting[- ]period\b/i,
]);

const COVERAGE_CLEARED_VERBS = "resolved|cleared|established|addressed|removed|mitigated|eliminated|reconciled|confirmed|satisfied|met|fixed|closed|verified|corrected";

/**
 * A coverage dimension asserted to be resolved or cleared ("Conflicting
 * sources have been resolved"), for a coverage.<dimension>.<status> code. Every
 * such code a claim carries is not clear (unresolved, flagged, or accepted
 * only as an internal limitation), so the assertion contradicts it.
 */
export function coverageStatusClearedPattern(code) {
  const dimensionKey = String(code).split(".")[1] || "";
  const name = COVERAGE_DIMENSION_NAME_PATTERNS[dimensionKey]?.source ?? `\\b${dimensionKey.split("_").join("[ -]")}\\b`;
  return new RegExp(
    // "No reporting period is established" negates the dimension itself.
    `(?<!\\b(?:no|not|nor)\\s+(?:formal\\s+)?)(?:${name})(?:[\\s-]+[\\w()]+){0,3}?\\s+(?:has|have|had|is|are|was|were)`
    + `(?:\\s+(?:been|now|fully|since|already|all|largely|successfully|completely|properly))*\\s+(?:${COVERAGE_CLEARED_VERBS})\\b`,
    "i",
  );
}

// The measured value, the unit the calculation established, and the text that
// asserts it, of a composed measurement claim statement, or null. A current
// statement asserts "source records"; what follows it is the organization's
// definition, attributed and not applied, so it authorizes no counted entity,
// status or service. A statement composed before the Package 1 integrity
// repair asserted the person's unit label as the counted entity; it is read
// as asserting records only (unitLabel null), never the label.
const MEASURED_COUNT_STATEMENT_PATTERN = /^The promoted source has (\d+) source records\b[^.]*?\)\./;
const LEGACY_MEASURED_COUNT_STATEMENT_PATTERN = /^The promoted source records (\d+) (.+?) (?:for the reporting period |with no reporting period defined)/;

export function parseMeasuredCountStatement(statement) {
  const text = String(statement || "");
  const current = MEASURED_COUNT_STATEMENT_PATTERN.exec(text);
  if (current) return Object.freeze({ value: current[1], unitLabel: MEASURED_RECORD_UNIT, assertedText: current[0], legacy: false });
  const legacy = LEGACY_MEASURED_COUNT_STATEMENT_PATTERN.exec(text);
  return legacy ? Object.freeze({ value: legacy[1], unitLabel: null, assertedText: `The promoted source records ${legacy[1]} records.`, legacy: true }) : null;
}

/**
 * The part of a claim statement that is asserted as established. For a
 * record-count claim it is the count of source records only; any other
 * statement is asserted as a whole.
 */
export function assertedClaimText(statement) {
  return parseMeasuredCountStatement(statement)?.assertedText ?? String(statement || "");
}

// A service or outcome asserted of the counted records. A source record
// count never establishes one.
export const SERVICE_DELIVERY_PATTERN = /\b(served|helped|reached|supported|benefit(?:ed|ted|s)?|enrolled|attended|completed|delivered|assisted|treated|graduated|achieved)\b/i;
