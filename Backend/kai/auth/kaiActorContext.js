import {
  findOrCreateKaiUserByLegacyPublicUserdataId,
  listKaiRolesForUser,
  listOrganizationMembershipsForUser,
} from "../db/kaiQueries.js";

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
 * with mapped_kai_user_required. Organization/role authorization is decided
 * afterward by validateActorCanPerformOperation and is unaffected by identity
 * provisioning: a freshly provisioned user has no kai.user_roles/
 * kai.organization_memberships rows and so is authorized for nothing until an
 * operator grants them, exactly as any other never-provisioned actor.
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

  const kaiUser = await findOrCreateUser({ legacyPublicUserdataId: user.id, email: user.email || null });
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

  const [kaiRoles, organizationMemberships] = await Promise.all([
    listRoles(kaiUser.user_id),
    listMemberships(kaiUser.user_id),
  ]);

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
      safeLegacyUser: pickSafeLegacyUser(user),
    },
  };
}
