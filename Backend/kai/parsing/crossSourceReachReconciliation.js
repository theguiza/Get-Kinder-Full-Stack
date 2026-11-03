/**
 * KAI cross-source linked reach: the deterministic reconciliation of one
 * service-event table with one participant register, from the records of
 * both CSV source versions. Pure. It runs only inside the reconciliation
 * worker (crossSourceReconciliationWorker.js), which alone holds the
 * verified bytes; its result holds counts and source row numbers only, never
 * an identifier, a date or any other cell value, so nothing downstream of
 * the worker can see or persist one.
 *
 * Method (kai_cross_source_linked_reach_v1), in order:
 * 1. Physical records: every row after the header with any value.
 * 2. Event identity: records sharing a trimmed event identifier are one
 *    event. When every copy agrees on the participant, status, date and
 *    group fields, the first is kept and the rest are excess copies; when
 *    the copies disagree, the identity is conflicting and excluded whole,
 *    never resolved by choosing a copy. Records without an identifier are
 *    excluded and counted.
 * 3. Completed events: the status equals the person-selected listed value.
 * 4. Reporting period: the event date (ISO YYYY-MM-DD, day precision) is
 *    within the inclusive period; completed events without a valid date and
 *    completed events outside it are excluded and counted separately.
 * 5. Roster linkage: the trimmed participant identifier equals a trimmed
 *    register identifier exactly. A blank identifier, and an identifier with
 *    no register match, are excluded from linked reach and counted; the
 *    event itself is not removed from anything.
 * 6. Eligible encounters are grouped by the person-selected listed values of
 *    the group field; each person is counted once organization-wide and once
 *    per group, and a person in more than one group is counted in each group
 *    and once overall.
 */

export const CROSS_SOURCE_REACH_METHOD = "kai_cross_source_linked_reach_v1";
export const CROSS_SOURCE_REACH_BASIS_VERSION = "kai_cross_source_reconciliation_v1";
const ISO_DAY_RE = /^(\d{4}-\d{2}-\d{2})(?:[Tt ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-][0-2]\d:?[0-5]\d)?)?$/;
const MAX_ROW_LOCATORS = 200;
export class CrossSourceDurationPrecisionError extends RangeError {}

function position(fieldKey) {
  return Number(String(fieldKey).slice("field_".length));
}

function cell(record, fieldKey) {
  const value = record.values[position(fieldKey) - 1];
  return typeof value === "string" ? value.trim() : "";
}

function isoDay(value) {
  const match = ISO_DAY_RE.exec(value);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === match[1] ? match[1] : null;
}

// Data records (header excluded) with their source row number.
function dataRecords(records) {
  return records.slice(1)
    .map((values, index) => ({ row: index + 2, values }))
    .filter((record) => record.values.some((value) => typeof value === "string" && value.trim().length > 0));
}

function rows(list) {
  return { count: list.length, rows: list.slice(0, MAX_ROW_LOCATORS), complete: list.length <= MAX_ROW_LOCATORS };
}

// Parse a non-negative decimal (including scientific notation) without
// floating-point rounding. Refuse a job whose precision is beyond the
// bounded representation; never silently classify an enormous number as a
// missing or invalid observation.
function decimalMinutes(value) {
  const match = /^\+?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  const digits = `${match[1] ?? "0"}${fraction}`;
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000 || digits.length > 1000) throw new CrossSourceDurationPrecisionError("duration numeric precision exceeds the supported bound");
  let scale = fraction.length - exponent;
  let units = BigInt(digits);
  if (scale < 0) {
    units *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { units, scale };
}

/**
 * `mapping` (validated against both committed profiles before the bytes are
 * read): events.{event_identifier_field_key, participant_identifier_field_key,
 * status_field_key, completed_value_label, date_field_key, group_field_key,
 * groups: [{ value_key, label }]}, register.participant_identifier_field_key,
 * and period.{start, end} (inclusive ISO days).
 */
