import test from "node:test";
import assert from "node:assert/strict";

import * as generatedContentValidators from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import { serializeInternalReportToMarkdown } from "../Backend/kai/services/kaiInternalReportMarkdownSerializer.js";

/**
 * Truthful count-only Evidence Summary (owner prompt "KAI — Package 3",
 * 2026-10-31). Case I4 of the XLSX acceptance showed that a model sentence
 * restating the human-defined label as the counted thing passed VAL-GEN-010,
 * because that boundary is lexical: a word the cited claim statement uses
 * (the label "service events") is not an added assertion. The count-only
 * finding is therefore composed by the server from the exact cited
 * measurement, a persisted count-only block is accepted only when it is that
 * composition, and the report states the worksheet-row count in every
 * section. The connected proof is case K of
 * kai-customer-xlsx-file-to-report-browser-acceptance.integration.spec.js.
 */
const { COUNT_ONLY_LIMITATION_CODE, validateGeneratedContentDraft } = generatedContentValidators;
const CLAIM_5 = "c0000000-0000-4000-8000-000000000005";
const EVIDENCE_5 = "e0000000-0000-4000-8000-000000000005";
const SOURCE = "b0000000-0000-4000-8000-000000000001";
const VERSION = "70000000-0000-4000-8000-000000000001";
const SHEET_5_STATEMENT = "The promoted source records 37 service events with no reporting period defined in selected worksheet sheet_5 "
  + "(record count: one service event per selected worksheet data row; 0 blank records excluded, 0 exact-duplicate records included).";
const SHEET_5_LIMITATIONS = Object.freeze(["measurement.no_reporting_period", "measurement.record_meaning_human_defined", COUNT_ONLY_LIMITATION_CODE]);
const I4_SENTENCE = "In selected worksheet sheet_5 the promoted source records 37 service events.";
const SHEET_5_MEASUREMENT = Object.freeze({
  evidence_item_id: EVIDENCE_5, measured_value: 37, total_record_count: 37, blank_record_count: 0, duplicate_record_count: 0,
  calculation_method: "p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1", worksheet_key: "sheet_5", period_start: null, period_end: null,
});

const generationClaim = (statement = SHEET_5_STATEMENT, limitationCodes = SHEET_5_LIMITATIONS) => ({
  claimId: CLAIM_5, claimStatement: statement, evidenceItemId: EVIDENCE_5, requestedAudience: "internal", revalidatedForGeneration: true,
  audienceAuthority: { internal: true }, limitationCodes: [...limitationCodes],
});

test("I4 regression: the lexical boundary alone admits the misleading sentence (the defect path)", () => {
  // VAL-GEN-008 would require the limitation wording; VAL-GEN-010 admits
  // "service events" because the cited statement uses the label.
  const withDisclosure = `${I4_SENTENCE} It is a count of records under the human-defined definition; no reporting period is defined.`;
  const result = validateGeneratedContentDraft({
    requestedAudience: "internal", generationClaims: [generationClaim()], contentType: "evidence_summary",
    blocks: [{ ordinal: 1, text: withDisclosure, citations: [{ claimId: CLAIM_5, evidenceItemId: EVIDENCE_5 }] }],
  });
  assert.equal(result.ok, true, "the lexical validators pass it, so they cannot be the guard");
});

test("I4 regression: a count-only block is accepted only when it is exactly the server-composed finding of its own measurement", () => {
  const { composeCountOnlyFindingText, countOnlyBlockMatchesMeasurement } = generatedContentValidators;
  assert.equal(typeof composeCountOnlyFindingText, "function", "a server-composed count-only finding exists");
  const composed = composeCountOnlyFindingText(SHEET_5_MEASUREMENT);
  assert.match(composed, /^37 nonblank data rows were counted in worksheet sheet_5\b/);
  assert.equal(countOnlyBlockMatchesMeasurement({ text: composed, citations: [{ claimId: CLAIM_5, evidenceItemId: EVIDENCE_5 }] }, SHEET_5_MEASUREMENT), true);
  for (const text of [I4_SENTENCE, `${I4_SENTENCE} It is a count of records under the human-defined definition.`, `${composed} These are 37 service events.`]) {
    assert.equal(countOnlyBlockMatchesMeasurement({ text, citations: [{ claimId: CLAIM_5, evidenceItemId: EVIDENCE_5 }] }, SHEET_5_MEASUREMENT), false, text);
  }
});

