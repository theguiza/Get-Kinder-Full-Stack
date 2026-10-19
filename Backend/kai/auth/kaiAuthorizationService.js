import { validateAssistantBoundary } from "../validators/assistantBoundaryValidators.js";

import { KAI_SPRINT2_P0_OPERATION_ROLES } from "../config/kaiSprint2P0Contract.js";
import { STORED_ORGANIZATION_MEMBERSHIP_SOURCE } from "./kaiOrganizationMembershipSource.js";

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

// Owner-authorized workspace/read reconciliation (2026-10-14). This is
// workspace admission only, never promotion, assessment, or approval authority.
// Preserve existing organization GK grants and admit global GK capability
// only with active access to the exact organization, through the same validator.
const KNOWLEDGE_WORKSPACE_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
export const KAI_KNOWLEDGE_WORKSPACE_ROLES = Object.freeze([...KNOWLEDGE_WORKSPACE_ROLES]);

export function validateActorCanAccessKnowledgeWorkspace(actorContext, organizationId) {
  if (actorContext?.actorType !== "human") return { ok: false, error_code: "authorization_denied" };
  return validateActorCanPerformOperation(actorContext, "read_knowledge_workspace", organizationId, {
    allowedRoles: KNOWLEDGE_WORKSPACE_ROLES,
    combineGlobalRoles: true,
  });
}

function activeMembershipsForOrg(actorContext, organizationId) {
  return (actorContext?.organizationMemberships || []).filter(
    (membership) =>
      String(membership.organization_id) === String(organizationId) &&
      membership.membership_status === "active",
  );
}

export function hasPlatformSuperuserAuthority(actorContext) {
  return actorContext?.actorType === "human" && actorContext?.platformSuperuser === true;
}

/**
 * Central authorization for platform-superuser-only, non-tenant-scoped
 * operations (currently: manage_global_kai_role). Global KAI staff role
 * assignment is not organization-scoped, so it deliberately does not go
 * through validateActorCanPerformOperation's mandatory organizationId check -
 * that check exists to enforce tenant boundaries, which do not apply here.
 * Platform-superuser authority itself is still resolved exactly the same way
 * (actorContext.platformSuperuser, carried from the existing Get Kinder
 * site-admin authority - see kaiActorContext.js) and no role recorded in
 * kai.user_roles/kai.organization_memberships can satisfy this check.
 */
export function validateActorCanPerformPlatformOperation(actorContext, operation) {
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

  if (!hasPlatformSuperuserAuthority(actorContext)) {
    return {
      ok: false,
      error_code: "authorization_denied",
      blockers: [
        {
          validator_key: "VAL-AUT-005",
          severity: "blocker",
          object_type: "operation",
          object_code: operation,
          object_id: null,
          message: "Only platform superuser authority may perform this operation.",
          blocking_reason: "platform_superuser_required",
          required_fix: "This operation is restricted to the existing Get Kinder platform-superuser authority.",
          evidence: { bypass_allowed: false },
        },
      ],
    };
  }

  return {
    ok: true,
    platformSuperuserAuthorized: true,
    platformSuperuserAuthority: actorContext.platformSuperuserAuthority || "get_kinder_site_admin",
  };
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
  const platformSuperuserAuthorized = hasPlatformSuperuserAuthority(actorContext);

  if (platformSuperuserAuthorized) {
    return {
      ok: true,
      memberships,
      platformSuperuserAuthorized: true,
      platformSuperuserAuthority: actorContext.platformSuperuserAuthority || "get_kinder_site_admin",
    };
  }

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

/**
 * Sensitivity review is the one review operation that an active organization
 * administrator may perform for that exact KAI tenant (owner decisions
 * 2026-10-12 and 2026-10-19; see isOrganizationAdministratorMembership).
 */
export function validateActorCanPerformSensitivityReview(
  actorContext,
  operation,
  organizationId,
  allowedRoles,
  { globalRolesOnly = false } = {},
) {
  const gkAuthorization = validateActorCanPerformOperation(
    actorContext,
    operation,
    organizationId,
    globalRolesOnly ? { allowedRoles, globalRolesOnly: true } : { allowedRoles, combineGlobalRoles: true },
  );
  if (gkAuthorization.ok) return gkAuthorization;

  const memberships = activeMembershipsForOrg(actorContext, organizationId);
  if (actorContext?.actorType !== "human" || !memberships.some(isOrganizationAdministratorMembership)) return gkAuthorization;

  return { ok: true, memberships, organizationAdminAuthorized: true };
}

/**
 * An active client_admin membership of the organization (already filtered to
 * this organization and to membership_status 'active'), with verified
 * provenance. Owner decision 2026-10-19: a legitimately delegated, active
 * organization client_admin has the same organization-scoped
 * source-preparation authority as a binding-derived one. Either
 *   - binding-derived: emitted only by gkOrganizationBindingAuthority for an
 *     active Get Kinder organization-admin membership and an active binding
 *     to this KAI tenant (positive GK organization id); or
 *   - stored: an active kai.organization_memberships client_admin row of this
 *     user, tagged by kaiActorContext. Those rows are written only by the
 *     governed, audited access-administration grants (Team & Access, /admin
 *     KAI Access, JOIN-3), and a revoked grant is not 'active'.
 * A membership object with any other or no provenance, a global (kai.user_roles)
 * client_admin, and platform-superuser authority never satisfy it, and only a
 * human actor ever holds organization-administrator authority.
 */
function isOrganizationAdministratorMembership(membership) {
  if (membership.role_name !== "client_admin") return false;
  if (membership.source === STORED_ORGANIZATION_MEMBERSHIP_SOURCE) return true;
  return membership.source === "gk_organization_binding"
    && typeof membership.gk_organization_id === "number"
    && Number.isInteger(membership.gk_organization_id)
    && membership.gk_organization_id > 0;
}

/**
 * The organization-administrator half of validateActorCanPerformSensitivityReview
 * alone, for an operation whose GK authority is checked separately in its own
 * mode (P1-07 continuation, P1-08 source promotion, and the source-candidate
 * reads; owner decisions 2026-10-18 and 2026-10-19). Admits only an active
 * client_admin membership in this exact organization with verified provenance
 * (isOrganizationAdministratorMembership): any global role and
 * platform-superuser authority do not satisfy it. The shared validator still
 * applies the assistant boundary, mapped actor, organization scope, and
 * active-membership checks first.
 */
export function validateActorIsOrganizationAdministrator(actorContext, operation, organizationId) {
  const base = validateActorCanPerformOperation(actorContext, operation, organizationId, {
    allowedRoles: ORGANIZATION_ADMINISTRATOR_ROLES,
  });
  const memberships = activeMembershipsForOrg(actorContext, organizationId);
  if (base.ok && actorContext?.actorType === "human" && memberships.some(isOrganizationAdministratorMembership)) {
    return { ok: true, memberships, organizationAdminAuthorized: true };
  }
  if (!base.ok) return base;
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

const ORGANIZATION_ADMINISTRATOR_ROLES = new Set(["client_admin"]);
