import test from "node:test";
import assert from "node:assert/strict";

import {
  upsertGkOrganizationBinding,
  listActiveGkOrganizationBindingsForGkOrganizationIds,
} from "../Backend/kai/db/kaiOrganizationBindingQueries.js";
import {
  deriveEffectiveClientOrganizationMemberships,
  resolveEffectiveClientOrganizationMembershipsForLegacyUser,
  GK_ORGANIZATION_ADMIN_ROLE,
  EFFECTIVE_KAI_ROLE_FOR_GK_ORGANIZATION_ADMIN,
} from "../Backend/kai/auth/gkOrganizationBindingAuthority.js";

const KAI_ORG_A = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const KAI_ORG_B = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";

// Simulates a Postgres pool (connect()-based client) with an in-memory
// kai.gk_organization_bindings table honoring the two partial unique
// indexes the migration declares, so the repository's conflict handling can
// be proven without a live database.
function createFakeBindingPool() {
  const rows = [];
  let nextId = 1;

  function findByGkOrg(gkOrganizationId) {
    return rows.find((row) => row.gk_organization_id === gkOrganizationId) || null;
  }

  function activeConflictForKaiOrg(kaiOrganizationId, excludeGkOrganizationId) {
    return rows.find(
      (row) =>
        row.status === "active" &&
        row.kai_organization_id === kaiOrganizationId &&
        row.gk_organization_id !== excludeGkOrganizationId,
    );
  }

  function makeClient() {
    return {
      async query(sql, params = []) {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
        if (sql.includes("FROM kai.gk_organization_bindings") && sql.includes("gk_organization_id = ANY")) {
          const [ids] = params;
          const matched = rows.filter((row) => ids.includes(row.gk_organization_id) && row.status === "active");
          return { rows: matched };
        }
        if (sql.includes("FROM kai.gk_organization_bindings") && sql.includes("LIMIT 1")) {
          const [gkOrganizationId] = params;
          const row = findByGkOrg(gkOrganizationId);
          return { rows: row ? [row] : [] };
        }
        if (sql.startsWith("UPDATE kai.gk_organization_bindings")) {
          const [id, status] = params;
          const row = rows.find((r) => r.gk_organization_binding_id === id);
          row.status = status;
          return { rows: [{ ...row }] };
        }
        if (sql.startsWith("INSERT INTO kai.gk_organization_bindings")) {
          const [gkOrganizationId, kaiOrganizationId, status] = params;
          if (findByGkOrg(gkOrganizationId) || activeConflictForKaiOrg(kaiOrganizationId, gkOrganizationId)) {
            const error = new Error("duplicate key value violates unique constraint");
            error.code = "23505";
            throw error;
          }
          const row = {
            gk_organization_binding_id: `binding-${nextId++}`,
            gk_organization_id: gkOrganizationId,
            kai_organization_id: kaiOrganizationId,
            status,
            created_at: "2026-08-11T00:00:00.000Z",
            updated_at: "2026-08-11T00:00:00.000Z",
          };
          rows.push(row);
          return { rows: [row] };
        }
        throw new Error(`unexpected fake binding query: ${sql}`);
      },
      release() {},
    };
  }

  return {
    async connect() {
      return makeClient();
    },
    async query(sql, params) {
      return makeClient().query(sql, params);
    },
    seed(row) {
      rows.push(row);
    },
    get rows() {
      return [...rows];
    },
  };
}

test("upsertGkOrganizationBinding creates a new active binding explicitly", async () => {
  const pool = createFakeBindingPool();
  const result = await upsertGkOrganizationBinding({ gkOrganizationId: 12, kaiOrganizationId: KAI_ORG_A }, pool);

  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.binding.gk_organization_id, 12);
  assert.equal(result.binding.kai_organization_id, KAI_ORG_A);
  assert.equal(result.binding.status, "active");
});

test("upsertGkOrganizationBinding is idempotent for the same pair", async () => {
  const pool = createFakeBindingPool();
  const first = await upsertGkOrganizationBinding({ gkOrganizationId: 12, kaiOrganizationId: KAI_ORG_A }, pool);
  const second = await upsertGkOrganizationBinding({ gkOrganizationId: 12, kaiOrganizationId: KAI_ORG_A }, pool);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.created, false);
  assert.equal(second.changed, false);
  assert.equal(pool.rows.length, 1);
});

test("upsertGkOrganizationBinding fails closed when the Get Kinder org is already bound to a different KAI tenant", async () => {
  const pool = createFakeBindingPool();
  await upsertGkOrganizationBinding({ gkOrganizationId: 12, kaiOrganizationId: KAI_ORG_A }, pool);
  const conflict = await upsertGkOrganizationBinding({ gkOrganizationId: 12, kaiOrganizationId: KAI_ORG_B }, pool);

  assert.equal(conflict.ok, false);
  assert.equal(conflict.error_code, "conflicting_binding");
  assert.equal(pool.rows.length, 1);
});

