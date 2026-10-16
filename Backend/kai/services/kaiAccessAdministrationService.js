import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import {
  KAI_ACCESS_ADMINISTRATION_OPERATIONS,
  KAI_ASSIGNABLE_ORGANIZATION_ROLES,
  KAI_PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLES,
  KAI_DELEGATED_GK_ADMINISTRATOR_ROLE,
  KAI_DELEGATED_GK_ADMIN_ASSIGNABLE_ORGANIZATION_ROLES,
  KAI_ASSIGNABLE_GLOBAL_ROLES,
  KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS,
  KAI_INACTIVE_ORGANIZATION_MEMBERSHIP_STATUS,
  KAI_STAFF_ONBOARDING_ROLES,
  KAI_STAFF_ONBOARDING_GLOBAL_ROLE_BY_ORGANIZATION_ROLE,
} from "../config/kaiAccessAdministrationContract.js";
import {
  validateActorCanPerformOperation,
  validateActorCanPerformPlatformOperation,
  hasPlatformSuperuserAuthority,
} from "../auth/kaiAuthorizationService.js";
import { withTransaction } from "../db/kaiDb.js";
import {
  listOrganizationMembershipRowsForOrganization,
  listOrganizationMembershipRowsForUserInOrganization,
  countActiveStoredClientAdminMemberships,
  upsertOrganizationMembershipRoleStatus,
  grantOrganizationMembershipRole,
  revokeOrganizationMembershipRole,
  assignGlobalRole,
  revokeGlobalRole,
  listGlobalRoleAssignmentRows,
  findOrCreateKaiUserForAdministrationTarget,
  listOrganizationsForPlatformAdministration,
  listStaffAccountsByExactEmail,
  getStaffAccountById,
} from "../db/kaiAccessAdministrationQueries.js";
import {
  findKaiUserByLegacyPublicUserdataId,
  listKaiRolesForUser,
  listOrganizationMembershipsForUser,
} from "../db/kaiQueries.js";
import {
  getActiveGkOrganizationIdForKaiOrganization,
  listActiveGkOrganizationAdminLegacyUserIds,
  hasActiveDerivedClientAdminForOrganization,
} from "../auth/gkOrganizationAdminQueries.js";
import { resolveEffectiveClientOrganizationMembershipsForLegacyUser } from "../auth/gkOrganizationBindingAuthority.js";
import { createProductionMetadataOnlyAuditForAccessAdministration } from "./kaiMetadataOnlyAuditComposition.js";

const {
  VIEW_KAI_ACCESS,
  MANAGE_ORGANIZATION_MEMBERSHIP,
  MANAGE_GLOBAL_KAI_ROLE,
  VIEW_PLATFORM_ACCESS_ADMINISTRATION,
} = KAI_ACCESS_ADMINISTRATION_OPERATIONS;

const ASSIGNABLE_ORGANIZATION_ROLE_SET = new Set(KAI_ASSIGNABLE_ORGANIZATION_ROLES);
const PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLE_SET = new Set(KAI_PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLES);
const DELEGATED_GK_ADMIN_ASSIGNABLE_ORGANIZATION_ROLE_SET = new Set(KAI_DELEGATED_GK_ADMIN_ASSIGNABLE_ORGANIZATION_ROLES);
const ASSIGNABLE_GLOBAL_ROLE_SET = new Set(KAI_ASSIGNABLE_GLOBAL_ROLES);
const STAFF_ONBOARDING_ROLE_SET = new Set(KAI_STAFF_ONBOARDING_ROLES);
const STAFF_ONBOARDING_VALIDATOR_KEY = "VAL-KAI-P2-ACC-003";
// The authorities that may onboard Get Kinder staff (never organization_client_admin).
const STAFF_ONBOARDING_AUTHORITIES = new Set(["delegated_gk_admin", "platform_superuser"]);
// The organization roles that can make a non-superuser an organization-role
// administrator at all; resolveOrganizationRoleAdministration decides which
// roles each one actually administers.
const ORGANIZATION_ROLE_ADMINISTRATOR_ROLES = new Set(["client_admin", KAI_DELEGATED_GK_ADMINISTRATOR_ROLE]);
// Client role order, used only to recognize an administrator's own demotion.
const CLIENT_ROLE_RANK = Object.freeze({ client_admin: 3, client_reviewer: 2, client_contributor: 1 });

class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

function failure(code, extra = {}) {
  return { ok: false, data: null, error: { code, ...extra } };
}

function success(data, warnings = []) {
  return { ok: true, data, error: null, warnings };
}

function authorizationFailure(authResult) {
  return {
    ok: false,
    data: null,
    error: { code: authResult.error_code },
    blockers: authResult.blockers || [],
  };
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

async function publishRequiredAudit(auditFactory, payload, tx) {
  const prepared = auditFactory.prepareMetadataOnlyAudit({ payload, db: tx });
  if (!prepared || prepared.ok !== true || typeof prepared.publish !== "function") {
    throw new RequiredAuditRejectedError();
  }
  await prepared.publish();
}

/**
 * Maps a writer's target to kai.users before any membership or role write.
 * A target with no mapping whose Get Kinder account has no email the
 * deployed kai.users contract accepts gets none: the resolver returns null
 * when the email is missing or blank, and a rejected JIT insert (tagged
 * kaiUserProvisioningFailed) has already rolled back its own transaction.
 * As on actor resolution, only PostgreSQL diagnostic identifiers are
 * logged, never the message, which may echo the email.
 */
async function resolveAdministrationTarget(findOrCreateTarget, legacyPublicUserdataId) {
  try {
    return await findOrCreateTarget({ legacyPublicUserdataId });
  } catch (error) {
    if (!error?.kaiUserProvisioningFailed) throw error;
    console.error("[kai-access-administration] target kai.users provisioning failed", {
      code: error.cause?.code || null,
      constraint: error.cause?.constraint || null,
      column: error.cause?.column || null,
      table: error.cause?.table || null,
    });
    return null;
  }
}

function targetAccountEmailUnusable(validatorKey) {
  return {
    ok: false,
    data: null,
    error: { code: "validation_blocker" },
    blockers: [
      {
        validator_key: validatorKey,
        severity: "blocker",
        object_type: "kai_user",
        object_id: null,
        message: "This person's Get Kinder account has no email address KAI can use, so KAI access cannot be given yet.",
        blocking_reason: "target_account_email_unusable",
        required_fix: "Give the person's Get Kinder account a valid email address, then try again.",
        evidence: {},
      },
    ],
  };
}

function shapeThrownError(error) {
  if (error instanceof RequiredAuditRejectedError) return failure("validation_blocker");
  if (error?.code === "23514" || error?.code === "22P02") return failure("validation_blocker");
  return failure("system_error");
}

function membershipBlocker(blockingReason, message, requiredFix) {
  return {
    validator_key: "VAL-KAI-P2-ACC-001",
    severity: "blocker",
    object_type: "organization_membership",
    object_id: null,
    message,
    blocking_reason: blockingReason,
    required_fix: requiredFix,
    evidence: {},
  };
}

function membershipRefusal(code, blocker) {
  return { ok: false, data: null, error: { code }, blockers: [blocker] };
}

/**
 * The organization roles this actor may grant, replace, and revoke in
 * exactly organizationId, each with the authority it comes from (owner
 * decision B/E, 2026-10-15). The tenant/actor checks are the shared
 * validateActorCanPerformOperation call; this only narrows the roles:
 * - platform superuser: every superuser-assignable organization role;
 * - effective client_admin (stored or binding-derived): the client roles;
 * - global gk_admin AND an active stored gk_admin membership of this
 *   organization: gk_operator and gk_reviewer.
 * An organization gk_admin membership without the global role, or a global
 * role without that membership, administers nothing.
 */
export function resolveOrganizationRoleAdministration(actorContext, operation, organizationId) {
  if (actorContext?.actorType !== "human") return { ok: false, error_code: "authorization_denied", blockers: [] };
  const authResult = validateActorCanPerformOperation(actorContext, operation, organizationId, {
    allowedRoles: ORGANIZATION_ROLE_ADMINISTRATOR_ROLES,
  });
  if (!authResult.ok) return authResult;

  const authorityByRole = new Map();
  if (authResult.platformSuperuserAuthorized) {
    for (const role of PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLE_SET) authorityByRole.set(role, "platform_superuser");
    return { ok: true, platformSuperuserAuthorized: true, authorityByRole };
  }

  const heldOrganizationRoles = new Set(authResult.memberships.map((membership) => membership.role_name));
  if (heldOrganizationRoles.has("client_admin")) {
    for (const role of ASSIGNABLE_ORGANIZATION_ROLE_SET) authorityByRole.set(role, "organization_client_admin");
  }
  if (
    heldOrganizationRoles.has(KAI_DELEGATED_GK_ADMINISTRATOR_ROLE) &&
    (actorContext.kaiRoles || []).includes(KAI_DELEGATED_GK_ADMINISTRATOR_ROLE)
  ) {
    for (const role of DELEGATED_GK_ADMIN_ASSIGNABLE_ORGANIZATION_ROLE_SET) authorityByRole.set(role, "delegated_gk_admin");
  }
  if (authorityByRole.size === 0) {
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
          required_fix: "Organization gk_admin administers Get Kinder roles only together with the global gk_admin role.",
          evidence: { bypass_allowed: false },
        },
      ],
    };
  }
  return { ok: true, platformSuperuserAuthorized: false, authorityByRole };
}

