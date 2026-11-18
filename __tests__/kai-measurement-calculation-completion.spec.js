import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { profileLocalTrustedFile, readTrustedWorksheetRecords, readTrustedCsvRecords } from "../Backend/kai/profiling/localProfilingKernel.js";
import { reconcileLinkedReach } from "../Backend/kai/parsing/crossSourceReachReconciliation.js";
import * as D from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import { syntheticXlsxWorkbook, SYNTHETIC_XLSX_MIME } from "./support/kaiSyntheticXlsxWorkbook.js";

/**
 * Measurement calculation completion (owner authorization 2026-11-18):
 * exact Project periods calculated from the verified uploaded file, the
 * worksheet reader the calculation job uses, linked reach between worksheets,
 * and planned targets compared with recorded actuals. Synthetic records only;
 * every expected number is computed here from the explicit records with plain
 * filter/set arithmetic, independent of KAI's code.
 */

// [event_ref, learner_id, status, cohort, visit_date]
const HEADER = ["event_ref", "learner_id", "status", "cohort", "visit_date"];
const ROWS = [
  ["E01", "L01", "completed", "active", "2025-01-15"], ["E02", "L01", "completed", "active", "2025-03-02"],
  ["E03", "L01", "waiting", "active", "2025-06-20"], ["E04", "L02", "completed", "exited", "2025-02-11"],
  ["E05", "L02", "waiting", "exited", "2025-02-28"], ["E06", "L03", "completed", "active", "2025-04-01"],
  ["E07", "L03", "completed", "active", "2025-04-30"], ["E08", "L03", "completed", "active", "2025-07-07"],
  ["E09", "L04", "waiting", "active", "2025-05-05"], ["E10", "L04", "completed", "active", "2025-08-31"],
  ["E11", "L05", "completed", "exited", "2025-03-15"], ["E12", "L05", "completed", "exited", "2025-03-16"],
  ["E13", "L06", "waiting", "exited", "2025-06-01"], ["E14", "L06", "completed", "active", "2025-01-31"],
  ["E15", "L07", "completed", "active", ""], ["E16", "L02", "completed", "exited", "2025-09-09"],
  ["E17", "L08", "waiting", "active", "2025-04-12"], ["E18", "L09", "completed", "exited", "2025-05-20"],
  ["E19", "L10", "completed", "active", "2025-02-14"], ["E06", "L03", "completed", "active", "2025-04-01"],
  ["E20", "L11", "waiting", "exited", "2025-08-01"],
];
const CSV_BYTES = new TextEncoder().encode(`${[HEADER, ...ROWS].map((row) => row.join(",")).join("\n")}\n`);
const COMPLETED = { kind: "category", field_key: "field_3", value_key: "value_1" };
const ACTIVE = { kind: "category", field_key: "field_4", value_key: "value_1" };
const EXITED = { kind: "category", field_key: "field_4", value_key: "value_2" };
const within = { kind: "period", field_key: "field_5", period_source: "engagement_reporting_period", scope: "within" };
const eachLearner = { kind: "distinct_key", field_key: "field_2", duplicate_policy: "count_each_key_once" };

async function csvProfile() {
  return profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: CSV_BYTES.byteLength, bytes: CSV_BYTES });
}

function fromRecords(profile, input, period, records = readTrustedCsvRecords({ bytes: CSV_BYTES }), worksheetKey = null) {
  const validated = D.validateTabularMeasurementDefinition(input);
  assert.equal(validated.ok, true, JSON.stringify(validated.blockers));
  const resolved = D.resolveTabularDefinitionForSourceRecords(profile, worksheetKey, validated.definition, { reportingPeriod: period });
  assert.equal(resolved.ok, true, JSON.stringify(resolved.blockers));
  return D.calculateTabularMeasurementFromRecords({ profile, worksheetKey, resolved: resolved.resolved, records });
}

const day = (row, period) => row[4] !== "" && row[4] >= period.start && row[4] <= period.end;
const asRow = (measurement) => ({
  measurement_family: measurement.family, calculation_method: measurement.calculationMethod, worksheet_key: measurement.sheetKey,
  definition: measurement.definition, field_keys: measurement.fieldKeys, measured_value: measurement.measuredValue, numerator: measurement.numerator,
  denominator: measurement.denominator, percentage: measurement.percentage, component_counts: measurement.componentCounts, exclusions: measurement.exclusions,
  interpretation_id: null, current_interpretation_id: null,
});