test("upsertGkOrganizationBinding fails closed when the KAI tenant is already actively bound to a different Get Kinder org", async () => {
  const pool = createFakeBindingPool();
  await upsertGkOrganizationBinding({ gkOrganizationId: 12, kaiOrganizationId: KAI_ORG_A }, pool);
  const conflict = await upsertGkOrganizationBinding({ gkOrganizationId: 13, kaiOrganizationId: KAI_ORG_A }, pool);

  assert.equal(conflict.ok, false);
  assert.equal(conflict.error_code, "conflicting_binding");
  assert.equal(pool.rows.length, 1);
});

test("upsertGkOrganizationBinding rejects a non-UUID KAI organization id and a non-integer Get Kinder org id", async () => {
  const pool = createFakeBindingPool();
  const badKaiId = await upsertGkOrganizationBinding({ gkOrganizationId: 12, kaiOrganizationId: "not-a-uuid" }, pool);
  const badGkId = await upsertGkOrganizationBinding({ gkOrganizationId: "not-an-int", kaiOrganizationId: KAI_ORG_A }, pool);

  assert.equal(badKaiId.ok, false);
  assert.equal(badKaiId.error_code, "invalid_kai_organization_id");
  assert.equal(badGkId.ok, false);
  assert.equal(badGkId.error_code, "invalid_gk_organization_id");
});

test("upsertGkOrganizationBinding can deactivate and later reactivate the same pair explicitly", async () => {
  const pool = createFakeBindingPool();
  await upsertGkOrganizationBinding({ gkOrganizationId: 12, kaiOrganizationId: KAI_ORG_A }, pool);
  const deactivated = await upsertGkOrganizationBinding(
    { gkOrganizationId: 12, kaiOrganizationId: KAI_ORG_A, status: "inactive" },
    pool,
  );
  const reactivated = await upsertGkOrganizationBinding({ gkOrganizationId: 12, kaiOrganizationId: KAI_ORG_A }, pool);

  assert.equal(deactivated.ok, true);
  assert.equal(deactivated.binding.status, "inactive");
  assert.equal(reactivated.ok, true);
  assert.equal(reactivated.binding.status, "active");
  assert.equal(pool.rows.length, 1);
});

test("listActiveGkOrganizationBindingsForGkOrganizationIds returns only active rows for the requested ids", async () => {
  const pool = createFakeBindingPool();
  await upsertGkOrganizationBinding({ gkOrganizationId: 12, kaiOrganizationId: KAI_ORG_A }, pool);
  await upsertGkOrganizationBinding({ gkOrganizationId: 13, kaiOrganizationId: KAI_ORG_B }, pool);
  await upsertGkOrganizationBinding({ gkOrganizationId: 13, kaiOrganizationId: KAI_ORG_B, status: "inactive" }, pool);

  const active = await listActiveGkOrganizationBindingsForGkOrganizationIds([12, 13, 999], pool);

  assert.deepEqual(
    active.map((row) => row.gk_organization_id).sort(),
    [12],
  );
});

// --- pure derivation ---

test("deriveEffectiveClientOrganizationMemberships translates GK org-admin + active binding into client_admin", () => {
  const memberships = deriveEffectiveClientOrganizationMemberships({
    gkMemberships: [{ orgId: 12, role: GK_ORGANIZATION_ADMIN_ROLE, is_active: true }],
    activeBindingsByGkOrganizationId: new Map([[12, { gk_organization_id: 12, kai_organization_id: KAI_ORG_A, status: "active" }]]),
  });

  assert.deepEqual(memberships, [
    {
      organization_id: KAI_ORG_A,
      role_name: EFFECTIVE_KAI_ROLE_FOR_GK_ORGANIZATION_ADMIN,
      membership_status: "active",
      source: "gk_organization_binding",
      gk_organization_id: 12,
    },
  ]);
});

test("deriveEffectiveClientOrganizationMemberships does not translate a non-admin Get Kinder role", () => {
  const memberships = deriveEffectiveClientOrganizationMemberships({
    gkMemberships: [{ orgId: 12, role: "member", is_active: true }],
    activeBindingsByGkOrganizationId: new Map([[12, { gk_organization_id: 12, kai_organization_id: KAI_ORG_A, status: "active" }]]),
  });

  assert.deepEqual(memberships, []);
});

test("deriveEffectiveClientOrganizationMemberships ignores an inactive Get Kinder membership", () => {
  const memberships = deriveEffectiveClientOrganizationMemberships({
    gkMemberships: [{ orgId: 12, role: GK_ORGANIZATION_ADMIN_ROLE, is_active: false }],
    activeBindingsByGkOrganizationId: new Map([[12, { gk_organization_id: 12, kai_organization_id: KAI_ORG_A, status: "active" }]]),
  });

  assert.deepEqual(memberships, []);
});