/**
 * True when the actor's organization role administration (any operation)
 * is admitted for this organization - the access-capabilities read reports
 * this as organizationAccessManagement.
 */
export function hasOrganizationRoleAdministrationAuthority(actorContext, organizationId) {
  return (
    resolveOrganizationRoleAdministration(actorContext, VIEW_KAI_ACCESS, organizationId).ok === true &&
    resolveOrganizationRoleAdministration(actorContext, MANAGE_ORGANIZATION_MEMBERSHIP, organizationId).ok === true
  );
}

function roleNotAdministrable(roleName, authorityByRole) {
  const administersGkRoles = [...authorityByRole.values()].some((authority) => authority !== "organization_client_admin");
  if (!ASSIGNABLE_ORGANIZATION_ROLE_SET.has(roleName) && !administersGkRoles) {
    return membershipRefusal("authorization_denied", membershipBlocker(
      "non_client_membership_not_client_managed",
      "This membership is managed by Get Kinder, not by the organization.",
      "Ask a Get Kinder administrator to change this membership.",
    ));
  }
  return membershipRefusal("authorization_denied", membershipBlocker(
    "organization_role_not_administrable",
    "Your administrator role does not manage this role.",
    "Ask an administrator who manages this role to change it.",
  ));
}

function selfRoleElevationRefused() {
  return membershipRefusal("authorization_denied", membershipBlocker(
    "self_role_elevation_not_allowed",
    "You cannot add to or raise your own roles.",
    "Ask another administrator to make this change.",
  ));
}

// The only own-role changes a non-superuser administrator may make: leaving
// an active assignment (to inactive), or moving it to a lower client role.
function isOwnDemotion(previousRow, roleName, membershipStatus) {
  if (previousRow?.membership_status !== KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS) return false;
  if (membershipStatus === KAI_INACTIVE_ORGANIZATION_MEMBERSHIP_STATUS) return true;
  return Object.hasOwn(CLIENT_ROLE_RANK, roleName) &&
    Object.hasOwn(CLIENT_ROLE_RANK, previousRow.role_name) &&
    CLIENT_ROLE_RANK[roleName] < CLIENT_ROLE_RANK[previousRow.role_name];
}

function auditAuthority(...authorities) {
  return [...new Set(authorities.filter(Boolean))].join(",") || null;
}

/**
 * Last-administrator protection: refuses (outside platform-superuser
 * authority) a change that ends the target's active stored client_admin
 * assignment while no other effective administrator remains - a derived one
 * (not touched by a stored-role change, so it may be the target itself) or a
 * stored one other than the target. Both helpers count only identities that
 * can actually exercise client_admin (active public.userdata mapping), and
 * the caller holds the organization lock, which serializes competing changes.
 */
async function refusesLastAdministrator(tx, { organizationId, targetUserId, endsActiveClientAdmin, platformSuperuserAuthorized }, dependencies) {
  if (!endsActiveClientAdmin || platformSuperuserAuthorized) return false;
  const countActiveAdmins = dependencies.countActiveStoredClientAdminMemberships || countActiveStoredClientAdminMemberships;
  const hasDerivedAdmin = dependencies.hasActiveDerivedClientAdminForOrganization || hasActiveDerivedClientAdminForOrganization;
  if (await hasDerivedAdmin(organizationId, tx)) return false;
  const remainingStoredAdmins = await countActiveAdmins(organizationId, tx, { excludingUserId: targetUserId });
  return remainingStoredAdmins === 0;
}

async function lockOrganizationAdministration(tx, organizationId) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `kai_org_admin_lock:${organizationId}`,
  ]);
}

// Serializes every write that can give one person organization access with
// staff onboarding's check of where that person's global role would take
// effect, so a concurrent first grant in another organization cannot slip
// between the check and the global-role write. Always taken after the
// organization lock.
async function lockUserAccessAdministration(tx, userId) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `kai_user_access_admin_lock:${userId}`,
  ]);
}

function staffOnboardingBlocker(blockingReason, message, requiredFix, evidence = {}) {
  return {
    validator_key: STAFF_ONBOARDING_VALIDATOR_KEY,
    severity: "blocker",
    object_type: "kai_user",
    object_id: null,
    message,
    blocking_reason: blockingReason,
    required_fix: requiredFix,
    evidence: { bypass_allowed: false, ...evidence },
  };
}

function staffOnboardingRefusal(code, blocker) {
  return { ok: false, data: null, error: { code }, blockers: [blocker] };
}

const ACCOUNT_REGISTRATION_FIX =
  "Ask the person to create a Get Kinder account and verify its email address, then add them with that exact email.";

/**
 * The Get Kinder account a delegated GK staff grant may be given to: exactly
 * one account (by id, or by exact normalized email - an email two accounts
 * share is refused, never resolved by picking one), its email verified, and
 * not suspended - the same conditions Get Kinder login and the authenticated
 * API gate already enforce. Nothing is created here; a person without an
 * account must first register and verify through Get Kinder.
 */
async function resolveEligibleStaffAccount({ legacyPublicUserdataId = null, email = null }, dependencies) {
  let account;
  if (email !== null) {
    const listByEmail = dependencies.listStaffAccountsByExactEmail || listStaffAccountsByExactEmail;
    const rows = await listByEmail(email);
    if (Array.isArray(rows) && rows.length > 1) {
      return { ok: false, refusal: staffOnboardingRefusal("validation_blocker", staffOnboardingBlocker(
        "target_account_ambiguous",
        "More than one Get Kinder account uses this email address, so KAI cannot tell which person to add.",
        "Ask Get Kinder support to resolve the duplicate accounts, then try again.",
      )) };
    }
    account = Array.isArray(rows) ? rows[0] || null : null;
  } else {
    const getById = dependencies.getStaffAccountById || getStaffAccountById;
    account = await getById(legacyPublicUserdataId);
  }
  if (!isPositiveInteger(Number(account?.id))) {
    return { ok: false, refusal: staffOnboardingRefusal("not_found", staffOnboardingBlocker(
      "target_account_not_found",
      "No Get Kinder account was found for this person.",
      ACCOUNT_REGISTRATION_FIX,
    )) };
  }
  if (account.is_suspended === true) {
    return { ok: false, refusal: staffOnboardingRefusal("validation_blocker", staffOnboardingBlocker(
      "target_account_suspended",
      "This Get Kinder account is suspended, so it cannot be given KAI access.",
      "Resolve the account suspension with Get Kinder support first.",
    )) };
  }
  if (account.email_verified !== true) {
    return { ok: false, refusal: staffOnboardingRefusal("validation_blocker", staffOnboardingBlocker(
      "target_account_not_verified",
      "This person has not verified their Get Kinder email address yet, so KAI access cannot be given.",
      "Ask the person to finish Get Kinder email verification (the link in their registration email), then try again.",
    )) };
  }
  return { ok: true, legacyPublicUserdataId: Number(account.id) };
}

/**
 * The person's kai.users identity for staff onboarding: the existing mapping,
 * or the same JIT mapping their first sign-in would create. A mapping that
 * is not an active public.userdata identity cannot act (resolveKaiActorContext
 * refuses it) and is never resurrected here.
 */
async function resolveStaffKaiUser(legacyPublicUserdataId, dependencies) {
  const findOrCreateTarget = dependencies.findOrCreateKaiUserByLegacyPublicUserdataId || findOrCreateKaiUserForAdministrationTarget;
  const kaiUser = await resolveAdministrationTarget(findOrCreateTarget, legacyPublicUserdataId);
  if (!kaiUser?.user_id) return { ok: false, refusal: targetAccountEmailUnusable(STAFF_ONBOARDING_VALIDATOR_KEY) };
  const canAct = kaiUser.status === "active" &&
    kaiUser.legacy_identity_source === "public.userdata" &&
    String(kaiUser.legacy_public_userdata_id) === String(legacyPublicUserdataId);
  if (!canAct) {
    return { ok: false, refusal: staffOnboardingRefusal("validation_blocker", staffOnboardingBlocker(
      "target_kai_account_inactive",
      "This person's KAI account is deactivated, so KAI access cannot be given.",
      "A platform administrator must review the deactivated KAI account.",
    )) };
  }
  return { ok: true, kaiUser };
}

/**
 * Where a global KAI role given to this person would take effect besides
 * organizationId. Every reader of global roles first requires active access
 * to the exact organization (validateActorCanPerformOperation), so a global
 * role reaches exactly the organizations where the person has active access:
 * their active stored memberships of any role, and the binding-derived
 * client_admin access sign-in derives (the same resolver, so the answer
 * matches what their next request will carry). Only whether such access
 * exists is reported - never which organizations.
 */