test("exact Project days from the verified records: counts, identifiers and both rate kinds equal a day-level calculation", async () => {
  const profile = await csvProfile();
  // Both ends fall inside months that hold records of every value (February and April 2025).
  const period = { start: "2025-02-12", end: "2025-04-15" };
  const inDays = ROWS.filter((row) => day(row, period));
  const active = inDays.filter((row) => row[3] === "active");
  const exited = inDays.filter((row) => row[3] === "exited");
  const cases = [
    [{ operation: "count", conditions: [within] }, inDays.length, null],
    [{ operation: "count", conditions: [ACTIVE, within] }, active.length, null],
    [{ operation: "count", unit: eachLearner, conditions: [ACTIVE, within] }, new Set(active.map((row) => row[1])).size, null],
    [{ operation: "rate", conditions: [COMPLETED, within], population: [ACTIVE] }, active.filter((row) => row[2] === "completed").length, active.length],
    [{ operation: "rate", unit: eachLearner, conditions: [COMPLETED, within], population: [EXITED] },
      new Set(exited.filter((row) => row[2] === "completed").map((row) => row[1])).size, new Set(exited.map((row) => row[1])).size],
  ];
  // Hand count: E02 E05 E06 E06(copy) E11 E12 E17 E19 fall on these days; E04 (Feb 11) and E07 (Apr 30) do not.
  assert.deepEqual(cases.map(([, n, d]) => [n, d]), [[8, null], [5, null], [4, null], [4, 5], [1, 2]]);
  for (const [input, numerator, denominator] of cases) {
    // The profile path cannot answer these (records in partly covered months) and hands them to the file.
    const profilePath = D.deriveTabularMeasurement(profile, null, D.validateTabularMeasurementDefinition(input).definition, { reportingPeriod: period });
    assert.equal(profilePath.needsSourceRecords, true, JSON.stringify(input));
    const result = fromRecords(profile, input, period);
    assert.equal(result.ok, true, JSON.stringify(result.blockers));
    const m = result.measurement;
    assert.deepEqual([m.numerator, m.denominator], [numerator, denominator], JSON.stringify(input));
    assert.equal(m.basisVersion, D.VERIFIED_BYTES_BASIS_VERSION);
    assert.deepEqual(m.definition.conditions.find((condition) => condition.kind === "period"), { ...within, period_start: period.start, period_end: period.end });
    assert.equal(D.derivedMeasurementArithmeticHolds(asRow(m)), true);
    assert.equal(D.validateDerivedStatements({ measurementRow: asRow(m) }).ok, true);
    assert.ok(D.derivedMeasurementLimitationCodes({ measurementRow: asRow(m), dimensions: null }).includes(D.DERIVED_LIMITATION_CODES.EXACT_DAYS_FROM_SOURCE_FILE));
  }
  // A rate in identifiers states the undated record (E15) the period excludes, as a record rate does.
  const learnerRate = fromRecords(profile, { operation: "rate", unit: eachLearner, conditions: [COMPLETED, within] }, period).measurement;
  const learnersInDays = new Set(inDays.map((row) => row[1]));
  assert.deepEqual([learnerRate.numerator, learnerRate.denominator], [new Set(inDays.filter((row) => row[2] === "completed").map((row) => row[1])).size, learnersInDays.size]);
  assert.equal(learnerRate.componentCounts.records_without_date, ROWS.filter((row) => row[4] === "").length);
  assert.match(D.composeDerivedMeasurementEvidenceStatement({ measurementRow: asRow(learnerRate) }),
    new RegExp(`: ${learnerRate.numerator} of ${learnerRate.denominator} \\(${learnerRate.percentage}%\\); ${learnerRate.denominator - learnerRate.numerator} of the ${learnerRate.denominator} do not; 1 record without a date excluded from the population\\.$`));
  // Negative control: rounding the period out to whole months (February to April) counts other records.
  assert.notEqual(ROWS.filter((row) => day(row, { start: "2025-02-01", end: "2025-04-30" })).length, inDays.length);
});

