import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { profileLocalTrustedFile } from "../Backend/kai/profiling/localProfilingKernel.js";
import { createCrossSourceReconciliationWorker } from "../Backend/kai/parsing/crossSourceReconciliationWorker.js";
import { readServiceEventMeasurements, serviceEventTableBasis } from "../Backend/kai/dictionary/serviceEventMeasurementRead.js";
import { validateServiceRoleSelections } from "../Backend/kai/validators/kaiServiceEventMeasurements.js";
import {
  DERIVED_MEASUREMENT_FAMILIES,
  SCHEMA_ADMITTED_DERIVED_METHODS,
  SERVICE_EVENT_METRICS,
  applyDerivedMeasurementCoverageDimensions,
  composeDerivedMeasurementDisclosure,
  composeDerivedMeasurementEvidenceStatement,
  derivedMeasurementArithmeticHolds,
  derivedMeasurementLabelsAdmitted,
  derivedMeasurementLimitationCodes,
  derivedContributingSourcesCurrent,
  validateDerivedMeasurementClaimBasis,
} from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import { serviceTargetSuggestions, relatedRecordedMeasurements } from "../Backend/kai/validators/kaiPlanningTargetCandidates.js";
import { validatePlannedTargetDecision } from "../Backend/kai/validators/kaiSourcePlannedTargets.js";
import { composeImpactFindingReading } from "../Backend/kai/services/kaiImpactFindingReading.js";
import { serviceFindingName as clientServiceFindingName, serviceRoleSelectionsFrom } from "../frontend/knowledgeStudio/clientDerivedMeasurementLogic.js";
import { syntheticXlsxWorkbook, SYNTHETIC_XLSX_MIME } from "./support/kaiSyntheticXlsxWorkbook.js";

/**
 * Single-source service-delivery measurement: role discovery, the record-level
 * reconciliation through the verified-byte worker, derived measurements, their
 * validators, statements, readings and planned-target relationships.
 *
 * The expected numbers come from an independent oracle below that reads the
 * synthetic row arrays directly (no KAI parser, profiler or reconciliation
 * code), applying the stated counting rules: one encounter per identifier;
 * copies agreeing on every structured column counted once; copies disagreeing
 * on any of them excluded whole; completed status only; inclusive Project
 * period by service day; programme/activity/household tallies from the same
 * record (never from column totals).
 */

const PERIOD = Object.freeze({ start: "2025-04-01", end: "2026-03-31" });
const HEADER = ["event_id", "household_id", "service_date", "program_code", "activity_type", "delivery_status", "staff_note", "external_use_from_row"];
const NOTE = ["Bus was late today", "Brought a friend along", "Asked about winter coats", ""];

function baseRows() {
  const rows = [];
  const dates = ["2025-04-15", "2025-05-20", "2025-06-02", "2025-08-19", "2025-10-07", "2025-12-12", "2026-01-21", "2026-03-03", "2025-03-10", "2026-05-04"];
  for (let i = 1; i <= 48; i += 1) {
    const programme = i % 3 === 0 ? "FS" : "PA";
    const activity = programme === "PA" ? (i % 2 ? "Pantry pickup" : "Food access drop-in") : (i % 2 ? "Cooking class" : "Budget workshop");
    const status = i % 7 === 0 ? "cancelled" : i % 11 === 0 ? "no_show" : "completed";
    rows.push([`E${String(i).padStart(3, "0")}`, `H${String((i % 13) + 1).padStart(2, "0")}`, dates[i % dates.length], programme, activity, status, NOTE[i % NOTE.length], "not_authorized_by_row"]);
  }
  const copy = (id, change = {}) => {
    const original = rows.find((row) => row[0] === id);
    const next = [...original];
    for (const [column, value] of Object.entries(change)) next[HEADER.indexOf(column)] = value;
    rows.push(next);
  };
  copy("E002"); copy("E005"); copy("E005");                      // exact duplicates (one counted)
  copy("E010", { staff_note: "Different note, same encounter" });  // differs only in a free-text column
  copy("E012", { delivery_status: "cancelled" });                 // conflicting status
  copy("E013", { service_date: "2025-09-30" });                   // conflicting date
  copy("E016", { program_code: "FS" });                           // conflicting programme
  copy("E017", { activity_type: "Food access drop-in" });         // conflicting activity
  copy("E019", { household_id: "H99" });                          // conflicting entity
  rows.push(["", "H03", "2025-07-01", "PA", "Pantry pickup", "completed", "", "not_authorized_by_row"]);  // no identifier
  rows.push(["", "H04", "2025-07-02", "FS", "Cooking class", "completed", "", "not_authorized_by_row"]);
  rows.find((row) => row[0] === "E020")[1] = "";                  // completed, no household identifier
  rows.push(["E101", "H01", PERIOD.start, "PA", "Pantry pickup", "completed", "", "not_authorized_by_row"]);  // first day: in
  rows.push(["E102", "H02", PERIOD.end, "FS", "Cooking class", "completed", "", "not_authorized_by_row"]);   // last day: in
  rows.push(["E103", "H02", "2025-03-31", "PA", "Pantry pickup", "completed", "", "not_authorized_by_row"]); // day before: out
  rows.push(["E104", "H05", "2026-04-01", "FS", "Budget workshop", "completed", "", "not_authorized_by_row"]); // day after: out
  rows.push(["E105", "H06", "", "PA", "Pantry pickup", "completed", "", "not_authorized_by_row"]);           // no date
  return rows;
}

// ---------------------------------------------------------------------------
// The independent oracle (plain arrays; shares no KAI code).

