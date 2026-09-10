// P14-09-FUND-GEN-RESULT-001: generator-result subreason classification
// only. Proves that every current VAL-GEN-RESULT-P0-001 /
// generator_result_contract_invalid rejection class still fails exactly as
// before, and now surfaces one closed, metadata-only subreason instead of
// the single generic string - without changing which generator results
// pass or fail, without exposing raw model/generated content, and without
// touching validateGeneratedContentDraft (VAL-GEN-001..005), P2-06
// eligibility, funder authority, or persistence.

import test from "node:test";
import assert from "node:assert/strict";

import {
  __generatedContentRepositoryTestables,
} from "../Backend/kai/dictionary/postgresGeneratedContentRepository.js";
import {
  createProductionEvidenceSummaryDraftGenerator,
} from "../Backend/kai/services/kaiEvidenceSummaryDraftGenerator.js";

const {
  classifyGeneratorResult,
  validateGeneratorResult,
  GENERATOR_RESULT_REASONS,
  GENERATOR_RESULT_REASON,
} = __generatedContentRepositoryTestables;

const CLAIM = "00000000-0000-4000-8000-000000000101";
const EVIDENCE = "00000000-0000-4000-8000-000000000201";

function validBlock(overrides = {}) {
  return {
    ordinal: 1,
    text: "Enrollment increased by 12% in 2025.",
    citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }],
    ...overrides,
  };
}

function assertClosedReason(reason) {
  assert.equal(typeof reason, "string");
  assert.ok(Object.values(GENERATOR_RESULT_REASONS).includes(reason), `unexpected non-closed reason: ${reason}`);
}

// --- classifyGeneratorResult: repository-level predicates -----------------

test("P14-09-FUND-GEN-RESULT-001: a structurally valid generator result still passes with no reason", () => {
  const result = { blocks: [validBlock()] };
  assert.equal(validateGeneratorResult(result), true);
  assert.deepEqual(classifyGeneratorResult(result), { ok: true, reason: null });
});

test("P14-09-FUND-GEN-RESULT-001: wrong top-level shape classifies as generator_result_shape_invalid", () => {
  for (const bad of [null, undefined, [], "x", { blocks: [], extra: true }, { blocks: "not-an-array" }]) {
    assert.equal(validateGeneratorResult(bad), false);
    assert.deepEqual(classifyGeneratorResult(bad), { ok: false, reason: GENERATOR_RESULT_REASONS.RESULT_SHAPE_INVALID });
  }
});

test("P14-09-FUND-GEN-RESULT-001: empty blocks classifies as generator_result_blocks_empty when no earlier reason was preserved", () => {
  const result = { blocks: [] };
  assert.equal(validateGeneratorResult(result), false);
  assert.deepEqual(classifyGeneratorResult(result), { ok: false, reason: GENERATOR_RESULT_REASONS.BLOCKS_EMPTY });
});

test("P14-09-FUND-GEN-RESULT-001: a generator-preserved early-loss reason on an empty-blocks result takes priority over the generic blocks-empty classification", () => {
  const result = { blocks: [] };
  Object.defineProperty(result, GENERATOR_RESULT_REASON, {
    value: GENERATOR_RESULT_REASONS.JSON_PARSE_FAILED,
    enumerable: false,
    configurable: true,
  });
  // Non-enumerable tag must not change the object's own visible shape.
  assert.deepEqual(Object.keys(result), ["blocks"]);
  assert.equal(JSON.stringify(result), '{"blocks":[]}');
  assert.equal(validateGeneratorResult(result), false);
  assert.deepEqual(classifyGeneratorResult(result), { ok: false, reason: GENERATOR_RESULT_REASONS.JSON_PARSE_FAILED });
});

test("P14-09-FUND-GEN-RESULT-001: more than 20 blocks classifies as generator_result_blocks_too_many", () => {
  const result = { blocks: Array.from({ length: 21 }, (_, i) => validBlock({ ordinal: i + 1 })) };
  assert.equal(validateGeneratorResult(result), false);
  assert.deepEqual(classifyGeneratorResult(result), { ok: false, reason: GENERATOR_RESULT_REASONS.BLOCKS_TOO_MANY });
});

test("P14-09-FUND-GEN-RESULT-001: a non-sequential ordinal classifies as generator_result_block_ordinal_invalid", () => {
  const result = { blocks: [validBlock({ ordinal: 2 })] };
  assert.equal(validateGeneratorResult(result), false);
  assert.deepEqual(classifyGeneratorResult(result), { ok: false, reason: GENERATOR_RESULT_REASONS.BLOCK_ORDINAL_INVALID });
});

