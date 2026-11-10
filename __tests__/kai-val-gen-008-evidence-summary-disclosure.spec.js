import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import * as generatedContentValidators from "../Backend/kai/validators/kaiGeneratedContentValidators.js";
import {
  applyMeasurementCoverageDimensions,
  composeMeasurementClaimStatement,
  describeMeasurementLimitationCode,
  measurementLimitationCodes,
} from "../Backend/kai/validators/kaiSourceMeasurementValidators.js";
import {
  createPostgresGeneratedContentRepository,
  __generatedContentRepositoryTestables,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";

const { validateGeneratedContentDraft, composeCountOnlyFindingText, countOnlyBlockMatchesMeasurement, COUNT_ONLY_LIMITATION_CODE } = generatedContentValidators;
const { GENERATOR_RESULT_CONTRACT_VALIDATOR_KEY } = __generatedContentRepositoryTestables;

// Synthetic only: an ordinary measured claim shaped like the reported
// Assessments/sheet_1 count (112 records, human-defined meaning, no period,
// no blanks or duplicates, three source-level coverage concerns), and a second
// measured claim with an attested period and positive blank/duplicate counts.
// Nothing here is the production request, its text, or client data.
const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000501";
const SOURCE = "00000000-0000-4000-8000-000000000301";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000401";
const NOW = "2026-11-01T10:00:00.000Z";
const METHOD = "p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1";
const SOURCE_DIMENSIONS = Object.freeze({
  conflicting_source_indicators: { assessment_status: "unresolved" },
  requirement_alignment: { assessment_status: "unresolved" },
  small_cell_risk: { assessment_status: "resolved_risk_flagged" },
});

function measuredFixture({ n, value, periodStart = null, periodEnd = null, blank = 0, duplicate = 0, sourceDimensions = SOURCE_DIMENSIONS }) {
  const claimId = `00000000-0000-4000-8000-00000000010${n}`;
  const evidenceItemId = `00000000-0000-4000-8000-00000000020${n}`;
  const measurementRow = {
    evidence_item_id: evidenceItemId, organization_id: ORG, source_version_id: SOURCE_VERSION,
    measurement_type: "source_record_count", measured_value: value, calculation_method: METHOD,
    blank_record_count: blank, duplicate_record_count: duplicate, worksheet_key: "sheet_1",
    definition_status: "human_confirmed", period_start: periodStart, period_end: periodEnd,
    profile_field_missing_counts: [blank, blank, blank],
  };
  // P2-06 traceability exposes each dimension with a flat assessment_status.
  const dimensions = Object.fromEntries(Object.entries(applyMeasurementCoverageDimensions(sourceDimensions, measurementRow)).map(([key, value]) => [
    key, { ...value, assessment_status: value.assessment_status ?? value.evidence?.assessment_status },
  ]));
  const claimStatement = composeMeasurementClaimStatement({
    measurementRow,
    definitionRow: { period_start: periodStart, period_end: periodEnd, unit_label: "Participant assessment records", counted_unit: "Participant assessment record" },
    locatorCoordinates: { sheet_key: "sheet_1" },
  });
  const limitationCodes = measurementLimitationCodes({ measurementRow, dimensions });
  return {
    claimId, evidenceItemId, measurementRow, dimensions, limitationCodes,
    claim: {
      claimId, evidenceItemId, sourceId: SOURCE, sourceVersionId: SOURCE_VERSION, claimType: "finding", claimStatement,
      requestedAudience: "internal", revalidatedForGeneration: true, currentEligible: true,
      audienceAuthority: { internal: true, funder: false, public: false }, limitationCodes,
    },
  };
}

const M112 = measuredFixture({ n: 1, value: 112 });
const M37 = measuredFixture({ n: 2, value: 37, periodStart: "2025-04-01", periodEnd: "2026-03-31", blank: 2, duplicate: 3 });
const M37_NO_PERIOD = measuredFixture({ n: 3, value: 37 });
const FIELD = {
  claimId: "00000000-0000-4000-8000-000000000104",
  evidenceItemId: "00000000-0000-4000-8000-000000000204",
  claim: {
    claimId: "00000000-0000-4000-8000-000000000104", evidenceItemId: "00000000-0000-4000-8000-000000000204",
    sourceId: SOURCE, sourceVersionId: SOURCE_VERSION, claimType: "finding",
    claimStatement: "The source contains an assessment date field.", requestedAudience: "internal", revalidatedForGeneration: true,
    currentEligible: true, audienceAuthority: { internal: true, funder: false, public: false }, limitationCodes: [],
  },
};

const cite = (...fixtures) => fixtures.map(({ claimId, evidenceItemId }) => ({ claimId, evidenceItemId }));
const block = (text, ...fixtures) => ({ ordinal: 1, text, citations: cite(...fixtures) });
const validate = (blocks, fixtures, contentType = "evidence_summary") => validateGeneratedContentDraft({
  contentType, requestedAudience: "internal", generationClaims: fixtures.map((fixture) => fixture.claim), blocks,
});
const measuredValues = (...fixtures) => new Map(fixtures.map((fixture) => [fixture.claimId, fixture.measurementRow.measured_value]));
// Resolved at call time, so this suite also records the pre-repair baseline.
const compose = (blocks, fixtures) => generatedContentValidators.composeEvidenceSummaryMeasurementDisclosures({
  blocks, claims: fixtures.map((fixture) => fixture.claim), measuredValueByClaimId: measuredValues(...fixtures.filter((fixture) => fixture.measurementRow)),
});
const blockerClasses = (validation) => validation.blockers.map((blocker) => [blocker.validator_key, ...(blocker.evidence.violation_classes || blocker.evidence.assertion_classes || [])]);

// Owner Package 1: a record count asserts source records; the organization's
// label is attributed and authorizes no counted entity.
const LEAD_112 = "The promoted source has 112 source records in selected worksheet sheet_1.";
const LEAD_37 = "The promoted source has 37 source records in selected worksheet sheet_1.";
// Truthful model prose that never uses the validator's exact tokens.
const PARAPHRASE_112 = `${LEAD_112} The organization decided what one row stands for, and KAI did not check that meaning. The count is not restricted to any dates.`;
const COMPLETE_112 = `${LEAD_112} This is a count of source records under a human-defined record meaning. No reporting period is defined.`;
const NAMED_COVERAGE = " Conflicting sources and funder requirements alignment are unresolved, small-cell risk is flagged, and the reporting period is not defined.";
const COMPLETE_37 = `${LEAD_37} This is a count of source records under a human-defined record meaning. The reporting period 2025-04-01 to 2026-03-31 is attested in the definition. Blank records were excluded and exact-duplicate records were included.${NAMED_COVERAGE}`;

test("baseline fixture: the ordinary 112-record claim carries every applicable measurement and named coverage code", () => {
  assert.deepEqual(M112.limitationCodes, [
    "coverage.conflicting_source_indicators.unresolved",
    "coverage.requirement_alignment.unresolved",
    "coverage.small_cell_risk.resolved_risk_flagged",
    "coverage.time_period_clarity.resolved_risk_flagged",
    "measurement.no_reporting_period",
    "measurement.record_meaning_human_defined",
  ]);
  assert.match(M112.claim.claimStatement, /^The promoted source has 112 source records in selected worksheet sheet_1 \(record count: one record per selected worksheet data row; .*Not applied by KAI: the organization's description of each record as one Participant assessment record and its inclusion and exclusion rules; no reporting period was defined\.$/);
  assert.ok(M37.limitationCodes.includes("measurement.period_human_attested_not_row_verified"));
  assert.ok(M37.limitationCodes.includes("measurement.blank_records_excluded"));
  assert.ok(M37.limitationCodes.includes("measurement.duplicate_records_included"));
});

test("VAL-GEN-008 (Evidence Summary): truthful negations are not affirmative contradictions; affirmative ones still are", () => {
  const notIndependentlyVerified = validate([block(`${COMPLETE_37} The reporting period was not independently verified.`, M37)], [M37]);
  assert.equal(notIndependentlyVerified.ok, true, JSON.stringify(notIndependentlyVerified.blockers));
  const notUnique = validate([block(`${COMPLETE_37} The counted records are not unique.`, M37)], [M37]);
  assert.equal(notUnique.ok, true, JSON.stringify(notUnique.blockers));

  for (const contradiction of [
    " The reporting period was verified against record dates.",
    " The reporting period was not independently verified. The reporting period was verified.",
    " The period was not only verified but complete.",
    " These are 37 distinct assessments.",
    " The records were deduplicated.",
  ]) {
    assert.deepEqual(blockerClasses(validate([block(`${COMPLETE_37}${contradiction}`, M37)], [M37])), [["VAL-GEN-008", "limitation_contradicted"]], contradiction);
  }
});

test("VAL-GEN-008 (Evidence Summary): a measured count is never stated as unique or distinct, even with zero duplicates", () => {
  const unique = validate([block(`${COMPLETE_112}${NAMED_COVERAGE} These are 112 unique participants.`, M112)], [M112]);
  assert.deepEqual(blockerClasses(unique), [["VAL-GEN-008", "limitation_contradicted"]]);
  const negated = validate([block(`${COMPLETE_112}${NAMED_COVERAGE} The records are not necessarily unique participants.`, M112)], [M112]);
  assert.equal(negated.ok, true, JSON.stringify(negated.blockers));
});

test("VAL-GEN-008 (Evidence Summary): named coverage concerns satisfy coverage disclosure; generic 'Limitations apply' does not", () => {
  const named = validate([block(`${COMPLETE_112}${NAMED_COVERAGE}`, M112)], [M112]);
  assert.equal(named.ok, true, JSON.stringify(named.blockers));
  const generic = validate([block(`${COMPLETE_112} Limitations apply.`, M112)], [M112]);
  assert.deepEqual(blockerClasses(generic), [["VAL-GEN-008", "limitation_not_disclosed"]]);
  const oneMissing = validate([block(`${COMPLETE_112} Conflicting sources and funder requirements alignment are unresolved; the reporting period is not defined.`, M112)], [M112]);
  assert.deepEqual(blockerClasses(oneMissing), [["VAL-GEN-008", "limitation_not_disclosed"]], "small-cell risk is not named");
});

test("VAL-GEN-008 still rejects omitted material disclosures in model text alone", () => {
  for (const text of [LEAD_112, PARAPHRASE_112, `${LEAD_112}${NAMED_COVERAGE}`]) {
    assert.deepEqual(blockerClasses(validate([block(text, M112)], [M112])), [["VAL-GEN-008", "limitation_not_disclosed"]], text);
  }
});

test("outside Evidence Summary the existing VAL-GEN-008 rules are unchanged", () => {
  // Owner scope: the narrowed negation and named-coverage rules apply to
  // Evidence Summary only; other generators keep the prior lexical rules.
  assert.equal(validate([block(`${COMPLETE_112} Limitations apply.`, M112)], [M112], "impact_narrative").ok, true);
  const notUnique = `${COMPLETE_37} These limitations apply. The counted records are not unique.`;
  assert.deepEqual(blockerClasses(validate([block(notUnique, M37)], [M37], "impact_narrative")), [["VAL-GEN-008", "limitation_contradicted"]]);
  assert.deepEqual(blockerClasses(validate([block(notUnique, M37)], [M37], null)), [["VAL-GEN-008", "limitation_contradicted"]]);
});

test("composition: the ordinary 112-record paraphrase gains an authoritative disclosure and passes every validator", () => {
  const composed = compose([block(PARAPHRASE_112, M112)], [M112]);
  assert.equal(composed.ok, true);
  const [result] = composed.blocks;
  assert.ok(result.text.startsWith(`${PARAPHRASE_112} `), "the model text is kept verbatim, never rewritten");
  assert.deepEqual(result.citations, cite(M112));
  assert.equal(result.ordinal, 1);
  assert.match(result.text, /count of source records/);
  assert.match(result.text, /count of source records only, and one record is not necessarily one separate person, event or result/);
  assert.match(result.text, /human-defined by the organization and was not verified by KAI/);
  assert.match(result.text, /No reporting period was defined for the count\./);
  assert.doesNotMatch(result.text, /attested|Blank records|duplicate/i, "only the applicable disclosures");
  for (const code of M112.limitationCodes.filter((code) => code.startsWith("coverage."))) {
    assert.ok(result.text.includes(describeMeasurementLimitationCode(code)), code);
  }
  assert.match(result.text, /Conflicting sources: not yet resolved\./);
  assert.match(result.text, /Alignment with funder requirements: not yet resolved\./);
  assert.match(result.text, /Small-number \(small-cell\) risk: a known limitation of this source, recorded and not removed\./);
  const validation = validate(composed.blocks, [M112]);
  assert.equal(validation.ok, true, JSON.stringify(validation.blockers));
  assert.deepEqual(validation.results.map((item) => item.validator_key), ["VAL-GEN-001", "VAL-GEN-002", "VAL-GEN-003", "VAL-GEN-004", "VAL-GEN-008", "VAL-GEN-005"]);
});

test("composition: attested period, excluded blanks and included duplicates are disclosed; accepted limitations stay limitations", () => {
  const accepted = measuredFixture({
    n: 2, value: 37, periodStart: "2025-04-01", periodEnd: "2026-03-31", blank: 2, duplicate: 3,
    sourceDimensions: { ...SOURCE_DIMENSIONS, small_cell_risk: { assessment_status: "unresolved", internal_limitation_accepted: true } },
  });
  const composed = compose([block(LEAD_37, accepted)], [accepted]);
  assert.equal(composed.ok, true);
  const { text } = composed.blocks[0];
  assert.match(text, /The reporting period is attested in the record definition and was not verified against dates in the records\./);
  // The released-Markdown proof's own guard: "verified" appears only as "not verified".
  assert.doesNotMatch(text.replace(/not verified/g, ""), /\bverified\b/i);
  assert.match(text, /Blank records were excluded from the count\./);
  assert.match(text, /Exact-duplicate records are included in the count; they were not removed or merged\./);
  assert.match(text, /Small-number \(small-cell\) risk: not resolved; accepted as a limitation for internal use only\./);
  assert.match(text, /Duplicate records: a known limitation of this source, recorded and not removed\./);
  assert.doesNotMatch(text, /No reporting period/);
  assert.equal(validate(composed.blocks, [accepted]).ok, true, JSON.stringify(validate(composed.blocks, [accepted]).blockers));
});

test("composition never hides a model contradiction or unsupported assertion", () => {
  for (const [fixture, lead, extra, expected] of [
    [M37, LEAD_37, " The period was verified against record dates.", [["VAL-GEN-008", "limitation_contradicted"]]],
    [M37, LEAD_37, " These are 37 distinct assessments.", [["VAL-GEN-008", "limitation_contradicted"]]],
    [M112, LEAD_112, " These are 112 unique participants.", [["VAL-GEN-008", "limitation_contradicted"]]],
    [M112, LEAD_112, " That is 45% of enrolled participants.", [["VAL-GEN-004", "numeric_literal"]]],
    [M112, LEAD_112, " The programme improves wellbeing.", [["VAL-GEN-004", "causal_language"]]],
  ]) {
    const composed = compose([block(`${lead}${extra}`, fixture)], [fixture]);
    assert.equal(composed.ok, true);
    assert.ok(composed.blocks[0].text.includes(extra.trim()), "the contradiction is kept, not rewritten");
    assert.deepEqual(blockerClasses(validate(composed.blocks, [fixture])), expected, extra);
  }
  // An unauthorized citation is not given a disclosure and is still refused.
  const unauthorized = compose([{ ordinal: 1, text: LEAD_112, citations: [{ claimId: M112.claimId, evidenceItemId: M37.evidenceItemId }] }], [M112]);
  assert.equal(unauthorized.ok, true);
  assert.deepEqual(validate(unauthorized.blocks, [M112]).blockers.map((blocker) => blocker.validator_key), ["VAL-GEN-002", "VAL-GEN-003", "VAL-GEN-008"]);
});

test("composition attributes disclosures per cited measured claim in mixed-citation blocks", () => {
  const mixedField = compose([block(`${LEAD_112} ${FIELD.claim.claimStatement}`, M112, FIELD)], [M112, FIELD]);
  assert.equal(mixedField.ok, true);
  assert.match(mixedField.blocks[0].text, /Measurement disclosure for the cited count: /);
  assert.deepEqual(mixedField.blocks[0].citations, cite(M112, FIELD));
  assert.equal(validate(mixedField.blocks, [M112, FIELD]).ok, true);

  const sameDisclosure = compose([block(`${LEAD_112} ${LEAD_37}`, M112, M37_NO_PERIOD)], [M112, M37_NO_PERIOD]);
  assert.equal(sameDisclosure.ok, true);
  assert.equal(sameDisclosure.blocks[0].text.match(/Measurement disclosure/g).length, 1);
  assert.match(sameDisclosure.blocks[0].text, /Measurement disclosure for each cited count: /);
  assert.equal(validate(sameDisclosure.blocks, [M112, M37_NO_PERIOD]).ok, true);

  const differing = compose([block(`${LEAD_112} ${LEAD_37}`, M112, M37)], [M112, M37]);
  assert.equal(differing.ok, true);
  const { text } = differing.blocks[0];
  const for112 = text.slice(text.indexOf("Measurement disclosure for the cited count of 112: "), text.indexOf("Measurement disclosure for the cited count of 37: "));
  const for37 = text.slice(text.indexOf("Measurement disclosure for the cited count of 37: "));
  assert.match(for112, /No reporting period was defined/);
  assert.doesNotMatch(for112, /attested|Blank records|Exact-duplicate/);
  assert.match(for37, /attested in the record definition/);
  assert.match(for37, /Blank records were excluded/);
  assert.match(for37, /Exact-duplicate records are included/);
  assert.doesNotMatch(for37, /No reporting period/);
  assert.deepEqual(differing.blocks[0].citations, cite(M112, M37));
  assert.equal(validate(differing.blocks, [M112, M37]).ok, true, JSON.stringify(validate(differing.blocks, [M112, M37]).blockers));
});

test("composition fails closed when a disclosure cannot be composed or attributed", () => {
  const sameValue = measuredFixture({ n: 5, value: 112, periodStart: "2025-04-01", periodEnd: "2026-03-31" });
  assert.equal(compose([block(LEAD_112, M112, sameValue)], [M112, sameValue]).ok, false, "two different disclosures for counts of the same value");
  const unknownCode = { ...M112, claim: { ...M112.claim, limitationCodes: [...M112.limitationCodes, "coverage.unknown_dimension.unresolved"] } };
  assert.equal(compose([block(LEAD_112, unknownCode)], [unknownCode]).ok, false, "an undescribable coverage code");
  const noPeriodCode = { ...M112, claim: { ...M112.claim, limitationCodes: M112.limitationCodes.filter((code) => code !== "measurement.no_reporting_period") } };
  assert.equal(compose([block(LEAD_112, noPeriodCode)], [noPeriodCode]).ok, false, "the period state is required");
  const noMeaningCode = { ...M112, claim: { ...M112.claim, limitationCodes: M112.limitationCodes.filter((code) => code !== "measurement.record_meaning_human_defined") } };
  assert.equal(compose([block(LEAD_112, noMeaningCode)], [noMeaningCode]).ok, false, "the record meaning is required");
  const absentValue = generatedContentValidators.composeEvidenceSummaryMeasurementDisclosures({
    blocks: [block(LEAD_112, M112, M37)], claims: [M112.claim, M37.claim], measuredValueByClaimId: new Map(),
  });
  assert.equal(absentValue.ok, false, "per-claim attribution requires the measured value");
});

test("composition is deterministic and idempotent, and adds no numbers or released-prose overclaim words of its own", () => {
  const once = compose([block(PARAPHRASE_112, M112), { ...block(COMPLETE_37, M37), ordinal: 2 }], [M112, M37]);
  const twice = compose(once.blocks, [M112, M37]);
  assert.deepEqual(twice, once);
  assert.deepEqual(compose([block(PARAPHRASE_112, M112), { ...block(COMPLETE_37, M37), ordinal: 2 }], [M112, M37]), once);
  for (const [composedBlock, modelText] of [[once.blocks[0], PARAPHRASE_112], [once.blocks[1], COMPLETE_37]]) {
    const added = composedBlock.text.slice(modelText.length);
    assert.doesNotMatch(added, /\d/);
    // The vocabulary the P2-01M released-Markdown proof forbids in prose.
    assert.doesNotMatch(added, /\b(distinct|unique|individuals?|people|participants?|attendees|households?|rate|per cent|percent|outcomes?|because|caused?|improv\w*|impact\w*|increase\w*|led to|result\w* in)\b|%/i);
  }
  const unmeasured = compose([block(FIELD.claim.claimStatement, FIELD)], [FIELD]);
  assert.deepEqual(unmeasured.blocks, [block(FIELD.claim.claimStatement, FIELD)], "a block citing no measured claim is unchanged");
});

test("composition applies the same material disclosures to a historical count-only block", () => {
  const countOnlyCodes = [...M112.limitationCodes, COUNT_ONLY_LIMITATION_CODE].sort();
  const countOnly = { ...M112, claim: { ...M112.claim, limitationCodes: countOnlyCodes } };
  const text = composeCountOnlyFindingText(M112.measurementRow);
  const composed = compose([block(text, countOnly)], [countOnly]);
  assert.equal(composed.ok, true);
  assert.ok(composed.blocks[0].text.startsWith(text));
  assert.match(composed.blocks[0].text, /Measurement disclosure for the cited count/);
  const validation = validate(composed.blocks, [countOnly]);
  assert.equal(validation.ok, true, JSON.stringify(validation.blockers));
  assert.ok(!validation.results.some((item) => item.validator_key === "VAL-GEN-010"));
});

// --- Real repository orchestration (createGeneratedContentDraft) on a fake
// transaction, the dispatch-by-SQL convention of the P14-09 diagnostic suite,
// with an injected deterministic draftGenerator: no provider, no database. ---

function claimRow(fixture, overrides = {}) {
  return {
    claim_id: fixture.claimId, claim_statement: fixture.claim.claimStatement, claim_type: "finding",
    evidence_item_id: fixture.evidenceItemId, internal_only: true, funder_use_allowed: false, public_use_allowed: false,
    source_id: SOURCE, source_version_id: SOURCE_VERSION,
    evidence_type: fixture.measurementRow ? "source_record_count_measurement" : "field_presence",
    intake_file_id: "00000000-0000-4000-8000-000000000901", upload_state: "confirmed", ...overrides,
  };
}

function makeState(fixtures, rowOverrides = {}) {
  return {
    fixtures, runs: [], drafts: [], blocks: [], citations: [], queues: [], audits: [], statements: [], measurementReads: 0,
    claims: fixtures.map((fixture) => claimRow(fixture, rowOverrides)),
  };
}

function makeFakeTx(state) {
  return {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      state.statements.push(s);
      if (s.startsWith("INSERT INTO kai.generation_runs")) {
        const [organizationId, engagementId, idempotencyKey, requestFingerprint, contentType, requestedAudience, now] = params;
        if (state.runs.some((run) => run.organization_id === organizationId && run.idempotency_key === idempotencyKey)) return { rows: [] };
        const run = { generation_run_id: randomUUID(), organization_id: organizationId, engagement_id: engagementId, idempotency_key: idempotencyKey,
          request_fingerprint: requestFingerprint, content_type: contentType, requested_audience: requestedAudience, created_by_type: "system", created_at: now };
        state.runs.push(run);
        return { rows: [{ generation_run_id: run.generation_run_id }] };
      }
      if (s.startsWith("SELECT generation_run_id::text AS generation_run_id")) {
        return { rows: state.runs.filter((run) => run.organization_id === params[0] && run.idempotency_key === params[1]) };
      }
      if (s.startsWith("SELECT generated_content_draft_id::text AS generated_content_draft_id, generation_run_id")) {
        return { rows: state.drafts.filter((draft) => draft.organization_id === params[0] && draft.generation_run_id === params[1]) };
      }
      if (s.startsWith("INSERT INTO kai.generated_content_drafts")) {
        const [generationRunId, organizationId, contentType, requestedAudience, draftStatus, reviewStatus, validatorResults, now] = params;
        const draft = { generated_content_draft_id: randomUUID(), generation_run_id: generationRunId, organization_id: organizationId, content_type: contentType,
          requested_audience: requestedAudience, draft_status: draftStatus, review_status: reviewStatus, validator_results: JSON.parse(validatorResults), created_by_type: "system", created_at: now };
        state.drafts.push(draft);
        return { rows: [{ generated_content_draft_id: draft.generated_content_draft_id }] };
      }
      if (s.startsWith("SELECT generated_content_block_id::text AS generated_content_block_id")) {
        return { rows: state.blocks.filter((row) => row.organization_id === params[0] && row.generated_content_draft_id === params[1]).sort((a, b) => a.ordinal - b.ordinal) };
      }
      if (s.startsWith("INSERT INTO kai.generated_content_blocks")) {
        const [draftId, organizationId, ordinal, text, now] = params;
        const row = { generated_content_block_id: randomUUID(), generated_content_draft_id: draftId, organization_id: organizationId, ordinal, text, created_at: now };
        state.blocks.push(row);
        return { rows: [{ generated_content_block_id: row.generated_content_block_id }] };
      }
      if (s.startsWith("SELECT c.generated_content_citation_id::text AS generated_content_citation_id")) {
        const blockIds = new Set(state.blocks.filter((row) => row.generated_content_draft_id === params[1]).map((row) => row.generated_content_block_id));
        return { rows: state.citations.filter((row) => row.organization_id === params[0] && blockIds.has(row.generated_content_block_id)) };
      }
      if (s.startsWith("INSERT INTO kai.generated_content_citations")) {
        const [blockId, organizationId, claimId, evidenceItemId, now] = params;
        state.citations.push({ generated_content_citation_id: randomUUID(), generated_content_block_id: blockId, organization_id: organizationId, claim_id: claimId, evidence_item_id: evidenceItemId, created_at: now });
        return { rows: [] };
      }
      // Both the allowed-use lineage read and the generation projection.
      if (s.startsWith("SELECT c.claim_id::text AS claim_id")) {
        return { rows: state.claims.filter((row) => params[1].includes(row.claim_id)).sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1)) };
      }
      if (s.startsWith("SELECT m.evidence_item_id::text AS evidence_item_id")) {
        state.measurementReads += 1;
        return { rows: state.fixtures.filter((fixture) => fixture.measurementRow && params.flat().includes(fixture.evidenceItemId)).map((fixture) => fixture.measurementRow) };
      }
      if (s.startsWith("SELECT review_queue_item_id::text AS review_queue_item_id") && s.includes("queue_type = $2") && !s.includes("updated_at")) {
        const [organizationId, queueType, targetObjectType, targetObjectId] = params;
        return { rows: state.queues.filter((row) => row.organization_id === organizationId && row.queue_type === queueType && row.target_object_type === targetObjectType && row.target_object_id === targetObjectId) };
      }
      if (s.startsWith("INSERT INTO kai.review_queue_items")) {
        const [organizationId, queueType, targetObjectType, targetObjectId, reviewStatus, summary, requiredAction, now] = params;
        const row = { review_queue_item_id: randomUUID(), organization_id: organizationId, engagement_id: null, queue_type: queueType, target_object_type: targetObjectType,
          target_object_id: targetObjectId, priority: "medium", queue_status: "open", review_status: reviewStatus, blocked_reason: null, assigned_to: null, due_at: null,
          summary, required_action: requiredAction, queue_metadata: {}, created_by: null, created_by_type: "system", created_at: now, updated_at: now };
        state.queues.push(row);
        return { rows: [{ review_queue_item_id: row.review_queue_item_id }] };
      }
      if (s.startsWith("INSERT INTO kai.upload_lifecycle_audit")) {
        state.audits.push(JSON.parse(params[4]));
        return { rows: [] };
      }
      throw new Error(`unhandled fake query: ${s.slice(0, 80)}`);
    },
  };
}