async function findGlobalRoleReachOutsideOrganization({ kaiUserId, legacyPublicUserdataId, organizationId }, db, dependencies) {
  const listMemberships = dependencies.listOrganizationMembershipsForUser || listOrganizationMembershipsForUser;
  const resolveDerived = dependencies.resolveEffectiveClientOrganizationMembershipsForLegacyUser ||
    resolveEffectiveClientOrganizationMembershipsForLegacyUser;
  const outside = (membership) => membership?.membership_status === KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS &&
    String(membership.organization_id) !== String(organizationId);
  const stored = await listMemberships(kaiUserId, db);
  const derived = await resolveDerived(legacyPublicUserdataId, dependencies);
  const storedElsewhere = (Array.isArray(stored) ? stored : []).some(outside);
  const bindingDerivedElsewhere = (Array.isArray(derived) ? derived : []).some(outside);
  return { reachesOtherOrganization: storedElsewhere || bindingDerivedElsewhere, storedElsewhere, bindingDerivedElsewhere };
}

// Access elsewhere of any kind - including binding-derived organization-admin
// access, whose combination with global Get Kinder roles is an open owner
// policy question - leaves the global role to the platform path. The blocker
// never says which other organization or what access it is.
function crossOrganizationGlobalRoleBlocker(globalRoleName, organizationRoleName) {
  return staffOnboardingBlocker(
    "cross_organization_global_role_side_effect",
    `This person also has KAI access in another organization, where a global ${globalRoleName} role would take effect too. `
      + "A platform administrator must approve that global role.",
    `The organization ${organizationRoleName} role here is kept. A platform administrator can grant the global ${globalRoleName} role in Team & Access after reviewing the person's other access.`,
    {
      global_role: globalRoleName,
      organization_role: organizationRoleName,
      approval_path: "platform_superuser_global_role",
    },
  );
}

/**
 * Package 2 read: effective KAI access for one explicitly scoped
 * organization, one entry per person. Every stored
 * kai.organization_memberships assignment of that person is returned
 * (stored_memberships), each with its own status - a role is effective only
 * while its own assignment is active (owner decision B/E C04) - alongside
 * any derived (read-only, non-persisted) client_admin authority carried from
 * the existing Get Kinder org-admin + active KAI binding path. Each
 * assignment and person also carries this actor's permitted changes, from
 * the same authority the writers re-decide under the organization lock.
 * Global KAI roles (kai.user_roles) are attached per user only when the
 * caller itself holds platform-superuser authority.
 */
export async function viewEffectiveKaiAccess({ actorContext, organizationId } = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return failure("feature_disabled");
  if (actorContext?.actorType !== "human") return failure("authorization_denied");

  const administration = resolveOrganizationRoleAdministration(actorContext, VIEW_KAI_ACCESS, organizationId);
  if (!administration.ok) return authorizationFailure(administration);
  const { authorityByRole, platformSuperuserAuthorized } = administration;

  const listMemberships = dependencies.listOrganizationMembershipRowsForOrganization || listOrganizationMembershipRowsForOrganization;
  const getGkOrgId = dependencies.getActiveGkOrganizationIdForKaiOrganization || getActiveGkOrganizationIdForKaiOrganization;
  const listGkAdmins = dependencies.listActiveGkOrganizationAdminLegacyUserIds || listActiveGkOrganizationAdminLegacyUserIds;
  const findKaiUser = dependencies.findKaiUserByLegacyPublicUserdataId || findKaiUserByLegacyPublicUserdataId;
  const listGlobalRoles = dependencies.listKaiRolesForUser || listKaiRolesForUser;

  const storedRows = await listMemberships(organizationId);
  const gkOrganizationId = await getGkOrgId(organizationId);
  const derivedLegacyIds = gkOrganizationId ? await listGkAdmins(gkOrganizationId) : [];

  const byKey = new Map();
  const keyForKaiUser = (userId) => `kai:${userId}`;
  const keyForLegacyId = (legacyId) => `legacy:${legacyId}`;

  // Whether a kai.users identity can act at all: resolveKaiActorContext
  // admits only an active public.userdata mapping (the same condition both
  // last-admin helpers apply). No mapping yet means never signed in to KAI.
  const accountStatusOf = (kaiUser) => {
    if (!kaiUser) return "not_activated";
    return kaiUser.status === "active" &&
      kaiUser.legacy_identity_source === "public.userdata" &&
      isPositiveInteger(kaiUser.legacy_public_userdata_id)
      ? "active"
      : "inactive";
  };

  for (const row of storedRows) {
    const key = keyForKaiUser(row.user_id);
    if (!byKey.has(key)) {
      byKey.set(key, {
        kai_user_id: row.user_id,
        legacy_public_userdata_id: row.legacy_public_userdata_id,
        email: row.email,
        account_status: accountStatusOf({
          status: row.kai_user_status,
          legacy_identity_source: row.legacy_identity_source,
          legacy_public_userdata_id: row.legacy_public_userdata_id,
        }),
        stored: [],
        derived: null,
      });
    }
    byKey.get(key).stored.push({ role_name: row.role_name, membership_status: row.membership_status });
  }

  for (const legacyId of derivedLegacyIds) {
    const mappedKaiUser = await findKaiUser(legacyId);
    const key = mappedKaiUser ? keyForKaiUser(mappedKaiUser.user_id) : keyForLegacyId(legacyId);
    const existing = byKey.get(key);
    const derived = { role_name: "client_admin", membership_status: "active", source: "gk_organization_binding" };
    if (existing) {
      existing.derived = derived;
    } else {
      byKey.set(key, {
        kai_user_id: mappedKaiUser?.user_id || null,
        legacy_public_userdata_id: legacyId,
        email: mappedKaiUser?.email || null,
        account_status: accountStatusOf(mappedKaiUser),
        stored: [],
        derived,
      });
    }
  }

  const includeGlobalRoles = hasPlatformSuperuserAuthority(actorContext);
  // Prompt 4: an administrator of Get Kinder roles (platform superuser or
  // delegated GK administrator) also reads each person's operation
  // readiness - what their roles admit now and which assignment is missing.
  // A client administrator does not; nor does anyone see raw global roles
  // except a platform superuser.
  const administersGkRoles = platformSuperuserAuthorized || [...authorityByRole.values()].includes("delegated_gk_admin");
  const computeReadiness = administersGkRoles
    ? dependencies.computeOrganizationOperationReadiness
      || (await import("./kaiOrganizationAccessCapabilitiesService.js")).computeOrganizationOperationReadiness
    : null;
  const isActive = (assignment) => assignment.membership_status === KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS;

  // Read-time answer of the writers' last-admin protection, from the same
  // rule: an administrator counts only while their account can act, derived
  // authority is never removed by a stored-role change, and the stored count
  // excludes the target. Advisory: the guard re-decides under the
  // organization lock on every change.
  const isActiveStoredAdmin = (entry) => entry.stored.some((assignment) => assignment.role_name === "client_admin" && isActive(assignment));
  const hasEffectiveDerived = (entry) => Boolean(entry.derived) && entry.account_status === "active";
  const hasEffectiveStored = (entry) => isActiveStoredAdmin(entry) && entry.account_status === "active";
  const entries = [...byKey.values()];
  const organizationHasEffectiveDerivedAdmin = entries.some(hasEffectiveDerived);
  const effectiveStoredAdminCount = entries.filter(hasEffectiveStored).length;
  const lastAdminProtected = (entry) => !platformSuperuserAuthorized &&
    isActiveStoredAdmin(entry) &&
    !organizationHasEffectiveDerivedAdmin &&
    effectiveStoredAdminCount - (hasEffectiveStored(entry) ? 1 : 0) === 0;

  // The actor's permitted changes, mirroring the writers: a role is
  // administered only within authorityByRole (a platform superuser may also
  // replace a stored row of any other role), and a non-superuser's own
  // assignments may only be demoted.
  const administeredRoles = [...authorityByRole.keys()];
  const isActorEntry = (entry) => Boolean(entry.kai_user_id) && entry.kai_user_id === actorContext.actorUserId;
  const ownChangesRestricted = (entry) => !platformSuperuserAuthorized && isActorEntry(entry);
  const projectAssignment = (entry, assignment) => {
    const addressable = Boolean(entry.legacy_public_userdata_id);
    const changeable = addressable && (platformSuperuserAuthorized || authorityByRole.has(assignment.role_name));
    const heldRoles = new Set(entry.stored.map((held) => held.role_name));
    return {
      role_name: assignment.role_name,
      membership_status: assignment.membership_status,
      replacement_roles: changeable
        ? administeredRoles.filter((role) => !heldRoles.has(role) &&
          (!ownChangesRestricted(entry) || isOwnDemotion(assignment, role, KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS)))
        : [],
      can_revoke: addressable && isActive(assignment) && authorityByRole.has(assignment.role_name) &&
        !(assignment.role_name === "client_admin" && lastAdminProtected(entry)),
      can_restore: addressable && !isActive(assignment) && authorityByRole.has(assignment.role_name) && !ownChangesRestricted(entry),
    };
  };

  const accessRows = [];
  for (const entry of entries) {
    entry.stored.sort((a, b) => roleDisplayOrder(a.role_name) - roleDisplayOrder(b.role_name) || a.role_name.localeCompare(b.role_name));
    const activeStoredRoleNames = entry.stored.filter(isActive).map((assignment) => assignment.role_name);
    const effectiveRoleNames = [...new Set([...(entry.derived ? ["client_admin"] : []), ...activeStoredRoleNames])];
    const authoritySource = entry.derived && entry.stored.length > 0 ? "both" : entry.derived ? "derived" : "stored";
    const effectiveRoleName = effectiveRoleNames[0] || entry.stored[0]?.role_name || null;
    const effectiveMembershipStatus = effectiveRoleNames.length > 0 ? KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS : entry.stored[0]?.membership_status || null;
    const storedMemberships = entry.stored.map((assignment) => projectAssignment(entry, assignment));
    const grantableRoles = entry.legacy_public_userdata_id && !ownChangesRestricted(entry)
      ? administeredRoles.filter((role) => !entry.stored.some((held) => held.role_name === role))
      : [];

    // The person's KAI role authority in this organization, built the way
    // resolveKaiActorContext would: their stored assignments here, the
    // derived client_admin, and their global roles. An account that cannot
    // act (not active) has no readiness to report.
    const globalRoleNames = entry.kai_user_id && (includeGlobalRoles || computeReadiness) ? await listGlobalRoles(entry.kai_user_id) : null;
    const operationReadiness = computeReadiness && entry.kai_user_id && entry.account_status === "active"
      ? computeReadiness({
        actorType: "human",
        actorUserId: entry.kai_user_id,
        kaiUserStatus: "active",
        kaiRoles: globalRoleNames || [],
        organizationMemberships: [
          ...entry.stored.map((assignment) => ({ organization_id: organizationId, user_id: entry.kai_user_id, ...assignment })),
          ...(entry.derived && gkOrganizationId
            ? [{ organization_id: organizationId, ...entry.derived, gk_organization_id: Number(gkOrganizationId) }]
            : []),
        ],
      }, organizationId)
      : null;

    // Repair 1: for an administrator of Get Kinder roles, each active
    // organization gk_operator/gk_reviewer assignment's onboarding state -
    // complete when the person holds the same-named global role, otherwise
    // whether staff onboarding can complete it here or the global role
    // needs platform approval (the person has access elsewhere). Advisory:
    // onboardGkStaffMember re-decides under the locks.
    let staffOnboarding;
    if (computeReadiness) {
      staffOnboarding = [];
      const pendingStaffRoles = [];
      if (entry.kai_user_id && entry.account_status === "active") {
        for (const assignment of entry.stored) {
          if (!STAFF_ONBOARDING_ROLE_SET.has(assignment.role_name) || !isActive(assignment)) continue;
          const globalRole = KAI_STAFF_ONBOARDING_GLOBAL_ROLE_BY_ORGANIZATION_ROLE[assignment.role_name];
          const item = { role_name: assignment.role_name, global_role: globalRole, status: "complete" };
          staffOnboarding.push(item);
          if (!(globalRoleNames || []).includes(globalRole)) pendingStaffRoles.push(item);
        }
      }
      if (pendingStaffRoles.length > 0) {
        const reach = await findGlobalRoleReachOutsideOrganization(
          { kaiUserId: entry.kai_user_id, legacyPublicUserdataId: entry.legacy_public_userdata_id, organizationId },
          undefined,
          dependencies,
        );
        for (const item of pendingStaffRoles) item.status = reach.reachesOtherOrganization ? "pending_platform_approval" : "pending_completion";
      }
    }

    accessRows.push({
      kai_user_id: entry.kai_user_id,
      legacy_public_userdata_id: entry.legacy_public_userdata_id,
      email: entry.email,
      // The single stored assignment, kept for single-assignment readers;
      // null when the person has none or several (see stored_memberships).
      stored_membership: entry.stored.length === 1 ? { ...entry.stored[0] } : null,
      stored_memberships: storedMemberships,
      derived_membership: entry.derived,
      effective_role_name: effectiveRoleName,
      effective_role_names: effectiveRoleNames,
      effective_membership_status: effectiveMembershipStatus,
      authority_source: authoritySource,
      kai_account_status: entry.account_status,
      effective_admin_authority: hasEffectiveDerived(entry) || hasEffectiveStored(entry),
      last_admin_protected: lastAdminProtected(entry),
      is_actor: isActorEntry(entry),
      grantable_roles: grantableRoles,
      editable: grantableRoles.length > 0 || storedMemberships.some((assignment) =>
        assignment.replacement_roles.length > 0 || assignment.can_revoke || assignment.can_restore),
      global_kai_roles: includeGlobalRoles && entry.kai_user_id ? globalRoleNames : undefined,
      operation_readiness: computeReadiness ? operationReadiness : undefined,
      staff_onboarding: staffOnboarding,
    });
  }

  return success({
    organization_id: organizationId,
    access: accessRows,
    global_roles_visible: includeGlobalRoles,
    // The global roles a platform superuser may grant or revoke here
    // (manageGlobalKaiRole); empty for every other administrator.
    assignable_global_roles: includeGlobalRoles ? [...ASSIGNABLE_GLOBAL_ROLE_SET] : [],
    administrable_roles: administeredRoles,
    // The staff roles this administrator grants and removes through staff
    // onboarding (onboardGkStaffMember / offboardGkStaffRole): a delegated GK
    // administrator's. A platform superuser keeps the explicit organization
    // and global controls.
    staff_onboarding_roles: administeredRoles.filter((role) =>
      STAFF_ONBOARDING_ROLE_SET.has(role) && authorityByRole.get(role) === "delegated_gk_admin"),
  });
}

