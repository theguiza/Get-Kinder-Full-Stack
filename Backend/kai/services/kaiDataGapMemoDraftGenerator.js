import Anthropic from "@anthropic-ai/sdk";

const CONTENT_TYPE = "data_gap_memo";
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
      return { blocks: [] };
    }

    const response = await createMessage({
      model: MODEL,
      max_tokens: 1800,
      system: [
        "You generate internal Data Gap Memo drafts for Get Kinder.",
        "Use only the supplied authoritative current evidence-gap items and governed claim projection.",
        "Return strict JSON only, with shape: {\"blocks\":[{\"text\":\"...\",\"citations\":[{\"claimId\":\"...\",\"evidenceItemId\":\"...\"}]}]}.",
        "Every block must cite at least one supplied claim/evidence pair.",
        "Do not determine, change, or override whether a gap is current, whether a condition is a gap, claim eligibility, requirement satisfaction, readiness, review status, or approval.",
        "Treat every supplied gap item, including resolved_risk_flagged, as part of the current gap input.",
        "Describe missing support, unresolved conditions, risk-flagged conditions, limitations, uncertainty, or follow-up need only where supported by supplied gap fields.",
        "Never convert a supplied gap, missing support, risk, or limitation into a positive support assertion.",
        "Do not add severity scores, priorities, percentages, metrics, requirement satisfaction, recommendations, or causal language unless it appears verbatim in a cited claim statement.",
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
    });

    return normalizeGeneratorOutput(parseJsonObject(extractText(response)));
  };
}

export const __dataGapMemoDraftGeneratorContract = Object.freeze({
  CONTENT_TYPE,
  REQUESTED_AUDIENCE,
  MODEL,
});