function withFakeTransaction(state) {
  return async (callback) => {
    const draft = structuredClone({ ...state, fixtures: undefined });
    draft.fixtures = state.fixtures;
    const result = await callback(makeFakeTx(draft));
    for (const key of Object.keys(draft)) state[key] = draft[key];
    return result;
  };
}

function makeEvaluator(fixtures, { blockerCodes = [] } = {}) {
  const byClaim = new Map(fixtures.map((fixture) => [fixture.claimId, fixture]));
  return async (tx, { claimId, requestedAudience }) => ({
    ok: true,
    data: {
      claim: { claim_id: claimId }, evidence: { evidence_item_id: byClaim.get(claimId).evidenceItemId }, requestedAudience,
      eligible: true, blockerCodes, affectedDimensionKeys: [], affectedObjectIds: [], dimensions: byClaim.get(claimId).dimensions || {},
    },
    error: null,
  });
}

function recordingGenerator(respond) {
  const calls = [];
  const generator = async (input) => {
    calls.push(structuredClone(input));
    return { blocks: respond(input).map((item, index) => ({ ordinal: index + 1, text: item.text, citations: item.citations })) };
  };
  generator.calls = calls;
  return generator;
}

let idempotency = 0;
async function generateThroughRepository(fixtures, draftGenerator, { contentType = "evidence_summary", rowOverrides = {}, state = makeState(fixtures, rowOverrides), idempotencyKey = `val-gen-008-es-${++idempotency}` } = {}) {
  const repository = createPostgresGeneratedContentRepository({ runInTransaction: withFakeTransaction(state), evaluator: makeEvaluator(fixtures) });
  const create = contentType === "impact_narrative" ? repository.createImpactNarrativeDraft : repository.createEvidenceSummaryDraft;
  const result = await create({
    organizationId: ORG, engagementId: ENGAGEMENT, requestedAudience: "internal", claimIds: fixtures.map((fixture) => fixture.claimId).sort(),
    idempotencyKey, actorContext: { actorType: "human", actorUserId: "90000000-0000-4000-8000-000000000001" }, now: NOW,
  }, { draftGenerator, metadataOnlyAudit: { prepareMetadataOnlyAudit: () => ({ ok: true, async publish() {} }) } });
  return { result, state };
}

