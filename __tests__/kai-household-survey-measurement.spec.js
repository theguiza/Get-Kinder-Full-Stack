import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { profileLocalTrustedFile, readTrustedWorksheetRecords } from "../Backend/kai/profiling/localProfilingKernel.js";
import { createCrossSourceReconciliationWorker } from "../Backend/kai/parsing/crossSourceReconciliationWorker.js";
import { derivePersistablePairedOutcomes, composeDerivedMeasurementEvidenceStatement } from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import { profileWithCurrentPairedBasis } from "../Backend/kai/dictionary/pairedOutcomeBasisRecovery.js";
import { suggestOutcomeHeading } from "../Backend/kai/profiling/outcomeHeadingSuggestion.js";
import { syntheticXlsxWorkbook, SYNTHETIC_XLSX_MIME } from "./support/kaiSyntheticXlsxWorkbook.js";

const headers = ["survey_id", "household_id", "survey_stage", "response_date", "instrument_version", "food_planning_confidence_1to5", "affordable_meal_confidence_1to5"];
const rows = [
  ["S01", "H01", "baseline", "2025-05-01", "A", 1, 3], ["S02", "H01", "followup", "2025-06-01", "A", 3, 2],
  ["S03", "H02", "baseline", "2025-05-01", "A", 2, 2], ["S04", "H02", "followup", "2025-06-01", "A", 2, null],
  ["S05", "H03", "baseline", "2025-05-01", "A", 4, 3], ["S06", "H03", "followup", "2025-06-01", "B", 5, 5],
];
const bytes = syntheticXlsxWorkbook({ sheets: [{ name: "Self_Rating_Surveys", rows: [headers, ...rows] }] });
const checksum = createHash("sha256").update(bytes).digest("hex");
const profile = (input) => profileLocalTrustedFile({ extension: ".xlsx", declaredMime: SYNTHETIC_XLSX_MIME, byteSize: input.length, bytes: input });

function statementOf(m) {
  return composeDerivedMeasurementEvidenceStatement({ measurementRow: {
    measurement_family: m.family, definition: m.definition, worksheet_key: m.sheetKey,
    numerator: m.numerator, denominator: m.denominator, percentage: m.percentage, component_counts: m.componentCounts,
  } });
}

test("household IDs and numeric confidence headings yield calculated, correctly scoped outcomes without a definition", async () => {
  const p = await profile(bytes);
  const basis = p.sheets[0].paired_outcome_basis;
  assert.equal(basis.discovery_version, 3);
  assert.equal(basis.status, "proposed");
  assert.deepEqual(basis.candidates, { participant_identifier: ["field_2"], stage: ["field_3"], instrument_version: ["field_5"], numeric_outcome: ["field_6", "field_7"] });
  assert.deepEqual(basis.outcome_heading_suggestions, { field_6: "Food planning confidence (1-5)", field_7: "Affordable meal confidence (1-5)" });
  assert.equal(suggestOutcomeHeading("confidence_score"), "Confidence score", "existing confidence-score labels remain available");
  const d = derivePersistablePairedOutcomes(p, "sheet_1");
  assert.equal(d.ok, true);
  assert.deepEqual(d.measurements.map((m) => [m.numerator, m.denominator, m.percentage, m.componentCounts.unchanged_count, m.componentCounts.decreased_count]), [[1, 2, "50.00", 1, 0], [0, 1, "0.00", 0, 1]]);
  for (const m of d.measurements) {
    assert.equal(m.definition.matching_unit, "household");
    assert.match(statementOf(m), /comparable household pairs/);
    assert.doesNotMatch(statementOf(m), /participant pairs|people|improved/);
    assert.match(statementOf(m), /whether higher is better is not established/);
  }
  assert.doesNotMatch(JSON.stringify(basis), /H0[123]|S0[1-6]|household_id|food_planning_confidence_1to5/);
});

