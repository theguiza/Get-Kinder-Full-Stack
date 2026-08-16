import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES } from "../config/kaiSprint2P0Contract.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";

/**
 * KAI Web Intake organization-bootstrap read: lets the authenticated browser
 * discover which organization(s) it may use for ordinary intake without ever
 * accepting an organization id from the caller. The authority is exactly the
 * actor context already resolved by kaiActorContext.js#resolveKaiActorContext
 * (internal kai.organization_memberships rows merged with any derived
 * gk_organization_binding client_admin membership), resolved fresh from the
 * authenticated req the same way checkAdminAccess/createIntakeBatch resolve
 * it in kaiIntakeService.js - this service never queries the database itself
 * and never accepts a caller-supplied organization id.
 */
const AUTHORIZED_INTAKE_ROLE_NAMES = new Set(KAI_SPRINT2_P0_OPERATION_ROLES.read_intake);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function isListOrganizationsInput(value) {
  const allowedKeys = new Set(["req", "actorContext"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

function actorError(actorResult) {
  if (actorResult.error_code === "mapped_kai_user_required") return buildKaiError("mapped_kai_user_required");
  return buildKaiError(actorResult.error_code || "unauthorized");
}

export async function listAuthorizedOrganizations(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isListOrganizationsInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const { actorContext } = actorResult;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const memberships = Array.isArray(actorContext.organizationMemberships) ? actorContext.organizationMemberships : [];
  const organizationIds = new Set();
  for (const membership of memberships) {
    if (!membership || typeof membership !== "object") continue;
    if (membership.membership_status !== "active") continue;
    if (!AUTHORIZED_INTAKE_ROLE_NAMES.has(membership.role_name)) continue;
    if (!isNonEmptyString(membership.organization_id)) continue;
    organizationIds.add(membership.organization_id);
  }

  return {
    ok: true,
    data: {
      items: [...organizationIds].sort().map((organizationId) => ({ organization_id: organizationId })),
    },
    error: null,
  };
}

export const __organizationContextServiceContract = Object.freeze({
  AUTHORIZED_INTAKE_ROLE_NAMES,
});

export const __organizationContextServiceTestables = Object.freeze({
  isListOrganizationsInput,
  isMappedHumanActor,
});
