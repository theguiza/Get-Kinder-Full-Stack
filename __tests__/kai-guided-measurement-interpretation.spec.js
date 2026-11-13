import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as M from "../frontend/knowledgeStudio/clientDerivedMeasurementLogic.js";
import * as L from "../frontend/knowledgeStudio/clientMeasuredClaimReviewLogic.js";

/**
 * Owner prompt 2026-11-13 (guided measurement interpretation): KAI shows what
 * it established (a readable location, the structure it found, the persisted
 * breakdown), then asks three plain questions; a correction starts from the
 * current recorded interpretation in both interpretation interfaces, unknown
 * stays unknown, and opening or cancelling writes nothing. Synthetic values
 * only (the Cedar field_7 arithmetic); the connected proof is Cedar test
 * "11a (browser)" State C.
 */
const SNAKE = { interpretation_id: "x", indicator_label: "Employment readiness", meaning_text: "Synthetic: self-rated employment readiness.", score_direction: "not_established", evidence_basis: "self_reported" };
const CAMEL = { interpretationId: "x", indicatorLabel: "Employment readiness", meaningText: "Synthetic: self-rated employment readiness.", scoreDirection: "higher_is_better", evidenceBasis: "organization_record" };

test("initializer: both record shapes prefill all four values; unknown stays unknown; no interpretation is the empty form", () => {
  assert.deepEqual({ ...M.interpretationFormFrom(SNAKE) }, { indicatorLabel: "Employment readiness", meaningText: SNAKE.meaning_text, scoreDirection: "", evidenceBasis: "self_reported" });
  assert.deepEqual({ ...M.interpretationFormFrom(CAMEL) }, { indicatorLabel: "Employment readiness", meaningText: CAMEL.meaningText, scoreDirection: "higher_is_better", evidenceBasis: "organization_record" });
  assert.equal(M.interpretationFormFrom(null), M.EMPTY_INTERPRETATION_FORM);
  assert.equal(M.interpretationFormFrom(undefined), M.EMPTY_INTERPRETATION_FORM);
  // A non-paired measurement records no direction; an unrecognized value is never guessed.
  assert.deepEqual({ ...M.interpretationFormFrom({ ...SNAKE, score_direction: null, evidence_basis: "not_established" }) },
    { indicatorLabel: "Employment readiness", meaningText: SNAKE.meaning_text, scoreDirection: "", evidenceBasis: "not_established" });
  assert.deepEqual({ ...M.interpretationFormFrom({ ...SNAKE, score_direction: "improving", evidence_basis: "survey" }) },
    { indicatorLabel: "Employment readiness", meaningText: SNAKE.meaning_text, scoreDirection: "", evidenceBasis: "not_established" });
  // The label never implies a direction.
  assert.equal(M.interpretationFormFrom({ indicator_label: "Higher is better score", meaning_text: "x" }).scoreDirection, "");
});

test("initializer: an unchanged prefilled form posts exactly the recorded interpretation; changing one value keeps the other three", () => {
  const initial = M.interpretationFormFrom(SNAKE);
  assert.deepEqual(M.interpretationBody(initial, { paired: true }),
    { indicator_label: SNAKE.indicator_label, meaning_text: SNAKE.meaning_text, score_direction: "not_established", evidence_basis: "self_reported" });
  assert.equal(M.interpretationFormChanged(initial, initial, { paired: true }), false);
  const corrected = { ...initial, scoreDirection: "higher_is_better" };
  assert.equal(M.interpretationFormChanged(corrected, initial, { paired: true }), true);
  assert.deepEqual(M.interpretationBody(corrected, { paired: true }),
    { indicator_label: SNAKE.indicator_label, meaning_text: SNAKE.meaning_text, score_direction: "higher_is_better", evidence_basis: "self_reported" });
  // Whitespace-only edits are not a change; a cleared label is not submittable.
  assert.equal(M.interpretationFormChanged({ ...initial, meaningText: `${initial.meaningText}  ` }, initial, { paired: true }), false);
  assert.equal(M.interpretationFormChanged({ ...initial, indicatorLabel: " " }, initial, { paired: true }), false);
  // A first statement (nothing recorded) is a change once label and meaning are given.
  assert.equal(M.interpretationFormChanged({ ...M.EMPTY_INTERPRETATION_FORM, indicatorLabel: "A", meaningText: "B" }, M.EMPTY_INTERPRETATION_FORM, { paired: true }), true);
});