const ROLE_DISPLAY_ORDER = Object.freeze(["client_admin", "client_reviewer", "client_contributor", "gk_admin", "gk_operator", "gk_reviewer"]);

function roleDisplayOrder(roleName) {
  const index = ROLE_DISPLAY_ORDER.indexOf(roleName);
  return index === -1 ? ROLE_DISPLAY_ORDER.length : index;
}

/**
 * Package 2 write: governed create, status change, or explicit replacement
 * (B/E C05) of one stored organization-role assignment. `previousRoleName`
 * names the exact assignment being replaced; without it the change is
 * addressed to the target's only stored assignment (or creates the first).
 * The actor must administer the resulting role and the replaced one
 * (resolveOrganizationRoleAdministration): a platform superuser any
 * superuser-assignable role, an effective client_admin (stored or derived)
 * the client roles, a delegated GK administrator gk_operator/gk_reviewer. An
 * unknown role is a validation_blocker; a known resulting role outside that
 * set is refused authorization_denied, exactly as by grantOrganizationRole.
 * A non-superuser may change their own assignment only to
 * demote themselves, and an ordinary action may not leave the organization
 * with zero effective active client_admin authority (platform superuser
 * retains the recovery path).
 */
export async function manageOrganizationMembership(
  { actorContext, organizationId, targetLegacyPublicUserdataId, roleName, membershipStatus, previousRoleName = null, now } = {},
  dependencies = {},
) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return failure("feature_disabled");
  if (actorContext?.actorType !== "human") return failure("authorization_denied");

  const administration = resolveOrganizationRoleAdministration(actorContext, MANAGE_ORGANIZATION_MEMBERSHIP, organizationId);
  if (!administration.ok) return authorizationFailure(administration);
  const { authorityByRole, platformSuperuserAuthorized } = administration;

  if (
    !isPositiveInteger(targetLegacyPublicUserdataId) ||
    !PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLE_SET.has(roleName) ||
    (membershipStatus !== KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS && membershipStatus !== KAI_INACTIVE_ORGANIZATION_MEMBERSHIP_STATUS) ||
    (previousRoleName !== null && !isNonEmptyString(previousRoleName)) ||
    !isNormalizedNow(now)
  ) {
    return failure("validation_blocker");
  }
  // A known role this actor does not administer is the same structured
  // refusal the additive grant and targeted revocation return.
  if (!authorityByRole.has(roleName)) return roleNotAdministrable(roleName, authorityByRole);
  if (authorityByRole.get(roleName) === "delegated_gk_admin" && membershipStatus === KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS) {
    const eligibility = await resolveEligibleStaffAccount({ legacyPublicUserdataId: targetLegacyPublicUserdataId }, dependencies);
    if (!eligibility.ok) return eligibility.refusal;
  }

  const findOrCreateTarget = dependencies.findOrCreateKaiUserByLegacyPublicUserdataId || findOrCreateKaiUserForAdministrationTarget;
  const targetKaiUser = await resolveAdministrationTarget(findOrCreateTarget, targetLegacyPublicUserdataId);
  if (!targetKaiUser?.user_id) return targetAccountEmailUnusable("VAL-KAI-P2-ACC-001");

  const runInTransaction = dependencies.runInTransaction || withTransaction;

  try {
    return await runInTransaction(async (tx) => {
      const result = await applyOrganizationMembershipChangeInTransaction(
        tx,
        {
          actorContext,
          organizationId,
          targetUserId: targetKaiUser.user_id,
          roleName,
          membershipStatus,
          previousRoleName,
          now,
          platformSuperuserAuthorized,
          authorityByRole,
        },
        dependencies,
      );
      if (!result.ok) return result;
      return success({
        organization_id: organizationId,
        user_id: targetKaiUser.user_id,
        legacy_public_userdata_id: targetLegacyPublicUserdataId,
        role_name: roleName,
        membership_status: membershipStatus,
        replayed: !result.data.mutated,
      });
    });
  } catch (error) {
    return shapeThrownError(error);
  }
}

