/**
 * KAI content-aware tabular measurement basis for one table (Measurement
 * MVP, Package B): a CSV file, or one worksheet of a workbook. The P1
 * profiler computes it from the values it already holds in memory for one
 * call. It never stores a header, an identifier value, a free-text value or
 * a row; it stores only governed aggregates a person needs to define a
 * measurement and KAI needs to calculate it exactly:
 *
 * - Field roles proposed from value shapes (never from header words):
 *   identifier (a code with letters and digits), categorical (at most
 *   MAX_CATEGORY_VALUES short letter-only labels) and date (ISO dates).
 * - Identifier fields: distinct, repeated-key and blank counts only.
 * - Categorical fields: the vocabulary (a label is kept only when at least
 *   MIN_CATEGORY_VALUE_RECORDS records carry it and the profile's
 *   metadata-only rule admits it) with record counts; the rest are withheld
 *   and counted. A label's shape and frequency never make it safe to keep:
 *   when the field's header (read here, never stored) names a person, a
 *   special-category or sensitive personal attribute, or free text, the whole
 *   vocabulary is withheld (VAL-INT-004: no unredacted personal value in a
 *   committed profile), as it is when any of its labels names such an
 *   attribute; the field can then be counted only as a whole.
 * - Exact-duplicate rows: groups, member records and excess copies, kept
 *   apart so neither is reported as "the" duplicate count.
 * - Dates are kept by calendar month only (YYYY-MM), never as a day, so no
 *   date value is stored and a date of birth cannot become a day-level
 *   distribution; a reporting period is applied by whole months.
 * - Joint aggregates, so a combined condition is calculated, not assumed
 *   from independent histograms: for each listed category value, its
 *   records, its distinct keys per identifier field, its records per value
 *   of every other categorical field, and its records and distinct keys per
 *   month of every date field; and per date field, records and distinct keys
 *   per month. A distinct count summed across months is exact only when
 *   every key has one month, which `single_valued_in` records per identifier
 *   field; otherwise the calculation is refused, never estimated.
 *
 * Values are compared exactly after trimming surrounding whitespace.
 */

