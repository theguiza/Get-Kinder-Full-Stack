import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { profileLocalTrustedFile } from "../Backend/kai/profiling/localProfilingKernel.js";
import { PAIRED_OUTCOME_CALCULATION_METHOD } from "../Backend/kai/profiling/pairedOutcomeBasis.js";
import {
  PAIRED_OUTCOME_LIMITATION_CODES,
  derivePairedOutcomeMeasurements,
  describePairedOutcomeLimitationCode,
  validatePairedOutcomeDefinition,
} from "../Backend/kai/validators/kaiPairedOutcomeMeasurementValidators.js";
import { deriveRecordCountMeasurement, validateComposedStatement } from "../Backend/kai/validators/kaiSourceMeasurementValidators.js";
import { getPairedOutcomeMeasurementBasis } from "../Backend/kai/services/kaiSourceMeasurementService.js";
import { syntheticXlsxWorkbook, SYNTHETIC_XLSX_MIME } from "./support/kaiSyntheticXlsxWorkbook.js";

/**
 * KAI Measurement MVP: the paired baseline/follow-up outcome basis the P1
 * profiler commits, its derivation into measurements, the human definition,
 * and the read-only service gates. The real-PostgreSQL governed path is in
 * kai-sprint2-p2-01m-source-record-count-measurement.integration.spec.js.
 * The fixture is invented here; its field names are deliberately unlike any
 * customer workbook, and every expected count comes from an independent
 * calculation over the same rows, not from KAI code.
 */

const ORG = "0e000000-0000-4000-8000-000000000a01";
const VERSION = "3e000000-0000-4000-8000-000000000001";
const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const human = (organizationId, roleName) => ({
  actorType: "human",
  actorUserId: "9e000000-0000-4000-8000-000000000001",
  kaiRoles: [],
  organizationMemberships: [{ organization_id: organizationId, membership_status: "active", role_name: roleName }],
});
const ADMIN = human(ORG, "client_admin");

const HEADER = ["record_ref", "client_code", "timepoint", "form_version", "wellbeing_rating", "skills_score", "notes"];
// [record_ref, client_code, timepoint, form_version, wellbeing, skills, notes]
const ROWS = [
  ["R01", "P01", "pre", "v1", 3, 10, "ok"],
  ["R02", "P01", "post", "v1", 4, 12, "ok"],
  ["R02", "P01", "post", "v1", 4, 12, "ok"], // exact export duplicate
  ["R03", "P02", "pre", "v1", 2, 8, "ok"],
  ["R04", "P02", "post", "v1", 2, 6, "ok"],
  ["R05", "P03", "pre", "v1", 5, null, "skills skipped"],
  ["R06", "P03", "post", "v1", 4, 9, "ok"],
  ["R07", "P04", "pre", "v1", 1, 5, "ok"],
  ["R08", "P04", "post", "v2", 3, 7, "new form"],
  ["R09", "P05", "pre", "v1", 2, 5, "ok"],
  ["R10", "P06", "post", "v1", 3, 3, "ok"],
  ["R11", "P07", "pre", "v1", 2, 4, "ok"],
  ["R12", "P07", "pre", "v1", 3, 4, "re-entered"],
  ["R13", "P07", "post", "v1", 4, 6, "ok"],
  ["R14", "P08", "pre", "v1", 2, 4, "ok"],
  ["R15", "P08", "post", "v1", "n/a", 6, "declined"],
  ["R16", "P09", "pre", "v1", 1, 1, "ok"],
  ["R17", "P09", "post", "v1", 2, 2, "ok"],
  ["R18", "P10", "pre", "v1", 4, 4, "ok"],
  ["R19", "P10", "post", "v1", 4, 5, "ok"],
  ["R20", "P11", "pre", "v1", 3, 3, "ok"],
  ["R21", "P11", "post", "v1", 2, 3, "ok"],
  ["R22", "P12", "pre", "v1", 2, 2, "ok"],
  ["R23", "P12", "post", "v1", 5, 2, "ok"],
  ["R24", null, "post", "v1", 3, 3, "no id"],
  ["R25", "P13", "mid", "v1", 3, 3, "midpoint"],
];

function workbook({ header = HEADER, rows = ROWS, extraSheets = [] } = {}) {
  return syntheticXlsxWorkbook({ sheets: [{ name: "Observations", rows: [header, ...rows] }, ...extraSheets] });
}

