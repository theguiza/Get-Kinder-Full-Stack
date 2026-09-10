import Anthropic from "@anthropic-ai/sdk";

import {
  GENERATOR_RESULT_REASON,
  GENERATOR_RESULT_REASONS,
} from "../dictionary/postgresGeneratedContentRepository.js";

const CONTENT_TYPE = "evidence_summary";
const REQUESTED_AUDIENCE = "internal";
const FUNDER_REQUESTED_AUDIENCE = "funder";
// P14-09: this adapter is shared by both the existing internal
// evidence-summary route and the new governed funder evidence-summary
// route. Internal behavior (including the exact system-prompt wording) is
// preserved byte-for-byte; only a freshly authorized "funder" request gets
// the funder-facing system-prompt wording below. No other audience is
// accepted here - public generation is out of scope.
const ALLOWED_REQUESTED_AUDIENCES = Object.freeze(new Set([REQUESTED_AUDIENCE, FUNDER_REQUESTED_AUDIENCE]));
const MODEL = "claude-haiku-4-5-20251001";

// P14-09-FUND-GEN-RESULT-001: bounded provider-side output schema. This
// mirrors only the shapes the generator adapter already normalizes
// (normalizeGeneratorOutput below) - it does not encode any KAI governance
// (citation authorization, UUID validity, VAL-GEN rules, duplicate/text
// limits). Those checks remain downstream in validateGeneratorResult /
// validateGeneratedContentDraft, unchanged.
const EVIDENCE_SUMMARY_OUTPUT_SCHEMA = Object.freeze({
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

// P14-09-FUND-GEN-RESULT-001: attaches the closed, metadata-only reason a
// generator result would otherwise be rejected for, at the earliest point
// where that reason exists - before normalizeGeneratorOutput below
// collapses missing text, a parse failure, an invalid JSON root, and a
// missing/invalid blocks field into the same indistinguishable
// `{ blocks: [] }` shape. Uses a non-enumerable symbol key specifically so
// it is invisible to Object.keys/JSON.stringify/spread/hasExactKeys -
// validateGeneratorResult's/classifyGeneratorResult's existing acceptance
// check against `{ blocks }` is therefore byte-for-byte unchanged whether
// or not this tag is present; only classifyGeneratorResult reads it.
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

export function createProductionEvidenceSummaryDraftGenerator({
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
      max_tokens: 1200,
      system: [
        generatorInput.requestedAudience === FUNDER_REQUESTED_AUDIENCE
          ? "You generate funder-facing evidence summaries for Get Kinder."
          : "You generate internal evidence summaries for Get Kinder.",
        "Use only the supplied governed claim projection.",
        "Every block must cite at least one supplied claim/evidence pair.",
        "Do not add numbers or causal language unless it appears in a cited claim statement.",
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
          schema: EVIDENCE_SUMMARY_OUTPUT_SCHEMA,
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

export const __evidenceSummaryDraftGeneratorContract = Object.freeze({
  CONTENT_TYPE,
  REQUESTED_AUDIENCE,
  FUNDER_REQUESTED_AUDIENCE,
  ALLOWED_REQUESTED_AUDIENCES,
  MODEL,
  EVIDENCE_SUMMARY_OUTPUT_SCHEMA,
});
