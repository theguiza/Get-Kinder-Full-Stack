/**
 * A2.2 derived-analysis layer. Every function here is pure and reads only the
 * already-validated, already-persisted fields of one A1.3 criterion result
 * (`criterionId`/`criterionKey`/`criterionLabel`/`assessmentState`/
 * `safeExplanation`/`limitationNotes`) plus the fixed A1.3 assessment-state
 * vocabulary. Nothing here queries the database, calls the AI seam, or writes
 * anything: the "impact gap" and "measurement recommendation" it returns are
 * a structured, in-memory consequence of a persisted evaluation, not a new
 * persisted object, and are explicitly advisory -- never evidence, a claim, a
 * requirement, or a review decision.
 */

const INTERPRETATION_TEMPLATES = Object.freeze({
  supported: "This criterion is supported by the currently governed evidence.",
  supported_with_limitation:
    "This criterion is supported by the currently governed evidence, subject to a stated limitation.",
  not_supported: "The currently governed evidence does not support this criterion.",
  needs_more_information: "The currently governed evidence is insufficient to assess this criterion.",
  not_applicable: "This criterion does not apply to the current outcome context.",
});

// Only these two assessment states describe an unresolved shortfall in what
// the governed evidence currently shows for a criterion -- 'not_applicable'
// means the criterion does not apply (no gap), and 'supported' /
// 'supported_with_limitation' mean the criterion is currently satisfied (no
// gap). This is a read of the existing, closed A1.3 assessment_state
// vocabulary; it defines no new state and persists nothing.
const GAP_ASSESSMENT_STATES = new Set(["not_supported", "needs_more_information"]);

const GAP_REASON_TEMPLATES = Object.freeze({
  not_supported: "The currently governed evidence does not support this criterion.",
  needs_more_information: "The currently governed evidence is insufficient to assess this criterion.",
});

const RECOMMENDATION_TEMPLATES = Object.freeze({
  not_supported:
    "Consider collecting additional governed evidence that directly supports this outcome for this stakeholder before relying on this criterion.",
  needs_more_information:
    "Collect additional governed evidence, or clarify existing governed evidence, before this criterion can be assessed.",
});

// A2.3: the Package A "what" criterion (see A1.2's migration comment on
// kai.impact_evaluation_criteria -- the six Package-A keys are ordinary data,
// never a schema-enforced vocabulary) is specifically "what changed" for the
// stakeholder -- the participant OUTCOME, as distinct from OUTPUT/REACH
// criteria like "who" or "how_much". When a framework version happens to
// define a "what" criterion and its persisted result carries a gap, these
// overrides give a more specific, still-deterministic gap/recommendation
// text than the generic per-state templates above. Every other criterion key
// (including a framework version that defines no "what" criterion at all)
// falls straight through to the generic templates -- this is purely
// additive, never a replacement of the generic per-state behavior already
// covered by A2.2's tests.
const CRITERION_SPECIFIC_GAP_REASONS = Object.freeze({
  what: Object.freeze({
    not_supported: "Outcome-change evidence is absent.",
    needs_more_information: "Outcome-change evidence is absent.",
  }),
});

const CRITERION_SPECIFIC_RECOMMENDATIONS = Object.freeze({
  what: Object.freeze({
    not_supported:
      "Define/confirm the intended participant outcome, associate an appropriate indicator, and establish follow-up measurement.",
    needs_more_information:
      "Define/confirm the intended participant outcome, associate an appropriate indicator, and establish follow-up measurement.",
  }),
});

function interpretationFor(assessmentState) {
  return INTERPRETATION_TEMPLATES[assessmentState] || null;
}

function gapReasonFor(result) {
  return CRITERION_SPECIFIC_GAP_REASONS[result.criterionKey]?.[result.assessmentState]
    || GAP_REASON_TEMPLATES[result.assessmentState];
}

function recommendationFor(gap) {
  return CRITERION_SPECIFIC_RECOMMENDATIONS[gap.criterionKey]?.[gap.assessmentState]
    || RECOMMENDATION_TEMPLATES[gap.assessmentState];
}

