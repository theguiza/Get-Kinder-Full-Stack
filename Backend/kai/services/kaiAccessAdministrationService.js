import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import {
  KAI_ACCESS_ADMINISTRATION_OPERATIONS,
  KAI_ASSIGNABLE_ORGANIZATION_ROLES,
  KAI_ASSIGNABLE_GLOBAL_ROLES,
  KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS,
  KAI_INACTIVE_ORGANIZATION_MEMBERSHIP_STATUS,
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
  assignGlobalRole,
  revokeGlobalRole,
  listGlobalRoleAssignmentRows,
} from "../db/kaiAccessAdministrationQueries.js";
import {
  findOrCreateKaiUserByLegacyPublicUserdataId,
  findKaiUserByLegacyPublicUserdataId,
  listKaiRolesForUser,
} from "../db/kaiQueries.js";
import {
  getActiveGkOrganizationIdForKaiOrganization,
  listActiveGkOrganizationAdminLegacyUserIds,
  hasActiveDerivedClientAdminForOrganization,
} from "../auth/gkOrganizationAdminQueries.js";
import { createProductionMetadataOnlyAuditForAccessAdministration } from "./kaiMetadataOnlyAuditComposition.js";

const {
  VIEW_KAI_ACCESS,
  MANAGE_ORGANIZATION_MEMBERSHIP,
  MANAGE_GLOBAL_KAI_ROLE,
} = KAI_ACCESS_ADMINISTRATION_OPERATIONS;

const ASSIGNABLE_ORGANIZATION_ROLE_SET = new Set(KAI_ASSIGNABLE_ORGANIZATION_ROLES);
const ASSIGNABLE_GLOBAL_ROLE_SET = new Set(KAI_ASSIGNABLE_GLOBAL_ROLES);
const ORGANIZATION_MEMBERSHIP_ADMIN_ALLOWED_ROLES = new Set(["client_admin"]);

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

function shapeThrownError(error) {
  if (error instanceof RequiredAuditRejectedError) return failure("validation_blocker");
  if (error?.code === "23514" || error?.code === "22P02") return failure("validation_blocker");
  return failure("system_error");
}

/**
 * Package 2 read: effective KAI access for one explicitly scoped
 * organization. Distinguishes stored kai.organization_memberships rows from
 * derived (read-only, non-persisted) client_admin authority carried from the
 * existing Get Kinder org-admin + active KAI binding path, and computes one
 * deterministic effective role/status per user when both sources exist.
 * Global KAI roles (kai.user_roles) are attached per user only when the
 * caller itself holds platform-superuser authority.
 */
export async function viewEffectiveKaiAccess({ actorContext, organizationId } = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return failure("feature_disabled");
  if (actorContext?.actorType !== "human") return failure("authorization_denied");

  const authResult = validateActorCanPerformOperation(actorContext, VIEW_KAI_ACCESS, organizationId, {
    allowedRoles: ORGANIZATION_MEMBERSHIP_ADMIN_ALLOWED_ROLES,
  });
  if (!authResult.ok) return authorizationFailure(authResult);

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

  for (const row of storedRows) {
    const entry = {
      kai_user_id: row.user_id,
      legacy_public_userdata_id: row.legacy_public_userdata_id,
      email: row.email,
      stored: { role_name: row.role_name, membership_status: row.membership_status },
      derived: null,
    };
    byKey.set(keyForKaiUser(row.user_id), entry);
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
        stored: null,
        derived,
      });
    }
  }

  const includeGlobalRoles = hasPlatformSuperuserAuthority(actorContext);
  const accessRows = [];
  for (const entry of byKey.values()) {
    const isEffectiveClientAdmin = entry.derived?.membership_status === "active" || (
      entry.stored?.role_name === "client_admin" && entry.stored?.membership_status === "active"
    );
    const authoritySource = entry.derived && entry.stored ? "both" : entry.derived ? "derived" : "stored";
    const effectiveRoleName = isEffectiveClientAdmin ? "client_admin" : entry.stored?.role_name || null;
    const effectiveMembershipStatus = isEffectiveClientAdmin ? "active" : entry.stored?.membership_status || null;

    accessRows.push({
      kai_user_id: entry.kai_user_id,
      legacy_public_userdata_id: entry.legacy_public_userdata_id,
      email: entry.email,
      stored_membership: entry.stored,
      derived_membership: entry.derived,
      effective_role_name: effectiveRoleName,
      effective_membership_status: effectiveMembershipStatus,
      authority_source: authoritySource,
      editable: Boolean(entry.stored) || !entry.derived,
      global_kai_roles: includeGlobalRoles && entry.kai_user_id ? await listGlobalRoles(entry.kai_user_id) : undefined,
    });
  }

  return success({
    organization_id: organizationId,
    access: accessRows,
    global_roles_visible: includeGlobalRoles,
  });
}

/**
 * Package 2 write: governed create/change of one stored organization
 * membership. Platform superuser may target any explicit organization;
 * an effective client_admin (stored or derived) may only target its own
 * organization - both enforced solely by validateActorCanPerformOperation,
 * no parallel role check exists here. Refuses to leave an organization with
 * zero effective active client_admin authority through an ordinary
 * client_admin action (platform superuser retains the recovery path).
 */
