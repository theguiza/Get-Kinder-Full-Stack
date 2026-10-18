// Team & Access (Impact Library): pure helpers for the organization-scoped
// roster and role changes. Every request goes to the existing Package 2
// access-administration routes through the path/payload builders in
// kaiOrganizationAccessLogic.js; nothing here decides authority. The
// Impact Library offers Team & Access only when the server's
// access-capabilities read reports organizationAccessManagement, and the
// access-administration service authorizes every read and change again.

import {
  KAI_ORGANIZATION_ROLE_OPTIONS,
  KAI_SUPERUSER_ORGANIZATION_ROLE_OPTIONS,
  adminUserLookupPath,
  kaiGlobalRolePath,
  buildKaiOrganizationMembershipPayload,
  buildKaiOrganizationRoleGrantPayload,
  isAssignableKaiOrganizationRole,
  kaiAccessRowKey,
  kaiOrganizationAccessPath,
  kaiOrganizationMembershipPath,
  kaiOrganizationRoleGrantPath,
  kaiOrganizationRoleRevokePath,
  kaiOrganizationStaffPath,
  kaiOrganizationStaffRevokePath,
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

// Prompt 4: the platform superuser's administration context (the
// organizations Team & Access may administer without a membership there).
export function teamAccessAdministrationContextPath() {
  return "/api/kai/sprint2/access-administration/administration-context";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GLOBAL_ROLES = Object.freeze(["gk_admin", "gk_operator", "gk_reviewer"]);
const knownGlobalRoles = (value) => (Array.isArray(value) ? GLOBAL_ROLES.filter((role) => value.includes(role)) : []);

export function projectTeamAccessAdministrationContext(data) {
  if (data?.platform_administration !== true) return { platformAdministration: false, organizations: [], assignableGlobalRoles: [] };
  return {
    platformAdministration: true,
    organizations: (Array.isArray(data.organizations) ? data.organizations : [])
      .filter((item) => typeof item?.organization_id === "string" && UUID_RE.test(item.organization_id))
      .map((item) => ({ organizationId: item.organization_id, name: typeof item.name === "string" && item.name ? item.name : item.organization_id })),
    assignableGlobalRoles: knownGlobalRoles(data.assignable_global_roles),
  };
}

// What each global Get Kinder role does, shown before a platform superuser
// confirms a grant. gk_admin is not a team-management-only role.
export const GLOBAL_ROLE_EXPLANATIONS = Object.freeze({
  gk_admin: "High-risk Get Kinder governance role. In every organization where this person also has access it counts as Get Kinder "
    + "administrator authority for the workspace, source and sensitivity review, evidence and claim review decisions, and reading "
    + "generated drafts and reporting packets. Together with an organization Get Kinder administrator assignment it lets them grant and "
    + "remove that organization's operator and reviewer roles, and that organization assignment also carries export, final "
    + "release and funder/public-ready decision authority. Each operation still applies its own content, eligibility and human-decision gates.",
  gk_operator: "Get Kinder operator capability. With access to an organization it opens the Get Kinder workspace and source and "
    + "sensitivity review; promoting a source also needs an organization Get Kinder role there. It gives no evidence or claim review decision.",
  gk_reviewer: "Get Kinder reviewer capability. With access to an organization it opens the Get Kinder workspace, source and "
    + "sensitivity review, evidence and claim review decisions, and reading generated drafts and reporting packets. Promoting a "
    + "source also needs an organization Get Kinder role there.",
});

// A platform superuser's grant or revocation of one global role (the existing
// superuser-only PUT .../global-roles/:legacyId). Refused here unless the
// server offered the role and the request matches what the person holds.
export function teamAccessGlobalRoleRequest(member, roleName, action, assignableGlobalRoles) {
  if (!GLOBAL_ROLES.includes(roleName) || !(assignableGlobalRoles || []).includes(roleName) || !Array.isArray(member?.globalRoles) || member.legacyUserId === null) {
    throw new Error(`unsupported KAI global role: ${roleName}`);
  }
  const holds = member.globalRoles.includes(roleName);
  if ((action === "assign" && holds) || (action === "revoke" && !holds) || (action !== "assign" && action !== "revoke")) {
    throw new Error(`unsupported KAI global role action: ${action}`);
  }
  return { path: kaiGlobalRolePath(member.legacyUserId), body: { role_name: roleName, action } };
}

// A platform superuser adding an existing Get Kinder account to the
// organization: the existing exact-email lookup, then the additive grant.
export function teamAccessAddPersonLookupPath(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) throw new Error("invalid_email");
  return adminUserLookupPath(normalized);
}

export function teamAccessAddPersonGrantRequest(organizationId, legacyUserId, roleName) {
  if (!KAI_SUPERUSER_ORGANIZATION_ROLE_OPTIONS.includes(roleName) || positiveInteger(legacyUserId) === null) {
    throw new Error(`unsupported KAI organization role: ${roleName}`);
  }
  return {
    path: kaiOrganizationRoleGrantPath(organizationId, positiveInteger(legacyUserId)),
    body: buildKaiOrganizationRoleGrantPayload(roleName, { includeGkRoles: true }),
  };
}

export const TEAM_ACCESS_SUPERUSER_ORGANIZATION_ROLE_OPTIONS = KAI_SUPERUSER_ORGANIZATION_ROLE_OPTIONS;

// Labels for the server's operation-readiness keys
// (kaiOrganizationAccessCapabilitiesService.computeOrganizationOperationReadiness).
const READINESS_LABELS = Object.freeze({
  gk_workspace: "Open the Get Kinder workspace (sources, evidence, claims, Review Queue)",
  generated_content_read: "Read generated drafts and reporting packets",
  evidence_processing: "Run evidence extraction and claim processing",
  draft_generation: "Generate internal evidence summaries and impact narratives",
  source_review: "Review and promote sources",
  sensitivity_review: "Record sensitivity and allowed-use reviews",
  evidence_review: "Record evidence review decisions",
  claim_review: "Record claim review decisions",
  coverage_acceptance: "Accept coverage limitations",
  generated_content_review: "Review generated drafts",
  export_release: "Export and release (content gates still apply)",
  delegated_administration: "Manage this organization's Get Kinder operator and reviewer roles",
});
const READINESS_CATEGORIES = new Set(["read", "process", "decide", "export", "administer"]);
const GRANTERS = Object.freeze({
  platform_superuser: "a platform administrator",
  delegated_gk_admin: "a Get Kinder administrator of this organization",
  delegated_gk_admin_staff_onboarding: "a Get Kinder administrator of this organization through staff onboarding (when the person has no access to another organization)",
  organization_client_admin: "an organization administrator",
});

export function teamAccessReadinessLabel(key) {
  return READINESS_LABELS[key] || key;
}

function projectReadiness(value) {
  if (!Array.isArray(value)) return null;
  return value
    .filter((item) => item && Object.hasOwn(READINESS_LABELS, item.key) && READINESS_CATEGORIES.has(item.category))
    .map((item) => ({
      key: item.key,
      category: item.category,
      ready: item.ready === true,
      missing: (Array.isArray(item.missing) ? item.missing : [])
        .filter((gap) => gap && ["global", "organization", "either"].includes(gap.scope))
        .map((gap) => ({
          scope: gap.scope,
          roles: (Array.isArray(gap.roles) ? gap.roles : []).filter((role) => typeof role === "string" && role.startsWith("gk_")),
          grantedBy: (Array.isArray(gap.granted_by) ? gap.granted_by : []).filter((by) => Object.hasOwn(GRANTERS, by)),
        })),
    }));
}

// One missing assignment, in words, with who can supply it.
export function describeReadinessGap(gap) {
  const roles = gap.roles.map(teamAccessRoleLabel).join(" or ");
  const what = gap.scope === "global"
    ? `a global ${roles} role`
    : gap.scope === "organization" ? `an organization ${roles} role here` : `a ${roles} role (global or in this organization)`;
  const who = gap.grantedBy.map((by) => GRANTERS[by]).join(" or ");
  return `Needs ${what}${who ? ` - assigned by ${who}` : ""}.`;
}

// After an organization role was added: the operations still blocked only by
// a missing global role (this organization's requirement is met), named with
// the role and who must assign it. Empty when nothing is incomplete.
export function teamAccessHandoffNotice(member) {
  const blocked = (member?.operationReadiness || []).filter((item) => !item.ready && item.missing.length > 0
    && item.missing.every((gap) => gap.scope === "global"));
  if (blocked.length === 0) return "";
  const roles = [...new Set(blocked.flatMap((item) => item.missing.flatMap((gap) => gap.roles)))].map(teamAccessRoleLabel);
  const operations = blocked.map((item) => teamAccessReadinessLabel(item.key).toLowerCase());
  return `Organization role assigned. A platform administrator must also assign a global ${roles.join(" or ")} role `
    + `before this person can ${operations.join("; ")}.`;
}

// Repair 1: delegated GK staff onboarding. The roles this administrator
// onboards (the server's staff_onboarding_roles answer: a delegated GK
// administrator's operator and reviewer roles), and each request builder
// refuses anything the server did not offer.
const STAFF_ROLES = Object.freeze(["gk_operator", "gk_reviewer"]);

export function projectTeamAccessStaffOnboardingRoles(data) {
  return Array.isArray(data?.staff_onboarding_roles) ? STAFF_ROLES.filter((role) => data.staff_onboarding_roles.includes(role)) : [];
}

function normalizedStaffEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(normalized)) throw new Error("invalid_email");
  return normalized;
}

