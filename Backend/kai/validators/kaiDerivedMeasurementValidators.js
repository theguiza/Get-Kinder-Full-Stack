import { describeDocumentLimitationCode } from "./kaiDocumentEvidenceValidators.js";
import { createHash } from "node:crypto";
import { CROSS_SOURCE_REACH_BASIS_VERSION, CROSS_SOURCE_REACH_METHOD } from "../parsing/crossSourceReachReconciliation.js";
import { PAIRED_OUTCOME_CALCULATION_METHOD } from "../profiling/pairedOutcomeBasis.js";
import { TABULAR_MEASUREMENT_BASIS_VERSION, categoryVocabularyWithheldReason } from "../profiling/tabularMeasurementBasis.js";
import { __evidenceCoverageAssessmentValidatorsTestables } from "./kaiEvidenceCoverageAssessmentValidators.js";
import { derivePairedOutcomeMeasurements } from "./kaiPairedOutcomeMeasurementValidators.js";
import {
  __measurementDefinitionTextRules,
  describeMeasurementLimitationCode,
  validateComposedStatement,
} from "./kaiSourceMeasurementValidators.js";

const { dimensionResult } = __evidenceCoverageAssessmentValidatorsTestables;
const { LABEL_RE, isSafeRuleText, MAX_RULE_LENGTH } = __measurementDefinitionTextRules;

/**
 * KAI Measurement MVP: the shared contract of every source-derived
 * measurement that is not the P2-01M record count - the paired
 * baseline/follow-up outcome change (Package A) and the content-aware
 * tabular counts and rates (Package B). Pure: nothing here reads a database
 * or a file. Each measurement is calculated only from the committed P1
 * profile of the exact promoted source version, and enters the existing
 * Impact Evidence Library as `source_derived_measurement` evidence with one
 * claim, the existing P2-06 traceability, and the existing generation path.
 *
 * Arithmetic and meaning are kept apart. A measurement row holds only what
 * the source establishes (method, fields, conditions, counts, exclusions);
 * it is retained without any human definition. What a measured field means
 * (its label, whether a higher score is better, whether the values are
 * self-reported) is a separate, append-only human interpretation. Each
 * evidence item states one measurement under one interpretation (or under
 * none, as a proposed numerical result); a correction adds an interpretation
 * and new evidence over the same, unchanged measurement row, and evidence
 * stated under a superseded interpretation is no longer current.
 */

