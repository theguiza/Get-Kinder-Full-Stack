import { cell, dataRecords, isoDay, rows } from "./crossSourceReachReconciliation.js";

/**
 * KAI single-source service-event reconciliation: the deterministic record-
 * level calculation of one service-record table (a CSV, or one worksheet of a
 * workbook), from the records of that one source version. Pure. It runs only
 * inside the reconciliation worker (crossSourceReconciliationWorker.js),
 * which alone holds the verified bytes; its result holds counts, the listed
 * category labels the committed profile already holds and source row numbers
 * only - never an identifier, a date or any other cell value.
 *
 * No participant register is needed or read. It uses the same record and
 * identity rules as the linked-reach reconciliation, without its roster step:
 *
 * 1. Physical records: every row after the header with any value.
 * 2. Event identity: records sharing a trimmed encounter identifier are one
 *    event. Copies that agree on every material field (each mapped role and
 *    every other field the profile lists as an identifier, category or date)
 *    are one event whose excess copies are counted once; copies that disagree
 *    on any material field make the identity conflicting and it is excluded
 *    whole, never resolved by choosing a copy. Which material roles disagreed
 *    is counted. Records without an identifier are excluded and counted. With
 *    no encounter identifier role, each record is its own identity (a record
 *    count, never called distinct encounters).
 * 3. Completed events: the status equals the established completed value.
 * 4. Eligibility: only when a person confirmed an eligibility field and the
 *    value that includes a record; other completed events are excluded and
 *    counted.
 * 5. Reporting period: the service date (ISO YYYY-MM-DD, day precision) is
 *    within the inclusive Project period; events without a valid date and
 *    events outside it are excluded and counted separately. Without a period
 *    every eligible completed event is in scope (all dates).
 * 6. In-scope events are tabulated by the listed programme and activity
 *    values from the actual record intersections (never from independent
 *    marginals), by service month, and - with an entity identifier - by
 *    distinct entity overall and per programme.
 */

export const SERVICE_EVENTS_FAMILY = "service_events";
export const SERVICE_EVENTS_METHOD = "kai_single_source_service_events_v1";
export const SERVICE_EVENTS_BASIS_VERSION = "kai_service_event_records_v1";
export const SERVICE_DUPLICATE_POLICY = "consistent_copies_counted_once_conflicting_identities_excluded";
export const SERVICE_CONFLICT_ROLES = Object.freeze(["status", "service_date", "programme", "activity", "entity_identifier", "eligibility", "other"]);

// The heading words service-field discovery may use. Only words in this list
// ever leave the worker: a heading is reduced to the listed words it contains,
// so a name or free text in a heading is never returned or stored.
export const SERVICE_HEADING_VOCABULARY = Object.freeze(new Set([
  "id", "identifier", "number", "no", "num", "ref", "reference", "key", "code",
  "event", "events", "encounter", "encounters", "visit", "visits", "attendance", "attendances", "appointment", "appointments", "session", "sessions",
  "household", "households", "family", "families", "person", "people", "individual", "client", "clients", "participant", "participants",
  "member", "members", "patient", "student", "customer", "resident", "attendee", "beneficiary",
  "status", "outcome", "result", "state", "attended", "delivery", "delivered", "completion", "completed",
  "date", "day", "dated", "service", "services", "activity", "activities", "type", "kind", "category",
  "program", "programme", "programs", "programmes", "stream",
  "record", "entry", "row",
  "eligible", "eligibility", "include", "included", "inclusion", "exclude", "excluded", "exclusion", "valid", "validity", "void", "test", "countable", "reportable",
  "use", "consent", "consented", "authorized", "authorised", "authorization", "authorisation", "permission", "permitted", "share", "sharing",
  "disclose", "disclosure", "external", "publish", "publication",
  "birth", "dob", "born", "age",
]));

