import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { readFactualReviewMeasurementsInTransaction } from "../Backend/kai/dictionary/postgresOrganizationFactualReviewRepository.js";
import * as D from "../Backend/kai/validators/kaiDerivedMeasurementValidators.js";
import { MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD } from "../Backend/kai/validators/kaiSourceMeasurementValidators.js";
import { canReviewMeasuredFinding } from "../frontend/impactEvidenceLibraryLogic.js";
import * as L from "../frontend/knowledgeStudio/clientMeasuredClaimReviewLogic.js";

/**
 * Owner prompt 2026-11-12: the uninterpreted paired-outcome factual review.
 * The server returned the Cedar Employment readiness result as
 * derived_measurement (measurement: null, interpretation: null), and the
 * shared frontend adapter dropped it, so both factual-review panels showed
 * only the claim's internal wording (field_7, sheet_1) under record-count
 * presentation. The DTOs below come from the real server projection
 * (readFactualReviewMeasurementsInTransaction) over synthetic rows with the
 * reported arithmetic; the connected proof is Cedar test "11a (browser)".
 */
const ORG = "21000000-0000-4000-8000-000000000001";
const VERSION = "22000000-0000-4000-8000-000000000001";
const EVIDENCE = "23000000-0000-4000-8000-000000000001";
const MEASUREMENT = "25000000-0000-4000-8000-000000000001";
const INTERPRETATION = "26000000-0000-4000-8000-000000000001";
const PRIVATE = "PRIVATE_PARTICIPANT_CONTENT_MUST_NOT_BE_PROJECTED";
const dimensions = { conflicting_source_indicators: { assessment_status: "unresolved", internal_limitation_accepted: false } };

function pairedRow(interpretation = null) {
  return {
    organization_id: ORG, evidence_item_id: EVIDENCE, source_version_id: VERSION, measurement_source_version_id: VERSION,
    source_derived_measurement_id: MEASUREMENT, measurement_family: D.DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME,
    calculation_method: D.DERIVED_MEASUREMENT_METHODS.PAIRED_OUTCOME, worksheet_key: "sheet_1",
    definition: { outcome_field_key: "field_7", outcome_column: "G", participant_field_key: "field_2", stage_field_key: "field_4", instrument_version_field_key: "field_5" },
    field_keys: ["field_2", "field_4", "field_5", "field_7"], measured_value: 23, numerator: 23, denominator: 40, percentage: "57.50",
    component_counts: { participant_count: 62, comparable_pair_count: 40, increased_count: 23, unchanged_count: 13, decreased_count: 4, excluded_participant_count: 22 },
    exclusions: { participants: [
      { reason: "no_baseline_observation", participant_count: 5, rows: [PRIVATE] },
      { reason: "no_followup_observation", participant_count: 7, rows: [PRIVATE] },
      { reason: "instrument_version_mismatch", participant_count: 8, rows: [PRIVATE] },
      { reason: "missing_baseline_value", participant_count: 2, rows: [PRIVATE] },
    ], rows: [{ reason: "blank_participant_identifier", row_count: 0, rows: [PRIVATE] }] },
    row_locators: { comparable_pairs: [PRIVATE] }, profile_canonical_sha256: "b".repeat(64),
    interpretation_id: interpretation ? INTERPRETATION : null,
    current_interpretation_id: interpretation ? INTERPRETATION : null,
    ...(interpretation || {}),
    contributing_sources: [],
  };
}

// The factual-review DTO exactly as the server composes it (claim fields, then the projection).
async function serverDto(interpretation = null) {
  const row = pairedRow(interpretation);
  const evidenceItemRow = { organization_id: ORG, evidence_item_id: EVIDENCE, source_version_id: VERSION, evidence_type: D.DERIVED_MEASUREMENT_EVIDENCE_TYPE,
    data_class: D.DERIVED_MEASUREMENT_DATA_CLASS, statement: D.composeDerivedMeasurementEvidenceStatement({ measurementRow: row, interpretation: D.interpretationOf(row) }) };
  const locatorRow = { locator_type: D.DERIVED_MEASUREMENT_LOCATOR_TYPE, coordinates: D.derivedMeasurementLocatorCoordinates({ sheetKey: "sheet_1", fieldKeys: row.field_keys }) };
  const sourceVersionRow = { organization_id: ORG, source_version_id: VERSION, is_current: true, profile_canonical_sha256: row.profile_canonical_sha256 };
  const tx = { async query(sql) {
    assert.match(sql.trim(), /^SELECT\b/);
    if (/FROM kai\.evidence_measurements m/.test(sql)) return { rows: [] };
    if (/FROM kai\.evidence_derived_measurements l/.test(sql)) return { rows: [row] };
    assert.fail(`Unexpected SQL read: ${sql}`);
  } };
  const result = await readFactualReviewMeasurementsInTransaction(tx, { organizationId: ORG, evidenceItemRow, locatorRow, sourceVersionRow, dimensions });
  assert.equal(result.ok, true);
  return {
    claim_id: "24000000-0000-4000-8000-000000000001", evidence_item_id: EVIDENCE,
    claim_statement: D.composeDerivedClaimStatementFromRow(row), evidence_statement: evidenceItemRow.statement,
    source: { source_code: "SRC-1", is_current: true },
    ...result.data,
    internal_eligibility: { eligible: true, blocker_codes: [] },
    ordinary_internal_rule: { applies: true, reasons: [] },
    viewer: "organization_administrator",
  };
}
const HUMAN = { indicator_label: "Employment readiness", meaning_text: "Synthetic: the participant's self-rated employment readiness.", score_direction: "not_established", evidence_basis: "self_reported" };