test("the file path and the profile path agree on whole months: the same identity and the same figures", async () => {
  const profile = await csvProfile();
  const period = { start: "2025-02-01", end: "2025-04-30" };
  for (const input of [
    { operation: "count", conditions: [ACTIVE, within] },
    { operation: "count", unit: eachLearner, conditions: [COMPLETED, within] },
    { operation: "rate", conditions: [COMPLETED, within], population: [ACTIVE] },
    { operation: "rate", unit: eachLearner, conditions: [COMPLETED, within] },
  ]) {
    const fromProfile = D.deriveTabularMeasurement(profile, null, D.validateTabularMeasurementDefinition(input).definition, { reportingPeriod: period });
    const fromFile = fromRecords(profile, input, period);
    assert.equal(fromProfile.ok && fromFile.ok, true, JSON.stringify(input));
    assert.equal(fromFile.measurement.measurementKey, fromProfile.measurement.measurementKey, JSON.stringify(input));
    assert.deepEqual([fromFile.measurement.numerator, fromFile.measurement.denominator, fromFile.measurement.percentage],
      [fromProfile.measurement.numerator, fromProfile.measurement.denominator, fromProfile.measurement.percentage], JSON.stringify(input));
  }
});

test("records that are not the profiled file are refused, never counted", async () => {
  const profile = await csvProfile();
  const period = { start: "2025-02-12", end: "2025-04-15" };
  const records = readTrustedCsvRecords({ bytes: CSV_BYTES });
  const dropped = records.filter((record, index) => index !== 3);
  const moved = records.map((record, index) => (index === 3 ? [...record.slice(0, 4), "2025-05-02"] : record));
  // E15 has no date: removing it leaves every month's count unchanged, so only the record count shows the difference.
  assert.equal(records[15][0], "E15");
  const undatedDropped = records.filter((record, index) => index !== 15);
  for (const changed of [dropped, moved, undatedDropped, []]) {
    assert.equal(fromRecords(profile, { operation: "count", conditions: [within] }, period, changed).blockers[0].blocking_reason, "tabular_source_records_mismatch");
  }
});

test("the worksheet reader returns the profiled table with Excel date cells as days, or null", async () => {
  const typed = ["2026-01-05", "2026-01-20", "2026-02-02", "2026-02-27", "2026-03-16", "2025-12-31"];
  for (const name of ["synthetic-visits-excel-1900.xlsx", "synthetic-visits-excel-1904.xlsx"]) {
    const bytes = new Uint8Array(readFileSync(new URL(`./fixtures/excel-authored/${name}`, import.meta.url)));
    const records = await readTrustedWorksheetRecords({ bytes });
    assert.equal(records[0][0], "visit_ref");
    assert.deepEqual(records.slice(1).map((record) => record[1]), typed, name);
  }
  const twoSheets = syntheticXlsxWorkbook({ sheets: [{ name: "A", rows: [["ref"], ["R1"]] }, { name: "B", rows: [["ref", "day"], ["R1", "2026-01-05"], ["R2", ""]] }] });
  assert.equal(await readTrustedWorksheetRecords({ bytes: twoSheets }), null, "several worksheets need a selection");
  assert.deepEqual(await readTrustedWorksheetRecords({ bytes: twoSheets, sheetKey: "sheet_2" }), [["ref", "day"], ["R1", "2026-01-05"], ["R2", ""]]);
  const merged = syntheticXlsxWorkbook({ sheets: [{ name: "M", rows: [["ref", "day"], ["R1", "x"]], merged: ["A2:B2"] }] });
  assert.equal(await readTrustedWorksheetRecords({ bytes: merged }), null, "an ambiguous table is not read");
});

