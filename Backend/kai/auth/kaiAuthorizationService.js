import { validateAssistantBoundary } from "../validators/assistantBoundaryValidators.js";

import { KAI_SPRINT2_P0_OPERATION_ROLES } from "../config/kaiSprint2P0Contract.js";

const OPERATION_ROLES = Object.freeze(
  Object.fromEntries(
    Object.entries(KAI_SPRINT2_P0_OPERATION_ROLES).map(([operation, roles]) => [
      operation,
      new Set(roles),
    ]),
  ),
);

const P0_MUTATING_OPERATIONS = new Set([
  "create_intake_batch",
  "create_intake_file",
  "create_review_queue_item",
  "mark_file_policy_blocked",
  "update_review_queue_status",
]);

const P0_GLOBAL_WRITE_ROLES = new Set(KAI_SPRINT2_P0_OPERATION_ROLES.create_intake_batch);

const P0_CLIENT_WRITE_OPERATIONS = new Set(["create_intake_batch", "create_intake_file"]);

const P0_CLIENT_WRITE_ROLES = new Set(["client_admin"]);

function activeMembershipsForOrg(actorContext, organizationId) {
  return (actorContext?.organizationMemberships || []).filter(
    (membership) =>
      String(membership.organization_id) === String(organizationId) &&
      membership.membership_status === "active",
  );
}

export function validateActorCanPerformOperation(actorContext, operation, organizationId, options = {}) {
  const assistantBoundary = validateAssistantBoundary({ actorContext, operation });

  if (assistantBoundary.severity === "blocker") {
    return { ok: false, blockers: [assistantBoundary], error_code: "authorization_denied" };
  }

  if (!actorContext?.actorUserId) {
    return {
      ok: false,
      error_code: "unauthorized",
      blockers: [
        {
          validator_key: "VAL-AUT-001",
          severity: "blocker",
          object_type: "actor",
          object_code: operation,
          object_id: null,
          message: "Mapped KAI actor is required.",
          blocking_reason: "missing_actor_context",
          required_fix: "Map public.userdata.id to kai.users before authorizing.",
          evidence: {},
        },
      ],
    };
  }

  if (!organizationId) {
    return {
      ok: false,
      error_code: "tenant_boundary_violation",
      blockers: [
        {
          validator_key: "VAL-AUT-002",
          severity: "blocker",
          object_type: "organization",
          object_id: null,
          message: "Organization scope is required.",
          blocking_reason: "missing_organization_scope",
          required_fix: "Provide a DDL-backed organization_id.",
          evidence: {},
        },
      ],
    };
  }

  const memberships = activeMembershipsForOrg(actorContext, organizationId);

  if (memberships.length === 0) {
    return {
      ok: false,
      error_code: "authorization_denied",
      blockers: [
        {
          validator_key: "VAL-AUT-003",
          severity: "blocker",
          object_type: "organization",
          object_id: organizationId,
          message: "Actor does not have active membership in this organization.",
          blocking_reason: "missing_active_organization_membership",
          required_fix: "Grant an active kai.organization_memberships row for the organization.",
          evidence: { bypass_allowed: false },
        },
      ],
    };
  }

  if (P0_MUTATING_OPERATIONS.has(operation)) {
    const globalRoles = new Set(actorContext.kaiRoles || []);

    const hasGlobalWriteRole = [...P0_GLOBAL_WRITE_ROLES].some((role) =>
      globalRoles.has(role),
    );

    const hasClientWriteRole =
      P0_CLIENT_WRITE_OPERATIONS.has(operation) &&
      memberships.some((membership) => P0_CLIENT_WRITE_ROLES.has(membership.role_name));

    if (!hasGlobalWriteRole && !hasClientWriteRole) {
      return {
        ok: false,
        error_code: "authorization_denied",
        blockers: [
          {
            validator_key: "VAL-AUT-004",
            severity: "blocker",
            object_type: "operation",
            object_code: operation,
            object_id: organizationId,
            message:
              "P0 write operation requires a global GK write role or an org-scoped client write role.",
            blocking_reason: "missing_global_gk_write_role",
            required_fix:
              "Assign gk_admin or gk_operator in kai.user_roles, or bind this organization to a KAI tenant so its admin-role members hold client_admin.",
            evidence: {
              required_global_roles: [...P0_GLOBAL_WRITE_ROLES],
              client_write_operations: [...P0_CLIENT_WRITE_OPERATIONS],
              bypass_allowed: false,
            },
          },
        ],
      };
    }
  }

  const allowedRoles =
    options.allowedRoles || OPERATION_ROLES[operation] || OPERATION_ROLES.read_intake;

  const hasGlobalCapabilityRole = (actorContext.kaiRoles || []).some((role) =>
    allowedRoles.has(role),
  );

  const hasAllowedRole = P0_MUTATING_OPERATIONS.has(operation)
    ? true
    : options.globalRolesOnly
      ? hasGlobalCapabilityRole
      : (Boolean(options.combineGlobalRoles) && hasGlobalCapabilityRole) ||
        memberships.some((membership) => allowedRoles.has(membership.role_name));

  console.log(JSON.stringify({
    event: "KAI_AUTHORIZATION_ROLE_DENIED_DEBUG",
    operation,
    organizationId,
    actorUserId: actorContext?.actorUserId,
    kaiRoles: actorContext?.kaiRoles,
    memberships,
    allowedRoles: [...allowedRoles],
    options,
    hasGlobalCapabilityRole,
    hasAllowedRole
  }, null, 2));

  if (!hasAllowedRole) {
    return {
      ok: false,
      error_code: "authorization_denied",
      blockers: [
        {
          validator_key: "VAL-AUT-004",
          severity: "blocker",
          object_type: "operation",
          object_code: operation,
          object_id: organizationId,
          message: "Actor role is not allowed for this operation.",
          blocking_reason: "role_not_allowed",
          required_fix: "Use an active organization-scoped role allowed for this operation.",
          evidence: { bypass_allowed: false },
        },
      ],
    };
  }

  return { ok: true, memberships };
}