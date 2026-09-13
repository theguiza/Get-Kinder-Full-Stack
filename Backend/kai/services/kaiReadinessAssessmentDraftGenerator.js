import Anthropic from "@anthropic-ai/sdk";

const CONTENT_TYPE = "readiness_assessment";
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
      return { blocks: [] };
    }

    const response = await createMessage({
      model: MODEL,
      max_tokens: 1800,
      system: [
        "You generate internal readiness assessment drafts for Get Kinder.",
        "Use only the supplied authoritative requirements-readiness state and governed claim projection.",
        "Return strict JSON only, with shape: {\"blocks\":[{\"text\":\"...\",\"citations\":[{\"claimId\":\"...\",\"evidenceItemId\":\"...\"}]}]}.",
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
    });

    return normalizeGeneratorOutput(parseJsonObject(extractText(response)));
  };
}

export const __readinessAssessmentDraftGeneratorContract = Object.freeze({
  CONTENT_TYPE,
  REQUESTED_AUDIENCE,
  MODEL,
});