async function workbookProfile(bytes) {
  return profileLocalTrustedFile({ extension: ".xlsx", declaredMime: SYNTHETIC_XLSX_MIME, byteSize: bytes.byteLength, bytes });
}

// Independent of KAI: one pair per participant needs exactly one pre and one
// post observation of the same form version (exact duplicate rows collapse),
// and a numeric value for this field at both.
function independentPairedChange(rows, column, { versioned = true } = {}) {
  const seen = new Set();
  const byParticipant = new Map();
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!row[1] || !["pre", "post"].includes(row[2])) continue;
    const entry = byParticipant.get(row[1]) ?? [];
    entry.push(row);
    byParticipant.set(row[1], entry);
  }
  let up = 0;
  let same = 0;
  let down = 0;
  for (const observations of byParticipant.values()) {
    const versions = new Set(observations.map((row) => (versioned ? row[3] : "")));
    const candidates = [...versions].filter((version) => ["pre", "post"].every((stage) => observations.some((row) => row[2] === stage && (!versioned || row[3] === version))));
    if (candidates.length !== 1) continue;
    const pre = observations.filter((row) => row[2] === "pre" && (!versioned || row[3] === candidates[0]));
    const post = observations.filter((row) => row[2] === "post" && (!versioned || row[3] === candidates[0]));
    if (pre.length !== 1 || post.length !== 1 || typeof pre[0][column] !== "number" || typeof post[0][column] !== "number") continue;
    if (post[0][column] > pre[0][column]) up += 1;
    else if (post[0][column] < pre[0][column]) down += 1;
    else same += 1;
  }
  return { up, same, down, pairs: up + same + down };
}

function byField(derived, fieldKey) {
  return derived.measurements.find((measurement) => measurement.outcomeFieldKey === fieldKey);
}

function exclusionCounts(measurement) {
  return Object.fromEntries(measurement.exclusions.map((exclusion) => [exclusion.reason, exclusion.participantCount]));
}

test("discovery: KAI proposes the participant, stage, version and numeric outcome fields without any manual metric, and stores no header or cell value", async () => {
  const profile = await workbookProfile(workbook());
  const basis = profile.sheets[0].paired_outcome_basis;
  assert.equal(basis.status, "proposed");
  assert.deepEqual(basis.candidates, {
    participant_identifier: ["field_2"],
    stage: ["field_3"],
    instrument_version: ["field_4"],
    numeric_outcome: ["field_5", "field_6"],
  }, "record_ref and notes are not proposed; the two score fields are");
  assert.deepEqual(basis.alternatives[0].row_exclusions.map((exclusion) => [exclusion.reason, exclusion.rows]), [
    ["exact_duplicate_row", [4]],
    ["missing_participant_identifier", [26]],
    ["stage_not_classified", [27]],
  ]);
  assert.doesNotMatch(JSON.stringify(profile), /P0\d|R\d\d|"pre"|"post"|"v1"|wellbeing|skills|client_code|timepoint|n\/a|re-entered/, "no header text or cell value is stored");
  // The record-count basis of the same worksheet is unchanged by the refactor.
  assert.deepEqual(deriveRecordCountMeasurement(profile).measurement.measuredValue, ROWS.length);
});

