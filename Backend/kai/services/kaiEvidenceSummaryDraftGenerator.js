import Anthropic from "@anthropic-ai/sdk";

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

const anthropic = new Anthropic();

function parseJsonObject(text) {
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
      return { blocks: [] };
    }

    const response = await createMessage({
      model: MODEL,
      max_tokens: 1200,
      system: [
        generatorInput.requestedAudience === FUNDER_REQUESTED_AUDIENCE
          ? "You generate funder-facing evidence summaries for Get Kinder."
          : "You generate internal evidence summaries for Get Kinder.",
        "Use only the supplied governed claim projection.",
        "Return strict JSON only, with shape: {\"blocks\":[{\"text\":\"...\",\"citations\":[{\"claimId\":\"...\",\"evidenceItemId\":\"...\"}]}]}.",
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
    });

    return normalizeGeneratorOutput(parseJsonObject(extractText(response)));
  };
}

export const __evidenceSummaryDraftGeneratorContract = Object.freeze({
  CONTENT_TYPE,
  REQUESTED_AUDIENCE,
  FUNDER_REQUESTED_AUDIENCE,
  ALLOWED_REQUESTED_AUDIENCES,
  MODEL,
});
