import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  findOrCreateActiveKaiOrganizationBindingForGkOrganization,
  findOrCreateInitialEngagementForOrganization,
  selectGkOrganizationRow,
  DEFAULT_INITIAL_ENGAGEMENT_CODE,
} from "../Backend/kai/db/kaiOrganizationEnablementQueries.js";
import {
  enableKaiForOrganization,
  getKaiEnablementStatusForOrganization,
} from "../Backend/kai/services/kaiOrganizationEnablementService.js";
import { deriveEffectiveClientOrganizationMemberships } from "../Backend/kai/auth/gkOrganizationBindingAuthority.js";
import { listActiveGkOrganizationBindingsForGkOrganizationIds } from "../Backend/kai/db/kaiOrganizationBindingQueries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.KAI_SPRINT2_ENABLED = "true";

// Simulates a Postgres pool spanning public.organizations,
// kai.gk_organization_bindings, and kai.engagements, with an advisory-lock
// mutex (mirroring kai-sprint2-jit-actor-provisioning.spec.js) so concurrency
// behavior is proven against the real production code path rather than
// assumed.
function createFakeEnablementPool({ seededGkOrganizationIds = [1] } = {}) {
  const bindings = [];
  const engagements = [];
  let nextEngagementId = 1;
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

  function findBindingByGkOrg(gkOrganizationId) {
    return bindings.find((row) => row.gk_organization_id === gkOrganizationId && row.status === "active") || null;
  }

  function findEngagement(organizationId, engagementCode) {
    return (
      engagements.find(
        (row) => row.organization_id === organizationId && row.engagement_code === engagementCode,
      ) || null
    );
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
        if (sql === "SELECT gen_random_uuid()::text AS id") {
          const suffix = String(bindings.length + engagements.length + 1).padStart(12, "0");
          const id = `a5d17c5a-c55f-43af-9b21-${suffix}`;
          return { rows: [{ id }] };
        }
        if (sql.includes("FROM public.organizations")) {
          const [gkOrganizationId] = params;
          return { rows: seededGkOrganizationIds.includes(gkOrganizationId) ? [{ id: gkOrganizationId }] : [] };
        }
        if (sql.includes("FROM kai.gk_organization_bindings") && sql.includes("gk_organization_id = ANY")) {
          const [ids] = params;
          return { rows: bindings.filter((row) => ids.includes(row.gk_organization_id) && row.status === "active") };
        }
        if (sql.includes("FROM kai.gk_organization_bindings") && sql.includes("LIMIT 1")) {
          const [gkOrganizationId] = params;
          const row = findBindingByGkOrg(gkOrganizationId);
          return { rows: row ? [row] : [] };
        }
        if (sql.startsWith("INSERT INTO kai.gk_organization_bindings")) {
          const [gkOrganizationId, kaiOrganizationId, status] = params;
          if (findBindingByGkOrg(gkOrganizationId)) {
            const error = new Error("duplicate key value violates unique constraint");
            error.code = "23505";
            throw error;
          }
          const row = {
            gk_organization_binding_id: `binding-${bindings.length + 1}`,
            gk_organization_id: gkOrganizationId,
            kai_organization_id: kaiOrganizationId,
            status,
          };
          bindings.push(row);
          return { rows: [row] };
        }
        if (sql.includes("FROM kai.engagements") && sql.includes("LIMIT 1")) {
          const [organizationId, engagementCode] = params;
          const row = findEngagement(organizationId, engagementCode);
          return { rows: row ? [row] : [] };
        }
        if (sql.startsWith("INSERT INTO kai.engagements")) {
          const [organizationId, engagementCode, createdBy] = params;
          if (findEngagement(organizationId, engagementCode)) {
            const error = new Error("duplicate key value violates unique constraint");
            error.code = "23505";
            throw error;
          }
          const row = {
            engagement_id: `engagement-${nextEngagementId++}`,
            organization_id: organizationId,
            engagement_code: engagementCode,
            created_by: createdBy,
          };
          engagements.push(row);
          return { rows: [row] };
        }
        throw new Error(`unexpected fake enablement query: ${sql}`);
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
    get bindings() {
      return [...bindings];
    },
    get engagements() {
      return [...engagements];
    },
  };
}