test("one calculation measures every numeric outcome field: counts, denominator, rate and exclusions match an independent calculation", async () => {
  const derived = derivePairedOutcomeMeasurements(await workbookProfile(workbook()));
  assert.equal(derived.ok, true, JSON.stringify(derived.blockers));
  assert.equal(derived.status, "available");
  for (const [fieldKey, column] of [["field_5", 4], ["field_6", 5]]) {
    const measurement = byField(derived, fieldKey);
    const expected = independentPairedChange(ROWS, column);
    assert.equal(measurement.calculationMethod, PAIRED_OUTCOME_CALCULATION_METHOD);
    assert.deepEqual(
      [measurement.increasedCount, measurement.unchangedCount, measurement.decreasedCount, measurement.denominator],
      [expected.up, expected.same, expected.down, expected.pairs],
      fieldKey,
    );
    assert.equal(measurement.participantCount, 12, "P13's only row is excluded as an unclassified stage");
    assert.equal(measurement.participantCount, measurement.denominator + measurement.excludedParticipantCount);
    assert.equal(measurement.rate, (expected.up * 100 / expected.pairs).toFixed(2));
    assert.equal(measurement.cellLocators.length, measurement.denominator);
  }
  const wellbeing = byField(derived, "field_5");
  const skills = byField(derived, "field_6");
  assert.deepEqual([wellbeing.increasedCount, wellbeing.unchangedCount, wellbeing.decreasedCount, wellbeing.denominator], [3, 2, 2, 7]);
  assert.deepEqual([skills.increasedCount, skills.unchangedCount, skills.decreasedCount, skills.denominator], [4, 2, 1, 7]);
  // A missing or non-numeric value excludes the participant only from that field.
  assert.deepEqual(exclusionCounts(wellbeing), {
    no_baseline_observation: 1, no_followup_observation: 1, instrument_version_mismatch: 1, multiple_observations_ambiguous: 1, non_numeric_value: 1,
  });
  assert.deepEqual(exclusionCounts(skills), {
    no_baseline_observation: 1, no_followup_observation: 1, instrument_version_mismatch: 1, multiple_observations_ambiguous: 1, missing_baseline_value: 1,
  });
  assert.ok(wellbeing.cellLocators.some((pair) => pair.baseline === "E7" && pair.followup === "E8"), "P03 is compared on wellbeing");
  assert.ok(!skills.cellLocators.some((pair) => pair.baseline === "F7"), "P03 is not compared on skills");
  assert.deepEqual(skills.exclusions.find((exclusion) => exclusion.reason === "missing_baseline_value").rows, [7, 8]);
  // Version mismatch is recorded, never compared.
  assert.deepEqual(wellbeing.exclusions.find((exclusion) => exclusion.reason === "instrument_version_mismatch").rows, [9, 10]);
  // The duplicated and repeated observations do not inflate the denominator:
  // P01 is one pair, P07 none.
  assert.equal(wellbeing.cellLocators.filter((pair) => pair.baseline === "E2").length, 1);
  assert.deepEqual(wellbeing.exclusions.find((exclusion) => exclusion.reason === "multiple_observations_ambiguous").rows, [13, 14, 15]);
  assert.equal(new Set(wellbeing.cellLocators.map((pair) => pair.baseline)).size, wellbeing.denominator);
  // The outcome result is never the worksheet's row count.
  const rowCount = deriveRecordCountMeasurement(await workbookProfile(workbook())).measurement.measuredValue;
  assert.notEqual(wellbeing.denominator, rowCount);
  // Swapping the two outcome columns swaps the results: nothing is keyed to a field name.
  const swapped = derivePairedOutcomeMeasurements(await workbookProfile(workbook({
    header: [...HEADER.slice(0, 4), HEADER[5], HEADER[4], HEADER[6]],
    rows: ROWS.map((row) => [...row.slice(0, 4), row[5], row[4], row[6]]),
  })));
  assert.deepEqual(
    [byField(swapped, "field_5").increasedCount, byField(swapped, "field_6").increasedCount, byField(swapped, "field_5").denominator],
    [skills.increasedCount, wellbeing.increasedCount, skills.denominator],
  );
});

test("without a version field, pairs are formed by participant only and the missing version check is a recorded limitation", async () => {
  const header = HEADER.filter((_, index) => index !== 3);
  const rows = ROWS.map((row) => row.filter((_, index) => index !== 3));
  const derived = derivePairedOutcomeMeasurements(await workbookProfile(workbook({ header, rows })));
  const wellbeing = byField(derived, "field_4");
  assert.equal(wellbeing.instrumentVersionFieldKey, null);
  assert.equal(wellbeing.comparabilityRule, "same_participant_instrument_version_not_recorded");
  assert.ok(wellbeing.limitationCodes.includes(PAIRED_OUTCOME_LIMITATION_CODES.VERSION_NOT_RECORDED));
  const expected = independentPairedChange(ROWS, 4, { versioned: false });
  assert.deepEqual([wellbeing.increasedCount, wellbeing.denominator], [expected.up, expected.pairs], "P04 is now paired");
});

