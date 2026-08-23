// Organization-scoped KAI role management: pure path/shape helpers for the
// existing /admin -> Organizations "KAI Access" modal
// (frontend/adminDashboard.jsx). Network calls themselves are made by
// adminDashboard.jsx using its own requestJson/mutateJson-style
// conventions; this module holds only the parts that are safe and useful to
// unit-test without rendering React.
//
// The role list mirrors Backend/kai/config/kaiAccessAdministrationContract.js
// KAI_ASSIGNABLE_ORGANIZATION_ROLES exactly - this file must never invent an
// additional or divergent role set. Package 2's mounted route is the single
// authority for the actual request/response contract
// (Backend/kai/routes/kaiAccessAdministrationApi.js); the paths below are
// built to match that router's exact mount and param names.

export const KAI_ORGANIZATION_ROLE_OPTIONS = Object.freeze([
  "client_admin",
  "client_reviewer",
  "client_contributor",
]);

const KAI_ACCESS_ADMINISTRATION_BASE_PATH = "/api/kai/sprint2/access-administration";

export function isAssignableKaiOrganizationRole(roleName) {
  return KAI_ORGANIZATION_ROLE_OPTIONS.includes(roleName);
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
// on every call (Backend/kai/routes/kaiAccessAdministrationApi.js). This
// builder is the single place that assembles that payload, and it refuses
// to build a request for anything outside the three assignable client
// roles or the two known membership statuses - defense in depth beyond the
// UI only ever rendering a <select> of the same three roles.
export function buildKaiOrganizationMembershipPayload(roleName, membershipStatus = "active") {
  if (!isAssignableKaiOrganizationRole(roleName)) {
    throw new Error(`unsupported KAI organization role: ${roleName}`);
  }
  if (membershipStatus !== "active" && membershipStatus !== "inactive") {
    throw new Error(`unsupported KAI membership status: ${membershipStatus}`);
  }
  return { role_name: roleName, membership_status: membershipStatus };
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