function i4Model() {
  return {
    modelContractVersion: "kai-sprint2-internal-report-model-v1", available: true, getKinderReviewReasons: [], blockedReasons: [],
    report: { generatedContentDraftId: "d0000000-0000-4000-8000-000000000001", generationRunId: "a0000000-0000-4000-8000-000000000001", contentType: "evidence_summary", audience: "internal", createdAt: "2026-10-30T10:00:00.000Z", validatorKeys: ["VAL-GEN-008", "VAL-GEN-010"] },
    context: { organizationId: "11111111-2222-4333-8444-555555555555", organizationName: "Synthetic Society" },
    blocks: [{ ordinal: 1, text: "37 nonblank data rows were counted in worksheet sheet_5.", citationRefs: ["CIT-001"] }],
    citations: [{ citationRef: "CIT-001", claimId: CLAIM_5, evidenceItemId: EVIDENCE_5, sourceId: SOURCE, sourceCode: "svc", sourceVersionId: VERSION, worksheetKey: "sheet_5", worksheetName: "Data_Dictionary" }],
    facts: [{
      citationRefs: ["CIT-001"], claimId: CLAIM_5, evidenceItemId: EVIDENCE_5, sourceId: SOURCE, sourceCode: "svc", sourceVersionId: VERSION,
      sourceVersionCreatedAt: null, sourceVersionCurrent: true, profileCanonicalSha256: "ab".repeat(32), claimStatement: SHEET_5_STATEMENT,
      evidenceStatement: "Source version record count: 37 service events with no reporting period defined, from selected worksheet sheet_5, counting each selected worksheet data row after the header row as one service event; 0 blank records excluded; 0 exact-duplicate records included.",
      currentlyEligible: true, blockerCodes: [], countOnly: true, evidenceReviewOutcome: null, claimReviewOutcome: null,
      measurement: {
        measuredValue: 37, unitLabel: "service events", countedUnit: "service event", totalRecordCount: 37, blankRecordCount: 0, duplicateRecordCount: 0,
        calculationMethod: "p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1", worksheetKey: "sheet_5", worksheetName: "Data_Dictionary",
        periodStart: null, periodEnd: null, definitionText: null, inclusionRule: null, exclusionRule: null, definitionRecordedAt: null,
      },
      limitationCodes: [...SHEET_5_LIMITATIONS],
    }],
  };
}

test("I4 regression: no section of the count-only report states 37 service events, activity volume, or reproduces the label-bearing statements as findings", () => {
  const markdown = serializeInternalReportToMarkdown(i4Model());
  assert.doesNotMatch(markdown, /\b37 service events\b/, "the human label is never the stated count, including in References");
  assert.doesNotMatch(markdown, /volume-of-activity|activity volume/, "a Data_Dictionary row count is not an activity figure");
  assert.match(markdown, /\*\*37 nonblank data rows were counted in Data_Dictionary \(`sheet_5`\)\*\*/);
});

const CLAIM_3 = "c0000000-0000-4000-8000-000000000003";
const EVIDENCE_3 = "e0000000-0000-4000-8000-000000000003";
const SHEET_3_STATEMENT = "The promoted source records 364 service events for the reporting period 2026-09-01 to 2026-09-30 in selected worksheet sheet_3 "
  + "(record count: one service event per selected worksheet data row; 0 blank records excluded, 2 exact-duplicate records included).";
const SHEET_3_LIMITATIONS = Object.freeze(["coverage.small_cell_risk.accepted_internal_with_limitation", "measurement.duplicate_records_included",
  "measurement.period_human_attested_not_row_verified", "measurement.record_meaning_human_defined", COUNT_ONLY_LIMITATION_CODE]);
const SHEET_3_MEASUREMENT = Object.freeze({
  evidence_item_id: EVIDENCE_3, measured_value: 364, total_record_count: 364, blank_record_count: 0, duplicate_record_count: 2,
  calculation_method: "p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1", worksheet_key: "sheet_3", period_start: "2026-09-01", period_end: "2026-09-30",
});