test("scoring direction: a numeric increase is not an improvement until a person defines the direction", async () => {
  const profile = await workbookProfile(workbook());
  const proposed = byField(derivePairedOutcomeMeasurements(profile), "field_5");
  assert.equal(proposed.scoreDirection, "unresolved");
  assert.equal(proposed.numeratorMeaning, "numeric_increase");
  assert.equal(proposed.interpretation.status, "proposed");
  assert.match(proposed.evidenceStatement, /numerically higher follow-up value.*whether higher is better is not established/);
  assert.doesNotMatch(proposed.evidenceStatement, /improv/i);
  assert.ok(proposed.limitationCodes.includes(PAIRED_OUTCOME_LIMITATION_CODES.DIRECTION_UNRESOLVED));
  assert.ok(proposed.limitationCodes.includes(PAIRED_OUTCOME_LIMITATION_CODES.MEANING_PROPOSED));

  const define = (fields) => validatePairedOutcomeDefinition({
    outcome_field_key: "field_5",
    indicator_label: "Wellbeing self-rating",
    definition_text: "A five-point self-rating where 1 is lowest and 5 is highest wellbeing.",
    ...fields,
  }).definition;
  const higher = derivePairedOutcomeMeasurements(profile, null, { definitions: [define({ score_direction: "higher_is_better" })] });
  const wellbeing = byField(higher, "field_5");
  assert.deepEqual([wellbeing.numeratorMeaning, wellbeing.numerator, wellbeing.denominator, wellbeing.rate], ["improvement", 3, 7, "42.86"]);
  assert.match(wellbeing.evidenceStatement, /^Wellbeing self-rating \(field_5, column E\).*3 of 7 comparable participant pairs \(42\.86%\) improved to a higher follow-up score/);
  assert.equal(wellbeing.interpretation.status, "human_defined");
  assert.ok(wellbeing.limitationCodes.includes(PAIRED_OUTCOME_LIMITATION_CODES.DIRECTION_HUMAN_DEFINED));
  // The undefined field keeps its numeric meaning and stays available.
  assert.equal(byField(higher, "field_6").numeratorMeaning, "numeric_increase");

  const lower = byField(derivePairedOutcomeMeasurements(profile, null, { definitions: [define({ score_direction: "lower_is_better" })] }), "field_5");
  assert.deepEqual([lower.numeratorMeaning, lower.numerator, lower.rate], ["improvement", 2, "28.57"], "lower is better: decreases are improvements");
  const meaningOnly = byField(derivePairedOutcomeMeasurements(profile, null, { definitions: [define({ score_direction: "not_established" })] }), "field_5");
  assert.deepEqual([meaningOnly.numeratorMeaning, meaningOnly.interpretation.status], ["numeric_increase", "human_defined"]);
  for (const measurement of [proposed, wellbeing, lower, meaningOnly]) {
    assert.equal(validateComposedStatement(measurement.evidenceStatement).ok, true);
    assert.ok(measurement.evidenceStatement.length <= 500);
    for (const code of measurement.limitationCodes) assert.ok(describePairedOutcomeLimitationCode(code), code);
  }
  // No reporting period is invented, and its absence blocks nothing.
  assert.equal(proposed.periodStart, null);
  assert.ok(proposed.limitationCodes.includes(PAIRED_OUTCOME_LIMITATION_CODES.NO_REPORTING_PERIOD));
  const withPeriod = byField(derivePairedOutcomeMeasurements(profile, null, {
    definitions: [define({ score_direction: "higher_is_better", period_start: "2026-01-01", period_end: "2026-06-30" })],
  }), "field_5");
  assert.ok(withPeriod.limitationCodes.includes(PAIRED_OUTCOME_LIMITATION_CODES.PERIOD_HUMAN_ATTESTED));
});

