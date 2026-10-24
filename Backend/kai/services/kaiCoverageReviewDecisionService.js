import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import {
  validateActorCanPerformOperation,
  validateActorIsOrganizationAdministrator,
} from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresCoverageReviewDecisionRepository } from "../dictionary/postgresCoverageReviewDecisionRepository.js";
import {
  COVERAGE_REVIEW_DECISION_ROLE,
  isCoverageReviewDimensionKey,
} from "../validators/kaiCoverageReviewDecisionValidators.js";
import {
  ORGANIZATION_DECISION_ROLE,
  evaluateOrganizationCoverageAcceptanceInTransaction,
  organizationFactualReviewRefusal,
} from "../dictionary/postgresOrganizationFactualReviewRepository.js";

/**
 * KAI P2-10 owner-policy service: the only routes allowed to create coverage
 * decisions. Exactly one GK role - `gk_reviewer` - may perform these
 * operations; `gk_operator`, `gk_admin`, other client actors, `system`,
 * `assistant`, import, and code actors are all denied, by construction of
 * `ACCEPT_INTERNAL_COVERAGE_LIMITATION_ALLOWED_ROLES` never including any of
 * them. The one exception is the organization administrator's own internal
 * acceptance (ORGANIZATION_ACCEPTANCE_OPERATIONS below).
 */
const ACCEPT_INTERNAL_COVERAGE_LIMITATION_ALLOWED_ROLES = new Set([COVERAGE_REVIEW_DECISION_ROLE]);
const ACCEPT_INTERNAL_COVERAGE_LIMITATION_OPERATION = "accept_internal_coverage_limitation";
const ACCEPT_FUNDER_COVERAGE_LIMITATION_OPERATION = "accept_funder_coverage_limitation";
const ACCEPT_PUBLIC_COVERAGE_LIMITATION_OPERATION = "accept_public_coverage_limitation";
// Owner authorization 2026-10-24 (Operating Model v0.2 section 11
// exception): when the gk_reviewer authorization fails, an active
// client_admin of this organization (validateActorIsOrganizationAdministrator)
// may record the INTERNAL acceptance only, for a supportable limitation of
// their own ordinary source-record-count measurement, recorded as
// client_admin and admitted inside the decision's transaction
// (evaluateOrganizationCoverageAcceptanceInTransaction). Funder and public
// acceptance stay gk_reviewer only.
const ORGANIZATION_ACCEPTANCE_OPERATIONS = new Set([ACCEPT_INTERNAL_COVERAGE_LIMITATION_OPERATION]);

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

export async function acceptPublicCoverageLimitation(input, dependencies = {}) {
  return acceptCoverageLimitation(input, dependencies, {
    operation: ACCEPT_PUBLIC_COVERAGE_LIMITATION_OPERATION,
    repositoryMethod: "acceptPublicCoverageLimitation",
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

  let auth = validateActorCanPerformOperation(
    actorContext,
    operation,
    input.organizationId,
    { allowedRoles: ACCEPT_INTERNAL_COVERAGE_LIMITATION_ALLOWED_ROLES },
  );
  let organizationAcceptance = false;
  if (!auth.ok && ORGANIZATION_ACCEPTANCE_OPERATIONS.has(operation)) {
    const adminAuth = validateActorIsOrganizationAdministrator(actorContext, operation, input.organizationId);
    if (adminAuth.ok) {
      auth = adminAuth;
      organizationAcceptance = true;
    }
  }
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
    actorRole: organizationAcceptance ? ORGANIZATION_DECISION_ROLE : COVERAGE_REVIEW_DECISION_ROLE,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
    ...(organizationAcceptance
      ? {
        acceptanceAdmission: async (tx, { data, dimensionKey }) => {
          const evaluation = await evaluateOrganizationCoverageAcceptanceInTransaction(tx, {
            organizationId: input.organizationId,
            data,
            dimensionKey,
          });
          return evaluation.organizationMayReview ? null : organizationFactualReviewRefusal(evaluation);
        },
      }
      : {}),
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      ...(Array.isArray(result.blockers) ? { blockers: result.blockers } : {}),
    });
  }
  return { ok: true, data: result.data, error: null };
}

export const __coverageReviewDecisionServiceContract = Object.freeze({
  ACCEPT_INTERNAL_COVERAGE_LIMITATION_ALLOWED_ROLES,
  ACCEPT_INTERNAL_COVERAGE_LIMITATION_OPERATION,
  ACCEPT_FUNDER_COVERAGE_LIMITATION_OPERATION,
  ACCEPT_PUBLIC_COVERAGE_LIMITATION_OPERATION,
  ORGANIZATION_ACCEPTANCE_OPERATIONS,
});

export const __coverageReviewDecisionServiceTestables = Object.freeze({
  isAcceptInternalCoverageLimitationInput,
  isMappedHumanActor,
});