test("deriveEffectiveClientOrganizationMemberships fails closed with no binding for the org", () => {
  const memberships = deriveEffectiveClientOrganizationMemberships({
    gkMemberships: [{ orgId: 12, role: GK_ORGANIZATION_ADMIN_ROLE, is_active: true }],
    activeBindingsByGkOrganizationId: new Map(),
  });

  assert.deepEqual(memberships, []);
});

// --- orchestration ---

test("resolveEffectiveClientOrganizationMembershipsForLegacyUser reuses the existing Get Kinder org-scope helper and the binding", async () => {
  const dependencies = {
    async resolveOrgScopeForUserId(legacyUserId) {
      assert.equal(legacyUserId, 46);
      return { memberships: [{ orgId: 12, role: "admin", is_active: true, org_name: "Acme", org_status: "approved" }] };
    },
    async listActiveGkOrganizationBindingsForGkOrganizationIds(ids) {
      assert.deepEqual(ids, [12]);
      return [{ gk_organization_id: 12, kai_organization_id: KAI_ORG_A, status: "active" }];
    },
  };

  const memberships = await resolveEffectiveClientOrganizationMembershipsForLegacyUser(46, dependencies);

  assert.deepEqual(memberships, [
    {
      organization_id: KAI_ORG_A,
      role_name: "client_admin",
      membership_status: "active",
      source: "gk_organization_binding",
      gk_organization_id: 12,
    },
  ]);
});

test("resolveEffectiveClientOrganizationMembershipsForLegacyUser fails closed with no Get Kinder organization access", async () => {
  const dependencies = {
    async resolveOrgScopeForUserId() {
      return { memberships: [] };
    },
    async listActiveGkOrganizationBindingsForGkOrganizationIds() {
      throw new Error("must not be called with no admin-role org memberships");
    },
  };

  const memberships = await resolveEffectiveClientOrganizationMembershipsForLegacyUser(46, dependencies);

  assert.deepEqual(memberships, []);
});

test("resolveEffectiveClientOrganizationMembershipsForLegacyUser fails closed with an inactive Get Kinder membership", async () => {
  const dependencies = {
    async resolveOrgScopeForUserId() {
      return { memberships: [{ orgId: 12, role: "admin", is_active: false }] };
    },
    async listActiveGkOrganizationBindingsForGkOrganizationIds() {
      throw new Error("must not be called for an inactive Get Kinder membership");
    },
  };

  const memberships = await resolveEffectiveClientOrganizationMembershipsForLegacyUser(46, dependencies);

  assert.deepEqual(memberships, []);
});

test("resolveEffectiveClientOrganizationMembershipsForLegacyUser fails closed with no binding for an active Get Kinder membership", async () => {
  const dependencies = {
    async resolveOrgScopeForUserId() {
      return { memberships: [{ orgId: 12, role: "admin", is_active: true }] };
    },
    async listActiveGkOrganizationBindingsForGkOrganizationIds() {
      return [];
    },
  };

  const memberships = await resolveEffectiveClientOrganizationMembershipsForLegacyUser(46, dependencies);

  assert.deepEqual(memberships, []);
});

test("resolveEffectiveClientOrganizationMembershipsForLegacyUser fails closed with an inactive binding", async () => {
  const dependencies = {
    async resolveOrgScopeForUserId() {
      return { memberships: [{ orgId: 12, role: "admin", is_active: true }] };
    },
    async listActiveGkOrganizationBindingsForGkOrganizationIds() {
      // The read helper itself only ever returns active rows in production,
      // but the derivation layer double-checks status defensively.
      return [{ gk_organization_id: 12, kai_organization_id: KAI_ORG_A, status: "inactive" }];
    },
  };

  const memberships = await resolveEffectiveClientOrganizationMembershipsForLegacyUser(46, dependencies);

  assert.deepEqual(memberships, []);
});

test("resolveEffectiveClientOrganizationMembershipsForLegacyUser does not let membership in org A authorize KAI org B", async () => {
  const dependencies = {
    async resolveOrgScopeForUserId() {
      return { memberships: [{ orgId: 12, role: "admin", is_active: true }] };
    },
    async listActiveGkOrganizationBindingsForGkOrganizationIds() {
      return [{ gk_organization_id: 12, kai_organization_id: KAI_ORG_A, status: "active" }];
    },
  };

  const memberships = await resolveEffectiveClientOrganizationMembershipsForLegacyUser(46, dependencies);

  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].organization_id, KAI_ORG_A);
  assert.notEqual(memberships[0].organization_id, KAI_ORG_B);
});