test("findOrCreateActiveKaiOrganizationBindingForGkOrganization creates a binding on first call", async () => {
  const pool = createFakeEnablementPool();
  const result = await findOrCreateActiveKaiOrganizationBindingForGkOrganization({ gkOrganizationId: 1 }, pool);
  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(pool.bindings.length, 1);
});

test("findOrCreateActiveKaiOrganizationBindingForGkOrganization reuses the existing binding on a second call", async () => {
  const pool = createFakeEnablementPool();
  const first = await findOrCreateActiveKaiOrganizationBindingForGkOrganization({ gkOrganizationId: 1 }, pool);
  const second = await findOrCreateActiveKaiOrganizationBindingForGkOrganization({ gkOrganizationId: 1 }, pool);
  assert.equal(second.ok, true);
  assert.equal(second.created, false);
  assert.equal(second.binding.kai_organization_id, first.binding.kai_organization_id);
  assert.equal(pool.bindings.length, 1);
});

test("findOrCreateActiveKaiOrganizationBindingForGkOrganization converges on one binding under concurrent calls", async () => {
  const pool = createFakeEnablementPool();
  const [a, b, c] = await Promise.all([
    findOrCreateActiveKaiOrganizationBindingForGkOrganization({ gkOrganizationId: 1 }, pool),
    findOrCreateActiveKaiOrganizationBindingForGkOrganization({ gkOrganizationId: 1 }, pool),
    findOrCreateActiveKaiOrganizationBindingForGkOrganization({ gkOrganizationId: 1 }, pool),
  ]);
  assert.equal(pool.bindings.length, 1);
  const kaiOrgIds = new Set([a.binding.kai_organization_id, b.binding.kai_organization_id, c.binding.kai_organization_id]);
  assert.equal(kaiOrgIds.size, 1);
  assert.equal([a, b, c].filter((r) => r.created).length, 1);
});

test("findOrCreateInitialEngagementForOrganization creates then reuses the initial engagement", async () => {
  const pool = createFakeEnablementPool();
  const first = await findOrCreateInitialEngagementForOrganization(
    { organizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f", engagementCode: DEFAULT_INITIAL_ENGAGEMENT_CODE },
    pool,
  );
  const second = await findOrCreateInitialEngagementForOrganization(
    { organizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f", engagementCode: DEFAULT_INITIAL_ENGAGEMENT_CODE },
    pool,
  );
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.engagement.engagement_id, first.engagement.engagement_id);
  assert.equal(pool.engagements.length, 1);
});

function buildDependencies(pool, { adminMemberships = [] } = {}) {
  return {
    env: { KAI_SPRINT2_ENABLED: "true" },
    resolveKaiActorContext: async () => ({
      ok: true,
      actorContext: {
        actorType: "human",
        actorUserId: "kai-user-1",
        legacyPublicUserdataId: 501,
        organizationMemberships: [],
      },
    }),
    resolveOrgScopeForUserId: async () => ({ memberships: adminMemberships }),
    selectGkOrganizationRow: (gkOrganizationId) => selectGkOrganizationRow(gkOrganizationId, pool),
    findOrCreateActiveKaiOrganizationBindingForGkOrganization: (input) =>
      findOrCreateActiveKaiOrganizationBindingForGkOrganization(input, pool),
    findOrCreateInitialEngagementForOrganization: (input) =>
      findOrCreateInitialEngagementForOrganization(input, pool),
    listActiveGkOrganizationBindingsForGkOrganizationIds: (ids) =>
      listActiveGkOrganizationBindingsForGkOrganizationIds(ids, pool),
    createProductionMetadataOnlyAuditForOrganizationKaiEnablement: () => ({
      prepareMetadataOnlyAudit: () => ({ ok: true, async publish() {} }),
    }),
  };
}

test("enableKaiForOrganization denies a non-admin actor", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool, { adminMemberships: [{ orgId: 1, role: "volunteer", is_active: true }] });
  const result = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(pool.bindings.length, 0);
});

