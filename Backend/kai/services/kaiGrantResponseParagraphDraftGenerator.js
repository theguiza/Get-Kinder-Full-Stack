import Anthropic from "@anthropic-ai/sdk";

import {
  GENERATOR_RESULT_REASON,
  GENERATOR_RESULT_REASONS,
} from "../dictionary/postgresGeneratedContentRepository.js";

const CONTENT_TYPE = "grant_response_paragraph";
const REQUESTED_AUDIENCE = "internal";
const FUNDER_REQUESTED_AUDIENCE = "funder";
const PUBLIC_REQUESTED_AUDIENCE = "public";
// P13-EXT-5: like annual_report_section, grant_response_paragraph reuses the
// existing shared {internal, funder, public} requestedAudience shape
// unrestricted - no new audience value and no owner gate is introduced for
// this type merely because it is new. Despite the name resembling "Grant
// Response Packet", this generator is unrelated to, and does not join,
// Grant Response Packet membership (see
// postgresGeneratedContentRepository.js's PACKET_MEMBER_CONTENT_TYPES).
const ALLOWED_REQUESTED_AUDIENCES = Object.freeze(new Set([
  REQUESTED_AUDIENCE,
  FUNDER_REQUESTED_AUDIENCE,
  PUBLIC_REQUESTED_AUDIENCE,
]));
const MODEL = "claude-haiku-4-5-20251001";

const GRANT_RESPONSE_PARAGRAPH_OUTPUT_SCHEMA = Object.freeze({
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

function audiencePrompt(requestedAudience) {
  if (requestedAudience === FUNDER_REQUESTED_AUDIENCE) return "You generate funder-facing grant response paragraph draft content for Get Kinder.";
  if (requestedAudience === PUBLIC_REQUESTED_AUDIENCE) return "You generate public-facing grant response paragraph draft content for Get Kinder.";
  return "You generate internal grant response paragraph draft content for Get Kinder.";
}

export function createProductionGrantResponseParagraphDraftGenerator({
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
        audiencePrompt(generatorInput.requestedAudience),
        "A grant response paragraph is a standalone traceable draft paragraph intended to answer a single grant-application question; it is not a final report, approval, publication, export, release, funder-ready decision, or public-ready decision.",
        "Use only the supplied governed claim projection -- do not use outside knowledge.",
        "Every block must cite at least one supplied claim/evidence pair.",
        "Write polished narrative prose suitable for a single grant-application response paragraph.",
        "Never invent a funder name, application question, deadline, framework, metric, count, percentage, organizational fact, beneficiary story, or external evidence.",
        "Do not add numbers, percentages, or counts unless they appear verbatim in a cited claim statement.",
        "Do not state or imply causation; describe only what a cited claim actually asserts.",
        "If a claim carries limitationCodes, the paragraph must reflect that limitation rather than stating the claim as an unconditional fact.",
        "Never state or imply that a claim has been reviewed, approved, finalized, published, export-eligible, funder-ready, or public-ready -- this is an unreviewed draft.",
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
          schema: GRANT_RESPONSE_PARAGRAPH_OUTPUT_SCHEMA,
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

export const __grantResponseParagraphDraftGeneratorContract = Object.freeze({
  CONTENT_TYPE,
  REQUESTED_AUDIENCE,
  FUNDER_REQUESTED_AUDIENCE,
  PUBLIC_REQUESTED_AUDIENCE,
  ALLOWED_REQUESTED_AUDIENCES,
  MODEL,
  GRANT_RESPONSE_PARAGRAPH_OUTPUT_SCHEMA,
});
