import {
  PAIRED_OUTCOME_BASIS_VERSION,
  PAIRED_OUTCOME_CALCULATION_METHOD,
  PAIRED_OUTCOME_EXCLUSION_REASONS,
} from "../profiling/pairedOutcomeBasis.js";
import { __measurementDefinitionTextRules, validateComposedStatement } from "./kaiSourceMeasurementValidators.js";

const { LABEL_RE, isSafeRuleText, isCalendarDate, MAX_RULE_LENGTH } = __measurementDefinitionTextRules;

/**
 * KAI Measurement MVP: paired baseline/follow-up outcome measurements, derived
 * only from the committed P1 paired-outcome basis of the exact profile bound
 * to a promoted source version (no raw file read, no model). Every numeric
 * outcome field the basis proposes is measured by the same rules. A
 * measurement that cannot be stated is unavailable on its own; the others
 * stay available.
 *
 * A numeric increase is not an improvement. A measurement says "improved"
 * only when a person's definition states the field's scoring direction;
 * otherwise it reports the numeric change and proposes the meaning for
 * correction. KAI never sets a direction or a reporting period itself.
 */

export const PAIRED_OUTCOME_MEASUREMENT_TYPE = "paired_baseline_followup_change";
export const PAIRED_OUTCOME_VALIDATOR_KEY = "VAL-KAI-MVP-PAIRED-001";
export const PAIRED_OUTCOME_SCORE_DIRECTIONS = Object.freeze(["higher_is_better", "lower_is_better", "not_established"]);
const SHEET_KEY_RE = /^sheet_[1-9][0-9]{0,3}$/;
const FIELD_KEY_RE = /^field_[1-9][0-9]{0,3}$/;
const ROLE_KEYS = Object.freeze({
  participant_field_key: "participantFieldKey",
  stage_field_key: "stageFieldKey",
  instrument_version_field_key: "instrumentVersionFieldKey",
});
const DEFINITION_KEYS = Object.freeze([
  "outcome_field_key",
  "indicator_label",
  "definition_text",
  "score_direction",
  ...Object.keys(ROLE_KEYS),
  "period_start",
  "period_end",
]);
const REQUIRED_DEFINITION_KEYS = Object.freeze(["outcome_field_key", "indicator_label", "definition_text", "score_direction"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function blocker(blockingReason, message, requiredFix, { objectType = "source_version", objectId = null } = {}) {
  return {
    validator_key: PAIRED_OUTCOME_VALIDATOR_KEY,
    severity: "blocker",
    object_type: objectType,
    object_code: "derive_paired_outcome_measurement",
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

/**
 * A person's definition of one proposed outcome field: what it measures and
 * whether a higher or lower score is better ("not_established" records the
 * meaning without a direction). The participant, stage and version fields
 * may be named to confirm or select among KAI's proposed pairings. The
 * reporting period is optional and, when given, a real range.
 */
export function validatePairedOutcomeDefinition(definition) {
  if (!isPlainObject(definition)) {
    return refuse("paired_outcome_definition_required", "An outcome definition must be an object.", "Send the documented definition fields.", { objectType: "paired_outcome_definition" });
  }
  if (!Object.keys(definition).every((key) => DEFINITION_KEYS.includes(key))) {
    return refuse("paired_outcome_definition_unknown_field", "The outcome definition has an unsupported field.", "Send only the documented definition fields.", { objectType: "paired_outcome_definition" });
  }
  const missing = REQUIRED_DEFINITION_KEYS.filter((key) => typeof definition[key] !== "string" || definition[key].trim().length === 0);
  if (missing.length > 0) {
    return refuse(
      "paired_outcome_definition_incomplete",
      "The outcome definition does not say which field it defines, what the field measures, or whether a higher score is better.",
      `Provide a non-empty value for: ${missing.join(", ")}.`,
      { objectType: "paired_outcome_definition" },
    );
  }
  if (!FIELD_KEY_RE.test(definition.outcome_field_key)) {
    return refuse("paired_outcome_definition_field_invalid", "The outcome field must be a profiled field key.", "Use a field key such as field_6.", { objectType: "paired_outcome_definition" });
  }
  if (!LABEL_RE.test(definition.indicator_label)) {
    return refuse(
      "paired_outcome_definition_label_invalid",
      "The indicator label must be a short plain-text label.",
      "Use letters, digits, spaces, apostrophes, hyphens, or parentheses (at most 80 characters, starting with a letter).",
      { objectType: "paired_outcome_definition" },
    );
  }
  if (!isSafeRuleText(definition.definition_text)) {
    return refuse(
      "paired_outcome_definition_text_invalid",
      "The outcome definition text is not acceptable plain text.",
      `Provide definition_text as plain text of at most ${MAX_RULE_LENGTH} characters, without links, paths, or credentials.`,
      { objectType: "paired_outcome_definition" },
    );
  }
  if (!PAIRED_OUTCOME_SCORE_DIRECTIONS.includes(definition.score_direction)) {
    return refuse(
      "paired_outcome_definition_direction_invalid",
      "The scoring direction must be higher_is_better, lower_is_better, or not_established.",
      "State whether a higher score is better, a lower score is better, or that this is not established.",
      { objectType: "paired_outcome_definition" },
    );
  }
  const roles = {};
  for (const [key, normalizedKey] of Object.entries(ROLE_KEYS)) {
    if (!Object.hasOwn(definition, key)) continue;
    const value = definition[key];
    const nullable = key === "instrument_version_field_key";
    if (!(FIELD_KEY_RE.test(value ?? "") || (nullable && value === null))) {
      return refuse("paired_outcome_definition_field_invalid", `The ${key} must be a profiled field key.`, "Use a field key such as field_2.", { objectType: "paired_outcome_definition" });
    }
    roles[normalizedKey] = value;
  }
  const periodStart = definition.period_start ?? null;
  const periodEnd = definition.period_end ?? null;
  if ((periodStart === null) !== (periodEnd === null)) {
    return refuse("paired_outcome_period_incomplete", "A reporting period needs both a start and an end date.", "Provide both period_start and period_end, or neither.", { objectType: "paired_outcome_definition" });
  }
  if (periodStart !== null && (!isCalendarDate(periodStart) || !isCalendarDate(periodEnd) || periodEnd < periodStart)) {
    return refuse("paired_outcome_period_invalid", "The reporting period is not a valid date range.", "Use YYYY-MM-DD dates with period_end on or after period_start.", { objectType: "paired_outcome_definition" });
  }
  return {
    ok: true,
    definition: Object.freeze({
      outcomeFieldKey: definition.outcome_field_key,
      indicatorLabel: definition.indicator_label,
      definitionText: definition.definition_text,
      scoreDirection: definition.score_direction,
      roles: Object.freeze(roles),
      periodStart,
      periodEnd,
    }),
  };
}

export const PAIRED_OUTCOME_LIMITATION_CODES = Object.freeze({
  MATCHED_SUBSET_ONLY: "paired.matched_comparable_subset_only",
  DIRECTION_UNRESOLVED: "paired.numeric_change_direction_unresolved",
  DIRECTION_HUMAN_DEFINED: "paired.score_direction_human_defined",
  MEANING_PROPOSED: "paired.indicator_meaning_proposed",
  MEANING_HUMAN_DEFINED: "paired.indicator_meaning_human_defined",
  ROLES_PROPOSED: "paired.pairing_fields_proposed",
  VERSION_NOT_RECORDED: "paired.instrument_version_not_recorded",
  PARTICIPANTS_EXCLUDED: "paired.participants_excluded",
  NO_REPORTING_PERIOD: "paired.no_reporting_period",
  PERIOD_HUMAN_ATTESTED: "paired.period_human_attested_not_row_verified",
  LOCATORS_INCOMPLETE: "paired.locators_incomplete",
});

const PAIRED_OUTCOME_LIMITATION_DESCRIPTIONS = Object.freeze({
  [PAIRED_OUTCOME_LIMITATION_CODES.MATCHED_SUBSET_ONLY]:
    "The result covers only participants with a comparable baseline and follow-up value; it is not a result for everyone enrolled or assessed.",
  [PAIRED_OUTCOME_LIMITATION_CODES.DIRECTION_UNRESOLVED]:
    "Whether a higher score is better has not been defined, so the result is a numeric change, not an improvement.",
  [PAIRED_OUTCOME_LIMITATION_CODES.DIRECTION_HUMAN_DEFINED]:
    "Whether a higher or lower score is better was defined by a person at the organization; KAI did not verify the instrument's scoring.",
  [PAIRED_OUTCOME_LIMITATION_CODES.MEANING_PROPOSED]:
    "What the field measures is KAI's proposal from the worksheet structure; no person has defined it yet.",
  [PAIRED_OUTCOME_LIMITATION_CODES.MEANING_HUMAN_DEFINED]:
    "What the field measures was defined by a person at the organization; KAI did not verify it.",
  [PAIRED_OUTCOME_LIMITATION_CODES.ROLES_PROPOSED]:
    "The participant, stage and instrument-version fields used for pairing were proposed by KAI from the worksheet structure.",
  [PAIRED_OUTCOME_LIMITATION_CODES.VERSION_NOT_RECORDED]:
    "The worksheet records no instrument version, so pairs were not checked for a changed instrument.",
  [PAIRED_OUTCOME_LIMITATION_CODES.PARTICIPANTS_EXCLUDED]:
    "Some participants are not comparable for this field and are excluded; each exclusion and its reason is recorded.",
  [PAIRED_OUTCOME_LIMITATION_CODES.NO_REPORTING_PERIOD]: "No reporting period was defined for the measurement.",
  [PAIRED_OUTCOME_LIMITATION_CODES.PERIOD_HUMAN_ATTESTED]:
    "The reporting period was stated in the definition; it was not checked against dates in the records.",
  [PAIRED_OUTCOME_LIMITATION_CODES.LOCATORS_INCOMPLETE]:
    "The worksheet has more rows than KAI keeps locators for; the counts cover every row, the row list does not.",
});

/** The plain-language description of a paired. limitation code, or null. */
export function describePairedOutcomeLimitationCode(code) {
  return PAIRED_OUTCOME_LIMITATION_DESCRIPTIONS[code] ?? null;
}

function worksheetFor(profile, selectedWorksheetKey) {
  if (!isPlainObject(profile) || profile.status !== "profiled" || profile.format !== "xlsx") {
    return refuse(
      "paired_outcome_source_not_workbook",
      "Paired baseline/follow-up measurements are available only for a profiled Excel workbook.",
      "Use an Excel workbook whose baseline and follow-up observations are rows of one worksheet.",
    );
  }
  const sheets = profile.sheets;
  if (!Array.isArray(sheets) || sheets.length === 0 || profile.counts?.sheet_count !== sheets.length) {
    return refuse("paired_outcome_worksheet_profile_invalid", "The workbook does not have a complete committed worksheet profile.", "Upload the workbook again so KAI can profile each worksheet.");
  }
  if (sheets.length > 1 && !SHEET_KEY_RE.test(selectedWorksheetKey ?? "")) {
    return refuse("paired_outcome_worksheet_selection_required", "Choose one worksheet to measure. KAI never combines worksheets.", "Select the worksheet that holds the baseline and follow-up observations.");
  }
  const sheet = sheets.length === 1 && selectedWorksheetKey === null
    ? sheets[0]
    : sheets.find((candidate) => candidate.sheet_key === selectedWorksheetKey);
  if (!sheet) return refuse("paired_outcome_worksheet_selection_invalid", "The selected worksheet is not part of this workbook profile.", "Select one of the listed worksheets.");
  return { ok: true, sheet };
}

const BASIS_STATUS_REFUSALS = Object.freeze({
  worksheet_table_not_established: "The worksheet is not one table with a header row, so its observations cannot be paired.",
  participant_identifier_not_found: "KAI found no field that identifies the same participant across observations.",
  baseline_followup_stage_not_found: "KAI found no field that marks observations as baseline or follow-up.",
  numeric_outcome_field_not_found: "KAI found no numeric score or rating field to compare.",
  role_candidates_exceed_limit: "Too many fields could identify participants, stages or instrument versions to propose a pairing.",
});

function selectAlternative(alternatives, definitions) {
  const selectors = definitions.filter((definition) => Object.keys(definition.roles).length > 0);
  const matches = (alternative, roles) => Object.entries(ROLE_KEYS).every(([key, normalizedKey]) => !Object.hasOwn(roles, normalizedKey) || alternative[key] === roles[normalizedKey]);
  for (const selector of selectors) {
    if (!alternatives.some((alternative) => matches(alternative, selector.roles))) {
      return refuse(
        "paired_outcome_pairing_not_proposed",
        "The named participant, stage or instrument-version fields are not a pairing KAI proposed for this worksheet.",
        "Name fields from one of the proposed pairings. A different pairing needs a corrected workbook uploaded as a new intake version.",
        { objectType: "paired_outcome_definition" },
      );
    }
  }
  const remaining = alternatives.filter((alternative) => selectors.every((selector) => matches(alternative, selector.roles)));
  if (remaining.length === 0) {
    return refuse(
      "paired_outcome_pairing_conflict",
      "The outcome definitions name different pairings for the same worksheet.",
      "Name the same participant, stage and instrument-version fields in every definition.",
      { objectType: "paired_outcome_definition" },
    );
  }
  return { ok: true, alternative: remaining.length === 1 ? remaining[0] : null, humanSelected: selectors.length > 0 };
}

function measurementCountsConsistent(entry) {
  const exclusions = Array.isArray(entry?.exclusions) ? entry.exclusions : null;
  return isPlainObject(entry)
    && entry.calculation_method === PAIRED_OUTCOME_CALCULATION_METHOD
    && FIELD_KEY_RE.test(entry.outcome_field_key ?? "")
    && [entry.participant_count, entry.comparable_pair_count, entry.increased_count, entry.unchanged_count, entry.decreased_count].every(isCount)
    && entry.comparable_pair_count === entry.increased_count + entry.unchanged_count + entry.decreased_count
    && exclusions !== null
    && exclusions.every((exclusion) => PAIRED_OUTCOME_EXCLUSION_REASONS.includes(exclusion?.reason) && isCount(exclusion.participant_count) && exclusion.participant_count > 0)
    && entry.participant_count === entry.comparable_pair_count + exclusions.reduce((total, exclusion) => total + exclusion.participant_count, 0)
    && Array.isArray(entry.comparable_pairs)
    && (entry.locators_complete !== true || entry.comparable_pairs.length === entry.comparable_pair_count);
}

function formatRate(numerator, denominator) {
  return denominator > 0 ? (numerator * 100 / denominator).toFixed(2) : null;
}

function periodPhrase(measurement) {
  return measurement.periodStart ? `for the reporting period ${measurement.periodStart} to ${measurement.periodEnd}` : "with no reporting period defined";
}

/**
 * Evidence statement of one paired measurement, composed only from its
 * counts, field, worksheet and definition. Without a human direction it
 * states a numeric change and that a direction is not established.
 */
export function composePairedOutcomeEvidenceStatement(measurement) {
  const subject = measurement.interpretation.indicatorLabel
    ? `${measurement.interpretation.indicatorLabel} (${measurement.outcomeFieldKey}, column ${measurement.outcomeColumn})`
    : `Numeric outcome ${measurement.outcomeFieldKey} (column ${measurement.outcomeColumn})`;
  const { increasedCount: up, unchangedCount: same, decreasedCount: down, denominator, rate } = measurement;
  const rateText = rate === null ? "" : ` (${rate}%)`;
  const change = measurement.scoreDirection === "higher_is_better"
    ? `${up} of ${denominator} comparable participant pairs${rateText} improved to a higher follow-up score, the organization defining higher as better; ${same} unchanged and ${down} lower`
    : measurement.scoreDirection === "lower_is_better"
      ? `${down} of ${denominator} comparable participant pairs${rateText} improved to a lower follow-up score, the organization defining lower as better; ${same} unchanged and ${up} higher`
      : `${up} of ${denominator} comparable participant pairs${rateText} have a numerically higher follow-up value, ${same} the same and ${down} lower; whether higher is better is not established`;
  const rule = measurement.instrumentVersionFieldKey ? "the same participant and instrument version" : "the same participant (no instrument version recorded)";
  return `${subject}, baseline to follow-up in worksheet ${measurement.sheetKey} ${periodPhrase(measurement)}: ${change}. `
    + `Each pair needs ${rule}; ${measurement.excludedParticipantCount} of ${measurement.participantCount} participants are excluded as not comparable.`;
}

function limitationCodes({ entry, definition, humanSelectedRoles, instrumentVersionFieldKey }) {
  const codes = [PAIRED_OUTCOME_LIMITATION_CODES.MATCHED_SUBSET_ONLY];
  const direction = definition?.scoreDirection;
  codes.push(direction === "higher_is_better" || direction === "lower_is_better"
    ? PAIRED_OUTCOME_LIMITATION_CODES.DIRECTION_HUMAN_DEFINED
    : PAIRED_OUTCOME_LIMITATION_CODES.DIRECTION_UNRESOLVED);
  codes.push(definition ? PAIRED_OUTCOME_LIMITATION_CODES.MEANING_HUMAN_DEFINED : PAIRED_OUTCOME_LIMITATION_CODES.MEANING_PROPOSED);
  if (!humanSelectedRoles) codes.push(PAIRED_OUTCOME_LIMITATION_CODES.ROLES_PROPOSED);
  if (instrumentVersionFieldKey === null) codes.push(PAIRED_OUTCOME_LIMITATION_CODES.VERSION_NOT_RECORDED);
  if (entry.exclusions.length > 0) codes.push(PAIRED_OUTCOME_LIMITATION_CODES.PARTICIPANTS_EXCLUDED);
  codes.push(definition?.periodStart ? PAIRED_OUTCOME_LIMITATION_CODES.PERIOD_HUMAN_ATTESTED : PAIRED_OUTCOME_LIMITATION_CODES.NO_REPORTING_PERIOD);
  if (entry.locators_complete !== true) codes.push(PAIRED_OUTCOME_LIMITATION_CODES.LOCATORS_INCOMPLETE);
  return Object.freeze(codes.sort());
}

function buildMeasurement({ entry, sheet, alternative, definition, humanSelectedRoles }) {
  if (!measurementCountsConsistent(entry)) {
    return Object.freeze({
      available: false,
      outcomeFieldKey: FIELD_KEY_RE.test(entry?.outcome_field_key ?? "") ? entry.outcome_field_key : null,
      blockers: Object.freeze([blocker("paired_outcome_counts_inconsistent", "The committed paired-outcome counts for this field are inconsistent.", "Upload the workbook again as a new intake version.")]),
    });
  }
  const scoreDirection = definition?.scoreDirection ?? "unresolved";
  const improvedCount = scoreDirection === "higher_is_better" ? entry.increased_count : scoreDirection === "lower_is_better" ? entry.decreased_count : null;
  const numerator = improvedCount ?? entry.increased_count;
  const column = entry.outcome_column;
  const measurement = {
    available: true,
    measurementType: PAIRED_OUTCOME_MEASUREMENT_TYPE,
    calculationMethod: entry.calculation_method,
    sheetKey: sheet.sheet_key,
    sheetName: sheet.safe_sheet_name ?? `Worksheet ${sheet.sheet_key.replace("sheet_", "")}`,
    outcomeFieldKey: entry.outcome_field_key,
    outcomeColumn: column,
    participantFieldKey: alternative.participant_field_key,
    stageFieldKey: alternative.stage_field_key,
    instrumentVersionFieldKey: alternative.instrument_version_field_key,
    comparabilityRule: alternative.comparability_rule,
    participantCount: entry.participant_count,
    excludedParticipantCount: entry.participant_count - entry.comparable_pair_count,
    increasedCount: entry.increased_count,
    unchangedCount: entry.unchanged_count,
    decreasedCount: entry.decreased_count,
    numerator,
    numeratorMeaning: improvedCount === null ? "numeric_increase" : "improvement",
    denominator: entry.comparable_pair_count,
    rate: formatRate(numerator, entry.comparable_pair_count),
    rateUnit: "percent",
    scoreDirection,
    interpretation: Object.freeze(definition
      ? {
          status: "human_defined",
          indicatorLabel: definition.indicatorLabel,
          definitionText: definition.definitionText,
          scoreDirection,
        }
      : {
          status: "proposed",
          indicatorLabel: null,
          proposedRole: entry.proposed_role,
          scoreDirection,
          correction: "A person at the organization defines what this field measures and whether a higher score is better.",
        }),
    periodStart: definition?.periodStart ?? null,
    periodEnd: definition?.periodEnd ?? null,
    exclusions: Object.freeze(entry.exclusions.map((exclusion) => Object.freeze({
      reason: exclusion.reason,
      participantCount: exclusion.participant_count,
      rows: exclusion.rows,
    }))),
    rowExclusions: Object.freeze(alternative.row_exclusions.map((exclusion) => Object.freeze({
      reason: exclusion.reason,
      rowCount: exclusion.row_count,
      rows: exclusion.rows,
    }))),
    cellLocators: Object.freeze(entry.comparable_pairs.map(([baselineRow, followupRow]) => Object.freeze({
      baseline: `${column}${baselineRow}`,
      followup: `${column}${followupRow}`,
    }))),
    locatorsComplete: entry.locators_complete === true,
    limitationCodes: limitationCodes({ entry, definition, humanSelectedRoles, instrumentVersionFieldKey: alternative.instrument_version_field_key }),
  };
  const statement = composePairedOutcomeEvidenceStatement(measurement);
  const composable = validateComposedStatement(statement);
  if (!composable.ok) {
    return Object.freeze({
      available: false,
      outcomeFieldKey: entry.outcome_field_key,
      blockers: Object.freeze([blocker(
        "paired_outcome_statement_not_composable",
        "The measurement cannot be stated within the evidence statement limits.",
        "Shorten the indicator label.",
      )]),
    });
  }
  return Object.freeze({ ...measurement, evidenceStatement: statement });
}

/**
 * The paired measurements of one worksheet from a committed profile, with any
 * person's definitions applied. Pairing fields, when KAI proposed more than
 * one combination, must be selected by a definition; until then no
 * measurement is available and the proposed pairings are returned.
 */
export function derivePairedOutcomeMeasurements(profile, selectedWorksheetKey = null, { definitions = [] } = {}) {
  const worksheet = worksheetFor(profile, selectedWorksheetKey);
  if (!worksheet.ok) return worksheet;
  const { sheet } = worksheet;
  const basis = sheet.paired_outcome_basis;
  if (!isPlainObject(basis) || basis.basis_version !== PAIRED_OUTCOME_BASIS_VERSION) {
    return refuse(
      "paired_outcome_basis_not_committed",
      "This workbook was profiled before KAI proposed paired outcome measurements.",
      "In Files, choose the same workbook again and select \"Upload again as a new intake version\".",
    );
  }
  if (basis.status !== "proposed" && basis.status !== "role_selection_required") {
    return refuse(
      `paired_outcome_${basis.reason ?? "not_available"}`,
      BASIS_STATUS_REFUSALS[basis.reason] ?? "This worksheet has no paired outcome measurement.",
      "Select the worksheet whose rows are baseline and follow-up observations of the same participants.",
    );
  }
  const byField = new Map();
  for (const definition of definitions) {
    if (byField.has(definition.outcomeFieldKey)) {
      return refuse("paired_outcome_definition_duplicate", "Two definitions name the same outcome field.", "Send one definition per outcome field.", { objectType: "paired_outcome_definition" });
    }
    byField.set(definition.outcomeFieldKey, definition);
  }
  const proposedFields = new Set(basis.candidates?.numeric_outcome ?? []);
  const unproposed = [...byField.keys()].filter((key) => !proposedFields.has(key));
  if (unproposed.length > 0) {
    return refuse(
      "paired_outcome_field_not_proposed",
      `KAI did not propose ${unproposed.join(", ")} as a numeric outcome field of this worksheet.`,
      "Define one of the proposed outcome fields.",
      { objectType: "paired_outcome_definition" },
    );
  }
  const selection = selectAlternative(basis.alternatives ?? [], definitions);
  if (!selection.ok) return selection;
  const pairings = Object.freeze((basis.alternatives ?? []).map((alternative) => Object.freeze({
    participantFieldKey: alternative.participant_field_key,
    stageFieldKey: alternative.stage_field_key,
    instrumentVersionFieldKey: alternative.instrument_version_field_key,
  })));
  const common = {
    worksheet: Object.freeze({ sheetKey: sheet.sheet_key, sheetName: sheet.safe_sheet_name ?? null }),
    candidates: basis.candidates,
    proposedPairings: pairings,
  };
  if (!selection.alternative) {
    return { ok: true, status: "pairing_selection_required", ...common, measurements: Object.freeze([]) };
  }
  return {
    ok: true,
    status: "available",
    ...common,
    measurements: Object.freeze(selection.alternative.measurements.map((entry) => buildMeasurement({
      entry,
      sheet,
      alternative: selection.alternative,
      definition: byField.get(entry?.outcome_field_key) ?? null,
      humanSelectedRoles: selection.humanSelected,
    }))),
  };
}
