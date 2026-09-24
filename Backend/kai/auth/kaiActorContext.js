import {
  findOrCreateKaiUserByLegacyPublicUserdataId,
  listKaiRolesForUser,
  listOrganizationMembershipsForUser,
} from "../db/kaiQueries.js";
import { isAdminRequest } from "../../middleware/ensureAdmin.js";
import { resolveEffectiveClientOrganizationMembershipsForLegacyUser } from "./gkOrganizationBindingAuthority.js";

export function pickSafeLegacyUser(user = {}) {
  return {
    id: user.id,
    email: user.email || null,
    firstname: user.firstname || null,
    lastname: user.lastname || null,
  };
}

/**
 * Resolves the Sprint 2 actor for an authenticated Get Kinder (public.userdata)
 * request. Existing Get Kinder authentication is the identity authority: a
 * missing kai.users mapping is provisioned automatically (JIT) rather than
 * requiring manual mapping. An existing but explicitly non-active kai.users
 * row (e.g. deprovisioned) is never resurrected here and still fails closed
 * with mapped_kai_user_required, as does a missing mapping whose JIT insert
 * the deployed kai.users table rejects. Organization/role authorization is decided
 * afterward by validateActorCanPerformOperation and is unaffected by identity
 * provisioning: a freshly provisioned user has no kai.user_roles/
 * kai.organization_memberships rows and so is authorized for nothing until an
 * operator grants them, exactly as any other never-provisioned actor -
 * unless their existing Get Kinder organization-admin membership has an
 * active explicit kai.gk_organization_bindings row, in which case a
 * read-only, non-persisted "client_admin" membership for the bound KAI
 * tenant is added to organizationMemberships (see
 * gkOrganizationBindingAuthority.js). That derived membership never
 * overrides or removes internal kai.organization_memberships rows; both are
 * merged so existing internal/legacy KAI actors are unaffected. Existing Get
 * Kinder site-wide admin authority is carried separately as platformSuperuser;
 * it is never converted into a synthetic KAI role or organization membership.
 */
export async function resolveKaiActorContext(reqOrUser, dependencies = {}) {
  const user = reqOrUser?.user || reqOrUser;
  if (!user?.id) {
    return { ok: false, error_code: "unauthorized", message: "Authenticated user is required." };
  }

  const findOrCreateUser =
    dependencies.findOrCreateKaiUserByLegacyPublicUserdataId || findOrCreateKaiUserByLegacyPublicUserdataId;
  const listRoles = dependencies.listKaiRolesForUser || listKaiRolesForUser;
  const listMemberships = dependencies.listOrganizationMembershipsForUser || listOrganizationMembershipsForUser;
  const resolveEffectiveClientMemberships =
    dependencies.resolveEffectiveClientOrganizationMembershipsForLegacyUser ||
    resolveEffectiveClientOrganizationMembershipsForLegacyUser;

  let kaiUser;
  try {
    kaiUser = await findOrCreateUser({ legacyPublicUserdataId: user.id, email: user.email || null });
  } catch (error) {
    if (!error?.kaiUserProvisioningFailed) throw error;
    // No mapping exists and the JIT insert was rejected: the caller still has
    // no usable kai.users mapping, which is the controlled
    // mapped_kai_user_required outcome, not a server error. Only the
    // PostgreSQL diagnostic identifiers are logged: the message is omitted
    // because some PostgreSQL messages echo the rejected value (e.g. email).
    console.error("[kai-actor-context] kai.users JIT provisioning failed", {
      code: error.cause?.code || null,
      constraint: error.cause?.constraint || null,
      column: error.cause?.column || null,
      table: error.cause?.table || null,
    });
    kaiUser = null;
  }
  const hasActivePublicUserdataMapping =
    kaiUser?.user_id &&
    kaiUser.legacy_identity_source === "public.userdata" &&
    String(kaiUser.legacy_public_userdata_id) === String(user.id) &&
    kaiUser.status === "active";

  if (!hasActivePublicUserdataMapping) {
    return {
      ok: false,
      error_code: "mapped_kai_user_required",
      message: "Authenticated user is not mapped to kai.users.",
      legacyPublicUserdataId: user.id,
    };
  }

  const [kaiRoles, internalOrganizationMemberships, effectiveClientOrganizationMemberships] = await Promise.all([
    listRoles(kaiUser.user_id),
    listMemberships(kaiUser.user_id),
    resolveEffectiveClientMemberships(user.id, dependencies),
  ]);
  const organizationMemberships = [...internalOrganizationMemberships, ...effectiveClientOrganizationMemberships];
  const reqForAdminAuthority = reqOrUser?.user ? reqOrUser : { user };
  const platformSuperuser = isAdminRequest(reqForAdminAuthority);

  return {
    ok: true,
    actorContext: {
      actorType: "human",
      actorUserId: kaiUser.user_id,
      legacyPublicUserdataId: user.id,
      email: user.email || kaiUser.email || null,
      firstname: user.firstname || null,
      lastname: user.lastname || null,
      kaiUserStatus: kaiUser.status || null,
      kaiRoles,
      organizationMemberships,
      platformSuperuser,
      platformSuperuserAuthority: platformSuperuser ? "get_kinder_site_admin" : null,
      safeLegacyUser: pickSafeLegacyUser(user),
    },
  };
}
