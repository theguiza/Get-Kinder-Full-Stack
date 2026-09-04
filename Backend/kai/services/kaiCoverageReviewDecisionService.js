import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresCoverageReviewDecisionRepository } from "../dictionary/postgresCoverageReviewDecisionRepository.js";
import {
  COVERAGE_REVIEW_DECISION_ROLE,
  isCoverageReviewDimensionKey,
} from "../validators/kaiCoverageReviewDecisionValidators.js";

/**
 * KAI P2-10 owner-policy service: the only routes allowed to create coverage
 * decisions. Exactly one role - `gk_reviewer` - may perform these operations;
 * `gk_operator`, `gk_admin`,
 * client actors, `system`, `assistant`, import, and code actors are all
 * denied, by construction of `ACCEPT_INTERNAL_COVERAGE_LIMITATION_ALLOWED_ROLES`
 * never including any of them.
 */
const ACCEPT_INTERNAL_COVERAGE_LIMITATION_ALLOWED_ROLES = new Set([COVERAGE_REVIEW_DECISION_ROLE]);
const ACCEPT_INTERNAL_COVERAGE_LIMITATION_OPERATION = "accept_internal_coverage_limitation";
const ACCEPT_FUNDER_COVERAGE_LIMITATION_OPERATION = "accept_funder_coverage_limitation";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function isAcceptInternalCoverageLimitationInput(value) {
  const allowedKeys = new Set(["organizationId", "claimId", "dimensionKey", "actorContext", "now"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.claimId) &&
    isCoverageReviewDimensionKey(value.dimensionKey) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

export async function acceptInternalCoverageLimitation(input, dependencies = {}) {
  return acceptCoverageLimitation(input, dependencies, {
    operation: ACCEPT_INTERNAL_COVERAGE_LIMITATION_OPERATION,
    repositoryMethod: "acceptInternalCoverageLimitation",
  });
}

export async function acceptFunderCoverageLimitation(input, dependencies = {}) {
  return acceptCoverageLimitation(input, dependencies, {
    operation: ACCEPT_FUNDER_COVERAGE_LIMITATION_OPERATION,
    repositoryMethod: "acceptFunderCoverageLimitation",
  });
}

async function acceptCoverageLimitation(input, dependencies, { operation, repositoryMethod }) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isAcceptInternalCoverageLimitationInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    operation,
    input.organizationId,
    { allowedRoles: ACCEPT_INTERNAL_COVERAGE_LIMITATION_ALLOWED_ROLES },
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

  const repository = dependencies.coverageReviewDecisionRepository || createPostgresCoverageReviewDecisionRepository();
  const result = await repository[repositoryMethod]({
    organizationId: input.organizationId,
    claimId: input.claimId,
    dimensionKey: input.dimensionKey,
    actorUserId: actorContext.actorUserId,
    actorRole: COVERAGE_REVIEW_DECISION_ROLE,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __coverageReviewDecisionServiceContract = Object.freeze({
  ACCEPT_INTERNAL_COVERAGE_LIMITATION_ALLOWED_ROLES,
  ACCEPT_INTERNAL_COVERAGE_LIMITATION_OPERATION,
  ACCEPT_FUNDER_COVERAGE_LIMITATION_OPERATION,
});

export const __coverageReviewDecisionServiceTestables = Object.freeze({
  isAcceptInternalCoverageLimitationInput,
  isMappedHumanActor,
});
