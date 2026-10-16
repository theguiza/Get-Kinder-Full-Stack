// Organization-scoped KAI role management: pure path/shape helpers for the
// existing /admin -> Organizations "KAI Access" modal
// (frontend/adminDashboard.jsx). Network calls themselves are made by
// adminDashboard.jsx using its own requestJson/mutateJson-style
// conventions; this module holds only the parts that are safe and useful to
// unit-test without rendering React.
//
// The role lists mirror Backend/kai/config/kaiAccessAdministrationContract.js
// KAI_ASSIGNABLE_ORGANIZATION_ROLES and
// KAI_PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLES exactly - this file
// must never invent an additional or divergent role set. Package 2's mounted
// route is the single authority for the actual request/response contract
// (Backend/kai/routes/kaiAccessAdministrationApi.js); the paths below are
// built to match that router's exact mount and param names.

export const KAI_ORGANIZATION_ROLE_OPTIONS = Object.freeze([
  "client_admin",
  "client_reviewer",
  "client_contributor",
]);

// Get Kinder staff roles. As organization memberships they mirror
// KAI_PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLES (gk_reviewer,
// gk_operator, gk_admin: platform superuser; gk_operator and gk_reviewer
// also a delegated GK administrator - owner decision B/E). As global KAI
// roles, gk_reviewer and gk_operator are the ones this modal grants or
// revokes.
export const KAI_GK_REVIEWER_ROLE = "gk_reviewer";
export const KAI_GK_OPERATOR_ROLE = "gk_operator";
export const KAI_GK_ADMIN_ROLE = "gk_admin";
export const KAI_MODAL_GLOBAL_ROLE_OPTIONS = Object.freeze([KAI_GK_REVIEWER_ROLE, KAI_GK_OPERATOR_ROLE]);

// Offered only when the server reports platform-superuser authority for the
// roster (global_roles_visible); the backend decides either way.
export const KAI_SUPERUSER_ORGANIZATION_ROLE_OPTIONS = Object.freeze([
  ...KAI_ORGANIZATION_ROLE_OPTIONS,
  KAI_GK_REVIEWER_ROLE,
  KAI_GK_OPERATOR_ROLE,
  KAI_GK_ADMIN_ROLE,
]);

const KAI_ACCESS_ADMINISTRATION_BASE_PATH = "/api/kai/sprint2/access-administration";

export function isAssignableKaiOrganizationRole(roleName, { includeGkRoles = false } = {}) {
  return (includeGkRoles ? KAI_SUPERUSER_ORGANIZATION_ROLE_OPTIONS : KAI_ORGANIZATION_ROLE_OPTIONS).includes(roleName);
}

export function kaiOrganizationRoleOptions({ includeGkRoles = false } = {}) {
  return includeGkRoles ? KAI_SUPERUSER_ORGANIZATION_ROLE_OPTIONS : KAI_ORGANIZATION_ROLE_OPTIONS;
}

export function kaiOrganizationAccessPath(kaiOrganizationId) {
  return `${KAI_ACCESS_ADMINISTRATION_BASE_PATH}/organizations/${encodeURIComponent(kaiOrganizationId)}/access`;
}

export function kaiOrganizationMembershipPath(kaiOrganizationId, legacyPublicUserdataId) {
  return `${KAI_ACCESS_ADMINISTRATION_BASE_PATH}/organizations/${encodeURIComponent(
    kaiOrganizationId
  )}/memberships/${encodeURIComponent(legacyPublicUserdataId)}`;
}

// Read-only exact-email lookup used to resolve an existing Get Kinder user
// before assigning/changing their organization-scoped KAI role. This is
// deliberately NOT the mutating POST /api/admin/organizations/:id/admins
// endpoint - that grants organization-panel admin access as a side effect,
// which this workflow must never trigger merely to resolve an email.
export function adminUserLookupPath(email) {
  const normalized = String(email || "").trim().toLowerCase();
  return `/api/admin/users/lookup?email=${encodeURIComponent(normalized)}`;
}

// Package 2's membership PUT requires both role_name and membership_status
// on every call (Backend/kai/routes/kaiAccessAdministrationApi.js), and an
// explicit replacement (B/E C05) also names the exact existing assignment it
// replaces (previous_role_name). This builder is the single place that
// assembles that payload, and it refuses to build a request for anything
// outside the assignable roles or the two known membership statuses -
// defense in depth beyond the UI only ever rendering the offered roles.
export function buildKaiOrganizationMembershipPayload(
  roleName,
  membershipStatus = "active",
  { includeGkRoles = false, previousRoleName = null } = {}
) {
  if (!isAssignableKaiOrganizationRole(roleName, { includeGkRoles })) {
    throw new Error(`unsupported KAI organization role: ${roleName}`);
  }
  if (membershipStatus !== "active" && membershipStatus !== "inactive") {
    throw new Error(`unsupported KAI membership status: ${membershipStatus}`);
  }
  if (previousRoleName !== null && !isAssignableKaiOrganizationRole(previousRoleName, { includeGkRoles: true })) {
    throw new Error(`unsupported KAI organization role: ${previousRoleName}`);
  }
  return previousRoleName === null
    ? { role_name: roleName, membership_status: membershipStatus }
    : { role_name: roleName, membership_status: membershipStatus, previous_role_name: previousRoleName };
}

