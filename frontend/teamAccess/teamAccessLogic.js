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
  buildKaiOrganizationRoleGrantPayload,
  isAssignableKaiOrganizationRole,
  kaiAccessRowKey,
  kaiOrganizationAccessPath,
  kaiOrganizationMembershipPath,
  kaiOrganizationRoleGrantPath,
  kaiOrganizationRoleRevokePath,
} from "../kaiOrganizationAccessLogic.js";

export const TEAM_ACCESS_SECTION_KEY = "teamAccess";

export { KAI_ORGANIZATION_ROLE_OPTIONS as TEAM_ACCESS_ROLE_OPTIONS };

const ROLE_LABELS = Object.freeze({
  client_admin: "Administrator",
  client_reviewer: "Reviewer",
  client_contributor: "Contributor",
  gk_admin: "Get Kinder administrator",
  gk_operator: "Get Kinder operator",
  gk_reviewer: "Get Kinder reviewer",
});

const ROLE_ORDER = Object.freeze({ client_admin: 0, client_reviewer: 1, client_contributor: 2, gk_admin: 3, gk_operator: 4, gk_reviewer: 5 });

export function teamAccessRoleLabel(roleName) {
  if (Object.hasOwn(ROLE_LABELS, roleName)) return ROLE_LABELS[roleName];
  if (typeof roleName === "string" && roleName.startsWith("gk_")) return "Get Kinder staff";
  return "Other role";
}

export function teamAccessRosterPath(organizationId) {
  return kaiOrganizationAccessPath(organizationId);
}

// Explicit replacement (B/E C05) of the member's addressed assignment
// (storedRole) with one of the roles the server offered for it.
export function teamAccessRoleChangeRequest(organizationId, member, roleName) {
  if (!Array.isArray(member?.roleOptions) || !member.roleOptions.includes(roleName)) {
    throw new Error(`unsupported KAI organization role: ${roleName}`);
  }
  return {
    path: kaiOrganizationMembershipPath(organizationId, member.legacyUserId),
    body: buildKaiOrganizationMembershipPayload(roleName, "active", { includeGkRoles: true, previousRoleName: member.storedRole }),
  };
}

// Additive grant (B/E C04) of a role the server offered for this member, or
// restoring one of their inactive assignments the server marked restorable.
export function teamAccessRoleGrantRequest(organizationId, member, roleName) {
  const restorable = (member?.assignments || []).some((assignment) => assignment.roleName === roleName && assignment.canRestore);
  if (!restorable && !(member?.grantableRoles || []).includes(roleName)) {
    throw new Error(`unsupported KAI organization role: ${roleName}`);
  }
  return {
    path: kaiOrganizationRoleGrantPath(organizationId, member.legacyUserId),
    body: buildKaiOrganizationRoleGrantPayload(roleName, { includeGkRoles: true }),
  };
}

// Targeted revocation (B/E C06) of one assignment the server marked revocable.
export function teamAccessRoleRevokeRequest(organizationId, member, roleName) {
  if (!(member?.assignments || []).some((assignment) => assignment.roleName === roleName && assignment.canRevoke)) {
    throw new Error(`unsupported KAI organization role: ${roleName}`);
  }
  return { path: kaiOrganizationRoleRevokePath(organizationId, member.legacyUserId, roleName), body: {} };
}

function positiveInteger(value) {
  const number = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  return Number.isInteger(number) && number > 0 ? number : null;
}

const knownRoles = (value) => (Array.isArray(value) ? value.filter((role) => isAssignableKaiOrganizationRole(role, { includeGkRoles: true })) : []);

// Every stored assignment of one person, each with the server's answer to
// what this administrator may do with it. A reader that predates
// stored_memberships still gets its single stored_membership.
function assignmentsOf(row) {
  const stored = Array.isArray(row.stored_memberships)
    ? row.stored_memberships
    : row.stored_membership && typeof row.stored_membership === "object" ? [row.stored_membership] : [];
  return stored
    .filter((value) => value && typeof value === "object" && typeof value.role_name === "string")
    .map((value) => ({
      roleName: value.role_name,
      status: typeof value.membership_status === "string" ? value.membership_status : null,
      replacementRoles: knownRoles(value.replacement_roles),
      canRevoke: value.can_revoke === true,
      canRestore: value.can_restore === true,
    }));
}

const ACCOUNT_STATUSES = new Set(["active", "inactive", "not_activated"]);

/**
 * The member as seen by one assignment's editor: storedRole/storedStatus,
 * roleOptions, and canChangeRole all describe that one assignment, so the
 * role-change helpers below address exactly it.
 */
export function teamAccessAssignmentMember(member, assignment) {
  return {
    ...member,
    storedRole: assignment?.roleName ?? null,
    storedStatus: assignment?.status ?? null,
    roleOptions: assignment ? [assignment.roleName, ...assignment.replacementRoles] : [],
    canChangeRole: Boolean(assignment) && member.legacyUserId !== null &&
      (assignment.replacementRoles.length > 0 || assignment.canRestore),
  };
}

/**
 * One roster row per person from viewEffectiveKaiAccess. `inheritedAdmin`
 * is the derived Get Kinder organization-admin authority (never a stored KAI
 * membership, so a role change here cannot remove it). `effectiveRole` is the
 * person's leading effective role and `effectiveRoles` every role whose own
 * assignment is active (B/E C04); `assignments` are their stored assignments
 * with the server's per-assignment answers (replacement roles, revoke,
 * restore) and `grantableRoles` the Get Kinder staff roles this administrator
 * may add.
 * `effectiveAdmin` and `lastAdminProtected` are the server's answers to
 * whether they can administer right now (their KAI account must be active)
 * and whether the last-administrator protection would refuse removing their
 * stored administrator role. storedRole/storedStatus/roleOptions/
 * canChangeRole describe the member's first changeable assignment (else
 * their first). Global KAI roles are never projected.
 */
