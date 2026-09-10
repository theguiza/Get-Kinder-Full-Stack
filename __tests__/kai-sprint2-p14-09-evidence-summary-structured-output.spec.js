// P14-09: Evidence Summary generator structured-output repair.
//
// Proves the production Anthropic Messages request now carries the exact
// bounded output_config.format json_schema, that a valid schema-conformant
// provider response still normalizes into the existing { blocks: [...] }
// generator-result shape for both the internal and funder audiences, that a
// malformed/absent structured result still fails closed via the existing
// reason tags, that KAI-level governance (citation/UUID/VAL-GEN) is
// unaffected, that exactly one provider call occurs with no retry, and that
// no raw provider/generated content leaks into a rejection reason.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createProductionEvidenceSummaryDraftGenerator,
  __evidenceSummaryDraftGeneratorContract,
} from "../Backend/kai/services/kaiEvidenceSummaryDraftGenerator.js";
import {
  __generatedContentRepositoryTestables,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";

const { validateGeneratorResult, classifyGeneratorResult, GENERATOR_RESULT_REASONS } = __generatedContentRepositoryTestables;

const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";

const GOOD_CLAIMS = [{
  claimId: CLAIM,
  claimStatement: "Enrollment increased by 12% in 2025.",
  claimType: "finding",
  evidenceItemId: EVIDENCE,
  sourceId: "00000000-0000-4000-8000-000000000301",
  sourceVersionId: "00000000-0000-4000-8000-000000000401",
  limitationCodes: [],
}];

function generatorWithResponse(response) {
  const calls = [];
  const generator = createProductionEvidenceSummaryDraftGenerator({
    async createMessage(payload) {
      calls.push(payload);
      return response;
    },
  });
  return { generator, calls };
}

// --- 1. provider request contains the exact output_config.format schema ---

test("P14-09 structured-output: the provider request carries the exact bounded output_config.format json_schema", async () => {
  const { generator, calls } = generatorWithResponse({
    content: [{ type: "text", text: JSON.stringify({ blocks: [{ text: "Enrollment increased by 12% in 2025.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }] }) }],
  });
  await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: GOOD_CLAIMS });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].output_config, {
    format: {
      type: "json_schema",
      schema: __evidenceSummaryDraftGeneratorContract.EVIDENCE_SUMMARY_OUTPUT_SCHEMA,
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

// --- 2. valid provider structured output returns the existing shape ---

test("P14-09 structured-output: a valid schema-conformant response normalizes into the existing { blocks: [...] } shape", async () => {
  const { generator } = generatorWithResponse({
    content: [{
      type: "text",
      text: JSON.stringify({ blocks: [{ text: "Enrollment increased by 12% in 2025.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }] }),
    }],
  });
  const result = await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: GOOD_CLAIMS });

  assert.deepEqual(result, {
    blocks: [{ ordinal: 1, text: "Enrollment increased by 12% in 2025.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
  });
  assert.equal(validateGeneratorResult(result), true);
  assert.deepEqual(classifyGeneratorResult(result), { ok: true, reason: null });
});

// --- 3 & 4. funder and internal generation both use the structured-output path ---

test("P14-09 structured-output: both funder and internal generation attach the same output_config.format schema", async () => {
  const { generator, calls } = generatorWithResponse({
    content: [{ type: "text", text: JSON.stringify({ blocks: [{ text: "Enrollment increased by 12% in 2025.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }] }) }],
  });

  await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: GOOD_CLAIMS });
  await generator({ contentType: "evidence_summary", requestedAudience: "funder", claims: GOOD_CLAIMS });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].output_config, calls[1].output_config);
  assert.equal(calls[0].system.includes("internal evidence summaries"), true);
  assert.equal(calls[1].system.includes("funder-facing evidence summaries"), true);
});

// --- 5. malformed/absent output still fails closed ---

test("P14-09 structured-output: no extractable provider text still fails closed as generator_result_provider_text_missing", async () => {
  const { generator } = generatorWithResponse({ content: [] });
  const result = await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: GOOD_CLAIMS });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.PROVIDER_TEXT_MISSING);
  assert.equal(validateGeneratorResult(result), false);
});

test("P14-09 structured-output: unparseable provider text still fails closed as generator_result_json_parse_failed", async () => {
  const { generator } = generatorWithResponse({ content: [{ type: "text", text: "not-json" }] });
  const result = await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: GOOD_CLAIMS });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.JSON_PARSE_FAILED);
});

// --- 6. KAI-invalid citation/UUID/VAL-GEN states remain rejected downstream ---

test("P14-09 structured-output: a schema-conformant but KAI-invalid citation (non-UUID id) is still rejected downstream", async () => {
  const { generator } = generatorWithResponse({
    content: [{
      type: "text",
      text: JSON.stringify({ blocks: [{ text: "Enrollment increased by 12% in 2025.", citations: [{ claimId: "not-a-uuid", evidenceItemId: EVIDENCE }] }] }),
    }],
  });
  const result = await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: GOOD_CLAIMS });
  assert.equal(validateGeneratorResult(result), false);
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.CITATION_ID_INVALID);
});

test("P14-09 structured-output: a schema-conformant but empty-citations block is still rejected downstream", async () => {
  const { generator } = generatorWithResponse({
    content: [{ type: "text", text: JSON.stringify({ blocks: [{ text: "Enrollment increased by 12% in 2025.", citations: [] }] }) }],
  });
  const result = await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: GOOD_CLAIMS });
  assert.equal(validateGeneratorResult(result), false);
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.CITATIONS_MISSING);
});

// --- 7. exactly one provider call occurs ---

test("P14-09 structured-output: exactly one provider call occurs per generation, success or failure", async () => {
  for (const response of [
    { content: [{ type: "text", text: JSON.stringify({ blocks: [{ text: "Enrollment increased by 12% in 2025.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }] }) }] },
    { content: [] },
    { content: [{ type: "text", text: "not-json" }] },
  ]) {
    const { generator, calls } = generatorWithResponse(response);
    await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: GOOD_CLAIMS });
    assert.equal(calls.length, 1);
  }
});

// --- 8. no retry/fallback exists ---

test("P14-09 structured-output: a provider call rejection propagates directly with no retry", async () => {
  let callCount = 0;
  const generator = createProductionEvidenceSummaryDraftGenerator({
    async createMessage() {
      callCount += 1;
      throw new Error("provider unavailable");
    },
  });
  await assert.rejects(
    () => generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: GOOD_CLAIMS }),
    /provider unavailable/,
  );
  assert.equal(callCount, 1);
});

// --- 9. no raw provider/generated content reaches blockers/errors/logs ---

test("P14-09 structured-output: unparseable raw provider text never leaks into the fail-closed result or its reason", async () => {
  const rawText = "SENTINEL-RAW-PROVIDER-TEXT-0001 not json";
  const { generator } = generatorWithResponse({ content: [{ type: "text", text: rawText }] });
  const result = await generator({ contentType: "evidence_summary", requestedAudience: "internal", claims: GOOD_CLAIMS });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("SENTINEL-RAW-PROVIDER-TEXT"), false);
  assert.equal(classifyGeneratorResult(result).reason.includes("SENTINEL-RAW-PROVIDER-TEXT"), false);
});
