import test from "node:test";
import assert from "node:assert/strict";

import { profileLocalTrustedFile } from "../Backend/kai/profiling/localProfilingKernel.js";
import { TABULAR_MEASUREMENT_BASIS_VERSION } from "../Backend/kai/profiling/tabularMeasurementBasis.js";
import * as D from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import { composeEvidenceSummaryMeasurementDisclosures, validateGeneratedContentDraft } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { syntheticXlsxWorkbook, SYNTHETIC_XLSX_MIME } from "./support/kaiSyntheticXlsxWorkbook.js";
import {
  derivedMeasurementBasisPath,
  derivedMeasurementInterpretationPath,
  interpretationBody,
  pairedOutcomeMeasurementsPath,
  tabularDefinitionBody,
  tabularFormProblem,
  tabularMeasurementPath,
  EMPTY_TABULAR_FORM,
} from "../frontend/knowledgeStudio/clientDerivedMeasurementLogic.js";

/**
 * Measurement MVP: the shared source-derived measurement contract, pure.
 * Synthetic data only, with generic field names; every expected value is
 * recomputed here from the same rows by a calculation that shares no code
 * with KAI. The connected, real-PostgreSQL proofs are the P2-01M integration
 * spec and the Cedar Bridge six-source acceptance.
 */

// Invented visits: a repeated row (V02 twice), one identifier on two dates
// months (V07), a singleton status, a status label the profile may not hold, dates
// in and out of a period, and a blank row.
const ROWS = [
  ["visit_ref", "outcome", "visit_date", "channel", "minutes"],
  ["V01", "done", "2025-05-01", "phone_call", "30"],
  ["V02", "done", "2025-06-01", "video", "45"],
  ["V02", "done", "2025-06-01", "video", "45"],
  ["V03", "missed", "2025-07-01", "video", ""],
  ["V04", "done", "2026-04-02", "in_person", "60"],
  ["V05", "missed", "2025-08-01", "in_person", "30"],
  ["V06", "late", "2025-09-01", "video", "30"],
  ["V07", "done", "2025-10-01", "in_person", "30"],
  ["V07", "done", "2025-11-02", "in_person", "30"],
  ["", "", "", "", ""],
];
const CSV = `${ROWS.map((row) => row.join(",")).join("\n")}\n`;
const PERIOD = { start: "2025-04-01", end: "2026-03-31" };

async function csvProfile(text = CSV) {
  const bytes = new TextEncoder().encode(text);
  return profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: bytes.byteLength, bytes });
}

// Independent calculation over the same rows.
const records = ROWS.slice(1).filter((row) => row.some((cell) => cell !== ""));
const independent = {
  records: records.length,
  distinct: (rows) => new Set(rows.map((row) => row[0]).filter(Boolean)).size,
  where: (column, value) => records.filter((row) => row[column] === value),
  inPeriod: (row) => row[2] >= PERIOD.start && row[2] <= PERIOD.end,
};

function asRow(measurement, interpretation = null) {
  return {
    measurement_family: measurement.family, calculation_method: measurement.calculationMethod, worksheet_key: measurement.sheetKey,
    definition: measurement.definition, field_keys: measurement.fieldKeys, measured_value: measurement.measuredValue, numerator: measurement.numerator,
    denominator: measurement.denominator, percentage: measurement.percentage, component_counts: measurement.componentCounts, exclusions: measurement.exclusions,
    ...(interpretation ? { interpretation_id: "i1", current_interpretation_id: "i1", ...interpretation } : { interpretation_id: null, current_interpretation_id: null }),
  };
}

function derive(profile, input, worksheetKey = null, reportingPeriod = PERIOD) {
  const definition = D.validateTabularMeasurementDefinition(input);
  assert.equal(definition.ok, true, JSON.stringify(definition.blockers));
  return D.deriveTabularMeasurement(profile, worksheetKey, definition.definition, { reportingPeriod });
}

const category = (fieldKey, valueKey) => ({ kind: "category", field_key: fieldKey, value_key: valueKey });
const eachRef = { kind: "distinct_key", field_key: "field_1", duplicate_policy: "count_each_key_once" };

