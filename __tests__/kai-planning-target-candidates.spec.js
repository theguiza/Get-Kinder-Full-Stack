import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { profileLocalTrustedFile, readTrustedWorksheetRecords } from "../Backend/kai/profiling/localProfilingKernel.js";
import { createCrossSourceReconciliationWorker } from "../Backend/kai/parsing/crossSourceReconciliationWorker.js";
import { derivePersistablePairedOutcomes, describeTabularMeasurementOptions } from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import {
  MAX_PLANNING_TARGET_ROWS,
  assessPlanningTargetRecords,
  assessPlanningTargetRelationship,
  relatedRecordedMeasurements,
} from "../Backend/kai/validators/kaiPlanningTargetCandidates.js";
import { planningTargetWorksheet, readPlanningTargetCandidates } from "../Backend/kai/dictionary/planningTargetCandidateRead.js";
import { planningTargetCheckLabel, planningTargetRowsText } from "../frontend/knowledgeStudio/clientDerivedMeasurementLogic.js";
import { syntheticXlsxWorkbook, SYNTHETIC_XLSX_MIME } from "./support/kaiSyntheticXlsxWorkbook.js";

// ---------------------------------------------------------------------------
// An independent oracle: a minimal ZIP + SpreadsheetML reader written for this
// test only (central directory, raw inflate, shared/inline strings, numbers).
// It shares no code with KAI's parser, profiler or measurement functions.

