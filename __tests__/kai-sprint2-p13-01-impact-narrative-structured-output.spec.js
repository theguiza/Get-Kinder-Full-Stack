// P13-01 follow-up: Impact Narrative generator-result contract repair.
//
// Ported from kai-sprint2-p14-09-evidence-summary-structured-output.spec.js.
// Proves the production Anthropic Messages request now carries the exact
// bounded output_config.format json_schema, that a valid schema-conformant
// provider response still normalizes into the existing { blocks: [...] }
// generator-result shape, that a malformed/absent structured result still
// fails closed via the existing reason tags (rather than collapsing into an
// indistinguishable generator_result_blocks_empty), that a genuinely
// schema-conformant empty result still fails closed as
// generator_result_blocks_empty, and that no raw provider text leaks into a
// rejection reason.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createProductionImpactNarrativeDraftGenerator,
  __impactNarrativeDraftGeneratorContract,
} from "../Backend/kai/services/kaiImpactNarrativeDraftGenerator.js";
import {
  __generatedContentRepositoryTestables,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";

const { validateGeneratorResult, classifyGeneratorResult, GENERATOR_RESULT_REASONS } = __generatedContentRepositoryTestables;

const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";

const GOOD_CLAIMS = [{
  claimId: CLAIM,
  claimStatement: "Enrollment increased over the reporting period.",
  claimType: "finding",
  evidenceItemId: EVIDENCE,
  sourceId: "00000000-0000-4000-8000-000000000301",
  sourceVersionId: "00000000-0000-4000-8000-000000000401",
  limitationCodes: [],
}];

function generatorWithResponse(response) {
  const calls = [];
  const generator = createProductionImpactNarrativeDraftGenerator({
    async createMessage(payload) {
      calls.push(payload);
      return response;
    },
  });
  return { generator, calls };
}

test("impact narrative structured-output: the provider request carries the exact bounded output_config.format json_schema", async () => {
  const { generator, calls } = generatorWithResponse({
    content: [{ type: "text", text: JSON.stringify({ blocks: [{ text: "Enrollment increased over the reporting period.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }] }) }],
  });
  await generator({ contentType: "impact_narrative", requestedAudience: "internal", claims: GOOD_CLAIMS });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].output_config, {
    format: {
      type: "json_schema",
      schema: __impactNarrativeDraftGeneratorContract.IMPACT_NARRATIVE_OUTPUT_SCHEMA,
    },
  });

  const schema = calls[0].output_config.format.schema;
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required, ["blocks"]);
  assert.equal(schema.additionalProperties, false);
  const blockSchema = schema.properties.blocks.items;
  assert.deepEqual(blockSchema.required, ["text", "citations"]);
  assert.equal(blockSchema.additionalProperties, false);
  const citationSchema = blockSchema.properties.citations.items;
  assert.deepEqual(citationSchema.required, ["claimId", "evidenceItemId"]);
  assert.equal(citationSchema.additionalProperties, false);
});

test("impact narrative structured-output: a valid schema-conformant response normalizes into the existing { blocks: [...] } shape and passes classifyGeneratorResult", async () => {
  const { generator } = generatorWithResponse({
    content: [{ type: "text", text: JSON.stringify({ blocks: [{ text: "Enrollment increased over the reporting period.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }] }) }],
  });
  const result = await generator({ contentType: "impact_narrative", requestedAudience: "internal", claims: GOOD_CLAIMS });

  assert.deepEqual(result, {
    blocks: [{ ordinal: 1, text: "Enrollment increased over the reporting period.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
  });
  assert.equal(validateGeneratorResult(result), true);
  assert.deepEqual(classifyGeneratorResult(result), { ok: true, reason: null });
});

test("impact narrative structured-output: invalid generator input is rejected as generator_result_input_contract_rejected before any provider call", async () => {
  const { generator, calls } = generatorWithResponse({ content: [{ type: "text", text: JSON.stringify({ blocks: [] }) }] });
  const result = await generator({ contentType: "impact_narrative", requestedAudience: "internal", claims: undefined });
  assert.equal(calls.length, 0);
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.INPUT_CONTRACT_REJECTED);
  assert.equal(validateGeneratorResult(result), false);
});

test("impact narrative structured-output: no extractable provider text fails closed as generator_result_provider_text_missing", async () => {
  const { generator } = generatorWithResponse({ content: [] });
  const result = await generator({ contentType: "impact_narrative", requestedAudience: "internal", claims: GOOD_CLAIMS });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.PROVIDER_TEXT_MISSING);
  assert.equal(validateGeneratorResult(result), false);
});

test("impact narrative structured-output: unparseable provider text fails closed as generator_result_json_parse_failed", async () => {
  const { generator } = generatorWithResponse({ content: [{ type: "text", text: "not-json" }] });
  const result = await generator({ contentType: "impact_narrative", requestedAudience: "internal", claims: GOOD_CLAIMS });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.JSON_PARSE_FAILED);
});

test("impact narrative structured-output: a non-object JSON root fails closed as generator_result_json_root_invalid", async () => {
  const { generator } = generatorWithResponse({ content: [{ type: "text", text: JSON.stringify([1, 2, 3]) }] });
  const result = await generator({ contentType: "impact_narrative", requestedAudience: "internal", claims: GOOD_CLAIMS });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.JSON_ROOT_INVALID);
});

test("impact narrative structured-output: a missing/non-array blocks field fails closed as generator_result_blocks_field_invalid", async () => {
  const { generator } = generatorWithResponse({ content: [{ type: "text", text: JSON.stringify({ notBlocks: [] }) }] });
  const result = await generator({ contentType: "impact_narrative", requestedAudience: "internal", claims: GOOD_CLAIMS });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.BLOCKS_FIELD_INVALID);
});

test("impact narrative structured-output: a genuinely empty blocks array from a schema-conformant response still classifies as generator_result_blocks_empty", async () => {
  const { generator } = generatorWithResponse({ content: [{ type: "text", text: JSON.stringify({ blocks: [] }) }] });
  const result = await generator({ contentType: "impact_narrative", requestedAudience: "internal", claims: GOOD_CLAIMS });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.BLOCKS_EMPTY);
  assert.equal(validateGeneratorResult(result), false);
});

test("impact narrative structured-output: malformed citations still fail closed under the existing shared classifier", async () => {
  const { generator } = generatorWithResponse({
    content: [{ type: "text", text: JSON.stringify({ blocks: [{ text: "Enrollment increased.", citations: [{ claimId: "not-a-uuid", evidenceItemId: EVIDENCE }] }] }) }],
  });
  const result = await generator({ contentType: "impact_narrative", requestedAudience: "internal", claims: GOOD_CLAIMS });
  assert.equal(validateGeneratorResult(result), false);
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.CITATION_ID_INVALID);
});

test("impact narrative structured-output: exactly one provider call occurs per generation, success or failure", async () => {
  for (const response of [
    { content: [{ type: "text", text: JSON.stringify({ blocks: [{ text: "Enrollment increased.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }] }) }] },
    { content: [] },
    { content: [{ type: "text", text: "not-json" }] },
  ]) {
    const { generator, calls } = generatorWithResponse(response);
    await generator({ contentType: "impact_narrative", requestedAudience: "internal", claims: GOOD_CLAIMS });
    assert.equal(calls.length, 1);
  }
});

test("impact narrative structured-output: unparseable raw provider text never leaks into the fail-closed result or its reason", async () => {
  const rawText = "SENTINEL-RAW-PROVIDER-TEXT-0002 not json";
  const { generator } = generatorWithResponse({ content: [{ type: "text", text: rawText }] });
  const result = await generator({ contentType: "impact_narrative", requestedAudience: "internal", claims: GOOD_CLAIMS });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("SENTINEL-RAW-PROVIDER-TEXT"), false);
  assert.equal(classifyGeneratorResult(result).reason.includes("SENTINEL-RAW-PROVIDER-TEXT"), false);
});