/** The vocabulary words a heading contains, in order of first appearance (nothing else). */
export function serviceHeadingTerms(heading) {
  const words = String(heading ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return [...new Set(words.filter((word) => SERVICE_HEADING_VOCABULARY.has(word)))];
}

/**
 * `plan` (resolved from the discovery and validated before any byte is read):
 * encounter_identifier_field_key (or null: each record is its own identity),
 * status_field_key, completed_value_label, status_values [{value_key, label}],
 * service_date_field_key (or null), period {start, end} (or null),
 * programme / activity {field_key, values: [{value_key, label}]} (or null),
 * entity_identifier_field_key (or null), eligibility {field_key,
 * included_value_label} (or null), material_field_keys, monthly (boolean).
 */
export function reconcileServiceEvents({ records, plan }) {
  const physical = dataRecords(records);
  const idKey = plan.encounter_identifier_field_key ?? null;
  const roleKeys = {
    status: plan.status_field_key,
    service_date: plan.service_date_field_key ?? null,
    programme: plan.programme?.field_key ?? null,
    activity: plan.activity?.field_key ?? null,
    entity_identifier: plan.entity_identifier_field_key ?? null,
    eligibility: plan.eligibility?.field_key ?? null,
  };
  const roleFieldKeys = new Set([idKey, ...Object.values(roleKeys)].filter(Boolean));
  const otherMaterial = (plan.material_field_keys || []).filter((key) => !roleFieldKeys.has(key));

  const blankIdRows = [];
  const byIdentity = new Map();
  for (const record of physical) {
    const id = idKey ? cell(record, idKey) : `row:${record.row}`;
    if (!id) {
      blankIdRows.push(record.row);
      continue;
    }
    const copies = byIdentity.get(id) ?? [];
    copies.push(record);
    byIdentity.set(id, copies);
  }

  const conflictFields = Object.fromEntries(SERVICE_CONFLICT_ROLES.map((role) => [role, 0]));
  let duplicateGroups = 0;
  let duplicateMembers = 0;
  let copiesWithOtherDifferences = 0;
  let conflictingIdentities = 0;
  const excessRows = [];
  const conflictingRows = [];
  const consistent = [];
  for (const copies of byIdentity.values()) {
    if (copies.length > 1) {
      duplicateGroups += 1;
      duplicateMembers += copies.length;
      const differs = (key) => new Set(copies.map((record) => cell(record, key))).size > 1;
      const roles = Object.entries(roleKeys).filter(([, key]) => key && differs(key)).map(([role]) => role);
      if (otherMaterial.some(differs)) roles.push("other");
      if (roles.length > 0) {
        conflictingIdentities += 1;
        for (const role of roles) conflictFields[role] += 1;
        conflictingRows.push(...copies.map((record) => record.row));
        continue;
      }
      const width = Math.max(...copies.map((record) => record.values.length));
      const whole = (record) => JSON.stringify(Array.from({ length: width }, (_, index) => (typeof record.values[index] === "string" ? record.values[index].trim() : "")));
      if (new Set(copies.map(whole)).size > 1) copiesWithOtherDifferences += 1;
      excessRows.push(...copies.slice(1).map((record) => record.row));
    }
    consistent.push(copies[0]);
  }

  const statusLabels = new Map((plan.status_values || []).map((value) => [value.label, value.value_key]));
  const statusTable = new Map((plan.status_values || []).map((value) => [value.value_key, 0]));
  let unlistedStatus = 0;
  for (const record of consistent) {
    const key = statusLabels.get(cell(record, plan.status_field_key));
    if (key) statusTable.set(key, statusTable.get(key) + 1);
    else unlistedStatus += 1;
  }
  const completedStatusRecords = physical.filter((record) => cell(record, plan.status_field_key) === plan.completed_value_label).length;
  const completed = consistent.filter((record) => cell(record, plan.status_field_key) === plan.completed_value_label);

  const eligibilityExcludedRows = [];
  const eligibleCompleted = [];
  for (const record of completed) {
    if (plan.eligibility && cell(record, plan.eligibility.field_key) !== plan.eligibility.included_value_label) eligibilityExcludedRows.push(record.row);
    else eligibleCompleted.push(record);
  }

  const withoutDateRows = [];
  const outsideRows = [];
  const inScope = [];
  for (const record of eligibleCompleted) {
    if (!plan.period) {
      inScope.push(record);
      continue;
    }
    const day = isoDay(cell(record, plan.service_date_field_key));
    if (day === null) withoutDateRows.push(record.row);
    else if (day < plan.period.start || day > plan.period.end) outsideRows.push(record.row);
    else inScope.push(record);
  }

  const tabulate = (role) => {
    if (!role) return null;
    const labels = new Map(role.values.map((value) => [value.label, value.value_key]));
    const cells = new Map(role.values.map((value) => [value.value_key, { encounters: 0, entities: new Set() }]));
    return { labels, cells, ungrouped: 0 };
  };
  const programme = tabulate(plan.programme);
  const activity = tabulate(plan.activity);
  const pairCells = new Map();
  const entityKey = roleKeys.entity_identifier;
  const entities = new Set();
  const programmesOfEntity = new Map();
  const blankEntityRows = [];
  const months = new Map();
  for (const record of inScope) {
    const entity = entityKey ? cell(record, entityKey) : "";
    if (entityKey) {
      if (entity) entities.add(entity);
      else blankEntityRows.push(record.row);
    }
    if (plan.monthly && plan.period) {
      const month = isoDay(cell(record, plan.service_date_field_key)).slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + 1);
    }
    let programmeKey = null;
    for (const [table, role] of [[programme, plan.programme], [activity, plan.activity]]) {
      if (!table) continue;
      const valueKey = table.labels.get(cell(record, role.field_key));
      if (!valueKey) {
        table.ungrouped += 1;
        continue;
      }
      const groupCell = table.cells.get(valueKey);
      groupCell.encounters += 1;
      if (entity) groupCell.entities.add(entity);
      if (table === programme) {
        programmeKey = valueKey;
        if (entity) {
          const memberships = programmesOfEntity.get(entity) ?? new Set();
          memberships.add(valueKey);
          programmesOfEntity.set(entity, memberships);
        }
      } else if (programmeKey) {
        const pair = `${programmeKey}|${valueKey}`;
        pairCells.set(pair, (pairCells.get(pair) ?? 0) + 1);
      }
    }
  }

  const groupTable = (table, role) => (table ? role.values.map((value) => ({
    value_key: value.value_key,
    label: value.label,
    encounter_count: table.cells.get(value.value_key).encounters,
    ...(entityKey ? { distinct_entity_count: table.cells.get(value.value_key).entities.size } : {}),
  })) : []);
  const counts = {
    physical_record_count: physical.length,
    blank_event_identifier_record_count: blankIdRows.length,
    duplicate_group_count: duplicateGroups,
    duplicate_member_record_count: duplicateMembers,
    excess_copy_record_count: duplicateMembers - duplicateGroups,
    consistent_copy_group_with_other_differences_count: copiesWithOtherDifferences,
    conflicting_event_identity_count: conflictingIdentities,
    conflicting_record_count: conflictingRows.length,
    conflict_fields: conflictFields,
    distinct_event_count: byIdentity.size,
    consistent_event_count: consistent.length,
    completed_status_record_count: completedStatusRecords,
    completed_event_count: completed.length,
    not_completed_event_count: consistent.length - completed.length,
    eligibility_excluded_event_count: eligibilityExcludedRows.length,
    eligible_completed_event_count: eligibleCompleted.length,
    completed_without_date_count: withoutDateRows.length,
    completed_outside_period_count: outsideRows.length,
    eligible_encounter_count: inScope.length,
    blank_entity_identifier_event_count: blankEntityRows.length,
    distinct_entity_count: entities.size,
    multi_programme_entity_count: [...programmesOfEntity.values()].filter((memberships) => memberships.size > 1).length,
    ungrouped_programme_encounter_count: programme ? programme.ungrouped : 0,
    ungrouped_activity_encounter_count: activity ? activity.ungrouped : 0,
    status_values: (plan.status_values || []).map((value) => ({ value_key: value.value_key, label: value.label, event_count: statusTable.get(value.value_key) })),
    unlisted_status_event_count: unlistedStatus,
    groups: groupTable(programme, plan.programme),
    activities: groupTable(activity, plan.activity),
    programme_activity: programme && activity
      ? plan.programme.values.flatMap((p) => plan.activity.values.map((a) => ({ programme_value_key: p.value_key, activity_value_key: a.value_key, encounter_count: pairCells.get(`${p.value_key}|${a.value_key}`) ?? 0 })))
        .filter((pair) => pair.encounter_count > 0)
      : [],
    ...(plan.monthly && plan.period ? {
      monthly_activity: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, encounter_count]) => ({ month, encounter_count })),
    } : {}),
  };
  return Object.freeze({
    counts: Object.freeze(counts),
    row_exclusions: Object.freeze({
      excess_duplicate_copies: rows(excessRows),
      conflicting_event_identities: rows(conflictingRows),
      without_event_identifier: rows(blankIdRows),
      not_eligible: rows(eligibilityExcludedRows),
      completed_without_date: rows(withoutDateRows),
      completed_outside_period: rows(outsideRows),
      without_entity_identifier: rows(blankEntityRows),
    }),
  });
}