test("the profiler commits a value-minimized tabular basis: roles from value shapes, listed labels only, both duplicate concepts", async () => {
  const profile = await csvProfile();
  const basis = profile.tabular_measurement_basis;
  assert.equal(basis.basis_version, TABULAR_MEASUREMENT_BASIS_VERSION);
  assert.equal(basis.record_count, independent.records, "the blank row is not a record");
  assert.deepEqual(basis.exact_duplicates, { group_count: 1, member_record_count: 2, excess_copy_count: 1 });
  const field = (key) => basis.fields.find((candidate) => candidate.field_key === key);
  assert.deepEqual(field("field_1").roles, ["identifier"]);
  assert.deepEqual(field("field_1").identifier, { distinct_count: 7, repeated_key_count: 2, records_in_repeated_keys: 4, records_beyond_first_per_key: 2 });
  assert.deepEqual(field("field_3").roles, ["date"]);
  // "late" has one record and is withheld; "phone_call" contains a word the profile's metadata-only rule refuses.
  assert.deepEqual(field("field_2").categorical.values.map((value) => [value.label, value.record_count]), [["done", 6], ["missed", 2]]);
  assert.equal(field("field_2").categorical.withheld_record_count, 1);
  assert.deepEqual(field("field_4").categorical.values.map((value) => value.label), ["in_person", "video"]);
  assert.equal(field("field_4").categorical.withheld_record_count, 1);
  assert.deepEqual(field("field_5").roles, [], "numbers are not categories");
  // Dates are kept by month only; V07 has records in two months, so a distinct count across months is not exact.
  assert.deepEqual(field("field_3").date, { date_count: 9, non_date_count: 0, earliest_month: "2025-05", latest_month: "2026-04" });
  assert.ok(!basis.single_valued_in.field_1.includes("field_3"));
  assert.ok(basis.single_valued_in.field_1.includes("field_2"));
  const serialized = JSON.stringify(basis);
  for (const raw of ["V01", "V07", "phone_call", "late", "visit_ref"]) assert.ok(!serialized.includes(`"${raw}"`), raw);
  for (const day of ["2025-05-01", "2025-11-02", "2026-04-02"]) assert.ok(!serialized.includes(day), day);
});

test("counts, distinct-key counts, category, period and rate calculations agree with an independent calculation of the same rows", async () => {
  const profile = await csvProfile();
  const done = category("field_2", "value_1");
  const allRecords = derive(profile, { operation: "count" });
  assert.equal(allRecords.measurement.measuredValue, independent.records);
  const distinct = derive(profile, { operation: "count", unit: eachRef });
  assert.equal(distinct.measurement.measuredValue, independent.distinct(records));
  assert.deepEqual([distinct.measurement.componentCounts.exact_duplicate_excess_copies, distinct.measurement.componentCounts.source_repeated_key_count], [1, 2]);
  const doneRecords = derive(profile, { operation: "count", conditions: [done] });
  assert.equal(doneRecords.measurement.measuredValue, independent.where(1, "done").length);
  const doneDistinct = derive(profile, { operation: "count", unit: eachRef, conditions: [done] });
  assert.equal(doneDistinct.measurement.measuredValue, independent.distinct(independent.where(1, "done")));
  // Records within and outside the period (records unit: exact for any key).
  const within = derive(profile, { operation: "count", conditions: [done, { kind: "period", field_key: "field_3", period_source: "engagement_reporting_period", scope: "within" }] });
  const outside = derive(profile, { operation: "count", conditions: [done, { kind: "period", field_key: "field_3", period_source: "engagement_reporting_period", scope: "outside" }] });
  assert.equal(within.measurement.measuredValue, independent.where(1, "done").filter(independent.inPeriod).length);
  assert.equal(outside.measurement.measuredValue, independent.where(1, "done").filter((row) => !independent.inPeriod(row)).length);
  assert.deepEqual(within.measurement.definition.conditions[1], { kind: "period", field_key: "field_3", period_source: "engagement_reporting_period", scope: "within", period_start: PERIOD.start, period_end: PERIOD.end });
  // A distinct count across months is refused when an identifier has records in two months.
  const notExact = derive(profile, { operation: "count", unit: eachRef, conditions: [done, { kind: "period", field_key: "field_3", period_source: "engagement_reporting_period", scope: "within" }] });
  assert.deepEqual([notExact.ok, notExact.blockers[0].blocking_reason], [false, "tabular_distinct_not_exact_for_period"]);
  // A period that is not whole months is refused, never approximated; the period is never invented.
  const partMonth = derive(profile, { operation: "count", conditions: [{ kind: "period", field_key: "field_3", period_source: "engagement_reporting_period", scope: "within" }] }, null, { start: "2025-04-15", end: "2026-03-31" });
  assert.equal(partMonth.blockers[0].blocking_reason, "tabular_period_not_whole_months");
  const noPeriod = derive(profile, { operation: "count", conditions: [{ kind: "period", field_key: "field_3", period_source: "engagement_reporting_period", scope: "within" }] }, null, null);
  assert.equal(noPeriod.blockers[0].blocking_reason, "tabular_reporting_period_not_recorded");
  // Rate: done among video visits, from the joint category table, not two independent histograms.
  const rate = derive(profile, { operation: "rate", conditions: [done], population: [category("field_4", "value_2")] });
  const video = independent.where(3, "video");
  assert.deepEqual([rate.measurement.numerator, rate.measurement.denominator], [video.filter((row) => row[1] === "done").length, video.length]);
  assert.equal(rate.measurement.percentage, "50.00");
  for (const measurement of [allRecords, distinct, doneDistinct, within, rate]) assert.equal(D.derivedMeasurementArithmeticHolds(asRow(measurement.measurement)), true);
});

