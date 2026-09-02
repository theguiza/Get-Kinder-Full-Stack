import Anthropic from "@anthropic-ai/sdk";

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
    results: Array.isArray(parsed?.results)
      ? parsed.results.map((result) => ({
          criterionId: result?.criterionId,
          assessmentState: result?.assessmentState,
          safeExplanation: typeof result?.safeExplanation === "string" ? result.safeExplanation : "",
          limitationNotes: typeof result?.limitationNotes === "string" ? result.limitationNotes : null,
          claimIds: Array.isArray(result?.claimIds) ? result.claimIds : [],
          evidenceItemIds: Array.isArray(result?.evidenceItemIds) ? result.evidenceItemIds : [],
        }))
      : [],
  };
}

/**
 * A2.1 AI seam. This function only calls the model and reshapes its raw text
 * into a candidate result list -- it never queries or writes kai.* tables and
 * never decides eligibility, approval, or persistence. Every value it returns
 * is untrusted until postgresImpactEvaluationRepository.js revalidates it
 * against the server-supplied criteria and governed evidence/claim ids.
 */
export function createProductionImpactEvaluationGenerator({
  createMessage = (payload) => anthropic.messages.create(payload),
} = {}) {
  return async function impactEvaluationGenerator(generatorInput) {
    if (
      !Array.isArray(generatorInput?.criteria) ||
      generatorInput.criteria.length === 0 ||
      !Array.isArray(generatorInput?.governedEvidence)
    ) {
      return { results: [] };
    }

    const response = await createMessage({
      model: MODEL,
      max_tokens: 2000,
      system: [
        "You evaluate governed impact evidence against a fixed, server-supplied set of evaluation criteria for Get Kinder.",
        "Use only the supplied outcome context, framework, criteria, and governed claim/evidence projection -- never any other knowledge, assumption, or outside document.",
        "Return exactly one result per supplied criterion id, referencing only the supplied criterionId values -- never invent, omit, or duplicate a criterion id.",
        "Cite only the supplied claimId/evidenceItemId pairs; never invent an id.",
        "Return strict JSON only, with shape: {\"results\":[{\"criterionId\":\"...\",\"assessmentState\":\"supported|supported_with_limitation|not_supported|needs_more_information|not_applicable\",\"safeExplanation\":\"...\",\"limitationNotes\":null,\"claimIds\":[...],\"evidenceItemIds\":[...]}]}.",
        "limitationNotes must be a non-empty string when assessmentState is supported_with_limitation, and null for every other assessmentState.",
        "Do not add numbers or causal language unless it appears in a cited claim statement.",
      ].join(" "),
      messages: [{
        role: "user",
        content: JSON.stringify({
          outcomeContext: generatorInput.outcomeContext,
          framework: generatorInput.framework,
          criteria: generatorInput.criteria,
          governedEvidence: generatorInput.governedEvidence,
        }),
      }],
    });

    return normalizeGeneratorOutput(parseJsonObject(extractText(response)));
  };
}

export const __impactEvaluationGeneratorContract = Object.freeze({
  MODEL,
});