export function projectTeamAccessRoster(data) {
  const rows = Array.isArray(data?.access) ? data.access : [];
  const members = rows.map((row) => {
    const assignments = assignmentsOf(row);
    const inheritedAdmin = Boolean(row.derived_membership) && row.derived_membership.membership_status === "active";
    const legacyUserId = positiveInteger(row.legacy_public_userdata_id);
    const effectiveRole = typeof row.effective_role_name === "string" ? row.effective_role_name : null;
    const effectiveStatus = typeof row.effective_membership_status === "string" ? row.effective_membership_status : null;
    const member = {
      key: kaiAccessRowKey(row),
      email: typeof row.email === "string" && row.email ? row.email : null,
      legacyUserId,
      effectiveRole,
      effectiveRoles: Array.isArray(row.effective_role_names)
        ? row.effective_role_names.filter((role) => typeof role === "string")
        : effectiveRole && effectiveStatus === "active" ? [effectiveRole] : [],
      effectiveStatus,
      accountStatus: ACCOUNT_STATUSES.has(row.kai_account_status) ? row.kai_account_status : null,
      effectiveAdmin: row.effective_admin_authority === true,
      lastAdminProtected: row.last_admin_protected === true,
      authoritySource: row.authority_source === "derived" || row.authority_source === "both" ? row.authority_source : "stored",
      inheritedAdmin,
      isActor: row.is_actor === true,
      assignments,
      // Team & Access adds Get Kinder staff roles only; a client role keeps
      // the one-role change control (an explicit replacement) above.
      grantableRoles: legacyUserId === null
        ? []
        : knownRoles(row.grantable_roles).filter((role) => !KAI_ORGANIZATION_ROLE_OPTIONS.includes(role)),
    };
    const addressed = assignments.find((assignment) => assignment.replacementRoles.length > 0 || assignment.canRestore) || assignments[0] || null;
    return teamAccessAssignmentMember(member, addressed);
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

// The roles this administrator may manage in the organization (the server's
// administrable_roles answer), for the role legend.
export function projectTeamAccessAdministrableRoles(data) {
  return knownRoles(data?.administrable_roles);
}

export function memberDisplayName(member) {
  if (member?.email) return member.email;
  if (member?.legacyUserId) return `Get Kinder user #${member.legacyUserId}`;
  return "Unknown member";
}

// Why a person who holds a role cannot use KAI right now, from the server's
// account status; empty while their account is active.
export function teamAccessAccountStatusLabel(member) {
  if (member?.accountStatus === "inactive") return "KAI account inactive";
  if (member?.accountStatus === "not_activated") return "KAI access not yet activated";
  return "";
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

// True when the server reported, on the last roster read, that its
// last-administrator protection would refuse this change. The server
// decides again on save.
export function roleChangeBlockedAsLastAdministrator(member, nextRole) {
  return Boolean(member?.lastAdminProtected) && nextRole !== "client_admin";
}

export const LAST_ADMINISTRATOR_MESSAGE =
  "No other administrator can currently manage this organization. Make someone else an administrator first.";

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
    return `This change was not made. ${LAST_ADMINISTRATOR_MESSAGE}`;
  }
  if (failure.blockingReason === "non_client_membership_not_client_managed") {
    return "Get Kinder manages this person's access. Contact a Get Kinder administrator to change it.";
  }
  if (failure.blockingReason === "self_role_elevation_not_allowed") {
    return "You cannot add to or raise your own roles. Ask another administrator.";
  }
  if (failure.blockingReason === "organization_role_not_administrable") {
    return "Your administrator role does not manage this role.";
  }
  if (failure.code === "membership_state_conflict" || failure.code === "not_found") {
    return "This person's access changed or needs a Get Kinder administrator. Refresh and try again.";
  }
  if (failure.status === 401) return "Your session has ended. Sign in again to manage your team.";
  if (failure.status === 403) return "You do not have permission to change roles in this organization.";
  if (failure.status === 422) return "That role change is not allowed.";
  return "The role could not be changed. Try again.";
}

function withArticle(roleName) {
  const label = teamAccessRoleLabel(roleName);
  if (label === "Administrator") return "an administrator";
  return `a ${String(roleName).startsWith("gk_") ? label : label.toLowerCase()}`;
}

export function roleChangeSuccessMessage(member, roleName) {
  return `${memberDisplayName(member)} is now ${withArticle(roleName)}.`;
}

export function roleGrantSuccessMessage(member, roleName) {
  return `${memberDisplayName(member)} is now also ${withArticle(roleName)}.`;
}

export function roleRevokeSuccessMessage(member, roleName) {
  return `${memberDisplayName(member)} is no longer ${withArticle(roleName)}. Their other roles are unchanged.`;
}

// True when removing `roleName` would end this member's administrator
// access (same rule as a role change).
export function roleRevokeRemovesAdministrator(member, roleName) {
  if (!member || member.inheritedAdmin || roleName !== "client_admin") return false;
  return (member.assignments || []).some((assignment) => assignment.roleName === "client_admin" && assignment.status === "active");
}