test("definition refusals: unsupported units, combinations, unlisted values, roles KAI did not propose, typed periods, worksheet selection", async () => {
  const profile = await csvProfile();
  const reason = (input) => {
    const validated = D.validateTabularMeasurementDefinition(input);
    if (!validated.ok) return validated.blockers[0].blocking_reason;
    const derived = D.deriveTabularMeasurement(profile, null, validated.definition, { reportingPeriod: PERIOD });
    return derived.ok ? "ok" : derived.blockers[0].blocking_reason;
  };
  assert.equal(reason({ operation: "sum" }), "tabular_operation_invalid");
  assert.equal(reason({ operation: "count", conditions: [category("field_2", "value_1"), category("field_4", "value_1")] }), "tabular_condition_combination_not_supported");
  assert.equal(reason({ operation: "count", conditions: [category("field_2", "value_9")] }), "tabular_category_value_not_listed");
  assert.equal(reason({ operation: "count", unit: { kind: "distinct_key", field_key: "field_2", duplicate_policy: "count_each_key_once" } }), "tabular_field_role_not_proposed");
  assert.equal(reason({ operation: "count", unit: { kind: "distinct_key", field_key: "field_1" } }), "tabular_unit_invalid");
  assert.equal(reason({ operation: "count", conditions: [{ kind: "period", field_key: "field_3", period_start: "2025-01-01", period_end: "2025-12-31" }] }), "tabular_condition_invalid");
  assert.equal(reason({ operation: "count", conditions: [{ kind: "period", field_key: "field_2", period_source: "engagement_reporting_period", scope: "within" }] }), "tabular_field_role_not_proposed");
  assert.equal(reason({ operation: "rate", conditions: [] }), "tabular_rate_numerator_invalid");
  assert.equal(reason({ operation: "rate", unit: eachRef, conditions: [category("field_2", "value_1")] }), "tabular_rate_unit_not_supported");
  assert.equal(reason({ operation: "rate", conditions: [category("field_2", "value_1")], population: [category("field_2", "value_2")] }), "tabular_rate_population_same_field");
  assert.equal(reason({ operation: "count", population: [category("field_2", "value_1")] }), "tabular_population_not_applicable");
  const { tabular_measurement_basis: _removed, ...legacy } = profile;
  const validated = D.validateTabularMeasurementDefinition({ operation: "count" });
  assert.equal(D.deriveTabularMeasurement(legacy, null, validated.definition).blockers[0].blocking_reason, "tabular_basis_not_committed");
  assert.equal(D.deriveTabularMeasurement(profile, "sheet_1", validated.definition).blockers[0].blocking_reason, "tabular_worksheet_not_applicable");
  assert.equal(D.deriveTabularMeasurement({ status: "profiled", format: "txt" }, null, validated.definition).blockers[0].blocking_reason, "tabular_source_not_supported");
});