test("orchestration: the ordinary 112-record Evidence Summary with truthful paraphrase is validated and persisted exactly as validated", async () => {
  const generator = recordingGenerator(() => [{ text: PARAPHRASE_112, citations: cite(M112) }]);
  const { result, state } = await generateThroughRepository([M112], generator);
  assert.equal(result.ok, true, JSON.stringify(result));
  // The model received the complete limitation codes of the ordinary measured claim.
  assert.equal(generator.calls.length, 1);
  assert.deepEqual(generator.calls[0].claims[0].limitationCodes, M112.limitationCodes);
  assert.equal(state.measurementReads, 1, "the measured-claim branch read its measurement");
  const [draft] = state.drafts;
  const validators = Object.fromEntries(draft.validator_results.map((item) => [item.validator_key, item.severity]));
  assert.deepEqual(validators, { "VAL-GEN-001": "pass", "VAL-GEN-002": "pass", "VAL-GEN-003": "pass", "VAL-GEN-004": "pass", "VAL-GEN-008": "pass", "VAL-GEN-005": "pass", "INFO-SOURCE-STORY-001": "pass" });
  // What persisted is exactly what passed validation, and what is returned.
  const [persisted] = state.blocks;
  const expected = compose([block(PARAPHRASE_112, M112)], [M112]).blocks[0].text;
  assert.equal(persisted.text, expected);
  assert.equal(result.data.blocks[0].text, expected);
  assert.equal(validate([{ ordinal: 1, text: persisted.text, citations: cite(M112) }], [M112]).ok, true);
  assert.deepEqual(state.citations.map((row) => [row.claim_id, row.evidence_item_id]), [[M112.claimId, M112.evidenceItemId]]);
  for (const label of ["Conflicting sources", "Alignment with funder requirements", "Small-number (small-cell) risk", "Reporting period"]) assert.ok(persisted.text.includes(label), label);
  assert.match(persisted.text, /human-defined by the organization/);
  assert.match(persisted.text, /No reporting period was defined/);
  assert.equal(state.queues[0].queue_status, "open", "a human still reviews the draft");
  assert.equal(state.audits.length, 1);

  // Replay returns the persisted text; nothing is composed twice.
  const replay = await generateThroughRepository([M112], generator, { state, idempotencyKey: `val-gen-008-es-${idempotency}` });
  assert.equal(replay.result.data.replayed, true);
  assert.equal(replay.result.data.blocks[0].text, expected);
  assert.equal(generator.calls.length, 1);
});

