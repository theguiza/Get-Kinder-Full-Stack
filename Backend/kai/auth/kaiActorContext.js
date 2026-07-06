import {
  findKaiUserByLegacyPublicUserdataId,
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

export async function resolveKaiActorContext(reqOrUser, dependencies = {}) {
  const user = reqOrUser?.user || reqOrUser;
  if (!user?.id) {
    return { ok: false, error_code: "unauthorized", message: "Authenticated user is required." };
  }

  const findUser = dependencies.findKaiUserByLegacyPublicUserdataId || findKaiUserByLegacyPublicUserdataId;
  const listRoles = dependencies.listKaiRolesForUser || listKaiRolesForUser;
  const listMemberships = dependencies.listOrganizationMembershipsForUser || listOrganizationMembershipsForUser;

  const kaiUser = await findUser(user.id);
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