// Integration gap A: category labels that pass the same letter-only,
// frequency (>= 2 records) and cardinality (<= 12) rules. Ordinary
// operational categories are kept; values naming a person, a protected or
// sensitive attribute, or free text are withheld field by field, whatever
// their shape, and never reach the options a person reads, a definition, a
// statement or the committed profile.
const SENSITIVE_ROWS = [
  ["session_ref", "status", "programme", "coach", "Gender", "recorded_by", "cohort_group", "quality_note", "session_date"],
  ...Array.from({ length: 8 }, (_, index) => [
    `S${index + 10}`,
    ["done", "missed"][index % 2],
    ["Digital", "Careers"][index % 2],
    ["Priya", "Daniel"][index % 2],
    ["Female", "Male"][index % 2],
    ["Maria", "Ahmed"][index % 2],
    ["Refugee", "Citizen"][index % 2],
    ["Good", "Late start"][index % 2],
    `2025-0${(index % 8) + 1}-15`,
  ]),
];

test("profile category retention: ordinary labels are kept; personal, sensitive and free-text vocabularies are withheld at every boundary", async () => {
  const profile = await csvProfile(`${SENSITIVE_ROWS.map((row) => row.join(",")).join("\n")}\n`);
  const basis = profile.tabular_measurement_basis;
  const field = (key) => basis.fields.find((candidate) => candidate.field_key === key);
  assert.deepEqual(field("field_2").categorical.values.map((value) => value.label), ["done", "missed"]);
  assert.deepEqual(field("field_3").categorical.values.map((value) => value.label), ["Careers", "Digital"]);
  const withheld = {
    field_4: "personal_attribute_field", // a person (coach)
    field_5: "personal_attribute_field", // a protected attribute (gender)
    field_6: "personal_attribute_field", // who recorded it
    field_7: "sensitive_category_value", // an innocuous header with a sensitive vocabulary
    field_8: "personal_attribute_field", // free text
  };
  for (const [key, reasonCode] of Object.entries(withheld)) {
    assert.deepEqual(field(key).roles, ["categorical"], key);
    assert.deepEqual(field(key).categorical, { values: [], withheld_record_count: 8, vocabulary_withheld: reasonCode }, key);
    assert.deepEqual(basis.category_cells[key], {}, `${key} keeps no joint aggregates`);
  }
  // Committed profile: no withheld label anywhere, while the kept ones remain.
  const committed = JSON.stringify(profile);
  for (const label of ["Priya", "Daniel", "Female", "Male", "Maria", "Ahmed", "Refugee", "Citizen", "Late start", "Good"]) {
    assert.ok(!committed.includes(label), `committed profile holds ${label}`);
  }
  for (const label of ["done", "missed", "Careers", "Digital"]) assert.ok(committed.includes(`"${label}"`), label);
  // The read model a person sees: the field is listed with its withheld reason and no value to choose.
  const options = D.describeTabularMeasurementOptions(profile, null);
  assert.deepEqual(options.fields.find((entry) => entry.field_key === "field_4"), {
    field_key: "field_4", column_position: 4, role: "categorical", present_count: 8, blank_count: 0, values: [], withheld_record_count: 8, vocabulary_withheld: "personal_attribute_field",
  });
  // No definition can select a withheld value, so no statement, claim or model input can carry one.
  const refused = D.validateTabularMeasurementDefinition({ operation: "count", conditions: [category("field_4", "value_1")] });
  assert.equal(D.deriveTabularMeasurement(profile, null, refused.definition, { reportingPeriod: PERIOD }).blockers[0].blocking_reason, "tabular_category_value_not_listed");
  // The withheld field still counts as a whole, and the kept category still measures exactly.
  const kept = derive(profile, { operation: "count", conditions: [category("field_2", "value_1")] });
  assert.equal(kept.measurement.measuredValue, 4);
  const statement = D.composeDerivedMeasurementEvidenceStatement({ measurementRow: asRow(kept.measurement), interpretation: null });
  assert.match(statement, /field_2 = done/);
});