test("P14-09-FUND-GEN-RESULT-001: an unexpected block key classifies as generator_result_block_shape_invalid", () => {
  const result = { blocks: [validBlock({ extra: true })] };
  assert.equal(validateGeneratorResult(result), false);
  assert.deepEqual(classifyGeneratorResult(result), { ok: false, reason: GENERATOR_RESULT_REASONS.BLOCK_SHAPE_INVALID });
});

test("P14-09-FUND-GEN-RESULT-001: missing/empty block text classifies as generator_result_block_text_invalid", () => {
  for (const bad of [{ text: "" }, { text: 123 }, { text: undefined }]) {
    const result = { blocks: [validBlock(bad)] };
    assert.equal(validateGeneratorResult(result), false);
    assert.deepEqual(classifyGeneratorResult(result), { ok: false, reason: GENERATOR_RESULT_REASONS.BLOCK_TEXT_INVALID });
  }
});

test("P14-09-FUND-GEN-RESULT-001: oversized block text classifies as generator_result_block_text_too_long", () => {
  const result = { blocks: [validBlock({ text: "x".repeat(4001) })] };
  assert.equal(validateGeneratorResult(result), false);
  assert.deepEqual(classifyGeneratorResult(result), { ok: false, reason: GENERATOR_RESULT_REASONS.BLOCK_TEXT_TOO_LONG });
});

test("P14-09-FUND-GEN-RESULT-001: missing/non-array/empty citations classify as generator_result_citations_missing", () => {
  for (const citations of [undefined, "not-an-array", []]) {
    const result = { blocks: [validBlock({ citations })] };
    assert.equal(validateGeneratorResult(result), false);
    assert.deepEqual(classifyGeneratorResult(result), { ok: false, reason: GENERATOR_RESULT_REASONS.CITATIONS_MISSING });
  }
});

test("P14-09-FUND-GEN-RESULT-001: an unexpected citation key classifies as generator_result_citation_shape_invalid", () => {
  const result = { blocks: [validBlock({ citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE, extra: true }] })] };
  assert.equal(validateGeneratorResult(result), false);
  assert.deepEqual(classifyGeneratorResult(result), { ok: false, reason: GENERATOR_RESULT_REASONS.CITATION_SHAPE_INVALID });
});

test("P14-09-FUND-GEN-RESULT-001: a malformed claimId/evidenceItemId classifies as generator_result_citation_id_invalid", () => {
  for (const citation of [
    { claimId: "not-a-uuid", evidenceItemId: EVIDENCE },
    { claimId: CLAIM, evidenceItemId: "not-a-uuid" },
    { claimId: undefined, evidenceItemId: EVIDENCE },
  ]) {
    const result = { blocks: [validBlock({ citations: [citation] })] };
    assert.equal(validateGeneratorResult(result), false);
    assert.deepEqual(classifyGeneratorResult(result), { ok: false, reason: GENERATOR_RESULT_REASONS.CITATION_ID_INVALID });
  }
});

test("P14-09-FUND-GEN-RESULT-001: a duplicate citation within a block classifies as generator_result_citation_duplicate", () => {
  const citation = { claimId: CLAIM, evidenceItemId: EVIDENCE };
  const result = { blocks: [validBlock({ citations: [citation, { ...citation } ] })] };
  assert.equal(validateGeneratorResult(result), false);
  assert.deepEqual(classifyGeneratorResult(result), { ok: false, reason: GENERATOR_RESULT_REASONS.CITATION_DUPLICATE });
});

test("P14-09-FUND-GEN-RESULT-001: total block text over 20000 chars classifies as generator_result_text_total_too_long", () => {
  const bigText = "x".repeat(4000);
  const result = {
    blocks: Array.from({ length: 6 }, (_, i) => validBlock({ ordinal: i + 1, text: bigText })),
  };
  // 6 * 4000 = 24000 > 20000, no single block exceeds 4000.
  assert.equal(validateGeneratorResult(result), false);
  assert.deepEqual(classifyGeneratorResult(result), { ok: false, reason: GENERATOR_RESULT_REASONS.TEXT_TOTAL_TOO_LONG });
});

test("P14-09-FUND-GEN-RESULT-001: distinct citations across different blocks are not treated as duplicates (block-scoped check unchanged)", () => {
  const citation = { claimId: CLAIM, evidenceItemId: EVIDENCE };
  const result = {
    blocks: [
      validBlock({ ordinal: 1, citations: [citation] }),
      validBlock({ ordinal: 2, citations: [citation], text: "A second, distinct block." }),
    ],
  };
  assert.equal(validateGeneratorResult(result), true);
  assert.deepEqual(classifyGeneratorResult(result), { ok: true, reason: null });
});

// --- production generator: earliest-loss reason preservation --------------