const DERIVED = {
  measurementType: "paired_outcome_change", sourceDerivedMeasurementId: "m", evidenceItemId: "e", sourceVersionId: "v", isCurrent: true,
  worksheetKey: "sheet_1", worksheetName: "Participant assessments", outcomeFieldKey: "field_7", outcomeColumn: "G",
  calculationMethod: "p1_xlsx_paired_baseline_followup_numeric_change_v1", numerator: 23, denominator: 40, percentage: "57.50",
  increasedCount: 23, unchangedCount: 13, decreasedCount: 4, participantCount: 62, comparablePairCount: 40, excludedParticipantCount: 22,
  exclusions: { participants: [
    { reason: "no_baseline_observation", participantCount: 5 }, { reason: "no_followup_observation", participantCount: 7 },
    { reason: "instrument_version_mismatch", participantCount: 8 }, { reason: "missing_baseline_value", participantCount: 2 },
  ], rows: [] },
  interpretation: null, scoreDirection: "not_established", reportingPeriod: null,
};

test("reading: a readable location first, the structure KAI found, and numerical change kept apart from a favourable outcome", () => {
  const text = L.pairedOutcomeReviewText(DERIVED);
  assert.equal(text.location, 'Where KAI read the values: column G of the worksheet "Participant assessments".');
  assert.match(text.structure, /numeric score recorded for the same participants at baseline and at follow-up\. The layout does not establish what the score means\./);
  assert.equal(text.distinction, "A higher follow-up value means the recorded number increased. On its own that is a numerical change, not evidence of a favourable outcome or of what caused it.");
  assert.deepEqual(text.known, [text.location, text.structure, text.result, text.population]);
  assert.match(text.population, /5 with no baseline observation; 7 with no follow-up observation; 8 whose baseline and follow-up used different instrument versions; 2 with a missing baseline value/);
  assert.match(text.period, /No reporting period was applied/);
  const visible = [text.location, text.structure, text.distinction, ...text.known, ...text.meaning].join("\n");
  assert.doesNotMatch(visible, /\bfield_\d+\b|\bsheet_\d+\b|Employment readiness|\bimproved\b|2025-04-01/, "no keys, no invented meaning, no period");
  // Without a screened worksheet name the column is still located; with nothing, no location is invented.
  assert.equal(L.pairedOutcomeReviewText({ ...DERIVED, worksheetName: null }).location, "Where KAI read the values: column G of the selected worksheet.");
  assert.equal(L.pairedOutcomeReviewText({ ...DERIVED, worksheetName: null, outcomeColumn: null }).location, null);
  // The projection keeps only a safe column letter and a non-blank worksheet name.
  const projected = L.projectOrganizationFactualReview({ derived_measurement: { measurement_type: "paired_outcome_change", worksheet_name: " ", outcome_column: "field_7" } }).derivedMeasurement;
  assert.deepEqual([projected.worksheetName, projected.outcomeColumn], [null, null]);
});