/**
 * The transaction-capable core of manageOrganizationMembership, exposed so
 * another governed workflow (JOIN-3 join-request approval) can compose the
 * exact same membership policy - organization advisory lock, one addressed
 * assignment (fail closed when several exist and none is named), role
 * administration scope, own-role demotion only, last-admin protection,
 * replacement-semantics upsert, and the required metadata-only membership
 * audit - inside its own caller-owned transaction. The caller MUST already
 * have authorized the actor for MANAGE_ORGANIZATION_MEMBERSHIP on
 * organizationId and validated roleName/membershipStatus; this function
 * never opens or commits a transaction. A caller without a resolved
 * `authorityByRole` (JOIN-3) keeps the original scope: platform superuser,
 * otherwise client roles. `onlyCreate: true` additionally refuses
 * (membership_state_conflict) when any stored row already exists, so a
 * caller that must never replace or reactivate a membership cannot. A thrown
 * audit failure propagates so the caller's transaction rolls back.
 */
export async function applyOrganizationMembershipChangeInTransaction(
  tx,
  {
    actorContext,
    organizationId,
    targetUserId,
    roleName,
    membershipStatus,
    now,
    platformSuperuserAuthorized,
    onlyCreate = false,
    previousRoleName = null,
    authorityByRole = null,
  },
  dependencies = {},
) {
  const listExistingRows = dependencies.listOrganizationMembershipRowsForUserInOrganization || listOrganizationMembershipRowsForUserInOrganization;
  const upsertMembership = dependencies.upsertOrganizationMembershipRoleStatus || upsertOrganizationMembershipRoleStatus;
  const auditFactory =
    dependencies.createProductionMetadataOnlyAuditForAccessAdministration ||
    createProductionMetadataOnlyAuditForAccessAdministration;

  await lockOrganizationAdministration(tx, organizationId);
  await lockUserAccessAdministration(tx, targetUserId);

  // The deployed uniqueness is UNIQUE (organization_id, user_id, role_name),
  // so one user may hold several assignments here (C04). A change addresses
  // exactly one: the named assignment, or the user's only one. Naming none
  // while several exist, naming one that does not exist, or replacing into
  // a role the user already holds separately fails closed rather than
  // silently picking, merging, or deleting an assignment.
  const existingRows = await listExistingRows(organizationId, targetUserId, tx);
  if (onlyCreate && existingRows.length > 0) {
    return failure("membership_state_conflict");
  }
  if (previousRoleName === null && existingRows.length > 1) {
    return failure("membership_state_conflict");
  }
  const previousRow = previousRoleName === null
    ? existingRows[0] || null
    : existingRows.find((row) => row.role_name === previousRoleName) || null;
  if (previousRoleName !== null && !previousRow) {
    return failure("membership_state_conflict");
  }

  const administeredRoles = authorityByRole || new Map(
    [...(platformSuperuserAuthorized ? PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLE_SET : ASSIGNABLE_ORGANIZATION_ROLE_SET)]
      .map((role) => [role, platformSuperuserAuthorized ? "platform_superuser" : "organization_client_admin"]),
  );
  // Replacement semantics would otherwise let an administrator rewrite an
  // assignment it does not manage (an organization client_admin rewriting a
  // Get Kinder staff membership into a client role, or a delegated GK
  // administrator rewriting a client or gk_admin membership). Only a
  // platform superuser may change any stored row.
  if (previousRow && !platformSuperuserAuthorized && !administeredRoles.has(previousRow.role_name)) {
    return roleNotAdministrable(previousRow.role_name, administeredRoles);
  }
  if (previousRow && previousRow.role_name !== roleName && existingRows.some((row) => row.role_name === roleName)) {
    return failure("membership_state_conflict");
  }

  const isReplay = Boolean(previousRow) && previousRow.role_name === roleName && previousRow.membership_status === membershipStatus;
  if (
    !isReplay &&
    !platformSuperuserAuthorized &&
    targetUserId === actorContext?.actorUserId &&
    !isOwnDemotion(previousRow, roleName, membershipStatus)
  ) {
    return selfRoleElevationRefused();
  }

  const endsActiveClientAdmin =
    previousRow?.role_name === "client_admin" &&
    previousRow?.membership_status === KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS &&
    !(roleName === "client_admin" && membershipStatus === KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS);
  if (await refusesLastAdministrator(tx, { organizationId, targetUserId, endsActiveClientAdmin, platformSuperuserAuthorized }, dependencies)) {
    return failure("last_admin_protection");
  }

  const upsertRequest = { organizationId, userId: targetUserId, roleName, membershipStatus };
  if (previousRoleName !== null) upsertRequest.previousRoleName = previousRoleName;
  const upsertResult = await upsertMembership(upsertRequest, tx);

  if (upsertResult.conflict) {
    return failure("membership_state_conflict");
  }

  if (upsertResult.mutated) {
    const factory = auditFactory({
      organizationId,
      targetUserId,
      objectType: "organization_membership",
      actorContext,
      now,
    });
    await publishRequiredAudit(factory, {
      target_user_id: targetUserId,
      attempted_operation: !previousRow
        ? "organization_membership_assigned"
        : previousRow.role_name !== roleName
          ? "organization_role_replaced"
          : "organization_membership_role_status_changed",
      role_name: roleName,
      previous_role_name: previousRow?.role_name ?? null,
      resulting_role_name: roleName,
      previous_membership_status: previousRow?.membership_status ?? null,
      resulting_membership_status: membershipStatus,
      authority_source: platformSuperuserAuthorized
        ? "platform_superuser"
        : auditAuthority(previousRow ? administeredRoles.get(previousRow.role_name) : null, administeredRoles.get(roleName)),
      validator_key: "VAL-KAI-P2-ACC-001",
    }, tx);
  }

  return success({
    previous_row: previousRow,
    resulting_row: upsertResult.newRow || null,
    mutated: Boolean(upsertResult.mutated),
  });
}

/**
 * B/E C04 write: additive grant of one organization role to one person.
 * Only that person's assignment for this exact role is created (or
 * reactivated); their other assignments, global roles, and derived authority
 * are never changed. Granting a role the person already holds active is a
 * replay (no write, no audit). A first active assignment is also the
 * person's admission to the organization and is audited as such. The actor
 * must administer the role (resolveOrganizationRoleAdministration), and only
 * a platform superuser may grant a role to themselves.
 */
export async function grantOrganizationRole(
  { actorContext, organizationId, targetLegacyPublicUserdataId, roleName, now } = {},
  dependencies = {},
) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return failure("feature_disabled");
  if (actorContext?.actorType !== "human") return failure("authorization_denied");

  const administration = resolveOrganizationRoleAdministration(actorContext, MANAGE_ORGANIZATION_MEMBERSHIP, organizationId);
  if (!administration.ok) return authorizationFailure(administration);
  const { authorityByRole, platformSuperuserAuthorized } = administration;

  if (
    !isPositiveInteger(targetLegacyPublicUserdataId) ||
    !PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLE_SET.has(roleName) ||
    !isNormalizedNow(now)
  ) {
    return failure("validation_blocker");
  }
  if (!authorityByRole.has(roleName)) return roleNotAdministrable(roleName, authorityByRole);
  if (!platformSuperuserAuthorized && String(actorContext.legacyPublicUserdataId) === String(targetLegacyPublicUserdataId)) {
    return selfRoleElevationRefused();
  }
  // A delegated GK administrator gives Get Kinder staff authority only to a
  // verified, unsuspended Get Kinder account (Repair 1).
  if (authorityByRole.get(roleName) === "delegated_gk_admin") {
    const eligibility = await resolveEligibleStaffAccount({ legacyPublicUserdataId: targetLegacyPublicUserdataId }, dependencies);
    if (!eligibility.ok) return eligibility.refusal;
  }

  const findOrCreateTarget = dependencies.findOrCreateKaiUserByLegacyPublicUserdataId || findOrCreateKaiUserForAdministrationTarget;
  const targetKaiUser = await resolveAdministrationTarget(findOrCreateTarget, targetLegacyPublicUserdataId);
  if (!targetKaiUser?.user_id) return targetAccountEmailUnusable("VAL-KAI-P2-ACC-001");
  if (!platformSuperuserAuthorized && targetKaiUser.user_id === actorContext.actorUserId) return selfRoleElevationRefused();

  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const grantRole = dependencies.grantOrganizationMembershipRole || grantOrganizationMembershipRole;
  const auditFactory =
    dependencies.createProductionMetadataOnlyAuditForAccessAdministration ||
    createProductionMetadataOnlyAuditForAccessAdministration;

  try {
    return await runInTransaction(async (tx) => {
      await lockOrganizationAdministration(tx, organizationId);
      await lockUserAccessAdministration(tx, targetKaiUser.user_id);
      const grantResult = await grantRole({ organizationId, userId: targetKaiUser.user_id, roleName }, tx);
      const accessAdmitted = Boolean(grantResult.mutated) && !grantResult.hadActiveAccess;

      if (grantResult.mutated) {
        const factory = auditFactory({
          organizationId,
          targetUserId: targetKaiUser.user_id,
          objectType: "organization_membership",
          actorContext,
          now,
        });
        await publishRequiredAudit(factory, {
          target_user_id: targetKaiUser.user_id,
          attempted_operation: accessAdmitted ? "organization_role_granted_access_admitted" : "organization_role_granted",
          role_name: roleName,
          previous_role_name: null,
          resulting_role_name: roleName,
          previous_membership_status: grantResult.previousRow?.membership_status ?? null,
          resulting_membership_status: KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS,
          authority_source: authorityByRole.get(roleName),
          validator_key: "VAL-KAI-P2-ACC-001",
        }, tx);
      }

      return success({
        organization_id: organizationId,
        user_id: targetKaiUser.user_id,
        legacy_public_userdata_id: targetLegacyPublicUserdataId,
        role_name: roleName,
        membership_status: KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS,
        organization_access_admitted: accessAdmitted,
        replayed: !grantResult.mutated,
      });
    });
  } catch (error) {
    return shapeThrownError(error);
  }
}

