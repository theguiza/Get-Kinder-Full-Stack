import Anthropic from "@anthropic-ai/sdk";

import {
  GENERATOR_RESULT_REASON,
  GENERATOR_RESULT_REASONS,
} from "../dictionary/postgresGeneratedContentRepository.js";

const CONTENT_TYPE = "annual_report_section";
const REQUESTED_AUDIENCE = "internal";
const FUNDER_REQUESTED_AUDIENCE = "funder";
const PUBLIC_REQUESTED_AUDIENCE = "public";
const ALLOWED_REQUESTED_AUDIENCES = Object.freeze(new Set([
  REQUESTED_AUDIENCE,
  FUNDER_REQUESTED_AUDIENCE,
  PUBLIC_REQUESTED_AUDIENCE,
]));
const MODEL = "claude-haiku-4-5-20251001";

const ANNUAL_REPORT_SECTION_OUTPUT_SCHEMA = Object.freeze({
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
  if (requestedAudience === FUNDER_REQUESTED_AUDIENCE) return "You generate funder-facing annual report draft sections for Get Kinder.";
  if (requestedAudience === PUBLIC_REQUESTED_AUDIENCE) return "You generate public-facing annual report draft sections for Get Kinder.";
  return "You generate internal annual report draft sections for Get Kinder.";
}

export function createProductionAnnualReportSectionDraftGenerator({
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
        "An annual report section is a standalone traceable draft for reporting context; it is not a final report, approval, publication, export, release, funder-ready decision, or public-ready decision.",
        "Use only the supplied governed claim projection -- do not use outside knowledge.",
        "Every block must cite at least one supplied claim/evidence pair.",
        "Write polished narrative prose suitable for an annual report section.",
        "Never invent a fiscal year, reporting period, title, publication date, metric, count, percentage, organizational fact, beneficiary story, funder framework, or external evidence.",
        "Do not add numbers, percentages, or counts unless they appear verbatim in a cited claim statement.",
        "Do not state or imply causation; describe only what a cited claim actually asserts.",
        "If a claim carries limitationCodes, the section must reflect that limitation rather than stating the claim as an unconditional fact.",
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
          schema: ANNUAL_REPORT_SECTION_OUTPUT_SCHEMA,
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

export const __annualReportSectionDraftGeneratorContract = Object.freeze({
  CONTENT_TYPE,
  REQUESTED_AUDIENCE,
  FUNDER_REQUESTED_AUDIENCE,
  PUBLIC_REQUESTED_AUDIENCE,
  ALLOWED_REQUESTED_AUDIENCES,
  MODEL,
  ANNUAL_REPORT_SECTION_OUTPUT_SCHEMA,
});
