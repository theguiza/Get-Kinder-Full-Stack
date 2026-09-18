import Anthropic from "@anthropic-ai/sdk";

import {
  GENERATOR_RESULT_REASON,
  GENERATOR_RESULT_REASONS,
} from "../dictionary/postgresGeneratedContentRepository.js";

const CONTENT_TYPE = "funder_outcome_table";
const REQUESTED_AUDIENCE = "funder";
// P13-EXT-4: funder_outcome_table generation is funder only - internal and
// public are never accepted here (rejected earlier, at the service-level
// input validator, isCreateFunderOutcomeTableDraftInput in
// kaiGeneratedContentService.js). Mirrors
// kaiBoardUpdateDraftGenerator.js's single-audience
// ALLOWED_REQUESTED_AUDIENCES shape (board_update's own internal-only set),
// narrowed to "funder" instead of "internal".
const ALLOWED_REQUESTED_AUDIENCES = Object.freeze(new Set([REQUESTED_AUDIENCE]));
const MODEL = "claude-haiku-4-5-20251001";

// Ported from kaiBoardUpdateDraftGenerator.js's BOARD_UPDATE_OUTPUT_SCHEMA
// (itself ported from kaiCaseForSupportDraftGenerator.js /
// kaiEvidenceSummaryDraftGenerator.js, P14-09-FUND-GEN-RESULT-001): bounded
// provider-side output schema mirroring only the shapes
// normalizeGeneratorOutput below already normalizes - it encodes no KAI
// governance (citation authorization, UUID validity, VAL-GEN rules,
// duplicate/text limits). Those checks remain downstream in
// validateGeneratorResult / validateGeneratedContentDraft, unchanged. Per
// P13-EXT-4's contract, tabular presentation is rendered INSIDE block text
// (no separate structured-table field exists anywhere in the shared
// generated-content output contract) - the schema below is byte-for-byte
// the same shared blocks[].text + citations[] shape every other generator
// uses.
const FUNDER_OUTCOME_TABLE_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["blocks"],
  additionalProperties: false,
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        required: ["text", "citations"],
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          citations: {
            type: "array",
            items: {
              type: "object",
              required: ["claimId", "evidenceItemId"],
              additionalProperties: false,
              properties: {
                claimId: { type: "string" },
                evidenceItemId: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
});

const anthropic = new Anthropic();

// Ported from kaiBoardUpdateDraftGenerator.js's tagGeneratorResultReason:
// attaches the closed, metadata-only reason a generator result would
// otherwise be rejected for, at the earliest point where that reason exists
// - before normalizeGeneratorOutput below collapses missing text, a parse
// failure, an invalid JSON root, and a missing/invalid blocks field into the
// same indistinguishable `{ blocks: [] }` shape. Uses a non-enumerable
// symbol key so it is invisible to Object.keys/JSON.stringify/spread/
// hasExactKeys - only classifyGeneratorResult reads it.
function tagGeneratorResultReason(result, reason) {
  Object.defineProperty(result, GENERATOR_RESULT_REASON, {
    value: reason,
    enumerable: false,
    configurable: true,
  });
  return result;
}

function extractText(response) {
  return (response?.content || [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function normalizeGeneratorOutput(parsed) {
  return {
    blocks: Array.isArray(parsed?.blocks)
      ? parsed.blocks.map((block, index) => ({
          ordinal: index + 1,
          text: typeof block?.text === "string" ? block.text : "",
          citations: Array.isArray(block?.citations)
            ? block.citations.map((citation) => ({
                claimId: citation?.claimId,
                evidenceItemId: citation?.evidenceItemId,
              }))
            : [],
        }))
      : [],
  };
}

export function createProductionFunderOutcomeTableDraftGenerator({
  createMessage = (payload) => anthropic.messages.create(payload),
} = {}) {
  return async function draftGenerator(generatorInput) {
    if (
      generatorInput?.contentType !== CONTENT_TYPE
      || !ALLOWED_REQUESTED_AUDIENCES.has(generatorInput?.requestedAudience)
      || !Array.isArray(generatorInput.claims)
    ) {
      return tagGeneratorResultReason({ blocks: [] }, GENERATOR_RESULT_REASONS.INPUT_CONTRACT_REJECTED);
    }

    const response = await createMessage({
      model: MODEL,
      max_tokens: 1600,
      system: [
        "You generate funder-facing Funder Outcome Table draft content for Get Kinder.",
        "A Funder Outcome Table is a standalone evidence-backed funder draft that presents governed claims as a text-rendered table; it is not a final report, approval, publication, export, release, or funder-ready decision.",
        "Use only the supplied governed claim projection -- do not use outside knowledge.",
        "Render each block's text as a simple text table (for example, pipe-delimited rows with a header row) whose only columns and rows are drawn directly from the supplied claims -- never invent a column, metric, target, framework, reporting period, or outcome that is not present in a supplied claim statement.",
        "Every block must cite at least one supplied claim/evidence pair.",
        "Never invent a funder name, framework, reporting period, metric, target, requirement, or outcome value that is not present verbatim in a supplied claim statement.",
        "Do not add numbers, percentages, or counts unless they appear verbatim in a cited claim statement.",
        "Do not state or imply causation; describe only what a cited claim actually asserts.",
        "If a claim carries limitationCodes, the table row must reflect that limitation rather than stating the claim as an unconditional fact.",
        "Never state or imply that a claim has been reviewed, approved, finalized, published, export-eligible, or funder-ready -- this is an unreviewed draft.",
      ].join(" "),
      messages: [{
        role: "user",
        content: JSON.stringify({
          contentType: generatorInput.contentType,
          requestedAudience: generatorInput.requestedAudience,
          claims: generatorInput.claims,
        }),
      }],
      output_config: {
        format: {
          type: "json_schema",
          schema: FUNDER_OUTCOME_TABLE_OUTPUT_SCHEMA,
        },
      },
    });

    const text = extractText(response);
    if (text.length === 0) {
      return tagGeneratorResultReason(normalizeGeneratorOutput(null), GENERATOR_RESULT_REASONS.PROVIDER_TEXT_MISSING);
    }

    let parsedRoot;
    try {
      parsedRoot = JSON.parse(text);
    } catch {
      return tagGeneratorResultReason(normalizeGeneratorOutput(null), GENERATOR_RESULT_REASONS.JSON_PARSE_FAILED);
    }

    if (!parsedRoot || typeof parsedRoot !== "object" || Array.isArray(parsedRoot)) {
      return tagGeneratorResultReason(normalizeGeneratorOutput(null), GENERATOR_RESULT_REASONS.JSON_ROOT_INVALID);
    }

    if (!Array.isArray(parsedRoot.blocks)) {
      return tagGeneratorResultReason(normalizeGeneratorOutput(parsedRoot), GENERATOR_RESULT_REASONS.BLOCKS_FIELD_INVALID);
    }

    return normalizeGeneratorOutput(parsedRoot);
  };
}

export const __funderOutcomeTableDraftGeneratorContract = Object.freeze({
  CONTENT_TYPE,
  REQUESTED_AUDIENCE,
  ALLOWED_REQUESTED_AUDIENCES,
  MODEL,
  FUNDER_OUTCOME_TABLE_OUTPUT_SCHEMA,
});
