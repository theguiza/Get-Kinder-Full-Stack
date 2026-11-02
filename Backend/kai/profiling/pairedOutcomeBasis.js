/**
 * KAI paired baseline/follow-up outcome basis for one worksheet (Measurement
 * MVP). The P1 profiler computes it from the cells it already holds in memory
 * for one call, beside the record-count basis. It stores no header text and
 * no cell value: only field keys, worksheet row numbers, and counts.
 *
 * What it does:
 * - Proposes the participant identifier, stage (baseline/follow-up) and
 *   instrument-version fields, and the numeric outcome fields, from header
 *   words and value shapes. These are proposals for a person to confirm or
 *   correct; nothing is inferred as fact.
 * - When more than one field could play a role, it computes every
 *   combination (bounded). It chooses none, so a person can select one
 *   without re-reading the file.
 * - Pairs one baseline with one follow-up observation of the same participant
 *   (and the same instrument version, when a version field exists). It counts
 *   numerically higher, equal and lower follow-up values per outcome field,
 *   using one calculation for every field. Whether higher is better is never
 *   decided here.
 * - Records every participant who is not paired, with its reason. A missing
 *   value excludes the participant only from that field's measurement; a
 *   repeated or version-mismatched observation is never paired by guesswork.
 */

export const PAIRED_OUTCOME_BASIS_VERSION = "kai_xlsx_paired_outcome_basis_v1";
export const PAIRED_OUTCOME_CALCULATION_METHOD = "p1_xlsx_paired_baseline_followup_numeric_change_v1";
export const MAX_PAIRED_OUTCOME_LOCATOR_ROWS = 1000;
const MAX_ROLE_ALTERNATIVES = 8;

// Participant-level reasons, per outcome field, in reporting order.
export const PAIRED_OUTCOME_EXCLUSION_REASONS = Object.freeze([
  "no_baseline_observation",
  "no_followup_observation",
  "instrument_version_mismatch",
  "multiple_observations_ambiguous",
  "missing_baseline_value",
  "missing_followup_value",
  "missing_baseline_and_followup_value",
  "non_numeric_value",
]);
// Row-level reasons: the row is not an observation of any outcome field.
export const PAIRED_OUTCOME_ROW_EXCLUSION_REASONS = Object.freeze([
  "exact_duplicate_row",
  "missing_participant_identifier",
  "stage_not_classified",
  "instrument_version_missing",
]);

const PERSON_TOKENS = new Set([
  "participant", "client", "person", "member", "student", "learner", "respondent", "individual",
  "customer", "patient", "attendee", "youth", "beneficiary",
]);
const IDENTIFIER_TOKENS = new Set(["id", "identifier", "code", "number", "no", "ref", "reference", "key"]);
const VERSION_TOKENS = new Set(["version", "ver"]);
const SCORE_TOKENS = new Set(["score", "scores", "rating", "rated", "scale", "index", "points", "level"]);
const BASELINE_STAGE_VALUES = new Set(["baseline", "base", "pre", "pretest", "preassessment", "presurvey", "intake", "entry", "initial"]);
const FOLLOWUP_STAGE_VALUES = new Set(["followup", "post", "posttest", "postassessment", "postsurvey", "exit", "final"]);
const NUMBER_RE = /^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i;
const NON_NUMERIC_CELL_TYPES = new Set(["b", "e", "d"]);

function fieldKey(position) {
  return `field_${position}`;
}