function oracle(rows, { header = HEADER, period = PERIOD, completed = "completed", id = "event_id", entity = "household_id", date = "service_date",
  programme = "program_code", activity = "activity_type", status = "delivery_status", material = null } = {}) {
  const col = (name) => header.indexOf(name);
  const value = (row, name) => (col(name) >= 0 ? String(row[col(name)] ?? "").trim() : "");
  const physical = rows.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
  const materialColumns = material ?? [entity, date, programme, activity, status].filter((name) => col(name) >= 0);
  const groups = new Map();
  let blankIds = 0;
  for (const row of physical) {
    const key = value(row, id);
    if (!key) { blankIds += 1; continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  let excess = 0;
  let conflicting = 0;
  const events = [];
  for (const copies of groups.values()) {
    excess += copies.length - 1;
    if (materialColumns.some((name) => new Set(copies.map((row) => value(row, name))).size > 1)) { conflicting += 1; continue; }
    events.push(copies[0]);
  }
  const done = events.filter((row) => value(row, status) === completed);
  const inScope = [];
  let outside = 0;
  let withoutDate = 0;
  for (const row of done) {
    if (!period) { inScope.push(row); continue; }
    const day = value(row, date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) withoutDate += 1;
    else if (day < period.start || day > period.end) outside += 1;
    else inScope.push(row);
  }
  const tally = (list, name) => list.reduce((map, row) => map.set(value(row, name), (map.get(value(row, name)) ?? 0) + 1), new Map());
  const households = new Set(inScope.map((row) => value(row, entity)).filter(Boolean));
  const byProgrammeHouseholds = new Map();
  for (const row of inScope) {
    const p = value(row, programme);
    if (!byProgrammeHouseholds.has(p)) byProgrammeHouseholds.set(p, new Set());
    if (value(row, entity)) byProgrammeHouseholds.get(p).add(value(row, entity));
  }
  const memberships = new Map();
  for (const row of inScope) if (value(row, entity)) memberships.set(value(row, entity), (memberships.get(value(row, entity)) ?? new Set()).add(value(row, programme)));
  return {
    physical: physical.length, blankIds, distinct: groups.size, excess, conflicting, consistent: events.length,
    completedStatusRecords: physical.filter((row) => value(row, status) === completed).length,
    completed: done.length, notCompleted: events.length - done.length, outside, withoutDate, inScope: inScope.length,
    byProgramme: Object.fromEntries(tally(inScope, programme)), byActivity: Object.fromEntries(tally(inScope, activity)),
    pairs: Object.fromEntries([...inScope.reduce((map, row) => map.set(`${value(row, programme)}|${value(row, activity)}`, (map.get(`${value(row, programme)}|${value(row, activity)}`) ?? 0) + 1), new Map())]),
    households: households.size, blankHouseholds: inScope.filter((row) => !value(row, entity)).length,
    householdsByProgramme: Object.fromEntries([...byProgrammeHouseholds].map(([key, set]) => [key, set.size])),
    multiProgramme: [...memberships.values()].filter((set) => set.size > 1).length,
    monthly: Object.fromEntries([...inScope.reduce((map, row) => map.set(value(row, date).slice(0, 7), (map.get(value(row, date).slice(0, 7)) ?? 0) + 1), new Map())].sort()),
  };
}

// ---------------------------------------------------------------------------
// KAI: bytes -> committed profile -> verified-byte worker -> findings.

function csvBytes(header, rows) {
  const escape = (cell) => (/[",\n]/.test(String(cell)) ? `"${String(cell).replace(/"/g, '""')}"` : String(cell));
  return new Uint8Array(Buffer.from(`${[header, ...rows].map((row) => row.map(escape).join(",")).join("\n")}\n`, "utf8"));
}

function workerFor(bytes, extension, { eligible = true, servedBytes = null } = {}) {
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const worker = createCrossSourceReconciliationWorker({
    lockEligibleIntakeFile: async () => eligible,
    readEligibilityFacts: async () => ({ organization_id: "o1", object_version_id: "v1", verified_checksum: checksum, verified_size_bytes: bytes.length,
      file_extension: extension, mime_type: extension === ".csv" ? "text/csv" : SYNTHETIC_XLSX_MIME, storage_provider: "local", storage_object_key: "synthetic" }),
    storageAdapter: { async readObjectVersion() { return { ok: true, data: { bytes: servedBytes ?? bytes } }; } },
  });
  return { worker, checksum };
}

const fakeTx = { async query() { return { rows: [] }; } };

async function kaiRead(bytes, { extension = ".csv", sheetKey = null, selections = null, period = PERIOD, workerOptions = {}, profileOverride = null } = {}) {
  const profile = profileOverride ?? await profileLocalTrustedFile({ extension, declaredMime: extension === ".csv" ? "text/csv" : SYNTHETIC_XLSX_MIME, byteSize: bytes.length, bytes });
  const { worker, checksum } = workerFor(bytes, extension, workerOptions);
  const periodContext = period ? { status: "recorded", engagement_id: "e1", period } : { status: "missing", engagement_id: "e1", period: null };
  return readServiceEventMeasurements(fakeTx, {
    organizationId: "o1", fileProfileRow: { intake_file_id: "f1", checksum, file_profile_id: "p1", profile_canonical_sha256: "a".repeat(64) },
    profile, worksheetKey: sheetKey, periodContext, selections, worker,
  });
}

const findingOf = (section, metric, { mode = null, group = null } = {}) => section.findings.find((f) => f.metric === metric
  && (mode === null || f.mode === mode) && ((group === null && !f.group) || f.group?.value_label === group));

function rowOf(measurement) {
  return {
    measurement_family: measurement.family, calculation_method: measurement.calculationMethod, worksheet_key: measurement.sheetKey,
    definition: JSON.parse(JSON.stringify(measurement.definition)), field_keys: [...measurement.fieldKeys], measured_value: measurement.measuredValue,
    numerator: measurement.numerator, denominator: measurement.denominator, percentage: measurement.percentage,
    component_counts: JSON.parse(JSON.stringify(measurement.componentCounts)), exclusions: measurement.exclusions,
  };
}

function assertAgreesWithOracle(section, expected) {
  const f = section.funnel;
  assert.deepEqual(
    [f.physical_record_count, f.blank_event_identifier_record_count, f.distinct_event_count, f.excess_copy_record_count, f.conflicting_event_identity_count,
      f.consistent_event_count, f.completed_status_record_count, f.completed_event_count, f.not_completed_event_count, f.completed_outside_period_count,
      f.completed_without_date_count, f.eligible_encounter_count, f.distinct_entity_count, f.blank_entity_identifier_event_count, f.multi_programme_entity_count],
    [expected.physical, expected.blankIds, expected.distinct, expected.excess, expected.conflicting, expected.consistent, expected.completedStatusRecords,
      expected.completed, expected.notCompleted, expected.outside, expected.withoutDate, expected.inScope, expected.households, expected.blankHouseholds, expected.multiProgramme],
    "the funnel equals the independent oracle",
  );
  assert.equal(findingOf(section, SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, { mode: "period" }).measured_value, expected.inScope);
  for (const [programme, count] of Object.entries(expected.byProgramme)) {
    assert.equal(findingOf(section, SERVICE_EVENT_METRICS.GROUP_COMPLETED_ENCOUNTERS, { group: programme })?.measured_value, count, `programme ${programme}`);
    assert.equal(findingOf(section, SERVICE_EVENT_METRICS.GROUP_DISTINCT_ENTITIES, { group: programme })?.measured_value, expected.householdsByProgramme[programme], `households in ${programme}`);
  }
  for (const [activity, count] of Object.entries(expected.byActivity)) {
    assert.equal(findingOf(section, SERVICE_EVENT_METRICS.GROUP_COMPLETED_ENCOUNTERS, { group: activity })?.measured_value, count, `activity ${activity}`);
  }
  assert.equal(findingOf(section, SERVICE_EVENT_METRICS.DISTINCT_ENTITIES).measured_value, expected.households);
  const monthly = findingOf(section, SERVICE_EVENT_METRICS.MONTHLY);
  assert.deepEqual(Object.fromEntries(monthly.monthly_activity.map((item) => [item.month, item.encounter_count])), expected.monthly);
  const pairs = Object.fromEntries(f.programme_activity.map((pair) => [`${f.groups.find((g) => g.value_key === pair.programme_value_key).label}|${f.activities.find((a) => a.value_key === pair.activity_value_key).label}`, pair.encounter_count]));
  assert.deepEqual(pairs, expected.pairs, "programme x activity intersections from the same records");
}

// ---------------------------------------------------------------------------

test("CSV service log: valid, duplicated, missing and conflicting identities, completion exclusions, households and exact period boundaries agree with the independent oracle", async () => {
  const rows = baseRows();
  const expected = oracle(rows);
  // The fixture exercises every rule it claims to.
  assert.ok(expected.excess >= 8 && expected.conflicting === 5 && expected.blankIds === 2 && expected.withoutDate === 1 && expected.outside >= 2 && expected.notCompleted > 0);
  assert.ok(expected.households < expected.inScope, "households are fewer than encounters (several services per household)");
  const { section, measurements } = await kaiRead(csvBytes(HEADER, rows));
  assert.equal(section.status, "available", JSON.stringify(section));
  assertAgreesWithOracle(section, expected);
  assert.equal(section.funnel.conflict_fields.status, 1);
  assert.equal(section.funnel.conflict_fields.service_date, 1);
  assert.equal(section.funnel.conflict_fields.programme, 1);
  assert.equal(section.funnel.conflict_fields.activity, 1);
  assert.equal(section.funnel.conflict_fields.entity_identifier, 1);
  assert.equal(section.funnel.consistent_copy_group_with_other_differences_count, 1, "a copy differing only in the free-text note is the same encounter");
  // Roles: established from the headings and the profile, never from position or value shape.
  const roles = section.roles;
  assert.deepEqual(Object.fromEntries(Object.entries(roles).map(([name, role]) => [name, [role.status, role.field_key]])), {
    encounter_identifier: ["established", "field_1"], status: ["established", "field_6"], service_date: ["established", "field_3"],
    programme: ["established", "field_4"], activity: ["established", "field_5"], entity_identifier: ["established", "field_2"], eligibility: ["unavailable", null],
  });
  assert.equal(roles.entity_identifier.entity_kind, "household");
  assert.equal(roles.status.completed_value_label, "completed");
  for (const role of Object.values(roles)) assert.ok(role.evidence.length > 0, `${role.role} states its evidence`);
  // A source value about use is shown, not applied as a permission or an eligibility rule.
  assert.equal(section.source_value_notes.length, 1);
  assert.match(section.source_value_notes[0].text, /not an application permission decision/);
  // Nothing identifying leaves the worker: no identifier, date or note text.
  const serialized = JSON.stringify({ section, measurements });
  for (const leaked of ["E001", "H01", "2025-04-15", "Bus was late", "winter coats", "\"event_id\"", "\"household_id\"", "staff_note"]) assert.equal(serialized.includes(leaked), false, `${leaked} never leaves the worker`);
  // Required set: headline encounters, programme breakdown and households.
  assert.deepEqual(section.findings.filter((f) => f.required).map((f) => [f.metric, f.group?.value_label ?? null]).sort(),
    [[SERVICE_EVENT_METRICS.DISTINCT_ENTITIES, null], [SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, null],
      [SERVICE_EVENT_METRICS.GROUP_COMPLETED_ENCOUNTERS, "FS"], [SERVICE_EVENT_METRICS.GROUP_COMPLETED_ENCOUNTERS, "PA"]].sort());
  assert.ok(section.findings.every((f) => f.finding_basis === "service_encounters" && f.recordable));
  // The all-dates finding is the oracle without the period.
  assert.equal(findingOf(section, SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, { mode: "all_dates" }).measured_value, oracle(rows, { period: null }).inScope);
  // Every measurement keeps its arithmetic, its statement fits and names its scope.
  for (const measurement of measurements) {
    const row = rowOf(measurement);
    assert.equal(derivedMeasurementArithmeticHolds(row), true, measurement.definition.metric);
    assert.ok(SCHEMA_ADMITTED_DERIVED_METHODS.has(measurement.calculationMethod));
    assert.equal(derivedMeasurementLabelsAdmitted(row), true);
    assert.equal(derivedContributingSourcesCurrent({ ...row, contributing_sources: [] }), true, "single source: no contributing source");
    const statement = composeDerivedMeasurementEvidenceStatement({ measurementRow: row });
    assert.ok(statement.length <= 500, statement);
    assert.match(statement, /Single source; no register linked\./);
    assert.ok(composeDerivedMeasurementDisclosure(derivedMeasurementLimitationCodes({ measurementRow: row, dimensions: null })), "limitations compose");
    assert.deepEqual(measurement.componentCounts.required_measurement_keys, section.required_measurement_keys);
  }
  const headline = rowOf(measurements.find((m) => m.measurementKey === findingOf(section, SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, { mode: "period" }).measurement_key));
  assert.match(composeDerivedMeasurementEvidenceStatement({ measurementRow: headline }),
    new RegExp(`^Derived measurement: ${expected.inScope} completed service events: column F = completed, service date \\(column C\\) in reporting period 2025-04-01 to 2026-03-31 by day, each column A identifier counted once; ${expected.excess - 5} duplicate copies counted once; excluded 5 conflicting, ${expected.notCompleted} not completed, ${expected.outside} outside period, 1 without date\\.`));
});

test("XLSX service worksheet: the same records in a workbook give the same results for the selected worksheet only", async () => {
  const rows = baseRows();
  const bytes = syntheticXlsxWorkbook({ sheets: [{ name: "Notes", rows: [["topic", "count"], ["intro", 1], ["close", 2]] }, { name: "Service_Log", rows: [HEADER, ...rows] }] });
  const { section } = await kaiRead(bytes, { extension: ".xlsx", sheetKey: "sheet_2" });
  assert.equal(section.status, "available");
  assert.equal(section.worksheet_key, "sheet_2");
  assertAgreesWithOracle(section, oracle(rows));
  const other = await kaiRead(bytes, { extension: ".xlsx", sheetKey: "sheet_1" });
  assert.equal(other.section, null, "a worksheet without a completed status value has no service section");
});

test("identical marginal counts with different status/programme intersections: KAI follows the records, a marginal estimate cannot", async () => {
  const header = ["event_id", "household_id", "service_date", "program_code", "delivery_status"];
  const make = (pairs) => pairs.map(([programme, status], index) => [`E${index + 1}`, `H${(index % 3) + 1}`, `2025-${String((index % 8) + 4).padStart(2, "0")}-15`, programme, status]);
  const a = make([["PA", "completed"], ["PA", "completed"], ["PA", "completed"], ["FS", "cancelled"], ["FS", "completed"], ["PA", "cancelled"]]);
  const b = make([["PA", "completed"], ["PA", "completed"], ["PA", "cancelled"], ["PA", "cancelled"], ["FS", "completed"], ["FS", "completed"]]);
  const marginal = (rows, i) => rows.reduce((map, row) => map.set(row[i], (map.get(row[i]) ?? 0) + 1), new Map());
  assert.deepEqual([...marginal(a, 3)].sort(), [...marginal(b, 3)].sort(), "same programme totals");
  assert.deepEqual([...marginal(a, 4)].sort(), [...marginal(b, 4)].sort(), "same status totals");
  const results = {};
  for (const [name, rows] of [["a", a], ["b", b]]) {
    const { section } = await kaiRead(csvBytes(header, rows));
    const expected = oracle(rows, { header, activity: "none" });
    results[name] = Object.fromEntries(["PA", "FS"].map((p) => [p, findingOf(section, SERVICE_EVENT_METRICS.GROUP_COMPLETED_ENCOUNTERS, { group: p }).measured_value]));
    assert.deepEqual(results[name], expected.byProgramme, `dataset ${name} agrees with the oracle`);
  }
  assert.deepEqual(results, { a: { PA: 3, FS: 1 }, b: { PA: 2, FS: 2 } });
  // A product of marginals (PA share x completed share x records) is the same for both and wrong for both.
  assert.equal(Math.round(6 * (4 / 6) * (4 / 6) * 100) / 100, 2.67);
});

test("ambiguous and unsupported roles return the narrower calculation with the exact requirement; a person's selection establishes them", async () => {
  // Two values that can mean completed: the completed indicator is not calculated until chosen.
  const header = ["visit_id", "client_id", "visit_date", "entry_date", "attendance_status", "programme"];
  const rows = [];
  for (let i = 1; i <= 20; i += 1) rows.push([`V${i}`, `C${(i % 6) + 1}`, `2025-0${(i % 9) + 1}-10`, `2025-0${(i % 9) + 1}-20`, i % 4 === 0 ? "completed" : i % 5 === 0 ? "cancelled" : "attended", i % 2 ? "Youth" : "Adults"]);
  const bytes = csvBytes(header, rows);
  const first = (await kaiRead(bytes)).section;
  assert.equal(first.roles.status.status, "ambiguous");
  assert.match(first.roles.status.evidence.join(" "), /2 values that can mean completed \(attended, completed\)/);
  assert.equal(first.findings.length, 0, "no completed-encounter number while completed is ambiguous");
  assert.match(first.unavailable.find((u) => u.metric === SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS).requirement, /Choose which column and value mean a completed service/);
  assert.equal(first.roles.service_date.status, "established", "visit_date names the service date; entry_date does not");
  assert.equal(first.roles.entity_identifier.status, "proposed", "client_id names a participant, not whether it is a person or a household");
  const status = first.roles.status;
  const attended = status.values.find((v) => v.label === "attended").value_key;
  const chosen = (await kaiRead(bytes, { selections: { status_field_key: status.field_key, completed_value_key: attended } })).section;
  assert.equal(chosen.roles.status.basis, "person_selected");
  const expected = oracle(rows, { header, id: "visit_id", entity: "client_id", date: "visit_date", programme: "programme", activity: "none", status: "attendance_status", completed: "attended",
    material: ["client_id", "visit_date", "entry_date", "attendance_status", "programme"] });
  assert.equal(findingOf(chosen, SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, { mode: "period" }).measured_value, expected.inScope);
  assert.equal(findingOf(chosen, SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, { mode: "period" }).finding_basis, "service_encounters");
  // The entity kind is not stated: distinct identifiers are a source-value finding, with the precise requirement.
  const entities = findingOf(chosen, SERVICE_EVENT_METRICS.DISTINCT_ENTITIES);
  assert.equal(entities.finding_basis, "source_values");
  assert.equal(entities.name, "Distinct identifier values served");
  assert.equal(entities.measured_value, expected.households);
  assert.match(chosen.unavailable.find((u) => u.metric === "entity_kind").requirement, /household, a person or a family/);
  const stated = (await kaiRead(bytes, { selections: { status_field_key: status.field_key, completed_value_key: attended, entity_kind: "person" } })).section;
  assert.equal(findingOf(stated, SERVICE_EVENT_METRICS.DISTINCT_ENTITIES).finding_basis, "service_encounters");
  assert.equal(findingOf(stated, SERVICE_EVENT_METRICS.DISTINCT_ENTITIES).name, "Distinct people served");
  assert.notEqual(findingOf(stated, SERVICE_EVENT_METRICS.DISTINCT_ENTITIES).measurement_key, entities.measurement_key, "a stated meaning is a different measurement");
  // A selection outside the listed columns or values is refused.
  assert.equal((await kaiRead(bytes, { selections: { status_field_key: status.field_key, completed_value_key: "value_9" } })).refused.code, "validation_blocker");
  assert.equal(validateServiceRoleSelections({ status_field_key: "field_5" }).ok, false, "a status needs its completed value");
  assert.equal(validateServiceRoleSelections({ entity_kind: "robot" }).ok, false);
  assert.equal(validateServiceRoleSelections({ eligibility_field_key: "field_2" }).ok, false, "an eligibility column needs its included value");
  assert.deepEqual(serviceRoleSelectionsFrom({ programme_field_key: "none", entity_kind: "", status_field_key: "field_5", completed_value_key: "value_1" }),
    { programme_field_key: null, status_field_key: "field_5", completed_value_key: "value_1" });
});

test("without an encounter identifier the result counts records, never distinct encounters; two candidate identifiers are ambiguous until chosen", async () => {
  const header = ["service_date", "status", "program", "household_ref"];
  const rows = [["2025-05-01", "completed", "PA", "H1"], ["2025-05-01", "completed", "PA", "H1"], ["2025-06-01", "completed", "FS", "H2"], ["2025-06-03", "cancelled", "FS", "H2"], ["2025-07-01", "completed", "PA", "H3"]];
  const { section, measurements } = await kaiRead(csvBytes(header, rows));
  assert.equal(section.roles.encounter_identifier.status, "unavailable");
  const completed = findingOf(section, SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, { mode: "period" });
  assert.deepEqual([completed.measured_value, completed.counted_unit.kind, completed.finding_basis, completed.name], [4, "record", "source_values", "Completed-status records"]);
  assert.match(section.unavailable.find((u) => u.metric === "distinct_encounters").requirement, /count records: a repeated record of one encounter is counted again/);
  const statement = composeDerivedMeasurementEvidenceStatement({ measurementRow: rowOf(measurements.find((m) => m.measurementKey === completed.measurement_key)) });
  assert.match(statement, /^Derived measurement: 4 records: .*records, not distinct encounters \(no encounter identifier column\)/);
  assert.ok(derivedMeasurementLimitationCodes({ measurementRow: rowOf(measurements[0]), dimensions: null }).includes("derived.records_not_distinct_encounters"));
  const two = csvBytes(["event_id", "visit_id", "service_date", "status"], [["E1", "V1", "2025-05-01", "completed"], ["E2", "V2", "2025-05-02", "completed"], ["E3", "V3", "2025-05-03", "cancelled"],
    ["E4", "V4", "2025-05-04", "completed"], ["E5", "V5", "2025-05-05", "cancelled"], ["E6", "V6", "2025-05-06", "completed"]]);
  const ambiguous = (await kaiRead(two)).section;
  assert.equal(ambiguous.roles.encounter_identifier.status, "ambiguous");
  assert.equal(findingOf(ambiguous, SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, { mode: "period" }).counted_unit.kind, "record");
  const picked = (await kaiRead(two, { selections: { encounter_identifier_field_key: "field_2" } })).section;
  assert.deepEqual([picked.roles.encounter_identifier.status, picked.roles.encounter_identifier.basis, findingOf(picked, SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, { mode: "period" }).measured_value], ["established", "person_selected", 4]);
});

test("an eligibility column is never applied until the organization says which value includes a record; then exclusions are counted", async () => {
  const header = ["event_id", "household_id", "service_date", "delivery_status", "eligible_for_reporting"];
  const rows = [["E1", "H1", "2025-05-01", "completed", "yes"], ["E2", "H2", "2025-05-02", "completed", "no"], ["E3", "H1", "2025-05-03", "completed", "yes"], ["E4", "H3", "2025-05-04", "cancelled", "yes"], ["E5", "H4", "2025-05-05", "completed", "no"]];
  const bytes = csvBytes(header, rows);
  const proposed = (await kaiRead(bytes)).section;
  assert.equal(proposed.roles.eligibility.status, "proposed");
  const unapplied = findingOf(proposed, SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, { mode: "period" });
  assert.deepEqual([unapplied.measured_value, unapplied.finding_basis], [4, "source_values"]);
  assert.match(proposed.unavailable.find((u) => u.metric === "eligibility").requirement, /does not apply it/);
  const yes = proposed.roles.eligibility.values.find((v) => v.label === "yes").value_key;
  const applied = (await kaiRead(bytes, { selections: { eligibility_field_key: proposed.roles.eligibility.field_key, eligibility_value_key: yes } })).section;
  const counted = findingOf(applied, SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, { mode: "period" });
  assert.deepEqual([counted.measured_value, counted.finding_basis, applied.funnel.eligibility_excluded_event_count], [2, "service_encounters", 2]);
  assert.equal(findingOf(applied, SERVICE_EVENT_METRICS.DISTINCT_ENTITIES).measured_value, 1, "only household H1 has eligible completed encounters");
});

test("Project period missing: all-date results with the exact requirement; checksum, eligibility and changed-table failures are stated, not guessed", async () => {
  const rows = baseRows();
  const bytes = csvBytes(HEADER, rows);
  const noPeriod = (await kaiRead(bytes, { period: null })).section;
  assert.equal(noPeriod.period_applied, false);
  assert.equal(findingOf(noPeriod, SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, { mode: "all_dates" }).required, true);
  assert.equal(findingOf(noPeriod, SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, { mode: "all_dates" }).measured_value, oracle(rows, { period: null }).inScope);
  assert.match(noPeriod.unavailable.find((u) => u.metric === "period_scope").requirement, /reporting period/);
  assert.equal(findingOf(noPeriod, SERVICE_EVENT_METRICS.MONTHLY), undefined);
  assert.equal((await kaiRead(bytes, { workerOptions: { servedBytes: new Uint8Array(bytes).fill(32) } })).section.reason, "cross_source_checksum_mismatch");
  assert.equal((await kaiRead(bytes, { workerOptions: { eligible: false } })).section.reason, "cross_source_upload_not_eligible");
  const profile = await profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: bytes.length, bytes });
  const changed = JSON.parse(JSON.stringify(profile));
  changed.tabular_measurement_basis.record_count += 1;
  assert.equal((await kaiRead(bytes, { profileOverride: changed })).section.reason, "service_table_changed");
  const noStatus = csvBytes(["survey_id", "household_id", "survey_date", "stage"], [["S1", "H1", "2025-05-01", "baseline"], ["S2", "H1", "2025-09-01", "followup"]]);
  assert.equal(serviceEventTableBasis(await profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: noStatus.length, bytes: noStatus }), null), null,
    "a table without a completed status value is not a service-record table");
});

test("persisted-row validators refuse a service row that breaks its funnel, claims more than its roles, or poses as another method", async () => {
  const { measurements } = await kaiRead(csvBytes(HEADER, baseRows()));
  const headline = measurements.find((m) => m.definition.metric === SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS && m.definition.period);
  const entities = measurements.find((m) => m.definition.metric === SERVICE_EVENT_METRICS.DISTINCT_ENTITIES);
  const programme = measurements.find((m) => m.definition.metric === SERVICE_EVENT_METRICS.GROUP_COMPLETED_ENCOUNTERS && m.definition.group.role === "programme");
  const broken = (measurement, mutate) => { const row = rowOf(measurement); mutate(row); return derivedMeasurementArithmeticHolds(row); };
  assert.equal(broken(headline, (r) => { r.component_counts.excess_copy_record_count += 1; }), false);
  assert.equal(broken(headline, (r) => { r.component_counts.distinct_event_count += 1; }), false);
  assert.equal(broken(headline, (r) => { r.component_counts.completed_outside_period_count += 1; }), false);
  assert.equal(broken(headline, (r) => { r.measured_value += 1; r.numerator += 1; }), false);
  assert.equal(broken(headline, (r) => { r.definition.roles.status.basis = "proposed"; }), false, "service_encounters with a proposed role is refused");
  assert.equal(broken(headline, (r) => { r.definition.period = null; }), false);
  assert.equal(broken(headline, (r) => { r.measurement_family = DERIVED_MEASUREMENT_FAMILIES.TABULAR_COUNT; }), false, "not a raw count");
  assert.equal(broken(headline, (r) => { r.measurement_family = DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH; }), false, "not linked reach");
  assert.equal(broken(headline, (r) => { r.calculation_method = "kai_cross_source_linked_reach_v1"; }), false);
  assert.equal(broken(entities, (r) => { r.definition.roles.entity_identifier.entity_kind = null; }), false, "households need an established entity kind");
  assert.equal(broken(entities, (r) => { r.component_counts.distinct_entity_count = r.component_counts.eligible_encounter_count + 1; r.measured_value = r.numerator = r.component_counts.distinct_entity_count; }), false);
  assert.equal(broken(programme, (r) => { r.component_counts.group_encounter_count += 1; r.measured_value += 1; r.numerator += 1; }), false, "a programme cell must be the recorded intersection");
  assert.equal(broken(programme, (r) => { r.definition.group.value_label = "Elsewhere"; }), false);
  // A claim basis for the evidence holds only for exactly this measurement and its statement.
  const row = { ...rowOf(headline), evidence_item_id: "ev1", organization_id: "o1", source_version_id: "sv1", measurement_source_version_id: "sv1",
    profile_canonical_sha256: "a".repeat(64), contributing_sources: [], interpretation_id: null, current_interpretation_id: null };
  const evidence = { evidence_item_id: "ev1", organization_id: "o1", source_version_id: "sv1", evidence_type: "source_derived_measurement", data_class: "source_derived_aggregate",
    statement: composeDerivedMeasurementEvidenceStatement({ measurementRow: row }) };
  const locator = { locator_type: "source_derived_measurement_fields", coordinates: { scope: "derived_measurement_fields", field_keys: row.field_keys } };
  assert.equal(validateDerivedMeasurementClaimBasis({ evidenceItemRow: evidence, locatorRow: locator, sourceVersionRow: { profile_canonical_sha256: "a".repeat(64) }, measurementRow: row }).ok, true);
  assert.equal(validateDerivedMeasurementClaimBasis({ evidenceItemRow: { ...evidence, statement: evidence.statement.replace(/^Derived measurement: \d+/, "Derived measurement: 999") }, locatorRow: locator,
    sourceVersionRow: { profile_canonical_sha256: "a".repeat(64) }, measurementRow: row }).ok, false);
  const dims = applyDerivedMeasurementCoverageDimensions({}, row);
  assert.equal(dims.time_period_clarity.evidence.assessment_status, "resolved_clear");
  assert.equal(dims.duplicates.evidence.assessment_status, "resolved_risk_flagged");
});

test("readings for reports: encounters are not people, households are reach, no causal or verification wording", async () => {
  const { measurements } = await kaiRead(csvBytes(HEADER, baseRows()));
  for (const measurement of measurements) {
    const reading = composeImpactFindingReading({ ...rowOf(measurement), interpretation_id: null });
    assert.ok(reading?.text, measurement.definition.metric);
    assert.doesNotMatch(reading.text, /\b(causes?|caused|because|due to|leads? to|led to|results? in|impact(?:s|ed)?|increases?|improves?|reduces?)\b/i);
    assert.doesNotMatch(reading.text, /(?<!not |n't )\bverified\b/i);
    assert.match(reading.text, /one service log; whether each identifier is on a register was not checked/);
    if (measurement.definition.metric === SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS) assert.match(reading.text, /These are encounters, not people/);
    if (measurement.definition.metric === SERVICE_EVENT_METRICS.DISTINCT_ENTITIES) assert.match(reading.text, /households received at least one of/);
    assert.equal(clientServiceFindingName(measurement.definition), (await import("../Backend/kai/validators/kaiServiceEventMeasurements.js")).serviceFindingName(measurement.definition));
  }
});

test("planned targets: matching unit, entity, programme and period are proposed for confirmation; bags, other units, other programmes and other Projects are not", async () => {
  const { section, measurements } = await kaiRead(csvBytes(HEADER, baseRows()));
  const asRow = (m) => ({ ...rowOf(m), measurement_key: m.measurementKey, source_derived_measurement_id: `m-${m.measurementKey.slice(0, 6)}`, engagement_id: "e1", is_current: true, contributing_sources_current: true });
  const rows = measurements.map(asRow);
  const plan = (row, indicator, value, unit, scope, extra = {}) => ({ planned_target_id: `p${row}`, engagement_id: "e1", source_version_id: "sv-plan", worksheet_key: "sheet_3", row_number: row,
    indicator, planned_value: `${value}.00`, unit, unit_kind: "count", scope, period_start: PERIOD.start, period_end: PERIOD.end, source_comparison: null, relationship_status: "unresolved", ...extra });
  const plans = [
    plan(2, "distinct_households_served", 90, "households", "all"),
    plan(3, "completed_household_service_encounters", 250, "encounters", "all"),
    plan(4, "pantry_bags_distributed", 300, "bags", "PA"),
    plan(5, "matched_food_planning_surveys", 60, "comparable_households", "all"),
    plan(7, "food_skills_household_attendances", 95, "encounters", "FS"),
    plan(8, "completed_household_service_encounters", 40, "encounters", "all", { engagement_id: "e2" }),
    plan(9, "completed_household_service_encounters", 40, "encounters", "all", { period_start: "2024-04-01", period_end: "2025-03-31" }),
  ];
  const suggestions = serviceTargetSuggestions({ plans, measurements: rows, engagementId: "e1" });
  const byRow = Object.fromEntries(suggestions.map((s) => [s.row_number, s]));
  assert.equal(byRow[8], undefined, "a plan of another Project is never suggested");
  assert.deepEqual([byRow[2].status, byRow[2].result.name], ["confirmation_required", "Distinct households served"]);
  assert.deepEqual([byRow[3].status, byRow[3].result.name], ["confirmation_required", "Completed service events"]);
  assert.deepEqual([byRow[7].status, byRow[7].result.name], ["confirmation_required", "Completed service events in FS"]);
  for (const row of [2, 3, 7]) {
    const checks = Object.fromEntries(byRow[row].checks.map((c) => [c.key, c.result]));
    assert.deepEqual(checks, { project: "pass", currentness: "pass", unit: "pass", period: "pass", comparison: "confirm", scope: "pass", population: "confirm", meaning: "confirm" }, `row ${row}`);
    assert.match(byRow[row].checks.find((c) => c.key === "period").text, /column C/, "the date basis is named");
  }
  assert.equal(byRow[4].status, "not_comparable");
  assert.match(byRow[4].checks.find((c) => c.key === "unit").text, /counts encounters .* while the plan states "bags"/, "an encounter is not a bag");
  assert.equal(byRow[5].status, "not_comparable");
  assert.equal(byRow[9].status, "not_comparable");
  assert.equal(byRow[9].checks.find((c) => c.key === "period").result, "fail");
  // The planning worksheet proposes the same results by unit and scope; nothing is accepted.
  const fsCandidate = { indicator: "food_skills_household_attendances", unit: "encounters", unit_kind: "count", period: { start: PERIOD.start, end: PERIOD.end }, scope: "FS", scope_applies_to_all: false, comparator: null, limitations: [] };
  const related = relatedRecordedMeasurements({ candidate: fsCandidate, measurements: rows, planningEngagementId: "e1" });
  assert.ok(related.some((r) => r.name === "Completed service events in FS" && r.proposed_because === "same_unit_and_scope" && r.relationship.status === "confirmation_required"));
  assert.ok(related.every((r) => r.relationship.checks.find((c) => c.key === "meaning").result === "confirm"));
  // The decision validator confirms a compatible actual and refuses an incompatible one.
  const target = { ...plans[1], engagement_id: "e1", period_start: PERIOD.start, period_end: PERIOD.end };
  const actual = rows.find((r) => r.definition.metric === SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS && r.definition.period);
  const confirm = { expected_decision_id: "00000000-0000-4000-8000-000000000001", actual_measurement_id: actual.source_derived_measurement_id, relationship_status: "confirmed", comparison: null,
    metric_confirmed: true, population_confirmed: true, date_basis_confirmed: true };
  assert.equal(validatePlannedTargetDecision(confirm, { target, actual, actualEngagementId: "e1" }).ok, true);
  const bags = { ...plans[2] };
  const pa = rows.find((r) => r.definition.metric === SERVICE_EVENT_METRICS.GROUP_COMPLETED_ENCOUNTERS && r.definition.group.value_label === "PA");
  assert.equal(validatePlannedTargetDecision({ ...confirm, actual_measurement_id: pa.source_derived_measurement_id }, { target: bags, actual: pa, actualEngagementId: "e1" }).reason, "planned_target_actual_incompatible");
  const allDates = rows.find((r) => r.definition.metric === SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS && !r.definition.period);
  assert.equal(validatePlannedTargetDecision({ ...confirm, actual_measurement_id: allDates.source_derived_measurement_id }, { target, actual: allDates, actualEngagementId: "e1" }).reason, "planned_target_actual_incompatible", "all dates is not the planned period");
  assert.ok(section.findings.length > 0);
});

test("original Willow Quay service encounters (when the synthetic package is supplied): KAI equals the independent oracle; register-only exclusions are named, not guessed", {
  skip: !process.env.KAI_WILLOW_QUAY_PACKAGE ? "set KAI_WILLOW_QUAY_PACKAGE to the original synthetic package" : false,
}, async () => {
  const path = join(process.env.KAI_WILLOW_QUAY_PACKAGE, "01_UPLOAD_TO_KAI/03_Service_Encounters.csv");
  assert.ok(existsSync(path));
  const bytes = new Uint8Array(readFileSync(path));
  assert.equal(createHash("sha256").update(bytes).digest("hex").length, 64);
  // Independent parse: this file has no quoted commas.
  const lines = Buffer.from(bytes).toString("utf8").replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines[0].split(",");
  const rows = lines.slice(1).map((line) => line.split(","));
  const expected = oracle(rows, { header, material: ["household_id", "service_date", "program_code", "activity_type", "delivery_status", "session_id", "delivery_mode", "recorded_by_role", "record_type", "external_use_from_row"] });
  assert.deepEqual([expected.physical, expected.distinct, expected.excess, expected.completedStatusRecords, expected.completed, expected.inScope, expected.outside, expected.notCompleted],
    [301, 298, 3, 284, 281, 276, 5, 17]);
  const { section } = await kaiRead(bytes);
  assertAgreesWithOracle(section, expected);
  assert.deepEqual(expected.byProgramme, { PA: 176, FS: 100 });
  assert.equal(expected.households, 85);
  assert.equal(expected.multiProgramme, 26);
  assert.equal(section.roles.encounter_identifier.counted_unit, "household service encounter");
  assert.equal(findingOf(section, SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS, { mode: "all_dates" }).measured_value, 281);
});
