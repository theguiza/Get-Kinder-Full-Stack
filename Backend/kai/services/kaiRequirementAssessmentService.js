import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresRequirementAssessmentRepository } from "../dictionary/postgresRequirementAssessmentRepository.js";
import { createProductionMetadataOnlyAuditForRequirementAssessment } from "./kaiMetadataOnlyAuditComposition.js";

/**
 * KAI C3.A2 requirement-assessment service: the only route to
 * create/replay an organization-scope assessment of `ir_contrib_002`
 * (write) or read its current governed state back (read). Mirrors
 * `kaiCoverageReviewDecisionService.js`'s gate order for the write path
 * (isKaiSprint2Enabled -> input shape -> isMappedHumanActor ->
 * validateActorCanPerformOperation with an explicit allowedRoles override
 * -> validateTenantBoundaryConsistency) and `kaiClaimTraceabilityService.js`'s
 * identical read-only seam for the read path. Least-privilege role choice
 * (documented, following the CLAIM_TRACEABILITY_ALLOWED_ROLES vs
 * ACCEPT_INTERNAL_COVERAGE_LIMITATION_ALLOWED_ROLES precedent): creating or
 * replaying an assessment is a write, so it is restricted to `gk_reviewer`
 * and `gk_admin` (never the broader read-only `gk_operator`); reading the
 * governed assessment back is allowed for `gk_reviewer`, `gk_operator`, and
 * `gk_admin`, exactly like the P2-06 claim-traceability read.
 */
const ASSESS_REQUIREMENT_ALLOWED_ROLES = new Set(["gk_reviewer", "gk_admin"]);
const ASSESS_REQUIREMENT_OPERATION = "assess_requirement_organization_scope";
const READ_REQUIREMENT_ASSESSMENT_ALLOWED_ROLES = new Set(["gk_reviewer", "gk_operator", "gk_admin"]);
const READ_REQUIREMENT_ASSESSMENT_OPERATION = "read_requirement_assessment";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function isAssessOrganizationRequirementInput(value) {
  const allowedKeys = new Set(["organizationId", "requirementId", "actorContext", "now"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.requirementId) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

function isGetOrganizationRequirementAssessmentInput(value) {
  const allowedKeys = new Set(["organizationId", "requirementId", "actorContext"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.requirementId) &&
    isPlainObject(value.actorContext)
  );
}

export async function assessOrganizationRequirement(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isAssessOrganizationRequirementInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    ASSESS_REQUIREMENT_OPERATION,
    input.organizationId,
    { allowedRoles: ASSESS_REQUIREMENT_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const repository = dependencies.requirementAssessmentRepository || createPostgresRequirementAssessmentRepository();
  const metadataOnlyAudit = dependencies.metadataOnlyAudit || createProductionMetadataOnlyAuditForRequirementAssessment({
    organizationId: input.organizationId,
    requirementId: input.requirementId,
    actorContext,
    now: input.now,
  });

  const result = await repository.assessOrganizationRequirement({
    organizationId: input.organizationId,
    requirementId: input.requirementId,
    actorUserId: actorContext.actorUserId,
    actorRole: [...ASSESS_REQUIREMENT_ALLOWED_ROLES].find((role) =>
      (actorContext.kaiRoles || []).includes(role) ||
      (actorContext.organizationMemberships || []).some((membership) => membership.role_name === role),
    ) || "gk_reviewer",
    now: input.now,
    metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export async function getOrganizationRequirementAssessment(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isGetOrganizationRequirementAssessmentInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    READ_REQUIREMENT_ASSESSMENT_OPERATION,
    input.organizationId,
    { allowedRoles: READ_REQUIREMENT_ASSESSMENT_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const repository = dependencies.requirementAssessmentRepository || createPostgresRequirementAssessmentRepository();
  const result = await repository.readOrganizationRequirementAssessment({
    organizationId: input.organizationId,
    requirementId: input.requirementId,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __requirementAssessmentServiceContract = Object.freeze({
  ASSESS_REQUIREMENT_ALLOWED_ROLES,
  ASSESS_REQUIREMENT_OPERATION,
  READ_REQUIREMENT_ASSESSMENT_ALLOWED_ROLES,
  READ_REQUIREMENT_ASSESSMENT_OPERATION,
});

export const __requirementAssessmentServiceTestables = Object.freeze({
  isAssessOrganizationRequirementInput,
  isGetOrganizationRequirementAssessmentInput,
  isMappedHumanActor,
});
