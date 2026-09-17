// Horizontal anti-drift conformance suite for the four current generated-
// draft production generators (Evidence Summary, Impact Narrative, Readiness
// Assessment, Data Gap Memo).
//
// Each of these generators already has its own focused per-generator
// structured-output/boundary spec proving this same contract in isolation
// (kai-sprint2-p14-09-evidence-summary-structured-output.spec.js,
// kai-sprint2-p13-01-impact-narrative-structured-output.spec.js,
// kai-sprint2-readiness-assessment-structured-output.spec.js,
// kai-sprint2-data-gap-memo-draft-generation-boundary.spec.js). This suite
// does not replace those - it declares the shared provider/result contract
// exactly once and parameterizes it across all four production factories, so
// a future generator that silently drifts from the established
//   provider call -> structured-output request -> provider text extraction
//   -> JSON parse -> JSON-root validation -> blocks-field validation
//   -> failure-reason preservation -> block/citation normalization
//   -> existing downstream generator-result classification
// contract is caught by one shared table instead of only by whichever
// per-generator spec happens to already cover it.
//
// It exercises only the real production generator factories (with an
// injected createMessage dependency; no external provider call) and the
// real downstream classifyGeneratorResult/GENERATOR_RESULT_REASONS seam
// already exported for testing from the generated-content repository. It
// does not mock, reimplement, or duplicate any extract/parse/normalize/
// classify logic itself.
//
// It intentionally does NOT flatten content-specific behavior: each
// generator keeps its own prompt, its own max_tokens, and its own required
// input shape (Evidence Summary's funder audience, Readiness Assessment's
// readiness.requirements, Data Gap Memo's gaps.items). Case 2 uses a
// content-appropriate invalid input per generator rather than one generic
// invalid shape.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createProductionEvidenceSummaryDraftGenerator,
  __evidenceSummaryDraftGeneratorContract,
} from "../Backend/kai/services/kaiEvidenceSummaryDraftGenerator.js";
import {
  createProductionImpactNarrativeDraftGenerator,
  __impactNarrativeDraftGeneratorContract,
} from "../Backend/kai/services/kaiImpactNarrativeDraftGenerator.js";
import {
  createProductionReadinessAssessmentDraftGenerator,
  __readinessAssessmentDraftGeneratorContract,
} from "../Backend/kai/services/kaiReadinessAssessmentDraftGenerator.js";
import {
  createProductionDataGapMemoDraftGenerator,
  __dataGapMemoDraftGeneratorContract,
} from "../Backend/kai/services/kaiDataGapMemoDraftGenerator.js";
import {
  __generatedContentRepositoryTestables,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";

const { validateGeneratorResult, classifyGeneratorResult, GENERATOR_RESULT_REASONS } = __generatedContentRepositoryTestables;

const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";
const SOURCE = "00000000-0000-4000-8000-000000000301";
const SOURCE_VERSION = "00000000-0000-4000-8000-000000000401";
const REQUIREMENT = "00000000-0000-4000-8000-000000000501";
const GAP = "00000000-0000-4000-8000-000000000601";

const GOOD_CLAIM = Object.freeze({
  claimId: CLAIM,
  claimStatement: "One governed claim is traceable to a source.",
  claimType: "finding",
  evidenceItemId: EVIDENCE,
  sourceId: SOURCE,
  sourceVersionId: SOURCE_VERSION,
  limitationCodes: [],
});

const READINESS = Object.freeze({
  requirements: [{
    requirement_id: REQUIREMENT,
    requirement_key: "ir_data_003",
    requirement_label: "Claims are traceable to evidence",
    assessed: true,
    assessment: {
      assessment_state: "partially_satisfied",
      assessment_explanation: "Some governed claims have no traceable evidence link.",
    },
  }],
});

const GAPS = Object.freeze({
  items: [{
    gap_log_item_id: GAP,
    claim_id: CLAIM,
    dimension_key: "coverage_gaps",
    assessment_status: "unresolved",
    validator_key: "VAL-COV-001",
  }],
});

// The one shared result envelope every generator's provider response is
// expected to normalize into: a single block with one citation. Only the
// block text varies per generator table entry, kept content-neutral here
// since the shared contract under test never inspects prose content.
function validProviderResponse(text) {
  return { content: [{ type: "text", text: JSON.stringify({ blocks: [{ text, citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }] }) }] };
}

// The four generator-response-shape malformation fixtures shared across
// every generator's Cases 3-7 - these exercise the generic
// extract/parse/validate boundary, not anything content-specific.
const NO_TEXT_RESPONSE = { content: [] };
const MALFORMED_JSON_RESPONSE = { content: [{ type: "text", text: "not-json" }] };
const NON_OBJECT_ROOT_RESPONSE = { content: [{ type: "text", text: JSON.stringify([1, 2, 3]) }] };
const BLOCKS_FIELD_INVALID_RESPONSE = { content: [{ type: "text", text: JSON.stringify({ notBlocks: [] }) }] };
const GENUINE_EMPTY_BLOCKS_RESPONSE = { content: [{ type: "text", text: JSON.stringify({ blocks: [] }) }] };
const MALFORMED_CITATION_RESPONSE = {
  content: [{ type: "text", text: JSON.stringify({ blocks: [{ text: "A generated block.", citations: [{ claimId: "not-a-uuid", evidenceItemId: EVIDENCE }] }] }) }],
};

function makeGenerator(factory, dependencies) {
  const calls = [];
  const generator = factory({
    async createMessage(payload) {
      calls.push(payload);
      return dependencies.response;
    },
  });
  return { generator, calls };
}

// One generator table, declared once. Each entry supplies only what is
// content-specific: the production factory, its exported schema contract,
// the smallest valid internal input for that generator, and one
// content-appropriate invalid input that exercises that generator's own
// input contract (not a generic invented shape).
const GENERATORS = [
  {
    name: "evidence_summary",
    factory: createProductionEvidenceSummaryDraftGenerator,
    contract: __evidenceSummaryDraftGeneratorContract,
    schemaKey: "EVIDENCE_SUMMARY_OUTPUT_SCHEMA",
    validInput: () => ({ contentType: "evidence_summary", requestedAudience: "internal", claims: [GOOD_CLAIM] }),
    // Content-specific: evidence_summary's own ALLOWED_REQUESTED_AUDIENCES
    // set accepts only "internal"/"funder" - "public" is deliberately out
    // of scope for this generator (see kaiEvidenceSummaryDraftGenerator.js).
    invalidInput: () => ({ contentType: "evidence_summary", requestedAudience: "public", claims: [GOOD_CLAIM] }),
  },
  {
    name: "impact_narrative",
    factory: createProductionImpactNarrativeDraftGenerator,
    contract: __impactNarrativeDraftGeneratorContract,
    schemaKey: "IMPACT_NARRATIVE_OUTPUT_SCHEMA",
    validInput: () => ({ contentType: "impact_narrative", requestedAudience: "internal", claims: [GOOD_CLAIM] }),
    // Content-specific: unlike evidence_summary, impact_narrative supports
    // no funder audience at all - only the exact "internal" value.
    invalidInput: () => ({ contentType: "impact_narrative", requestedAudience: "funder", claims: [GOOD_CLAIM] }),
  },
  {
    name: "readiness_assessment",
    factory: createProductionReadinessAssessmentDraftGenerator,
    contract: __readinessAssessmentDraftGeneratorContract,
    schemaKey: "READINESS_ASSESSMENT_OUTPUT_SCHEMA",
    validInput: () => ({ contentType: "readiness_assessment", requestedAudience: "internal", readiness: READINESS, claims: [GOOD_CLAIM] }),
    // Content-specific: readiness_assessment's own required
    // readiness.requirements array is absent here.
    invalidInput: () => ({ contentType: "readiness_assessment", requestedAudience: "internal", claims: [GOOD_CLAIM] }),
  },
  {
    name: "data_gap_memo",
    factory: createProductionDataGapMemoDraftGenerator,
    contract: __dataGapMemoDraftGeneratorContract,
    schemaKey: "DATA_GAP_MEMO_OUTPUT_SCHEMA",
    validInput: () => ({ contentType: "data_gap_memo", requestedAudience: "internal", gaps: GAPS, claims: [GOOD_CLAIM] }),
    // Content-specific: data_gap_memo's own required gaps.items array is
    // absent here.
    invalidInput: () => ({ contentType: "data_gap_memo", requestedAudience: "internal", claims: [GOOD_CLAIM] }),
  },
];

for (const gen of GENERATORS) {
  test(`[${gen.name}] Case 1 - valid structured result: exactly one provider call using the generator's own json_schema, normalized to the common { blocks: [{ ordinal, text, citations }] } envelope, accepted by classifyGeneratorResult`, async () => {
    const { generator, calls } = makeGenerator(gen.factory, { response: validProviderResponse("A generated block.") });
    const result = await generator(gen.validInput());

    assert.equal(calls.length, 1);
    assert.equal(calls[0].output_config.format.type, "json_schema");
    assert.equal(calls[0].output_config.format.schema, gen.contract[gen.schemaKey]);

    // The common invariant shape every one of the four schemas must encode,
    // regardless of any other content-specific schema differences.
    const schema = calls[0].output_config.format.schema;
    assert.equal(schema.type, "object");
    assert.deepEqual(schema.required, ["blocks"]);
    const blockSchema = schema.properties.blocks.items;
    assert.deepEqual(blockSchema.required, ["text", "citations"]);
    const citationSchema = blockSchema.properties.citations.items;
    assert.deepEqual(citationSchema.required, ["claimId", "evidenceItemId"]);

    assert.deepEqual(result, {
      blocks: [{ ordinal: 1, text: "A generated block.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
    });
    assert.equal(result.blocks[0].ordinal, 1);
    assert.equal(result.blocks[0].text, "A generated block.");
    assert.equal(result.blocks[0].citations[0].claimId, CLAIM);
    assert.equal(result.blocks[0].citations[0].evidenceItemId, EVIDENCE);

    assert.equal(validateGeneratorResult(result), true);
    assert.deepEqual(classifyGeneratorResult(result), { ok: true, reason: null });
  });

  test(`[${gen.name}] Case 2 - invalid content-specific input: no provider call, classified as INPUT_CONTRACT_REJECTED`, async () => {
    const { generator, calls } = makeGenerator(gen.factory, { response: validProviderResponse("unused") });
    const result = await generator(gen.invalidInput());

    assert.equal(calls.length, 0);
    assert.deepEqual(result, { blocks: [] });
    assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.INPUT_CONTRACT_REJECTED);
    assert.equal(validateGeneratorResult(result), false);
  });

  test(`[${gen.name}] Case 3 - provider text missing: classified as PROVIDER_TEXT_MISSING`, async () => {
    const { generator } = makeGenerator(gen.factory, { response: NO_TEXT_RESPONSE });
    const result = await generator(gen.validInput());

    assert.deepEqual(result, { blocks: [] });
    assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.PROVIDER_TEXT_MISSING);
    assert.equal(validateGeneratorResult(result), false);
  });

  test(`[${gen.name}] Case 4 - malformed JSON: classified as JSON_PARSE_FAILED`, async () => {
    const { generator } = makeGenerator(gen.factory, { response: MALFORMED_JSON_RESPONSE });
    const result = await generator(gen.validInput());

    assert.deepEqual(result, { blocks: [] });
    assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.JSON_PARSE_FAILED);
    assert.equal(validateGeneratorResult(result), false);
  });

  test(`[${gen.name}] Case 5 - invalid JSON root (array): classified as JSON_ROOT_INVALID`, async () => {
    const { generator } = makeGenerator(gen.factory, { response: NON_OBJECT_ROOT_RESPONSE });
    const result = await generator(gen.validInput());

    assert.deepEqual(result, { blocks: [] });
    assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.JSON_ROOT_INVALID);
    assert.equal(validateGeneratorResult(result), false);
  });

  test(`[${gen.name}] Case 6 - blocks field missing/non-array: classified as BLOCKS_FIELD_INVALID`, async () => {
    const { generator } = makeGenerator(gen.factory, { response: BLOCKS_FIELD_INVALID_RESPONSE });
    const result = await generator(gen.validInput());

    assert.deepEqual(result, { blocks: [] });
    assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.BLOCKS_FIELD_INVALID);
    assert.equal(validateGeneratorResult(result), false);
  });

  test(`[${gen.name}] Case 7 - genuine empty blocks array: no early-loss reason fabricated, classified as the existing BLOCKS_EMPTY reason`, async () => {
    const { generator } = makeGenerator(gen.factory, { response: GENUINE_EMPTY_BLOCKS_RESPONSE });
    const result = await generator(gen.validInput());

    assert.deepEqual(result, { blocks: [] });
    const { reason } = classifyGeneratorResult(result);
    assert.notEqual(reason, GENERATOR_RESULT_REASONS.PROVIDER_TEXT_MISSING);
    assert.notEqual(reason, GENERATOR_RESULT_REASONS.JSON_PARSE_FAILED);
    assert.notEqual(reason, GENERATOR_RESULT_REASONS.JSON_ROOT_INVALID);
    assert.notEqual(reason, GENERATOR_RESULT_REASONS.BLOCKS_FIELD_INVALID);
    assert.equal(reason, GENERATOR_RESULT_REASONS.BLOCKS_EMPTY);
    assert.equal(validateGeneratorResult(result), false);
  });

  test(`[${gen.name}] Case 8 - malformed citation (non-UUID id): rejected downstream by the existing classifier as CITATION_ID_INVALID`, async () => {
    const { generator } = makeGenerator(gen.factory, { response: MALFORMED_CITATION_RESPONSE });
    const result = await generator(gen.validInput());

    assert.equal(validateGeneratorResult(result), false);
    assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.CITATION_ID_INVALID);
  });
}

test("horizontal conformance: all four production generator factories were exercised", () => {
  assert.deepEqual(
    GENERATORS.map((gen) => gen.name),
    ["evidence_summary", "impact_narrative", "readiness_assessment", "data_gap_memo"],
  );
});
