import test from "node:test";
import assert from "node:assert/strict";

import { findOrCreateKaiUserByLegacyPublicUserdataId } from "../Backend/kai/db/kaiQueries.js";
import { resolveKaiActorContext } from "../Backend/kai/auth/kaiActorContext.js";
import { validateActorCanPerformOperation } from "../Backend/kai/auth/kaiAuthorizationService.js";

// Simulates a Postgres pool for findOrCreateKaiUserByLegacyPublicUserdataId: a
// connect()-based client with an advisory-lock mutex, so tests can prove the
// production code path (transaction + pg_advisory_xact_lock) actually
// serializes concurrent first-provisioning attempts instead of assuming it.
function createFakeKaiUsersPool({ insertDelayMs = 0 } = {}) {
  const rowsByLegacyId = new Map();
  let nextUserId = 1;
  let insertCount = 0;
  let lockHeld = false;
  const lockWaiters = [];

  function acquireLock() {
    if (!lockHeld) {
      lockHeld = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => lockWaiters.push(resolve));
  }

  function releaseLock() {
    const next = lockWaiters.shift();
    if (next) {
      next();
      return;
    }
    lockHeld = false;
  }

  function makeClient() {
    let holdsLock = false;
    return {
      async query(sql, params = []) {
        if (sql === "BEGIN") return { rows: [] };
        if (sql === "COMMIT" || sql === "ROLLBACK") {
          if (holdsLock) {
            holdsLock = false;
            releaseLock();
          }
          return { rows: [] };
        }
        if (sql.startsWith("SELECT pg_advisory_xact_lock")) {
          await acquireLock();
          holdsLock = true;
          return { rows: [] };
        }
        if (sql.startsWith("SELECT") && sql.includes("FROM kai.users")) {
          const [legacyPublicUserdataId] = params;
          const row = rowsByLegacyId.get(legacyPublicUserdataId);
          return { rows: row ? [row] : [] };
        }
        if (sql.startsWith("INSERT INTO kai.users")) {
          const [legacyPublicUserdataId, email] = params;
          if (insertDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, insertDelayMs));
          }
          insertCount += 1;
          const row = {
            user_id: `jit-kai-user-${nextUserId++}`,
            legacy_identity_source: "public.userdata",
            legacy_public_userdata_id: legacyPublicUserdataId,
            status: "active",
            email,
          };
          rowsByLegacyId.set(legacyPublicUserdataId, row);
          return { rows: [row] };
        }
        throw new Error(`unexpected fake kai.users query: ${sql}`);
      },
      release() {},
    };
  }

  return {
    async connect() {
      return makeClient();
    },
    seed(legacyPublicUserdataId, row) {
      rowsByLegacyId.set(legacyPublicUserdataId, row);
    },
    get insertCount() {
      return insertCount;
    },
    get rows() {
      return [...rowsByLegacyId.values()];
    },
  };
}

test("findOrCreateKaiUserByLegacyPublicUserdataId provisions a kai.users row when none exists", async () => {
  const pool = createFakeKaiUsersPool();

  const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId(
    { legacyPublicUserdataId: 46, email: "kai@getkinder.ai" },
    pool,
  );

  assert.equal(pool.insertCount, 1);
  assert.equal(kaiUser.legacy_identity_source, "public.userdata");
  assert.equal(kaiUser.legacy_public_userdata_id, 46);
  assert.equal(kaiUser.status, "active");
  assert.ok(kaiUser.user_id);
});

test("findOrCreateKaiUserByLegacyPublicUserdataId is idempotent across repeated calls", async () => {
  const pool = createFakeKaiUsersPool();

  const first = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: 46 }, pool);
  const second = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: 46 }, pool);
  const third = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: 46 }, pool);

  assert.equal(pool.insertCount, 1);
  assert.equal(first.user_id, second.user_id);
  assert.equal(second.user_id, third.user_id);
});

test("findOrCreateKaiUserByLegacyPublicUserdataId serializes concurrent first-provisioning attempts without creating duplicates", async () => {
  const pool = createFakeKaiUsersPool({ insertDelayMs: 15 });

  const [a, b] = await Promise.all([
    findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: 46, email: "a@getkinder.ai" }, pool),
    findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: 46, email: "b@getkinder.ai" }, pool),
  ]);

  assert.equal(pool.insertCount, 1);
  assert.equal(pool.rows.length, 1);
  assert.equal(a.user_id, b.user_id);
});

test("findOrCreateKaiUserByLegacyPublicUserdataId never resurrects an explicitly non-active existing row", async () => {
  const pool = createFakeKaiUsersPool();
  pool.seed(46, {
    user_id: "deprovisioned-kai-user",
    legacy_identity_source: "public.userdata",
    legacy_public_userdata_id: 46,
    status: "inactive",
    email: "deprovisioned@getkinder.ai",
  });

  const kaiUser = await findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId: 46 }, pool);

  assert.equal(pool.insertCount, 0);
  assert.equal(kaiUser.status, "inactive");
  assert.equal(kaiUser.user_id, "deprovisioned-kai-user");
});