export function reconcileLinkedReach({ eventRecords, registerRecords, mapping }) {
  const events = mapping.events;
  const registerKey = mapping.register.participant_identifier_field_key;
  const { start, end } = mapping.period;

  const register = dataRecords(registerRecords);
  const registerIds = new Map();
  let registerBlank = 0;
  for (const record of register) {
    const id = cell(record, registerKey);
    if (!id) registerBlank += 1;
    else registerIds.set(id, (registerIds.get(id) ?? 0) + 1);
  }

  const physical = dataRecords(eventRecords);
  const blankEventRows = [];
  const byIdentity = new Map();
  for (const record of physical) {
    const id = cell(record, events.event_identifier_field_key);
    if (!id) {
      blankEventRows.push(record.row);
      continue;
    }
    const copies = byIdentity.get(id) ?? [];
    copies.push(record);
    byIdentity.set(id, copies);
  }

  const mappedSignature = (record) => JSON.stringify([
    cell(record, events.participant_identifier_field_key),
    cell(record, events.status_field_key),
    cell(record, events.date_field_key),
    events.group_field_key ? cell(record, events.group_field_key) : "",
  ]);
  let duplicateGroups = 0;
  let duplicateMembers = 0;
  const excessRows = [];
  const conflictingRows = [];
  let conflictingIdentities = 0;
  const consistent = [];
  for (const copies of byIdentity.values()) {
    if (copies.length > 1) {
      duplicateGroups += 1;
      duplicateMembers += copies.length;
    }
    if (new Set(copies.map(mappedSignature)).size > 1) {
      conflictingIdentities += 1;
      conflictingRows.push(...copies.map((record) => record.row));
      continue;
    }
    excessRows.push(...copies.slice(1).map((record) => record.row));
    consistent.push(copies[0]);
  }

  const completed = consistent.filter((record) => cell(record, events.status_field_key) === events.completed_value_label);
  const withoutDateRows = [];
  const outsideRows = [];
  const inPeriod = [];
  for (const record of completed) {
    const day = isoDay(cell(record, events.date_field_key));
    if (day === null) withoutDateRows.push(record.row);
    else if (day < start || day > end) outsideRows.push(record.row);
    else inPeriod.push(record);
  }

  const blankParticipantRows = [];
  const unmatchedRows = [];
  const unmatchedIds = new Set();
  const eligible = [];
  for (const record of inPeriod) {
    const id = cell(record, events.participant_identifier_field_key);
    if (!id) blankParticipantRows.push(record.row);
    else if (!registerIds.has(id)) {
      unmatchedRows.push(record.row);
      unmatchedIds.add(id);
    } else eligible.push({ record, id });
  }

  const groupLabels = new Map((events.groups || []).map((group) => [group.label, group.value_key]));
  const groupCells = new Map((events.groups || []).map((group) => [group.value_key, { encounters: 0, people: new Set() }]));
  const groupsOfPerson = new Map();
  let ungrouped = 0;
  const people = new Set();
  const months = new Map();
  const duration = mapping.duration;
  let known = 0;
  let missing = 0;
  let invalid = 0;
  let units = 0n;
  let scale = 0;
  const durationInvalidRows = [];
  const durationMissingRows = [];
  for (const { record, id } of eligible) {
    people.add(id);
    if (mapping.monthly_activity || duration) {
      const month = isoDay(cell(record, events.date_field_key)).slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + 1);
    }
    if (duration) {
      const copies = byIdentity.get(cell(record, events.event_identifier_field_key));
      const values = copies.map((copy) => cell(copy, duration.field_key));
      const value = values[0];
      if (new Set(values).size > 1) {
        invalid += 1;
        durationInvalidRows.push(record.row);
      } else if (!value) {
        missing += 1;
        durationMissingRows.push(record.row);
      } else {
        const parsed = decimalMinutes(value);
        if (!parsed) {
          invalid += 1;
          durationInvalidRows.push(record.row);
        } else {
          const nextScale = Math.max(scale, parsed.scale);
          units = units * 10n ** BigInt(nextScale - scale) + parsed.units * 10n ** BigInt(nextScale - parsed.scale);
          scale = nextScale;
          known += 1;
        }
      }
    }
    if (!events.group_field_key) continue;
    const valueKey = groupLabels.get(cell(record, events.group_field_key));
    if (!valueKey) {
      ungrouped += 1;
      continue;
    }
    const groupCell = groupCells.get(valueKey);
    groupCell.encounters += 1;
    groupCell.people.add(id);
    const memberships = groupsOfPerson.get(id) ?? new Set();
    memberships.add(valueKey);
    groupsOfPerson.set(id, memberships);
  }

  const counts = {
    physical_record_count: physical.length,
    blank_event_identifier_record_count: blankEventRows.length,
    duplicate_group_count: duplicateGroups,
    duplicate_member_record_count: duplicateMembers,
    excess_copy_record_count: duplicateMembers - duplicateGroups,
    conflicting_event_identity_count: conflictingIdentities,
    conflicting_record_count: conflictingRows.length,
    distinct_event_count: byIdentity.size,
    consistent_event_count: consistent.length,
    completed_event_count: completed.length,
    completed_without_date_count: withoutDateRows.length,
    completed_outside_period_count: outsideRows.length,
    in_period_completed_event_count: inPeriod.length,
    blank_participant_identifier_event_count: blankParticipantRows.length,
    unmatched_event_count: unmatchedRows.length,
    unmatched_identity_count: unmatchedIds.size,
    eligible_encounter_count: eligible.length,
    distinct_person_count: people.size,
    multi_group_person_count: [...groupsOfPerson.values()].filter((memberships) => memberships.size > 1).length,
    ungrouped_encounter_count: ungrouped,
    register_record_count: register.length,
    register_distinct_identifier_count: registerIds.size,
    register_blank_identifier_record_count: registerBlank,
    register_repeated_identifier_count: [...registerIds.values()].filter((count) => count > 1).length,
  };
  let subtotal = units.toString().padStart(scale + 1, "0");
  if (scale) subtotal = `${subtotal.slice(0, -scale)}.${subtotal.slice(-scale)}`.replace(/0+$/, "").replace(/\.$/, "");
  return Object.freeze({
    counts: Object.freeze(counts),
    groups: Object.freeze((events.groups || []).map((group) => Object.freeze({
      value_key: group.value_key,
      label: group.label,
      encounter_count: groupCells.get(group.value_key).encounters,
      distinct_person_count: groupCells.get(group.value_key).people.size,
    }))),
    ...((mapping.monthly_activity || duration) ? {
      monthly_activity: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, encounter_count]) => ({ month, encounter_count })),
    } : {}),
    ...(duration ? {
      recorded_duration: { known_count: known, missing_count: missing, invalid_count: invalid, known_minutes: known ? subtotal : null, unit: "minutes" },
      duration_exclusions: { missing: rows(durationMissingRows), invalid_or_conflicting: rows(durationInvalidRows) },
    } : {}),
    row_exclusions: Object.freeze({
      excess_duplicate_copies: rows(excessRows),
      conflicting_event_identities: rows(conflictingRows),
      without_event_identifier: rows(blankEventRows),
      completed_without_date: rows(withoutDateRows),
      completed_outside_period: rows(outsideRows),
      without_participant_identifier: rows(blankParticipantRows),
      unmatched_participant_identifier: rows(unmatchedRows),
    }),
  });
}