test("adapter: a paired derived_measurement survives the projection when measurement is null (failed before: dropped)", async () => {
  const dto = await serverDto();
  assert.equal(dto.measurement, null);
  assert.equal(dto.derived_measurement.interpretation, null);
  const review = L.projectOrganizationFactualReview(dto);
  assert.equal(review.measurement, null);
  assert.ok(review.derivedMeasurement, "derived_measurement must reach the panels");
  assert.deepEqual(review.derivedMeasurement, {
    measurementType: "paired_outcome_change", sourceDerivedMeasurementId: MEASUREMENT, evidenceItemId: EVIDENCE, sourceVersionId: VERSION, isCurrent: true,
    worksheetKey: "sheet_1", outcomeFieldKey: "field_7", calculationMethod: D.DERIVED_MEASUREMENT_METHODS.PAIRED_OUTCOME,
    numerator: 23, denominator: 40, percentage: "57.50", increasedCount: 23, unchangedCount: 13, decreasedCount: 4,
    participantCount: 62, comparablePairCount: 40, excludedParticipantCount: 22,
    exclusions: {
      participants: [
        { reason: "no_baseline_observation", participantCount: 5 }, { reason: "no_followup_observation", participantCount: 7 },
        { reason: "instrument_version_mismatch", participantCount: 8 }, { reason: "missing_baseline_value", participantCount: 2 },
      ],
      rows: [{ reason: "blank_participant_identifier", rowCount: 0 }],
    },
    interpretation: null, scoreDirection: "not_established", reportingPeriod: null,
  });
  // Limitations, source and eligibility the view needs are kept; nothing private is projected.
  for (const code of ["derived.meaning_proposed", "derived.direction_not_established", "derived.no_reporting_period", "derived.observations_excluded", "derived.matched_subset_only"]) {
    assert.ok(review.limitations.some((l) => l.code === code && l.description.length > 0), code);
  }
  assert.deepEqual([review.source.sourceCode, review.source.isCurrent, review.internalEligibility.eligible], ["SRC-1", true, true]);
  assert.doesNotMatch(JSON.stringify(review), new RegExp(PRIVATE));
});

test("adapter: a recorded interpretation is kept; an ordinary record-count measurement keeps its schema and no derived result", async () => {
  const interpreted = L.projectOrganizationFactualReview(await serverDto(HUMAN));
  assert.deepEqual(interpreted.derivedMeasurement.interpretation, {
    interpretationId: INTERPRETATION, indicatorLabel: "Employment readiness", meaningText: HUMAN.meaning_text, scoreDirection: "not_established", evidenceBasis: "self_reported",
  });
  assert.ok(interpreted.limitations.some((l) => l.code === "derived.meaning_human_stated"));
  const recordCount = L.projectOrganizationFactualReview({
    measurement: { calculation_method: MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD, worksheet_key: "sheet_1", worksheet_name: "Sessions", measured_value: 5, unit_label: "sessions",
      counted_unit: "session", total_record_count: 6, blank_record_count: 1, duplicate_record_count: 0, period_start: null, period_end: null,
      definition_text: "A recorded session.", inclusion_rule: "Nonblank.", exclusion_rule: "Blank." },
    derived_measurement: null,
  });
  assert.equal(recordCount.derivedMeasurement, null);
  assert.equal(recordCount.measurement.measuredValue, 5);
  assert.equal(recordCount.measurement.definitionText, "A recorded session.");
  assert.equal(L.measurementReviewNoun(recordCount), "count");
  assert.equal(L.measurementReviewNoun(interpreted), "result");
  // Missing optional fields never crash the projection or the reading.
  const sparse = L.projectOrganizationFactualReview({ derived_measurement: { measurement_type: "paired_outcome_change" } });
  assert.equal(sparse.derivedMeasurement.interpretation, null);
  assert.equal(sparse.derivedMeasurement.scoreDirection, "not_established");
  const sparseText = L.pairedOutcomeReviewText(sparse.derivedMeasurement);
  assert.equal(sparseText.result, "The paired result is not available.");
  assert.equal(sparseText.meaningRecorded, false);
});