export async function manageOrganizationMembership(
  { actorContext, organizationId, targetLegacyPublicUserdataId, roleName, membershipStatus, now } = {},
  dependencies = {},
) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return failure("feature_disabled");
  if (actorContext?.actorType !== "human") return failure("authorization_denied");

  const authResult = validateActorCanPerformOperation(actorContext, MANAGE_ORGANIZATION_MEMBERSHIP, organizationId, {
    allowedRoles: ORGANIZATION_MEMBERSHIP_ADMIN_ALLOWED_ROLES,
  });
  if (!authResult.ok) return authorizationFailure(authResult);

  if (
    !isPositiveInteger(targetLegacyPublicUserdataId) ||
    !ASSIGNABLE_ORGANIZATION_ROLE_SET.has(roleName) ||
    (membershipStatus !== KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS && membershipStatus !== KAI_INACTIVE_ORGANIZATION_MEMBERSHIP_STATUS) ||
    !isNormalizedNow(now)
  ) {
    return failure("validation_blocker");
  }

  const platformSuperuserAuthorized = Boolean(authResult.platformSuperuserAuthorized);

  const findOrCreateTarget = dependencies.findOrCreateKaiUserByLegacyPublicUserdataId || findOrCreateKaiUserByLegacyPublicUserdataId;
  const targetKaiUser = await findOrCreateTarget({ legacyPublicUserdataId: targetLegacyPublicUserdataId });
  if (!targetKaiUser?.user_id) return failure("validation_blocker");

  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const listExistingRows = dependencies.listOrganizationMembershipRowsForUserInOrganization || listOrganizationMembershipRowsForUserInOrganization;
  const countActiveAdmins = dependencies.countActiveStoredClientAdminMemberships || countActiveStoredClientAdminMemberships;
  const hasDerivedAdmin = dependencies.hasActiveDerivedClientAdminForOrganization || hasActiveDerivedClientAdminForOrganization;
  const upsertMembership = dependencies.upsertOrganizationMembershipRoleStatus || upsertOrganizationMembershipRoleStatus;
  const auditFactory =
    dependencies.createProductionMetadataOnlyAuditForAccessAdministration ||
    createProductionMetadataOnlyAuditForAccessAdministration;

  try {
    return await runInTransaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `kai_org_admin_lock:${organizationId}`,
      ]);

      // The deployed uniqueness is UNIQUE (organization_id, user_id, role_name),
      // not (organization_id, user_id): PostgreSQL itself permits more than one
      // stored role row for the same user+organization. This package's own
      // writes never create that state (see upsertOrganizationMembershipRoleStatus's
      // replacement semantics), but pre-existing data might - fail closed rather
      // than silently pick one to treat as authoritative.
      const existingRows = await listExistingRows(organizationId, targetKaiUser.user_id, tx);
      if (existingRows.length > 1) {
        return failure("membership_state_conflict");
      }
      const previousRow = existingRows[0] || null;
      const isCurrentlyActiveAdmin = previousRow?.role_name === "client_admin" && previousRow?.membership_status === "active";
      const wouldStillBeActiveAdmin = roleName === "client_admin" && membershipStatus === KAI_ACTIVE_ORGANIZATION_MEMBERSHIP_STATUS;

      if (isCurrentlyActiveAdmin && !wouldStillBeActiveAdmin && !platformSuperuserAuthorized) {
        const orgHasDerivedAdmin = await hasDerivedAdmin(organizationId, tx);
        if (!orgHasDerivedAdmin) {
          const remainingStoredAdmins = await countActiveAdmins(organizationId, tx, {
            excludingUserId: targetKaiUser.user_id,
          });
          if (remainingStoredAdmins === 0) {
            return failure("last_admin_protection");
          }
        }
      }

      const upsertResult = await upsertMembership(
        { organizationId, userId: targetKaiUser.user_id, roleName, membershipStatus },
        tx,
      );

      if (upsertResult.conflict) {
        return failure("membership_state_conflict");
      }

      if (upsertResult.mutated) {
        const factory = auditFactory({
          organizationId,
          targetUserId: targetKaiUser.user_id,
          objectType: "organization_membership",
          actorContext,
          now,
        });
        await publishRequiredAudit(factory, {
          target_user_id: targetKaiUser.user_id,
          attempted_operation: previousRow ? "organization_membership_role_status_changed" : "organization_membership_assigned",
          role_name: roleName,
          previous_role_name: previousRow?.role_name ?? null,
          resulting_role_name: roleName,
          previous_membership_status: previousRow?.membership_status ?? null,
          resulting_membership_status: membershipStatus,
          authority_source: "stored",
          validator_key: "VAL-KAI-P2-ACC-001",
        }, tx);
      }

      return success({
        organization_id: organizationId,
        user_id: targetKaiUser.user_id,
        legacy_public_userdata_id: targetLegacyPublicUserdataId,
        role_name: roleName,
        membership_status: membershipStatus,
        replayed: !upsertResult.mutated,
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

  const findOrCreateTarget = dependencies.findOrCreateKaiUserByLegacyPublicUserdataId || findOrCreateKaiUserByLegacyPublicUserdataId;
  const targetKaiUser = await findOrCreateTarget({ legacyPublicUserdataId: targetLegacyPublicUserdataId });
  if (!targetKaiUser?.user_id) return failure("validation_blocker");

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

export const __kaiAccessAdministrationServiceTestables = Object.freeze({
  RequiredAuditRejectedError,
});