test("orchestration: mixed-citation measured claims persist per-claim disclosures under the authorized citations", async () => {
  const generator = recordingGenerator(() => [{ text: `${LEAD_112} ${LEAD_37}`, citations: cite(M112, M37) }, { text: FIELD.claim.claimStatement, citations: cite(FIELD) }]);
  const { result, state } = await generateThroughRepository([M112, M37, FIELD], generator);
  assert.equal(result.ok, true, JSON.stringify(result));
  const [first, second] = state.blocks.sort((a, b) => a.ordinal - b.ordinal);
  assert.match(first.text, /Measurement disclosure for the cited count of 112: .*No reporting period.*Measurement disclosure for the cited count of 37: .*attested/);
  assert.equal(second.text, FIELD.claim.claimStatement, "a block citing no measured claim is unchanged");
  assert.equal(state.citations.length, 3);
});

test("orchestration: contradictions, unsupported assertions and unauthorized citations are detected and never saved; the block is restated", async () => {
  for (const [label, items, expected] of [
    ["unique participants", [{ text: `${PARAPHRASE_112} These are 112 unique participants.`, citations: cite(M112) }], "VAL-GEN-008"],
    ["period verified", [{ text: `${LEAD_37} The period was verified against record dates.`, citations: cite(M37) }], "VAL-GEN-008"],
    ["unsupported number", [{ text: `${PARAPHRASE_112} That is 45% of enrolled participants.`, citations: cite(M112) }], "VAL-GEN-004"],
    ["causal language", [{ text: `${PARAPHRASE_112} The programme improves wellbeing.`, citations: cite(M112) }], "VAL-GEN-004"],
    ["unauthorized citation", [{ text: PARAPHRASE_112, citations: [{ claimId: M112.claimId, evidenceItemId: M37.evidenceItemId }] }], "VAL-GEN-003"],
  ]) {
    const fixtures = label === "period verified" ? [M37] : [M112];
    const { result, state } = await generateThroughRepository(fixtures, recordingGenerator(() => items));
    // Owner direction 2026-11-10: detected, recorded, restated - never saved, never a failed request.
    assert.equal(result.ok, true, label);
    const fallback = state.drafts[0].validator_results.find((item) => item.validator_key === "KAI-GEN-WORDING-FALLBACK-001");
    assert.ok(fallback.evidence.refused_validator_keys.includes(expected), `${label}: ${JSON.stringify(fallback.evidence)}`);
    assert.ok(!state.blocks.some((row) => row.text.includes(items[0].text)), `${label}: refused wording not saved`);
    assert.deepEqual(state.citations.map((row) => [row.claim_id, row.evidence_item_id]), [[fixtures[0].claimId, fixtures[0].evidenceItemId]], label);
  }
});