test("pairing discovery uses repeated matching keys and numeric values with unfamiliar headings; dates and unique observation IDs are excluded", async () => {
  const generic = syntheticXlsxWorkbook({ cellFormats: [{ numFmtId: 14 }], sheets: [{ name: "Observations", rows: [
    ["entry_id", "case_ref", "phase", "response_date", "questionnaire_version", "Q1", "Q2"],
    ...rows.map((r, i) => [r[0], r[1].replace("H", "Z"), r[2], { number: 45778 + i, style: 2 }, ...r.slice(4)]),
  ] }] });
  const p = await profile(generic);
  const b = p.sheets[0].paired_outcome_basis;
  assert.deepEqual(b.candidates, { participant_identifier: ["field_2"], stage: ["field_3"], instrument_version: ["field_5"], numeric_outcome: ["field_6", "field_7"] });
  const d = derivePersistablePairedOutcomes(p, "sheet_1");
  assert.equal(d.ok, true);
  assert.deepEqual(d.measurements.map((m) => [m.numerator, m.denominator]), [[1, 2], [0, 1]]);
  for (const m of d.measurements) {
    assert.equal(m.definition.matching_unit, "identifier");
    assert.doesNotMatch(statementOf(m), /household|participant pairs|people/);
  }
  const ambiguous = await profile(syntheticXlsxWorkbook({ sheets: [{ rows: [
    ["entry_id", "case_ref", "phase", "response_date", "questionnaire_version", "Q1", "Q2", "other_reference"],
    ...rows.map((r) => [...r, r[1]]),
  ] }] }));
  assert.equal(ambiguous.sheets[0].paired_outcome_basis.status, "role_selection_required");
  assert.equal(derivePersistablePairedOutcomes(ambiguous, "sheet_1").ok, false, "two plausible keys are never silently resolved");
});

test("failed old discovery is rebuilt by the worker only from the admitted, exact verified workbook", async () => {
  let readCount = 0;
  const worker = (options = {}) => createCrossSourceReconciliationWorker({
    lockEligibleIntakeFile: async () => options.eligible !== false,
    readEligibilityFacts: async () => ({ organization_id: options.organization ?? "o1", object_version_id: "v1", verified_checksum: checksum,
      verified_size_bytes: bytes.length, file_extension: ".xlsx", mime_type: SYNTHETIC_XLSX_MIME, storage_provider: "local", storage_object_key: "synthetic.xlsx" }),
    storageAdapter: { async readObjectVersion() { readCount += 1; return { ok: true, data: { bytes: options.bytes ?? bytes } }; } },
  });
  const input = { organizationId: "o1", intakeFileId: "file1", checksum, worksheetKey: "sheet_1" };
  const result = await worker().readPairedOutcomeBasis(null, input);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result).sort(), ["basis", "ok", "recordCountBasis", "sheetKey"]);
  assert.equal(result.basis.status, "proposed");
  assert.doesNotMatch(JSON.stringify(result), /H0[123]|S0[1-6]|household_id/);
  const before = readCount;
  assert.equal((await worker({ eligible: false }).readPairedOutcomeBasis(null, input)).reason, "cross_source_upload_not_eligible");
  assert.equal((await worker({ organization: "other" }).readPairedOutcomeBasis(null, input)).reason, "cross_source_upload_not_eligible");
  assert.equal(readCount, before, "an unadmitted upload or tenant never reads bytes");
  assert.equal((await worker({ bytes: new Uint8Array(bytes).fill(0) }).readPairedOutcomeBasis(null, input)).reason, "cross_source_checksum_mismatch");
  assert.equal((await worker().readPairedOutcomeBasis(null, { ...input, worksheetKey: "sheet_99" })).ok, false);
});