const GOOD_GENERATOR_INPUT = Object.freeze({
  contentType: "evidence_summary",
  requestedAudience: "internal",
  claims: [{
    claimId: CLAIM,
    claimStatement: "Enrollment increased by 12% in 2025.",
    claimType: "finding",
    evidenceItemId: EVIDENCE,
    sourceId: "00000000-0000-4000-8000-000000000301",
    sourceVersionId: "00000000-0000-4000-8000-000000000401",
    limitationCodes: [],
  }],
});

function generatorWithResponse(response) {
  return createProductionEvidenceSummaryDraftGenerator({ async createMessage() { return response; } });
}

test("P14-09-FUND-GEN-RESULT-001: the generator's own input-contract guard (e.g. an unsupported requestedAudience) tags generator_result_input_contract_rejected", async () => {
  const generator = generatorWithResponse({ content: [{ type: "text", text: "unused" }] });
  const result = await generator({ ...GOOD_GENERATOR_INPUT, requestedAudience: "public" });
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.INPUT_CONTRACT_REJECTED);
  assert.equal(validateGeneratorResult(result), false);
});

test("P14-09-FUND-GEN-RESULT-001: no extractable provider text tags generator_result_provider_text_missing", async () => {
  const generator = generatorWithResponse({ content: [] });
  const result = await generator(GOOD_GENERATOR_INPUT);
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.PROVIDER_TEXT_MISSING);
});

test("P14-09-FUND-GEN-RESULT-001: unparseable provider text tags generator_result_json_parse_failed (and the raw text never leaks into the reason)", async () => {
  const rawText = "not-json-at-all ```{maybe: 'markdown fenced'}```";
  const generator = generatorWithResponse({ content: [{ type: "text", text: rawText }] });
  const result = await generator(GOOD_GENERATOR_INPUT);
  assert.deepEqual(result, { blocks: [] });
  const reason = classifyGeneratorResult(result).reason;
  assert.equal(reason, GENERATOR_RESULT_REASONS.JSON_PARSE_FAILED);
  assertClosedReason(reason);
  assert.equal(reason.includes(rawText), false);
});

test("P14-09-FUND-GEN-RESULT-001: a JSON array root tags generator_result_json_root_invalid", async () => {
  const generator = generatorWithResponse({ content: [{ type: "text", text: "[1,2,3]" }] });
  const result = await generator(GOOD_GENERATOR_INPUT);
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.JSON_ROOT_INVALID);
});

test("P14-09-FUND-GEN-RESULT-001: a JSON object missing a blocks array tags generator_result_blocks_field_invalid", async () => {
  const generator = generatorWithResponse({ content: [{ type: "text", text: JSON.stringify({ notBlocks: [] }) }] });
  const result = await generator(GOOD_GENERATOR_INPUT);
  assert.deepEqual(result, { blocks: [] });
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.BLOCKS_FIELD_INVALID);
});

test("P14-09-FUND-GEN-RESULT-001: a genuinely empty blocks array from a well-formed response classifies as generator_result_blocks_empty (no early tag)", async () => {
  const generator = generatorWithResponse({ content: [{ type: "text", text: JSON.stringify({ blocks: [] }) }] });
  const result = await generator(GOOD_GENERATOR_INPUT);
  assert.equal(result[GENERATOR_RESULT_REASON], undefined);
  assert.equal(classifyGeneratorResult(result).reason, GENERATOR_RESULT_REASONS.BLOCKS_EMPTY);
});

test("P14-09-FUND-GEN-RESULT-001: a valid provider response is unaffected - passes with no reason and no reason property present", async () => {
  const generator = generatorWithResponse({
    content: [{
      type: "text",
      text: JSON.stringify({ blocks: [{ text: "Enrollment increased by 12% in 2025.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }] }),
    }],
  });
  const result = await generator(GOOD_GENERATOR_INPUT);
  assert.deepEqual(result, {
    blocks: [{ ordinal: 1, text: "Enrollment increased by 12% in 2025.", citations: [{ claimId: CLAIM, evidenceItemId: EVIDENCE }] }],
  });
  assert.equal(result[GENERATOR_RESULT_REASON], undefined);
  assert.deepEqual(classifyGeneratorResult(result), { ok: true, reason: null });
  assert.equal(validateGeneratorResult(result), true);
});

test("P14-09-FUND-GEN-RESULT-001: every closed subreason string is bounded, distinct, and carries no raw content markers", () => {
  const values = Object.values(GENERATOR_RESULT_REASONS);
  assert.equal(new Set(values).size, values.length, "reason values must be unique");
  for (const value of values) {
    assert.equal(typeof value, "string");
    assert.ok(value.length <= 64, `reason exceeds sanitizer bound: ${value}`);
    assert.ok(/^generator_result_[a-z_]+$/.test(value), `reason not in closed naming convention: ${value}`);
  }
});
