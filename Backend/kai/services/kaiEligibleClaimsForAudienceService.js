import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";

const ELIGIBLE_CLAIMS_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const ELIGIBLE_CLAIMS_OPERATION = "list_eligible_claims_for_audience";
const REQUESTED_AUDIENCES = new Set(["internal", "funder", "public"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, allowedKeys) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowedKeys.size && keys.every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function isEligibleClaimsInput(value) {
  const allowedKeys = new Set(["organizationId", "requestedAudience", "limit", "afterClaimId", "actorContext"]);
  return (
    hasExactKeys(value, allowedKeys) &&
    isNonEmptyString(value.organizationId) &&
    REQUESTED_AUDIENCES.has(value.requestedAudience) &&
    Number.isInteger(value.limit) &&
    value.limit >= 1 &&
    value.limit <= 100 &&
    (value.afterClaimId === null || (typeof value.afterClaimId === "string" && UUID_PATTERN.test(value.afterClaimId))) &&
    isPlainObject(value.actorContext)
  );
}

async function createDefaultEligibleClaimsForAudienceRepository() {
  const { createPostgresEligibleClaimsForAudienceRepository } = await import(
    "../dictionary/postgresEligibleClaimsForAudienceRepository.js"
  );
  return createPostgresEligibleClaimsForAudienceRepository();
}

export async function listEligibleClaimsForAudience(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isEligibleClaimsInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    ELIGIBLE_CLAIMS_OPERATION,
    input.organizationId,
    { allowedRoles: ELIGIBLE_CLAIMS_ALLOWED_ROLES },
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
    dependencies.eligibleClaimsForAudienceRepository ||
    (await createDefaultEligibleClaimsForAudienceRepository());

  const result = await repository.listEligibleClaimsForAudience({
    organizationId: input.organizationId,
    requestedAudience: input.requestedAudience,
    limit: input.limit,
    afterClaimId: input.afterClaimId,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __eligibleClaimsForAudienceServiceContract = Object.freeze({
  ELIGIBLE_CLAIMS_ALLOWED_ROLES,
  ELIGIBLE_CLAIMS_OPERATION,
  REQUESTED_AUDIENCES,
});
