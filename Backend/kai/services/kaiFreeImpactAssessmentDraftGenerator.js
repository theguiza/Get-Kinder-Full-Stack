import Anthropic from "@anthropic-ai/sdk";

import {
  GENERATOR_RESULT_REASON,
  GENERATOR_RESULT_REASONS,
} from "../dictionary/postgresGeneratedContentRepository.js";
import {
  FREE_IMPACT_ASSESSMENT_COMPOSITION,
  MODEL_SECTION_KEYS,
  withAssessmentSection,
} from "./kaiFreeImpactAssessmentComposition.js";

/**
 * Model adapter for the Free Impact Assessment's model-written sections
 * (kaiFreeImpactAssessmentComposition.js). It is the same provider call,
 * bounded JSON output and result-reason tagging as the Evidence Summary
 * adapter; each returned block names its section, and the adapter writes the
 * section marker. The server composes the gaps list, the three proposed
 * improvements and the next steps, and every block then passes the same
 * contract and VAL-GEN validators as any internal Evidence Summary.
 */
const CONTENT_TYPE = "evidence_summary";
const REQUESTED_AUDIENCE = "internal";
const MODEL = "claude-haiku-4-5-20251001";

const FREE_IMPACT_ASSESSMENT_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["blocks"],
  additionalProperties: false,
  properties: {
    blocks: {
      type: "array",
      items: {
        type: "object",
        required: ["section", "text", "citations"],
        additionalProperties: false,
        properties: {
          section: { type: "string", enum: [...MODEL_SECTION_KEYS] },
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

const SYSTEM_PROMPT = [
  "You write the first sections of an internal Free Impact Assessment for Get Kinder, for the organization's own planning.",
  "Use only the supplied governed claim projection and assessment context; never use outside knowledge.",
  "Return blocks for these sections, in this order: executive_snapshot (one short block naming the main things the evidence shows),",
  "evidence_findings (one block per related group of findings, grouping claims that carry the same limitationCodes),",
  "impact_stories (a source-backed account of the programme drawn from the cited document statements),",
  "and optionally gaps_opportunities (what the evidence does not yet show). The server adds the documented gaps, three proposed improvements and next steps; do not write recommendations.",
  "Every block must cite at least one supplied claim/evidence pair, and only the claims it relies on.",
  "Name indicators by the human-stated label at the start of a claim statement; never write internal field keys such as field_1.",
  "Do not add numbers, percentages or counts unless they appear verbatim in a cited claim statement, and keep each number's unit, period and population as the claim states it.",
  "Never state or imply causation or effect, and avoid words such as impact, improve, increase, reduce, because, due to, leads to or results in.",
  "Do not describe a value as verified; source-reported statements stay source-reported.",
  "participantStoryEvidence is none_cited: do not invent, paraphrase or attribute a participant story or quotation; quote only words that appear in a cited claim statement.",
  "Do not repeat limitation disclosures: the server appends each measured claim's disclosure to the block that cites it.",
  "Never state or imply that this draft is approved, final or ready for funder or public use.",
].join(" ");

const anthropic = new Anthropic();

function tagGeneratorResultReason(result, reason) {
  Object.defineProperty(result, GENERATOR_RESULT_REASON, { value: reason, enumerable: false, configurable: true });
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
          text: typeof block?.text === "string" && MODEL_SECTION_KEYS.includes(block?.section)
            ? withAssessmentSection(block.section, block.text)
            : typeof block?.text === "string" ? block.text : "",
          citations: Array.isArray(block?.citations)
            ? block.citations.map((citation) => ({ claimId: citation?.claimId, evidenceItemId: citation?.evidenceItemId }))
            : [],
        }))
      : [],
  };
}

export function createProductionFreeImpactAssessmentDraftGenerator({
  createMessage = (payload) => anthropic.messages.create(payload),
} = {}) {
  return async function draftGenerator(generatorInput) {
    if (
      generatorInput?.contentType !== CONTENT_TYPE
      || generatorInput?.requestedAudience !== REQUESTED_AUDIENCE
      || !Array.isArray(generatorInput.claims)
      || generatorInput.assessment?.composition !== FREE_IMPACT_ASSESSMENT_COMPOSITION
    ) {
      return tagGeneratorResultReason({ blocks: [] }, GENERATOR_RESULT_REASONS.INPUT_CONTRACT_REJECTED);
    }

    const response = await createMessage({
      model: MODEL,
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: JSON.stringify({
          contentType: generatorInput.contentType,
          requestedAudience: generatorInput.requestedAudience,
          assessment: generatorInput.assessment,
          claims: generatorInput.claims,
        }),
      }],
      output_config: { format: { type: "json_schema", schema: FREE_IMPACT_ASSESSMENT_OUTPUT_SCHEMA } },
    });

    const text = extractText(response);
    if (text.length === 0) return tagGeneratorResultReason(normalizeGeneratorOutput(null), GENERATOR_RESULT_REASONS.PROVIDER_TEXT_MISSING);
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

export const __freeImpactAssessmentDraftGeneratorContract = Object.freeze({
  CONTENT_TYPE,
  REQUESTED_AUDIENCE,
  MODEL,
  FREE_IMPACT_ASSESSMENT_OUTPUT_SCHEMA,
  SYSTEM_PROMPT,
});
