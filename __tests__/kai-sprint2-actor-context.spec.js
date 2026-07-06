import test from "node:test";
import assert from "node:assert/strict";

import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { findKaiUserByLegacyPublicUserdataId } from "../Backend/kai/db/kaiQueries.js";

test("actor context maps public.userdata.id through explicit query helper and omits full req.user", async () => {
  const calls = [];
  const result = await resolveKaiActorContext(
    {
      user: {
        id: 46,
        email: "kai@getkinder.ai",
        firstname: "KAI",
        lastname: "Service",
        password_hash: "secret",
        session_secret: "secret",
      },
    },
    {
      async findKaiUserByLegacyPublicUserdataId(id) {
        calls.push(["find", id]);
        return {
          user_id: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
          legacy_identity_source: "public.userdata",
          legacy_public_userdata_id: id,
          status: "active",
          email: "kai@getkinder.ai",
        };
      },
      async listKaiRolesForUser(userId) {
        calls.push(["roles", userId]);
        return ["gk_operator"];
      },
      async listOrganizationMembershipsForUser(userId) {
        calls.push(["memberships", userId]);
        return [{ organization_id: "org-1", user_id: userId, role_name: "gk_operator", membership_status: "active" }];
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.actorContext.actorUserId, "7fe568b1-5c05-4c42-bb1f-6e20de216c7b");
  assert.equal(result.actorContext.legacyPublicUserdataId, 46);
  assert.equal(result.actorContext.actorType, "human");
  assert.deepEqual(result.actorContext.safeLegacyUser, {
    id: 46,
    email: "kai@getkinder.ai",
    firstname: "KAI",
    lastname: "Service",
  });
  assert.equal("password_hash" in result.actorContext, false);
  assert.equal("session_secret" in result.actorContext.safeLegacyUser, false);
  assert.deepEqual(calls[0], ["find", 46]);
});

test("actor context returns structured error when no kai.users mapping exists", async () => {
  const result = await resolveKaiActorContext({ id: 99 }, {
    async findKaiUserByLegacyPublicUserdataId() {
      return null;
    },
    async listKaiRolesForUser() {
      throw new Error("should not load roles");
    },
    async listOrganizationMembershipsForUser() {
      throw new Error("should not load memberships");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, "mapped_kai_user_required");
});

test("kai user lookup requires public.userdata source and active status", async () => {
  let queryText = "";
  const result = await findKaiUserByLegacyPublicUserdataId(46, {
    async query(sql, params) {
      queryText = sql;
      assert.deepEqual(params, [46]);
      return { rows: [] };
    },
  });

  assert.equal(result, null);
  assert.match(queryText, /legacy_identity_source = 'public\.userdata'/);
  assert.match(queryText, /legacy_public_userdata_id = \$1/);
  assert.match(queryText, /status = 'active'/);
});

test("inactive users and wrong legacy identity source users do not map", async () => {
  for (const kaiUser of [
    { user_id: "inactive", legacy_identity_source: "public.userdata", legacy_public_userdata_id: 46, status: "inactive" },
    { user_id: "wrong-source", legacy_identity_source: "legacy", legacy_public_userdata_id: 46, status: "active" },
  ]) {
    const result = await resolveKaiActorContext({ id: 46 }, {
      async findKaiUserByLegacyPublicUserdataId() {
        return kaiUser;
      },
      async listKaiRolesForUser() {
        throw new Error("should not load roles");
      },
      async listOrganizationMembershipsForUser() {
        throw new Error("should not load memberships");
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error_code, "mapped_kai_user_required");
  }
});