test("reading: 23/13/4 of 40 and 22 of 62, no improvement, no recorded definition, no period, keys only in source details", async () => {
  const review = L.projectOrganizationFactualReview(await serverDto());
  for (const audience of ["organization", "get_kinder"]) {
    const text = L.pairedOutcomeReviewText(review.derivedMeasurement, { audience });
    const visible = [text.heading, text.subheading, text.result, text.population, ...text.meaning, text.period, text.method, text.currentness].filter(Boolean).join("\n");
    assert.equal(text.heading, "Paired baseline/follow-up outcome");
    assert.equal(text.result, "Among 40 participants with comparable baseline and follow-up values, 23 (57.50%) had a higher follow-up value, 13 were unchanged and 4 had a lower follow-up value.");
    assert.equal(text.population, "22 of 62 participants were excluded because they had no comparable baseline and follow-up pair: 5 with no baseline observation; "
      + "7 with no follow-up observation; 8 whose baseline and follow-up used different instrument versions; 2 with a missing baseline value. "
      + "The result covers the 40 comparable participants only, not everyone served.");
    assert.match(visible, new RegExp(`${audience === "organization" ? "your organization" : "the organization"} has not stated what these values represent or whether a higher value is better`));
    assert.match(visible, /No reporting period was applied to this measurement; the Project's reporting period is not assumed\./);
    assert.doesNotMatch(visible, /\bfield_\d+\b|\bsheet_\d+\b/);
    assert.doesNotMatch(visible, /\bimproved\b|\bworsened\b|recorded definition:|as defined by the organization|One record is|the count\b|2025-04-01/i);
    assert.equal(text.meaningRecorded, false);
    assert.deepEqual(text.sourceDetails, ["Worksheet key: sheet_1", "Outcome column key: field_7", `Source version: ${VERSION}`, `Evidence item: ${EVIDENCE}`]);
  }
});

test("reading: a recorded meaning labels the result; its direction is used only as stated, never inferred", async () => {
  const unknown = L.pairedOutcomeReviewText(L.projectOrganizationFactualReview(await serverDto(HUMAN)).derivedMeasurement);
  assert.deepEqual([unknown.heading, unknown.subheading, unknown.meaningRecorded], ["Employment readiness", "Paired baseline/follow-up outcome", true]);
  assert.deepEqual(unknown.meaning, [
    `What this measures, as stated by your organization (not verified by KAI): ${HUMAN.meaning_text}`,
    "Whether a higher value is better has not been stated, so a higher follow-up value is not presented as a better result.",
    "The values are self-reported by the people recorded and were not independently verified.",
  ]);
  assert.equal(unknown.result, "Among 40 participants with comparable baseline and follow-up values, 23 (57.50%) had a higher follow-up value, 13 were unchanged and 4 had a lower follow-up value.");
  const stated = L.pairedOutcomeReviewText(L.projectOrganizationFactualReview(await serverDto({ ...HUMAN, score_direction: "higher_is_better" })).derivedMeasurement, { audience: "get_kinder" });
  assert.equal(stated.meaning[1], "The organization states that a higher value is better.");
  assert.doesNotMatch(stated.meaning.join(" "), /\bimproved\b/);
  assert.match(stated.meaning[0], /\(not verified by KAI\)/, "the stated meaning stays the organization's statement");
});

test("labels: the paired review speaks of a result, not a count; record-count wording is unchanged", () => {
  assert.equal(L.measuredClaimReviewStepLabel({ kind: "evidence", decision: "supported" }), "Evidence review: the count is supported by the source");
  assert.equal(L.measuredClaimReviewStepLabel({ kind: "evidence", decision: "supported" }, "result"), "Evidence review: the result is supported by the source");
  assert.equal(L.calculationMethodText(D.DERIVED_MEASUREMENT_METHODS.PAIRED_OUTCOME),
    "each participant's baseline value compared with the same participant's follow-up value in one worksheet; participants without a comparable pair are excluded and counted");
});

test("Get Kinder's Review finding is offered for derived measured claims as for record counts, and nothing else", () => {
  const claim = { claimId: "24000000-0000-4000-8000-000000000001", evidenceType: "source_derived_measurement" };
  assert.equal(canReviewMeasuredFinding(claim, { recordEvidenceReview: true }), true);
  assert.equal(canReviewMeasuredFinding({ ...claim, evidenceType: "source_record_count_measurement" }, { recordEvidenceReview: true }), true);
  assert.equal(canReviewMeasuredFinding({ ...claim, evidenceType: "document_statement" }, { recordEvidenceReview: true }), false);
  assert.equal(canReviewMeasuredFinding(claim, { recordEvidenceReview: false }), false);
});

// ---------------------------------------------------------------------------
// Rendered: the shared component both panels use (static render, no effects).
// ---------------------------------------------------------------------------
const repoRoot = new URL("..", import.meta.url).pathname;
async function loadComponent(relativePath) {
  const cacheRoot = join(repoRoot, "node_modules", ".cache");
  mkdirSync(cacheRoot, { recursive: true });
  const dir = mkdtempSync(join(cacheRoot, "kai-paired-review-"));
  const outfile = join(dir, "component.mjs");
  await build({
    entryPoints: [join(repoRoot, relativePath)], bundle: true, format: "esm", platform: "node", outfile, jsx: "automatic",
    loader: { ".js": "jsx", ".css": "empty" }, external: ["react", "react/*", "react-dom", "react-dom/*"], logLevel: "silent",
  });
  try { return await import(pathToFileURL(outfile).href); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const visibleText = (markup) => markup.replace(/<div[^>]*hidden=""[^>]*>[\s\S]*?<\/div><\/div>/g, "").replace(/<[^>]+>/g, "\n").replace(/&#x27;/g, "'");

test("rendered: both audiences show the breakdown and meaning state; keys and the recorded claim only behind Source details", async () => {
  const { default: FactualReviewPairedOutcome } = await loadComponent("frontend/knowledgeStudio/FactualReviewPairedOutcome.jsx");
  const review = L.projectOrganizationFactualReview(await serverDto());
  for (const audience of ["organization", "get_kinder"]) {
    const markup = renderToStaticMarkup(React.createElement(FactualReviewPairedOutcome, { review, audience }));
    assert.match(markup, /data-factual-review-meaning-state="not_recorded"/);
    const shown = visibleText(markup);
    assert.match(shown, /Among 40 participants with comparable baseline and follow-up values, 23 \(57\.50%\) had a higher follow-up value, 13 were unchanged and 4 had a lower follow-up value\./);
    assert.match(shown, /22 of 62 participants were excluded/);
    assert.match(shown, /Source details/);
    assert.doesNotMatch(shown, /\bfield_7\b|\bsheet_1\b/, `${audience}: keys are not shown until requested`);
    assert.match(markup, /hidden=""[^>]*>[\s\S]*Worksheet key: sheet_1[\s\S]*Outcome column key: field_7[\s\S]*Claim, as recorded: Numeric outcome field_7/, "provenance stays available");
  }
  const recorded = renderToStaticMarkup(React.createElement(FactualReviewPairedOutcome, { review: L.projectOrganizationFactualReview(await serverDto(HUMAN)), audience: "organization" }));
  assert.match(recorded, /data-factual-review-meaning-state="recorded"/);
  assert.match(visibleText(recorded), /^Employment readiness$/m);
});

test("both panels render the shared paired view and drop record-count wording for a derived result", () => {
  const client = readFileSync(join(repoRoot, "frontend/knowledgeStudio/ClientMeasuredClaimReviewPanel.jsx"), "utf8");
  const gk = readFileSync(join(repoRoot, "frontend/GkFindingReviewPanel.jsx"), "utf8");
  assert.match(client, /\{derived \? <FactualReviewPairedOutcome review=\{review\} audience="organization" \/> : null\}/);
  assert.match(gk, /<FactualReviewPairedOutcome review=\{review\} audience="get_kinder" \/>/);
  // The client panel's only interpretation write is the existing route, offered to the administrator only.
  assert.match(client, /review\.viewer === "organization_administrator"/);
  assert.match(client, /postJson\(derivedMeasurementInterpretationPath\(organizationId, derived\.sourceDerivedMeasurementId\), body\)/);
  assert.doesNotMatch(gk, /derivedMeasurementInterpretationPath|interpretationBody/, "Get Kinder never records the organization's meaning");
  // The record-count definition sentence is reserved for record counts.
  assert.match(client, /derived\s*\?\s*"No evidence, claim or limitation review is required for internal use: the result was calculated from the authorized source/);
});
