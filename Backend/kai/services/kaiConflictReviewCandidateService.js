import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { __conflictGroupValidatorTestables } from "../validators/kaiConflictGroupValidators.js";

const CONFLICT_REVIEW_CANDIDATE_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const CONFLICT_REVIEW_CANDIDATE_OPERATION = "create_conflict_review_candidate";

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

function isCreateConflictReviewCandidateInput(value) {
  const allowedKeys = new Set(["organizationId", "firstClaimId", "secondClaimId", "actorContext", "now"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return (
    __conflictGroupValidatorTestables.isCanonicalUuid(value.organizationId) &&
    __conflictGroupValidatorTestables.isCanonicalUuid(value.firstClaimId) &&
    __conflictGroupValidatorTestables.isCanonicalUuid(value.secondClaimId) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

async function createDefaultConflictReviewCandidateRepository() {
  const { createPostgresConflictReviewCandidateRepository } = await import(
    "../dictionary/postgresConflictReviewCandidateRepository.js"
  );
  return createPostgresConflictReviewCandidateRepository();
}

/**
 * KAI P2-05 dormant potential conflict-review candidate seam. This service
 * creates only a human-selected candidate for GK review; it does not assert that
 * a conflict exists and it adds no routes, UI, assistant tools, or feature flag.
 * It follows the accepted P2-04C lazy-loading pattern: the database-capable
 * PostgreSQL repository is imported only after KAI_SPRINT2_ENABLED passes.
 */
export async function createConflictReviewCandidate(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isCreateConflictReviewCandidateInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    CONFLICT_REVIEW_CANDIDATE_OPERATION,
    input.organizationId,
    { allowedRoles: CONFLICT_REVIEW_CANDIDATE_ALLOWED_ROLES },
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

  const repository =
    dependencies.conflictReviewCandidateRepository || (await createDefaultConflictReviewCandidateRepository());

  const result = await repository.createConflictReviewCandidate({
    organizationId: input.organizationId,
    firstClaimId: input.firstClaimId,
    secondClaimId: input.secondClaimId,
    actorUserId: actorContext.actorUserId,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      ...(result.blockers ? { blockers: result.blockers } : {}),
    });
  }
  return { ok: true, data: result.data, error: null };
}

export const __conflictReviewCandidateServiceContract = Object.freeze({
  CONFLICT_REVIEW_CANDIDATE_ALLOWED_ROLES,
  CONFLICT_REVIEW_CANDIDATE_OPERATION,
});