export const TABULAR_MEASUREMENT_BASIS_VERSION = "kai_tabular_measurement_basis_v1";
export const MAX_CATEGORY_VALUES = 12;
export const MIN_CATEGORY_VALUE_RECORDS = 2;
const MAX_DATE_MONTHS = 1200;
const MAX_JOINT_ENTRIES = 50000;
const IDENTIFIER_RE = /^(?=[A-Za-z0-9_.-]*[A-Za-z])(?=[A-Za-z0-9_.-]*\d)[A-Za-z0-9][A-Za-z0-9_.-]{1,39}$/;
const CATEGORY_LABEL_RE = /^[A-Za-z][A-Za-z _'()&/-]{0,39}$/;
// The committed profile's metadata-only CHECK (kai.gate_a_p0_jsonb_metadata_only)
// refuses these words anywhere in a profile; a category label containing one
// is withheld from the vocabulary like any other unlisted value.
const METADATA_ONLY_REFUSED_RE = /(raw_bytes|raw_text|raw_content|prompt|signed_url|credential|secret|token|password|private_path|pii|email|phone|address)/i;
const ISO_DATE_RE = /^(\d{4}-\d{2}-\d{2})(?:[Tt ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-][0-2]\d:?[0-5]\d)?)?$/;
// Header words marking a field whose category values would describe a person
// rather than the organization's own operations: who someone is (names, the
// people who recorded or delivered a service), the P1-05 sensitivity
// dimensions (minor/age, health, housing, justice, immigration, Indigenous
// identity, finances) and the protected personal attributes, and free text.
const PERSONAL_ATTRIBUTE_HEADER_WORDS = new Set([
  "name", "names", "firstname", "lastname", "surname", "fullname", "nickname",
  "staff", "worker", "caseworker", "coach", "facilitator", "mentor", "counsellor", "counselor", "volunteer",
  "employee", "instructor", "trainer", "advisor", "adviser", "therapist", "clinician", "nurse", "doctor",
  "age", "birth", "dob", "birthdate", "birthday", "minor", "guardian",
  "gender", "sex", "pronoun", "pronouns", "ethnicity", "ethnic", "race", "racial", "religion", "religious", "faith",
  "disability", "disabilities", "disabled", "health", "medical", "diagnosis", "illness", "medication", "mental",
  "sexual", "orientation", "lgbtq", "marital", "pregnancy", "pregnant",
  "immigration", "citizenship", "refugee", "newcomer", "nationality",
  "criminal", "justice", "offence", "offense", "conviction", "probation", "parole",
  "housing", "homeless", "homelessness", "shelter",
  "indigenous", "aboriginal", "metis", "inuit",
  "income", "salary", "wage", "wages", "welfare", "debt",
  "note", "notes", "comment", "comments", "description", "story", "quote", "testimonial", "feedback", "narrative", "remark", "remarks",
]);
// Value words that make a vocabulary a special-category or sensitive personal
// attribute whatever its header: one such label withholds the whole field,
// because its other labels (for example "Citizen" beside "Refugee") describe
// the same attribute.
const SENSITIVE_CATEGORY_VALUE_WORDS = new Set([
  "refugee", "refugees", "asylum", "immigrant", "immigrants", "newcomer", "newcomers", "undocumented",
  "disabled", "disability", "homeless", "unhoused", "shelter",
  "female", "male", "nonbinary", "transgender", "gay", "lesbian", "bisexual", "queer", "lgbtq",
  "muslim", "christian", "jewish", "hindu", "sikh", "buddhist",
  "indigenous", "aboriginal", "metis", "inuit",
  "hiv", "diabetes", "cancer", "depression", "anxiety", "addiction", "pregnant",
  "convicted", "incarcerated", "probation", "parole", "welfare",
]);
// A header ending in "by" (recorded by, entered by, referred by) names a person.
const PERSON_ROLE_HEADER_SUFFIX = "by";
// Operational one-word labels a vocabulary may hold in any case. A label's
// shape, frequency or low cardinality never makes it safe: a capitalized
// single word ("Maria") or a run of capitalized words ("Maria Lopez") is how a
// personal name looks under any header, so outside this list it withholds the
// whole field, and so does a vocabulary made only of plain lower-case words
// none of which is listed here (names written in lower case look the same).
// Sentence-case descriptions ("Started paid work"), snake_case codes
// ("no_show") and upper-case codes ("DS") are kept.
const OPERATIONAL_CATEGORY_WORDS = new Set([
  "yes", "no", "unknown", "none", "other", "true", "false", "na",
  "completed", "complete", "incomplete", "cancelled", "canceled", "pending", "active", "inactive", "exited",
  "open", "closed", "scheduled", "attended", "missed", "declined", "accepted", "rejected", "approved",
  "withdrawn", "enrolled", "waitlisted", "answered", "unanswered", "responded", "partial", "full",
  "baseline", "followup", "intake", "exit", "online", "virtual", "remote", "hybrid", "group", "individual",
  "new", "returning", "low", "medium", "high", "draft", "final", "current", "former", "internal", "external",
  "done", "dropped", "finished", "started", "ongoing", "paused", "suspended", "referred", "passed", "failed",
  "present", "absent", "late", "excused", "noshow", "booked", "confirmed", "rescheduled", "expired", "valid", "invalid",
]);
const TITLE_CASE_WORD_RE = /^[A-Z][a-z]+$/;
const LOWER_CASE_WORD_RE = /^[a-z]+$/;