/**
 * B/E C06 write: targeted revocation of one organization-role assignment.
 * Only that assignment becomes inactive; the person's other assignments,
 * global roles, derived authority, and every recorded decision and audit
 * event are untouched, so the revoked role can no longer satisfy any
 * backend check (only active assignments do). Revoking an assignment that is
 * already not active is a replay; one that does not exist is not_found, and
 * nothing is created. The actor must administer the role; an administrator
 * may revoke their own assignment (a demotion), subject to last-admin
 * protection.
 */
export async function revokeOrganizationRole(
  { actorContext, organizationId, targetLegacyPublicUserdataId, roleName, now } = {},
  dependencies = {},
) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return failure("feature_disabled");
  if (actorContext?.actorType !== "human") return failure("authorization_denied");

  const administration = resolveOrganizationRoleAdministration(actorContext, MANAGE_ORGANIZATION_MEMBERSHIP, organizationId);
  if (!administration.ok) return authorizationFailure(administration);
  const { authorityByRole, platformSuperuserAuthorized } = administration;

  if (
    !isPositiveInteger(targetLegacyPublicUserdataId) ||
    !PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLE_SET.has(roleName) ||
    !isNormalizedNow(now)
  ) {
    return failure("validation_blocker");
  }
  if (!authorityByRole.has(roleName)) return roleNotAdministrable(roleName, authorityByRole);

  const findTarget = dependencies.findKaiUserByLegacyPublicUserdataId || findKaiUserByLegacyPublicUserdataId;
  const targetKaiUser = await findTarget(targetLegacyPublicUserdataId);
  if (!targetKaiUser?.user_id) return failure("not_found");

  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const listExistingRows = dependencies.listOrganizationMembershipRowsForUserInOrganization || listOrganizationMembershipRowsForUserInOrganization;
  const revokeRole = dependencies.revokeOrganizationMembershipRole || revokeOrganizationMembershipRole;
  const auditFactory =
    dependencies.createProductionMetadataOnlyAuditForAccessAdministration ||
    createProductionMetadataOnlyAuditForAccessAdministration;

  try {
    return await runInTransaction(async (tx) => {
      await lockOrganizationAdministration(tx, organizationId);
      const currentRow = (await listExistingRows(organizationId, targetKaiUser.user_id, tx))
        .find((row) => row.role_name === roleName) || null;
      const endsActiveClientAdmin =
        roleName === "client_admin" && currentRow?.membership_status === KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS;
      if (await refusesLastAdministrator(
        tx,
        { organizationId, targetUserId: targetKaiUser.user_id, endsActiveClientAdmin, platformSuperuserAuthorized },
        dependencies,
      )) {
        return failure("last_admin_protection");
      }

      const revokeResult = await revokeRole({ organizationId, userId: targetKaiUser.user_id, roleName }, tx);
      if (revokeResult.notFound) return failure("not_found");

      if (revokeResult.mutated) {
        const factory = auditFactory({
          organizationId,
          targetUserId: targetKaiUser.user_id,
          objectType: "organization_membership",
          actorContext,
          now,
        });
        await publishRequiredAudit(factory, {
          target_user_id: targetKaiUser.user_id,
          attempted_operation: "organization_role_revoked",
          role_name: roleName,
          previous_role_name: roleName,
          resulting_role_name: roleName,
          previous_membership_status: revokeResult.previousRow.membership_status,
          resulting_membership_status: KAI_INACTIVE_ORGANIZATION_MEMBERSHIP_STATUS,
          authority_source: authorityByRole.get(roleName),
          validator_key: "VAL-KAI-P2-ACC-001",
        }, tx);
      }

      return success({
        organization_id: organizationId,
        user_id: targetKaiUser.user_id,
        legacy_public_userdata_id: targetLegacyPublicUserdataId,
        role_name: roleName,
        membership_status: revokeResult.newRow?.membership_status ?? revokeResult.previousRow?.membership_status ?? null,
        remaining_active_role_names: revokeResult.remainingActiveRoleNames || [],
        replayed: !revokeResult.mutated,
      });
    });
  } catch (error) {
    return shapeThrownError(error);
  }
}

/**
 * Package 2 write: platform-superuser-only assignment/revocation of an
 * existing global KAI staff role (kai.user_roles -> kai.roles). Not
 * organization-scoped - authorized solely through
 * validateActorCanPerformPlatformOperation, which no organization-scoped
 * role can satisfy. Platform-superuser authority itself is never written
 * here.
 */
export async function manageGlobalKaiRole(
  { actorContext, targetLegacyPublicUserdataId, roleName, action, now } = {},
  dependencies = {},
) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return failure("feature_disabled");
  if (actorContext?.actorType !== "human") return failure("authorization_denied");

  const authResult = validateActorCanPerformPlatformOperation(actorContext, MANAGE_GLOBAL_KAI_ROLE);
  if (!authResult.ok) return authorizationFailure(authResult);

  if (
    !isPositiveInteger(targetLegacyPublicUserdataId) ||
    !ASSIGNABLE_GLOBAL_ROLE_SET.has(roleName) ||
    (action !== "assign" && action !== "revoke") ||
    !isNormalizedNow(now)
  ) {
    return failure("validation_blocker");
  }

  const findOrCreateTarget = dependencies.findOrCreateKaiUserByLegacyPublicUserdataId || findOrCreateKaiUserForAdministrationTarget;
  const targetKaiUser = await resolveAdministrationTarget(findOrCreateTarget, targetLegacyPublicUserdataId);
  if (!targetKaiUser?.user_id) return targetAccountEmailUnusable("VAL-KAI-P2-ACC-002");

  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const listRoles = dependencies.listGlobalRoleAssignmentRows || listGlobalRoleAssignmentRows;
  const assignRole = dependencies.assignGlobalRole || assignGlobalRole;
  const revokeRole = dependencies.revokeGlobalRole || revokeGlobalRole;
  const auditFactory =
    dependencies.createProductionMetadataOnlyAuditForAccessAdministration ||
    createProductionMetadataOnlyAuditForAccessAdministration;

  try {
    return await runInTransaction(async (tx) => {
      const previousRoles = (await listRoles(targetKaiUser.user_id, tx)).map((row) => row.role_name);

      const mutationResult = action === "assign"
        ? await assignRole({ userId: targetKaiUser.user_id, roleName }, tx)
        : await revokeRole({ userId: targetKaiUser.user_id, roleName }, tx);

      if (mutationResult.error_code === "role_not_found") {
        return failure("role_not_found");
      }

      if (mutationResult.mutated) {
        const resultingRoles = action === "assign"
          ? [...previousRoles, roleName]
          : previousRoles.filter((role) => role !== roleName);

        const factory = auditFactory({
          organizationId: null,
          targetUserId: targetKaiUser.user_id,
          objectType: "kai_user",
          actorContext,
          now,
        });
        await publishRequiredAudit(factory, {
          target_user_id: targetKaiUser.user_id,
          attempted_operation: action === "assign" ? "global_kai_role_assigned" : "global_kai_role_revoked",
          role_name: roleName,
          previous_role_name: previousRoles.join(","),
          resulting_role_name: resultingRoles.join(","),
          authority_source: "platform_superuser",
          validator_key: "VAL-KAI-P2-ACC-002",
        }, tx);
      }

      return success({
        user_id: targetKaiUser.user_id,
        legacy_public_userdata_id: targetLegacyPublicUserdataId,
        role_name: roleName,
        action,
        replayed: !mutationResult.mutated,
      });
    });
  } catch (error) {
    return shapeThrownError(error);
  }
}

/**
 * The staff-administration authority for one staff role in exactly
 * organizationId: the shared resolveOrganizationRoleAdministration decides
 * tenant and actor authority, and only a delegated GK administrator or a
 * platform superuser administers Get Kinder staff - an organization client
 * administrator (stored or binding-derived) never does.
 */