// Linked reach within one workbook: service events on one worksheet, the participant register on another.
const EVENTS = [
  ["ref", "person_ref", "state", "held_on"],
  ["V01", "P01", "done", "2026-01-05"], ["V02", "P01", "done", "2026-02-11"], ["V03", "P02", "done", "2026-01-20"],
  ["V04", "P02", "missed", "2026-02-24"], ["V05", "P03", "done", "2026-02-03"], ["V06", "P09", "done", "2026-02-17"],
  ["V07", "P04", "done", "2026-03-09"], ["V07", "P04", "done", "2026-03-09"], ["V08", "P05", "missed", "2026-01-26"],
  ["V09", "P05", "done", "2026-01-26"], ["V10", "P06", "done", "2026-01-15"], ["V11", "P06", "missed", "2026-01-16"],
  ["V12", "P07", "done", "2026-02-02"], ["V13", "P08", "done", "2026-02-09"],
];
const REGISTER = [["person_ref", "joined_on"], ...["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P10", "P11", "P12", "P13", "P14"].map((id) => [id, "2025-12-01"])];

test("linked reach between two worksheets of one workbook: the same governed method, both worksheets named, exact counts", async () => {
  const bytes = syntheticXlsxWorkbook({ sheets: [{ name: "Service_Events", rows: EVENTS }, { name: "Register", rows: REGISTER }] });
  const profile = await profileLocalTrustedFile({ extension: ".xlsx", declaredMime: SYNTHETIC_XLSX_MIME, byteSize: bytes.byteLength, bytes });
  const options = D.describeTabularMeasurementOptions(profile, "sheet_1");
  const done = options.fields.find((field) => field.field_key === "field_3").values.find((value) => value.label === "done").value_key;
  const mapping = D.validateCrossSourceReachMapping({
    events: { event_identifier_field_key: "field_1", participant_identifier_field_key: "field_2", status_field_key: "field_3", completed_value_key: done, date_field_key: "field_4" },
    register: { participant_identifier_field_key: "field_1" },
  }).mapping;
  const period = { start: "2026-01-01", end: "2026-03-31" };
  const resolve = (eventsWorksheetKey, registerWorksheetKey) => D.resolveCrossSourceReachMapping({ eventsProfile: profile, registerProfile: profile, mapping, reportingPeriod: period, eventsWorksheetKey, registerWorksheetKey, sameVersion: true });
  assert.equal(resolve("sheet_1", "sheet_1").blockers[0].blocking_reason, "cross_source_same_version", "never the same table on both sides");
  assert.equal(resolve(null, "sheet_2").ok, false, "a workbook with several worksheets needs the events worksheet");
  const resolved = resolve("sheet_1", "sheet_2");
  assert.equal(resolved.ok, true, JSON.stringify(resolved.blockers));
  assert.deepEqual([resolved.resolved.events_worksheet_key, resolved.resolved.register_worksheet_key], ["sheet_1", "sheet_2"]);
  const reconciliation = reconcileLinkedReach({
    eventRecords: await readTrustedWorksheetRecords({ bytes, sheetKey: "sheet_1" }),
    registerRecords: await readTrustedWorksheetRecords({ bytes, sheetKey: "sheet_2" }),
    mapping: D.crossSourceWorkerMapping(resolved.resolved),
  });
  // Oracle: distinct events (one copy of V07), completed, dated in the period, person in the register.
  const registered = new Set(REGISTER.slice(1).map((row) => row[0]));
  const events = [...new Map(EVENTS.slice(1).map((row) => [row[0], row])).values()];
  const eligible = events.filter((row) => row[2] === "done" && row[3] >= period.start && row[3] <= period.end && registered.has(row[1]));
  assert.deepEqual([reconciliation.counts.eligible_encounter_count, reconciliation.counts.distinct_person_count], [eligible.length, new Set(eligible.map((row) => row[1])).size]);
  assert.deepEqual([eligible.length, new Set(eligible.map((row) => row[1])).size], [9, 8]); // V07 once; P09 unmatched; V04, V08, V11 missed
  const measurements = D.deriveCrossSourceReachMeasurements({ resolved: resolved.resolved, eventFieldKeys: resolved.eventFieldKeys, reconciliation,
    reference: { sourceVersionId: "5a000000-0000-4000-8000-000000000001", profileCanonicalSha256: "a".repeat(64) } });
  const people = measurements.find((m) => m.definition.metric === "distinct_people_served");
  assert.deepEqual([people.sheetKey, people.definition.reference_worksheet_key, people.measuredValue], ["sheet_1", "sheet_2", 8]);
  const statement = D.composeDerivedMeasurementEvidenceStatement({ measurementRow: { ...asRow(people), measurement_family: people.family, worksheet_key: "sheet_1" } });
  assert.match(statement, /field_1 events in worksheet sheet_1, .* in register 5a000000-0000-4000-8000-000000000001 worksheet sheet_2 field_1/);
  assert.equal(D.derivedMeasurementArithmeticHolds({ ...asRow(people), measurement_family: people.family }), true);
});

