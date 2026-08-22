import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";

const CLAIM_TRACEABILITY_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const CLAIM_TRACEABILITY_OPERATION = "get_claim_traceability_summary";
const REQUESTED_AUDIENCES = new Set(["internal", "funder", "public"]);

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

  const auth = validateActorCanPerformOperation(
    actorContext,
    CLAIM_TRACEABILITY_OPERATION,
    input.organizationId,
    { allowedRoles: CLAIM_TRACEABILITY_ALLOWED_ROLES },
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

  const result = await repository.getClaimTraceabilitySummary({
    organizationId: input.organizationId,
    claimId: input.claimId,
    requestedAudience: input.requestedAudience,
  });

  if (!result.ok) {
    console.error("CLAIM_TRACEABILITY_RESULT_ERROR", {
      code: result.error.code,
      status: result.error.status,
      reason: result.error.reason ?? null,
    });
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __claimTraceabilityServiceContract = Object.freeze({
  CLAIM_TRACEABILITY_ALLOWED_ROLES,
  CLAIM_TRACEABILITY_OPERATION,
  REQUESTED_AUDIENCES,
});
