import { screenedSourceLabel } from "../profiling/tabularMeasurementBasis.js";
import { DERIVED_MEASUREMENT_FAMILIES, measurementTargetUnitOf } from "./kaiDerivedMeasurementValidators.js";

/**
 * Planned targets stated in a worksheet (for example a "Delivery_Targets"
 * sheet with indicator / target_value / unit / reporting_period columns), read
 * from the verified upload by the parser worker and returned as candidates.
 *
 * A candidate is the organization's own planning row: its planned value, unit,
 * period, programme and status exactly as the row states them, with the row's
 * worksheet locator. It is never a recorded measurement and never an accepted
 * target. Text values pass the same label screen as listed category values;
 * free-text notes are never returned (only that a note exists). Anything the
 * row does not state, or states in a form KAI cannot read exactly, is a named
 * limitation rather than a guess.
 *
 * A candidate's possible relationship to a recorded measurement is assessed
 * check by check (Project, currentness, unit, period, comparison, meaning).
 * The meaning of an indicator is the organization's decision: KAI only
 * proposes a recorded result whose name shares words with the indicator, and
 * never marks a relationship accepted.
 */

export const PLANNING_TARGET_ASSESSMENT_VERSION = "kai_planning_target_candidates_v1";
// A planning table is small; larger worksheets are not read for targets.
export const MAX_PLANNING_TARGET_ROWS = 200;

const HEADER_ROLES = Object.freeze({
  value: ["target value", "target", "planned value", "planned target", "plan value", "goal", "goal value", "target number",
    "target amount", "target count", "planned", "planned amount", "planned number"],
  indicator: ["indicator", "indicator name", "metric", "metric name", "measure", "measure name", "kpi", "output", "outcome",
    "target metric", "target name", "target indicator", "performance indicator"],
  unit: ["unit", "units", "unit of measure", "target unit", "measurement unit", "uom"],
  period: ["reporting period", "period", "target period", "time period", "timeframe", "time frame"],
  period_start: ["period start", "start date", "target start", "reporting period start"],
  period_end: ["period end", "end date", "target end", "reporting period end"],
  scope: ["program", "programme", "program code", "programme code", "scope", "service area"],
  status: ["target status", "status"],
  comparator: ["comparison", "comparator", "direction", "target direction"],
  note: ["notes", "note", "comment", "comments", "description"],
});
const OPTIONAL_ROLES = Object.freeze(["unit", "period", "period_start", "period_end", "scope", "status", "comparator", "note"]);
const PERCENT_UNITS = new Set(["%", "percent", "percentage", "per cent", "pct", "percent of", "rate"]);
const ALL_SCOPES = new Set(["all", "overall", "total", "all programs", "all programmes", "organization", "organisation"]);
const AT_LEAST = new Set(["at least", "at_least", "minimum", "min", ">=", "≥", "no less than", "or more"]);
const AT_MOST = new Set(["at most", "at_most", "maximum", "max", "<=", "≤", "no more than", "or fewer", "or less"]);
const PERIOD_RE = /^(\d{4}-\d{2}-\d{2})\s*(?:to|through|until|–|—|-)\s*(\d{4}-\d{2}-\d{2})$/i;
const VALUE_RE = /^(\d{1,12})(?:\.(\d+))?(\s*%)?$/;

const LIMITATIONS = Object.freeze({
  indicator_missing: "The row names no indicator.",
  indicator_withheld: "The indicator name is withheld by KAI's label screen (it may describe a person or exceed the label rules). Read it in the source file.",
  planned_value_missing: "The row states no planned value.",
  planned_value_not_numeric: "The planned value is not a number KAI can read exactly.",
  planned_value_precision_unsupported: "The planned value has more than two decimal places.",
  unit_not_stated: "The row states no unit, so KAI cannot tell what the planned number counts.",
  unit_withheld: "The unit is withheld by KAI's label screen. Read it in the source file.",
  period_not_stated: "The row states no reporting period.",
  period_not_recognized: "The reporting period is not two exact dates KAI can read (for example 2025-04-01 to 2026-03-31).",
  scope_withheld: "The programme or scope label is withheld by KAI's label screen. Read it in the source file.",
  scope_is_subset: "The target applies to part of the organization's work only (the stated programme or scope).",
  comparison_not_stated: "The worksheet does not say whether the result should be at least or at most the planned value.",
  comparison_not_recognized: "The comparison is stated in a form KAI cannot read (use at least or at most).",
  note_not_shown: "The row has a free-text note. KAI does not display free text; read it in the source file before confirming what the target counts.",
  duplicate_target_rows: "Another row states a target for the same indicator, scope and period; confirm which one applies.",
});