function independentWorkbook(bytes) {
  const buffer = Buffer.from(bytes);
  let eocd = buffer.length - 22;
  while (buffer.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressed);
    entries.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  const decode = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const textOf = (xml) => decode([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
  const shared = [...(entries.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const rels = new Map([...entries.get("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => [/Id="([^"]+)"/.exec(m[0])[1], /Target="([^"]+)"/.exec(m[0])[1].replace(/^\/?(xl\/)?/, "xl/")]));
  const sheets = new Map();
  for (const m of entries.get("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(/name="([^"]+)"/.exec(m[0])[1]);
    const xml = entries.get(rels.get(/r:id="([^"]+)"/.exec(m[0])[1]));
    const rows = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const values = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+)\d+"/.exec(cell[1])[1];
        const column = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const type = /t="([^"]+)"/.exec(cell[1])?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(cell[2] ?? "")?.[1];
        values[column] = type === "s" ? shared[Number(v)] : type === "inlineStr" ? textOf(cell[2] ?? "") : v === undefined ? "" : decode(v);
      }
      rows.push(Array.from({ length: values.length }, (_, i) => values[i] ?? ""));
    }
    sheets.set(name, rows);
  }
  return sheets;
}

function asObjects(rows) {
  const [header, ...data] = rows;
  return data.map((row, index) => Object.fromEntries([...header.map((h, i) => [h, row[i] ?? ""]), ["_row", index + 2]]));
}

const packagePath = process.env.KAI_WILLOW_QUAY_PACKAGE;
const workbookPath = packagePath ? join(packagePath, "01_UPLOAD_TO_KAI/04_Surveys_Referrals_and_Targets.xlsx") : null;
const originalSkip = !workbookPath || !existsSync(workbookPath) ? "set KAI_WILLOW_QUAY_PACKAGE to the synthetic package" : false;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

test("original Willow Quay workbook: Delivery_Targets rows become six screened planned-target candidates with exact row locators; no other worksheet is a planning table", { skip: originalSkip }, async () => {
  const bytes = new Uint8Array(readFileSync(workbookPath));
  const oracle = asObjects(independentWorkbook(bytes).get("Delivery_Targets"));
  assert.equal(oracle.length, 6, "the independent reader finds six planning rows");
  const records = await readTrustedWorksheetRecords({ bytes, sheetKey: "sheet_3", declaredMime: XLSX_MIME });
  const assessed = assessPlanningTargetRecords(records, { worksheetKey: "sheet_3" });
  assert.equal(assessed.status, "candidates");
  assert.deepEqual(Object.fromEntries(Object.entries(assessed.columns).map(([role, c]) => [role, c.column])),
    { value: "C", indicator: "A", unit: "D", period: "E", scope: "B", status: "F", note: "G" });
  assert.equal(assessed.candidates.length, oracle.length);
  for (const [index, row] of oracle.entries()) {
    const candidate = assessed.candidates[index];
    const [start, end] = row.reporting_period.split(" to ");
    assert.deepEqual(
      [candidate.row_number, candidate.indicator, candidate.planned_value, candidate.unit, candidate.unit_kind, candidate.period, candidate.scope, candidate.status_label],
      [row._row, row.indicator, String(Number(row.target_value)), row.unit, "count", { start, end }, row.program, row.target_status],
      `row ${row._row} matches the independent reading`,
    );
    assert.equal(candidate.comparator, null, "no comparison column: at least / at most is never assumed");
    const codes = candidate.limitations.map((item) => item.code);
    assert.ok(codes.includes("comparison_not_stated") && codes.includes("note_not_shown"));
    assert.equal(codes.includes("scope_is_subset"), row.program !== "all", `row ${row._row} programme scope`);
  }
  assert.doesNotMatch(JSON.stringify(assessed), /Planning target; not observed reach|not verified referral completion|Unique completed eligible/, "free-text notes never leave the assessment");
  for (const key of ["sheet_1", "sheet_2"]) {
    const other = assessPlanningTargetRecords(await readTrustedWorksheetRecords({ bytes, sheetKey: key, declaredMime: XLSX_MIME }), { worksheetKey: key });
    assert.equal(other.status, "not_planning_targets", `${key} has no planning columns`);
  }
});

test("original Willow Quay workbook: independent survey pairing and referral frequency agree with KAI (32/43, 31/41, 9/49)", { skip: originalSkip }, async () => {
  const bytes = new Uint8Array(readFileSync(workbookPath));
  const sheets = independentWorkbook(bytes);
  const surveys = asObjects(sheets.get("Self_Rating_Surveys"));
  const referrals = asObjects(sheets.get("Referral_Followups"));
  assert.equal(surveys.length, 121);
  assert.equal(referrals.length, 49);
  assert.equal(new Set(surveys.map((s) => s.survey_id)).size, 121, "no duplicate survey observations");
  assert.ok(surveys.every((s) => s.response_date >= "2025-04-01" && s.response_date <= "2026-03-31"));
  // Oracle: one baseline and one follow-up per household key; same instrument
  // version; both ratings numeric; strictly greater counts as higher.
  const byHousehold = new Map();
  for (const s of surveys) {
    const entry = byHousehold.get(s.household_id) ?? { baseline: [], followup: [] };
    entry[s.survey_stage].push(s);
    byHousehold.set(s.household_id, entry);
  }
  const oracle = (field) => {
    const out = { higher: 0, same: 0, lower: 0, unpaired: 0, version: 0, missing: 0 };
    for (const { baseline, followup } of byHousehold.values()) {
      if (baseline.length !== 1 || followup.length !== 1) { out.unpaired += 1; continue; }
      if (baseline[0].instrument_version !== followup[0].instrument_version) { out.version += 1; continue; }
      const [b, f] = [baseline[0][field], followup[0][field]];
      if (b === "" || f === "") { out.missing += 1; continue; }
      if (Number(f) > Number(b)) out.higher += 1; else if (Number(f) === Number(b)) out.same += 1; else out.lower += 1;
    }
    const comparable = out.higher + out.same + out.lower;
    return { ...out, comparable, percentage: (Math.round((out.higher / comparable) * 10000) / 100).toFixed(2) };
  };
  const food = oracle("food_planning_confidence_1to5");
  const meal = oracle("affordable_meal_confidence_1to5");
  assert.deepEqual([food.higher, food.comparable, food.percentage, food.same, food.lower, food.unpaired + food.version + food.missing], [32, 43, "74.42", 6, 5, 28]);
  assert.deepEqual([meal.higher, meal.comparable, meal.percentage, meal.same, meal.lower, meal.unpaired + meal.version + meal.missing], [31, 41, "75.61", 7, 3, 30]);
  assert.equal(byHousehold.size, 71, "71 household keys; pairs are households, not people");

  const profile = await profileLocalTrustedFile({ extension: ".xlsx", declaredMime: XLSX_MIME, byteSize: bytes.length, bytes });
  const paired = derivePersistablePairedOutcomes(profile, "sheet_1");
  assert.equal(paired.ok, true);
  assert.deepEqual(paired.measurements.map((m) => [m.numerator, m.denominator, m.percentage, m.componentCounts.unchanged_count, m.componentCounts.decreased_count, m.componentCounts.excluded_participant_count]),
    [[food.higher, food.comparable, food.percentage, food.same, food.lower, 28], [meal.higher, meal.comparable, meal.percentage, meal.same, meal.lower, 30]]);
  assert.ok(paired.measurements.every((m) => m.definition.matching_unit === "household"));

  // Referral oracle: all 49 records are the denominator (no blank outcome, no
  // duplicate referral id); the numerator is the exact source value.
  assert.equal(new Set(referrals.map((r) => r.referral_id)).size, 49);
  assert.equal(referrals.filter((r) => r.contact_outcome === "").length, 0);
  const reported = referrals.filter((r) => r.contact_outcome === "reported_contact");
  assert.equal(reported.length, 9);
  const inPeriod = (day) => day >= '2025-04-01' && day <= '2026-03-31';
  assert.deepEqual(['referral_date','followup_date'].map((key) => reported.filter((r) => inPeriod(r[key])).length), [9,8], 'independent fiscal date alternatives');
  assert.ok(reported.every((r) => r.independently_verified === "no" && r.source_of_outcome === "household_self_report"), "self-reported, never independently verified");
  assert.equal(referrals.filter((r) => r.referral_date > "2026-03-31").length, 2, "two referrals fall after the fiscal year: the all-date rate is not a Project-period rate");
  const ready = describeTabularMeasurementOptions(profile, "sheet_2").ready_measurements.find((m) => m.label.startsWith("reported_contact "));
  assert.deepEqual([ready.numerator, ready.denominator, ready.percentage], [reported.length, referrals.length, (Math.round(reported.length / referrals.length * 10000) / 100).toFixed(2)]);
  assert.deepEqual(ready.definition, { operation: "rate", conditions: [{ kind: "category", field_key: "field_5", value_key: ready.definition.conditions[0].value_key }] }, "all records are the population; no date scope");
  if (process.env.KAI_MEASUREMENT_SCREENSHOTS) {
    const dir=process.env.KAI_MEASUREMENT_SCREENSHOTS;mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'source-record-oracle.json'),JSON.stringify({source_file:'04_Surveys_Referrals_and_Targets.xlsx',source_sha256:createHash('sha256').update(bytes).digest('hex'),
      worksheets:{Self_Rating_Surveys:surveys.length,Referral_Followups:referrals.length,Delivery_Targets:sheets.get('Delivery_Targets').length-1},
      matching_unit:'household',household_keys:byHousehold.size,scope:'all source dates',food,meal,
      referral:{numerator:reported.length,denominator:referrals.length,percentage:(reported.length/referrals.length*100).toFixed(2),fiscal_referral_date:reported.filter((r)=>inPeriod(r.referral_date)).length,fiscal_followup_date:reported.filter((r)=>inPeriod(r.followup_date)).length,independently_verified:false},
      targets:asObjects(sheets.get('Delivery_Targets')).map((r)=>({row:r._row,indicator:r.indicator,programme:r.program,value:r.target_value,unit:r.unit,period:r.reporting_period,comparison:null})),
    },null,2));
  }

});

// ---------------------------------------------------------------------------
// Synthetic positive and negative planning rows (always run).

const PLAN_HEADERS = ["indicator", "program", "target_value", "unit", "reporting_period", "target_status", "comparison", "notes"];
const PLAN_ROWS = [
  ["completed_sessions", "all", 40, "sessions", "2026-01-01 to 2026-03-31", "planned", "at least", "Completed sessions only."],
  ["session_completion_rate", "all", "80%", "", "2026-01-01 to 2026-03-31", "planned", "at least", ""],
  ["completed_sessions", "all", 45, "sessions", "2026-01-01 to 2026-03-31", "revised", "at_least", ""],
  ["Maria Lopez", "all", 3, "visits", "2026-01-01 to 2026-03-31", "planned", "", ""],
  ["cancelled_sessions", "Outreach", 5, "sessions", "FY26", "planned", "at most", ""],
  ["volunteer_hours", "all", "TBD", "hours", "2026-01-01 to 2026-03-31", "planned", "around", ""],
  ["", "", "", "", "", "", "", ""],
  ["average_rating", "all", 4.255, "points", "2026-01-01 to 2026-03-31", "planned", "", ""],
  ["referrals_made", "all", 12, "", "", "", "", ""],
];

test("synthetic planning rows: exact candidates where stated, a named limitation instead of a guess everywhere else", () => {
  const assessed = assessPlanningTargetRecords([PLAN_HEADERS, ...PLAN_ROWS.map((row) => row.map((v) => (v === null ? "" : String(v))))], { worksheetKey: "sheet_2" });
  assert.equal(assessed.status, "candidates");
  assert.equal(assessed.blank_row_count, 1);
  const byRow = new Map(assessed.candidates.map((c) => [c.row_number, c]));
  const codes = (row) => byRow.get(row).limitations.map((item) => item.code).sort();
  const first = byRow.get(2);
  assert.deepEqual([first.indicator, first.planned_value, first.unit, first.unit_kind, first.period, first.comparator, first.scope_applies_to_all, first.has_note],
    ["completed_sessions", "40", "sessions", "count", { start: "2026-01-01", end: "2026-03-31" }, "at_least", true, true]);
  assert.deepEqual(codes(2), ["duplicate_target_rows", "note_not_shown"]);
  assert.deepEqual(byRow.get(2).duplicate_rows, [4]);
  assert.deepEqual([byRow.get(3).planned_value, byRow.get(3).unit_kind, codes(3)], ["80", "percent", []], "a percent sign states a percentage");
  assert.deepEqual([byRow.get(5).indicator, codes(5)], [null, ["comparison_not_stated", "indicator_withheld"]], "a name-shaped indicator is withheld, never shown");
  assert.deepEqual([byRow.get(6).comparator, byRow.get(6).period, byRow.get(6).scope, codes(6)], ["at_most", null, null, ["period_not_recognized", "scope_is_subset", "scope_withheld"]],
    "a title-case scope word is withheld by the same screen as a category value");
  assert.deepEqual([byRow.get(7).planned_value, codes(7)], [null, ["comparison_not_recognized", "planned_value_not_numeric"]]);
  assert.ok(!byRow.has(8), "a blank row is not a candidate");
  assert.deepEqual([byRow.get(9).planned_value, codes(9)], [null, ["comparison_not_stated", "planned_value_precision_unsupported"]]);
  assert.deepEqual(codes(10), ["comparison_not_stated", "period_not_stated", "unit_not_stated"]);
  assert.doesNotMatch(JSON.stringify(assessed), /Maria|Lopez|Completed sessions only/);

  const startEnd = assessPlanningTargetRecords([["Metric", "Goal", "Units", "Start date", "End date"], ["attendances", "95", "encounters", "2025-04-01", "2026-03-31"], ["visits", "10", "visits", "2026-04-01", "2026-03-31"]]);
  assert.deepEqual(startEnd.candidates.map((c) => [c.indicator, c.planned_value, c.period]), [["attendances", "95", { start: "2025-04-01", end: "2026-03-31" }], ["visits", "10", null]]);
  assert.equal(assessPlanningTargetRecords([["indicator", "target", "target_value"], ["a", "1", "2"]]).status, "planning_columns_ambiguous", "two planned-value columns: KAI does not choose");
  assert.equal(assessPlanningTargetRecords([["survey_id", "household_id", "score"], ["S1", "H1", "3"]]).status, "not_planning_targets");
  const many = [["indicator", "target_value"], ...Array.from({ length: MAX_PLANNING_TARGET_ROWS + 1 }, (_, i) => [`metric_${"abcdefghij"[i % 10]}`, "1"])];
  assert.equal(assessPlanningTargetRecords(many).status, "too_many_rows");
});

const CANDIDATE = Object.freeze({
  indicator: "completed_sessions", planned_value: "40", unit: "sessions", unit_kind: "count", period: { start: "2026-01-01", end: "2026-03-31" },
  scope: "all", scope_applies_to_all: true, comparator: "at_least", limitations: [],
});
function countRow(overrides = {}) {
  return {
    source_derived_measurement_id: "m-count", source_version_id: "sv-1", worksheet_key: "sheet_1", engagement_id: "p-1", is_current: true, contributing_sources_current: true,
    measurement_family: "tabular_count", measured_value: 7, numerator: 7, denominator: null, percentage: null, indicator_label: "Completed sessions",
    definition: { operation: "count", unit: { kind: "records" }, conditions: [
      { kind: "category", field_key: "field_2", value_key: "value_1", value_label: "completed" },
      { kind: "period", field_key: "field_3", period_source: "engagement_reporting_period", scope: "within", period_start: "2026-01-01", period_end: "2026-03-31" }], population: [] },
    ...overrides,
  };
}

test("relationship checks: a compatible count still needs the organization's confirmation; unit, period, Project and currentness differences are named", () => {
  const compatible = assessPlanningTargetRelationship({ candidate: CANDIDATE, measurement: countRow(), planningEngagementId: "p-1", measurementEngagementId: "p-1" });
  assert.equal(compatible.status, "confirmation_required");
  assert.deepEqual(compatible.checks.map((c) => [c.key, c.result]), [["project", "pass"], ["currentness", "pass"], ["unit", "pass"], ["period", "pass"], ["comparison", "pass"], ["meaning", "confirm"]]);
  assert.equal(compatible.checks.find((c) => c.key === "period").text, "Both cover 2026-01-01 to 2026-03-31 (the result applies it to column C).", "the date column that defines the period is named");
  const rate = assessPlanningTargetRelationship({ candidate: CANDIDATE, measurement: countRow({ measurement_family: "tabular_rate", numerator: 7, denominator: 9, percentage: "77.78" }), planningEngagementId: "p-1", measurementEngagementId: "p-1" });
  assert.equal(rate.status, "not_comparable");
  assert.match(rate.checks.find((c) => c.key === "unit").text, /count of "sessions"; this result is a percentage of source records/);
  const allDates = countRow({ definition: { operation: "count", unit: { kind: "records" }, conditions: [], population: [] } });
  assert.equal(assessPlanningTargetRelationship({ candidate: CANDIDATE, measurement: allDates, planningEngagementId: "p-1", measurementEngagementId: "p-1" }).checks.find((c) => c.key === "period").text,
    "This result covers all dates in its source, not 2026-01-01 to 2026-03-31.");
  const otherPeriod = countRow({ definition: { ...countRow().definition, conditions: [{ kind: "period", field_key: "field_3", period_source: "engagement_reporting_period", scope: "within", period_start: "2025-10-01", period_end: "2025-12-31" }] } });
  assert.equal(assessPlanningTargetRelationship({ candidate: CANDIDATE, measurement: otherPeriod, planningEngagementId: "p-1", measurementEngagementId: "p-1" }).status, "not_comparable");
  assert.equal(assessPlanningTargetRelationship({ candidate: CANDIDATE, measurement: countRow(), planningEngagementId: "p-1", measurementEngagementId: "p-2" }).checks[0].result, "fail");
  assert.equal(assessPlanningTargetRelationship({ candidate: CANDIDATE, measurement: countRow({ is_current: false }), planningEngagementId: "p-1", measurementEngagementId: "p-1" }).status, "not_comparable");
  const subset = assessPlanningTargetRelationship({ candidate: { ...CANDIDATE, scope: "PA", scope_applies_to_all: false, comparator: null }, measurement: countRow(), planningEngagementId: "p-1", measurementEngagementId: "p-1" });
  assert.deepEqual(subset.checks.filter((c) => c.result === "confirm").map((c) => c.key), ["comparison", "scope", "meaning"]);
  const paired = assessPlanningTargetRelationship({ candidate: { ...CANDIDATE, indicator: "matched_food_planning_surveys", unit: "comparable_households" },
    measurement: countRow({ measurement_family: "paired_outcome_change", numerator: 32, denominator: 43, percentage: "74.42", indicator_label: null, source_heading_label: "Food planning confidence (1-5)", definition: { outcome_field_key: "field_6" } }),
    planningEngagementId: "p-1", measurementEngagementId: "p-1" });
  assert.deepEqual(paired.checks.filter((c) => c.result === "fail").map((c) => c.key), ["unit", "period"], "a count of comparable households is not the paired percentage");

  const related = relatedRecordedMeasurements({ candidate: CANDIDATE, planningEngagementId: "p-1", measurements: [
    countRow(), countRow({ source_derived_measurement_id: "m-other-project", engagement_id: "p-2" }),
    countRow({ source_derived_measurement_id: "m-unrelated", indicator_label: "Volunteer hours" }),
    countRow({ source_derived_measurement_id: "m-shared-words", indicator_label: null, definition: { operation: "count", unit: { kind: "records" }, conditions: [{ kind: "category", field_key: "field_9", value_key: "value_1", value_label: "completed_sessions_flag" }], population: [] } }),
  ] });
  assert.deepEqual(related.map((r) => [r.source_derived_measurement_id, r.proposed_because]), [["m-count", "same_indicator_label"], ["m-shared-words", "shared_name_words"]]);
  assert.equal(relatedRecordedMeasurements({ candidate: { ...CANDIDATE, indicator: null }, planningEngagementId: "p-1", measurements: [countRow()] }).length, 0, "a withheld indicator proposes nothing");
});

// ---------------------------------------------------------------------------
// The worker and the read helper: verified bytes only, screened output only, no writes.

const workbook = syntheticXlsxWorkbook({ sheets: [
  { name: "Sessions", rows: [["session_id", "status", "session_date"], ["S1", "completed", "2026-01-05"], ["S2", "cancelled", "2026-01-06"]] },
  { name: "Targets", rows: [PLAN_HEADERS, ...PLAN_ROWS.slice(0, 3)] },
] });
const checksum = createHash("sha256").update(workbook).digest("hex");
function worker(options = {}) {
  return createCrossSourceReconciliationWorker({
    lockEligibleIntakeFile: async () => options.eligible !== false,
    readEligibilityFacts: async () => ({ organization_id: "o1", object_version_id: "v1", verified_checksum: checksum, verified_size_bytes: workbook.length,
      file_extension: ".xlsx", mime_type: SYNTHETIC_XLSX_MIME, storage_provider: "local", storage_object_key: "synthetic.xlsx" }),
    storageAdapter: { async readObjectVersion() { return { ok: true, data: { bytes: options.bytes ?? workbook } }; } },
  });
}

test("worker: planned-target candidates come only from the admitted, exact verified upload, as screened candidates", async () => {
  const input = { organizationId: "o1", intakeFileId: "f1", checksum, worksheetKey: "sheet_2" };
  const read = await worker().readPlanningTargetCandidates(null, input);
  assert.deepEqual([read.ok, read.sheetKey, read.dataRecordCount, read.assessment.status, read.assessment.candidates.length], [true, "sheet_2", 3, "candidates", 3]);
  assert.equal(Object.hasOwn(read, "records"), false);
  assert.doesNotMatch(JSON.stringify(read), /Completed sessions only/, "the note text never leaves the worker");
  assert.equal((await worker({ eligible: false }).readPlanningTargetCandidates(null, input)).reason, "cross_source_upload_not_eligible");
  assert.equal((await worker({ bytes: new Uint8Array(workbook).fill(0) }).readPlanningTargetCandidates(null, input)).reason, "cross_source_checksum_mismatch");
  assert.equal((await worker().readPlanningTargetCandidates(null, { ...input, worksheetKey: null })).reason, "planning_target_worksheet_required");
  assert.equal((await worker().readPlanningTargetCandidates(null, { ...input, worksheetKey: "sheet_9" })).ok, false);
});

test("read helper: only plausible planning worksheets are read; a changed table or unreadable upload is stated; related results stay on the Project; nothing is written", async () => {
  const profile = await profileLocalTrustedFile({ extension: ".xlsx", declaredMime: SYNTHETIC_XLSX_MIME, byteSize: workbook.length, bytes: workbook });
  assert.equal(planningTargetWorksheet(profile, "sheet_2")?.sheet_key, "sheet_2");
  assert.equal(planningTargetWorksheet(profile, "sheet_1"), null, "no numeric column: never read");
  assert.equal(planningTargetWorksheet(profile, "sheet_2", { pairedAvailable: true }), null, "a survey worksheet is never read as a plan");
  const queries = [];
  const tx = { query: async (sql) => { queries.push(sql); return { rows: [] }; } };
  const fileProfileRow = { intake_file_id: "f1", checksum, profile_canonical_sha256: "a".repeat(64) };
  const common = { readMeasurementPermissions:async (_tx,{ measurements }) => new Map(measurements.map((r) => [r.source_derived_measurement_id,true])), organizationId: "o1", fileProfileRow, profile, worksheetKey: "sheet_2", sourceVersionRow: { source_version_id: "sv-1", source_id: "s-1" }, engagementId: "p-1", pairedAvailable: false };
  const listed = [];
  const listProjectMeasurements = async (args) => { listed.push(args); return [
    { ...countRow(), interpretation_id: "i1", current_interpretation_id: "i1", contributing_sources: [], measurement_source_is_current: true, measurement_source_version_id: "sv-1" },
    { ...countRow({ source_derived_measurement_id: "m-withheld", indicator_label: null, definition: { operation: "count", unit: { kind: "records" }, conditions: [{ kind: "category", field_key: "field_2", value_key: "value_1", value_label: "Maria Lopez completed sessions" }], population: [] } }),
      interpretation_id: null, current_interpretation_id: null, contributing_sources: [], measurement_source_is_current: true, measurement_source_version_id: "sv-1" },
  ]; };
  const result = await readPlanningTargetCandidates(tx, { ...common, worker: worker(), listProjectMeasurements });
  assert.equal(result.status, "candidates");
  assert.deepEqual(listed, [{ organizationId: "o1", engagementId: "p-1" }]);
  const first = result.candidates.find((c) => c.row_number === 2);
  assert.deepEqual(first.locator, { source_version_id: "sv-1", worksheet_key: "sheet_2", worksheet_name: "Targets", row_number: 2,
    field_keys: { value: "field_3", indicator: "field_1", unit: "field_4", period: "field_5", scope: "field_2", status: "field_6", comparator: "field_7", note: "field_8" } });
  assert.deepEqual(first.related_measurements.map((r) => [r.source_derived_measurement_id, r.relationship.status]), [["m-count", "confirmation_required"]], "a result named from withheld labels is never proposed");
  assert.equal(result.persistence.available, true);
  assert.match(result.persistence.message, /Save each planned target for reports/);
  assert.ok(queries.length === 1 && queries.every((sql) => /^SELECT/.test(sql)), "only reads saved plans; discovery accepts nothing");
  const changedProfile = JSON.parse(JSON.stringify(profile));
  changedProfile.sheets[1].record_count_basis.data_record_count = 4;
  assert.equal((await readPlanningTargetCandidates(tx, { ...common, profile: changedProfile, worker: worker(), listProjectMeasurements })).reason, "planning_worksheet_changed");
  const unreadable = await readPlanningTargetCandidates(tx, { ...common, worker: worker({ eligible: false }), listProjectMeasurements });
  assert.deepEqual([unreadable.status, unreadable.reason], ["not_assessable", "cross_source_upload_not_eligible"]);
  assert.equal(await readPlanningTargetCandidates(tx, { ...common, worksheetKey: "sheet_1", worker: worker(), listProjectMeasurements }), null);
});

test("planning target display words", () => {
  assert.equal(planningTargetRowsText([{ row_number: 7 }, { row_number: 2 }, { row_number: 3 }, { row_number: 4 }, { row_number: 5 }, { row_number: 6 }]), "rows 2-7");
  assert.equal(planningTargetRowsText([{ row_number: 2 }, { row_number: 4 }, { row_number: 9 }]), "rows 2, 4 and 9");
  assert.equal(planningTargetRowsText([{ row_number: 3 }]), "row 3");
  assert.deepEqual(["pass", "fail", "confirm"].map(planningTargetCheckLabel), ["Matches", "Differs", "Needs your confirmation"]);
});
