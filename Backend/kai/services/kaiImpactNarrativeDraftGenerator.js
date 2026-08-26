import Anthropic from "@anthropic-ai/sdk";

const CONTENT_TYPE = "impact_narrative";
const REQUESTED_AUDIENCE = "internal";
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

export function createProductionImpactNarrativeDraftGenerator({
  createMessage = (payload) => anthropic.messages.create(payload),
} = {}) {
  return async function draftGenerator(generatorInput) {
    if (
      generatorInput?.contentType !== CONTENT_TYPE
      || generatorInput?.requestedAudience !== REQUESTED_AUDIENCE
      || !Array.isArray(generatorInput.claims)
    ) {
      return { blocks: [] };
    }

    const response = await createMessage({
      model: MODEL,
      max_tokens: 1600,
      system: [
        "You generate internal impact narratives for Get Kinder.",
        "Use only the supplied governed claim projection -- do not use outside knowledge.",
        "Return strict JSON only, with shape: {\"blocks\":[{\"text\":\"...\",\"citations\":[{\"claimId\":\"...\",\"evidenceItemId\":\"...\"}]}]}.",
        "Every block must cite at least one supplied claim/evidence pair.",
        "Write narrative prose, not a bulleted list of facts.",
        "Do not add numbers, percentages, or counts unless they appear verbatim in a cited claim statement.",
        "Do not state or imply causation; describe only what a cited claim actually asserts.",
        "If a claim carries limitationCodes, the narrative must reflect that limitation rather than stating the claim as an unconditional fact.",
        "Never state or imply that a claim has been reviewed, approved, or is export-eligible -- this is an unreviewed internal draft.",
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

export const __impactNarrativeDraftGeneratorContract = Object.freeze({
  CONTENT_TYPE,
  REQUESTED_AUDIENCE,
  MODEL,
});