test("a CSV linkage keeps its definition and identity: no worksheet enters it", async () => {
  const csv = (rows) => new TextEncoder().encode(`${rows.map((row) => row.join(",")).join("\n")}\n`);
  const eventsBytes = csv(EVENTS);
  const registerBytes = csv(REGISTER);
  const events = await profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: eventsBytes.byteLength, bytes: eventsBytes });
  const register = await profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: registerBytes.byteLength, bytes: registerBytes });
  const done = D.describeTabularMeasurementOptions(events, null).fields.find((field) => field.field_key === "field_3").values.find((value) => value.label === "done").value_key;
  const mapping = D.validateCrossSourceReachMapping({
    events: { event_identifier_field_key: "field_1", participant_identifier_field_key: "field_2", status_field_key: "field_3", completed_value_key: done, date_field_key: "field_4" },
    register: { participant_identifier_field_key: "field_1" },
  }).mapping;
  const resolved = D.resolveCrossSourceReachMapping({ eventsProfile: events, registerProfile: register, mapping, reportingPeriod: { start: "2026-01-01", end: "2026-03-31" } });
  assert.equal("events_worksheet_key" in resolved.resolved || "register_worksheet_key" in resolved.resolved, false);
  const reconciliation = reconcileLinkedReach({ eventRecords: readTrustedCsvRecords({ bytes: eventsBytes }), registerRecords: readTrustedCsvRecords({ bytes: registerBytes }), mapping: D.crossSourceWorkerMapping(resolved.resolved) });
  const measurements = D.deriveCrossSourceReachMeasurements({ resolved: resolved.resolved, eventFieldKeys: resolved.eventFieldKeys, reconciliation, reference: { sourceVersionId: "5a000000-0000-4000-8000-000000000001", profileCanonicalSha256: "a".repeat(64) } });
  assert.ok(measurements.length > 0);
  for (const measurement of measurements) {
    assert.equal(measurement.sheetKey, null);
    assert.equal("reference_worksheet_key" in measurement.definition, false);
  }
  assert.equal(measurements.find((m) => m.definition.metric === "distinct_people_served").measuredValue, 8);
});

test("targets: validated by unit, compared with the recorded actual in exact arithmetic, and worded as a plan", () => {
  const count = { measurement_family: "tabular_count", measured_value: 9 };
  const rate = { measurement_family: "tabular_rate", percentage: "81.82" };
  assert.deepEqual(D.validateMeasurementTargetInput({ target_value: "40", comparison: "at_least" }, { family: "tabular_count" }).target, { unit: "count", targetValue: "40", comparison: "at_least" });
  assert.equal(D.validateMeasurementTargetInput({ target_value: "999999999999", comparison: "at_least" }, { family: "cross_source_reach" }).target.targetValue, "999999999999");
  assert.deepEqual(D.validateMeasurementTargetInput({ target_value: 75.5, comparison: "at_most" }, { family: "tabular_rate" }).target, { unit: "percent", targetValue: "75.50", comparison: "at_most" });
  for (const [input, family] of [
    [{ target_value: "40.5", comparison: "at_least" }, "tabular_count"], [{ target_value: "-1", comparison: "at_least" }, "tabular_count"],
    [{ target_value: "100.01", comparison: "at_least" }, "tabular_rate"], [{ target_value: "40", comparison: "about" }, "tabular_count"],
    [{ target_value: "40", comparison: "at_least", note: "x" }, "tabular_count"],
    [{ target_value: "1000000000000", comparison: "at_least" }, "tabular_count"], // 13 digits do not fit numeric(14, 2)
  ]) assert.equal(D.validateMeasurementTargetInput(input, { family }).ok, false, JSON.stringify(input));
  // Oracle: 9 against at least 40 is 31 below, 9/40 = 22.50%; 81.82% against at least 75% is 6.82 points above.
  const below = D.composeMeasurementTargetComparison({ measurementRow: count, target: { target_unit: "count", target_value: "40.00", comparison: "at_least" } });
  assert.deepEqual([below.actual, below.difference, below.share_of_target, below.met], ["9", "-31", "22.50", false]);
  assert.match(below.text, /^Planned target \(stated by the organization\): at least 40\. Recorded actual: 9, 31 below the target \(22\.50% of it\); the target is not met\./);
  assert.match(below.text, /not an achieved outcome/);
  const above = D.composeMeasurementTargetComparison({ measurementRow: rate, target: { target_unit: "percent", target_value: "75.00", comparison: "at_least" } });
  assert.deepEqual([above.difference, above.met], ["6.82", true]);
  const ceiling = D.composeMeasurementTargetComparison({ measurementRow: count, target: { target_unit: "count", target_value: "9.00", comparison: "at_most" } });
  assert.deepEqual([ceiling.difference, ceiling.met], ["0", true]);
  assert.match(ceiling.text, /equal to the target/);
  assert.equal(D.composeMeasurementTargetComparison({ measurementRow: count, target: { target_unit: "percent", target_value: "40.00", comparison: "at_least" } }), null, "a unit mismatch is never compared");
  assert.equal(D.composeMeasurementTargetComparison({ measurementRow: count, target: null }), null);
});

