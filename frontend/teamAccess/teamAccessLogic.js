// Team & Access (Impact Library): pure helpers for the organization-scoped
// roster and role changes. Every request goes to the existing Package 2
// access-administration routes through the path/payload builders in
// kaiOrganizationAccessLogic.js; nothing here decides authority. The
// Impact Library offers Team & Access only when the server's
// access-capabilities read reports organizationAccessManagement, and the
// access-administration service authorizes every read and change again.

import {
  KAI_ORGANIZATION_ROLE_OPTIONS,
  buildKaiOrganizationMembershipPayload,
  isAssignableKaiOrganizationRole,
  kaiAccessRowKey,
  kaiOrganizationAccessPath,
  kaiOrganizationMembershipPath,
} from "../kaiOrganizationAccessLogic.js";

export const TEAM_ACCESS_SECTION_KEY = "teamAccess";

export { KAI_ORGANIZATION_ROLE_OPTIONS as TEAM_ACCESS_ROLE_OPTIONS };

const ROLE_LABELS = Object.freeze({
  client_admin: "Administrator",
  client_reviewer: "Reviewer",
  client_contributor: "Contributor",
});

const ROLE_ORDER = Object.freeze({ client_admin: 0, client_reviewer: 1, client_contributor: 2 });

export function teamAccessRoleLabel(roleName) {
  if (Object.hasOwn(ROLE_LABELS, roleName)) return ROLE_LABELS[roleName];
  if (typeof roleName === "string" && roleName.startsWith("gk_")) return "Get Kinder staff";
  return "Other role";
}

export function teamAccessRosterPath(organizationId) {
  return kaiOrganizationAccessPath(organizationId);
}

export function teamAccessRoleChangeRequest(organizationId, member, roleName) {
  return {
    path: kaiOrganizationMembershipPath(organizationId, member.legacyUserId),
    body: buildKaiOrganizationMembershipPayload(roleName, "active"),
  };
}

function positiveInteger(value) {
  const number = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  return Number.isInteger(number) && number > 0 ? number : null;
}

function membershipOrNull(value) {
  if (!value || typeof value !== "object") return null;
  return {
    roleName: typeof value.role_name === "string" ? value.role_name : null,
    status: typeof value.membership_status === "string" ? value.membership_status : null,
  };
}

/**
 * One roster row per person from viewEffectiveKaiAccess. `inheritedAdmin`
 * is the derived Get Kinder organization-admin authority (never a stored KAI
 * membership, so a role change here cannot remove it). `canChangeRole` is the
 * server's own `editable` answer, narrowed to rows the membership route can
 * address (a stored client-role row with a legacy user id). Global KAI roles
 * are never projected.
 */
export function projectTeamAccessRoster(data) {
  const rows = Array.isArray(data?.access) ? data.access : [];
  const members = rows.map((row) => {
    const stored = membershipOrNull(row.stored_membership);
    const inheritedAdmin = Boolean(row.derived_membership) && row.derived_membership.membership_status === "active";
    const legacyUserId = positiveInteger(row.legacy_public_userdata_id);
    const effectiveRole = typeof row.effective_role_name === "string" ? row.effective_role_name : null;
    const effectiveStatus = typeof row.effective_membership_status === "string" ? row.effective_membership_status : null;
    return {
      key: kaiAccessRowKey(row),
      email: typeof row.email === "string" && row.email ? row.email : null,
      legacyUserId,
      effectiveRole,
      effectiveStatus,
      effectiveAdmin: effectiveRole === "client_admin" && effectiveStatus === "active",
      authoritySource: row.authority_source === "derived" || row.authority_source === "both" ? row.authority_source : "stored",
      storedRole: stored?.roleName ?? null,
      storedStatus: stored?.status ?? null,
      inheritedAdmin,
      canChangeRole: row.editable === true && Boolean(stored) && legacyUserId !== null && isAssignableKaiOrganizationRole(stored.roleName),
    };
  });
  members.sort((a, b) => {
    const activeOrder = Number(a.effectiveStatus !== "active") - Number(b.effectiveStatus !== "active");
    if (activeOrder !== 0) return activeOrder;
    const roleOrder = (ROLE_ORDER[a.effectiveRole] ?? 3) - (ROLE_ORDER[b.effectiveRole] ?? 3);
    if (roleOrder !== 0) return roleOrder;
    return String(a.email || "").localeCompare(String(b.email || ""));
  });
  return members;
}

export function memberDisplayName(member) {
  if (member?.email) return member.email;
  if (member?.legacyUserId) return `Get Kinder user #${member.legacyUserId}`;
  return "Unknown member";
}

export function describeMemberAuthority(member) {
  if (member.authoritySource === "derived") {
    return "Administrator through Get Kinder organization admin. Not a KAI membership, so it cannot be changed here.";
  }
  if (member.authoritySource === "both") {
    return "Also an administrator through Get Kinder organization admin. Changing the KAI role below does not remove that.";
  }
  return "";
}

// True when saving `nextRole` would end this member's administrator access.
// A member who is also an administrator through Get Kinder organization admin
// keeps it whatever their stored role, so this is false for them.
export function roleChangeRemovesAdministrator(member, nextRole) {
  if (!member || member.inheritedAdmin) return false;
  return member.storedRole === "client_admin" && member.storedStatus === "active" && nextRole !== "client_admin";
}

export function effectiveAdministratorCount(members) {
  return (Array.isArray(members) ? members : []).filter((member) => member.effectiveAdmin).length;
}

function firstBlockerReason(body) {
  const blockers = Array.isArray(body?.blockers) ? body.blockers : [];
  return typeof blockers[0]?.blocking_reason === "string" ? blockers[0].blocking_reason : "";
}

export function teamAccessErrorFromResult(result) {
  return {
    status: Number.isInteger(result?.statusCode) ? result.statusCode : 0,
    code: typeof result?.body?.error?.code === "string" ? result.body.error.code : "",
    blockingReason: firstBlockerReason(result?.body),
  };
}

export function describeTeamAccessReadError(failure) {
  if (failure.status === 401) return "Your session has ended. Sign in again to manage your team.";
  if (failure.status === 403) return "You do not have permission to manage team access for this organization.";
  return "Team members could not be loaded. Try again.";
}

export function describeRoleChangeError(failure) {
  if (failure.code === "last_admin_protection") {
    return "This is the organization's only administrator. Make someone else an administrator first.";
  }
  if (failure.blockingReason === "non_client_membership_not_client_managed") {
    return "Get Kinder manages this person's access. Contact a Get Kinder administrator to change it.";
  }
  if (failure.code === "membership_state_conflict") {
    return "This person's access changed or needs a Get Kinder administrator. Refresh and try again.";
  }
  if (failure.status === 401) return "Your session has ended. Sign in again to manage your team.";
  if (failure.status === 403) return "You do not have permission to change roles in this organization.";
  if (failure.status === 422) return "That role change is not allowed.";
  return "The role could not be changed. Try again.";
}

export function roleChangeSuccessMessage(member, roleName) {
  return `${memberDisplayName(member)} is now ${teamAccessRoleLabel(roleName) === "Administrator" ? "an administrator" : `a ${teamAccessRoleLabel(roleName).toLowerCase()}`}.`;
}
