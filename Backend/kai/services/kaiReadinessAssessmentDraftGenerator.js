import Anthropic from "@anthropic-ai/sdk";

import {
  GENERATOR_RESULT_REASON,
  GENERATOR_RESULT_REASONS,
} from "../dictionary/postgresGeneratedContentRepository.js";

const CONTENT_TYPE = "readiness_assessment";
const REQUESTED_AUDIENCE = "internal";
const MODEL = "claude-haiku-4-5-20251001";

// Ported from kaiEvidenceSummaryDraftGenerator.js's
// EVIDENCE_SUMMARY_OUTPUT_SCHEMA (P14-09-FUND-GEN-RESULT-001): bounded
// provider-side output schema mirroring only the shapes normalizeGeneratorOutput
// below already normalizes - it encodes no KAI governance (requirement
// applicability/status, citation authorization, UUID validity, VAL-GEN
// rules, duplicate/text limits). Those checks remain downstream in
// validateGeneratorResult / validateGeneratedContentDraft, unchanged.
const READINESS_ASSESSMENT_OUTPUT_SCHEMA = Object.freeze({
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

// Ported from kaiEvidenceSummaryDraftGenerator.js's tagGeneratorResultReason:
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

export function createProductionReadinessAssessmentDraftGenerator({
  createMessage = (payload) => anthropic.messages.create(payload),
} = {}) {
  return async function draftGenerator(generatorInput) {
    if (
      generatorInput?.contentType !== CONTENT_TYPE
      || generatorInput?.requestedAudience !== REQUESTED_AUDIENCE
      || !Array.isArray(generatorInput.claims)
      || !Array.isArray(generatorInput.readiness?.requirements)
    ) {
      return tagGeneratorResultReason({ blocks: [] }, GENERATOR_RESULT_REASONS.INPUT_CONTRACT_REJECTED);
    }

    const response = await createMessage({
      model: MODEL,
      max_tokens: 1800,
      system: [
        "You generate internal readiness assessment drafts for Get Kinder.",
        "Use only the supplied authoritative requirements-readiness state and governed claim projection.",
        "Every block must cite at least one supplied claim/evidence pair.",
        "Do not determine, change, or override requirement applicability, requirement status, coverage status, human acceptance, evidence eligibility, review state, readiness status, blockers, or gaps.",
        "Describe missing or blocked requirements as gaps only; never convert them into positive readiness assertions.",
        "Do not add numbers, percentages, counts, or causal language unless they appear verbatim in a cited claim statement.",
        "If a claim carries limitationCodes or the readiness state contains gaps/blockers, reflect those limitations rather than stating readiness unconditionally.",
        "Never state or imply that this draft is approved, finalized, export-ready, or usable without human review.",
      ].join(" "),
      messages: [{
        role: "user",
        content: JSON.stringify({
          contentType: generatorInput.contentType,
          requestedAudience: generatorInput.requestedAudience,
          readiness: generatorInput.readiness,
          claims: generatorInput.claims,
        }),
      }],
      output_config: {
        format: {
          type: "json_schema",
          schema: READINESS_ASSESSMENT_OUTPUT_SCHEMA,
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

export const __readinessAssessmentDraftGeneratorContract = Object.freeze({
  CONTENT_TYPE,
  REQUESTED_AUDIENCE,
  MODEL,
  READINESS_ASSESSMENT_OUTPUT_SCHEMA,
});