test("date precision: a month-level basis applies only whole-month periods; every period needing day-level dates is refused", async () => {
  const profile = await csvProfile();
  const within = { kind: "period", field_key: "field_3", period_source: "engagement_reporting_period", scope: "within" };
  const reason = (period) => {
    const derived = derive(profile, { operation: "count", conditions: [within] }, null, period);
    return derived.ok ? "ok" : derived.blockers[0].blocking_reason;
  };
  assert.equal(reason({ start: "2025-04-01", end: "2026-03-31" }), "ok");
  assert.equal(reason({ start: "2024-02-01", end: "2024-02-29" }), "ok", "a leap-year February is a whole month");
  assert.equal(reason({ start: "2025-02-01", end: "2025-02-28" }), "ok");
  for (const partial of [
    { start: "2025-04-15", end: "2026-03-31" }, // starts mid-month
    { start: "2025-04-01", end: "2026-03-30" }, // ends a day early
    { start: "2025-02-01", end: "2025-02-27" },
    { start: "2023-02-01", end: "2023-02-29" }, // not a real date
  ]) assert.equal(reason(partial), "tabular_period_not_whole_months", JSON.stringify(partial));
  // The whole-month result equals a day-level calculation over the same rows.
  const derived = derive(profile, { operation: "count", conditions: [within] });
  assert.equal(derived.measurement.measuredValue, records.filter(independent.inPeriod).length);
});

const PAIRED_ROWS = [
  ["obs_ref", "learner_id", "phase", "survey_version", "confidence_score", "readiness_rating"],
  ["O01", "L1", "pre", "A", 2, 3], ["O02", "L1", "post", "A", 4, 3],
  ["O03", "L2", "pre", "A", 3, 4], ["O04", "L2", "post", "A", 2, null],
  ["O05", "L3", "pre", "A", 1, 2], ["O06", "L3", "post", "B", 3, 4],
  ["O07", "L4", "pre", "A", 2, 2], ["O08", "L4", "pre", "A", 3, 2], ["O09", "L4", "post", "A", 3, 3],
  ["O10", "L5", "pre", "A", 3, 1], ["O11", "L5", "post", "A", 3, 2],
  ["O12", "L6", "pre", "A", 1, 1], ["O13", "L6", "post", "A", 2, 2],
];

test("paired outcomes are persistable without a definition; a meaning changes the statement, never the arithmetic", async () => {
  const bytes = syntheticXlsxWorkbook({ sheets: [{ name: "Observations", rows: PAIRED_ROWS }] });
  const profile = await profileLocalTrustedFile({ extension: ".xlsx", declaredMime: SYNTHETIC_XLSX_MIME, byteSize: bytes.byteLength, bytes });
  const derived = D.derivePersistablePairedOutcomes(profile, null);
  assert.equal(derived.ok, true, JSON.stringify(derived.blockers));
  const confidence = derived.measurements.find((m) => m.definition.outcome_field_key === "field_5");
  assert.deepEqual([confidence.numerator, confidence.denominator, confidence.componentCounts.unchanged_count, confidence.componentCounts.decreased_count, confidence.percentage],
    [2, 4, 1, 1, "50.00"]);
  const proposed = asRow(confidence);
  const meant = asRow(confidence, { indicator_label: "Confidence self-rating", meaning_text: "A self-rating.", score_direction: "higher_is_better", evidence_basis: "self_reported" });
  const numbers = (statement) => statement.match(/\d+(?:\.\d+)?%?/g).filter((value) => !["5", "1"].includes(value));
  const proposedClaim = D.composeDerivedClaimStatementFromRow(proposed);
  const meantClaim = D.composeDerivedClaimStatementFromRow(meant);
  assert.match(proposedClaim, /whether higher is better is not established/);
  assert.match(meantClaim, /^Confidence self-rating \(meaning stated by the organization; values self-reported\): .*the organization states higher is better/);
  assert.deepEqual(numbers(meantClaim), numbers(proposedClaim), "the same numbers under either meaning");
  assert.ok(D.derivedMeasurementLimitationCodes({ measurementRow: proposed }).includes("derived.direction_not_established"));
  assert.ok(D.derivedMeasurementLimitationCodes({ measurementRow: meant }).includes("derived.direction_human_stated"));
  // A tampered row fails its own arithmetic; a superseded interpretation is not current evidence.
  assert.equal(D.derivedMeasurementArithmeticHolds({ ...proposed, numerator: 3, measured_value: 3 }), false);
  assert.equal(D.derivedEvidenceIsCurrent({ ...meant, current_interpretation_id: "i2" }), false);
  const dims = D.applyDerivedMeasurementCoverageDimensions({}, { ...meant, current_interpretation_id: "i2" });
  assert.equal(dims.definition_clarity.evidence.assessment_status, "unresolved");
});