test("the request path links one version only as two different worksheets, refusing before any read otherwise", async () => {
  const { createPostgresDerivedMeasurementRepository } = await import("../Backend/kai/dictionary/postgresDerivedMeasurementRepository.js");
  const entered = [];
  const repository = createPostgresDerivedMeasurementRepository({
    runInTransaction: async () => { entered.push("transaction"); return { ok: false, data: null, error: { code: "probe_reached_transaction" } }; },
  });
  const version = "5a000000-0000-4000-8000-000000000001";
  const request = (primaryWorksheetKey, referenceWorksheetKey, referenceSourceVersionId = version) => repository.requestCrossSourceReachMeasurements({
    organizationId: "5b000000-0000-4000-8000-000000000001", primarySourceVersionId: version, referenceSourceVersionId,
    primaryWorksheetKey, referenceWorksheetKey, mapping: {}, enqueue: async () => assert.fail("nothing is queued"),
  });
  for (const [primary, reference] of [[null, null], ["sheet_1", null], [null, "sheet_2"], ["sheet_1", "sheet_1"]]) {
    const refused = await request(primary, reference);
    assert.deepEqual([refused.ok, refused.error.status, refused.error.blockers[0].blocking_reason], [false, 422, "cross_source_same_version"], `${primary}/${reference}`);
  }
  assert.deepEqual(entered, [], "refused before any transaction");
  assert.equal((await request("sheet_1", "sheet_2")).error.code, "probe_reached_transaction", "two worksheets of one workbook proceed to the shared loader");
  assert.equal((await request(null, null, "5a000000-0000-4000-8000-000000000002")).error.code, "probe_reached_transaction", "two versions proceed as before");
});

test("an unchanged target is recognized against its stored numeric(14,2) value, so it replays instead of superseding", async () => {
  const { __derivedMeasurementRepositoryContract: { sameTargetValue } } = await import("../Backend/kai/dictionary/postgresDerivedMeasurementRepository.js");
  // The stored text is what PostgreSQL returns for numeric(14,2); the validated text is what validateMeasurementTargetInput returns.
  const count = D.validateMeasurementTargetInput({ target_value: "40", comparison: "at_least" }, { family: "tabular_count" }).target.targetValue;
  const percent = D.validateMeasurementTargetInput({ target_value: "75.5", comparison: "at_least" }, { family: "tabular_rate" }).target.targetValue;
  assert.deepEqual([count, percent], ["40", "75.50"]);
  for (const [stored, validated, same] of [["40.00", count, true], ["75.50", percent, true], ["40.00", "41", false], ["75.50", "75.05", false], ["0.00", "0", true], ["999999999999.00", "999999999999", true], ["40.00", "", false], [null, "40", false]]) {
    assert.equal(sameTargetValue(stored, validated), same, `${stored} vs ${validated}`);
  }
});