function columnLetter(position) {
  let name = "";
  for (let n = position; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function headerTokens(text) {
  return String(text).normalize("NFKC").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function hasAny(tokens, vocabulary) {
  return tokens.some((token) => vocabulary.has(token));
}

function stageClass(cell) {
  if (!cell?.present) return null;
  const normalized = cell.value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (BASELINE_STAGE_VALUES.has(normalized)) return "baseline";
  if (FOLLOWUP_STAGE_VALUES.has(normalized)) return "followup";
  return null;
}

function numericValue(cell) {
  if (!cell?.present) return { kind: "missing" };
  const trimmed = cell.value.trim();
  if (NON_NUMERIC_CELL_TYPES.has(cell.type) || !NUMBER_RE.test(trimmed)) return { kind: "non_numeric" };
  const value = Number(trimmed);
  return Number.isFinite(value) ? { kind: "number", value } : { kind: "non_numeric" };
}

function presentCells(records, position) {
  return records.map((record) => record.cells.get(position)).filter((cell) => cell?.present);
}

function isStageColumn(records, position) {
  const present = presentCells(records, position);
  const classes = present.map(stageClass);
  const baseline = classes.filter((value) => value === "baseline").length;
  const followup = classes.filter((value) => value === "followup").length;
  return baseline > 0 && followup > 0 && (baseline + followup) * 2 >= present.length;
}

function isNumericColumn(records, position) {
  const present = presentCells(records, position);
  const numeric = present.filter((cell) => numericValue(cell).kind === "number").length;
  return numeric > 0 && numeric * 10 >= present.length * 9;
}

function sortedRows(rows) {
  const unique = [...new Set(rows)].sort((a, b) => a - b);
  return unique.slice(0, MAX_PAIRED_OUTCOME_LOCATOR_ROWS);
}

function notAssessed(status, reason, candidates = null) {
  return Object.freeze({ basis_version: PAIRED_OUTCOME_BASIS_VERSION, status, reason, candidates, alternatives: Object.freeze([]) });
}

function tableIsEstablished(basis) {
  return basis?.header_row_established === true
    && ["formula_cell_count", "merged_range_count", "hidden_row_count", "hidden_column_count", "values_outside_header_columns_count", "unresolved_value_count"]
      .every((key) => basis[key] === 0);
}

// Observations grouped by participant, stage and instrument version; rows
// that cannot be an observation are recorded with their reason.
function groupObservations(records, { participant, stage, version }, columnCount) {
  const rowExclusions = new Map();
  const exclude = (reason, row) => rowExclusions.set(reason, [...(rowExclusions.get(reason) ?? []), row]);
  const signatures = new Set();
  const participants = new Map();
  let observationCount = 0;
  for (const record of records) {
    const signature = JSON.stringify(Array.from({ length: columnCount }, (_, index) => {
      const cell = record.cells.get(index + 1);
      return cell?.present ? cell.value : "";
    }));
    if (signatures.has(signature)) {
      exclude("exact_duplicate_row", record.row);
      continue;
    }
    signatures.add(signature);
    const idCell = record.cells.get(participant);
    if (!idCell?.present) {
      exclude("missing_participant_identifier", record.row);
      continue;
    }
    const stageKey = stageClass(record.cells.get(stage));
    if (!stageKey) {
      exclude("stage_not_classified", record.row);
      continue;
    }
    let versionKey = "";
    if (version !== null) {
      const versionCell = record.cells.get(version);
      if (!versionCell?.present) {
        exclude("instrument_version_missing", record.row);
        continue;
      }
      versionKey = versionCell.value.trim();
    }
    const id = idCell.value.trim();
    const stages = participants.get(id) ?? { baseline: new Map(), followup: new Map(), rows: [] };
    stages[stageKey].set(versionKey, [...(stages[stageKey].get(versionKey) ?? []), record]);
    stages.rows.push(record.row);
    participants.set(id, stages);
    observationCount += 1;
  }
  return { participants, rowExclusions, observationCount };
}

// The one comparable baseline/follow-up pair of a participant, or why there
// is none. It does not depend on any outcome value, so it is the same for
// every outcome field.
function participantPair(stages) {
  if (stages.baseline.size === 0) return { reason: "no_baseline_observation" };
  if (stages.followup.size === 0) return { reason: "no_followup_observation" };
  const versions = [...stages.baseline.keys()].filter((version) => stages.followup.has(version));
  if (versions.length === 0) return { reason: "instrument_version_mismatch" };
  if (versions.length > 1) return { reason: "multiple_observations_ambiguous" };
  const baseline = stages.baseline.get(versions[0]);
  const followup = stages.followup.get(versions[0]);
  if (baseline.length !== 1 || followup.length !== 1) return { reason: "multiple_observations_ambiguous" };
  return { baseline: baseline[0], followup: followup[0] };
}

/**
 * The paired numeric change of one outcome field: the same calculation for
 * every field. Only the field's own values decide whether a participant's
 * pair is comparable for it; the denominator is the comparable pairs only.
 */
export function calculatePairedOutcome({ participants }, outcomePosition) {
  const exclusions = new Map();
  const pairs = [];
  let increased = 0;
  let unchanged = 0;
  let decreased = 0;
  const exclude = (reason, rows) => {
    const entry = exclusions.get(reason) ?? { participant_count: 0, rows: [] };
    entry.participant_count += 1;
    entry.rows.push(...rows);
    exclusions.set(reason, entry);
  };
  for (const stages of participants.values()) {
    const pair = participantPair(stages);
    if (pair.reason) {
      exclude(pair.reason, stages.rows);
      continue;
    }
    const before = numericValue(pair.baseline.cells.get(outcomePosition));
    const after = numericValue(pair.followup.cells.get(outcomePosition));
    const rows = [pair.baseline.row, pair.followup.row];
    if (before.kind === "missing" && after.kind === "missing") exclude("missing_baseline_and_followup_value", rows);
    else if (before.kind === "missing") exclude("missing_baseline_value", rows);
    else if (after.kind === "missing") exclude("missing_followup_value", rows);
    else if (before.kind !== "number" || after.kind !== "number") exclude("non_numeric_value", rows);
    else {
      if (after.value > before.value) increased += 1;
      else if (after.value < before.value) decreased += 1;
      else unchanged += 1;
      pairs.push([pair.baseline.row, pair.followup.row]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const exclusionList = PAIRED_OUTCOME_EXCLUSION_REASONS.filter((reason) => exclusions.has(reason)).map((reason) => Object.freeze({
    reason,
    participant_count: exclusions.get(reason).participant_count,
    rows: Object.freeze(sortedRows(exclusions.get(reason).rows)),
  }));
  const locatorsComplete = pairs.length <= MAX_PAIRED_OUTCOME_LOCATOR_ROWS
    && [...exclusions.values()].every((entry) => new Set(entry.rows).size <= MAX_PAIRED_OUTCOME_LOCATOR_ROWS);
  return Object.freeze({
    outcome_field_key: fieldKey(outcomePosition),
    outcome_column: columnLetter(outcomePosition),
    proposed_role: "numeric_outcome_score",
    calculation_method: PAIRED_OUTCOME_CALCULATION_METHOD,
    participant_count: participants.size,
    comparable_pair_count: pairs.length,
    increased_count: increased,
    unchanged_count: unchanged,
    decreased_count: decreased,
    comparable_pairs: Object.freeze(pairs.slice(0, MAX_PAIRED_OUTCOME_LOCATOR_ROWS).map((pair) => Object.freeze(pair))),
    exclusions: Object.freeze(exclusionList),
    locators_complete: locatorsComplete,
  });
}

/**
 * The worksheet's paired-outcome basis, or why it has none. `rows` is the
 * profiler's in-memory worksheet table; `recordCountBasis` is the same
 * worksheet's committed record-count basis, which decides whether row 1 is a
 * header row and the worksheet is one unambiguous table.
 */
export function summarizePairedOutcomeBasis({ rows, recordCountBasis }) {
  if (!tableIsEstablished(recordCountBasis)) return notAssessed("not_assessable", "worksheet_table_not_established");
  const headerRow = rows.get(1) ?? new Map();
  const headers = [...headerRow.entries()]
    .filter(([, cell]) => cell.present)
    .sort(([a], [b]) => a - b)
    .map(([position, cell]) => ({ position, tokens: headerTokens(cell.value) }));
  const columnCount = headers.reduce((maximum, header) => Math.max(maximum, header.position), 0);
  const records = [];
  for (let row = 2; row <= recordCountBasis.data_record_count + 1; row += 1) {
    const cells = rows.get(row) ?? new Map();
    if ([...cells.values()].some((cell) => cell.present)) records.push({ row, cells });
  }

  const participant = headers.filter((header) => hasAny(header.tokens, PERSON_TOKENS) && hasAny(header.tokens, IDENTIFIER_TOKENS)).map((header) => header.position);
  const version = headers.filter((header) => !participant.includes(header.position) && hasAny(header.tokens, VERSION_TOKENS)).map((header) => header.position);
  const stage = headers.filter((header) => !participant.includes(header.position) && !version.includes(header.position) && isStageColumn(records, header.position))
    .map((header) => header.position);
  const roles = new Set([...participant, ...version, ...stage]);
  const outcomes = headers.filter((header) => !roles.has(header.position) && hasAny(header.tokens, SCORE_TOKENS) && isNumericColumn(records, header.position))
    .map((header) => header.position);
  const candidates = Object.freeze({
    participant_identifier: Object.freeze(participant.map(fieldKey)),
    stage: Object.freeze(stage.map(fieldKey)),
    instrument_version: Object.freeze(version.map(fieldKey)),
    numeric_outcome: Object.freeze(outcomes.map(fieldKey)),
  });
  if (participant.length === 0) return notAssessed("no_candidate", "participant_identifier_not_found", candidates);
  if (stage.length === 0) return notAssessed("no_candidate", "baseline_followup_stage_not_found", candidates);
  if (outcomes.length === 0) return notAssessed("no_candidate", "numeric_outcome_field_not_found", candidates);
  const versionOptions = version.length > 0 ? version : [null];
  if (participant.length * stage.length * versionOptions.length > MAX_ROLE_ALTERNATIVES) {
    return notAssessed("not_assessable", "role_candidates_exceed_limit", candidates);
  }

  const alternatives = [];
  for (const participantPosition of participant) {
    for (const stagePosition of stage) {
      for (const versionPosition of versionOptions) {
        const grouped = groupObservations(records, { participant: participantPosition, stage: stagePosition, version: versionPosition }, columnCount);
        alternatives.push(Object.freeze({
          participant_field_key: fieldKey(participantPosition),
          stage_field_key: fieldKey(stagePosition),
          instrument_version_field_key: versionPosition === null ? null : fieldKey(versionPosition),
          comparability_rule: versionPosition === null ? "same_participant_instrument_version_not_recorded" : "same_participant_same_instrument_version",
          observation_count: grouped.observationCount,
          row_exclusions: Object.freeze(PAIRED_OUTCOME_ROW_EXCLUSION_REASONS.filter((reason) => grouped.rowExclusions.has(reason)).map((reason) => Object.freeze({
            reason,
            row_count: grouped.rowExclusions.get(reason).length,
            rows: Object.freeze(sortedRows(grouped.rowExclusions.get(reason))),
          }))),
          measurements: Object.freeze(outcomes.map((position) => calculatePairedOutcome(grouped, position))),
        }));
      }
    }
  }
  return Object.freeze({
    basis_version: PAIRED_OUTCOME_BASIS_VERSION,
    status: alternatives.length === 1 ? "proposed" : "role_selection_required",
    reason: null,
    candidates,
    alternatives: Object.freeze(alternatives),
  });
}