export function describePlanningTargetLimitation(code) {
  return LIMITATIONS[code] ?? "This planning row has an unresolved limitation.";
}

function normalizedHeader(header) {
  return String(header ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
}

function isIsoDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function fieldKey(index) {
  return `field_${index + 1}`;
}

function columnLetter(position) {
  return position > 26 ? `${columnLetter(Math.floor((position - 1) / 26))}${String.fromCharCode(65 + (position - 1) % 26)}` : String.fromCharCode(64 + position);
}

function plannedValue(raw) {
  if (raw === "") return { code: "planned_value_missing" };
  const match = VALUE_RE.exec(raw);
  if (!match) return { code: "planned_value_not_numeric" };
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (fraction.length > 2) return { code: "planned_value_precision_unsupported" };
  const whole = String(BigInt(match[1]));
  return { value: fraction ? `${whole}.${fraction}` : whole, percentSign: Boolean(match[3]) };
}

function periodOf(cells, columns) {
  if (columns.period !== undefined) {
    const raw = cells[columns.period];
    if (raw === "") return { code: "period_not_stated" };
    const match = PERIOD_RE.exec(raw);
    if (!match || !isIsoDay(match[1]) || !isIsoDay(match[2]) || match[1] > match[2]) return { code: "period_not_recognized" };
    return { period: { start: match[1], end: match[2] } };
  }
  if (columns.period_start !== undefined && columns.period_end !== undefined) {
    const start = cells[columns.period_start];
    const end = cells[columns.period_end];
    if (start === "" && end === "") return { code: "period_not_stated" };
    if (!isIsoDay(start) || !isIsoDay(end) || start > end) return { code: "period_not_recognized" };
    return { period: { start, end } };
  }
  return { code: "period_not_stated" };
}

function comparatorOf(cells, columns) {
  if (columns.comparator === undefined || cells[columns.comparator] === "") return { code: "comparison_not_stated" };
  const value = cells[columns.comparator].trim().toLowerCase();
  if (AT_LEAST.has(value)) return { comparator: "at_least" };
  if (AT_MOST.has(value)) return { comparator: "at_most" };
  return { code: "comparison_not_recognized" };
}

/**
 * Assess one worksheet's records (record 0 the header row, as the parser
 * worker reads them) for planned-target rows. Returns screened candidates
 * with row locators and limitations, or why the worksheet is not assessed.
 */
export function assessPlanningTargetRecords(records, { worksheetKey = null } = {}) {
  const base = { assessment_version: PLANNING_TARGET_ASSESSMENT_VERSION, worksheet_key: worksheetKey };
  if (!Array.isArray(records) || records.length === 0 || !Array.isArray(records[0])) return { ...base, status: "not_planning_targets" };
  const headers = records[0].map(normalizedHeader);
  const roleColumns = {};
  for (const [role, names] of Object.entries(HEADER_ROLES)) {
    roleColumns[role] = headers.flatMap((header, index) => (names.includes(header) ? [index] : []));
  }
  if (roleColumns.value.length === 0 || roleColumns.indicator.length === 0) return { ...base, status: "not_planning_targets" };
  const dataRowCount = records.length - 1;
  const ambiguousRoles = ["value", "indicator"].filter((role) => roleColumns[role].length > 1);
  if (ambiguousRoles.length > 0) {
    return { ...base, status: "planning_columns_ambiguous", ambiguous_roles: ambiguousRoles, data_row_count: dataRowCount, candidates: [] };
  }
  if (dataRowCount > MAX_PLANNING_TARGET_ROWS) return { ...base, status: "too_many_rows", data_row_count: dataRowCount, candidates: [] };
  // An optional role named by two columns is not used: which one applies is not stated.
  const columns = { value: roleColumns.value[0], indicator: roleColumns.indicator[0] };
  const ambiguousOptional = [];
  for (const role of OPTIONAL_ROLES) {
    if (roleColumns[role].length === 1) columns[role] = roleColumns[role][0];
    else if (roleColumns[role].length > 1) ambiguousOptional.push(role);
  }
  const fieldKeys = Object.fromEntries(Object.entries(columns).map(([role, index]) => [role, fieldKey(index)]));
  const candidates = [];
  let blankRowCount = 0;
  for (let index = 1; index < records.length; index += 1) {
    const cells = records[index].map((value) => (typeof value === "string" ? value.trim() : ""));
    if (cells.every((value) => value === "")) {
      blankRowCount += 1;
      continue;
    }
    const limitations = [];
    const rawIndicator = cells[columns.indicator] ?? "";
    const indicator = rawIndicator === "" ? null : screenedSourceLabel(rawIndicator);
    if (rawIndicator === "") limitations.push("indicator_missing");
    else if (!indicator) limitations.push("indicator_withheld");
    const value = plannedValue(cells[columns.value] ?? "");
    if (value.code) limitations.push(value.code);
    let unit = null;
    let unitKind = value.percentSign ? "percent" : null;
    if (columns.unit === undefined || cells[columns.unit] === "") {
      if (!unitKind) limitations.push("unit_not_stated");
    } else {
      const rawUnit = cells[columns.unit];
      if (PERCENT_UNITS.has(rawUnit.toLowerCase())) {
        unit = rawUnit === "%" ? "%" : rawUnit;
        unitKind = "percent";
      } else {
        unit = screenedSourceLabel(rawUnit);
        if (!unit) limitations.push("unit_withheld");
        unitKind = unitKind ?? "count";
      }
    }
    const period = periodOf(cells, columns);
    if (period.code) limitations.push(period.code);
    let scope = null;
    if (columns.scope !== undefined && cells[columns.scope] !== "") {
      scope = screenedSourceLabel(cells[columns.scope]);
      if (!scope) limitations.push("scope_withheld");
      if (!scope || !ALL_SCOPES.has(scope.toLowerCase())) limitations.push("scope_is_subset");
    }
    const status = columns.status !== undefined && cells[columns.status] !== "" ? screenedSourceLabel(cells[columns.status]) : null;
    const comparator = comparatorOf(cells, columns);
    if (comparator.code) limitations.push(comparator.code);
    const hasNote = columns.note !== undefined && cells[columns.note] !== "";
    if (hasNote) limitations.push("note_not_shown");
    candidates.push({
      candidate_key: `${worksheetKey ?? "table"}:row_${index + 1}`,
      row_number: index + 1,
      indicator,
      planned_value: value.value ?? null,
      unit,
      unit_kind: unitKind,
      period: period.period ?? null,
      scope,
      scope_applies_to_all: scope ? ALL_SCOPES.has(scope.toLowerCase()) : null,
      status_label: status,
      comparator: comparator.comparator ?? null,
      has_note: hasNote,
      limitations,
    });
  }
  // Two rows for the same indicator, scope and period: which one applies is the organization's decision.
  const keyOf = (candidate) => candidate.indicator && JSON.stringify([candidate.indicator.toLowerCase(), candidate.scope?.toLowerCase() ?? null, candidate.period]);
  for (const candidate of candidates) {
    const key = keyOf(candidate);
    const others = key ? candidates.filter((other) => other !== candidate && keyOf(other) === key).map((other) => other.row_number) : [];
    if (others.length > 0) {
      candidate.limitations.push("duplicate_target_rows");
      candidate.duplicate_rows = others;
    }
  }
  for (const candidate of candidates) {
    candidate.limitations = candidate.limitations.map((code) => ({ code, description: describePlanningTargetLimitation(code) }));
  }
  return {
    ...base,
    status: candidates.length > 0 ? "candidates" : "no_target_rows",
    data_row_count: dataRowCount,
    blank_row_count: blankRowCount,
    columns: Object.fromEntries(Object.entries(fieldKeys).map(([role, key]) => [role, { field_key: key, column: columnLetter(Number(key.slice(6))) }])),
    ...(ambiguousOptional.length > 0 ? { ambiguous_optional_roles: ambiguousOptional } : {}),
    candidates,
  };
}

// ---------------------------------------------------------------------------
// Possible relationships between a candidate and recorded measurements.

const STOP_WORDS = new Set(["all", "the", "and", "for", "with", "from", "per", "not", "non", "total", "number", "count", "rate",
  "value", "column", "percent", "percentage", "nonblank", "record", "records"]);

function stem(word) {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function termsOf(text) {
  return new Set(String(text ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)).map(stem).filter((word) => word.length >= 3));
}

const CROSS_SOURCE_METRIC_NAMES = Object.freeze({
  eligible_linked_encounters: "Eligible linked encounters",
  distinct_people_served: "Distinct people served",
  group_linked_encounters: "Linked encounters in a group",
  group_distinct_people_served: "Distinct people served in a group",
  people_in_more_than_one_group: "People in more than one group",
  monthly_eligible_encounters: "Eligible encounters by month",
  known_recorded_service_minutes: "Known recorded service minutes",
});

/** A recorded measurement's name as the organization or the source states it, and what one counted unit is. */
export function recordedMeasurementName(row) {
  const category = (row.definition?.conditions || []).find((condition) => condition.kind === "category")?.value_label ?? null;
  const name = row.indicator_label
    || row.source_heading_label
    || (row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH ? CROSS_SOURCE_METRIC_NAMES[row.definition?.metric] : null)
    || (category ? `${category} records` : null)
    || (row.definition?.unit?.kind === "distinct_key" ? "Distinct identifier values" : null)
    || (row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME ? "Paired outcome" : "All nonblank records");
  const counted = row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME ? "comparable pairs with a higher follow-up value (a percentage)"
    : row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.TABULAR_RATE ? "a percentage of source records"
      : row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH ? (CROSS_SOURCE_METRIC_NAMES[row.definition?.metric] ?? "linked reach").toLowerCase()
        : row.definition?.unit?.kind === "distinct_key" ? "distinct identifier values" : "source records";
  return { name, counted };
}

/**
 * The exact period a recorded measurement covers (with the date column a
 * worksheet calculation applies it to), "all_dates", or "outside" (records
 * dated outside a period).
 */
export function recordedMeasurementPeriod(row) {
  if (row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH) {
    const period = row.definition?.period;
    return period?.period_start && period?.period_end ? { start: period.period_start, end: period.period_end, field_key: null } : "all_dates";
  }
  const condition = (row.definition?.conditions || []).find((item) => item.kind === "period");
  if (!condition) return "all_dates";
  if (condition.scope !== "within") return "outside";
  return { start: condition.period_start, end: condition.period_end, field_key: /^field_[1-9][0-9]*$/.test(condition.field_key ?? "") ? condition.field_key : null };
}

function recordedValueText(row) {
  if (row.percentage != null) return `${row.numerator} of ${row.denominator} (${row.percentage}%)`;
  return String(row.measured_value);
}

/**
 * Whether a candidate and a recorded measurement could be the same metric,
 * check by check. "fail" makes them not comparable as stated; "confirm" is a
 * question only the organization can answer. No check ever passes the meaning.
 */
export function assessPlanningTargetRelationship({ candidate, measurement, planningEngagementId, measurementEngagementId }) {
  const checks = [];
  const add = (key, result, text) => checks.push({ key, result, text });
  const { name, counted } = recordedMeasurementName(measurement);
  if (planningEngagementId && planningEngagementId === measurementEngagementId) add("project", "pass", "Same Project.");
  else add("project", "fail", "This result belongs to a different Project.");
  if (measurement.is_current === false || measurement.contributing_sources_current === false) {
    add("currentness", "fail", "This result was calculated from a source version that has since been replaced.");
  } else add("currentness", "pass", "Calculated from the current source version.");
  const measuredUnit = measurementTargetUnitOf(measurement.measurement_family);
  const unitWord = candidate.unit ? `"${candidate.unit}"` : "an unstated unit";
  if (!candidate.unit_kind) add("unit", "confirm", "The worksheet does not state the unit, so whether the planned value is a count or a percentage is not established.");
  else if (candidate.unit_kind === measuredUnit) add("unit", "pass", measuredUnit === "count" ? "Both are whole counts." : "Both are percentages.");
  else add("unit", "fail", candidate.unit_kind === "count"
    ? `The planned value is a count of ${unitWord}; this result is ${counted}.`
    : `The planned value is a percentage; this result is a count of ${counted}.`);
  const measuredPeriod = recordedMeasurementPeriod(measurement);
  if (!candidate.period) add("period", "confirm", "The worksheet gives no exact period for this target.");
  else if (measuredPeriod === "all_dates") add("period", "fail", `This result covers all dates in its source, not ${candidate.period.start} to ${candidate.period.end}.`);
  else if (measuredPeriod === "outside") add("period", "fail", "This result counts records dated outside a reporting period.");
  else if (measuredPeriod.start === candidate.period.start && measuredPeriod.end === candidate.period.end) {
    // Which date puts a record in the period is part of the meaning: name the column.
    const column = measuredPeriod.field_key ? ` (the result applies it to column ${columnLetter(Number(measuredPeriod.field_key.slice(6)))})` : "";
    add("period", "pass", `Both cover ${candidate.period.start} to ${candidate.period.end}${column}.`);
  }
  else add("period", "fail", `This result covers ${measuredPeriod.start} to ${measuredPeriod.end}, not ${candidate.period.start} to ${candidate.period.end}.`);
  if (candidate.comparator) add("comparison", "pass", `The worksheet states the result should be ${candidate.comparator === "at_least" ? "at least" : "at most"} the planned value.`);
  else add("comparison", "confirm", "Whether the result should be at least or at most the planned value is not stated.");
  if (candidate.scope && !candidate.scope_applies_to_all) add("scope", "confirm", `The target applies to "${candidate.scope}" only; confirm the result measures the same part of the work.`);
  else if (!candidate.scope && candidate.limitations.some((item) => item.code === "scope_withheld")) add("scope", "confirm", "The target's programme or scope is withheld; confirm the result measures the same part of the work.");
  add("meaning", "confirm", `KAI cannot establish that ${candidate.indicator ? `"${candidate.indicator}"` : "this indicator"} counts the same thing as "${name}" (${counted}). Only your organization can confirm this.`);
  return {
    status: checks.some((check) => check.result === "fail") ? "not_comparable" : "confirmation_required",
    checks,
  };
}

/**
 * Recorded measurements that may relate to a candidate: same Project only, a
 * name sharing at least two words with the indicator (or the organization's
 * own indicator label equal to it), at most three, each with its checks.
 */
export function relatedRecordedMeasurements({ candidate, measurements, planningEngagementId, limit = 3 }) {
  if (!candidate.indicator) return [];
  const indicatorTerms = termsOf(candidate.indicator);
  const normalized = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return measurements
    .map((measurement) => {
      const { name } = recordedMeasurementName(measurement);
      const shared = [...termsOf(name)].filter((term) => indicatorTerms.has(term));
      const sameLabel = measurement.indicator_label && normalized(measurement.indicator_label) === normalized(candidate.indicator);
      return { measurement, name, shared, sameLabel };
    })
    .filter((entry) => entry.measurement.engagement_id === planningEngagementId && (entry.sameLabel || entry.shared.length >= 2))
    .sort((a, b) => Number(b.sameLabel) - Number(a.sameLabel) || b.shared.length - a.shared.length)
    .slice(0, limit)
    .map(({ measurement, name, shared, sameLabel }) => ({
      source_derived_measurement_id: measurement.source_derived_measurement_id,
      source_version_id: measurement.source_version_id,
      worksheet_key: measurement.worksheet_key ?? null,
      measurement_family: measurement.measurement_family,
      name,
      value_text: recordedValueText(measurement),
      proposed_because: sameLabel ? "same_indicator_label" : "shared_name_words",
      shared_words: shared,
      relationship: assessPlanningTargetRelationship({ candidate, measurement, planningEngagementId, measurementEngagementId: measurement.engagement_id }),
    }));
}

export const PLANNING_TARGET_PERSISTENCE = Object.freeze({
  available: false,
  reason: "target_source_provenance_not_storable",
  message: "Using a planned value from this worksheet as a result's target is not available yet: KAI cannot yet store a target together with the worksheet row it came from. Nothing on this worksheet has been saved.",
});