function fakeGetKinderUser(overrides = {}) {
  return { id: 46, email: "kai@getkinder.ai", firstname: "Kai", lastname: "Operator", ...overrides };
}

test("resolveKaiActorContext auto-provisions an authenticated Get Kinder user with no pre-existing kai.users mapping", async () => {
  let createCalls = 0;
  const dependencies = {
    async findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId, email }) {
      createCalls += 1;
      return {
        user_id: "jit-kai-user-46",
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: legacyPublicUserdataId,
        status: "active",
        email,
      };
    },
    async listKaiRolesForUser() {
      return [];
    },
    async listOrganizationMembershipsForUser() {
      return [];
    },
  };

  const result = await resolveKaiActorContext({ user: fakeGetKinderUser() }, dependencies);

  assert.equal(createCalls, 1);
  assert.equal(result.ok, true);
  assert.notEqual(result.error_code, "mapped_kai_user_required");
  assert.equal(result.actorContext.actorUserId, "jit-kai-user-46");
  assert.equal(result.actorContext.legacyPublicUserdataId, 46);
  assert.deepEqual(result.actorContext.kaiRoles, []);
  assert.deepEqual(result.actorContext.organizationMemberships, []);
});

test("resolveKaiActorContext resolution is idempotent and returns a deterministic actor identity across repeated requests", async () => {
  const pool = createFakeKaiUsersPool();
  const dependencies = {
    findOrCreateKaiUserByLegacyPublicUserdataId: (args) => findOrCreateKaiUserByLegacyPublicUserdataId(args, pool),
    async listKaiRolesForUser() {
      return [];
    },
    async listOrganizationMembershipsForUser() {
      return [];
    },
  };

  const first = await resolveKaiActorContext({ user: fakeGetKinderUser() }, dependencies);
  const second = await resolveKaiActorContext({ user: fakeGetKinderUser() }, dependencies);

  assert.equal(pool.insertCount, 1);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.actorContext.actorUserId, second.actorContext.actorUserId);
});

test("resolveKaiActorContext leaves an already-mapped active kai.users identity unaffected (no re-creation)", async () => {
  let createCalls = 0;
  const dependencies = {
    async findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId }) {
      createCalls += 1;
      return {
        user_id: "existing-kai-user-46",
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: legacyPublicUserdataId,
        status: "active",
        email: "kai@getkinder.ai",
      };
    },
    async listKaiRolesForUser() {
      return ["gk_operator"];
    },
    async listOrganizationMembershipsForUser() {
      return [{ organization_id: "org-1", role_name: "gk_operator", membership_status: "active" }];
    },
  };

  const result = await resolveKaiActorContext({ user: fakeGetKinderUser() }, dependencies);

  assert.equal(createCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.actorContext.actorUserId, "existing-kai-user-46");
  assert.deepEqual(result.actorContext.kaiRoles, ["gk_operator"]);
});

test("resolveKaiActorContext still fails closed with mapped_kai_user_required for an explicitly deactivated kai.users mapping", async () => {
  const dependencies = {
    async findOrCreateKaiUserByLegacyPublicUserdataId({ legacyPublicUserdataId }) {
      return {
        user_id: "deprovisioned-kai-user",
        legacy_identity_source: "public.userdata",
        legacy_public_userdata_id: legacyPublicUserdataId,
        status: "inactive",
      };
    },
  };

  const result = await resolveKaiActorContext({ user: fakeGetKinderUser() }, dependencies);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, "mapped_kai_user_required");
});

test("resolveKaiActorContext remains unauthorized for an unauthenticated request (no req.user)", async () => {
  const dependencies = {
    async findOrCreateKaiUserByLegacyPublicUserdataId() {
      throw new Error("must not be called without an authenticated user");
    },
  };

  const result = await resolveKaiActorContext({}, dependencies);

  assert.equal(result.ok, false);
  assert.equal(result.error_code, "unauthorized");
});

test("a JIT-provisioned actor with no organization memberships is denied access to any organization purely by being signed in", () => {
  const actorContext = {
    actorType: "human",
    actorUserId: "jit-kai-user-46",
    kaiRoles: [],
    organizationMemberships: [],
  };

  const result = validateActorCanPerformOperation(actorContext, "read_intake", "org-a");

  assert.equal(result.ok, false);
  assert.equal(result.error_code, "authorization_denied");
});

test("an authenticated actor mapped to one organization cannot access a different organization's KAI resources", () => {
  const actorContext = {
    actorType: "human",
    actorUserId: "kai-user-46",
    kaiRoles: ["gk_operator"],
    organizationMemberships: [{ organization_id: "org-a", role_name: "gk_operator", membership_status: "active" }],
  };

  const sameOrg = validateActorCanPerformOperation(actorContext, "read_intake", "org-a");
  const otherOrg = validateActorCanPerformOperation(actorContext, "read_intake", "org-b");

  assert.equal(sameOrg.ok, true);
  assert.equal(otherOrg.ok, false);
  assert.equal(otherOrg.error_code, "authorization_denied");
});
