/**
 * KAI Sprint 2 Package 2: central access-administration contract.
 *
 * These three operations are the only authority surface for governed
 * role/organization-membership administration. No service may declare its
 * own parallel role set for these operations - they are always authorized
 * through Backend/kai/auth/kaiAuthorizationService.js using exactly this
 * contract.
 */
export const KAI_ACCESS_ADMINISTRATION_OPERATIONS = Object.freeze({
  VIEW_KAI_ACCESS: "view_kai_access",
  MANAGE_ORGANIZATION_MEMBERSHIP: "manage_organization_membership",
  MANAGE_GLOBAL_KAI_ROLE: "manage_global_kai_role",
});

/**
 * Organization-scoped roles an effective client_admin (stored or derived) or
 * platform superuser may assign/change within kai.organization_memberships.
 * This package never assigns or modifies platform-superuser authority,
 * gk_admin, gk_operator, or gk_reviewer through this path.
 */
export const KAI_ASSIGNABLE_ORGANIZATION_ROLES = Object.freeze([
  "client_admin",
  "client_reviewer",
  "client_contributor",
]);

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
 * exists in this repository - see KAI_Sprint2_P0_Final_Recovery_and_Implementation_Plan_v0.3.6.md
 * and Backend/kai/db/kaiQueries.js), so its membership_status vocabulary is
 * not confirmed by DDL. The only value existing Package 1 code depends on is
 * "active" (Backend/kai/auth/tenantAuthorization.js, kaiAuthorizationService.js).
 * "inactive" is this package's chosen counterpart status for
 * deactivate/revoke, mirroring the same active/inactive vocabulary already
 * used for kai.gk_organization_bindings.status. This is a bounded design
 * choice, not a confirmed schema fact - see the Package 2 completion report.
 */
export const KAI_ORGANIZATION_MEMBERSHIP_STATUSES = Object.freeze(["active", "inactive"]);
export const KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS = "active";
export const KAI_INACTIVE_ORGANIZATION_MEMBERSHIP_STATUS = "inactive";