function resolveStaffAdministration(actorContext, operation, organizationId, roleName) {
  const administration = resolveOrganizationRoleAdministration(actorContext, operation, organizationId);
  if (!administration.ok) return { ok: false, refusal: authorizationFailure(administration) };
  if (typeof roleName !== "string" || !PLATFORM_SUPERUSER_ASSIGNABLE_ORGANIZATION_ROLE_SET.has(roleName)) {
    return { ok: false, refusal: failure("validation_blocker") };
  }
  if (!STAFF_ONBOARDING_ROLE_SET.has(roleName)) {
    return { ok: false, refusal: membershipRefusal("authorization_denied", membershipBlocker(
      "staff_onboarding_role_not_permitted",
      "Staff onboarding gives only the Get Kinder operator or reviewer role.",
      "Organization Get Kinder administrator and client roles are managed through their own governed paths.",
    )) };
  }
  const authority = administration.authorityByRole.get(roleName);
  if (!STAFF_ONBOARDING_AUTHORITIES.has(authority)) {
    return { ok: false, refusal: roleNotAdministrable(roleName, administration.authorityByRole) };
  }
  return { ok: true, authority, platformSuperuserAuthorized: administration.platformSuperuserAuthorized };
}

/**
 * The person's operation readiness in this organization after a staff change,
 * read inside the change's transaction the way their next sign-in resolves
 * them: stored assignments here, binding-derived access here, global roles.
 */
async function staffReadinessInOrganization({ kaiUserId, organizationId, derivedHere }, tx, dependencies) {
  const listRoles = dependencies.listGlobalRoleAssignmentRows || listGlobalRoleAssignmentRows;
  const listExistingRows = dependencies.listOrganizationMembershipRowsForUserInOrganization || listOrganizationMembershipRowsForUserInOrganization;
  const computeReadiness = dependencies.computeOrganizationOperationReadiness
    || (await import("./kaiOrganizationAccessCapabilitiesService.js")).computeOrganizationOperationReadiness;
  const globalRoles = (await listRoles(kaiUserId, tx)).map((row) => row.role_name);
  const storedHere = await listExistingRows(organizationId, kaiUserId, tx);
  return computeReadiness({
    actorType: "human",
    actorUserId: kaiUserId,
    kaiUserStatus: "active",
    kaiRoles: globalRoles,
    organizationMemberships: [
      ...storedHere.map((row) => ({ organization_id: organizationId, user_id: kaiUserId, role_name: row.role_name, membership_status: row.membership_status })),
      ...derivedHere,
    ],
  }, organizationId);
}

async function derivedAccessHere(legacyPublicUserdataId, organizationId, dependencies) {
  const resolveDerived = dependencies.resolveEffectiveClientOrganizationMembershipsForLegacyUser ||
    resolveEffectiveClientOrganizationMembershipsForLegacyUser;
  const derived = await resolveDerived(legacyPublicUserdataId, dependencies);
  return (Array.isArray(derived) ? derived : []).filter((membership) => String(membership.organization_id) === String(organizationId));
}

class StaffGlobalRoleUnavailableError extends Error {
  constructor() {
    super("staff onboarding global role is not defined in kai.roles");
    this.name = "StaffGlobalRoleUnavailableError";
  }
}

/**
 * Repair 1: delegated GK staff onboarding. A delegated GK administrator of
 * exactly organizationId (global gk_admin + active stored organization
 * gk_admin) - or a platform superuser - completes routine operator/reviewer
 * onboarding of an existing, verified Get Kinder account without returning to
 * the platform superuser:
 *  1. the account is identified by id or exact email and must be verified,
 *     unsuspended, and unambiguous; it is mapped to kai.users exactly as its
 *     first sign-in would (an inactive mapping is refused, never revived);
 *  2. in one transaction under the organization and person locks, the
 *     organization gk_operator/gk_reviewer role is granted (additive, the
 *     same writer and audit as grantOrganizationRole) and
 *  3. the same-named global role its operations need is established only if
 *     the person has no active access to any other organization (stored or
 *     binding-derived) - otherwise the global role is not written, a
 *     cross_organization_global_role_side_effect blocker is returned, and the
 *     organization role stays as the pending, actionable onboarding state for
 *     the existing platform-superuser global-role path;
 *  4. every write is audited (metadata only), and the person's resulting
 *     operation readiness here is returned.
 * Never grants gk_admin (organization or global), never to the actor
 * themselves (outside platform-superuser authority), never in another
 * organization, and never creates an account or a client membership.
 * Replaying a completed onboarding writes nothing.
 */
export async function onboardGkStaffMember(
  { actorContext, organizationId, targetLegacyPublicUserdataId = null, targetEmail = null, roleName, now } = {},
  dependencies = {},
) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return failure("feature_disabled");
  if (actorContext?.actorType !== "human") return failure("authorization_denied");

  const staffAdministration = resolveStaffAdministration(actorContext, MANAGE_ORGANIZATION_MEMBERSHIP, organizationId, roleName);
  if (!staffAdministration.ok) return staffAdministration.refusal;
  const { authority, platformSuperuserAuthorized } = staffAdministration;

  const normalizedEmail = typeof targetEmail === "string" ? targetEmail.trim().toLowerCase() : null;
  const identifiedById = targetLegacyPublicUserdataId !== null;
  if (
    identifiedById === (targetEmail !== null) ||
    (identifiedById && !isPositiveInteger(targetLegacyPublicUserdataId)) ||
    (!identifiedById && (!normalizedEmail || normalizedEmail.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(normalizedEmail))) ||
    !isNormalizedNow(now)
  ) {
    return failure("validation_blocker");
  }
  if (!platformSuperuserAuthorized && identifiedById && String(actorContext.legacyPublicUserdataId) === String(targetLegacyPublicUserdataId)) {
    return selfRoleElevationRefused();
  }

  const account = await resolveEligibleStaffAccount(
    identifiedById ? { legacyPublicUserdataId: targetLegacyPublicUserdataId } : { email: normalizedEmail },
    dependencies,
  );
  if (!account.ok) return account.refusal;
  const legacyId = account.legacyPublicUserdataId;
  if (!platformSuperuserAuthorized && String(actorContext.legacyPublicUserdataId) === String(legacyId)) {
    return selfRoleElevationRefused();
  }
  const mapping = await resolveStaffKaiUser(legacyId, dependencies);
  if (!mapping.ok) return mapping.refusal;
  const kaiUserId = mapping.kaiUser.user_id;
  if (!platformSuperuserAuthorized && kaiUserId === actorContext.actorUserId) return selfRoleElevationRefused();

  const globalRoleName = KAI_STAFF_ONBOARDING_GLOBAL_ROLE_BY_ORGANIZATION_ROLE[roleName];
  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const grantRole = dependencies.grantOrganizationMembershipRole || grantOrganizationMembershipRole;
  const listRoles = dependencies.listGlobalRoleAssignmentRows || listGlobalRoleAssignmentRows;
  const assignRole = dependencies.assignGlobalRole || assignGlobalRole;
  const auditFactory =
    dependencies.createProductionMetadataOnlyAuditForAccessAdministration ||
    createProductionMetadataOnlyAuditForAccessAdministration;

  try {
    return await runInTransaction(async (tx) => {
      await lockOrganizationAdministration(tx, organizationId);
      await lockUserAccessAdministration(tx, kaiUserId);

      const grantResult = await grantRole({ organizationId, userId: kaiUserId, roleName }, tx);
      const accessAdmitted = Boolean(grantResult.mutated) && !grantResult.hadActiveAccess;
      if (grantResult.mutated) {
        await publishRequiredAudit(auditFactory({ organizationId, targetUserId: kaiUserId, objectType: "organization_membership", actorContext, now }), {
          target_user_id: kaiUserId,
          attempted_operation: accessAdmitted ? "organization_role_granted_access_admitted" : "organization_role_granted",
          role_name: roleName,
          previous_role_name: null,
          resulting_role_name: roleName,
          previous_membership_status: grantResult.previousRow?.membership_status ?? null,
          resulting_membership_status: KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS,
          authority_source: authority,
          validator_key: STAFF_ONBOARDING_VALIDATOR_KEY,
        }, tx);
      }

      const previousGlobalRoles = (await listRoles(kaiUserId, tx)).map((row) => row.role_name);
      let globalRoleStatus = "already_held";
      const pendingBlockers = [];
      if (!previousGlobalRoles.includes(globalRoleName)) {
        const reach = await findGlobalRoleReachOutsideOrganization({ kaiUserId, legacyPublicUserdataId: legacyId, organizationId }, tx, dependencies);
        if (reach.reachesOtherOrganization) {
          globalRoleStatus = "pending_platform_approval";
          pendingBlockers.push(crossOrganizationGlobalRoleBlocker(globalRoleName, roleName));
        } else {
          const assigned = await assignRole({ userId: kaiUserId, roleName: globalRoleName }, tx);
          // A missing kai.roles row rolls the whole onboarding back.
          if (assigned.error_code === "role_not_found") throw new StaffGlobalRoleUnavailableError();
          globalRoleStatus = "assigned";
          if (assigned.mutated) {
            await publishRequiredAudit(auditFactory({ organizationId, targetUserId: kaiUserId, objectType: "kai_user", actorContext, now }), {
              target_user_id: kaiUserId,
              attempted_operation: "global_kai_role_assigned",
              role_name: globalRoleName,
              previous_role_name: previousGlobalRoles.join(","),
              resulting_role_name: [...previousGlobalRoles, globalRoleName].sort().join(","),
              authority_source: authority,
              validator_key: STAFF_ONBOARDING_VALIDATOR_KEY,
            }, tx);
          }
        }
      }

      const operationReadiness = await staffReadinessInOrganization(
        { kaiUserId, organizationId, derivedHere: await derivedAccessHere(legacyId, organizationId, dependencies) },
        tx,
        dependencies,
      );
      return success({
        organization_id: organizationId,
        user_id: kaiUserId,
        legacy_public_userdata_id: legacyId,
        role_name: roleName,
        organization_role: {
          role_name: roleName,
          membership_status: KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS,
          granted: Boolean(grantResult.mutated),
          organization_access_admitted: accessAdmitted,
        },
        global_role: { role_name: globalRoleName, status: globalRoleStatus },
        onboarding_status: pendingBlockers.length > 0 ? "pending_platform_approval" : "complete",
        pending_blockers: pendingBlockers,
        operation_readiness: operationReadiness,
        replayed: !grantResult.mutated && globalRoleStatus === "already_held",
      });
    });
  } catch (error) {
    if (error instanceof StaffGlobalRoleUnavailableError) return failure("role_not_found");
    return shapeThrownError(error);
  }
}