test("composed finding: each worksheet's text is its own measurement's numbers and key, passes every validator on its own terms, and carries no label or free text", () => {
  const { composeCountOnlyFindingText } = generatedContentValidators;
  const cases = [
    [CLAIM_3, EVIDENCE_3, SHEET_3_STATEMENT, SHEET_3_LIMITATIONS, SHEET_3_MEASUREMENT],
    [CLAIM_5, EVIDENCE_5, SHEET_5_STATEMENT, SHEET_5_LIMITATIONS, SHEET_5_MEASUREMENT],
  ];
  for (const [claimId, evidenceItemId, statement, limitationCodes, measurement] of cases) {
    const text = composeCountOnlyFindingText(measurement);
    const result = validateGeneratedContentDraft({
      requestedAudience: "internal", contentType: "evidence_summary",
      generationClaims: [{ ...generationClaim(statement, limitationCodes), claimId, evidenceItemId }],
      blocks: [{ ordinal: 1, text, citations: [{ claimId, evidenceItemId }] }],
    });
    assert.equal(result.ok, true, `${measurement.worksheet_key}: ${JSON.stringify(result.blockers)}`);
    assert.deepEqual(result.results.map((entry) => entry.validator_key), ["VAL-GEN-001", "VAL-GEN-002", "VAL-GEN-003", "VAL-GEN-004", "VAL-GEN-008", "VAL-GEN-010", "VAL-GEN-005"]);
    assert.doesNotMatch(text, /service|event|participant|outcome|completion|Data_Dictionary|Service_Events|"/i, "no label, worksheet name, or free text");
  }
  const s3 = composeCountOnlyFindingText(SHEET_3_MEASUREMENT);
  assert.match(s3, /^364 nonblank data rows were counted in worksheet sheet_3, with 0 blank rows excluded and 2 exact-duplicate rows included in the count\./);
  assert.match(s3, /The reporting period 2026-09-01 to 2026-09-30 is attested in that definition and was not verified against dates in the rows\./);
  assert.match(composeCountOnlyFindingText(SHEET_5_MEASUREMENT), /No reporting period was defined for the count\./);
  // The text depends only on the measurement: the same row composes the same text.
  assert.equal(composeCountOnlyFindingText({ ...SHEET_3_MEASUREMENT }), s3);
  // A whole-version CSV count names no worksheet.
  const csv = composeCountOnlyFindingText({ ...SHEET_5_MEASUREMENT, calculation_method: "p1_csv_profile_data_records_excluding_blank_v1", worksheet_key: null });
  assert.match(csv, /^37 nonblank data rows were counted in the CSV data records of the cited source version,/);
  // Neither worksheet's block is accepted for the other's measurement.
  const { countOnlyBlockMatchesMeasurement } = generatedContentValidators;
  assert.equal(countOnlyBlockMatchesMeasurement({ text: s3, citations: [{ claimId: CLAIM_5, evidenceItemId: EVIDENCE_5 }] }, SHEET_5_MEASUREMENT), false);
  assert.equal(countOnlyBlockMatchesMeasurement({ text: s3, citations: [{ claimId: CLAIM_3, evidenceItemId: EVIDENCE_3 }] }, SHEET_5_MEASUREMENT), false);
  assert.equal(countOnlyBlockMatchesMeasurement({ text: s3, citations: [{ claimId: CLAIM_3, evidenceItemId: EVIDENCE_3 }, { claimId: CLAIM_5, evidenceItemId: EVIDENCE_5 }] }, SHEET_3_MEASUREMENT), false,
    "a count-only block cites exactly its one claim");
  assert.equal(countOnlyBlockMatchesMeasurement({ text: s3, citations: [{ claimId: CLAIM_3, evidenceItemId: EVIDENCE_3 }] }, null), false);
});

function twoWorksheetModel({ label5 = "service event", labels5 = "service events" } = {}) {
  const model = i4Model();
  model.blocks = [
    { ordinal: 1, text: generatedContentValidators.composeCountOnlyFindingText(SHEET_3_MEASUREMENT), citationRefs: ["CIT-001"] },
    { ordinal: 2, text: generatedContentValidators.composeCountOnlyFindingText(SHEET_5_MEASUREMENT), citationRefs: ["CIT-002"] },
  ];
  const sheet5 = model.facts[0];
  sheet5.citationRefs = ["CIT-002"];
  Object.assign(sheet5.measurement, { countedUnit: label5, unitLabel: labels5 });
  model.facts = [{
    ...sheet5, citationRefs: ["CIT-001"], claimId: CLAIM_3, evidenceItemId: EVIDENCE_3, claimStatement: SHEET_3_STATEMENT,
    evidenceStatement: "Source version record count: 364 service events ...", limitationCodes: [...SHEET_3_LIMITATIONS],
    measurement: {
      ...sheet5.measurement, countedUnit: "service event", unitLabel: "service events", measuredValue: 364, totalRecordCount: 364, duplicateRecordCount: 2,
      worksheetKey: "sheet_3", worksheetName: "Service_Events", periodStart: "2026-09-01", periodEnd: "2026-09-30",
    },
  }, sheet5];
  return model;
}

test("two worksheets of one version: each section states each worksheet's own count, and neither acquires the other's count, meaning or citation", () => {
  const markdown = serializeInternalReportToMarkdown(twoWorksheetModel());
  const section = (from, to) => markdown.slice(markdown.indexOf(`\n## ${from}\n`), markdown.indexOf(`\n## ${to}\n`));
  const findings = section("Key findings", "Reporting period").split("\n").filter((line) => line.startsWith("- "));
  assert.equal(findings.length, 2);
  assert.match(findings[0], /^- \*\*364 nonblank data rows were counted in Service_Events \(`sheet_3`\), including 2 exact-duplicate records\*\*; 0 blank rows were excluded\. The organization states the reporting period 2026-09-01 to 2026-09-30; it was not checked against dates in the rows\. .* \[CIT-001\]$/);
  assert.match(findings[1], /^- \*\*37 nonblank data rows were counted in Data_Dictionary \(`sheet_5`\)\*\*; 0 blank rows were excluded\. .* \[CIT-002\]$/);
  assert.doesNotMatch(findings[1], /364|sheet_3|duplicate|2026-09/);
  assert.doesNotMatch(findings[0], /\b37\b|sheet_5|Data_Dictionary/);
  assert.doesNotMatch(markdown, /\b(?:37|364) service events\b|\b(?:37|364) \w+ (?:events|participants|completions|outcomes)\b/);
  assert.doesNotMatch(markdown, /\b401\b/, "the two counts are never combined");
  assert.match(section("Generated narrative", "Source and evidence traceability"), /composed by KAI from the persisted measurement of each cited claim, not written by a language model/);
  const references = markdown.slice(markdown.indexOf("\n## References\n"));
  assert.match(references, new RegExp(`\\[CIT-001\\] Claim \`${CLAIM_3}\` and evidence \`${EVIDENCE_3}\`: authoritative measurement 364 nonblank data rows in Service_Events \\(\`sheet_3\`\\)`));
  assert.match(references, new RegExp(`\\[CIT-002\\] Claim \`${CLAIM_5}\` and evidence \`${EVIDENCE_5}\`: authoritative measurement 37 nonblank data rows in Data_Dictionary \\(\`sheet_5\`\\)`));
  assert.doesNotMatch(references, /The promoted source records|Source version record count/, "the label-bearing statements are not reproduced");
  assert.match(section("Analysis", "Generated narrative"), /not a measure of activity, reach or results/);
  assert.doesNotMatch(section("Analysis", "Generated narrative"), /volume-of-activity/);
});

test("adversarial human labels stay quoted, attributed and unverified, and never become the finding", () => {
  for (const [label, labels] of [["verified service completion", "verified service completions"], ["distinct participant", "distinct participants"],
    ["programme outcome", "programme outcomes"], ["unit of activity volume", "units of activity volume"]]) {
    const markdown = serializeInternalReportToMarkdown(twoWorksheetModel({ label5: label, labels5: labels }));
    const finding = markdown.split("\n").find((line) => line.includes("[CIT-002]") && line.startsWith("- **37"));
    assert.match(finding, /^- \*\*37 nonblank data rows were counted in Data_Dictionary \(`sheet_5`\)\*\*;/, label);
    for (const line of markdown.split("\n").filter((entry) => entry.includes(label))) {
      assert.match(line, new RegExp(`\`${label}s?\``), `${label}: only ever quoted as the recorded label: ${line}`);
      assert.match(line, /defined|human-defined|label/, `${label}: always attributed: ${line}`);
    }
    assert.doesNotMatch(markdown, new RegExp(`\\b37 ${labels}\\b`), label);
  }
});