test("orchestration: a block whose disclosure cannot fit is restated from its claim, never truncated, and the request is not failed", async () => {
  const long = `${LEAD_112} ${"The organization reviewed this worksheet. ".repeat(90)}`.slice(0, 3900);
  assert.ok(long.length <= 4000);
  const generator = recordingGenerator(() => [{ text: long, citations: cite(M112) }]);
  const { result, state } = await generateThroughRepository([M112], generator);
  // Owner direction 2026-11-10 (before: 422 generator_result_block_text_too_long, nothing saved).
  assert.equal(result.ok, true, JSON.stringify(result.blockers));
  assert.equal(state.blocks.length, 1);
  assert.ok(state.blocks[0].text.length <= 4000);
  assert.ok(state.blocks[0].text.startsWith(generator.calls[0].claims[0].claimStatement), "restated from the claim");
  assert.ok(!state.blocks[0].text.includes("The organization reviewed this worksheet."), "the model text is not truncated into the draft");
  const fallback = state.drafts[0].validator_results.find((item) => item.validator_key === "KAI-GEN-WORDING-FALLBACK-001");
  assert.deepEqual(fallback.evidence.refused_validator_keys, ["RESULT-CONTRACT"]);
  assert.ok(GENERATOR_RESULT_CONTRACT_VALIDATOR_KEY);
});

