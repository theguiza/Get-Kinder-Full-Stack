import { buildKaiError } from "../errors/kaiErrors.js";

export const ALLOWED_ACTIVE_MEMBERSHIP_STATUS = "active";

export const ACTIVE_ORGANIZATION_MEMBERSHIP_SQL = `
SELECT organization_id, user_id, role_name, membership_status
FROM kai.organization_memberships
WHERE organization_id = $1
  AND user_id = $2
  AND membership_status = 'active'
LIMIT 1
`.trim();

function tenantAuthBlocker(blockingReason, message, objectType = "authorization") {
  return {
    validator_key: "VAL-TENANT-P0-001",
    severity: "blocker",
    object_type: objectType,
    object_id: null,
    message,
    blocking_reason: blockingReason,
    required_fix: "Provide explicit actor, tenant, and active membership context before authorizing Sprint 2 access.",
    evidence: { bypass_allowed: false },
  };
}

function deniedResult(code, status, blocker) {
  return buildKaiError(code, {
    status,
    data: null,
    blockers: [blocker],
    warnings: [],
  });
}

function hasActorContext(actorContext) {
  const source = actorContext?.source ?? actorContext?.legacyIdentitySource;
  const hasMappedActor =
    typeof actorContext?.actorUserId === "string" ||
    Number.isInteger(actorContext?.actorUserId) ||
    Number.isInteger(actorContext?.legacyPublicUserdataId);

  return (
    actorContext?.actorType === "human" &&
    source === "public.userdata" &&
    hasMappedActor &&
    (!Number.isInteger(actorContext?.legacyPublicUserdataId) || actorContext.legacyPublicUserdataId > 0)
  );
}

function hasTenantContext(tenantContext) {
  if (!tenantContext || typeof tenantContext !== "object" || Array.isArray(tenantContext)) return false;
  const organizationId = tenantContext.organizationId;
  return (typeof organizationId === "string" && organizationId.trim() !== "") || Number.isInteger(organizationId);
}

export function isExplicitActiveMembershipStatus(status) {
  return status === ALLOWED_ACTIVE_MEMBERSHIP_STATUS;
}

function membershipStatus(membership) {
  return membership.membershipStatus ?? membership.membership_status;
}

function membershipOrganizationId(membership) {
  return membership.organizationId ?? membership.organization_id;
}

function membershipActorUserId(membership) {
  return membership.actorUserId ?? membership.user_id;
}

function actorUserId(actorContext) {
  return actorContext?.actorUserId;
}

function sameId(left, right) {
  if (left === undefined || left === null || right === undefined || right === null) return true;
  return String(left) === String(right);
}

function requireInjectedQueryFunction(query) {
  if (typeof query !== "function") {
    throw new TypeError("KAI Sprint 2 membership DB read helpers require an injected query function.");
  }
}

function queryRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

function safeMembershipContext(row) {
  if (!row || row.membership_status !== ALLOWED_ACTIVE_MEMBERSHIP_STATUS) return null;
  return {
    organizationId: row.organization_id,
    actorUserId: row.user_id,
    roleName: typeof row.role_name === "string" ? row.role_name : null,
    membershipStatus: row.membership_status,
  };
}

export function authorizeSprint2TenantMembership({ actorContext, tenantContext, membership } = {}) {
  if (!hasActorContext(actorContext)) {
    return deniedResult(
      "unauthorized",
      401,
      tenantAuthBlocker("missing_actor_context", "Actor context is required.", "actor"),
    );
  }

  if (!hasTenantContext(tenantContext)) {
    return deniedResult(
      "tenant_boundary_violation",
      422,
      tenantAuthBlocker("missing_tenant_context", "Organization or tenant context is required.", "organization"),
    );
  }

  if (!membership || typeof membership !== "object" || Array.isArray(membership)) {
    return deniedResult(
      "authorization_denied",
      403,
      tenantAuthBlocker("missing_membership_context", "Active membership context is required.", "membership"),
    );
  }

  if (!sameId(membershipOrganizationId(membership), tenantContext.organizationId)) {
    return deniedResult(
      "tenant_boundary_violation",
      422,
      tenantAuthBlocker(
        "membership_organization_mismatch",
        "Membership context does not match the explicit organization scope.",
        "membership",
      ),
    );
  }

  if (!sameId(membershipActorUserId(membership), actorUserId(actorContext))) {
    return deniedResult(
      "authorization_denied",
      403,
      tenantAuthBlocker("membership_actor_mismatch", "Membership context does not match the actor.", "membership"),
    );
  }

  if (!isExplicitActiveMembershipStatus(membershipStatus(membership))) {
    return deniedResult(
      "authorization_denied",
      403,
      tenantAuthBlocker(
        "unsupported_membership_status",
        "Membership status is not authorized for Sprint 2 access.",
        "membership",
      ),
    );
  }

  return {
    ok: true,
    data: {
      membershipStatus: ALLOWED_ACTIVE_MEMBERSHIP_STATUS,
    },
    warnings: [],
  };
}

export async function findActiveOrganizationMembership({ query, organizationId, actorUserId } = {}) {
  requireInjectedQueryFunction(query);

  if (
    !((typeof organizationId === "string" && organizationId.trim() !== "") || Number.isInteger(organizationId)) ||
    !((typeof actorUserId === "string" && actorUserId.trim() !== "") || Number.isInteger(actorUserId))
  ) {
    return null;
  }

  const result = await query(ACTIVE_ORGANIZATION_MEMBERSHIP_SQL, [organizationId, actorUserId]);
  const [row] = queryRows(result);
  return safeMembershipContext(row);
}

export async function authorizeSprint2TenantMembershipWithLookup({ query, actorContext, organizationId } = {}) {
  const tenantContext = { organizationId };
  if (!hasActorContext(actorContext) || !hasTenantContext(tenantContext)) {
    return authorizeSprint2TenantMembership({ actorContext, tenantContext, membership: null });
  }

  const membership = await findActiveOrganizationMembership({
    query,
    organizationId,
    actorUserId: actorUserId(actorContext),
  });

  return authorizeSprint2TenantMembership({
    actorContext,
    tenantContext,
    membership,
  });
}

export const __testables = {
  actorUserId,
  hasActorContext,
  hasTenantContext,
  queryRows,
  safeMembershipContext,
};