// B/E C04 additive grant (POST .../memberships/:legacyId/roles, body
// { role_name }) and C06 targeted revocation (POST
// .../memberships/:legacyId/roles/:roleName/revoke, no body).
export function kaiOrganizationRoleGrantPath(kaiOrganizationId, legacyPublicUserdataId) {
  return `${kaiOrganizationMembershipPath(kaiOrganizationId, legacyPublicUserdataId)}/roles`;
}

export function kaiOrganizationRoleRevokePath(kaiOrganizationId, legacyPublicUserdataId, roleName) {
  if (!isAssignableKaiOrganizationRole(roleName, { includeGkRoles: true })) {
    throw new Error(`unsupported KAI organization role: ${roleName}`);
  }
  return `${kaiOrganizationRoleGrantPath(kaiOrganizationId, legacyPublicUserdataId)}/${encodeURIComponent(roleName)}/revoke`;
}

// Repair 1 delegated GK staff onboarding: POST .../gk-staff ({ email,
// role_name }) or .../gk-staff/:legacyId ({ role_name }), and offboarding
// POST .../gk-staff/:legacyId/roles/:roleName/revoke (no body).
export function kaiOrganizationStaffPath(kaiOrganizationId, legacyPublicUserdataId = null) {
  const base = `${KAI_ACCESS_ADMINISTRATION_BASE_PATH}/organizations/${encodeURIComponent(kaiOrganizationId)}/gk-staff`;
  return legacyPublicUserdataId === null ? base : `${base}/${encodeURIComponent(legacyPublicUserdataId)}`;
}

export function kaiOrganizationStaffRevokePath(kaiOrganizationId, legacyPublicUserdataId, roleName) {
  return `${kaiOrganizationStaffPath(kaiOrganizationId, legacyPublicUserdataId)}/roles/${encodeURIComponent(roleName)}/revoke`;
}

export function buildKaiOrganizationRoleGrantPayload(roleName, { includeGkRoles = false } = {}) {
  if (!isAssignableKaiOrganizationRole(roleName, { includeGkRoles })) {
    throw new Error(`unsupported KAI organization role: ${roleName}`);
  }
  return { role_name: roleName };
}

// Package 2's platform-superuser-only global-role route
// (PUT .../global-roles/:legacyPublicUserdataId, manageGlobalKaiRole).
export function kaiGlobalRolePath(legacyPublicUserdataId) {
  return `${KAI_ACCESS_ADMINISTRATION_BASE_PATH}/global-roles/${encodeURIComponent(legacyPublicUserdataId)}`;
}

// The modal grants or revokes only the global gk_reviewer and gk_operator
// roles; gk_admin stays outside it.
export function buildKaiGlobalRolePayload(roleName, action) {
  if (!KAI_MODAL_GLOBAL_ROLE_OPTIONS.includes(roleName)) {
    throw new Error(`unsupported KAI global role: ${roleName}`);
  }
  if (action !== "assign" && action !== "revoke") {
    throw new Error(`unsupported KAI global role action: ${action}`);
  }
  return { role_name: roleName, action };
}

export function buildKaiGlobalReviewerRolePayload(action) {
  return buildKaiGlobalRolePayload(KAI_GK_REVIEWER_ROLE, action);
}

// Success text for the "Grant KAI Access" form. A Get Kinder organization
// role is one half of that staff member's access (the review cockpit and
// sensitivity reviews also need the matching global role), so it is not
// reported as complete access. A grant adds the role; it never replaces
// another role the person holds.
export function kaiOrganizationRoleGrantMessage(roleName, email) {
  if (roleName === KAI_GK_REVIEWER_ROLE) {
    return `Granted the gk_reviewer role in this organization to ${email}. Sensitivity reviews also need the global gk_reviewer role.`;
  }
  if (roleName === KAI_GK_OPERATOR_ROLE) {
    return `Granted the gk_operator role in this organization to ${email}. Source review also needs the global gk_operator role.`;
  }
  if (roleName === KAI_GK_ADMIN_ROLE) {
    return `Granted the gk_admin role in this organization to ${email}. Managing this organization's Get Kinder roles also needs the global gk_admin role.`;
  }
  return `Granted ${String(roleName).replace(/_/g, " ")} access to ${email}.`;
}

// The roster's global_kai_roles (present only for a platform-superuser
// reader) as the display list, or null when the server did not send it.
export function rosterGlobalKaiRoles(row) {
  return Array.isArray(row?.global_kai_roles) ? row.global_kai_roles : null;
}

// Presentation-only label for the roster's "Source" column. Never invents an
// authorization decision - it only describes which server-returned
// authority_source value ("stored" | "derived" | "both") produced the row's
// effective role, so derived Get Kinder org-admin authority stays visibly
// distinct from an editable stored KAI membership.
export function describeKaiAccessAuthoritySource(authoritySource) {
  if (authoritySource === "derived") return "Derived (Get Kinder org admin)";
  if (authoritySource === "both") return "Derived + stored";
  if (authoritySource === "stored") return "Stored";
  return "Unknown";
}

export function kaiAccessRowKey(row) {
  if (row?.legacy_public_userdata_id != null) return `legacy:${row.legacy_public_userdata_id}`;
  if (row?.kai_user_id) return `kai:${row.kai_user_id}`;
  return `email:${row?.email || "unknown"}`;
}
