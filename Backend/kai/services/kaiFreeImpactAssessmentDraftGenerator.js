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
 * section marker. The server composes the gaps list, up to three proposed
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
  "You write the first sections of an internal evidence assessment for Get Kinder, for the organization's own planning.",
  "Use only the supplied governed claim projection and assessment context; never use outside knowledge.",
  "Return blocks for these sections, in this order, using the section keys exactly: executive_snapshot (one short block naming the main things the evidence records),",
  "evidence_findings (one block per related group of findings, grouping claims that carry the same limitationCodes),",
  "impact_stories (a source-backed account of the programme drawn from the cited document statements; the key is an identifier, not a description),",
  "and optionally gaps_opportunities (what the evidence does not yet show). The server adds the documented gaps, up to three proposed improvements and next steps; do not write recommendations.",
  "Every block must cite at least one supplied claim/evidence pair, and only the claims it relies on.",
  "Name an indicator by the human-stated label at the start of its claim statement. When the statement has no human label and begins with an internal field key such as field_6, name it by its column as the statement gives it (for example \"the numeric outcome in column F\"); never write internal field keys and never invent a numbered name such as \"Outcome 1\" or \"Measure 2\".",
  "Every number in a block, including percentages, must appear exactly as written in a claim statement that the same block cites: copy it character for character, never round, convert, total, average or compare it, and keep its unit, period and population as the claim states it. When a block mentions figures from several claims, cite each of those claims in that block. Write no other digits, dates, ordinals or list numbers.",
  "Describe what the evidence records, never what it caused: do not use impact, impacts, impacted, improve, improves, increase, increases, decrease, reduce, reduces, worsen, cause, because, due to, drive, driven by, leads to, led to, results in or attributable to, unless the cited claim statement itself uses that exact word.",
  "Interpret, do not only list: where the cited findings point to a meaningful pattern for the people or programme, state a qualified interpretation of what it may indicate (for example \"is consistent with\", \"suggests\" or \"may indicate\"), keep it within what the cited claims support, and say what further evidence would confirm it.",
  "Use every supplied claim, including findings that have not yet been reviewed; present those as provisional rather than leaving them out.",
  "A claim may carry plainReading: KAI's plain-language reading of that measurement, composed from its recorded values and the organization's own stated meaning, direction and evidence basis. Use it to say in ordinary words what was measured, who is included, what changed and what that suggests, and its practical implication; it is governed text, so its numbers and words may be used exactly as it gives them. When it states that whether a higher value is better has not been stated, report the change as a numerical change only and repeat its clarification; never present that change as progress or decline.",
  "Write for the organization's staff and board in ordinary nonprofit language: lead with what matters most (who was reached, what changed for participants on the outcomes the organization tracks, and what that suggests), not with field names, worksheet keys or validation codes.",
  "Do not describe a value as verified; source-reported statements stay source-reported.",
  "participantStoryEvidence is none_cited: do not invent, paraphrase or attribute a participant story or quotation; quote only words that appear in a cited claim statement.",
  "Do not repeat limitation disclosures: the server appends each measured claim's disclosure to the block that cites it.",
  "Never state or imply that this draft is approved, final or ready for funder or public use.",
  "If the input includes correction, your previous blocks were refused: correction.blocks names each refused block's position and section, what kind of wording was unsupported and the unsupported terms. Return a complete new set of blocks that keeps every rule above and contains none of those unsupported terms unless a claim the block cites states them exactly.",
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
          ...(generatorInput.correction ? { correction: generatorInput.correction } : {}),
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
