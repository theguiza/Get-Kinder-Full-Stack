import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresHumanReviewRepository } from "../dictionary/postgresHumanReviewRepository.js";

/**
 * KAI P2-09 human review/internal-approval service layer. Mirrors the P3-04
 * `completeGeneratedContentReview` allowed-role precedent
 * (Backend/kai/services/kaiGeneratedContentService.js) exactly: `gk_reviewer`
 * and `gk_admin` only, never `gk_operator`, `client`, `assistant`, or any
 * generic system actor. Both operations require a mapped human actor before
 * any repository call.
 */
const COMPLETE_EVIDENCE_REVIEW_ALLOWED_ROLES = new Set(["gk_reviewer", "gk_admin"]);
const COMPLETE_CLAIM_REVIEW_ALLOWED_ROLES = new Set(["gk_reviewer", "gk_admin"]);
const COMPLETE_EVIDENCE_REVIEW_OPERATION = "complete_evidence_review";
const COMPLETE_CLAIM_REVIEW_OPERATION = "complete_claim_review_internal_approval";

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

function isCompleteEvidenceReviewInput(value) {
  const allowedKeys = new Set(["organizationId", "evidenceItemId", "reviewQueueItemId", "expectedUpdatedAt", "actorContext", "now"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.evidenceItemId) &&
    isNonEmptyString(value.reviewQueueItemId) &&
    isNormalizedNow(value.expectedUpdatedAt) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

function isCompleteClaimReviewInput(value) {
  const allowedKeys = new Set(["organizationId", "claimId", "reviewQueueItemId", "expectedUpdatedAt", "actorContext", "now"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.claimId) &&
    isNonEmptyString(value.reviewQueueItemId) &&
    isNormalizedNow(value.expectedUpdatedAt) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

/**
 * KAI P2-09 human evidence-review completion. See
 * Backend/kai/dictionary/postgresHumanReviewRepository.js for the exact
 * persisted-state contract this reuses (P2-06's own eligibility evaluator is
 * authoritative for what these writes must be).
 */
export async function completeEvidenceReview(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isCompleteEvidenceReviewInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    COMPLETE_EVIDENCE_REVIEW_OPERATION,
    input.organizationId,
    { allowedRoles: COMPLETE_EVIDENCE_REVIEW_ALLOWED_ROLES },
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

  const repository = dependencies.humanReviewRepository || createPostgresHumanReviewRepository();
  const result = await repository.completeEvidenceReview({
    organizationId: input.organizationId,
    evidenceItemId: input.evidenceItemId,
    reviewQueueItemId: input.reviewQueueItemId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    actorUserId: actorContext.actorUserId,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

/**
 * KAI P2-09 human claim-review/internal-approval completion. Requires the
 * linked evidence item's own evidence_review to already be resolved - see the
 * repository module for the exact precondition and write contract.
 */
export async function completeClaimReviewInternalApproval(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isCompleteClaimReviewInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    COMPLETE_CLAIM_REVIEW_OPERATION,
    input.organizationId,
    { allowedRoles: COMPLETE_CLAIM_REVIEW_ALLOWED_ROLES },
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

  const repository = dependencies.humanReviewRepository || createPostgresHumanReviewRepository();
  const result = await repository.completeClaimReviewInternalApproval({
    organizationId: input.organizationId,
    claimId: input.claimId,
    reviewQueueItemId: input.reviewQueueItemId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    actorUserId: actorContext.actorUserId,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __humanReviewServiceContract = Object.freeze({
  COMPLETE_EVIDENCE_REVIEW_ALLOWED_ROLES,
  COMPLETE_CLAIM_REVIEW_ALLOWED_ROLES,
  COMPLETE_EVIDENCE_REVIEW_OPERATION,
  COMPLETE_CLAIM_REVIEW_OPERATION,
});

export const __humanReviewServiceTestables = Object.freeze({
  isCompleteEvidenceReviewInput,
  isCompleteClaimReviewInput,
  isMappedHumanActor,
});
