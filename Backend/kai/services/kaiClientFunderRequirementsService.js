import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES, KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { listRequirementCatalogueLabels } from "../db/kaiQueries.js";
import {
  readEngagementFunderRequirementsStateForAuthorizedCaller,
  __engagementContextServiceContract,
} from "./kaiEngagementContextService.js";
import { readCurrentEngagementRequirementAssessmentForAuthorizedCaller } from "./kaiEngagementRequirementAssessmentService.js";
import { __engagementFunderRequirementsCompositionServiceTestables } from "./kaiEngagementFunderRequirementsCompositionService.js";

/**
 * Client-safe Funder Requirements for one organization + engagement/project.
 * The GK composition (kaiEngagementFunderRequirementsCompositionService.js)
 * returns the applicability review rows (reviewed_by, reviewed_by_role,
 * reviewed_at, supersession ids, created_by_type, target snapshots) and each
 * requirement's persisted assessment (ids, GK explanation text, state
 * fingerprint, timestamps, evidence/claim/decision/gap provenance). Those
 * reads keep their GK role sets. This read computes the same governed result
 * and returns only its product meaning:
 *
 * - status: which of the classifier's states the engagement is in, with the
 *   not-applicable state split by its per-set applicability conclusions -
 *   "not_applicable" only when every authoritative set has a CURRENT
 *   reviewed not-applicable decision; any proposed, stale, superseded, or
 *   missing decision is "applicability_pending". A requirement appears only
 *   under a CURRENT_APPLICABLE set.
 * - per requirement: its catalogue label/description and a readiness value
 *   mapped one-to-one from the CURRENT engagement-scope assessment state
 *   (the Package 3B live gate plus recompute-and-compare). A missing or
 *   stale assessment, or a momentarily unconfirmed gate, is
 *   "not_yet_assessed" (the composition's own absent codes); every other
 *   failure fails the read closed, as the GK composition does.
 * - target: the engagement's own requirement target, which is the
 *   organization's project configuration (already in the engagement DTO).
 *
 * Admission reuses the read_intake role set for an active same-org member,
 * then tenant validation, before any read. No assessment, applicability,
 * target, follow-up, or review authority is granted here.
 */
const CLIENT_FUNDER_REQUIREMENTS_OPERATION = "read_client_funder_requirements";
const CLIENT_FUNDER_REQUIREMENTS_ALLOWED_ROLES = new Set(KAI_SPRINT2_P0_OPERATION_ROLES.read_intake);
const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;
const { CLASSIFIER_STATES } = __engagementContextServiceContract;
const { ASSESSMENT_ABSENT_ERROR_CODES } = __engagementFunderRequirementsCompositionServiceTestables;

const CLIENT_FUNDER_REQUIREMENTS_STATUSES = Object.freeze({
  noTarget: "no_target",
  noRequirementSet: "no_requirement_set",
  notApplicable: "not_applicable",
  applicabilityPending: "applicability_pending",
  applicable: "applicable",
});

// One-to-one with REQUIREMENT_ASSESSMENT_STATES (every assessment rule uses
// exactly these four), plus the absence of a current assessment.
const CLIENT_READINESS_BY_ASSESSMENT_STATE = Object.freeze({
  satisfied: "met",
  partially_satisfied: "partially_met",
  not_satisfied: "not_met",
  needs_review: "in_review",
});
const NOT_YET_ASSESSED = "not_yet_assessed";

const CLIENT_TARGET_FIELDS = Object.freeze([
  ["funderId", "target_funder_id"],
  ["framework", "target_framework"],
  ["grantProgram", "grant_program_identity"],
  ["report", "report_identity"],
  ["reportingTemplate", "reporting_template_identity"],
  ["reportingPeriodStart", "reporting_period_start"],
  ["reportingPeriodEnd", "reporting_period_end"],
]);

class ClientProjectionError extends Error {}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalUuid(value) {
  return typeof value === "string" && value === value.toLowerCase() && UUID_RE.test(value);
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && typeof actorContext?.actorUserId === "string" && actorContext.actorUserId.length > 0;
}