test("orchestration: audience authority is unchanged by composition", async () => {
  const { result, state } = await generateThroughRepository([M112], recordingGenerator(() => [{ text: PARAPHRASE_112, citations: cite(M112) }]), { rowOverrides: { internal_only: false } });
  assert.deepEqual([result.ok, result.error?.code], [false, "validation_blocker"]);
  assert.ok(result.blockers.some((blocker) => blocker.validator_key === "VAL-GEN-005"), JSON.stringify(result.blockers));
  assert.equal(state.drafts.length, 0);
});

test("orchestration: non-Evidence-Summary generation gets no composed disclosure and keeps the prior rules", async () => {
  const paraphrase = await generateThroughRepository([M112], recordingGenerator(() => [{ text: PARAPHRASE_112, citations: cite(M112) }]), { contentType: "impact_narrative" });
  assert.deepEqual([paraphrase.result.ok, paraphrase.result.error?.code], [false, "validation_blocker"]);
  assert.ok(paraphrase.result.blockers.some((blocker) => blocker.validator_key === "VAL-GEN-008"));
  const legacyCompliant = `${COMPLETE_112} Internal limitations: conflicting sources, requirement alignment and small-cell risk.`;
  const accepted = await generateThroughRepository([M112], recordingGenerator(() => [{ text: legacyCompliant, citations: cite(M112) }]), { contentType: "impact_narrative" });
  assert.equal(accepted.result.ok, true, JSON.stringify(accepted.result));
  assert.equal(accepted.state.blocks[0].text, legacyCompliant, "persisted exactly as the model wrote it");
});

// --- Owner prompt "KAI VAL-GEN-008 — Final local safety acceptance"
// (2026-11-01): the appended authoritative disclosure must never neutralize a
// false or unsupported model assertion. Each case runs the ordinary measured
// Evidence Summary path (not the count-only composer) through the real
// repository and validators, and records what actually happened. ---

async function observe(fixtures, text) {
  const generator = recordingGenerator(() => [{ text, citations: cite(fixtures[0]) }]);
  const { result, state } = await generateThroughRepository(fixtures, generator);
  return {
    result, state, generator,
    observed: {
      accepted: result.ok === true,
      blockers: (result.blockers || []).map((item) => ({
        validator_key: item.validator_key, blocking_reason: item.blocking_reason,
        classes: item.evidence?.violation_classes || item.evidence?.assertion_classes || [], block_ordinals: item.evidence?.block_ordinals || [],
      })),
      persisted: { drafts: state.drafts.length, blocks: state.blocks.length, citations: state.citations.length, audits: state.audits.length },
    },
  };
}

// A refused generation rolls its transaction back, so the path is proven from
// what the model received: the claim's measurement-derived limitation codes
// (read from its measurement), never the count-only code.
function assertOrdinaryMeasuredPath(fixture, generator) {
  assert.equal(fixture.claim.limitationCodes.includes(COUNT_ONLY_LIMITATION_CODE), false, "not a count-only claim");
  assert.equal(generator.calls.length, 1);
  assert.deepEqual(generator.calls[0].claims.map((claim) => claim.limitationCodes), [fixture.limitationCodes], "the ordinary measured-claim projection");
}

