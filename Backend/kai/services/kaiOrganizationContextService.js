import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES } from "../config/kaiSprint2P0Contract.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import {
  getActiveGkOrganizationBindingForKaiOrganizationId,
  getPublicOrganizationDisplayFields,
} from "../db/kaiOrganizationBindingQueries.js";

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

function isReadOrganizationProfileInput(value) {
  const allowedKeys = new Set(["req", "actorContext", "organizationId"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (!isNonEmptyString(value.organizationId)) return false;
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

/**
 * KAI organization display-profile read: the human-facing name and (when
 * set) logo_url for one KAI organization the actor is already authorized
 * for, resolved through the existing kai.gk_organization_bindings ->
 * public.organizations relationship. Never accepts or returns any other
 * public.organizations column, and never resolves a binding for an
 * organization_id the actor is not an active, role-authorized member of -
 * authorization is checked against the same
 * actorContext.organizationMemberships authority as
 * listAuthorizedOrganizations, scoped to the one requested organization_id,
 * before any binding/display lookup is attempted.
 */
export async function getOrganizationDisplayProfile(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isReadOrganizationProfileInput(input)) {
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
  const isAuthorizedForOrganization = memberships.some(
    (membership) =>
      membership &&
      typeof membership === "object" &&
      membership.membership_status === "active" &&
      AUTHORIZED_INTAKE_ROLE_NAMES.has(membership.role_name) &&
      membership.organization_id === input.organizationId,
  );
  if (!isAuthorizedForOrganization) {
    return buildKaiError("authorization_denied");
  }

  const getBinding =
    dependencies.getActiveGkOrganizationBindingForKaiOrganizationId || getActiveGkOrganizationBindingForKaiOrganizationId;
  const binding = await getBinding(input.organizationId);

  const unresolvedResult = {
    ok: true,
    data: { organization_id: input.organizationId, name: null, logo_url: null, resolved: false },
    error: null,
  };
  if (!binding) return unresolvedResult;

  const getDisplayFields = dependencies.getPublicOrganizationDisplayFields || getPublicOrganizationDisplayFields;
  const displayFields = await getDisplayFields(binding.gk_organization_id);
  if (!displayFields) return unresolvedResult;

  const name = isNonEmptyString(displayFields.name) ? displayFields.name.trim() : null;
  const logoUrl = isNonEmptyString(displayFields.logo_url) ? displayFields.logo_url.trim() : null;

  return {
    ok: true,
    data: {
      organization_id: input.organizationId,
      name,
      logo_url: logoUrl,
      resolved: Boolean(name),
    },
    error: null,
  };
}

export const __organizationContextServiceContract = Object.freeze({
  AUTHORIZED_INTAKE_ROLE_NAMES,
});

export const __organizationContextServiceTestables = Object.freeze({
  isListOrganizationsInput,
  isReadOrganizationProfileInput,
  isMappedHumanActor,
});