test("enableKaiForOrganization returns not_found for a Get Kinder organization that does not exist", async () => {
  const pool = createFakeEnablementPool({ seededGkOrganizationIds: [] });
  const dependencies = buildDependencies(pool, { adminMemberships: [{ orgId: 1, role: "admin", is_active: true }] });
  const result = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("enableKaiForOrganization is disabled behind the KAI_SPRINT2_ENABLED feature flag", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool, { adminMemberships: [{ orgId: 1, role: "admin", is_active: true }] });
  dependencies.env = { KAI_SPRINT2_ENABLED: "false" };
  const result = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("enableKaiForOrganization creates the binding and initial engagement for an authorized admin", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool, { adminMemberships: [{ orgId: 1, role: "admin", is_active: true }] });
  const result = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(result.ok, true);
  assert.equal(result.data.kai_enabled, true);
  assert.ok(result.data.kai_organization_id);
  assert.ok(result.data.engagement_id);
  assert.equal(result.data.engagement_code, DEFAULT_INITIAL_ENGAGEMENT_CODE);
  assert.equal(pool.bindings.length, 1);
  assert.equal(pool.engagements.length, 1);
});

test("enableKaiForOrganization is idempotent: a second identical call returns the same resources", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool, { adminMemberships: [{ orgId: 1, role: "admin", is_active: true }] });
  const first = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  const second = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.deepEqual(second.data, first.data);
  assert.equal(pool.bindings.length, 1);
  assert.equal(pool.engagements.length, 1);
});

test("enableKaiForOrganization concurrent calls for the same organization cannot produce duplicates", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool, { adminMemberships: [{ orgId: 1, role: "admin", is_active: true }] });
  const results = await Promise.all(
    Array.from({ length: 5 }, () => enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies)),
  );
  assert.ok(results.every((r) => r.ok));
  const kaiOrgIds = new Set(results.map((r) => r.data.kai_organization_id));
  const engagementIds = new Set(results.map((r) => r.data.engagement_id));
  assert.equal(kaiOrgIds.size, 1);
  assert.equal(engagementIds.size, 1);
  assert.equal(pool.bindings.length, 1);
  assert.equal(pool.engagements.length, 1);
});

test("getKaiEnablementStatusForOrganization reports not-enabled before enablement, enabled after", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool, { adminMemberships: [{ orgId: 1, role: "admin", is_active: true }] });

  const before = await getKaiEnablementStatusForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(before.ok, true);
  assert.equal(before.data.kai_enabled, false);

  await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);

  const after = await getKaiEnablementStatusForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(after.ok, true);
  assert.equal(after.data.kai_enabled, true);
  assert.ok(after.data.kai_organization_id);
  assert.ok(after.data.engagement_id);
});

test("client_admin derivation still works once an active binding exists (unchanged authority module)", () => {
  const kaiOrganizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
  const memberships = deriveEffectiveClientOrganizationMemberships({
    gkMemberships: [{ orgId: 1, role: "admin", is_active: true }],
    activeBindingsByGkOrganizationId: new Map([[1, { kai_organization_id: kaiOrganizationId, status: "active" }]]),
  });
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].role_name, "client_admin");
  assert.equal(memberships[0].organization_id, kaiOrganizationId);
});

test("sprint2IntakeApi.js contains no direct kai.* database access", () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, "..", "Backend", "kai", "routes", "sprint2IntakeApi.js"),
    "utf8",
  );
  assert.doesNotMatch(routeSource, /FROM\s+kai\./i);
  assert.doesNotMatch(routeSource, /INSERT INTO\s+kai\./i);
  assert.doesNotMatch(routeSource, /UPDATE\s+kai\./i);
});

test("the KAI enablement route requires no UUID entry - only an integer gk organization id path param", () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, "..", "Backend", "kai", "routes", "sprint2IntakeApi.js"),
    "utf8",
  );
  assert.match(routeSource, /admin\/gk-organizations\/:gkOrganizationId\/kai-enablement/);
});