test("interpretations: required label and meaning, direction only for paired outcomes, no verified basis", () => {
  const paired = { family: "paired_outcome_change" };
  const count = { family: "tabular_count" };
  const reason = (input, family) => D.validateDerivedMeasurementInterpretation(input, family).blockers?.[0]?.blocking_reason ?? "ok";
  assert.equal(reason({ indicator_label: "Confidence", meaning_text: "A self-rating.", score_direction: "higher_is_better" }, paired), "ok");
  assert.equal(reason({ indicator_label: "Confidence", meaning_text: "A self-rating." }, paired), "interpretation_score_direction_required");
  assert.equal(reason({ indicator_label: "Visits", meaning_text: "Visits.", score_direction: "higher_is_better" }, count), "interpretation_score_direction_not_applicable");
  assert.equal(reason({ indicator_label: "Visits", meaning_text: "Visits.", evidence_basis: "independently_verified" }, count), "interpretation_evidence_basis_invalid");
  assert.equal(reason({ indicator_label: "Visits", meaning_text: "See https://example.org" }, count), "interpretation_meaning_invalid");
  assert.equal(reason({ indicator_label: "1 visits", meaning_text: "Visits." }, count), "interpretation_label_invalid");
});

// Shared generator conformance: a record-count claim and derived claims of
// both families pass the same contract, disclosure composition and validators.
const RECORD_COUNT_CLAIM = Object.freeze({
  claimId: "c0000000-0000-4000-8000-000000000001", evidenceItemId: "e0000000-0000-4000-8000-000000000001",
  claimStatement: "The promoted source records 9 visit records with no reporting period defined (record count: one visit record per CSV data record; 1 blank record excluded, 2 exact-duplicate records included).",
  limitationCodes: ["measurement.blank_records_excluded", "measurement.duplicate_records_included", "measurement.no_reporting_period", "measurement.record_meaning_human_defined"],
});

async function derivedClaims() {
  const profile = await csvProfile();
  const bytes = syntheticXlsxWorkbook({ sheets: [{ name: "Observations", rows: PAIRED_ROWS }] });
  const workbook = await profileLocalTrustedFile({ extension: ".xlsx", declaredMime: SYNTHETIC_XLSX_MIME, byteSize: bytes.byteLength, bytes });
  const pairedRow = asRow(D.derivePersistablePairedOutcomes(workbook, null).measurements[0]);
  const rateRow = asRow(derive(profile, { operation: "rate", conditions: [category("field_2", "value_1")], population: [category("field_4", "value_2")] }).measurement,
    { indicator_label: "Video visits done", meaning_text: "Video visits that took place.", evidence_basis: "self_reported" });
  return [["c0000000-0000-4000-8000-000000000002", pairedRow], ["c0000000-0000-4000-8000-000000000003", rateRow]].map(([claimId, row], index) => ({
    claimId, evidenceItemId: `e0000000-0000-4000-8000-00000000000${index + 2}`, claimStatement: D.composeDerivedClaimStatementFromRow(row),
    limitationCodes: D.derivedMeasurementLimitationCodes({ measurementRow: row }), row,
  }));
}

function draft(claims, texts, contentType = "evidence_summary") {
  const generationClaims = claims.map(({ row: _row, ...claim }) => ({ ...claim, requestedAudience: "internal", revalidatedForGeneration: true, audienceAuthority: { internal: true } }));
  const blocks = claims.map((claim, index) => ({ ordinal: index + 1, text: texts[index], citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] }));
  const composed = contentType === "evidence_summary" ? composeEvidenceSummaryMeasurementDisclosures({ blocks, claims: generationClaims }) : { ok: true, blocks };
  assert.equal(composed.ok, true);
  return { composed, result: validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims, blocks: composed.blocks, contentType }) };
}

const failed = (result) => result.blockers.map((blocker) => [blocker.validator_key, blocker.blocking_reason]);

test("shared generator conformance: record-count and derived claims restated with the server disclosure pass the same validators", async () => {
  const claims = [RECORD_COUNT_CLAIM, ...(await derivedClaims())];
  const { composed, result } = draft(claims, claims.map((claim) => claim.claimStatement));
  assert.deepEqual(failed(result), []);
  assert.match(composed.blocks[0].text, /Measurement disclosure for the cited count: It is a count of source records only/);
  assert.match(composed.blocks[1].text, /Measurement disclosure for the cited measurement: What the measured field represents has not been stated/);
  assert.match(composed.blocks[2].text, /The rate applies only to the measured population named in the statement/);
  // Idempotent: composing again does not append a second disclosure.
  const again = composeEvidenceSummaryMeasurementDisclosures({ blocks: composed.blocks, claims: claims.map(({ row: _row, ...claim }) => claim) });
  assert.deepEqual(again.blocks.map((block) => block.text), composed.blocks.map((block) => block.text));
});