/**
 * One derived interpretation per persisted criterion result: a fixed,
 * deterministic template keyed only by the closed assessment_state
 * vocabulary, carried alongside (never replacing) the model's own
 * already-validated safeExplanation.
 */
export function buildDerivedInterpretation(result) {
  return {
    criterionId: result.criterionId,
    criterionKey: result.criterionKey,
    assessmentState: result.assessmentState,
    interpretation: interpretationFor(result.assessmentState),
    safeExplanation: result.safeExplanation,
    limitationNotes: result.limitationNotes,
  };
}

/**
 * A derived impact gap for one persisted criterion result, or null when that
 * result's assessment_state carries no gap. Never a gap_log_items row, never
 * persisted -- a structured read of the evaluation that was just written.
 */
export function buildDerivedImpactGap(result) {
  if (!GAP_ASSESSMENT_STATES.has(result.assessmentState)) return null;
  return {
    kind: "impact_evaluation_gap",
    criterionId: result.criterionId,
    criterionKey: result.criterionKey,
    criterionLabel: result.criterionLabel,
    assessmentState: result.assessmentState,
    gapReason: gapReasonFor(result),
  };
}

/**
 * An advisory measurement recommendation for one derived impact gap.
 * `advisory: true` is load-bearing: this is analysis a human may act on, not
 * evidence, a claim, a funder/baseline requirement, or a review decision.
 */
export function buildMeasurementRecommendation(gap) {
  if (!gap) return null;
  return {
    kind: "measurement_recommendation",
    advisory: true,
    criterionId: gap.criterionId,
    criterionKey: gap.criterionKey,
    assessmentState: gap.assessmentState,
    recommendation: recommendationFor(gap),
  };
}

// A2.3: which persisted criterion carries the participant OUTCOME/CHANGE
// question, for the sole purpose of deriving a REACH-vs-OUTCOME
// classification label below. Reusing the same "what" key as the gap/
// recommendation overrides above -- not a new vocabulary, just naming which
// existing criterion_key this derivation reads.
const OUTCOME_CRITERION_KEY = "what";
const SATISFIED_ASSESSMENT_STATES = new Set(["supported", "supported_with_limitation"]);

/**
 * A purely derived, non-persisted classification over one evaluation's
 * results: "OUTCOME" when the "what" (outcome/change) criterion is itself
 * supported (with or without a stated limitation), "OUTPUT_REACH" when it
 * carries a gap (not_supported / needs_more_information) or is not
 * applicable, and null when the selected framework version defines no "what"
 * criterion to read in the first place. This never overrides or replaces any
 * persisted assessment_state -- it only summarizes the ones already written.
 */
export function classifyImpactEvaluation(results) {
  const outcomeResult = (results || []).find((result) => result.criterionKey === OUTCOME_CRITERION_KEY);
  if (!outcomeResult) return null;
  return {
    classification: SATISFIED_ASSESSMENT_STATES.has(outcomeResult.assessmentState) ? "OUTCOME" : "OUTPUT_REACH",
    criterionKey: OUTCOME_CRITERION_KEY,
    assessmentState: outcomeResult.assessmentState,
  };
}

/**
 * Runs the full derived-interpretation -> derived-gap -> recommendation
 * chain over every persisted criterion result of one evaluation. `gaps` and
 * `recommendations` only ever contain entries for results whose
 * assessment_state carries a gap.
 */
export function buildDerivedImpactAnalysis(results) {
  const interpretations = (results || []).map(buildDerivedInterpretation);
  const gaps = (results || []).map(buildDerivedImpactGap).filter(Boolean);
  const recommendations = gaps.map(buildMeasurementRecommendation).filter(Boolean);
  const classification = classifyImpactEvaluation(results);
  return { interpretations, gaps, recommendations, classification };
}

export const __impactEvaluationInterpretationContract = Object.freeze({
  GAP_ASSESSMENT_STATES,
  OUTCOME_CRITERION_KEY,
});