function isClientFunderRequirementsInput(value) {
  const allowedKeys = new Set(["organizationId", "engagementId", "actorContext"]);
  return (
    isPlainObject(value)
    && Object.keys(value).every((key) => allowedKeys.has(key))
    && isCanonicalUuid(value.organizationId)
    && isCanonicalUuid(value.engagementId)
    && isPlainObject(value.actorContext)
  );
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toClientTarget(target) {
  const source = isPlainObject(target) ? target : {};
  return Object.fromEntries(CLIENT_TARGET_FIELDS.map(([clientKey, key]) => [clientKey, stringOrNull(source[key])]));
}

function toClientReadiness(assessmentState) {
  if (!Object.hasOwn(CLIENT_READINESS_BY_ASSESSMENT_STATE, assessmentState)) {
    throw new ClientProjectionError("unrecognized assessment state");
  }
  return CLIENT_READINESS_BY_ASSESSMENT_STATE[assessmentState];
}

// The classifier's not-applicable state covers both "reviewed not
// applicable" and "not yet confirmed" rows; only a CURRENT reviewed
// not-applicable decision on every authoritative set is conclusive.
function notApplicableStatus(data) {
  const authoritativeSetIds = (data.authoritative_requirement_sets || []).map((set) => set.requirement_set_id);
  const rows = Array.isArray(data.applicability_rows) ? data.applicability_rows : [];
  const conclusivelyNotApplicable =
    authoritativeSetIds.length > 0
    && authoritativeSetIds.every((setId) => rows.some(
      (row) => row.requirement_set_id === setId && row.applicability_conclusion === "CURRENT_NOT_APPLICABLE",
    ));
  return conclusivelyNotApplicable
    ? CLIENT_FUNDER_REQUIREMENTS_STATUSES.notApplicable
    : CLIENT_FUNDER_REQUIREMENTS_STATUSES.applicabilityPending;
}

function statusForState(data) {
  switch (data.state) {
    case CLASSIFIER_STATES.noTargetSelected:
      return CLIENT_FUNDER_REQUIREMENTS_STATUSES.noTarget;
    case CLASSIFIER_STATES.targetSelectedNoAuthoritativeRequirementSet:
      return CLIENT_FUNDER_REQUIREMENTS_STATUSES.noRequirementSet;
    case CLASSIFIER_STATES.authoritativeRequirementSetNotApplicable:
      return notApplicableStatus(data);
    case CLASSIFIER_STATES.applicableRequirementSetAssessmentNotAvailable:
      return CLIENT_FUNDER_REQUIREMENTS_STATUSES.applicable;
    default:
      throw new ClientProjectionError("unrecognized classifier state");
  }
}

export async function getClientFunderRequirements(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isClientFunderRequirementsInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext, organizationId, engagementId } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    CLIENT_FUNDER_REQUIREMENTS_OPERATION,
    organizationId,
    { allowedRoles: CLIENT_FUNDER_REQUIREMENTS_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
  });
  // The engagement itself is tenant-checked against its own record inside
  // readEngagementFunderRequirementsStateForAuthorizedCaller.
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const readState = dependencies.readEngagementFunderRequirementsState || readEngagementFunderRequirementsStateForAuthorizedCaller;
  const readAssessment =
    dependencies.readCurrentEngagementRequirementAssessment || readCurrentEngagementRequirementAssessmentForAuthorizedCaller;
  const readLabels = dependencies.listRequirementCatalogueLabels || listRequirementCatalogueLabels;

  const stateResult = await readState({ organizationId, engagementId }, dependencies);
  if (!stateResult.ok) return stateResult;
  const data = stateResult.data;

  try {
    const status = statusForState(data);
    const target = toClientTarget(data.target);
    if (status !== CLIENT_FUNDER_REQUIREMENTS_STATUSES.applicable) {
      return { ok: true, data: { engagementId, status, target, requirementSets: [] }, error: null };
    }

    const applicableSets = Array.isArray(data.applicable_requirement_sets) ? data.applicable_requirement_sets : [];
    const requirementIds = applicableSets.flatMap((set) => (Array.isArray(set.requirements) ? set.requirements : []).map((r) => r.requirement_id));
    const labelRows = await readLabels({ requirementIds });
    const labelById = new Map(labelRows.map((row) => [row.requirement_id, row]));

    const requirementSets = [];
    for (const set of applicableSets) {
      const requirements = [];
      let setLabels = null;
      for (const requirement of Array.isArray(set.requirements) ? set.requirements : []) {
        const label = labelById.get(requirement.requirement_id);
        if (!label || label.requirement_set_id !== set.requirement_set_id) {
          throw new ClientProjectionError("requirement catalogue label missing");
        }
        setLabels ||= label;
        const assessment = await readAssessment(
          { organizationId, engagementId, requirementId: requirement.requirement_id },
          dependencies,
        );
        let readiness;
        if (assessment.ok) {
          readiness = toClientReadiness(assessment.data?.assessment?.assessment_state);
        } else if (ASSESSMENT_ABSENT_ERROR_CODES.has(assessment.error?.code)) {
          readiness = NOT_YET_ASSESSED;
        } else {
          return buildKaiError(assessment.error?.code || "system_error");
        }
        requirements.push({
          requirementId: requirement.requirement_id,
          label: stringOrNull(label.requirement_label),
          description: stringOrNull(label.requirement_description),
          readiness,
        });
      }
      requirementSets.push({
        requirementSetId: set.requirement_set_id,
        name: stringOrNull(setLabels?.set_name),
        funderName: stringOrNull(setLabels?.source_name),
        frameworkName: stringOrNull(setLabels?.framework_name),
        versionLabel: stringOrNull(setLabels?.version_label),
        requirements,
      });
    }

    return { ok: true, data: { engagementId, status, target, requirementSets }, error: null };
  } catch (error) {
    if (error instanceof ClientProjectionError) return buildKaiError("system_error");
    throw error;
  }
}

export const __clientFunderRequirementsServiceContract = Object.freeze({
  CLIENT_FUNDER_REQUIREMENTS_OPERATION,
  CLIENT_FUNDER_REQUIREMENTS_ALLOWED_ROLES,
  CLIENT_FUNDER_REQUIREMENTS_STATUSES,
  CLIENT_READINESS_BY_ASSESSMENT_STATE,
  NOT_YET_ASSESSED,
});