test("shared generator conformance: invented values, causal claims, improvement without a direction, verification and all-participant claims are refused", async () => {
  const [paired, rate] = await derivedClaims();
  const check = (claim, extra) => failed(draft([claim], [`${claim.claimStatement} ${extra}`]).result);
  assert.deepEqual(check(rate, "In total 412 visits happened."), [["VAL-GEN-004", "unsupported_numeric_or_causal_assertion"]]);
  assert.deepEqual(check(paired, "The programme causes higher scores."), [["VAL-GEN-004", "unsupported_numeric_or_causal_assertion"]]);
  assert.deepEqual(check(paired, "Learners improved."), [["VAL-GEN-008", "material_limitation_not_disclosed"]]);
  assert.deepEqual(check(rate, "These are verified results."), [["VAL-GEN-008", "material_limitation_not_disclosed"]]);
  assert.deepEqual(check(rate, "This holds for all participants."), [["VAL-GEN-008", "material_limitation_not_disclosed"]]);
  assert.deepEqual(check(paired, "A reporting period was defined."), [["VAL-GEN-008", "material_limitation_not_disclosed"]]);
  // Outside an Evidence Summary nothing is appended: the model must disclose each limitation itself.
  assert.deepEqual(failed(draft([rate], [rate.claimStatement], "impact_narrative").result), [["VAL-GEN-008", "material_limitation_not_disclosed"]]);
});

test("the organization's derived-measurement screen builds exactly the documented route bodies", () => {
  const ORG = "0c000000-0000-4000-8000-0000000000c1";
  const SV = "5c000000-0000-4000-8000-0000000000c1";
  assert.equal(derivedMeasurementBasisPath(ORG, SV, "sheet_2"), `/api/kai/sprint2/intake/admin/organizations/${ORG}/source-versions/${SV}/derived-measurements?worksheet_key=sheet_2`);
  assert.equal(pairedOutcomeMeasurementsPath(ORG, SV), `/api/kai/sprint2/intake/admin/organizations/${ORG}/source-versions/${SV}/paired-outcome-measurements`);
  assert.equal(tabularMeasurementPath(ORG, SV), `/api/kai/sprint2/intake/admin/organizations/${ORG}/source-versions/${SV}/tabular-measurements`);
  assert.equal(derivedMeasurementInterpretationPath(ORG, SV), `/api/kai/sprint2/intake/admin/organizations/${ORG}/derived-measurements/${SV}/interpretations`);
  const form = { ...EMPTY_TABULAR_FORM, identifierFieldKey: "field_1", categoryFieldKey: "field_6", categoryValueKey: "value_2", periodFieldKey: "field_4", periodScope: "outside" };
  const body = tabularDefinitionBody(form);
  assert.deepEqual(body, { operation: "count", unit: { kind: "distinct_key", field_key: "field_1", duplicate_policy: "count_each_key_once" },
    conditions: [category("field_6", "value_2"), { kind: "period", field_key: "field_4", period_source: "engagement_reporting_period", scope: "outside" }] });
  assert.equal(D.validateTabularMeasurementDefinition(body).ok, true);
  const rate = tabularDefinitionBody({ ...EMPTY_TABULAR_FORM, operation: "rate", categoryFieldKey: "field_5", categoryValueKey: "value_1", populationFieldKey: "field_4", populationValueKey: "value_1" });
  assert.equal(D.validateTabularMeasurementDefinition(rate).ok, true);
  assert.equal(tabularFormProblem({ ...EMPTY_TABULAR_FORM, operation: "rate" }), "A rate needs the value its numerator records have.");
  assert.equal(interpretationBody({ indicatorLabel: " ", meaningText: "x", scoreDirection: "", evidenceBasis: "" }, { paired: false }), null);
  assert.deepEqual(interpretationBody({ indicatorLabel: "Readiness", meaningText: "Self-rated.", scoreDirection: "", evidenceBasis: "self_reported" }, { paired: true }),
    { indicator_label: "Readiness", meaning_text: "Self-rated.", score_direction: "not_established", evidence_basis: "self_reported" });
});