test("the definition is the person's: complete, plain text, a known direction, proposed fields only", async () => {
  const base = { outcome_field_key: "field_5", indicator_label: "Wellbeing self-rating", definition_text: "A five-point self-rating.", score_direction: "higher_is_better" };
  assert.equal(validatePairedOutcomeDefinition(base).ok, true);
  for (const [definition, reason] of [
    [null, "paired_outcome_definition_required"],
    [{ ...base, extra: 1 }, "paired_outcome_definition_unknown_field"],
    [{ ...base, score_direction: undefined }, "paired_outcome_definition_incomplete"],
    [{ ...base, score_direction: "better" }, "paired_outcome_definition_direction_invalid"],
    [{ ...base, outcome_field_key: "wellbeing_rating" }, "paired_outcome_definition_field_invalid"],
    [{ ...base, indicator_label: "1 rating" }, "paired_outcome_definition_label_invalid"],
    [{ ...base, definition_text: "see https://example.org" }, "paired_outcome_definition_text_invalid"],
    [{ ...base, participant_field_key: "client" }, "paired_outcome_definition_field_invalid"],
    [{ ...base, period_start: "2026-01-01" }, "paired_outcome_period_incomplete"],
    [{ ...base, period_start: "2026-02-30", period_end: "2026-03-01" }, "paired_outcome_period_invalid"],
  ]) {
    const result = validatePairedOutcomeDefinition(definition);
    assert.equal(result.ok, false, reason);
    assert.equal(result.blockers[0].blocking_reason, reason);
  }
  const profile = await workbookProfile(workbook());
  const notProposed = derivePairedOutcomeMeasurements(profile, null, { definitions: [validatePairedOutcomeDefinition({ ...base, outcome_field_key: "field_7" }).definition] });
  assert.equal(notProposed.blockers[0].blocking_reason, "paired_outcome_field_not_proposed");
  const duplicate = validatePairedOutcomeDefinition(base).definition;
  assert.equal(derivePairedOutcomeMeasurements(profile, null, { definitions: [duplicate, duplicate] }).blockers[0].blocking_reason, "paired_outcome_definition_duplicate");
});

test("ambiguous pairing fields are never resolved silently: every proposed pairing is kept, and a person selects one", async () => {
  const header = [...HEADER, "member_id"];
  const rows = ROWS.map((row) => [...row, row[1] ? `M-${row[1]}` : null]);
  const profile = await workbookProfile(workbook({ header, rows }));
  const basis = profile.sheets[0].paired_outcome_basis;
  assert.equal(basis.status, "role_selection_required");
  assert.deepEqual(basis.candidates.participant_identifier, ["field_2", "field_8"]);
  const unselected = derivePairedOutcomeMeasurements(profile);
  assert.deepEqual([unselected.ok, unselected.status, unselected.measurements.length], [true, "pairing_selection_required", 0]);
  assert.deepEqual(unselected.proposedPairings.map((pairing) => pairing.participantFieldKey), ["field_2", "field_8"]);

  const definition = (fields) => validatePairedOutcomeDefinition({
    outcome_field_key: "field_5", indicator_label: "Wellbeing self-rating", definition_text: "A five-point self-rating.", score_direction: "not_established", ...fields,
  }).definition;
  const selected = derivePairedOutcomeMeasurements(profile, null, { definitions: [definition({ participant_field_key: "field_8" })] });
  assert.equal(selected.status, "available");
  assert.equal(byField(selected, "field_5").participantFieldKey, "field_8");
  assert.equal(byField(selected, "field_6").denominator, 7, "the selection applies to every field of the worksheet");
  assert.ok(!byField(selected, "field_5").limitationCodes.includes(PAIRED_OUTCOME_LIMITATION_CODES.ROLES_PROPOSED));
  assert.equal(
    derivePairedOutcomeMeasurements(profile, null, { definitions: [definition({ participant_field_key: "field_1" })] }).blockers[0].blocking_reason,
    "paired_outcome_pairing_not_proposed",
  );
  const other = validatePairedOutcomeDefinition({
    outcome_field_key: "field_6", indicator_label: "Skills score", definition_text: "A skills score.", score_direction: "not_established", participant_field_key: "field_2",
  }).definition;
  assert.equal(
    derivePairedOutcomeMeasurements(profile, null, { definitions: [definition({ participant_field_key: "field_8" }), other] }).blockers[0].blocking_reason,
    "paired_outcome_pairing_conflict",
  );
});

test("an inconsistent field is unavailable on its own; the other field stays available", async () => {
  const profile = await workbookProfile(workbook());
  const [sheet] = profile.sheets;
  const basis = sheet.paired_outcome_basis;
  const [first, second] = basis.alternatives[0].measurements;
  const tampered = {
    ...profile,
    sheets: [{ ...sheet, paired_outcome_basis: { ...basis, alternatives: [{ ...basis.alternatives[0], measurements: [{ ...first, increased_count: first.increased_count + 1 }, second] }] } }],
  };
  const derived = derivePairedOutcomeMeasurements(tampered);
  assert.deepEqual(derived.measurements.map((measurement) => measurement.available), [false, true]);
  assert.equal(derived.measurements[0].blockers[0].blocking_reason, "paired_outcome_counts_inconsistent");
});

