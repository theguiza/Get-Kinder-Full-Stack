import Anthropic from "@anthropic-ai/sdk";

import {
  GENERATOR_RESULT_REASON,
  GENERATOR_RESULT_REASONS,
} from "../dictionary/postgresGeneratedContentRepository.js";

const CONTENT_TYPE = "data_gap_memo";
const REQUESTED_AUDIENCE = "internal";
const MODEL = "claude-haiku-4-5-20251001";

// Ported from kaiEvidenceSummaryDraftGenerator.js's
// EVIDENCE_SUMMARY_OUTPUT_SCHEMA (P14-09-FUND-GEN-RESULT-001): bounded
// provider-side output schema mirroring only the shapes normalizeGeneratorOutput
// below already normalizes - it encodes no KAI governance (citation
// authorization, UUID validity, VAL-GEN rules, gap semantic validation,
// duplicate/text limits). Those checks remain downstream in
// validateGeneratorResult / validateGeneratedContentDraft, unchanged. Like
// the Evidence Summary precedent, this schema does not set a `blocks`
// minItems - the existing repository BLOCKS_EMPTY predicate already fails
// closed on an empty result, and the generation instruction below requires a
// non-empty result whenever the supplied authoritative gap set is non-empty.
const DATA_GAP_MEMO_OUTPUT_SCHEMA = Object.freeze({
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

export function createProductionDataGapMemoDraftGenerator({
  createMessage = (payload) => anthropic.messages.create(payload),
} = {}) {
  return async function draftGenerator(generatorInput) {
    if (
      generatorInput?.contentType !== CONTENT_TYPE
      || generatorInput?.requestedAudience !== REQUESTED_AUDIENCE
      || !Array.isArray(generatorInput.claims)
      || !Array.isArray(generatorInput.gaps?.items)
    ) {
      return tagGeneratorResultReason({ blocks: [] }, GENERATOR_RESULT_REASONS.INPUT_CONTRACT_REJECTED);
    }

    const response = await createMessage({
      model: MODEL,
      max_tokens: 1800,
      system: [
        "You generate internal Data Gap Memo drafts for Get Kinder.",
        "Use only the supplied authoritative current evidence-gap items and governed claim projection.",
        "Every block must cite at least one supplied claim/evidence pair.",
        "If the supplied authoritative gap items are non-empty, you must return at least one block describing them; never return an empty blocks array when gap items were supplied.",
        "Do not determine, change, or override whether a gap is current, whether a condition is a gap, claim eligibility, requirement satisfaction, readiness, review status, or approval.",
        "Treat every supplied gap item, including resolved_risk_flagged, as part of the current gap input.",
        "Describe missing support, unresolved conditions, risk-flagged conditions, limitations, uncertainty, or follow-up need only where supported by supplied gap fields.",
        "Never convert a supplied gap, missing support, risk, or limitation into a positive support assertion.",
        "Do not add numbers, dates, counts, ordinals, identifiers, validator keys, severity scores, priorities, percentages, metrics, requirement satisfaction, recommendations, or causal language unless it appears verbatim in a cited claim statement.",
        "Never state or imply that this draft is approved, finalized, export-ready, or usable without human review.",
      ].join(" "),
      messages: [{
        role: "user",
        content: JSON.stringify({
          contentType: generatorInput.contentType,
          requestedAudience: generatorInput.requestedAudience,
          gaps: generatorInput.gaps,
          claims: generatorInput.claims,
        }),
      }],
      output_config: {
        format: {
          type: "json_schema",
          schema: DATA_GAP_MEMO_OUTPUT_SCHEMA,
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

export const __dataGapMemoDraftGeneratorContract = Object.freeze({
  CONTENT_TYPE,
  REQUESTED_AUDIENCE,
  MODEL,
  DATA_GAP_MEMO_OUTPUT_SCHEMA,
});