/**
 * Repair 1: delegated GK staff offboarding - the counterpart of
 * onboardGkStaffMember. Targeted revocation of the organization
 * gk_operator/gk_reviewer assignment (same writer and audit as
 * revokeOrganizationRole; already inactive is a replay, never present is
 * not_found and nothing is written), then the same-named global role:
 *  - kept when another active stored assignment of that role (any
 *    organization) still requires it;
 *  - kept, with a cross_organization_global_role_side_effect blocker, when
 *    the person has active access to another organization - the global role
 *    may serve that access, so only the platform superuser decides;
 *  - otherwise revoked (it could take effect only here, where the role
 *    has just been revoked), audited.
 * Other assignments, client roles, derived authority and history are
 * untouched.
 */
export async function offboardGkStaffRole(
  { actorContext, organizationId, targetLegacyPublicUserdataId, roleName, now } = {},
  dependencies = {},
) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return failure("feature_disabled");
  if (actorContext?.actorType !== "human") return failure("authorization_denied");

  const staffAdministration = resolveStaffAdministration(actorContext, MANAGE_ORGANIZATION_MEMBERSHIP, organizationId, roleName);
  if (!staffAdministration.ok) return staffAdministration.refusal;
  const { authority } = staffAdministration;
  if (!isPositiveInteger(targetLegacyPublicUserdataId) || !isNormalizedNow(now)) return failure("validation_blocker");

  const findTarget = dependencies.findKaiUserByLegacyPublicUserdataId || findKaiUserByLegacyPublicUserdataId;
  const targetKaiUser = await findTarget(targetLegacyPublicUserdataId);
  if (!targetKaiUser?.user_id) return failure("not_found");
  const kaiUserId = targetKaiUser.user_id;

  const globalRoleName = KAI_STAFF_ONBOARDING_GLOBAL_ROLE_BY_ORGANIZATION_ROLE[roleName];
  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const revokeRole = dependencies.revokeOrganizationMembershipRole || revokeOrganizationMembershipRole;
  const listMemberships = dependencies.listOrganizationMembershipsForUser || listOrganizationMembershipsForUser;
  const listRoles = dependencies.listGlobalRoleAssignmentRows || listGlobalRoleAssignmentRows;
  const revokeGlobal = dependencies.revokeGlobalRole || revokeGlobalRole;
  const auditFactory =
    dependencies.createProductionMetadataOnlyAuditForAccessAdministration ||
    createProductionMetadataOnlyAuditForAccessAdministration;

  try {
    return await runInTransaction(async (tx) => {
      await lockOrganizationAdministration(tx, organizationId);
      await lockUserAccessAdministration(tx, kaiUserId);

      const revokeResult = await revokeRole({ organizationId, userId: kaiUserId, roleName }, tx);
      if (revokeResult.notFound) return failure("not_found");
      if (revokeResult.mutated) {
        await publishRequiredAudit(auditFactory({ organizationId, targetUserId: kaiUserId, objectType: "organization_membership", actorContext, now }), {
          target_user_id: kaiUserId,
          attempted_operation: "organization_role_revoked",
          role_name: roleName,
          previous_role_name: roleName,
          resulting_role_name: roleName,
          previous_membership_status: revokeResult.previousRow.membership_status,
          resulting_membership_status: KAI_INACTIVE_ORGANIZATION_MEMBERSHIP_STATUS,
          authority_source: authority,
          validator_key: STAFF_ONBOARDING_VALIDATOR_KEY,
        }, tx);
      }

      const previousGlobalRoles = (await listRoles(kaiUserId, tx)).map((row) => row.role_name);
      const globalRole = { role_name: globalRoleName, status: "not_held", reason: null };
      const pendingBlockers = [];
      if (previousGlobalRoles.includes(globalRoleName)) {
        const memberships = await listMemberships(kaiUserId, tx);
        const requiredByAnotherAssignment = (Array.isArray(memberships) ? memberships : []).some((membership) =>
          membership.role_name === roleName && membership.membership_status === KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS);
        const reach = requiredByAnotherAssignment
          ? null
          : await findGlobalRoleReachOutsideOrganization({ kaiUserId, legacyPublicUserdataId: targetLegacyPublicUserdataId, organizationId }, tx, dependencies);
        if (requiredByAnotherAssignment) {
          Object.assign(globalRole, { status: "retained", reason: "required_by_another_assignment" });
        } else if (reach.reachesOtherOrganization) {
          Object.assign(globalRole, { status: "retained", reason: "access_in_another_organization" });
          pendingBlockers.push(crossOrganizationGlobalRoleBlocker(globalRoleName, roleName));
        } else {
          const revoked = await revokeGlobal({ userId: kaiUserId, roleName: globalRoleName }, tx);
          if (revoked.error_code === "role_not_found") throw new StaffGlobalRoleUnavailableError();
          Object.assign(globalRole, { status: "revoked" });
          if (revoked.mutated) {
            await publishRequiredAudit(auditFactory({ organizationId, targetUserId: kaiUserId, objectType: "kai_user", actorContext, now }), {
              target_user_id: kaiUserId,
              attempted_operation: "global_kai_role_revoked",
              role_name: globalRoleName,
              previous_role_name: previousGlobalRoles.join(","),
              resulting_role_name: previousGlobalRoles.filter((role) => role !== globalRoleName).join(","),
              authority_source: authority,
              validator_key: STAFF_ONBOARDING_VALIDATOR_KEY,
            }, tx);
          }
        }
      }

      return success({
        organization_id: organizationId,
        user_id: kaiUserId,
        legacy_public_userdata_id: targetLegacyPublicUserdataId,
        role_name: roleName,
        membership_status: revokeResult.newRow?.membership_status ?? revokeResult.previousRow?.membership_status ?? null,
        remaining_active_role_names: revokeResult.remainingActiveRoleNames || [],
        global_role: globalRole,
        pending_blockers: pendingBlockers,
        replayed: !revokeResult.mutated && globalRole.status !== "revoked",
      });
    });
  } catch (error) {
    if (error instanceof StaffGlobalRoleUnavailableError) return failure("role_not_found");
    return shapeThrownError(error);
  }
}

/**
 * Prompt 4: the Team & Access administration context. A platform superuser
 * administers KAI access for any organization without holding a membership
 * there, so Team & Access needs the organizations it may choose from. This
 * read lists only their ids and names; it opens no content, and every roster
 * read and change is authorized again by its own service. Any other actor is
 * answered (200) that platform administration is not available, so the page
 * never has to probe a refusal.
 */
export async function getAccessAdministrationContext({ actorContext } = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return failure("feature_disabled");
  if (actorContext?.actorType !== "human" || !actorContext?.actorUserId) return failure("authorization_denied");

  const authResult = validateActorCanPerformPlatformOperation(actorContext, VIEW_PLATFORM_ACCESS_ADMINISTRATION);
  if (!authResult.ok) {
    return success({ platform_administration: false, organizations: [], assignable_global_roles: [] });
  }
  const listOrganizations = dependencies.listOrganizationsForPlatformAdministration || listOrganizationsForPlatformAdministration;
  const rows = await listOrganizations();
  return success({
    platform_administration: true,
    organizations: (Array.isArray(rows) ? rows : [])
      .filter((row) => isNonEmptyString(row?.organization_id))
      .map((row) => ({ organization_id: row.organization_id, name: typeof row.name === "string" ? row.name : null })),
    assignable_global_roles: [...ASSIGNABLE_GLOBAL_ROLE_SET],
  });
}

export const __kaiAccessAdministrationServiceTestables = Object.freeze({
  RequiredAuditRejectedError,
});

// The operations and administrator roles the access-administration reads
// and writes authorize with (resolveOrganizationRoleAdministration narrows
// the roles each administrator manages). The access-capabilities read
// reports this policy through hasOrganizationRoleAdministrationAuthority.
export const __kaiAccessAdministrationServiceContract = Object.freeze({
  VIEW_OPERATION: VIEW_KAI_ACCESS,
  MANAGE_OPERATION: MANAGE_ORGANIZATION_MEMBERSHIP,
  ORGANIZATION_ROLE_ADMINISTRATOR_ROLES,
});
