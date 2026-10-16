/**
 * KAI Sprint 2 Package 2: central access-administration contract.
 *
 * These operations are the only authority surface for governed
 * role/organization-membership administration (the fourth, Prompt 4, is the
 * platform superuser's read-only Team & Access administration context). No service may declare its
 * own parallel role set for these operations - they are always authorized
 * through Backend/kai/auth/kaiAuthorizationService.js using exactly this
 * contract.
 */
export const KAI_ACCESS_ADMINISTRATION_OPERATIONS = Object.freeze({
  VIEW_KAI_ACCESS: "view_kai_access",
  MANAGE_ORGANIZATION_MEMBERSHIP: "manage_organization_membership",
  MANAGE_GLOBAL_KAI_ROLE: "manage_global_kai_role",
  VIEW_PLATFORM_ACCESS_ADMINISTRATION: "view_platform_access_administration",
});

/**
 * Organization-scoped roles an effective client_admin (stored or derived) or
 * platform superuser may assign/change within kai.organization_memberships.
 * An organization administrator never assigns or modifies platform-superuser
 * authority, gk_admin, gk_operator, or gk_reviewer through this path.
 */
export const KAI_ASSIGNABLE_ORGANIZATION_ROLES = Object.freeze([
  "client_admin",
  "client_reviewer",
  "client_contributor",
]);

/**
 * The organization roles a platform superuser may grant, replace, and
 * revoke: the client roles, gk_reviewer, and (owner decision B/E C04-C06,
 * 2026-10-15) gk_operator and gk_admin. Each is one stored
 * kai.organization_memberships row for that organization only; none of them
 * creates a global kai.user_roles role.
 */
export const KAI_PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLES = Object.freeze([
  ...KAI_ASSIGNABLE_ORGANIZATION_ROLES,
  "gk_reviewer",
  "gk_operator",
  "gk_admin",
]);

/**
 * Delegated GK administration (owner decision B/E, 2026-10-15): an actor
 * holding BOTH the global gk_admin role and an active stored gk_admin
 * membership of the exact target organization may grant, replace, and
 * revoke that organization's gk_operator and gk_reviewer assignments - never
 * organization gk_admin, a global role, or another organization.
 */
export const KAI_DELEGATED_GK_ADMINISTRATOR_ROLE = "gk_admin";
export const KAI_DELEGATED_GK_ADMIN_ASSIGNABLE_ORGANIZATION_ROLES = Object.freeze(["gk_operator", "gk_reviewer"]);

/**
 * Existing global KAI staff roles (kai.roles -> kai.user_roles) a platform
 * superuser may assign/revoke. Platform-superuser authority itself is never
 * represented as a kai.user_roles row - it is carried on the actor context
 * from the existing Get Kinder site-admin authority (see
 * Backend/kai/auth/kaiActorContext.js) and is never managed here.
 */
export const KAI_ASSIGNABLE_GLOBAL_ROLES = Object.freeze(["gk_admin", "gk_operator", "gk_reviewer"]);

/**
 * kai.organization_memberships is externally managed (no CREATE TABLE for it
 * exists in this repository). The committed production catalog capture
 * (artifacts/kai-db-reconciliation-2026-09-16/PRODUCTION_KAI_SCHEMA.json)
 * shows CHECK membership_status IN ('active','inactive','revoked','invited')
 * and UNIQUE (organization_id, user_id, role_name). Only "active" confers
 * authority anywhere (Backend/kai/auth/kaiAuthorizationService.js). The
 * administration writers use only "active" and "inactive" - "inactive" is the
 * counterpart for deactivation and targeted revocation; "revoked" and
 * "invited" are DDL-valid but never written here.
 */
export const KAI_ORGANIZATION_MEMBERSHIP_STATUSES = Object.freeze(["active", "inactive"]);
export const KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS = "active";
export const KAI_INACTIVE_ORGANIZATION_MEMBERSHIP_STATUS = "inactive";
