import { buildKaiError } from "../errors/kaiErrors.js";

const ACCEPTED_LEGACY_IDENTITY_SOURCE = "public.userdata";
const DEFAULT_ACTOR_TYPE = "human";

export const ACTIVE_KAI_USER_MAPPING_SQL = `
SELECT user_id, legacy_identity_source, legacy_public_userdata_id, status
FROM kai.users
WHERE legacy_identity_source = 'public.userdata'
  AND legacy_public_userdata_id = $1
  AND status = 'active'
LIMIT 1
`.trim();

export const KAI_USER_ROLE_NAMES_SQL = `
SELECT r.role_name
FROM kai.user_roles ur
JOIN kai.roles r ON r.role_id = ur.role_id
WHERE ur.user_id = $1
`.trim();

function actorContextBlocker(blockingReason, message) {
  return {
    validator_key: "VAL-ACTOR-P0-001",
    severity: "blocker",
    object_type: "actor",
    object_id: null,
    message,
    blocking_reason: blockingReason,
    required_fix: "Provide an authenticated public.userdata request user before entering Sprint 2 services.",
    evidence: {},
  };
}

function unauthorizedActorResult(blockingReason, message) {
  return buildKaiError("unauthorized", {
    status: 401,
    data: null,
    blockers: [actorContextBlocker(blockingReason, message)],
    warnings: [],
  });
}

function mappedKaiUserRequiredResult(blockingReason, message, requestId = null) {
  return buildKaiError("mapped_kai_user_required", {
    status: 403,
    data: null,
    blockers: [actorContextBlocker(blockingReason, message)],
    warnings: [],
    ...(requestId ? { audit_context: { requestId } } : {}),
  });
}

function hasAcceptedPublicUserdataShape(user) {
  if (!user || typeof user !== "object" || Array.isArray(user)) return false;
  if (!Number.isInteger(user.id) || user.id <= 0) return false;
  if (typeof user.email !== "string" || user.email.trim() === "") return false;

  const hasName =
    (typeof user.name === "string" && user.name.trim() !== "") ||
    (typeof user.firstname === "string" && user.firstname.trim() !== "") ||
    (typeof user.lastname === "string" && user.lastname.trim() !== "");

  return hasName;
}

function requireInjectedQueryFunction(query) {
  if (typeof query !== "function") {
    throw new TypeError("KAI Sprint 2 actor DB read helpers require an injected query function.");
  }
}

function queryRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

function hasActiveKaiUserMapping(row, legacyPublicUserdataId) {
  return (
    row &&
    (typeof row.user_id === "string" || Number.isInteger(row.user_id)) &&
    row.legacy_identity_source === ACCEPTED_LEGACY_IDENTITY_SOURCE &&
    Number(row.legacy_public_userdata_id) === legacyPublicUserdataId &&
    row.status === "active"
  );
}

function safeRoleNames(rows) {
  return rows
    .map((row) => row?.role_name)
    .filter((roleName) => typeof roleName === "string" && roleName.trim() !== "")
    .map((roleName) => roleName.trim());
}

function safeOrganizationMemberships(memberships) {
  if (!Array.isArray(memberships)) return [];
  return memberships
    .filter((membership) => membership && typeof membership === "object" && !Array.isArray(membership))
    .map((membership) => ({
      organizationId: membership.organizationId ?? membership.organization_id ?? null,
      actorUserId: membership.actorUserId ?? membership.user_id ?? null,
      roleName: membership.roleName ?? membership.role_name ?? null,
      membershipStatus: membership.membershipStatus ?? membership.membership_status ?? null,
    }));
}

export function extractSprint2ActorContext(reqLike) {
  const user = reqLike?.user;
  if (!user) {
    return unauthorizedActorResult("missing_authenticated_user", "Authenticated user is required.");
  }

  if (!hasAcceptedPublicUserdataShape(user)) {
    return unauthorizedActorResult(
      "unsupported_authenticated_user_shape",
      "Authenticated user shape is not supported for KAI Sprint 2.",
    );
  }

  return {
    ok: true,
    actorContext: {
      actorType: DEFAULT_ACTOR_TYPE,
      legacyIdentitySource: ACCEPTED_LEGACY_IDENTITY_SOURCE,
      legacyPublicUserdataId: user.id,
    },
  };
}

export async function findActiveKaiUserMappingByLegacyPublicUserdataId({ query, legacyPublicUserdataId } = {}) {
  requireInjectedQueryFunction(query);

  if (!Number.isInteger(legacyPublicUserdataId) || legacyPublicUserdataId <= 0) {
    return null;
  }

  const result = await query(ACTIVE_KAI_USER_MAPPING_SQL, [legacyPublicUserdataId]);
  const [row] = queryRows(result);
  return hasActiveKaiUserMapping(row, legacyPublicUserdataId) ? row : null;
}

export async function listKaiRoleNamesForActorUser({ query, actorUserId } = {}) {
  requireInjectedQueryFunction(query);

  if (!(typeof actorUserId === "string" || Number.isInteger(actorUserId)) || String(actorUserId).trim() === "") {
    return [];
  }

  const result = await query(KAI_USER_ROLE_NAMES_SQL, [actorUserId]);
  return safeRoleNames(queryRows(result));
}

export function buildSafeHydratedActorContext({
  kaiUser,
  kaiRoles = [],
  organizationMemberships = [],
  legacyPublicUserdataId,
  requestId = null,
  source = ACCEPTED_LEGACY_IDENTITY_SOURCE,
} = {}) {
  return {
    actorUserId: kaiUser?.user_id ?? null,
    actorType: DEFAULT_ACTOR_TYPE,
    kaiRoles: Array.isArray(kaiRoles) ? kaiRoles.filter((roleName) => typeof roleName === "string") : [],
    organizationMemberships: safeOrganizationMemberships(organizationMemberships),
    legacyPublicUserdataId,
    requestId,
    source,
  };
}

export async function hydrateSprint2ActorContextFromRequest({
  req,
  query,
  requestId = null,
  organizationMemberships = [],
} = {}) {
  const baseActor = extractSprint2ActorContext(req);
  if (!baseActor.ok) return baseActor;

  const { legacyPublicUserdataId } = baseActor.actorContext;
  const kaiUser = await findActiveKaiUserMappingByLegacyPublicUserdataId({
    query,
    legacyPublicUserdataId,
  });

  if (!kaiUser) {
    return mappedKaiUserRequiredResult(
      "missing_active_kai_user_mapping",
      "Authenticated public.userdata user must be mapped to an active kai.users row.",
      requestId,
    );
  }

  const kaiRoles = await listKaiRoleNamesForActorUser({
    query,
    actorUserId: kaiUser.user_id,
  });

  return {
    ok: true,
    actorContext: buildSafeHydratedActorContext({
      kaiUser,
      kaiRoles,
      organizationMemberships,
      legacyPublicUserdataId,
      requestId,
    }),
    warnings: [],
  };
}

export const __testables = {
  ACCEPTED_LEGACY_IDENTITY_SOURCE,
  DEFAULT_ACTOR_TYPE,
  hasActiveKaiUserMapping,
  hasAcceptedPublicUserdataShape,
  queryRows,
  safeRoleNames,
};