test("old failed-profile recovery is read-only, rejects a different worksheet/table, and leaves valid committed results alone", async () => {
  const current = await profile(bytes);
  const sheet = current.sheets[0];
  const old = { ...sheet.paired_outcome_basis, discovery_version: undefined, status: "no_candidate", reason: "participant_identifier_not_found", alternatives: [] };
  const legacy = { ...current, sheets: [{ ...sheet, paired_outcome_basis: old }] };
  const original = JSON.stringify(legacy);
  const input = { organizationId: "o1", fileProfileRow: { profile: legacy, intake_file_id: "file1", checksum }, worksheetKey: "sheet_1" };
  let calls = 0;
  const worker = { async readPairedOutcomeBasis(_tx, args) {
    calls += 1;
    assert.deepEqual(args, { organizationId: "o1", intakeFileId: "file1", checksum, worksheetKey: "sheet_1" });
    return { ok: true, sheetKey: "sheet_1", basis: sheet.paired_outcome_basis, recordCountBasis: sheet.record_count_basis };
  } };
  const recovered = await profileWithCurrentPairedBasis(null, { ...input, worker });
  assert.equal(derivePersistablePairedOutcomes(recovered, "sheet_1").ok, true);
  assert.equal(JSON.stringify(legacy), original, "the stored profile object remains byte-identical");
  const unchanged = await profileWithCurrentPairedBasis(null, { ...input, fileProfileRow: { ...input.fileProfileRow, profile: current }, worker });
  assert.equal(unchanged, current);
  assert.equal(calls, 1, "valid current calculations never invoke recovery");
  for (const bad of [
    { ok: false, reason: "cross_source_checksum_mismatch" },
    { ok: true, sheetKey: "sheet_2", basis: sheet.paired_outcome_basis, recordCountBasis: sheet.record_count_basis },
    { ok: true, sheetKey: "sheet_1", basis: sheet.paired_outcome_basis, recordCountBasis: { ...sheet.record_count_basis, data_record_count: 999 } },
  ]) {
    const refused = await profileWithCurrentPairedBasis(null, { ...input, worker: { async readPairedOutcomeBasis() { return bad; } } });
    const result = derivePersistablePairedOutcomes(refused, "sheet_1");
    assert.equal(result.ok, false);
    assert.equal(result.blockers[0].blocking_reason, "paired_outcome_verified_workbook_unavailable");
    assert.doesNotMatch(result.blockers[0].required_fix, /Select the worksheet|new intake/);
    assert.equal(JSON.stringify(legacy), original);
  }
});

const packagePath = process.env.KAI_WILLOW_QUAY_PACKAGE;
const workbookPath = packagePath && join(packagePath, "01_UPLOAD_TO_KAI/04_Surveys_Referrals_and_Targets.xlsx");
test("original Willow Quay 121/49/6 workbook: both calculated outcomes agree with independent row arithmetic", {
  skip: !workbookPath || !existsSync(workbookPath) ? "set KAI_WILLOW_QUAY_PACKAGE to the synthetic package" : false,
}, async () => {
  const original = readFileSync(workbookPath);
  const p = await profile(original);
  assert.deepEqual(p.sheets.map((s) => s.record_count_basis.data_record_count), [121, 49, 6]);
  const records = (await readTrustedWorksheetRecords({ bytes: original, sheetKey: "sheet_1" })).slice(1);
  const byHousehold = new Map();
  for (const row of records) byHousehold.set(row[1], [...(byHousehold.get(row[1]) ?? []), row]);
  const oracle = (column) => {
    let increased = 0, unchanged = 0, decreased = 0;
    for (const observations of byHousehold.values()) {
      const before = observations.filter((r) => r[2] === "baseline");
      const after = observations.filter((r) => r[2] === "followup");
      if (before.length !== 1 || after.length !== 1 || before[0][4] !== after[0][4] || before[0][column] === "" || after[0][column] === "") continue;
      const a = Number(before[0][column]), b = Number(after[0][column]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      if (b > a) increased += 1; else if (b < a) decreased += 1; else unchanged += 1;
    }
    return [increased, increased + unchanged + decreased, unchanged, decreased];
  };
  const d = derivePersistablePairedOutcomes(p, "sheet_1");
  const actual = d.measurements.map((m) => [m.numerator, m.denominator, m.componentCounts.unchanged_count, m.componentCounts.decreased_count]);
  assert.deepEqual(actual, [oracle(5), oracle(6)]);
  assert.deepEqual(actual, [[32, 43, 6, 5], [31, 41, 7, 3]]);
  assert.deepEqual(d.measurements.map((m) => m.percentage), ["74.42", "75.61"]);
  assert.equal(derivePersistablePairedOutcomes(p, "sheet_2").ok, false);
  assert.equal(derivePersistablePairedOutcomes(p, "sheet_3").ok, false);
});