// Owner direction 2026-11-10: the validators still detect the false or
// unsupported model wording (the validator key, class and block are
// recorded on the draft), but it never fails the request and is never saved:
// the block is restated from the cited claim's own governed text with its
// disclosure, and a human still reviews the draft.
function assertRefused(label, { result, state, generator, observed }, fixture, validatorKey, violationClass, refusedText = null) {
  assertOrdinaryMeasuredPath(fixture, generator);
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(observed)}`);
  const fallback = state.drafts[0].validator_results.find((item) => item.validator_key === "KAI-GEN-WORDING-FALLBACK-001");
  assert.ok(fallback, `${label}: ${JSON.stringify(state.drafts[0].validator_results)}`);
  assert.ok(fallback.evidence.refused_validator_keys.includes(validatorKey), `${label}: ${JSON.stringify(fallback.evidence)}`);
  assert.ok(fallback.evidence.refused_classes.includes(violationClass), `${label}: ${JSON.stringify(fallback.evidence)}`);
  assert.deepEqual(fallback.evidence.replaced_model_block_ordinals, [1], label);
  const generated = generator.calls[0].claims[0].claimStatement;
  assert.equal(state.blocks.length, 1, label);
  assert.ok(state.blocks[0].text.startsWith(generated), `${label}: restated from the claim`);
  if (refusedText) assert.ok(!state.blocks[0].text.includes(refusedText), `${label}: the refused wording is not saved`);
  assert.equal(validate([{ ordinal: 1, text: state.blocks[0].text, citations: cite(fixture) }], [fixture]).ok, true, label);
  assert.equal(state.queues[0].queue_status, "open", `${label}: a human still reviews the draft`);
}

function assertAcceptedWithDisclosure(label, { result, state, generator, observed }, fixture, modelText) {
  assertOrdinaryMeasuredPath(fixture, generator);
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(observed)}`);
  assert.equal(state.measurementReads, 1, "the measured-claim branch read its measurement");
  const [persisted] = state.blocks;
  const expected = compose([block(modelText, fixture)], [fixture]).blocks[0].text;
  assert.ok(expected.startsWith(`${modelText} Measurement disclosure for the cited count: `), label);
  assert.equal(persisted.text, expected, `${label}: persisted is the validated composed text`);
  assert.equal(result.data.blocks[0].text, expected, label);
  assert.equal(validate([{ ordinal: 1, text: persisted.text, citations: cite(fixture) }], [fixture]).ok, true, label);
  assert.deepEqual(state.citations.map((row) => [row.claim_id, row.evidence_item_id]), [[fixture.claimId, fixture.evidenceItemId]], label);
  assert.equal(state.queues[0].queue_status, "open", `${label}: a human still reviews the draft`);
}

const ACCEPTED_SMALL_CELL = measuredFixture({
  n: 6, value: 112, sourceDimensions: { ...SOURCE_DIMENSIONS, small_cell_risk: { assessment_status: "unresolved", internal_limitation_accepted: true } },
});

test("Case A: a false reporting-period assertion is refused despite the appended 'No reporting period' disclosure", async (t) => {
  const falseText = `${LEAD_112} A reporting period was defined.`;
  const refused = await observe([M112], falseText);
  t.diagnostic(`CASE_A ${JSON.stringify(refused.observed)}`);
  assertRefused("A", refused, M112, "VAL-GEN-008", "limitation_contradicted", "A reporting period was defined.");

  for (const truthful of [
    `${LEAD_112} No reporting period is established for this count.`,
    `${LEAD_112} A reporting period was not defined.`,
    `${LEAD_112} The count is not tied to a reporting period.`,
  ]) {
    assertAcceptedWithDisclosure(truthful, await observe([M112], truthful), M112, truthful);
  }
});

test("Case B: false coverage-status assertions are refused despite the appended correct coverage descriptions", async (t) => {
  const observations = [];
  for (const [label, sentence, code] of [
    ["B1", "Conflicting sources have been resolved.", "coverage.conflicting_source_indicators.unresolved"],
    ["B2", "Requirement alignment has been established.", "coverage.requirement_alignment.unresolved"],
    ["B3", "Small-cell risk has been cleared.", "coverage.small_cell_risk.resolved_risk_flagged"],
  ]) {
    assert.ok(M112.limitationCodes.includes(code), `${label}: authoritative status ${code}`);
    observations.push([label, await observe([M112], `${LEAD_112} ${sentence}`), sentence]);
  }
  const acceptedCleared = await observe([ACCEPTED_SMALL_CELL], `${LEAD_112} Small-cell risk has been cleared.`);
  observations.push(["B3_ACCEPTED", acceptedCleared, "Small-cell risk has been cleared."]);
  // Every case is observed and recorded before any is asserted.
  for (const [label, observation] of observations) t.diagnostic(`CASE_${label} ${JSON.stringify(observation.observed)}`);
  for (const [label, observation, sentence] of observations) {
    assertRefused(label, observation, label === "B3_ACCEPTED" ? ACCEPTED_SMALL_CELL : M112, "VAL-GEN-008", "limitation_contradicted", sentence);
  }

  for (const truthful of [
    `${LEAD_112} Conflicting sources remain unresolved, requirement alignment has not been established, and small-cell risk is flagged.`,
    `${LEAD_112} Conflicting sources have not been resolved and small-cell risk has not been cleared.`,
  ]) {
    assertAcceptedWithDisclosure(truthful, await observe([M112], truthful), M112, truthful);
  }

  // An internally accepted limitation stays unresolved: described as such it
  // passes (described as cleared it is refused above, B3_ACCEPTED).
  assert.ok(ACCEPTED_SMALL_CELL.limitationCodes.includes("coverage.small_cell_risk.accepted_internal_limitation"));
  const acceptedTruthful = `${LEAD_112} Small-cell risk is not resolved and is accepted as a limitation for internal use only.`;
  assertAcceptedWithDisclosure("accepted limitation", await observe([ACCEPTED_SMALL_CELL], acceptedTruthful), ACCEPTED_SMALL_CELL, acceptedTruthful);
});

test("Case C: '112 participants were served' is refused; the literal 112 does not authorize another counted entity", async (t) => {
  const falseText = `${LEAD_112} 112 participants were served.`;
  assert.doesNotMatch(falseText, /\b(unique|distinct|deduplicated)\b/i);
  const refused = await observe([M112], falseText);
  t.diagnostic(`CASE_C ${JSON.stringify(refused.observed)}`);
  assertRefused("C", refused, M112, "VAL-GEN-008", "limitation_contradicted", "112 participants were served.");

  for (const truthful of [
    "112 source records were counted in selected worksheet sheet_1.",
    `${LEAD_112} The source does not establish how many participants were served.`,
    // Owner prompt "KAI — Complete the existing VAL-GEN-008 repair" (2026-11-01),
    // Case C: denying that the source establishes the count is not asserting it.
    "The source does not establish that 112 participants were served.",
    `${LEAD_112} The source doesn't establish whether 112 participants were served.`,
  ]) {
    assertAcceptedWithDisclosure(truthful, await observe([M112], truthful), M112, truthful);
  }
  // The denial covers only the clause it governs; the same statement made
  // affirmatively, or after a denial of something else, is still refused.
  for (const asserted of [
    "112 participants were served.",
    "The source establishes that 112 participants were served.",
    "The source does not establish that 112 participants were served, but 112 participants were served.",
    "The source does not establish the reporting period; 112 participants were served.",
    `${LEAD_112} The source does not establish a period. That is 112 people.`,
  ]) {
    assertRefused(asserted, await observe([M112], asserted), M112, "VAL-GEN-008", "limitation_contradicted", asserted);
  }
});