test("worksheets without a pairing, ambiguous tables and earlier profiles are refused with their reason", async () => {
  const notes = { name: "Targets", rows: [["measure", "target_value"], ["reach", 90]] };
  const multi = await workbookProfile(workbook({ extraSheets: [notes] }));
  assert.equal(derivePairedOutcomeMeasurements(multi).blockers[0].blocking_reason, "paired_outcome_worksheet_selection_required");
  assert.equal(derivePairedOutcomeMeasurements(multi, "sheet_1").status, "available");
  assert.equal(derivePairedOutcomeMeasurements(multi, "sheet_2").blockers[0].blocking_reason, "paired_outcome_participant_identifier_not_found");
  assert.equal(derivePairedOutcomeMeasurements(multi, "sheet_9").blockers[0].blocking_reason, "paired_outcome_worksheet_selection_invalid");
  const merged = await workbookProfile(syntheticXlsxWorkbook({ sheets: [{ rows: [HEADER, ...ROWS], merged: ["G2:G3"] }] }));
  assert.equal(derivePairedOutcomeMeasurements(merged).blockers[0].blocking_reason, "paired_outcome_worksheet_table_not_established");
  const legacy = { ...multi, sheets: multi.sheets.map(({ paired_outcome_basis: _omitted, ...sheet }) => sheet) };
  assert.match(derivePairedOutcomeMeasurements(legacy, "sheet_1").blockers[0].required_fix, /Upload again as a new intake version/);
  const bytes = new TextEncoder().encode("client_code,timepoint,score\nP01,pre,1\nP01,post,2\n");
  const csv = await profileLocalTrustedFile({ extension: ".csv", declaredMime: "text/csv", byteSize: bytes.byteLength, bytes });
  assert.equal(derivePairedOutcomeMeasurements(csv).blockers[0].blocking_reason, "paired_outcome_source_not_workbook");
});

test("service: flag, actor, role, tenant and definition are checked before the repository; a person's definition reaches it normalized", async () => {
  const calls = [];
  const repository = {
    async readPairedOutcomeMeasurementBasis(input) {
      calls.push(input);
      return { ok: true, data: { recorded: false }, error: null };
    },
  };
  const input = { organizationId: ORG, sourceVersionId: VERSION, worksheetKey: "sheet_1", actorContext: ADMIN };
  const definition = { outcome_field_key: "field_5", indicator_label: "Wellbeing self-rating", definition_text: "A five-point self-rating.", score_direction: "higher_is_better" };
  assert.equal((await getPairedOutcomeMeasurementBasis(input, { env: {}, sourceMeasurementRepository: repository })).error.code, "feature_disabled");
  for (const actorContext of [
    { ...ADMIN, actorType: "assistant" },
    { ...ADMIN, actorType: "system" },
    human(ORG, "client_reviewer"),
    human(ORG, "client_contributor"),
    human("0e000000-0000-4000-8000-000000000b01", "client_admin"),
  ]) {
    const denied = await getPairedOutcomeMeasurementBasis({ ...input, actorContext, definitions: [definition] }, { env: ENV, sourceMeasurementRepository: repository });
    assert.equal(denied.ok, false, JSON.stringify(actorContext.organizationMemberships));
  }
  assert.equal((await getPairedOutcomeMeasurementBasis({ ...input, unexpected: 1 }, { env: ENV, sourceMeasurementRepository: repository })).error.code, "validation_blocker");
  const invalid = await getPairedOutcomeMeasurementBasis({ ...input, definitions: [{ ...definition, score_direction: "up" }] }, { env: ENV, sourceMeasurementRepository: repository });
  assert.equal(invalid.error.code, "validation_blocker");
  assert.equal(calls.length, 0, "nothing reached the repository");
  const admitted = await getPairedOutcomeMeasurementBasis({ ...input, definitions: [definition] }, { env: ENV, sourceMeasurementRepository: repository });
  assert.equal(admitted.ok, true);
  assert.deepEqual(calls, [{
    organizationId: ORG,
    sourceVersionId: VERSION,
    worksheetKey: "sheet_1",
    definitions: [{ outcomeFieldKey: "field_5", indicatorLabel: "Wellbeing self-rating", definitionText: "A five-point self-rating.", scoreDirection: "higher_is_better", roles: {}, periodStart: null, periodEnd: null }],
  }]);
});