function labelWords(label) {
  return String(label).split(/[ _'()&/-]+/).filter(Boolean);
}

/**
 * Why a category vocabulary may not be listed, or null. Shared by the
 * profiler (what a new profile commits) and by every reader of a committed
 * profile's labels (what an existing profile may still expose), so a label
 * admitted under an earlier rule is withheld the same way. One sensitive or
 * name-shaped label withholds the whole field: its other labels describe the
 * same attribute. `wholeVocabulary: false` screens labels already selected
 * from a vocabulary (a recorded measurement's), where the all-lower-case
 * vocabulary rule cannot be judged.
 */
export function categoryVocabularyWithheldReason(labels, { wholeVocabulary = true } = {}) {
  const list = [...labels].map(String);
  if (list.some((label) => headerWords(label).some((word) => SENSITIVE_CATEGORY_VALUE_WORDS.has(word)))) return "sensitive_category_value";
  const nameShaped = (label) => {
    const words = labelWords(label);
    const titled = words.filter((word) => TITLE_CASE_WORD_RE.test(word));
    if (words.length === 1) return titled.length === 1 && !OPERATIONAL_CATEGORY_WORDS.has(words[0].toLowerCase());
    return titled.length >= 2;
  };
  if (list.some(nameShaped)) return "ambiguous_category_value";
  if (wholeVocabulary && list.length > 0 && list.every((label) => LOWER_CASE_WORD_RE.test(label)) && !list.some((label) => OPERATIONAL_CATEGORY_WORDS.has(label))) {
    return "ambiguous_category_value";
  }
  return null;
}
// Worksheet cell types whose stored value is text (CSV values are all text).
const TEXT_CELL_TYPES = new Set(["s", "inlineStr", "str", "text"]);

function fieldKey(position) {
  return `field_${position}`;
}

// The calendar month (YYYY-MM) of an ISO date cell, or null.
function isoMonth(cell) {
  if (!cell?.present || !TEXT_CELL_TYPES.has(cell.type)) return null;
  const match = ISO_DATE_RE.exec(cell.value.trim());
  if (!match) return null;
  const parsed = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === match[1] ? match[1].slice(0, 7) : null;
}

function notAssessed(reason) {
  return Object.freeze({ basis_version: TABULAR_MEASUREMENT_BASIS_VERSION, status: "not_assessed", reason });
}

function increment(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function addKey(map, key, value) {
  const set = map.get(key) ?? new Set();
  set.add(value);
  map.set(key, set);
}

// The header's words: split on every non-letter and on lower-to-upper case changes.
function headerWords(header) {
  return String(header ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
}

/** Whether a header names a personal or free-text attribute, so its values may not be kept. */
export function headerIndicatesPersonalAttribute(header) {
  const words = headerWords(header);
  return words.some((word) => PERSONAL_ATTRIBUTE_HEADER_WORDS.has(word))
    || (words.length > 1 && words[words.length - 1] === PERSON_ROLE_HEADER_SUFFIX);
}

function classifyField(records, position, header) {
  const values = [];
  let blank = 0;
  for (const record of records) {
    const cell = record.cells.get(position);
    if (cell?.present) values.push(cell);
    else blank += 1;
  }
  const result = { field_key: fieldKey(position), present_count: values.length, blank_count: blank, roles: [] };
  if (values.length < 2) return result;
  const months = values.map(isoMonth);
  const dated = months.filter(Boolean).length;
  if (dated * 10 >= values.length * 9) {
    result.roles.push("date");
    const sorted = months.filter(Boolean).sort();
    result.date = { date_count: dated, non_date_count: values.length - dated, earliest_month: sorted[0], latest_month: sorted[sorted.length - 1] };
    return result;
  }
  const texts = values.map((cell) => (TEXT_CELL_TYPES.has(cell.type) ? cell.value.trim() : null));
  if (texts.every((text) => text !== null && IDENTIFIER_RE.test(text))) {
    const counts = new Map();
    for (const text of texts) increment(counts, text);
    const repeated = [...counts.values()].filter((count) => count > 1);
    if (counts.size > MAX_CATEGORY_VALUES || counts.size * 2 > values.length) {
      result.roles.push("identifier");
      result.identifier = {
        distinct_count: counts.size,
        repeated_key_count: repeated.length,
        records_in_repeated_keys: repeated.reduce((total, count) => total + count, 0),
        records_beyond_first_per_key: values.length - counts.size,
      };
    }
    return result;
  }
  if (texts.every((text) => text !== null && CATEGORY_LABEL_RE.test(text))) {
    const counts = new Map();
    for (const text of texts) increment(counts, text);
    if (counts.size <= MAX_CATEGORY_VALUES && counts.size * 2 <= values.length) {
      if (headerIndicatesPersonalAttribute(header)) {
        result.roles.push("categorical");
        result.categorical = { values: [], withheld_record_count: values.length, vocabulary_withheld: "personal_attribute_field" };
        return result;
      }
      const withheld = categoryVocabularyWithheldReason(counts.keys());
      if (withheld) {
        result.roles.push("categorical");
        result.categorical = { values: [], withheld_record_count: values.length, vocabulary_withheld: withheld };
        return result;
      }
      const listed = [...counts.entries()]
        .filter(([label, count]) => count >= MIN_CATEGORY_VALUE_RECORDS && !METADATA_ONLY_REFUSED_RE.test(label))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      result.roles.push("categorical");
      result.categorical = {
        values: listed.map(([label, count], index) => ({ value_key: `value_${index + 1}`, label, record_count: count })),
        withheld_record_count: values.length - listed.reduce((total, [, count]) => total + count, 0),
      };
    }
  }
  return result;
}

function freezeDeep(value) {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freezeDeep(item);
    Object.freeze(value);
  }
  return value;
}

/**
 * The basis of one table: `rows` maps a source row number to a map of column
 * number to { type, value, present }. Row `headerRow` is the header; data
 * records are the rows after it through `lastRow`, and a record with no
 * value is blank and excluded, exactly as the record-count basis excludes it.
 * `established` is false when the record-count basis does not establish one
 * unambiguous table; nothing is then calculated.
 */
export function summarizeTabularMeasurementBasis({ rows, headerRow = 1, lastRow, columnCount, established }) {
  if (established !== true) return notAssessed("table_not_established");
  const records = [];
  for (let rowIndex = headerRow + 1; rowIndex <= lastRow; rowIndex += 1) {
    const cells = rows.get(rowIndex) ?? new Map();
    if ([...cells.values()].some((cell) => cell.present)) records.push({ row: rowIndex, cells });
  }
  if (records.length === 0 || columnCount < 1) return notAssessed("no_data_records");

  const headerCells = rows.get(headerRow) ?? new Map();
  const headerOf = (position) => {
    const cell = headerCells.get(position);
    return cell?.present ? String(cell.value).replace(/^\uFEFF/, "") : "";
  };
  const fields = Array.from({ length: columnCount }, (_, index) => classifyField(records, index + 1, headerOf(index + 1)));
  const identifiers = fields.filter((field) => field.roles.includes("identifier"));
  const categoricals = fields.filter((field) => field.roles.includes("categorical"));
  const dates = fields.filter((field) => field.roles.includes("date"));
  const position = (field) => Number(field.field_key.slice("field_".length));
  const cellText = (record, field) => {
    const cell = record.cells.get(position(field));
    return cell?.present ? cell.value.trim() : null;
  };
  const valueKeyOf = (field) => new Map(field.categorical.values.map((entry) => [entry.label, entry.value_key]));
  const valueKeys = new Map(categoricals.map((field) => [field.field_key, valueKeyOf(field)]));

  // Exact duplicates over every column's trimmed value.
  const signatures = new Map();
  for (const record of records) {
    increment(signatures, JSON.stringify(Array.from({ length: columnCount }, (_, index) => {
      const cell = record.cells.get(index + 1);
      return cell?.present ? cell.value.trim() : "";
    })));
  }
  const groups = [...signatures.values()].filter((count) => count > 1);

  // Whether every key of an identifier field has one value of each other field.
  const keyValues = new Map(identifiers.map((field) => [field.field_key, new Map()]));
  const tooLarge = () => notAssessed("joint_aggregates_exceed_limit");
  let jointEntries = 0;

  const categoryCells = new Map();
  for (const field of categoricals) {
    categoryCells.set(field.field_key, new Map(field.categorical.values.map((entry) => [entry.value_key, {
      records: 0,
      keys: new Map(),
      byCategory: new Map(),
      byDate: new Map(),
    }])));
  }
  const dateCells = new Map(dates.map((field) => [field.field_key, new Map()]));

  for (const record of records) {
    const recordKeys = identifiers.map((field) => [field.field_key, cellText(record, field)]).filter(([, key]) => key !== null);
    for (const [idKey, key] of recordKeys) {
      const perKey = keyValues.get(idKey);
      const seen = perKey.get(key) ?? new Map();
      for (const other of [...categoricals, ...dates]) {
        addKey(seen, other.field_key, other.roles.includes("date") ? (isoMonth(record.cells.get(position(other))) ?? "") : (cellText(record, other) ?? ""));
      }
      perKey.set(key, seen);
    }
    const recordMonths = dates.map((field) => [field.field_key, isoMonth(record.cells.get(position(field)))]).filter(([, month]) => month !== null);
    for (const [dateKey, month] of recordMonths) {
      const perMonth = dateCells.get(dateKey);
      const cell = perMonth.get(month) ?? { records: 0, keys: new Map() };
      cell.records += 1;
      for (const [idKey, key] of recordKeys) addKey(cell.keys, idKey, key);
      perMonth.set(month, cell);
    }
    for (const field of categoricals) {
      const valueKey = valueKeys.get(field.field_key).get(cellText(record, field));
      if (!valueKey) continue;
      const cell = categoryCells.get(field.field_key).get(valueKey);
      cell.records += 1;
      for (const [idKey, key] of recordKeys) addKey(cell.keys, idKey, key);
      for (const other of categoricals) {
        if (other === field) continue;
        const otherValue = valueKeys.get(other.field_key).get(cellText(record, other));
        if (!otherValue) continue;
        const perOther = cell.byCategory.get(other.field_key) ?? new Map();
        increment(perOther, otherValue);
        cell.byCategory.set(other.field_key, perOther);
      }
      for (const [dateKey, month] of recordMonths) {
        const perMonth = cell.byDate.get(dateKey) ?? new Map();
        const monthCell = perMonth.get(month) ?? { records: 0, keys: new Map() };
        monthCell.records += 1;
        for (const [idKey, key] of recordKeys) addKey(monthCell.keys, idKey, key);
        perMonth.set(month, monthCell);
        cell.byDate.set(dateKey, perMonth);
      }
    }
  }

  const distinctCounts = (keys) => Object.fromEntries(identifiers.map((field) => [field.field_key, keys.get(field.field_key)?.size ?? 0]));
  const monthEntries = (perMonth) => {
    if (perMonth.size > MAX_DATE_MONTHS) return null;
    jointEntries += perMonth.size;
    return [...perMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, cell]) => [month, cell.records, distinctCounts(cell.keys)]);
  };

  const categoryJoint = {};
  for (const [catKey, cells] of categoryCells) {
    categoryJoint[catKey] = {};
    for (const [valueKey, cell] of cells) {
      const byDate = {};
      for (const [dateKey, perMonth] of cell.byDate) {
        const entries = monthEntries(perMonth);
        if (entries === null) return tooLarge();
        byDate[dateKey] = entries;
      }
      categoryJoint[catKey][valueKey] = {
        records: cell.records,
        distinct: distinctCounts(cell.keys),
        by_category: Object.fromEntries([...cell.byCategory.entries()].map(([other, counts]) => [other, Object.fromEntries(counts)])),
        by_date: byDate,
      };
    }
  }
  const dateJoint = {};
  for (const [dateKey, perMonth] of dateCells) {
    const entries = monthEntries(perMonth);
    if (entries === null) return tooLarge();
    dateJoint[dateKey] = entries;
  }
  if (jointEntries > MAX_JOINT_ENTRIES) return tooLarge();

  const singleValuedIn = {};
  for (const field of identifiers) {
    const perKey = keyValues.get(field.field_key);
    singleValuedIn[field.field_key] = [...categoricals, ...dates]
      .map((other) => other.field_key)
      .filter((otherKey) => [...perKey.values()].every((seen) => (seen.get(otherKey)?.size ?? 0) <= 1))
      .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  }

  return freezeDeep({
    basis_version: TABULAR_MEASUREMENT_BASIS_VERSION,
    status: "assessed",
    record_count: records.length,
    exact_duplicates: {
      group_count: groups.length,
      member_record_count: groups.reduce((total, count) => total + count, 0),
      excess_copy_count: groups.reduce((total, count) => total + count - 1, 0),
    },
    fields,
    category_cells: categoryJoint,
    date_cells: dateJoint,
    single_valued_in: singleValuedIn,
  });
}

/** CSV records (header first) as the row map the basis reads. */
export function csvRecordsAsRows(records) {
  const rows = new Map();
  records.forEach((record, index) => {
    rows.set(index + 1, new Map(record.map((value, column) => [column + 1, { type: "text", value, present: value.trim().length > 0 }])));
  });
  return rows;
}
