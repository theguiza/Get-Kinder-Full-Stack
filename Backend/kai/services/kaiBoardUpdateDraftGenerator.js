import Anthropic from "@anthropic-ai/sdk";

import {
  GENERATOR_RESULT_REASON,
  GENERATOR_RESULT_REASONS,
} from "../dictionary/postgresGeneratedContentRepository.js";

const CONTENT_TYPE = "board_update";
const REQUESTED_AUDIENCE = "internal";
// P13-EXT-2: board_update generation is internal only - funder and public
// are never accepted here (rejected earlier, at the service-level input
// validator, isCreateBoardUpdateDraftInput in kaiGeneratedContentService.js).
// Mirrors kaiImpactNarrativeDraftGenerator.js's/
// kaiReadinessAssessmentDraftGenerator.js's internal-only
// ALLOWED_REQUESTED_AUDIENCES shape (not case_for_support's broader
// internal+funder shape).
const ALLOWED_REQUESTED_AUDIENCES = Object.freeze(new Set([REQUESTED_AUDIENCE]));
const MODEL = "claude-haiku-4-5-20251001";

// Ported from kaiCaseForSupportDraftGenerator.js's
// CASE_FOR_SUPPORT_OUTPUT_SCHEMA (itself ported from
// kaiEvidenceSummaryDraftGenerator.js's EVIDENCE_SUMMARY_OUTPUT_SCHEMA,
// P14-09-FUND-GEN-RESULT-001): bounded provider-side output schema
// mirroring only the shapes normalizeGeneratorOutput below already
// normalizes - it encodes no KAI governance (citation authorization, UUID
// validity, VAL-GEN rules, duplicate/text limits). Those checks remain
// downstream in validateGeneratorResult / validateGeneratedContentDraft,
// unchanged.
const BOARD_UPDATE_OUTPUT_SCHEMA = Object.freeze({
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

// Ported from kaiCaseForSupportDraftGenerator.js's tagGeneratorResultReason:
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

export function createProductionBoardUpdateDraftGenerator({
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
        "You generate internal Board Update narratives for Get Kinder.",
        "A Board Update is a standalone evidence-backed internal draft summarizing engagement activity and outcomes for board/reporting purposes - it is not the Board Reporting packet, and it is not a formal board decision, approval, vote, commitment, budget, priority, or recommendation record.",
        "Use only the supplied governed claim projection -- do not use outside knowledge.",
        "Every block must cite at least one supplied claim/evidence pair.",
        "Write narrative prose, not a bulleted list of facts.",
        "Never invent a board decision, approval, vote, commitment, budget figure, reporting period, priority, or recommendation.",
        "Every statement must be supported by and traceable to a cited claim -- if the supplied claims do not state a decision, a budget, or a recommendation, do not write one.",
        "Do not add numbers, percentages, or counts unless they appear verbatim in a cited claim statement.",
        "Do not state or imply causation; describe only what a cited claim actually asserts.",
        "If a claim carries limitationCodes, the narrative must reflect that limitation rather than stating the claim as an unconditional fact.",
        "Never state or imply that a claim has been reviewed, approved, or is export-eligible -- this is an unreviewed draft.",
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
          schema: BOARD_UPDATE_OUTPUT_SCHEMA,
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

export const __boardUpdateDraftGeneratorContract = Object.freeze({
  CONTENT_TYPE,
  REQUESTED_AUDIENCE,
  ALLOWED_REQUESTED_AUDIENCES,
  MODEL,
  BOARD_UPDATE_OUTPUT_SCHEMA,
});