test("Count records known lines: the column, the structure and the breakdown, never a meaning", () => {
  const recorded = {
    measurement_family: "paired_outcome_change", definition: { outcome_field_key: "field_7", outcome_column: "G" },
    component_counts: { participant_count: 62, comparable_pair_count: 40, increased_count: 23, unchanged_count: 13, decreased_count: 4, excluded_participant_count: 22 },
  };
  const lines = M.recordedMeasurementKnownLines(recorded);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Column G holds a numeric score recorded for the same participants at baseline and at follow-up\./);
  assert.equal(lines[1], "Among 40 participants with comparable baseline and follow-up values, 23 had a higher follow-up value, 13 were unchanged and 4 had a lower follow-up value.");
  assert.equal(lines[2], "22 of 62 participants had no comparable pair and were excluded.");
  assert.doesNotMatch(lines.join(" "), /field_7|Employment|better|improv/);
  assert.match(M.recordedMeasurementKnownLines({ measurement_family: "tabular_count", measured_value: 80 })[0], /^Recorded result: 80\./);
  assert.deepEqual(M.recordedMeasurementKnownLines(null), []);
});

// ---------------------------------------------------------------------------
// Rendered (static, no effects): the shared guided form.
// ---------------------------------------------------------------------------
const repoRoot = new URL("..", import.meta.url).pathname;
async function loadComponent(relativePath) {
  const cacheRoot = join(repoRoot, "node_modules", ".cache");
  mkdirSync(cacheRoot, { recursive: true });
  const dir = mkdtempSync(join(cacheRoot, "kai-guided-meaning-"));
  const outfile = join(dir, "component.mjs");
  await build({
    entryPoints: [join(repoRoot, relativePath)], bundle: true, format: "esm", platform: "node", outfile, jsx: "automatic",
    loader: { ".js": "jsx", ".css": "empty" }, external: ["react", "react/*", "react-dom", "react-dom/*"], logLevel: "silent",
  });
  try { return await import(pathToFileURL(outfile).href); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const decode = (s) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

test("rendered: what KAI established, three plain questions, neutral when nothing is recorded, Cancel offered", async () => {
  const { default: MeaningQuestionsForm } = await loadComponent("frontend/knowledgeStudio/MeaningQuestionsForm.jsx");
  const known = L.pairedOutcomeReviewText(DERIVED).known;
  const markup = decode(renderToStaticMarkup(React.createElement(MeaningQuestionsForm, {
    attr: "data-client-measured-claim-clarify", form: M.EMPTY_INTERPRETATION_FORM, setForm: () => {}, initial: M.EMPTY_INTERPRETATION_FORM,
    paired: true, known, onSubmit: () => {}, onCancel: () => {},
  })));
  assert.match(markup, /data-client-measured-claim-clarify-form=""/);
  assert.match(markup, /What KAI already established/);
  assert.ok(markup.includes('column G of the worksheet "Participant assessments"'));
  assert.match(markup, /1\. What does this measured value represent\?/);
  assert.match(markup, /2\. Is a higher or a lower score the more favourable result\?/);
  assert.match(markup, /3\. What is the source or basis of these recorded values\?/);
  assert.match(markup, /KAI cannot tell from the file what these values mean/);
  for (const field of ["indicatorLabel", "meaningText", "scoreDirection", "evidenceBasis"]) assert.match(markup, new RegExp(`data-client-measured-claim-clarify-field="${field}"`));
  assert.match(markup, /data-client-measured-claim-clarify-cancel=""/);
  // Nothing is suggested: empty inputs, direction open, basis not stated, and no meaning KAI did not receive.
  assert.match(markup, /data-client-measured-claim-clarify-field="indicatorLabel" value=""/);
  assert.match(markup, /data-client-measured-claim-clarify-field="meaningText" value=""/);
  assert.match(markup, /<option value="" selected="">Not established: leave the direction open<\/option>/);
  assert.match(markup, /<option value="not_established" selected="">Not stated<\/option>/);
  assert.doesNotMatch(markup, /Employment readiness|data-meaning-prefilled/);
  assert.match(markup, /<button type="submit"[^>]*disabled=""[^>]*>Record meaning<\/button>/, "nothing to submit until a label and meaning are given");
});

test("rendered: a correction opens prefilled with all four current values; unchanged cannot be submitted; non-paired asks two questions", async () => {
  const { default: MeaningQuestionsForm } = await loadComponent("frontend/knowledgeStudio/MeaningQuestionsForm.jsx");
  const initial = M.interpretationFormFrom({ ...SNAKE, score_direction: "higher_is_better" });
  const render = (form, paired = true) => decode(renderToStaticMarkup(React.createElement(MeaningQuestionsForm, {
    attr: "data-client-derived-clarify", form, setForm: () => {}, initial, paired, onSubmit: () => {}, onCancel: () => {},
  })));
  const unchanged = render(initial);
  assert.ok(unchanged.includes('value="Employment readiness"'), "label prefilled");
  assert.ok(unchanged.includes(`value="${SNAKE.meaning_text}"`), "meaning prefilled");
  assert.match(unchanged, /<option value="higher_is_better" selected="">/, "direction preserved");
  assert.match(unchanged, /<option value="self_reported" selected="">/, "basis preserved");
  assert.match(unchanged, /data-meaning-prefilled=""/);
  assert.match(unchanged, /Nothing has been changed yet\./);
  assert.match(unchanged, /<button type="submit"[^>]*disabled=""[^>]*>Record the correction<\/button>/);
  const changed = render({ ...initial, evidenceBasis: "organization_record" });
  assert.match(changed, /<option value="organization_record" selected="">/);
  assert.ok(changed.includes('value="Employment readiness"') && /<option value="higher_is_better" selected="">/.test(changed), "the other values stay as recorded");
  assert.doesNotMatch(changed, /<button type="submit"[^>]*disabled=""/);
  const tabular = render(initial, false);
  assert.doesNotMatch(tabular, /data-client-derived-clarify-field="scoreDirection"|favourable result/);
  assert.match(tabular, /2\. What is the source or basis of these recorded values\?/);
});

test("both interpretation interfaces open and cancel from the current recorded interpretation and post only on submit", () => {
  const client = readFileSync(join(repoRoot, "frontend/knowledgeStudio/ClientMeasuredClaimReviewPanel.jsx"), "utf8");
  const section = readFileSync(join(repoRoot, "frontend/knowledgeStudio/ClientDerivedMeasurementSection.jsx"), "utf8");
  assert.match(client, /const recordedForm = interpretationFormFrom\(derived\?\.interpretation\);/);
  assert.match(client, /onClick=\{\(\) => \{ setClarifying\(\(value\) => !value\); setClarifyForm\(recordedForm\); \}\}/);
  assert.match(client, /const closeMeaning = \(\) => \{ setClarifying\(false\); setClarifyForm\(recordedForm\); \};/);
  assert.match(client, /<MeaningQuestionsForm attr="data-client-measured-claim-clarify"[\s\S]*initial=\{recordedForm\}[\s\S]*onSubmit=\{recordMeaning\} onCancel=\{closeMeaning\}/);
  assert.match(section, /setClarifyForm\(interpretationFormFrom\(current\?\.interpretation\)\); \}\}>\s*\{current\?\.interpretation \? "Change meaning" : "Clarify meaning"\}/);
  assert.match(section, /<MeaningQuestionsForm attr="data-client-derived-clarify"[\s\S]*initial=\{interpretationFormFrom\(current\?\.interpretation\)\}/);
  assert.match(section, /onCancel=\{\(\) => \{ setClarifying\(null\); setClarifyForm\(interpretationFormFrom\(current\?\.interpretation\)\); \}\}/);
  // The only interpretation write in each is the existing route, on submit.
  assert.equal((client.match(/derivedMeasurementInterpretationPath\(/g) || []).length, 1);
  assert.equal((section.match(/derivedMeasurementInterpretationPath\(/g) || []).length, 1);
  assert.doesNotMatch(client + section, /EMPTY_INTERPRETATION_FORM\); \}\}>/, "no form reopens blank");
});