// Add a person to the organization as Get Kinder staff by the exact email of
// their verified Get Kinder account.
export function teamAccessStaffOnboardingByEmailRequest(organizationId, email, roleName, staffOnboardingRoles) {
  if (!(staffOnboardingRoles || []).includes(roleName)) throw new Error(`unsupported KAI staff role: ${roleName}`);
  return { path: kaiOrganizationStaffPath(organizationId), body: { email: normalizedStaffEmail(email), role_name: roleName } };
}

// Onboard a person already on the roster: a staff role the server offered
// them (grantable or restorable), or completing one they hold whose
// onboarding is pending.
export function teamAccessStaffOnboardingRequest(organizationId, member, roleName, staffOnboardingRoles) {
  const offered = (member?.grantableRoles || []).includes(roleName)
    || (member?.assignments || []).some((assignment) => assignment.roleName === roleName && assignment.canRestore)
    || (member?.staffOnboarding || []).some((item) => item.roleName === roleName && item.status === "pending_completion");
  if (!(staffOnboardingRoles || []).includes(roleName) || !offered || member.legacyUserId === null) {
    throw new Error(`unsupported KAI staff role: ${roleName}`);
  }
  return { path: kaiOrganizationStaffPath(organizationId, member.legacyUserId), body: { role_name: roleName } };
}

