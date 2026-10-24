import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import {
  validateActorCanPerformOperation,
  validateActorIsOrganizationAdministrator,
} from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";

const CLAIM_TRACEABILITY_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const CLAIM_TRACEABILITY_OPERATION = "get_claim_traceability_summary";
// Owner authorization 2026-10-24: an active organization administrator
// (client_admin, stored or binding-derived; validateActorIsOrganizationAdministrator)
// may read a client-safe INTERNAL traceability diagnostic for a claim of that
// exact organization, so a refused internal draft can be explained. Only the
// "internal" audience; never the full GK DTO; GK roles and the Review Queue
// keep CLAIM_TRACEABILITY_ALLOWED_ROLES unchanged.
const ORGANIZATION_TRACEABILITY_DIAGNOSTIC_OPERATION = "get_organization_claim_traceability_diagnostic";
const ORGANIZATION_TRACEABILITY_DIAGNOSTIC_AUDIENCE = "internal";
const ORGANIZATION_TRACEABILITY_DIAGNOSTIC_VIEW = "organization_internal_traceability_diagnostic";
// Review Queue rollup: read-only, organization-scope, same privilege as
// reading one claim's traceability - it discloses nothing a caller who can
// already call getClaimTraceabilitySummary per-claim could not already
// learn one claim at a time (same precedent as
// LIST_REQUIREMENTS_READINESS_ALLOWED_ROLES in kaiRequirementAssessmentService.js).
const REVIEW_QUEUE_ALLOWED_ROLES = CLAIM_TRACEABILITY_ALLOWED_ROLES;
const REVIEW_QUEUE_OPERATION = "list_organization_review_queue";
// The Review Queue is an internal GK reviewer surface; it always evaluates
// current attention against the "internal" requested audience (the same
// default the /impact-library traceability panel itself uses), never
// funder/public.
const REVIEW_QUEUE_REQUESTED_AUDIENCE = "internal";
const REQUESTED_AUDIENCES = new Set(["internal", "funder", "public"]);
const TRACEABILITY_CONFLICT_REASONS = new Set([
  "claim_evidence_link_mismatch",
  "source_version_not_current",
  "gap_dimension_requires_missing_p204_state",
  "gap_followup_queue_mismatch",
  "conflict_queue_count_mismatch",
  "conflict_group_validation_failed",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function isClaimTraceabilityInput(value) {
  const allowedKeys = new Set(["organizationId", "claimId", "requestedAudience", "actorContext"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.claimId) &&
    REQUESTED_AUDIENCES.has(value.requestedAudience) &&
    isPlainObject(value.actorContext)
  );
}

async function createDefaultClaimTraceabilityRepository() {
  const { createPostgresClaimTraceabilityRepository } = await import(
    "../dictionary/postgresClaimTraceabilityRepository.js"
  );
  return createPostgresClaimTraceabilityRepository();
}

/**
 * P2-06 read-only claim traceability seam. The database-capable repository is
 * lazy-loaded only after KAI_SPRINT2_ENABLED, input validation, human actor
 * validation, tenant membership, and role authorization all pass.
 */
export async function getClaimTraceabilitySummary(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isClaimTraceabilityInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = authorizeClaimTraceabilityRead(actorContext, input.organizationId, input.requestedAudience);
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
    dependencies.claimTraceabilityRepository || (await createDefaultClaimTraceabilityRepository());

  const result = await repository.getClaimTraceabilitySummary({
    organizationId: input.organizationId,
    claimId: input.claimId,
    requestedAudience: input.requestedAudience,
  });

  if (!result.ok) {
    const traceabilityConflictReason =
      result.error.code === "conflict_current_state_changed" &&
      TRACEABILITY_CONFLICT_REASONS.has(result.error.reason)
        ? result.error.reason
        : null;
    console.error("CLAIM_TRACEABILITY_RESULT_ERROR", {
      code: result.error.code,
      status: result.error.status,
      reason: traceabilityConflictReason,
    });
    return buildKaiError(result.error.code, {
      status: result.error.status,
      ...(traceabilityConflictReason
        ? { data: { traceability_conflict_reason: traceabilityConflictReason } }
        : {}),
    });
  }
  if (auth.organizationTraceabilityDiagnostic === true) {
    return { ok: true, data: organizationTraceabilityDiagnostic(result.data, input.claimId), error: null };
  }
  return { ok: true, data: result.data, error: null };
}

/**
 * Who may read a claim's traceability, and in which shape. GK roles keep the
 * full DTO for every audience, exactly as before. Otherwise only an
 * organization administrator of this exact organization, and only for the
 * internal audience, is admitted to the client-safe diagnostic; every other
 * actor (and an administrator asking for funder/public) receives the
 * unchanged GK refusal.
 */
export function authorizeClaimTraceabilityRead(actorContext, organizationId, requestedAudience) {
  const gkAuth = validateActorCanPerformOperation(
    actorContext,
    CLAIM_TRACEABILITY_OPERATION,
    organizationId,
    { allowedRoles: CLAIM_TRACEABILITY_ALLOWED_ROLES, combineGlobalRoles: true },
  );
  if (gkAuth.ok || requestedAudience !== ORGANIZATION_TRACEABILITY_DIAGNOSTIC_AUDIENCE) return gkAuth;
  if (!isMappedHumanActor(actorContext)) return gkAuth;
  const adminAuth = validateActorIsOrganizationAdministrator(
    actorContext,
    ORGANIZATION_TRACEABILITY_DIAGNOSTIC_OPERATION,
    organizationId,
  );
  if (!adminAuth.ok) return gkAuth;
  return { ...adminAuth, organizationTraceabilityDiagnostic: true };
}

// The organization administrator's projection of a SUCCESSFUL internal
// traceability evaluation: status and the existing ordered blocker codes
// only. No evidence or claim text, source, version, locator, candidate,
// profile, dictionary, review-queue or decision identifiers, reviewer
// outcomes, dimensions, gaps, follow-ups, conflict groups, or graph lineage.
// A failed evaluation never reaches here: it keeps the GK error shape, whose
// only data is the allowlisted traceability_conflict_reason.
function organizationTraceabilityDiagnostic(data, claimId) {
  const blockerCodes = Array.isArray(data?.blockerCodes)
    ? data.blockerCodes.filter((code) => typeof code === "string" && /^[a-z0-9_]{1,64}$/.test(code))
    : [];
  return {
    view: ORGANIZATION_TRACEABILITY_DIAGNOSTIC_VIEW,
    claim_id: claimId,
    requested_audience: ORGANIZATION_TRACEABILITY_DIAGNOSTIC_AUDIENCE,
    traceability_passed: true,
    eligible: data?.eligible === true && blockerCodes.length === 0,
    blocked: blockerCodes.length > 0,
    blocker_codes: blockerCodes,
    traceability_conflict_reason: null,
  };
}

function isListOrganizationReviewQueueInput(value) {
  const allowedKeys = new Set(["organizationId", "actorContext"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return isNonEmptyString(value.organizationId) && isPlainObject(value.actorContext);
}

/**
 * KAI Review Queue rollup: organization-scope PRODUCT PROJECTION of current
 * attention needs. Not a new persisted review authority - it is a read-only
 * fan-out over the same evaluateClaimTraceabilityInTransaction the
 * single-claim route already calls, returning only claims whose freshly
 * recomputed blockerCodes are non-empty. A resolved review_queue_items
 * lifecycle row never suppresses a claim here.
 */
export async function listOrganizationReviewQueue(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isListOrganizationReviewQueueInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    REVIEW_QUEUE_OPERATION,
    input.organizationId,
    { allowedRoles: REVIEW_QUEUE_ALLOWED_ROLES, combineGlobalRoles: true },
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
    dependencies.claimTraceabilityRepository || (await createDefaultClaimTraceabilityRepository());

  const result = await repository.listOrganizationReviewQueue({
    organizationId: input.organizationId,
    requestedAudience: REVIEW_QUEUE_REQUESTED_AUDIENCE,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __claimTraceabilityServiceContract = Object.freeze({
  CLAIM_TRACEABILITY_ALLOWED_ROLES,
  CLAIM_TRACEABILITY_OPERATION,
  ORGANIZATION_TRACEABILITY_DIAGNOSTIC_OPERATION,
  ORGANIZATION_TRACEABILITY_DIAGNOSTIC_AUDIENCE,
  ORGANIZATION_TRACEABILITY_DIAGNOSTIC_VIEW,
  REQUESTED_AUDIENCES,
  TRACEABILITY_CONFLICT_REASONS,
  REVIEW_QUEUE_ALLOWED_ROLES,
  REVIEW_QUEUE_OPERATION,
  REVIEW_QUEUE_REQUESTED_AUDIENCE,
});