test("Cases A–C hardening: the disclosure wording cannot mask an assertion, and truthful paraphrase passes", async () => {
  for (const [label, text] of [
    ["copied disclosure prefix", `${LEAD_112} Measurement disclosure for the cited count: A reporting period was defined.`],
    ["any dimension asserted resolved", `${LEAD_112} Any conflicting sources have been resolved.`],
    ["service asserted of the counted unit", "112 source records were served in selected worksheet sheet_1."],
    ["value as people", `${LEAD_112} That is 112 people.`],
    ["value as participants, later sentence", `${LEAD_112} In total, 112 participants.`],
  ]) {
    assertRefused(label, await observe([M112], text), M112, "VAL-GEN-008", "limitation_contradicted", text);
  }
  for (const text of [
    `${LEAD_112} The worksheet holds 112 records.`,
    `${LEAD_112} The count is 112.`,
    `${LEAD_112} The source does not establish a participant count, and the reporting period is not defined.`,
  ]) {
    assertAcceptedWithDisclosure(text, await observe([M112], text), M112, text);
  }
});

// --- Owner prompt "KAI — Complete the existing VAL-GEN-008 repair and prove
// the 112-record Evidence Summary workflow" (2026-11-01): the model states
// only the supported count and worksheet; the server supplies every
// applicable disclosure from the claim's authoritative limitation codes. ---

test("final acceptance: the 112-record count-and-worksheet-only draft persists with server-composed disclosures, unchanged evidence, and an open review", async (t) => {
  const modelText = "112 source records were counted in selected worksheet sheet_1.";
  assert.doesNotMatch(modelText, /reporting period|record meaning|human-defined|conflicting|alignment|small-cell|limitation/i, "the model supplies no disclosure of its own");
  const fixtureBefore = structuredClone({ measurementRow: M112.measurementRow, claim: M112.claim, dimensions: M112.dimensions });
  const observed = await observe([M112], modelText);
  t.diagnostic(`FINAL_ACCEPTANCE ${JSON.stringify(observed.observed)}`);
  // Case A: generated, validated (VAL-GEN-008 included), persisted and returned identically.
  assertAcceptedWithDisclosure("final acceptance", observed, M112, modelText);
  const { result, state } = observed;
  assert.deepEqual(Object.fromEntries(state.drafts[0].validator_results.map((item) => [item.validator_key, item.severity])),
    { "VAL-GEN-001": "pass", "VAL-GEN-002": "pass", "VAL-GEN-003": "pass", "VAL-GEN-004": "pass", "VAL-GEN-008": "pass", "VAL-GEN-005": "pass", "INFO-SOURCE-STORY-001": "pass" });

  // Case B: exactly the disclosures of the authoritative codes, after the verbatim model text.
  const persisted = state.blocks[0].text;
  const disclosure = persisted.slice(`${modelText} Measurement disclosure for the cited count: `.length);
  assert.equal(disclosure, describe112());
  assert.ok(M112.limitationCodes.includes("measurement.record_meaning_human_defined"));
  assert.match(disclosure, /count of source records only, and one record is not necessarily one separate person, event or result; what one counted record represents is human-defined by the organization and was not verified by KAI\./);
  assert.ok(M112.limitationCodes.includes("measurement.no_reporting_period"));
  assert.ok(disclosure.includes(describeMeasurementLimitationCode("measurement.no_reporting_period")));
  for (const code of M112.limitationCodes.filter((code) => code.startsWith("coverage."))) assert.ok(disclosure.includes(describeMeasurementLimitationCode(code)), code);
  // The fixture's actual statuses, read from its codes, not assigned from the dimension names.
  assert.deepEqual(M112.limitationCodes.filter((code) => /conflicting|requirement|small_cell/.test(code)), [
    "coverage.conflicting_source_indicators.unresolved", "coverage.requirement_alignment.unresolved", "coverage.small_cell_risk.resolved_risk_flagged",
  ]);
  // No blank or duplicate code applies, so no blank or duplicate sentence is composed.
  assert.doesNotMatch(disclosure, /Blank records|Exact-duplicate|attested/);

  // Case E: the measurement is preserved; no unique-person or service count is introduced.
  assert.deepEqual([M112.measurementRow.measured_value, M112.measurementRow.worksheet_key, M112.measurementRow.duplicate_record_count,
    M112.measurementRow.blank_record_count, M112.measurementRow.period_start, M112.measurementRow.period_end], [112, "sheet_1", 0, 0, null, null]);
  assert.deepEqual(persisted.match(/\d+/g), ["112", "1"], "only the measured value and the worksheet key's own digit");
  // 112 is stated only of the counted source records (owner Package 1: the
  // human-defined label is not the counted entity), and nothing asserts
  // people, uniqueness or service.
  assert.deepEqual([...persisted.matchAll(/112 (\S+ \S+)/g)].map((match) => match[1]), ["source records"]);
  assert.doesNotMatch(persisted, /\b(unique|distinct|deduplicated|individuals?|people|participants?|served|reached)\b/i);
  assert.deepEqual(state.citations.map((row) => [row.claim_id, row.evidence_item_id]), [[M112.claimId, M112.evidenceItemId]], "the measurement stays traceable through its citation");

  // Unapproved draft in an open review queue; nothing approved, exported or written to evidence.
  assert.deepEqual([state.drafts[0].draft_status, state.drafts[0].review_status], ["draft", "needs_gk_review"]);
  assert.deepEqual(state.queues.map((row) => [row.queue_type, row.target_object_type, row.target_object_id, row.queue_status, row.review_status]),
    [["generated_content_review", "generated_content_draft", state.drafts[0].generated_content_draft_id, "open", "needs_gk_review"]]);
  assert.equal(result.data.blocks[0].text, persisted);
  const writes = state.statements.filter((sql) => /^(INSERT|UPDATE|DELETE)\b/i.test(sql)).map((sql) => sql.split(/[\s(]+/).slice(0, 3).join(" "));
  assert.deepEqual([...new Set(writes)].sort(), [
    "INSERT INTO kai.generated_content_blocks", "INSERT INTO kai.generated_content_citations", "INSERT INTO kai.generated_content_drafts",
    "INSERT INTO kai.generation_runs", "INSERT INTO kai.review_queue_items", "INSERT INTO kai.upload_lifecycle_audit",
  ], "no write to a source, measurement, evidence item or claim");
  assert.deepEqual({ measurementRow: M112.measurementRow, claim: M112.claim, dimensions: M112.dimensions }, fixtureBefore);
  assert.deepEqual(state.claims, makeState([M112]).claims, "claim/evidence rows unchanged");
});

test("final acceptance: refused generated wording is not saved and leaves the claim, evidence and measurement unchanged", async () => {
  const fixtureBefore = structuredClone({ measurementRow: M112.measurementRow, claim: M112.claim });
  const refused = await observe([M112], "112 participants were served.");
  assertRefused("refused", refused, M112, "VAL-GEN-008", "limitation_contradicted", "112 participants were served.");
  assert.deepEqual(refused.state.claims, makeState([M112]).claims);
  assert.deepEqual({ measurementRow: M112.measurementRow, claim: M112.claim }, fixtureBefore);
});

function describe112() {
  return generatedContentValidators.composeEvidenceSummaryMeasurementDisclosures({
    blocks: [block("", M112)], claims: [M112.claim], measuredValueByClaimId: measuredValues(M112),
  }).blocks[0].text.replace(/^Measurement disclosure for the cited count: /, "");
}