export const DERIVED_MEASUREMENT_EVIDENCE_TYPE = "source_derived_measurement";
export const DERIVED_MEASUREMENT_DATA_CLASS = "source_derived_aggregate";
export const DERIVED_MEASUREMENT_LOCATOR_TYPE = "source_derived_measurement_fields";
export const DERIVED_MEASUREMENT_LOCATOR_SCOPE = "derived_measurement_fields";
export const DERIVED_MEASUREMENT_VALIDATOR_KEY = "VAL-KAI-MVP-DERIVED-001";
export const DERIVED_MEASUREMENT_FAMILIES = Object.freeze({
  PAIRED_OUTCOME: "paired_outcome_change",
  TABULAR_COUNT: "tabular_count",
  TABULAR_RATE: "tabular_rate",
  CROSS_SOURCE_REACH: "cross_source_reach",
});
export const DERIVED_MEASUREMENT_METHODS = Object.freeze({
  PAIRED_OUTCOME: PAIRED_OUTCOME_CALCULATION_METHOD,
  RECORD_COUNT: "kai_tabular_conditional_record_count_v1",
  DISTINCT_KEY_COUNT: "kai_tabular_conditional_distinct_key_count_v1",
  RECORD_RATE: "kai_tabular_conditional_record_rate_v1",
  CROSS_SOURCE_REACH: CROSS_SOURCE_REACH_METHOD,
});
const METHOD_FAMILY = Object.freeze({
  [DERIVED_MEASUREMENT_METHODS.PAIRED_OUTCOME]: DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME,
  [DERIVED_MEASUREMENT_METHODS.RECORD_COUNT]: DERIVED_MEASUREMENT_FAMILIES.TABULAR_COUNT,
  [DERIVED_MEASUREMENT_METHODS.DISTINCT_KEY_COUNT]: DERIVED_MEASUREMENT_FAMILIES.TABULAR_COUNT,
  [DERIVED_MEASUREMENT_METHODS.RECORD_RATE]: DERIVED_MEASUREMENT_FAMILIES.TABULAR_RATE,
  [DERIVED_MEASUREMENT_METHODS.CROSS_SOURCE_REACH]: DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH,
});
export const SCORE_DIRECTIONS = Object.freeze(["higher_is_better", "lower_is_better", "not_established"]);
// What the organization says about where the values come from. KAI never
// records a value as verified: it cannot verify one.
export const EVIDENCE_BASES = Object.freeze(["self_reported", "organization_record", "not_established"]);
export const DUPLICATE_POLICY_COUNT_EACH_KEY_ONCE = "count_each_key_once";
export const PERIOD_SOURCE_ENGAGEMENT = "engagement_reporting_period";
const SHEET_KEY_RE = /^sheet_[1-9][0-9]{0,3}$/;
const FIELD_KEY_RE = /^field_[1-9][0-9]{0,3}$/;
const VALUE_KEY_RE = /^value_[1-9][0-9]{0,2}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function blocker(blockingReason, message, requiredFix, { objectType = "source_version", objectId = null } = {}) {
  return {
    validator_key: DERIVED_MEASUREMENT_VALIDATOR_KEY,
    severity: "blocker",
    object_type: objectType,
    object_code: "record_source_derived_measurement",
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// Percentage to two decimals, half away from zero, in integer arithmetic so
// it is exactly the CHECK's round(numerator * 100.0 / denominator, 2).
function formatRate(numerator, denominator) {
  if (!(denominator > 0)) return null;
  const hundredths = Math.floor((numerator * 20000 + denominator) / (2 * denominator));
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

/** A measurement's identity within its source version and worksheet. */
export function computeMeasurementKey({ family, calculationMethod, definition }) {
  return sha256(JSON.stringify([family, calculationMethod, definition]));
}

// ---------------------------------------------------------------------------
// Human interpretation

const INTERPRETATION_KEYS = Object.freeze(["indicator_label", "meaning_text", "score_direction", "evidence_basis"]);

/**
 * A person's statement of what a measured field means. The label and the
 * meaning are required; the score direction applies to a paired outcome
 * only (and is then required, `not_established` included); the evidence
 * basis defaults to not established. Nothing here changes a count.
 */
export function validateDerivedMeasurementInterpretation(input, { family }) {
  const invalid = (reason, message, fix) => refuse(reason, message, fix, { objectType: "derived_measurement_interpretation" });
  if (!isPlainObject(input)) {
    return invalid("interpretation_required", "An interpretation needs an indicator label and what the measured field represents.", "Provide indicator_label and meaning_text.");
  }
  if (!Object.keys(input).every((key) => INTERPRETATION_KEYS.includes(key))) {
    return invalid("interpretation_unknown_field", "The interpretation has an unsupported field.", "Send only the documented interpretation fields.");
  }
  if (typeof input.indicator_label !== "string" || !LABEL_RE.test(input.indicator_label) || !isSafeRuleText(input.indicator_label)) {
    return invalid("interpretation_label_invalid", "The indicator label must be a short plain-text label.", "Use letters, digits, spaces, apostrophes, hyphens or parentheses (at most 80 characters, starting with a letter).");
  }
  if (!isSafeRuleText(input.meaning_text)) {
    return invalid("interpretation_meaning_invalid", "The meaning is not acceptable plain text.", `Describe what the field represents in at most ${MAX_RULE_LENGTH} characters, without links, paths or credentials.`);
  }
  const paired = family === DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME;
  if (paired && !SCORE_DIRECTIONS.includes(input.score_direction)) {
    return invalid("interpretation_score_direction_required", "A paired outcome interpretation states whether a higher score is better.", "Set score_direction to higher_is_better, lower_is_better or not_established.");
  }
  if (!paired && input.score_direction !== undefined) {
    return invalid("interpretation_score_direction_not_applicable", "A score direction applies only to a paired outcome measurement.", "Remove score_direction.");
  }
  const evidenceBasis = input.evidence_basis ?? "not_established";
  if (!EVIDENCE_BASES.includes(evidenceBasis)) {
    return invalid("interpretation_evidence_basis_invalid", "The evidence basis is not recognized.", "Set evidence_basis to self_reported, organization_record or not_established.");
  }
  return {
    ok: true,
    interpretation: Object.freeze({
      indicatorLabel: input.indicator_label,
      meaningText: input.meaning_text,
      scoreDirection: paired ? input.score_direction : null,
      evidenceBasis,
    }),
  };
}

// ---------------------------------------------------------------------------
// Package A: the paired outcome measurements of one worksheet, as persisted.

/**
 * The persistable paired measurements of one worksheet, from the committed
 * paired basis through the unchanged paired derivation, with no definition:
 * the numerator is always the numeric increase, and no meaning or direction
 * is assumed. A field that cannot be stated is returned unavailable.
 */
export function derivePersistablePairedOutcomes(profile, worksheetKey) {
  const derived = derivePairedOutcomeMeasurements(profile, worksheetKey, { definitions: [] });
  if (!derived.ok) return derived;
  if (derived.status !== "available") {
    return refuse(
      "paired_outcome_pairing_selection_required",
      "KAI proposed more than one way to pair these observations, so it cannot retain a result without a choice.",
      "Upload a version of the worksheet with one participant, stage and instrument-version field.",
    );
  }
  const sheetKey = derived.worksheet.sheetKey;
  const measurements = derived.measurements.map((entry) => {
    if (!entry.available) return Object.freeze({ available: false, outcomeFieldKey: entry.outcomeFieldKey, blockers: entry.blockers });
    const definition = Object.freeze({
      outcome_field_key: entry.outcomeFieldKey,
      outcome_column: entry.outcomeColumn,
      participant_field_key: entry.participantFieldKey,
      stage_field_key: entry.stageFieldKey,
      instrument_version_field_key: entry.instrumentVersionFieldKey ?? null,
    });
    const family = DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME;
    const fieldKeys = [entry.outcomeFieldKey, entry.participantFieldKey, entry.stageFieldKey, entry.instrumentVersionFieldKey]
      .filter(Boolean).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
    return Object.freeze({
      available: true,
      family,
      calculationMethod: entry.calculationMethod,
      basisVersion: "kai_xlsx_paired_outcome_basis_v1",
      sheetKey,
      measurementKey: computeMeasurementKey({ family, calculationMethod: entry.calculationMethod, definition }),
      definition,
      fieldKeys: Object.freeze(fieldKeys),
      measuredValue: entry.increasedCount,
      numerator: entry.increasedCount,
      denominator: entry.denominator,
      percentage: formatRate(entry.increasedCount, entry.denominator),
      componentCounts: Object.freeze({
        participant_count: entry.participantCount,
        comparable_pair_count: entry.denominator,
        increased_count: entry.increasedCount,
        unchanged_count: entry.unchangedCount,
        decreased_count: entry.decreasedCount,
        excluded_participant_count: entry.excludedParticipantCount,
      }),
      exclusions: Object.freeze({
        participants: entry.exclusions.map((item) => ({ reason: item.reason, participant_count: item.participantCount, rows: item.rows })),
        rows: entry.rowExclusions.map((item) => ({ reason: item.reason, row_count: item.rowCount, rows: item.rows })),
      }),
      rowLocators: Object.freeze({
        comparable_pairs: entry.cellLocators.map((pair) => [pair.baseline, pair.followup]),
        complete: entry.locatorsComplete,
      }),
    });
  });
  return { ok: true, worksheet: derived.worksheet, measurements: Object.freeze(measurements) };
}

// ---------------------------------------------------------------------------
// Package B: content-aware tabular counts and rates.

const DEFINITION_KEYS = Object.freeze(["operation", "unit", "conditions", "population"]);

function tabularBasisOf(profile, worksheetKey) {
  if (!isPlainObject(profile) || profile.status !== "profiled" || !["csv", "xlsx"].includes(profile.format)) {
    return refuse("tabular_source_not_supported", "A tabular measurement is available only for a profiled CSV file or Excel worksheet.", "Use a CSV file or an Excel workbook.");
  }
  if (profile.format === "csv") {
    if (worksheetKey !== null) return refuse("tabular_worksheet_not_applicable", "A CSV file has no worksheets.", "Do not select a worksheet for a CSV file.");
    return { ok: true, basis: profile.tabular_measurement_basis, sheetKey: null };
  }
  const sheets = Array.isArray(profile.sheets) ? profile.sheets : [];
  if (sheets.length > 1 && !SHEET_KEY_RE.test(worksheetKey ?? "")) {
    return refuse("tabular_worksheet_selection_required", "Choose one worksheet to measure. KAI never combines worksheets.", "Select the intended worksheet from this workbook.");
  }
  const sheet = sheets.length === 1 && worksheetKey === null ? sheets[0] : sheets.find((candidate) => candidate.sheet_key === worksheetKey);
  if (!sheet) return refuse("tabular_worksheet_selection_invalid", "The selected worksheet is not part of this workbook profile.", "Select one of the listed worksheets.");
  return { ok: true, basis: sheet.tabular_measurement_basis, sheetKey: sheet.sheet_key };
}

// A committed field as a reader may use it: a vocabulary the current label
// screen withholds - including one an earlier profile listed under an older
// rule - is exposed, selected and matched as withheld, never by its labels.
function screenedField(field) {
  const categorical = field?.categorical;
  if (!categorical || categorical.vocabulary_withheld || !Array.isArray(categorical.values) || categorical.values.length === 0) return field;
  const reason = categoryVocabularyWithheldReason(categorical.values.map((value) => value.label));
  if (!reason) return field;
  const listedRecords = categorical.values.reduce((total, value) => total + (Number(value.record_count) || 0), 0);
  return { ...field, categorical: { values: [], withheld_record_count: (Number(categorical.withheld_record_count) || 0) + listedRecords, vocabulary_withheld: reason } };
}

function fieldOf(basis, fieldKey) {
  return screenedField((basis.fields || []).find((field) => field.field_key === fieldKey) ?? null);
}

/**
 * A person's selection of one tabular measurement: what is counted (records,
 * or each value of a selected identifier field once), the conditions on the
 * counted records (at most one category value and one reporting-period
 * condition on a date field), and, for a rate, the measured population (all
 * records or one category value). The reporting period is never typed in:
 * a period condition applies the engagement's recorded reporting period.
 */
export function validateTabularMeasurementDefinition(input) {
  const invalid = (reason, message, fix) => refuse(reason, message, fix, { objectType: "tabular_measurement_definition" });
  if (!isPlainObject(input) || !Object.keys(input).every((key) => DEFINITION_KEYS.includes(key))) {
    return invalid("tabular_definition_invalid", "The measurement definition is missing or has an unsupported field.", "Send operation, and optionally unit, conditions and population.");
  }
  if (!["count", "rate"].includes(input.operation)) {
    return invalid("tabular_operation_invalid", "The operation must be count or rate.", "Set operation to count or rate.");
  }
  const conditions = input.conditions ?? [];
  const population = input.population ?? [];
  if (!Array.isArray(conditions) || !Array.isArray(population)) {
    return invalid("tabular_conditions_invalid", "Conditions and population must be lists.", "Send conditions and population as lists.");
  }
  const normalizeCondition = (condition) => {
    if (!isPlainObject(condition)) return null;
    if (condition.kind === "category" && Object.keys(condition).sort().join(",") === "field_key,kind,value_key"
      && FIELD_KEY_RE.test(condition.field_key) && VALUE_KEY_RE.test(condition.value_key)) {
      return { kind: "category", field_key: condition.field_key, value_key: condition.value_key };
    }
    if (condition.kind === "period" && Object.keys(condition).sort().join(",") === "field_key,kind,period_source,scope"
      && FIELD_KEY_RE.test(condition.field_key) && condition.period_source === PERIOD_SOURCE_ENGAGEMENT && ["within", "outside"].includes(condition.scope)) {
      return { kind: "period", field_key: condition.field_key, period_source: PERIOD_SOURCE_ENGAGEMENT, scope: condition.scope };
    }
    return null;
  };
  const normalized = conditions.map(normalizeCondition);
  const normalizedPopulation = population.map(normalizeCondition);
  if (normalized.includes(null) || normalizedPopulation.includes(null)) {
    return invalid("tabular_condition_invalid", "A condition is not a supported category or reporting-period condition.", "Use {kind: category, field_key, value_key} or {kind: period, field_key, period_source: engagement_reporting_period, scope: within|outside}.");
  }
  const categories = normalized.filter((condition) => condition.kind === "category");
  const periods = normalized.filter((condition) => condition.kind === "period");
  if (categories.length > 1 || periods.length > 1) {
    return invalid("tabular_condition_combination_not_supported", "KAI calculates at most one category condition and one reporting-period condition together.", "Remove the additional condition.");
  }
  let unit = { kind: "records" };
  if (input.operation === "count") {
    if (population.length > 0) return invalid("tabular_population_not_applicable", "A population applies only to a rate.", "Remove population, or use the rate operation.");
    const requested = input.unit ?? { kind: "records" };
    if (isPlainObject(requested) && requested.kind === "records" && Object.keys(requested).length === 1) {
      unit = { kind: "records" };
    } else if (isPlainObject(requested) && requested.kind === "distinct_key" && Object.keys(requested).sort().join(",") === "duplicate_policy,field_key,kind"
      && FIELD_KEY_RE.test(requested.field_key) && requested.duplicate_policy === DUPLICATE_POLICY_COUNT_EACH_KEY_ONCE) {
      unit = { kind: "distinct_key", field_key: requested.field_key, duplicate_policy: DUPLICATE_POLICY_COUNT_EACH_KEY_ONCE };
    } else {
      return invalid("tabular_unit_invalid", "The counted unit must be records, or each value of an identifier field counted once.", "Use {kind: records} or {kind: distinct_key, field_key, duplicate_policy: count_each_key_once}.");
    }
  } else {
    if (input.unit !== undefined && !(isPlainObject(input.unit) && input.unit.kind === "records" && Object.keys(input.unit).length === 1)) {
      return invalid("tabular_rate_unit_not_supported", "A rate is calculated over records.", "Remove unit, or set it to {kind: records}.");
    }
    if (categories.length !== 1 || periods.length > 0) {
      return invalid("tabular_rate_numerator_invalid", "A rate needs exactly one category condition for its numerator and no period condition.", "Select one field value the numerator records have.");
    }
    if (normalizedPopulation.length > 1 || normalizedPopulation.some((condition) => condition.kind !== "category")) {
      return invalid("tabular_rate_population_invalid", "The measured population is all records or the records with one category value.", "Select at most one population category value.");
    }
    if (normalizedPopulation.length === 1 && normalizedPopulation[0].field_key === categories[0].field_key) {
      return invalid("tabular_rate_population_same_field", "The numerator and the population use the same field.", "Select the population from a different field.");
    }
  }
  return {
    ok: true,
    definition: Object.freeze({
      operation: input.operation,
      unit: Object.freeze(unit),
      conditions: Object.freeze([...categories, ...periods].map(Object.freeze)),
      population: Object.freeze(normalizedPopulation.map(Object.freeze)),
    }),
  };
}

// The basis keeps dates by calendar month, so a period applies only when it
// is whole months: it starts on a month's first day and ends on a last day.
function monthBounds({ start, end }) {
  const next = new Date(`${end}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return start.slice(8) === "01" && next.getUTCDate() === 1 ? { first: start.slice(0, 7), last: end.slice(0, 7) } : null;
}

function sumMonths(entries, { first, last, scope }, distinctKey = null) {
  let records = 0;
  let distinct = 0;
  for (const [month, count, distinctCounts] of entries) {
    const within = month >= first && month <= last;
    if ((scope === "within") !== within) continue;
    records += count;
    if (distinctKey) distinct += distinctCounts?.[distinctKey] ?? 0;
  }
  return { records, distinct };
}

/**
 * One tabular measurement from the committed basis of the exact profile,
 * under a validated definition. `reportingPeriod` is the engagement's
 * recorded period ({ start, end }) or null; a period condition needs one.
 * Every count is read from the profile's joint aggregates; a distinct count
 * over days is refused unless each identifier falls on one day.
 */
export function deriveTabularMeasurement(profile, worksheetKey, definition, { reportingPeriod = null } = {}) {
  const located = tabularBasisOf(profile, worksheetKey);
  if (!located.ok) return located;
  const { basis, sheetKey } = located;
  if (!isPlainObject(basis) || basis.basis_version !== TABULAR_MEASUREMENT_BASIS_VERSION) {
    return refuse(
      "tabular_basis_not_committed",
      "This file was profiled before KAI committed the values it needs for field-value measurements.",
      "In Files, choose the same file again and select \"Upload again as a new intake version\".",
    );
  }
  if (basis.status !== "assessed") {
    return refuse("tabular_table_not_established", "KAI could not establish one unambiguous table in this source.", "Keep one table with one header row, then upload the file again.");
  }
  const notProposed = (fieldKey, role) => refuse(
    "tabular_field_role_not_proposed",
    `KAI did not find ${fieldKey} to be ${role === "identifier" ? "an identifier" : role === "date" ? "a date" : "a category"} field in this source.`,
    `Select a field KAI lists as ${role === "identifier" ? "an identifier" : role === "date" ? "a date" : "a category"} field.`,
    { objectType: "tabular_measurement_definition" },
  );
  const category = definition.conditions.find((condition) => condition.kind === "category") ?? null;
  const period = definition.conditions.find((condition) => condition.kind === "period") ?? null;
  const populationCondition = definition.population[0] ?? null;
  const categoryValue = (condition) => {
    const field = fieldOf(basis, condition.field_key);
    if (!field?.roles?.includes("categorical")) return { refusal: notProposed(condition.field_key, "categorical") };
    const entry = field.categorical.values.find((value) => value.value_key === condition.value_key);
    if (!entry) {
      return { refusal: refuse("tabular_category_value_not_listed", `${condition.value_key} is not a listed value of ${condition.field_key}.`, "Select one of the listed values.", { objectType: "tabular_measurement_definition" }) };
    }
    return { entry, cell: basis.category_cells?.[condition.field_key]?.[condition.value_key] };
  };
  const conditionsRecord = [];
  let cell = null;
  if (category) {
    const resolved = categoryValue(category);
    if (resolved.refusal) return resolved.refusal;
    cell = resolved.cell;
    conditionsRecord.push({ kind: "category", field_key: category.field_key, value_key: category.value_key, value_label: resolved.entry.label });
  }
  let periodRecord = null;
  if (period) {
    if (!fieldOf(basis, period.field_key)?.roles?.includes("date")) return notProposed(period.field_key, "date");
    if (!reportingPeriod?.start || !reportingPeriod?.end) {
      return refuse(
        "tabular_reporting_period_not_recorded",
        "This source's engagement has no recorded reporting period to apply.",
        "Record the engagement's reporting period (Project target), then define the measurement again.",
        { objectType: "tabular_measurement_definition" },
      );
    }
    if (!monthBounds(reportingPeriod)) {
      return refuse(
        "tabular_period_not_whole_months",
        "KAI keeps source dates by calendar month, so it applies a reporting period only when it starts on the first day of a month and ends on the last day of one.",
        "Record the engagement's reporting period in whole months, or measure without a period.",
        { objectType: "tabular_measurement_definition" },
      );
    }
    periodRecord = { kind: "period", field_key: period.field_key, period_source: PERIOD_SOURCE_ENGAGEMENT, scope: period.scope, period_start: reportingPeriod.start, period_end: reportingPeriod.end };
    conditionsRecord.push(periodRecord);
  }

  const duplicates = basis.exact_duplicates;
  const shared = {
    sheetKey,
    basisVersion: TABULAR_MEASUREMENT_BASIS_VERSION,
  };
  const persistedDefinition = (extra) => Object.freeze({ operation: definition.operation, ...extra, conditions: conditionsRecord });
  const fieldKeysOf = (...keys) => Object.freeze([...new Set(keys.filter(Boolean))].sort((a, b) => Number(a.slice(6)) - Number(b.slice(6))));

  if (definition.operation === "rate") {
    let denominator = basis.record_count;
    let populationRecord = null;
    if (populationCondition) {
      const resolved = categoryValue(populationCondition);
      if (resolved.refusal) return resolved.refusal;
      denominator = resolved.cell.records;
      populationRecord = { kind: "category", field_key: populationCondition.field_key, value_key: populationCondition.value_key, value_label: resolved.entry.label };
    }
    const numerator = populationCondition ? (cell.by_category?.[populationCondition.field_key]?.[populationCondition.value_key] ?? 0) : cell.records;
    if (!isCount(numerator) || !isCount(denominator) || numerator > denominator || denominator === 0) {
      return refuse("tabular_counts_inconsistent", "The committed counts for this rate are inconsistent or its population is empty.", "Select a population with records.", { objectType: "tabular_measurement_definition" });
    }
    const def = persistedDefinition({ unit: { kind: "records" }, population: populationRecord ? [populationRecord] : [] });
    const method = DERIVED_MEASUREMENT_METHODS.RECORD_RATE;
    return {
      ok: true,
      measurement: Object.freeze({
        ...shared,
        family: DERIVED_MEASUREMENT_FAMILIES.TABULAR_RATE,
        calculationMethod: method,
        measurementKey: computeMeasurementKey({ family: DERIVED_MEASUREMENT_FAMILIES.TABULAR_RATE, calculationMethod: method, definition: def }),
        definition: def,
        fieldKeys: fieldKeysOf(category.field_key, populationRecord?.field_key),
        measuredValue: numerator,
        numerator,
        denominator,
        percentage: formatRate(numerator, denominator),
        componentCounts: Object.freeze({
          source_record_count: basis.record_count,
          population_record_count: denominator,
          numerator_record_count: numerator,
          other_population_record_count: denominator - numerator,
          exact_duplicate_member_records: duplicates.member_record_count,
        }),
        exclusions: Object.freeze({ records_outside_population: basis.record_count - denominator }),
        rowLocators: null,
      }),
    };
  }

  // Counts.
  const distinctKey = definition.unit.kind === "distinct_key" ? definition.unit.field_key : null;
  let identifier = null;
  if (distinctKey) {
    const field = fieldOf(basis, distinctKey);
    if (!field?.roles?.includes("identifier")) return notProposed(distinctKey, "identifier");
    identifier = field;
    if (period && !(basis.single_valued_in?.[distinctKey] ?? []).includes(period.field_key)) {
      return refuse(
        "tabular_distinct_not_exact_for_period",
        `Some ${distinctKey} values have records in more than one month, so KAI cannot count each one once within a period exactly.`,
        "Count records instead, or use a source where each identifier has one date.",
        { objectType: "tabular_measurement_definition" },
      );
    }
  }
  let matchingRecords;
  let distinctCount = null;
  let recordsWithoutDate = null;
  if (period) {
    const dateEntries = category ? (cell.by_date?.[period.field_key] ?? []) : (basis.date_cells?.[period.field_key] ?? []);
    const summed = sumMonths(dateEntries, { ...monthBounds(reportingPeriod), scope: period.scope }, distinctKey);
    matchingRecords = summed.records;
    if (distinctKey) distinctCount = summed.distinct;
    const recordsWithDate = dateEntries.reduce((total, [, count]) => total + count, 0);
    recordsWithoutDate = (category ? cell.records : basis.record_count) - recordsWithDate;
  } else if (category) {
    matchingRecords = cell.records;
    if (distinctKey) distinctCount = cell.distinct?.[distinctKey] ?? null;
  } else {
    matchingRecords = basis.record_count;
    if (distinctKey) distinctCount = identifier.identifier.distinct_count;
  }
  if (!isCount(matchingRecords) || (distinctKey && (!isCount(distinctCount) || distinctCount > matchingRecords))
    || (recordsWithoutDate !== null && !isCount(recordsWithoutDate))) {
    return refuse("tabular_counts_inconsistent", "The committed counts for this measurement are inconsistent.", "Upload the file again as a new intake version.", { objectType: "tabular_measurement_definition" });
  }
  const unitRecord = distinctKey ? { kind: "distinct_key", field_key: distinctKey, duplicate_policy: DUPLICATE_POLICY_COUNT_EACH_KEY_ONCE } : { kind: "records" };
  const def = persistedDefinition({ unit: unitRecord, population: [] });
  const method = distinctKey ? DERIVED_MEASUREMENT_METHODS.DISTINCT_KEY_COUNT : DERIVED_MEASUREMENT_METHODS.RECORD_COUNT;
  const measuredValue = distinctKey ? distinctCount : matchingRecords;
  const componentCounts = {
    source_record_count: basis.record_count,
    matching_record_count: matchingRecords,
    exact_duplicate_group_count: duplicates.group_count,
    exact_duplicate_member_records: duplicates.member_record_count,
    exact_duplicate_excess_copies: duplicates.excess_copy_count,
  };
  if (distinctKey) {
    Object.assign(componentCounts, {
      distinct_key_count: distinctCount,
      matching_records_beyond_first_per_key: matchingRecords - distinctCount,
      source_distinct_key_count: identifier.identifier.distinct_count,
      source_repeated_key_count: identifier.identifier.repeated_key_count,
      source_records_in_repeated_keys: identifier.identifier.records_in_repeated_keys,
      source_records_without_key: identifier.blank_count,
    });
  }
  if (recordsWithoutDate !== null) componentCounts.records_without_date = recordsWithoutDate;
  return {
    ok: true,
    measurement: Object.freeze({
      ...shared,
      family: DERIVED_MEASUREMENT_FAMILIES.TABULAR_COUNT,
      calculationMethod: method,
      measurementKey: computeMeasurementKey({ family: DERIVED_MEASUREMENT_FAMILIES.TABULAR_COUNT, calculationMethod: method, definition: def }),
      definition: def,
      fieldKeys: fieldKeysOf(distinctKey, category?.field_key, period?.field_key),
      measuredValue,
      numerator: measuredValue,
      denominator: null,
      percentage: null,
      componentCounts: Object.freeze(componentCounts),
      exclusions: Object.freeze(recordsWithoutDate !== null ? { records_without_date: recordsWithoutDate } : {}),
      rowLocators: null,
    }),
  };
}

/** What a person can select from one table's committed basis (no values beyond listed category labels). */
export function describeTabularMeasurementOptions(profile, worksheetKey) {
  const located = tabularBasisOf(profile, worksheetKey);
  if (!located.ok) return located;
  const { basis, sheetKey } = located;
  if (!isPlainObject(basis) || basis.basis_version !== TABULAR_MEASUREMENT_BASIS_VERSION || basis.status !== "assessed") {
    return { ok: true, sheetKey, available: false, reason: basis?.reason ?? "tabular_basis_not_committed" };
  }
  return {
    ok: true,
    sheetKey,
    available: true,
    record_count: basis.record_count,
    exact_duplicates: basis.exact_duplicates,
    // The profiler does not infer duration semantics. These field positions
    // are available for a person to identify as recorded minutes; no cell
    // values or inferred meaning are exposed here.
    ...(profile.format === "csv" ? { duration_field_candidates: basis.fields.filter((field) => field.roles.length === 0).map((field) => ({
      field_key: field.field_key, column_position: Number(field.field_key.slice(6)), present_count: field.present_count, blank_count: field.blank_count,
    })) } : {}),
    fields: basis.fields.filter((field) => field.roles.length > 0).map(screenedField).map((field) => ({
      field_key: field.field_key,
      column_position: Number(field.field_key.slice(6)),
      role: field.roles[0],
      present_count: field.present_count,
      blank_count: field.blank_count,
      ...(field.identifier ? { identifier: field.identifier } : {}),
      ...(field.categorical ? {
        values: field.categorical.values,
        withheld_record_count: field.categorical.withheld_record_count,
        ...(field.categorical.vocabulary_withheld ? { vocabulary_withheld: field.categorical.vocabulary_withheld } : {}),
      } : {}),
      ...(field.date ? { date: field.date } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Cross-source linked reach: service events of one CSV source version linked
// to the participant register of another. The mapping is a person's
// confirmation of which proposed fields and listed values mean what; it is
// validated against both committed profiles before any byte is read, and the
// reconciliation worker calculates from both versions' verified bytes.

export const CROSS_SOURCE_METRICS = Object.freeze({
  ELIGIBLE_ENCOUNTERS: "eligible_linked_encounters",
  DISTINCT_PEOPLE: "distinct_people_served",
  GROUP_ENCOUNTERS: "group_linked_encounters",
  GROUP_DISTINCT_PEOPLE: "group_distinct_people_served",
  MULTI_GROUP_PEOPLE: "people_in_more_than_one_group",
  MONTHLY_ACTIVITY: "monthly_eligible_encounters",
  RECORDED_DURATION: "known_recorded_service_minutes",
});
const METRIC_COMPONENT = Object.freeze({
  [CROSS_SOURCE_METRICS.ELIGIBLE_ENCOUNTERS]: "eligible_encounter_count",
  [CROSS_SOURCE_METRICS.DISTINCT_PEOPLE]: "distinct_person_count",
  [CROSS_SOURCE_METRICS.GROUP_ENCOUNTERS]: "group_encounter_count",
  [CROSS_SOURCE_METRICS.GROUP_DISTINCT_PEOPLE]: "group_distinct_person_count",
  [CROSS_SOURCE_METRICS.MULTI_GROUP_PEOPLE]: "multi_group_person_count",
  [CROSS_SOURCE_METRICS.MONTHLY_ACTIVITY]: "eligible_encounter_count",
  [CROSS_SOURCE_METRICS.RECORDED_DURATION]: "duration_known_count",
});
export const CROSS_SOURCE_IDENTIFIER_MATCH = "exact_after_trim";
const EVENT_MAPPING_KEYS = Object.freeze([
  "event_identifier_field_key", "participant_identifier_field_key", "status_field_key", "completed_value_key", "date_field_key", "group_field_key",
]);
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDay(value) {
  if (typeof value !== "string" || !ISO_DAY_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The shape of a person's cross-source mapping: field keys and one listed value key, nothing else. */
export function validateCrossSourceReachMapping(input) {
  const invalid = (reason, message, fix) => refuse(reason, message, fix, { objectType: "cross_source_mapping" });
  if (!isPlainObject(input) || !Object.keys(input).every((key) => ["events", "register", "duration", "monthly_activity"].includes(key))
    || !isPlainObject(input.events) || !isPlainObject(input.register)) {
    return invalid("cross_source_mapping_invalid", "The mapping needs an events part and a register part.", "Send {events: {...}, register: {participant_identifier_field_key}}.");
  }
  const events = input.events;
  if (!Object.keys(events).every((key) => EVENT_MAPPING_KEYS.includes(key))
    || !EVENT_MAPPING_KEYS.filter((key) => key !== "group_field_key").every((key) => key in events)) {
    return invalid("cross_source_mapping_invalid", "The events mapping names the event identifier, participant identifier, status, completed value, date and optional group fields.", "Select each field from the service-event source's listed fields.");
  }
  const fieldKeys = EVENT_MAPPING_KEYS.filter((key) => key.endsWith("_field_key") && events[key] !== undefined && events[key] !== null);
  if (!fieldKeys.every((key) => FIELD_KEY_RE.test(events[key])) || !VALUE_KEY_RE.test(events.completed_value_key ?? "")) {
    return invalid("cross_source_mapping_invalid", "Every mapped field must be a listed field key and the completed value a listed value key.", "Select fields and values KAI lists.");
  }
  if (new Set(fieldKeys.map((key) => events[key])).size !== fieldKeys.length) {
    return invalid("cross_source_mapping_fields_not_distinct", "Each mapped role needs a different field.", "Select a different field for each role.");
  }
  if (!Object.keys(input.register).every((key) => key === "participant_identifier_field_key") || !FIELD_KEY_RE.test(input.register.participant_identifier_field_key ?? "")) {
    return invalid("cross_source_mapping_invalid", "The register mapping names its participant identifier field only.", "Select the register's participant identifier field.");
  }
  if (input.duration !== undefined && (!isPlainObject(input.duration)
    || Object.keys(input.duration).sort().join(",") !== "field_key,meaning,unit"
    || !FIELD_KEY_RE.test(input.duration.field_key ?? "") || input.duration.unit !== "minutes"
    || input.duration.meaning !== "recorded_service_duration"
    || fieldKeys.some((key) => events[key] === input.duration.field_key))) {
    return invalid("cross_source_duration_mapping_invalid", "The duration mapping must identify a separate field as recorded service duration in minutes.", "Provide a distinct duration field, meaning recorded_service_duration and unit minutes.");
  }
  if (input.monthly_activity !== undefined && input.monthly_activity !== true) {
    return invalid("cross_source_monthly_mapping_invalid", "Monthly activity must be explicitly selected.", "Set monthly_activity to true or omit it.");
  }
  return {
    ok: true,
    mapping: Object.freeze({
      events: Object.freeze(Object.fromEntries(EVENT_MAPPING_KEYS.map((key) => [key, events[key] ?? null]))),
      register: Object.freeze({ participant_identifier_field_key: input.register.participant_identifier_field_key }),
      ...(input.duration ? { duration: Object.freeze({ ...input.duration }) } : {}),
      ...((input.monthly_activity || input.duration) ? { monthly_activity: true } : {}),
    }),
  };
}

function csvBasisOf(profile, sourceRole) {
  if (!isPlainObject(profile) || profile.status !== "profiled" || profile.format !== "csv") {
    return refuse("cross_source_source_not_csv", `The ${sourceRole} source must be a profiled CSV file.`, "Link two promoted CSV source versions.");
  }
  const basis = profile.tabular_measurement_basis;
  if (!isPlainObject(basis) || basis.basis_version !== TABULAR_MEASUREMENT_BASIS_VERSION || basis.status !== "assessed") {
    return refuse("cross_source_basis_not_committed", `The ${sourceRole} source was profiled before KAI listed the fields a linkage needs.`, "In Files, choose the same file again and select \"Upload again as a new intake version\".");
  }
  return { ok: true, basis };
}

/**
 * The mapping resolved against both committed profiles and the engagement's
 * recorded period: every field has the role KAI proposed, the completed
 * value and the group values are listed labels, the group vocabulary is not
 * withheld, and the period is two real ISO days. The reconciliation applies
 * the period by day from the source bytes, so no whole-month rule applies.
 */
export function resolveCrossSourceReachMapping({ eventsProfile, registerProfile, mapping, reportingPeriod }) {
  const eventsBasis = csvBasisOf(eventsProfile, "service-event");
  if (!eventsBasis.ok) return eventsBasis;
  const registerBasis = csvBasisOf(registerProfile, "participant register");
  if (!registerBasis.ok) return registerBasis;
  const notProposed = (sourceRole, fieldKey, role) => refuse(
    "cross_source_field_role_not_proposed",
    `KAI did not find ${fieldKey} of the ${sourceRole} source to be ${role === "identifier" ? "an identifier" : role === "date" ? "a date" : "a category"} field.`,
    `Select a field KAI lists as ${role === "identifier" ? "an identifier" : role === "date" ? "a date" : "a category"} field.`,
    { objectType: "cross_source_mapping" },
  );
  const events = mapping.events;
  const roleOf = (basis, fieldKey, role) => {
    const field = fieldOf(basis, fieldKey);
    return field?.roles?.includes(role) ? field : null;
  };
  for (const [key, role] of [["event_identifier_field_key", "identifier"], ["participant_identifier_field_key", "identifier"], ["date_field_key", "date"]]) {
    if (!roleOf(eventsBasis.basis, events[key], role)) return notProposed("service-event", events[key], role);
  }
  if (!roleOf(registerBasis.basis, mapping.register.participant_identifier_field_key, "identifier")) {
    return notProposed("participant register", mapping.register.participant_identifier_field_key, "identifier");
  }
  if (mapping.duration) {
    const durationField = fieldOf(eventsBasis.basis, mapping.duration.field_key);
    if (!durationField || durationField.roles.length !== 0) {
      return refuse("cross_source_duration_field_invalid", "The duration field must be an existing unclassified field of the service-event source.", "Select the separate field containing recorded numeric service minutes.", { objectType: "cross_source_mapping" });
    }
  }
  const status = roleOf(eventsBasis.basis, events.status_field_key, "categorical");
  if (!status) return notProposed("service-event", events.status_field_key, "categorical");
  const completed = status.categorical.values.find((value) => value.value_key === events.completed_value_key);
  if (!completed) {
    return refuse("cross_source_value_not_listed", `${events.completed_value_key} is not a listed value of ${events.status_field_key}.`, "Select the listed value that means a completed service.", { objectType: "cross_source_mapping" });
  }
  let groups = [];
  if (events.group_field_key) {
    const group = roleOf(eventsBasis.basis, events.group_field_key, "categorical");
    if (!group) return notProposed("service-event", events.group_field_key, "categorical");
    if (group.categorical.vocabulary_withheld || group.categorical.values.length === 0) {
      return refuse("cross_source_group_vocabulary_withheld", "KAI withheld this field's values, so it cannot group people by them.", "Group by a field whose values KAI lists, or measure without a group.", { objectType: "cross_source_mapping" });
    }
    groups = group.categorical.values.map((value) => ({ value_key: value.value_key, label: value.label }));
  }
  if (!reportingPeriod?.start || !reportingPeriod?.end) {
    return refuse("cross_source_reporting_period_not_recorded", "The service-event source's engagement has no recorded reporting period to apply.", "Record the engagement's reporting period (Project target), then link the sources again.", { objectType: "cross_source_mapping" });
  }
  if (!isIsoDay(reportingPeriod.start) || !isIsoDay(reportingPeriod.end) || reportingPeriod.start > reportingPeriod.end) {
    return refuse("cross_source_reporting_period_invalid", "The engagement's reporting period is not two real dates in order.", "Record the engagement's reporting period again.", { objectType: "cross_source_mapping" });
  }
  const eventFieldKeys = [...new Set(EVENT_MAPPING_KEYS.filter((key) => key.endsWith("_field_key")).map((key) => events[key]).filter(Boolean))]
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  if (mapping.duration) eventFieldKeys.push(mapping.duration.field_key);
  eventFieldKeys.sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  return {
    ok: true,
    resolved: Object.freeze({
      events: Object.freeze({ ...events, completed_value_label: completed.label, groups: Object.freeze(groups) }),
      register: mapping.register,
      ...(mapping.duration ? { duration: mapping.duration } : {}),
      ...(mapping.monthly_activity ? { monthly_activity: true } : {}),
      identifier_match: CROSS_SOURCE_IDENTIFIER_MATCH,
      period: Object.freeze({ period_source: PERIOD_SOURCE_ENGAGEMENT, period_start: reportingPeriod.start, period_end: reportingPeriod.end, precision: "day" }),
    }),
    eventFieldKeys,
  };
}

/** The reconciliation worker's mapping input, from a resolved mapping. */
export function crossSourceWorkerMapping(resolved) {
  return {
    events: resolved.events,
    register: resolved.register,
    ...(resolved.duration ? { duration: resolved.duration } : {}),
    ...(resolved.monthly_activity ? { monthly_activity: true } : {}),
    period: { start: resolved.period.period_start, end: resolved.period.period_end },
  };
}

/**
 * The persistable cross-source measurements of one reconciliation: eligible
 * encounters and distinct people organization-wide, and, with a group field,
 * encounters and distinct people per listed group value and the people in
 * more than one group. Each carries the whole reconciliation funnel, the
 * group table and the row exclusions, and names the reference source version
 * and profile it was linked to, so its identity changes with either source.
 */
export function deriveCrossSourceReachMeasurements({ resolved, eventFieldKeys, reconciliation, reference }) {
  const counts = reconciliation.counts;
  const groupTable = reconciliation.groups.map((group) => ({ ...group }));
  const base = {
    mapping: { events: resolved.events, register: resolved.register, identifier_match: resolved.identifier_match },
    period: resolved.period,
    reference_source_version_id: reference.sourceVersionId,
    reference_profile_canonical_sha256: reference.profileCanonicalSha256,
    reference_field_keys: [resolved.register.participant_identifier_field_key],
  };
  const make = (metric, group = null) => {
    const componentCounts = {
      ...counts,
      groups: groupTable,
      ...((resolved.duration || resolved.monthly_activity) ? { monthly_activity: reconciliation.monthly_activity } : {}),
      ...(resolved.duration ? { duration_known_count: reconciliation.recorded_duration.known_count,
        duration_missing_count: reconciliation.recorded_duration.missing_count, duration_invalid_count: reconciliation.recorded_duration.invalid_count,
        known_recorded_minutes: reconciliation.recorded_duration.known_minutes } : {}),
      ...(group ? { group_encounter_count: group.encounter_count, group_distinct_person_count: group.distinct_person_count } : {}),
    };
    const definition = { metric, measured_component: METRIC_COMPONENT[metric], group: group ? { field_key: resolved.events.group_field_key, value_key: group.value_key, value_label: group.label } : null, ...base,
      ...(resolved.duration ? { duration: resolved.duration, duration_method: "eligible_event_known_recorded_minutes_v1" } : {}),
      ...(resolved.monthly_activity ? { monthly_activity: true, monthly_method: "eligible_event_service_month_v1" } : {}) };
    const value = componentCounts[METRIC_COMPONENT[metric]];
    return Object.freeze({
      family: DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH,
      calculationMethod: DERIVED_MEASUREMENT_METHODS.CROSS_SOURCE_REACH,
      basisVersion: CROSS_SOURCE_REACH_BASIS_VERSION,
      sheetKey: null,
      measurementKey: computeMeasurementKey({ family: DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH, calculationMethod: CROSS_SOURCE_REACH_METHOD, definition }),
      definition: Object.freeze(definition),
      fieldKeys: Object.freeze([...eventFieldKeys]),
      measuredValue: value,
      numerator: value,
      denominator: null,
      percentage: null,
      componentCounts: Object.freeze(componentCounts),
      exclusions: resolved.duration ? { ...reconciliation.row_exclusions, duration: reconciliation.duration_exclusions } : reconciliation.row_exclusions,
      rowLocators: null,
    });
  };
  // The optional activity request adds two findings to the existing reach
  // reconciliation. Do not create duplicate reach evidence with a different
  // locator: those statements already belong to the original measurements.
  if (resolved.duration || resolved.monthly_activity) return [make(CROSS_SOURCE_METRICS.MONTHLY_ACTIVITY), ...(resolved.duration ? [make(CROSS_SOURCE_METRICS.RECORDED_DURATION)] : [])];
  const measurements = [make(CROSS_SOURCE_METRICS.ELIGIBLE_ENCOUNTERS), make(CROSS_SOURCE_METRICS.DISTINCT_PEOPLE)];
  if (resolved.events.group_field_key) {
    for (const group of groupTable) {
      measurements.push(make(CROSS_SOURCE_METRICS.GROUP_ENCOUNTERS, group), make(CROSS_SOURCE_METRICS.GROUP_DISTINCT_PEOPLE, group));
    }
    if (groupTable.length > 1) measurements.push(make(CROSS_SOURCE_METRICS.MULTI_GROUP_PEOPLE));
  }
  return measurements;
}

// The reconciliation funnel every cross-source row keeps (mirrors the CHECK).
function crossSourceFunnelHolds(row) {
  const c = row.component_counts;
  const keys = [
    "physical_record_count", "blank_event_identifier_record_count", "duplicate_group_count", "duplicate_member_record_count", "excess_copy_record_count",
    "conflicting_event_identity_count", "conflicting_record_count", "distinct_event_count", "consistent_event_count", "completed_event_count",
    "completed_without_date_count", "completed_outside_period_count", "in_period_completed_event_count", "blank_participant_identifier_event_count",
    "unmatched_event_count", "unmatched_identity_count", "eligible_encounter_count", "distinct_person_count", "multi_group_person_count", "ungrouped_encounter_count",
  ];
  if (!keys.every((key) => isCount(c[key])) || !Array.isArray(c.groups)) return false;
  const component = row.definition?.measured_component;
  if (METRIC_COMPONENT[row.definition?.metric] !== component || c[component] !== row.measured_value) return false;
  const groupsHold = c.groups.every((group) => isCount(group.encounter_count) && isCount(group.distinct_person_count) && group.distinct_person_count <= group.encounter_count);
  if (row.definition?.duration || row.definition?.monthly_activity) {
    if (row.definition.monthly_activity !== true || row.definition.monthly_method !== "eligible_event_service_month_v1"
      || !isIsoDay(row.definition.period?.period_start) || !isIsoDay(row.definition.period?.period_end)
      || !Array.isArray(c.monthly_activity) || !c.monthly_activity.every((item) => isPlainObject(item) && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(item.month) && isCount(item.encounter_count) && item.encounter_count > 0
        && item.month >= row.definition.period.period_start.slice(0, 7) && item.month <= row.definition.period.period_end.slice(0, 7))
      || new Set(c.monthly_activity.map((item) => item.month)).size !== c.monthly_activity.length
      || c.monthly_activity.some((item, index) => index > 0 && c.monthly_activity[index - 1].month >= item.month)
      || c.monthly_activity.reduce((sum, item) => sum + item.encounter_count, 0) !== c.eligible_encounter_count) return false;
    if (row.definition.duration) {
      const duration = row.definition.duration;
      if (row.definition.duration_method !== "eligible_event_known_recorded_minutes_v1"
      || !isPlainObject(duration) || Object.keys(duration).sort().join(",") !== "field_key,meaning,unit"
      || !FIELD_KEY_RE.test(duration.field_key ?? "") || duration.unit !== "minutes" || duration.meaning !== "recorded_service_duration"
      || !row.field_keys?.includes(duration.field_key) || ![c.duration_known_count, c.duration_missing_count, c.duration_invalid_count].every(isCount)
      || c.duration_known_count + c.duration_missing_count + c.duration_invalid_count !== c.eligible_encounter_count
      || (c.duration_known_count === 0 ? c.known_recorded_minutes !== null
        : typeof c.known_recorded_minutes !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(c.known_recorded_minutes))) return false;
    } else if (row.definition.metric === CROSS_SOURCE_METRICS.RECORDED_DURATION) return false;
  } else if ([CROSS_SOURCE_METRICS.MONTHLY_ACTIVITY, CROSS_SOURCE_METRICS.RECORDED_DURATION].includes(row.definition?.metric)) return false;
  const grouped = c.groups.reduce((total, group) => total + group.encounter_count, 0);
  return row.denominator === null && row.percentage === null && groupsHold
    && c.excess_copy_record_count === c.duplicate_member_record_count - c.duplicate_group_count
    && c.distinct_event_count === c.physical_record_count - c.blank_event_identifier_record_count - c.excess_copy_record_count
    && c.consistent_event_count === c.distinct_event_count - c.conflicting_event_identity_count
    && c.completed_event_count <= c.consistent_event_count
    && c.in_period_completed_event_count === c.completed_event_count - c.completed_without_date_count - c.completed_outside_period_count
    && c.eligible_encounter_count === c.in_period_completed_event_count - c.blank_participant_identifier_event_count - c.unmatched_event_count
    && c.unmatched_identity_count <= c.unmatched_event_count
    && c.distinct_person_count <= c.eligible_encounter_count
    && c.multi_group_person_count <= c.distinct_person_count
    && (c.groups.length === 0 || grouped + c.ungrouped_encounter_count === c.eligible_encounter_count)
    // With every encounter grouped in two groups, people overall = people per group - people in both.
    && (c.groups.length !== 2 || c.ungrouped_encounter_count !== 0
      || c.distinct_person_count === c.groups[0].distinct_person_count + c.groups[1].distinct_person_count - c.multi_group_person_count)
    && (!row.definition.group || (c.groups.some((group) => group.value_key === row.definition.group.value_key
      && group.encounter_count === c.group_encounter_count && group.distinct_person_count === c.group_distinct_person_count)));
}

/**
 * Whether every category label a recorded measurement holds (its condition
 * and population values, a linkage's completed value and group labels) still
 * passes the label screen. A measurement recorded from a vocabulary an older
 * profile listed fails closed: its evidence cannot support a claim, be
 * generated from or be released, and its labels are not returned.
 */
export function derivedMeasurementCategoryLabels(row) {
  const definition = isPlainObject(row?.definition) ? row.definition : {};
  const labels = [];
  for (const condition of [...(Array.isArray(definition.conditions) ? definition.conditions : []), ...(Array.isArray(definition.population) ? definition.population : [])]) {
    if (typeof condition?.value_label === "string") labels.push(condition.value_label);
  }
  const events = definition.mapping?.events;
  if (typeof events?.completed_value_label === "string") labels.push(events.completed_value_label);
  for (const group of Array.isArray(events?.groups) ? events.groups : []) if (typeof group?.label === "string") labels.push(group.label);
  if (typeof definition.group?.value_label === "string") labels.push(definition.group.value_label);
  for (const group of Array.isArray(row?.component_counts?.groups) ? row.component_counts.groups : []) if (typeof group?.label === "string") labels.push(group.label);
  return labels;
}

export function derivedMeasurementLabelsAdmitted(row) {
  return categoryVocabularyWithheldReason(derivedMeasurementCategoryLabels(row), { wholeVocabulary: false }) === null;
}

export const WITHHELD_CATEGORY_LABEL = "[withheld]";

/**
 * A recorded measurement's definition and group table with every category
 * label replaced, for a reader that must not see labels the screen withholds.
 */
export function withholdDerivedMeasurementLabels(row) {
  const mask = (value) => (typeof value === "string" ? WITHHELD_CATEGORY_LABEL : value);
  const definition = JSON.parse(JSON.stringify(row.definition ?? {}));
  for (const condition of [...(definition.conditions ?? []), ...(definition.population ?? [])]) if (condition && "value_label" in condition) condition.value_label = mask(condition.value_label);
  if (definition.mapping?.events) {
    if ("completed_value_label" in definition.mapping.events) definition.mapping.events.completed_value_label = mask(definition.mapping.events.completed_value_label);
    for (const group of definition.mapping.events.groups ?? []) group.label = mask(group.label);
  }
  if (definition.group && "value_label" in definition.group) definition.group.value_label = mask(definition.group.value_label);
  const componentCounts = row.component_counts && Array.isArray(row.component_counts.groups)
    ? { ...row.component_counts, groups: row.component_counts.groups.map((group) => ({ ...group, label: mask(group.label) })) }
    : row.component_counts;
  return { definition, component_counts: componentCounts };
}

/**
 * Whether every source a measurement combines is still the current version
 * it was calculated from: for a cross-source measurement, exactly its
 * primary and its reference version, each current and still bound to the
 * profile recorded with the measurement; a single-source measurement names
 * no other source.
 */
export function derivedContributingSourcesCurrent(row) {
  if (!isPlainObject(row)) return false;
  const sources = Array.isArray(row.contributing_sources) ? row.contributing_sources : [];
  if (row.measurement_family !== DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH) return sources.length === 0;
  const primary = sources.filter((source) => source.source_role === "primary");
  const reference = sources.filter((source) => source.source_role === "reference");
  return sources.length === 2 && primary.length === 1 && reference.length === 1
    && primary[0].source_version_id === row.measurement_source_version_id
    && reference[0].source_version_id === row.definition?.reference_source_version_id
    && reference[0].profile_canonical_sha256 === row.definition?.reference_profile_canonical_sha256
    && sources.every((source) => source.is_current === true && source.bound_profile_canonical_sha256 === source.profile_canonical_sha256);
}

// ---------------------------------------------------------------------------
// Statements, composed only from a persisted measurement row and the
// interpretation its evidence is stated under.

function where(row) {
  return row.worksheet_key ? `in selected worksheet ${row.worksheet_key}` : "in the CSV data records";
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function conditionPhrase(condition) {
  if (condition.kind === "category") return `${condition.field_key} = ${condition.value_label}`;
  return `${condition.field_key} ${condition.scope === "within" ? "within" : "outside"} the engagement reporting period ${condition.period_start} to ${condition.period_end}`;
}

function interpretationPrefix(interpretation) {
  if (!interpretation) return "";
  const basis = interpretation.evidence_basis === "self_reported"
    ? "; values self-reported"
    : interpretation.evidence_basis === "organization_record" ? "; values are organization records" : "";
  return `${interpretation.indicator_label} (meaning stated by the organization${basis}): `;
}

function pairedBody(row, interpretation) {
  const counts = row.component_counts;
  const definition = row.definition;
  const direction = interpretation?.score_direction === "higher_is_better"
    ? "the organization states higher is better"
    : interpretation?.score_direction === "lower_is_better"
      ? "the organization states lower is better"
      : "whether higher is better is not established";
  const rule = definition.instrument_version_field_key ? "the same participant and instrument version" : "the same participant (no instrument version recorded)";
  return `numeric outcome ${definition.outcome_field_key} (column ${definition.outcome_column}), ${where(row)}, baseline to follow-up, no reporting period: `
    + `${row.numerator} of ${row.denominator} comparable participant pairs (${row.percentage}%) have a numerically higher follow-up value, `
    + `${counts.unchanged_count} the same, ${counts.decreased_count} lower; ${direction}. `
    + `Pairs need ${rule}; ${counts.excluded_participant_count} of ${counts.participant_count} participants excluded as not comparable.`;
}

function tabularCountBody(row) {
  const counts = row.component_counts;
  const definition = row.definition;
  const conditions = definition.conditions.map(conditionPhrase);
  const allDates = definition.conditions.some((condition) => condition.kind === "period") ? "" : ", across all dates";
  const dateless = Number.isSafeInteger(counts.records_without_date) && counts.records_without_date > 0
    ? `; ${plural(counts.records_without_date, "record")} without a date excluded` : "";
  const scope = conditions.length > 0
    ? `the ${plural(counts.matching_record_count, "record")} ${where(row)} with ${conditions.join(" and ")}${allDates}`
    : `all ${plural(counts.matching_record_count, "record")} ${where(row)}${allDates}`;
  if (definition.unit.kind === "distinct_key") {
    const key = definition.unit.field_key;
    const whole = conditions.length > 0
      ? ""
      : `; ${plural(counts.source_repeated_key_count, "identifier")} occur on more than one record (${plural(counts.source_records_in_repeated_keys, "record")}), `
        + `${plural(counts.source_records_without_key, "record")} have no ${key} value, and separately ${plural(counts.exact_duplicate_group_count, "exact-duplicate row group")} `
        + `hold ${plural(counts.exact_duplicate_member_records, "record")}, ${counts.exact_duplicate_excess_copies} of them excess copies`;
    return `${row.measured_value} distinct ${key} identifiers, each counted once, among ${scope}${whole}${dateless}.`;
  }
  const duplicates = counts.exact_duplicate_member_records > 0
    ? `; exact-duplicate rows are counted as separate records (${plural(counts.exact_duplicate_member_records, "record")} in repeated groups in the source)`
    : "";
  const counted = conditions.length > 0
    ? `${plural(row.measured_value, "record")} ${where(row)} have ${conditions.join(" and ")}${allDates}`
    : `${plural(row.measured_value, "record")} ${where(row)}, all records${allDates}`;
  return `${counted}${dateless}${duplicates}.`;
}

function tabularRateBody(row) {
  const counts = row.component_counts;
  const definition = row.definition;
  const numerator = conditionPhrase(definition.conditions[0]);
  const population = definition.population[0]
    ? `the ${counts.population_record_count} records with ${conditionPhrase(definition.population[0])}`
    : `all ${counts.population_record_count} records`;
  return `among ${population} ${where(row)} (the measured population), ${row.numerator} have ${numerator}: `
    + `${row.numerator} of ${row.denominator} (${row.percentage}%); ${counts.other_population_record_count} of the ${row.denominator} do not.`;
}

// The monthly finding states each month's count, so a generated or released
// report carries the breakdown itself. A breakdown too long for the statement
// limit (a long reporting period) keeps the earlier wording instead. The
// duration sentence keeps a monthly finding recorded with a duration field
// distinct (in statement, so in evidence identity) from a monthly-only one.
function monthlyActivityBody(row, interpretation) {
  const c = row.component_counts;
  const d = row.definition;
  const lead = `${plural(c.eligible_encounter_count, "eligible service encounter")}`;
  const durationMapped = d.duration ? ` Duration field ${d.duration.field_key} was also mapped.` : "";
  const months = c.monthly_activity.map((item) => `${item.month} ${item.encounter_count}`).join(", ");
  const stated = `${lead} by actual service month (encounters, not people), reporting period ${d.period.period_start} to ${d.period.period_end}: ${months}; linked to register ${d.reference_source_version_id}.${durationMapped}`;
  if (validateComposedStatement(`Derived measurement: ${interpretationPrefix(interpretation)}${stated}`).ok) return stated;
  return `${lead} grouped by actual service month (encounters, not people), reporting period ${d.period.period_start} to ${d.period.period_end}; linked to register ${d.reference_source_version_id}. The breakdown and exclusions are recorded with the measurement.${durationMapped}`;
}

/**
 * Repeated copies of an event identifier that the reconciliation counted
 * once: the excess copies of CONSISTENT identities only. The recorded
 * excess-copy count also covers the copies of conflicting identities, which
 * are excluded whole and never counted once (owner Package 4, 2026-11-10).
 */
export function countedOnceDuplicateCopyCount(counts) {
  const c = counts || {};
  return c.excess_copy_record_count - (c.conflicting_record_count - c.conflicting_event_identity_count);
}

function crossSourceBody(row, interpretation) {
  const c = row.component_counts;
  const d = row.definition;
  const events = d.mapping.events;
  const linkage = `${events.event_identifier_field_key} events, ${events.status_field_key} = ${events.completed_value_label}, `
    + `${events.date_field_key} in reporting period ${d.period.period_start} to ${d.period.period_end} by day, `
    + `${events.participant_identifier_field_key} in register ${d.reference_source_version_id} ${d.mapping.register.participant_identifier_field_key}`;
  // Only copies of consistent identities are counted once; conflicting
  // identities are stated as excluded. With no conflicting identity the
  // wording is exactly as before, so no recorded statement changes, and the
  // length never grows (the 500-character statement limit).
  const exclusions = `${countedOnceDuplicateCopyCount(c)} duplicate copies counted once; excluded ${c.completed_outside_period_count} outside period, `
    + `${c.unmatched_event_count} unmatched, ${c.conflicting_event_identity_count} conflicting`;
  const scope = d.group ? ` in ${d.group.field_key} = ${d.group.value_label}` : "";
  switch (d.metric) {
    case CROSS_SOURCE_METRICS.MONTHLY_ACTIVITY:
      return monthlyActivityBody(row, interpretation);
    case CROSS_SOURCE_METRICS.RECORDED_DURATION:
      return `${c.duration_known_count ? `${c.known_recorded_minutes} known recorded minutes subtotal` : "No known recorded minutes subtotal is available"}, from ${c.duration_known_count} of ${c.eligible_encounter_count} eligible encounters; ${c.duration_missing_count} missing and ${c.duration_invalid_count} invalid or conflicting durations. This is not a complete service-time total. Reporting period ${d.period.period_start} to ${d.period.period_end}; linked to register ${d.reference_source_version_id}.`;
    case CROSS_SOURCE_METRICS.ELIGIBLE_ENCOUNTERS:
    case CROSS_SOURCE_METRICS.GROUP_ENCOUNTERS:
      return `${plural(row.measured_value, "eligible service encounter")}${scope} (encounters, not people): ${linkage}; ${exclusions}.`;
    case CROSS_SOURCE_METRICS.MULTI_GROUP_PEOPLE:
      return `${plural(row.measured_value, "register participant")} served in more than one ${events.group_field_key} value, each counted once, among ${c.eligible_encounter_count} eligible encounters: ${linkage}.`;
    default: {
      const among = d.group ? c.group_encounter_count : c.eligible_encounter_count;
      const overlap = d.group ? "" : `; ${c.multi_group_person_count} in several ${events.group_field_key ?? "groups"} counted once`;
      return `${plural(row.measured_value, "distinct register participant")} served${scope}, each counted once, among ${among} eligible encounters: ${linkage}${overlap}; ${exclusions}.`;
    }
  }
}

function measurementBody(row, interpretation) {
  if (row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH) return crossSourceBody(row, interpretation);
  if (row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME) return pairedBody(row, interpretation);
  if (row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.TABULAR_RATE) return tabularRateBody(row);
  return tabularCountBody(row);
}

function capitalized(text) {
  return text.length > 0 ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

export function composeDerivedMeasurementEvidenceStatement({ measurementRow, interpretation = null }) {
  return `Derived measurement: ${interpretationPrefix(interpretation)}${measurementBody(measurementRow, interpretation)}`;
}

export function composeDerivedMeasurementClaimStatement({ measurementRow, interpretation = null }) {
  const prefix = interpretationPrefix(interpretation);
  const body = measurementBody(measurementRow, interpretation);
  return `${prefix}${prefix ? body : capitalized(body)}`;
}

/** The evidence statement must fit the evidence and claim statement limits. */
export function validateDerivedStatements({ measurementRow, interpretation = null }) {
  for (const statement of [
    composeDerivedMeasurementEvidenceStatement({ measurementRow, interpretation }),
    composeDerivedMeasurementClaimStatement({ measurementRow, interpretation }),
  ]) {
    const composable = validateComposedStatement(statement);
    if (!composable.ok) {
      return refuse("derived_statement_not_composable", "The measurement cannot be stated within the evidence statement limits.", "Shorten the indicator label.", { objectType: "derived_measurement_interpretation" });
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Persisted arithmetic, re-checked wherever a measurement is consumed.

/** The arithmetic a persisted measurement row must keep (mirrors the CHECKs). */
export function derivedMeasurementArithmeticHolds(row) {
  if (!isPlainObject(row) || METHOD_FAMILY[row.calculation_method] !== row.measurement_family) return false;
  const counts = row.component_counts;
  if (!isPlainObject(counts) || !isCount(row.measured_value) || !isCount(row.numerator) || row.measured_value !== row.numerator) return false;
  if (row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH) return crossSourceFunnelHolds(row);
  if (row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.TABULAR_COUNT) {
    return row.denominator === null && row.percentage === null
      && isCount(counts.matching_record_count) && row.measured_value <= counts.matching_record_count
      && (row.calculation_method !== DERIVED_MEASUREMENT_METHODS.RECORD_COUNT || row.measured_value === counts.matching_record_count)
      && (row.calculation_method !== DERIVED_MEASUREMENT_METHODS.DISTINCT_KEY_COUNT || row.measured_value === counts.distinct_key_count);
  }
  if (!isCount(row.denominator) || row.denominator === 0 || row.numerator > row.denominator || row.percentage !== formatRate(row.numerator, row.denominator)) return false;
  if (row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME) {
    return counts.increased_count === row.numerator
      && counts.comparable_pair_count === row.denominator
      && counts.increased_count + counts.unchanged_count + counts.decreased_count === row.denominator
      && counts.participant_count === row.denominator + counts.excluded_participant_count;
  }
  return counts.population_record_count === row.denominator && counts.numerator_record_count === row.numerator
    && counts.other_population_record_count === row.denominator - row.numerator;
}

function locatorMatches(locatorRow, row) {
  const coordinates = locatorRow?.coordinates;
  if (locatorRow?.locator_type !== DERIVED_MEASUREMENT_LOCATOR_TYPE || !isPlainObject(coordinates)) return false;
  if (coordinates.scope !== DERIVED_MEASUREMENT_LOCATOR_SCOPE) return false;
  if ((coordinates.sheet_key ?? null) !== (row.worksheet_key ?? null)) return false;
  return JSON.stringify(coordinates.field_keys) === JSON.stringify(row.field_keys);
}

/** The locator coordinates of a measurement: its worksheet and its fields. */
export function derivedMeasurementLocatorCoordinates({ sheetKey, fieldKeys }) {
  return Object.freeze({
    scope: DERIVED_MEASUREMENT_LOCATOR_SCOPE,
    ...(sheetKey ? { sheet_key: sheetKey } : {}),
    field_keys: [...fieldKeys],
  });
}

/**
 * P2-03 basis for a claim on derived-measurement evidence: the persisted
 * measurement belongs to exactly this evidence item, organization and
 * current source version, keeps its arithmetic, sits on its fields locator,
 * is still bound to the profile the version was promoted from, and the
 * evidence is stated under the measurement's current interpretation (or
 * under none while none is recorded). Anything else fails closed.
 */
export function validateDerivedMeasurementClaimBasis({ evidenceItemRow, locatorRow, sourceVersionRow, measurementRow }) {
  const ok = Boolean(measurementRow)
    && evidenceItemRow?.evidence_type === DERIVED_MEASUREMENT_EVIDENCE_TYPE
    && evidenceItemRow.data_class === DERIVED_MEASUREMENT_DATA_CLASS
    && measurementRow.evidence_item_id === evidenceItemRow.evidence_item_id
    && measurementRow.organization_id === evidenceItemRow.organization_id
    && measurementRow.source_version_id === evidenceItemRow.source_version_id
    && measurementRow.measurement_source_version_id === evidenceItemRow.source_version_id
    && derivedMeasurementArithmeticHolds(measurementRow)
    && locatorMatches(locatorRow, measurementRow)
    && derivedEvidenceIsCurrent(measurementRow)
    && derivedContributingSourcesCurrent(measurementRow)
    && derivedMeasurementLabelsAdmitted(measurementRow)
    && measurementRow.profile_canonical_sha256 === sourceVersionRow?.profile_canonical_sha256
    && evidenceItemRow.statement === composeDerivedMeasurementEvidenceStatement({ measurementRow, interpretation: interpretationOf(measurementRow) });
  if (!ok) {
    return refuse(
      "derived_measurement_claim_basis_invalid",
      "This evidence item's measurement is missing, no longer matches its source versions, or is stated under a superseded interpretation.",
      "Use the measurement's current evidence item.",
      { objectType: "evidence_item", objectId: evidenceItemRow?.evidence_item_id ?? null },
    );
  }
  return { ok: true };
}

/** The interpretation an evidence row is stated under, from a joined row. */
export function interpretationOf(row) {
  return row?.interpretation_id
    ? { indicator_label: row.indicator_label, meaning_text: row.meaning_text, score_direction: row.score_direction, evidence_basis: row.evidence_basis }
    : null;
}

export function composeDerivedClaimStatementFromRow(row) {
  return composeDerivedMeasurementClaimStatement({ measurementRow: row, interpretation: interpretationOf(row) });
}

// ---------------------------------------------------------------------------
// Coverage dimensions and limitation codes.

export const DERIVED_ANSWERED_DIMENSION_KEYS = Object.freeze([
  "definition_clarity",
  "denominator_clarity",
  "time_period_clarity",
  "entity_level_clarity",
]);

function hasPeriod(row) {
  return (row.definition?.conditions || []).some((condition) => condition.kind === "period");
}

/**
 * The coverage dimensions a derived measurement decides; the source-level
 * dimensions are kept as assessed. A proposed meaning is a recorded
 * limitation, not a missing approval: the result is retained and usable
 * with the limitation disclosed.
 */
// Whether an evidence row states its measurement under the measurement's
// current interpretation (or under none while none is recorded).
export function derivedEvidenceIsCurrent(row) {
  return isPlainObject(row) && (row.interpretation_id ?? null) === (row.current_interpretation_id ?? null);
}

export function applyDerivedMeasurementCoverageDimensions(dimensions, row) {
  const valid = isPlainObject(row) && derivedMeasurementArithmeticHolds(row) && derivedEvidenceIsCurrent(row) && derivedContributingSourcesCurrent(row);
  if (!valid) {
    const unresolved = (key) => dimensionResult(key, "unresolved", isPlainObject(row) && !derivedEvidenceIsCurrent(row)
      ? "The evidence states the measurement under an interpretation that has since been corrected."
      : isPlainObject(row) && !derivedContributingSourcesCurrent(row)
        ? "A source this measurement combines is no longer the current version it was calculated from."
        : "The derived measurement is not available.");
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
  const paired = row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME;
  const cross = row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH;
  const counts = row.component_counts;
  const excluded = paired
    ? counts.excluded_participant_count > 0
    : cross
      ? counts.completed_without_date_count + counts.unmatched_event_count + counts.blank_participant_identifier_event_count + counts.conflicting_event_identity_count + counts.blank_event_identifier_record_count > 0
      : (counts.records_without_date ?? 0) > 0 || (row.definition.unit?.kind === "distinct_key" && (counts.source_records_without_key ?? 0) > 0);
  const duplicateRows = paired
    ? (row.exclusions?.rows || []).some((item) => item.reason === "exact_duplicate_row" && item.row_count > 0)
    : cross ? counts.duplicate_group_count > 0 : (counts.exact_duplicate_member_records ?? 0) > 0;
  return {
    ...dimensions,
    missingness: excluded
      ? dimensionResult("missingness", "resolved_risk_flagged", "Observations without the values the method needs are excluded and counted.")
      : dimensionResult("missingness", "resolved_clear", "No observation was excluded for a missing value."),
    duplicates: duplicateRows
      ? dimensionResult("duplicates", "resolved_risk_flagged", "The source has exact-duplicate rows; the method states how they are treated.")
      : dimensionResult("duplicates", "resolved_clear", "The source has no exact-duplicate rows."),
    definition_clarity: row.interpretation_id
      ? dimensionResult("definition_clarity", "resolved_clear", "A person at the organization stated what the measured field represents.", { field_count: 1 })
      : dimensionResult("definition_clarity", "resolved_risk_flagged", "What the measured field represents is proposed, not established by a person."),
    denominator_clarity: row.denominator === null
      ? dimensionResult("denominator_clarity", "resolved_clear", "The measurement is a count; it states no rate, so no denominator applies.")
      : dimensionResult("denominator_clarity", "resolved_clear", "The method states the denominator and the population it covers.", { field_count: 1 }),
    time_period_clarity: hasPeriod(row) || cross
      ? dimensionResult("time_period_clarity", "resolved_clear", "The engagement's recorded reporting period is applied to the dates in the selected date field.")
      : dimensionResult("time_period_clarity", "resolved_risk_flagged", "No reporting period is applied to this measurement."),
    entity_level_clarity: dimensionResult("entity_level_clarity", "resolved_clear", "The method states what is counted.", { field_count: 1 }),
    coverage_gaps: dimensionResult("coverage_gaps", "resolved_clear", "The measurement evidence covers the fields its method reads.", { field_count: row.field_keys?.length ?? 1 }),
  };
}

export const DERIVED_LIMITATION_CODES = Object.freeze({
  MEANING_PROPOSED: "derived.meaning_proposed",
  MEANING_HUMAN_STATED: "derived.meaning_human_stated",
  DIRECTION_NOT_ESTABLISHED: "derived.direction_not_established",
  DIRECTION_HUMAN_STATED: "derived.direction_human_stated",
  MATCHED_SUBSET_ONLY: "derived.matched_subset_only",
  VERSION_NOT_RECORDED: "derived.instrument_version_not_recorded",
  OBSERVATIONS_EXCLUDED: "derived.observations_excluded",
  NO_REPORTING_PERIOD: "derived.no_reporting_period",
  ENGAGEMENT_PERIOD_APPLIED: "derived.engagement_period_applied",
  RECORDS_WITHOUT_DATE_EXCLUDED: "derived.records_without_date_excluded",
  DUPLICATE_ROWS_COUNTED: "derived.duplicate_rows_counted",
  EACH_KEY_ONCE: "derived.each_identifier_counted_once",
  RECORDS_WITHOUT_KEY_EXCLUDED: "derived.records_without_identifier_excluded",
  MEASURED_POPULATION_ONLY: "derived.measured_population_only",
  SELF_REPORTED: "derived.self_reported",
  ORGANIZATION_RECORDS: "derived.organization_records",
  VALUES_NOT_VERIFIED: "derived.values_not_verified",
  CROSS_SOURCE_LINKED: "derived.cross_source_linked",
  DUPLICATE_EVENT_COPIES_COLLAPSED: "derived.duplicate_event_copies_counted_once",
  UNMATCHED_IDENTIFIERS_EXCLUDED: "derived.unmatched_identifiers_excluded",
  CONFLICTING_EVENTS_EXCLUDED: "derived.conflicting_event_identities_excluded",
  ENCOUNTERS_NOT_PEOPLE: "derived.encounters_not_people",
  PEOPLE_COUNTED_ONCE: "derived.people_counted_once_across_groups",
  RECORDED_MINUTES_SUBTOTAL: "derived.known_recorded_minutes_subtotal",
});
const C = DERIVED_LIMITATION_CODES;

/** The limitation codes of one derived measurement under its evidence's interpretation, plus every coverage dimension that is not clear. */
export function derivedMeasurementLimitationCodes({ measurementRow: row, dimensions }) {
  const codes = [C.VALUES_NOT_VERIFIED];
  const interpretation = interpretationOf(row);
  codes.push(interpretation ? C.MEANING_HUMAN_STATED : C.MEANING_PROPOSED);
  if (interpretation?.evidence_basis === "self_reported") codes.push(C.SELF_REPORTED);
  if (interpretation?.evidence_basis === "organization_record") codes.push(C.ORGANIZATION_RECORDS);
  const counts = row.component_counts || {};
  if (row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH) {
    codes.push(C.CROSS_SOURCE_LINKED, C.ENGAGEMENT_PERIOD_APPLIED);
    if (countedOnceDuplicateCopyCount(counts) > 0) codes.push(C.DUPLICATE_EVENT_COPIES_COLLAPSED);
    if (counts.unmatched_event_count + counts.blank_participant_identifier_event_count > 0) codes.push(C.UNMATCHED_IDENTIFIERS_EXCLUDED);
    if (counts.conflicting_event_identity_count > 0) codes.push(C.CONFLICTING_EVENTS_EXCLUDED);
    if (counts.completed_without_date_count > 0) codes.push(C.RECORDS_WITHOUT_DATE_EXCLUDED);
    const metric = row.definition?.metric;
    if (metric === CROSS_SOURCE_METRICS.RECORDED_DURATION) codes.push(C.RECORDED_MINUTES_SUBTOTAL);
    if ([CROSS_SOURCE_METRICS.ELIGIBLE_ENCOUNTERS, CROSS_SOURCE_METRICS.GROUP_ENCOUNTERS, CROSS_SOURCE_METRICS.MONTHLY_ACTIVITY].includes(metric)) codes.push(C.ENCOUNTERS_NOT_PEOPLE);
    else if (metric !== CROSS_SOURCE_METRICS.RECORDED_DURATION) codes.push(C.EACH_KEY_ONCE, C.PEOPLE_COUNTED_ONCE);
  } else if (row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME) {
    codes.push(C.MATCHED_SUBSET_ONLY, C.NO_REPORTING_PERIOD);
    codes.push(["higher_is_better", "lower_is_better"].includes(interpretation?.score_direction) ? C.DIRECTION_HUMAN_STATED : C.DIRECTION_NOT_ESTABLISHED);
    if (!row.definition?.instrument_version_field_key) codes.push(C.VERSION_NOT_RECORDED);
    if (counts.excluded_participant_count > 0) codes.push(C.OBSERVATIONS_EXCLUDED);
  } else {
    codes.push(hasPeriod(row) ? C.ENGAGEMENT_PERIOD_APPLIED : C.NO_REPORTING_PERIOD);
    if ((counts.records_without_date ?? 0) > 0) codes.push(C.RECORDS_WITHOUT_DATE_EXCLUDED);
    if (row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.TABULAR_RATE) codes.push(C.MEASURED_POPULATION_ONLY);
    if (row.definition?.unit?.kind === "distinct_key") {
      codes.push(C.EACH_KEY_ONCE);
      if ((counts.source_records_without_key ?? 0) > 0) codes.push(C.RECORDS_WITHOUT_KEY_EXCLUDED);
    } else if ((counts.exact_duplicate_member_records ?? 0) > 0) {
      codes.push(C.DUPLICATE_ROWS_COUNTED);
    }
  }
  for (const [dimensionKey, dimension] of Object.entries(isPlainObject(dimensions) ? dimensions : {})) {
    const status = dimension?.assessment_status;
    if (typeof status !== "string" || status === "resolved_clear") continue;
    codes.push(dimension.internal_limitation_accepted === true ? `coverage.${dimensionKey}.accepted_internal_limitation` : `coverage.${dimensionKey}.${status}`);
  }
  return [...new Set(codes)].sort();
}

export function isDerivedLimitationCode(code) {
  return typeof code === "string" && code.startsWith("derived.");
}

// One description per code: shown by the organization's measurement screen
// and the internal report, and appended to an Evidence Summary block. No
// number, label or other free text, no causal wording, and no assertion that
// anything was verified.
const DERIVED_DISCLOSURES = Object.freeze({
  [C.MEANING_PROPOSED]: "What the measured field represents has not been stated by a person at the organization; the result describes recorded values only.",
  [C.MEANING_HUMAN_STATED]: "What the measured field represents was stated by a person at the organization; KAI calculated the values but did not check that meaning.",
  [C.DIRECTION_NOT_ESTABLISHED]: "Whether a higher value is better has not been established, so a higher follow-up value is not presented as a better result.",
  [C.DIRECTION_HUMAN_STATED]: "Which direction is better was stated by a person at the organization, not determined by KAI.",
  [C.MATCHED_SUBSET_ONLY]: "The result covers only participants with a comparable baseline and follow-up observation, not every participant.",
  [C.VERSION_NOT_RECORDED]: "No instrument version is recorded, so whether the two observations used the same instrument was not checked.",
  [C.OBSERVATIONS_EXCLUDED]: "Observations that could not be compared were excluded and counted.",
  [C.NO_REPORTING_PERIOD]: "No reporting period was applied to this measurement.",
  [C.ENGAGEMENT_PERIOD_APPLIED]: "The reporting period is the one recorded for the engagement, applied to the dates in the selected date field.",
  [C.RECORDS_WITHOUT_DATE_EXCLUDED]: "Records without a date in that field were excluded.",
  [C.DUPLICATE_ROWS_COUNTED]: "Exact-duplicate rows in the source are counted as separate records.",
  [C.EACH_KEY_ONCE]: "Each identifier value is counted once however many records carry it; an identifier is not necessarily a separate person.",
  [C.RECORDS_WITHOUT_KEY_EXCLUDED]: "Records with no identifier value were not counted.",
  [C.MEASURED_POPULATION_ONLY]: "The rate applies only to the measured population named in the statement, not to everyone in the source.",
  [C.SELF_REPORTED]: "The recorded values are self-reported and were not independently verified.",
  [C.ORGANIZATION_RECORDS]: "The recorded values are the organization's own records and were not independently verified.",
  [C.VALUES_NOT_VERIFIED]: "KAI did not check the recorded values against any other source.",
  [C.CROSS_SOURCE_LINKED]: "The measurement combines two source versions: service records were linked to the participant register by matching identifier values exactly, and it stays current only while both versions do.",
  [C.DUPLICATE_EVENT_COPIES_COLLAPSED]: "Repeated records of one event identifier were counted as one event.",
  [C.UNMATCHED_IDENTIFIERS_EXCLUDED]: "Service records whose participant identifier has no match in the register were excluded from linked reach and counted; the records themselves are kept.",
  [C.CONFLICTING_EVENTS_EXCLUDED]: "Event identifiers whose repeated records disagree were excluded rather than resolved by choosing one record.",
  [C.ENCOUNTERS_NOT_PEOPLE]: "This counts service encounters, not people; one person can have many encounters.",
  [C.PEOPLE_COUNTED_ONCE]: "A person with encounters in more than one programme group is counted once in an organization-wide total.",
  [C.RECORDED_MINUTES_SUBTOTAL]: "This is a known recorded minutes subtotal, not a complete service-time total; missing, invalid or conflicting durations are not included.",
});

export function describeDerivedLimitationCode(code) {
  if (DERIVED_DISCLOSURES[code]) return DERIVED_DISCLOSURES[code];
  const documentDescription = describeDocumentLimitationCode(code);
  if (documentDescription) return documentDescription;
  return describeMeasurementLimitationCode(code);
}

/**
 * The Evidence Summary disclosure of one derived measurement's codes, or null
 * when it cannot be composed: the meaning state is required, and every code
 * must have a known description.
 */
export function composeDerivedMeasurementDisclosure(codes) {
  const present = new Set(codes);
  if (present.has(C.MEANING_PROPOSED) === present.has(C.MEANING_HUMAN_STATED)) return null;
  if ([...present].some((code) => (isDerivedLimitationCode(code) && !DERIVED_DISCLOSURES[code]) || !(isDerivedLimitationCode(code) || code.startsWith("coverage.")))) return null;
  const coverage = [...present].filter((code) => code.startsWith("coverage.")).sort().map(describeMeasurementLimitationCode);
  if (coverage.includes(null)) return null;
  const sentences = Object.keys(DERIVED_DISCLOSURES).filter((code) => present.has(code)).map((code) => DERIVED_DISCLOSURES[code]);
  if (coverage.length > 0) sentences.push(`Coverage limitations: ${coverage.join(" ")}`);
  return sentences.join(" ");
}

/**
 * VAL-GEN-008 rules for a block citing a derived measurement: each code's
 * disclosure, wording-tolerant, and what must not be asserted.
 */
const UNNEGATED_VERIFIED = /(?<!not |un|n't |not been |never |not independently |not been independently )\bverified\b/i;
export const DERIVED_DISCLOSURE_RULES = Object.freeze([
  Object.freeze({ code: C.MEANING_PROPOSED, requires: /\bnot (?:been )?(?:stated|established|defined)\b/i }),
  Object.freeze({ code: C.MEANING_HUMAN_STATED, requires: /\b(?:stated|defined) by a person\b|\bthe organization (?:states|stated|defines|defined)\b/i }),
  Object.freeze({ code: C.DIRECTION_NOT_ESTABLISHED, requires: /\bwhether (?:a )?higher (?:value |score )?is better\b/i, forbids: /\b(?<!not |n't )improv(?:ed|ement|ements|ing)\b/i }),
  Object.freeze({ code: C.MATCHED_SUBSET_ONLY, requires: /\bcomparable\b/i, forbids: /(?<!not |n't )\b(?:all|every) (?:enrolled )?participants?\b/i }),
  Object.freeze({ code: C.MEASURED_POPULATION_ONLY, requires: /\bmeasured population\b/i, forbids: /(?<!not |n't )\b(?:all|every) (?:enrolled )?participants?\b/i }),
  Object.freeze({ code: C.SELF_REPORTED, requires: /\bself-reported\b/i, forbids: UNNEGATED_VERIFIED }),
  Object.freeze({ code: C.VALUES_NOT_VERIFIED, requires: /\bdid not (?:check|verify)\b|\bnot (?:been )?(?:independently )?(?:checked|verified)\b/i, forbids: UNNEGATED_VERIFIED }),
  Object.freeze({ code: C.NO_REPORTING_PERIOD, requires: /\bno reporting period\b/i }),
  Object.freeze({ code: C.ENGAGEMENT_PERIOD_APPLIED, requires: /\breporting period\b/i }),
  Object.freeze({ code: C.DUPLICATE_ROWS_COUNTED, requires: /\bduplicate/i }),
  Object.freeze({ code: C.EACH_KEY_ONCE, requires: /\bcounted once\b/i }),
  Object.freeze({ code: C.CROSS_SOURCE_LINKED, requires: /\bregister\b/i }),
  Object.freeze({ code: C.RECORDED_MINUTES_SUBTOTAL, requires: /\bsubtotal\b/i,
    forbids: /(?<!not )(?<!not a )(?<!not the )\b(?:all|complete|full|entire|total) (?:recorded )?service[- ]time\b/i }),
  Object.freeze({ code: C.UNMATCHED_IDENTIFIERS_EXCLUDED, requires: /\bunmatched\b|\bno match\b/i }),
  Object.freeze({ code: C.ENCOUNTERS_NOT_PEOPLE, requires: /\bencounters?\b/i, forbids: /\b\d[\d,]*\s+(?:distinct\s+)?(?:people|persons|individuals|participants)\b/i }),
]);