// The original synthetic Cedar Bridge workbook, when the tester points to it.
// It is read only here; nothing from it or its answer key is in the runtime.
const CEDAR_WORKBOOK = process.env.KAI_CEDAR_BRIDGE_WORKBOOK;
const CEDAR_WORKBOOK_SHA256 = "23d00f791dc8c980c0a2966df552d4ac14246047339270e344ccf26ab076c705";

test("Cedar Bridge acceptance: both paired outcome measurements from the original workbook match the independent answer key", {
  skip: CEDAR_WORKBOOK && existsSync(CEDAR_WORKBOOK) ? false : "set KAI_CEDAR_BRIDGE_WORKBOOK to the original 04_Assessments_and_Followups.xlsx",
}, async () => {
  const bytes = new Uint8Array(readFileSync(CEDAR_WORKBOOK));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), CEDAR_WORKBOOK_SHA256, "the file is the manifest's original workbook");
  const profile = await workbookProfile(bytes);
  assert.deepEqual(profile.sheets.map((sheet) => [sheet.safe_sheet_name, sheet.paired_outcome_basis.status]), [
    ["Assessments", "proposed"], ["Followups", "no_candidate"], ["Targets", "no_candidate"],
  ], "follow-up contacts and planning targets are not paired outcomes");
  const derived = derivePairedOutcomeMeasurements(profile, "sheet_1");
  assert.equal(derived.status, "available");
  const [digital, employment] = ["field_6", "field_7"].map((fieldKey) => byField(derived, fieldKey));
  assert.deepEqual([digital.denominator, digital.increasedCount, digital.unchangedCount, digital.decreasedCount, digital.rate], [38, 25, 10, 3, "65.79"]);
  assert.deepEqual([employment.denominator, employment.increasedCount, employment.unchangedCount, employment.decreasedCount, employment.rate], [40, 23, 13, 4, "57.50"]);
  for (const measurement of [digital, employment]) {
    assert.equal(measurement.calculationMethod, PAIRED_OUTCOME_CALCULATION_METHOD);
    assert.equal(measurement.comparabilityRule, "same_participant_same_instrument_version");
    // CB043-CB050: V1 baseline, V2 follow-up (rows 86-101), not compared.
    const drift = measurement.exclusions.find((exclusion) => exclusion.reason === "instrument_version_mismatch");
    assert.deepEqual([drift.participantCount, drift.rows], [8, Array.from({ length: 16 }, (_, index) => 86 + index)]);
    assert.equal(measurement.numeratorMeaning, "numeric_increase", "no direction is assumed");
  }
  // Missing scores exclude only their own measurement.
  assert.deepEqual(digital.exclusions.find((exclusion) => exclusion.reason === "missing_followup_value").rows, [14, 15, 30, 31, 60, 61, 76, 77]);
  assert.deepEqual(employment.exclusions.find((exclusion) => exclusion.reason === "missing_baseline_value").rows, [18, 19, 62, 63]);
  assert.ok(employment.cellLocators.some((pair) => pair.baseline === "G14" && pair.followup === "G15"), "CB007 counts for readiness");
  assert.ok(digital.cellLocators.some((pair) => pair.baseline === "F18" && pair.followup === "F19"), "CB009 counts for digital confidence");
  assert.equal(digital.cellLocators[0].baseline, "F2");
  // The assessment-row count stays a separate measurement and never replaces the outcome.
  assert.equal(deriveRecordCountMeasurement(profile, "sheet_1").measurement.measuredValue, 112);
  // A person's direction makes the same counts an improvement, for that field only.
  const defined = derivePairedOutcomeMeasurements(profile, "sheet_1", { definitions: [validatePairedOutcomeDefinition({
    outcome_field_key: "field_6",
    indicator_label: "Digital confidence self-rating",
    definition_text: "A five-point self-rating; 1 is very low and 5 is very high reported confidence.",
    score_direction: "higher_is_better",
  }).definition] });
  assert.deepEqual([byField(defined, "field_6").numeratorMeaning, byField(defined, "field_6").numerator, byField(defined, "field_6").rate], ["improvement", 25, "65.79"]);
  assert.equal(byField(defined, "field_7").numeratorMeaning, "numeric_increase");
  assert.doesNotMatch(JSON.stringify(profile), /CB0\d\d|AS0\d\d|digital|employment|"V[12]"/i, "the profile stores no participant, header or version value");
});