export function teamAccessStaffOffboardingRequest(organizationId, member, roleName, staffOnboardingRoles) {
  if (!(staffOnboardingRoles || []).includes(roleName)
    || !(member?.assignments || []).some((assignment) => assignment.roleName === roleName && assignment.canRevoke)) {
    throw new Error(`unsupported KAI staff role: ${roleName}`);
  }
  return { path: kaiOrganizationStaffRevokePath(organizationId, member.legacyUserId, roleName), body: {} };
}

const STAFF_ONBOARDING_STATUSES = new Set(["complete", "pending_completion", "pending_platform_approval"]);

function projectStaffOnboarding(value) {
  if (!Array.isArray(value)) return null;
  return value
    .filter((item) => item && STAFF_ROLES.includes(item.role_name) && STAFF_ONBOARDING_STATUSES.has(item.status))
    .map((item) => ({ roleName: item.role_name, globalRole: STAFF_ROLES.includes(item.global_role) ? item.global_role : item.role_name, status: item.status }));
}

// One pending staff assignment, in words; empty once onboarding is complete.
export function staffOnboardingStatusText(item) {
  const globalLabel = `global ${teamAccessRoleLabel(item.globalRole)}`;
  if (item.status === "pending_completion") {
    return `Onboarding not finished: the ${globalLabel} role this work needs is not in place yet.`;
  }
  if (item.status === "pending_platform_approval") {
    return `Waiting for a platform administrator: this person also has KAI access in another organization, so the ${globalLabel} role needs platform approval.`;
  }
  return "";
}

