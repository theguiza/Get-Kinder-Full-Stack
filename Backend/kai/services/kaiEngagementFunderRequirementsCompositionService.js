import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import { classifyEngagementFunderRequirementsState } from "./kaiEngagementContextService.js";
import { getEngagementRequirementAssessment } from "./kaiEngagementRequirementAssessmentService.js";

/**
 * KAI Package 4: the only composition read for the `/impact-library` Funder
 * Requirements card. It creates no new authority, applicability, or
 * assessment state of its own - it exclusively composes two already-governed
 * reads:
 *
 *  - Package 1B/2A/2B's `classifyEngagementFunderRequirementsState`
 *    (Backend/kai/services/kaiEngagementContextService.js): which of the four
 *    existing applicability states the selected engagement is currently in
 *    (`no_target_selected`, `target_selected_no_authoritative_requirement_set`,
 *    `authoritative_requirement_set_not_applicable`,
 *    `applicable_requirement_set_assessment_not_available`), and, for the
 *    last state, the exact governed external (never `kai_standard`)
 *    requirement sets/requirements currently reviewed+effective-applicable+
 *    unsuperseded+target-matched for this engagement.
 *  - Package 3A/3B's `getEngagementRequirementAssessment`: the CURRENT
 *    engagement-scoped assessment for exactly one requirement, gated on the
 *    identical live Package 2B applicability re-check the write path uses
 *    (`resolveEngagementApplicabilityGate`) - never the generic
 *    organization-scope (`engagement_id IS NULL`) assessment, and never a
 *    stale assessment whose governing applicability has since changed.
 *
 * Only requirements belonging to a CURRENTLY applicable requirement set are
 * ever looked up here; nothing outside `applicable_requirement_sets` from the
 * classifier is ever assessed. A single shared actor-context resolution is
 * used for the classify call and every per-requirement assessment read, so
 * every failure mode (authorization, tenant boundary, feature flag) is
 * resolved exactly once, with the identical actor, and fails the whole
 * composition closed rather than silently omitting a requirement's assessment.
 */

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isComposeInput(value) {
  const allowedKeys = new Set(["organizationId", "engagementId", "actorContext", "req"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (!isNonEmptyString(value.organizationId) || !isNonEmptyString(value.engagementId)) return false;
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

function actorError(actorResult) {
  if (actorResult.error_code === "mapped_kai_user_required") return buildKaiError("mapped_kai_user_required");
  return buildKaiError(actorResult.error_code || "unauthorized");
}

// Assessment-read failures that mean "no current assessment exists for this
// requirement right now" (never assessed, a stale/superseded fingerprint, or
// a momentarily-unconfirmed Package 2B gate) are rendered as
// `current_assessment: null` - a real product fact, not an error. Every
// other failure (authorization, tenant boundary, validation, feature flag,
// system error) fails the whole composition closed instead of silently
// dropping a requirement.
const ASSESSMENT_ABSENT_ERROR_CODES = new Set([
  "not_found",
  "engagement_requirement_applicability_not_confirmed",
]);

const APPLICABLE_STATE = "applicable_requirement_set_assessment_not_available";

export async function getEngagementFunderRequirementsForImpactLibrary(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isComposeInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);
  const { actorContext } = actorResult;

  const classify = dependencies.classifyEngagementFunderRequirementsState || classifyEngagementFunderRequirementsState;
  const readAssessment = dependencies.getEngagementRequirementAssessment || getEngagementRequirementAssessment;

  const classifyResult = await classify(
    { organizationId: input.organizationId, engagementId: input.engagementId, actorContext },
    dependencies,
  );
  if (!classifyResult.ok) return classifyResult;

  const data = classifyResult.data;
  const applicableRequirementSets = Array.isArray(data.applicable_requirement_sets)
    ? data.applicable_requirement_sets
    : [];

  if (data.state !== APPLICABLE_STATE || applicableRequirementSets.length === 0) {
    return {
      ok: true,
      data: { ...data, applicable_requirement_sets: applicableRequirementSets },
      error: null,
    };
  }

  const enrichedSets = [];
  for (const requirementSet of applicableRequirementSets) {
    const requirements = Array.isArray(requirementSet.requirements) ? requirementSet.requirements : [];
    const enrichedRequirements = [];
    for (const requirement of requirements) {
      const assessmentResult = await readAssessment(
        {
          organizationId: input.organizationId,
          engagementId: input.engagementId,
          requirementId: requirement.requirement_id,
          actorContext,
        },
        dependencies,
      );

      if (!assessmentResult.ok) {
        if (ASSESSMENT_ABSENT_ERROR_CODES.has(assessmentResult.error?.code)) {
          enrichedRequirements.push({ ...requirement, current_assessment: null });
          continue;
        }
        return assessmentResult;
      }
      enrichedRequirements.push({ ...requirement, current_assessment: assessmentResult.data });
    }
    enrichedSets.push({ ...requirementSet, requirements: enrichedRequirements });
  }

  return {
    ok: true,
    data: { ...data, applicable_requirement_sets: enrichedSets },
    error: null,
  };
}

export const __engagementFunderRequirementsCompositionServiceTestables = Object.freeze({
  isComposeInput,
  ASSESSMENT_ABSENT_ERROR_CODES,
  APPLICABLE_STATE,
});
