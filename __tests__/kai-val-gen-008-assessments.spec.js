import test from "node:test";
import assert from "node:assert/strict";
import { createProductionEvidenceSummaryDraftGenerator } from "../Backend/kai/services/kaiEvidenceSummaryDraftGenerator.js";
import { composeCountOnlyFindingText, validateGeneratedContentDraft } from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { measurementLimitationCodes } from "../Backend/kai/validators/kaiSourceMeasurementValidators.js";

// Synthetic contract reproduction, NOT attribution of the owner's failed POST.
const measurement = {
  measured_value: 112, blank_record_count: 0, duplicate_record_count: 0,
  period_start: null, period_end: null, worksheet_key: "sheet_1",
  calculation_method: "p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1",
};
const dimensions = {
  conflicting_source_indicators: { assessment_status: "unresolved" },
  missingness: { assessment_status: "resolved_risk_flagged" },
  requirement_alignment: { assessment_status: "unresolved" },
  small_cell_risk: { assessment_status: "unresolved" },
  time_period_clarity: { assessment_status: "resolved_risk_flagged" },
};
const statement = "The source records 112 assessment records in selected worksheet sheet_1, one dated participant assessment per row, including baseline and followup, V1 and V2 assessment-tool versions and unanswered score items; 0 blank rows excluded and 0 exact-duplicate rows included. No reporting period is defined.";
const claim = {
  claimId: "c0000000-0000-4000-8000-000000000001",
  evidenceItemId: "e0000000-0000-4000-8000-000000000001",
  sourceVersionId: "70000000-0000-4000-8000-000000000001",
  sourceId: "b0000000-0000-4000-8000-000000000001", claimType: "finding",
  claimStatement: statement, requestedAudience: "internal", revalidatedForGeneration: true,
  currentEligible: true, audienceAuthority: { internal: true },
  limitationCodes: measurementLimitationCodes({ measurementRow: measurement, dimensions }),
};
const disclosure = " This is a count of assessment records under a human-defined record meaning, not independently verified by KAI. No reporting period is defined.";
const coverage = " Limitations: conflicting sources unresolved; missing values retained; funder requirements alignment unresolved; small-cell risk unresolved; reporting-period limitation retained.";
const good = `112 assessment records were counted in selected worksheet sheet_1.${disclosure}${coverage}`;
const generatorProjection = ({ claimId, evidenceItemId, sourceId, sourceVersionId, claimType, claimStatement, limitationCodes }) =>
  ({ claimId, evidenceItemId, sourceId, sourceVersionId, claimType, claimStatement, limitationCodes });
async function generate(text, projectedClaim = claim) {
  let payload;
  const generator = createProductionEvidenceSummaryDraftGenerator({ createMessage: async (input) => {
    payload = input;
    return { content: [{ type: "text", text: JSON.stringify({ blocks: [{ text, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] }] }) }] };
  } });
  const output = await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: [generatorProjection(projectedClaim)] });
  return { output, payload, validation: validateGeneratedContentDraft({ contentType: "evidence_summary", requestedAudience: "internal", generationClaims: [projectedClaim], blocks: output.blocks }) };
}

test("synthetic Assessments: complete disclosure survives the real adapter and passes all generation validators", async () => {
  const { output, payload, validation } = await generate(good);
  assert.equal(validation.ok, true, JSON.stringify(validation.blockers));
  assert.equal(output.blocks[0].text, good);
  assert.deepEqual(output.blocks[0].citations, [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }]);
  assert.deepEqual(JSON.parse(payload.messages[0].content).claims[0], generatorProjection(claim));
  assert.match(output.blocks[0].text, /^112 assessment records/);
  assert.doesNotMatch(output.blocks[0].text, /112 (?:unique participants|outcomes|improvements)/);
});

test("synthetic Assessments: each omitted required disclosure fails specifically VAL-GEN-008 after normalization", async () => {
  for (const text of [good.replace("No reporting period is defined.", ""), good.replace("human-defined", "organization-supplied"), good.replace("count of assessment records", "measurement"), good.replace(coverage, "")]) {
    const { output, validation } = await generate(text);
    assert.equal(output.blocks[0].text, text, "normalization does not remove or repair disclosure");
    assert.deepEqual(validation.blockers.map((b) => [b.validator_key, b.blocking_reason]), [["VAL-GEN-008", "material_limitation_not_disclosed"]]);
    assert.deepEqual(validation.blockers[0].evidence.block_ordinals, [1]);
  }
});

test("synthetic Assessments: internal acceptance retains unresolved coverage and its disclosure requirement", async () => {
  const accepted = Object.fromEntries(Object.entries(dimensions).map(([key, value]) => [key, { ...value, internal_limitation_accepted: true }]));
  const codes = measurementLimitationCodes({ measurementRow: measurement, dimensions: accepted });
  assert.equal(codes.filter((code) => code.endsWith("accepted_internal_limitation")).length, 5);
  const projected = { ...claim, limitationCodes: codes };
  assert.equal((await generate(good, projected)).validation.ok, true);
  assert.equal((await generate(good.replace(coverage, ""), projected)).validation.blockers[0].blocking_reason, "material_limitation_not_disclosed");
  assert.equal(dimensions.small_cell_risk.assessment_status, "unresolved");
});

test("synthetic Assessments: selection dates never become a formal period in projection or count-only composition", () => {
  const selected = { ...measurement, selection_start: "2025-04-01", selection_end: "2026-03-31" };
  const codes = measurementLimitationCodes({ measurementRow: selected, dimensions });
  assert.ok(codes.includes("measurement.no_reporting_period"));
  assert.ok(!codes.includes("measurement.period_human_attested_not_row_verified"));
  assert.ok(!codes.includes("measurement.blank_records_excluded"));
  assert.ok(!codes.includes("measurement.duplicate_records_included"));
  const text = composeCountOnlyFindingText(selected);
  assert.match(text, /^112 nonblank data rows were counted in worksheet sheet_1/);
  assert.match(text, /No reporting period was defined/);
  assert.doesNotMatch(text, /2025-04-01|2026-03-31/);
  const validation = validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: [claim], blocks: [{ ordinal: 1, text, citations: [{ claimId: claim.claimId, evidenceItemId: claim.evidenceItemId }] }] });
  assert.equal(validation.ok, true, JSON.stringify(validation.blockers));
});

test("synthetic Assessments: valid disclosure does not bypass numeric or citation validators", async () => {
  const numeric = await generate(good.replace("112 assessment", "113 assessment"));
  assert.deepEqual(numeric.validation.blockers.map((b) => b.validator_key), ["VAL-GEN-004"]);
  const { output } = await generate(good);
  output.blocks[0].citations[0].evidenceItemId = "e0000000-0000-4000-8000-000000000002";
  const result = validateGeneratedContentDraft({ requestedAudience: "internal", generationClaims: [claim], blocks: output.blocks });
  assert.deepEqual(result.blockers.map((b) => b.validator_key), ["VAL-GEN-002", "VAL-GEN-003"]);
});