// The server's answer to one onboarding: complete (the person can sign in and
// work now), or pending platform approval of the global role.
export function staffOnboardingResultMessage(data, displayName) {
  const roleLabel = teamAccessRoleLabel(data?.role_name);
  const globalLabel = `global ${teamAccessRoleLabel(data?.global_role?.role_name)}`;
  const who = displayName || "This person";
  if (data?.onboarding_status === "complete") {
    return `${who} is now a ${roleLabel} here with the ${globalLabel} role, and can sign in and start now.`;
  }
  return `${who} is now a ${roleLabel} here, but the ${globalLabel} role was not granted: they also have KAI access in another `
    + "organization, so a platform administrator must approve it.";
}

export function staffOffboardingResultMessage(data, displayName) {
  const roleLabel = teamAccessRoleLabel(data?.role_name);
  const globalLabel = `global ${teamAccessRoleLabel(data?.global_role?.role_name)}`;
  const who = displayName || "This person";
  const status = data?.global_role?.status;
  if (status === "revoked") return `${who} is no longer a ${roleLabel}, and the ${globalLabel} role was removed. Their other roles are unchanged.`;
  if (status === "retained" && data.global_role.reason === "required_by_another_assignment") {
    return `${who} is no longer a ${roleLabel} here. The ${globalLabel} role stays because another of their assignments needs it.`;
  }
  if (status === "retained") {
    return `${who} is no longer a ${roleLabel} here. The ${globalLabel} role stays because they have KAI access in another organization; `
      + "a platform administrator decides whether to remove it.";
  }
  return `${who} is no longer a ${roleLabel}. Their other roles are unchanged.`;
}

const STAFF_ONBOARDING_ERRORS = Object.freeze({
  target_account_not_found: "No Get Kinder account has that email. Ask the person to register at Get Kinder and verify their email, then add them.",
  target_account_not_verified: "That person has not verified their Get Kinder email yet. Ask them to finish verification, then try again.",
  target_account_suspended: "That Get Kinder account is suspended, so it cannot be given KAI access.",
  target_account_ambiguous: "More than one Get Kinder account uses that email. Ask Get Kinder support to resolve it first.",
  target_kai_account_inactive: "That person's KAI account is deactivated. A platform administrator must review it.",
  target_account_email_unusable: "This person's Get Kinder account has no usable email, so KAI access cannot be given yet.",
  staff_onboarding_role_not_permitted: "Staff onboarding gives only the Get Kinder operator or reviewer role.",
});

export function describeStaffOnboardingError(failure) {
  if (Object.hasOwn(STAFF_ONBOARDING_ERRORS, failure.blockingReason)) return STAFF_ONBOARDING_ERRORS[failure.blockingReason];
  if (failure.status === 422 && !failure.blockingReason) return "Enter the exact email of the person's verified Get Kinder account.";
  return describeRoleChangeError(failure);
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
      // Raw global KAI roles: only in a platform superuser's roster.
      globalRoles: Array.isArray(row.global_kai_roles) ? knownGlobalRoles(row.global_kai_roles) : null,
      // Operation readiness: only for an administrator of Get Kinder roles.
      operationReadiness: projectReadiness(row.operation_readiness),
      // Staff onboarding state of each active operator/reviewer assignment
      // (administrators of Get Kinder roles only).
      staffOnboarding: projectStaffOnboarding(row.staff_onboarding),
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

// The roster-level answers: whether this reader sees global roles (platform
// superuser) and which global roles it may grant or revoke.
export function projectTeamAccessGlobalAdministration(data) {
  return {
    globalRolesVisible: data?.global_roles_visible === true,
    assignableGlobalRoles: data?.global_roles_visible === true ? knownGlobalRoles(data?.assignable_global_roles) : [],
  };
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

export function describeGlobalRoleError(failure) {
  if (failure.blockingReason === "platform_superuser_required") return "Only a platform administrator can change global Get Kinder roles.";
  if (failure.blockingReason === "target_account_email_unusable") return "This person's Get Kinder account has no usable email, so KAI access cannot be given yet.";
  if (failure.status === 401) return "Your session has ended. Sign in again.";
  if (failure.status === 422) return "That global role change is not allowed.";
  return "The global role could not be changed. Try again.";
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
