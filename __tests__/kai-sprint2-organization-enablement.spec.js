import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { withTransaction } from "../Backend/kai/db/kaiDb.js";
import {
  DEFAULT_INITIAL_ENGAGEMENT_CODE,
  insertGkOrganizationBinding,
  insertKaiOrganization,
  selectGkOrganizationRow,
  selectInitialEngagementForOrganization,
  selectKaiOrganizationRow,
} from "../Backend/kai/db/kaiOrganizationEnablementQueries.js";
import {
  enableKaiForOrganization,
  getKaiEnablementStatusForOrganization,
} from "../Backend/kai/services/kaiOrganizationEnablementService.js";
import { deriveEffectiveClientOrganizationMemberships } from "../Backend/kai/auth/gkOrganizationBindingAuthority.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.KAI_SPRINT2_ENABLED = "true";

const KAI_ORG_UUID_A = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";

/**
 * Simulates a Postgres pool spanning public.organizations,
 * kai.organizations, kai.gk_organization_bindings, and kai.engagements, with
 * a single-transaction-aware BEGIN/pg_advisory_xact_lock/COMMIT/ROLLBACK
 * mutex (mirroring kai-sprint2-jit-actor-provisioning.spec.js), so these
 * tests prove the real orchestration sequence and rollback behavior against
 * a simulated backend, not just each primitive in isolation. The real
 * PostgreSQL FK/constraint/default proof lives in
 * kai-sprint2-organization-enablement.integration.spec.js.
 */
function createFakeEnablementPool({ seededGkOrganizations = { 1: "Test Org" } } = {}) {
  const kaiOrganizations = [];
  const bindings = [];
  const engagements = [];
  let nextOrgSuffix = 1;
  let nextBindingId = 1;
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
    if (next) next();
    else lockHeld = false;
  }

  // Transaction-aware: each client buffers its own pending inserts and only
  // merges them into the shared committed arrays on COMMIT - ROLLBACK
  // discards the buffer entirely. This is what makes the forced-failure and
  // inconsistent-binding tests below a real proof of rollback behavior
  // rather than an artifact of a fake pool that never undoes anything.
  function makeClient() {
    let holdsLock = false;
    const pendingOrganizations = [];
    const pendingBindings = [];
    const pendingEngagements = [];
    const visibleOrganizations = () => [...kaiOrganizations, ...pendingOrganizations];
    const visibleBindings = () => [...bindings, ...pendingBindings];
    const visibleEngagements = () => [...engagements, ...pendingEngagements];

    return {
      async query(sql, params = []) {
        if (sql === "BEGIN") return { rows: [] };
        if (sql === "COMMIT") {
          kaiOrganizations.push(...pendingOrganizations);
          bindings.push(...pendingBindings);
          engagements.push(...pendingEngagements);
          if (holdsLock) {
            holdsLock = false;
            releaseLock();
          }
          return { rows: [] };
        }
        if (sql === "ROLLBACK") {
          pendingOrganizations.length = 0;
          pendingBindings.length = 0;
          pendingEngagements.length = 0;
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
        if (sql.includes("FROM public.organizations")) {
          const [id] = params;
          const name = seededGkOrganizations[id];
          return { rows: name !== undefined ? [{ id, name }] : [] };
        }
        if (sql.includes("FROM kai.organizations") && sql.includes("LIMIT 1")) {
          const [organizationId] = params;
          const row = visibleOrganizations().find((o) => o.organization_id === organizationId);
          return { rows: row ? [{ organization_id: row.organization_id }] : [] };
        }
        if (sql.startsWith("INSERT INTO kai.organizations")) {
          const [name, legacyId] = params;
          const organizationId = `${KAI_ORG_UUID_A.slice(0, -12)}${String(nextOrgSuffix++).padStart(12, "0")}`;
          pendingOrganizations.push({
            organization_id: organizationId,
            name,
            legacy_public_organization_id: legacyId,
            legacy_public_organization_source: "public.organizations",
          });
          return { rows: [{ organization_id: organizationId }] };
        }
        if (sql.includes("FROM kai.gk_organization_bindings") && sql.includes("gk_organization_id = ANY")) {
          const [ids] = params;
          return { rows: visibleBindings().filter((b) => ids.includes(b.gk_organization_id) && b.status === "active") };
        }
        if (sql.startsWith("INSERT INTO kai.gk_organization_bindings")) {
          const [gkOrganizationId, kaiOrganizationId] = params;
          const conflict = visibleBindings().some(
            (b) =>
              b.status === "active" &&
              (b.gk_organization_id === gkOrganizationId || b.kai_organization_id === kaiOrganizationId),
          );
          if (conflict) {
            const error = new Error("duplicate key value violates unique constraint");
            error.code = "23505";
            throw error;
          }
          const row = {
            gk_organization_binding_id: `binding-${nextBindingId++}`,
            gk_organization_id: gkOrganizationId,
            kai_organization_id: kaiOrganizationId,
            status: "active",
          };
          pendingBindings.push(row);
          return { rows: [row] };
        }
        if (sql.includes("FROM kai.engagements") && sql.includes("LIMIT 1")) {
          const [organizationId, engagementCode] = params;
          const row = visibleEngagements().find((e) => e.organization_id === organizationId && e.engagement_code === engagementCode);
          return { rows: row ? [row] : [] };
        }
        if (sql.startsWith("INSERT INTO kai.engagements")) {
          const [organizationId, engagementCode] = params;
          const conflict = visibleEngagements().some((e) => e.organization_id === organizationId && e.engagement_code === engagementCode);
          if (conflict) {
            const error = new Error("duplicate key value violates unique constraint");
            error.code = "23505";
            throw error;
          }
          const row = { engagement_id: `engagement-${nextEngagementId++}`, organization_id: organizationId, engagement_code: engagementCode };
          pendingEngagements.push(row);
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
      // Standalone (non-transactional) reads/writes commit immediately -
      // used for direct test seeding and for the read-only status path,
      // which never opens a transaction.
      const client = makeClient();
      const result = await client.query(sql, params);
      if (sql.startsWith("INSERT")) await client.query("COMMIT");
      return result;
    },
    get kaiOrganizations() {
      return [...kaiOrganizations];
    },
    get bindings() {
      return [...bindings];
    },
    get engagements() {
      return [...engagements];
    },
  };
}

const FAKE_ACTOR_USER_ID = "11111111-1111-4111-8111-111111111111";

function buildDependencies(pool, { adminMemberships = [{ orgId: 1, role: "admin", is_active: true }], overrides = {} } = {}) {
  return {
    env: { KAI_SPRINT2_ENABLED: "true" },
    resolveKaiActorContext: async () => ({
      ok: true,
      actorContext: {
        actorType: "human",
        actorUserId: FAKE_ACTOR_USER_ID,
        legacyPublicUserdataId: 501,
        organizationMemberships: [],
      },
    }),
    resolveOrgScopeForUserId: async () => ({ memberships: adminMemberships }),
    selectGkOrganizationRow: (gkOrganizationId) => selectGkOrganizationRow(gkOrganizationId, pool),
    withTransaction: (callback) => withTransaction(callback, pool),
    listActiveGkOrganizationBindingsForGkOrganizationIds: (ids) =>
      import("../Backend/kai/db/kaiOrganizationBindingQueries.js").then((m) =>
        m.listActiveGkOrganizationBindingsForGkOrganizationIds(ids, pool),
      ),
    selectKaiOrganizationRow: (id) => selectKaiOrganizationRow(id, pool),
    selectInitialEngagementForOrganization: (input) => selectInitialEngagementForOrganization(input, pool),
    createProductionMetadataOnlyAuditForOrganizationKaiEnablement: () => ({
      prepareMetadataOnlyAudit: () => ({ ok: true, async publish() {} }),
    }),
    ...overrides,
  };
}

test("insertKaiOrganization fails closed with no INSERT when the name is blank or whitespace", async () => {
  const pool = createFakeEnablementPool();
  const blank = await insertKaiOrganization({ name: "   ", legacyPublicOrganizationId: 1 }, pool);
  assert.equal(blank.ok, false);
  assert.equal(blank.error_code, "invalid_organization_name");
  assert.equal(pool.kaiOrganizations.length, 0);
});

test("insertKaiOrganization inserts only name/legacy_public_organization_id/legacy_public_organization_source", async () => {
  const pool = createFakeEnablementPool();
  const result = await insertKaiOrganization({ name: "Acme Org", legacyPublicOrganizationId: 1 }, pool);
  assert.equal(result.ok, true);
  assert.equal(pool.kaiOrganizations.length, 1);
  const row = pool.kaiOrganizations[0];
  assert.equal(row.name, "Acme Org");
  assert.equal(row.legacy_public_organization_id, 1);
  assert.equal(row.legacy_public_organization_source, "public.organizations");
  assert.equal(row.organization_id, result.organizationId);
});

test("insertGkOrganizationBinding does not open its own nested transaction (no BEGIN/COMMIT queries observed)", async () => {
  const pool = createFakeEnablementPool();
  const client = await pool.connect();
  const seen = [];
  const originalQuery = client.query.bind(client);
  client.query = (sql, params) => {
    seen.push(sql);
    return originalQuery(sql, params);
  };
  await client.query("BEGIN");
  const result = await insertGkOrganizationBinding({ gkOrganizationId: 1, kaiOrganizationId: KAI_ORG_UUID_A }, client);
  assert.equal(result.ok, true);
  assert.equal(seen.filter((s) => s === "BEGIN").length, 1);
  assert.equal(seen.filter((s) => s === "COMMIT").length, 0);
});

test("enableKaiForOrganization denies a non-admin actor", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool, { adminMemberships: [{ orgId: 1, role: "volunteer", is_active: true }] });
  const result = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
  assert.equal(pool.kaiOrganizations.length, 0);
});

test("enableKaiForOrganization returns not_found for a Get Kinder organization that does not exist", async () => {
  const pool = createFakeEnablementPool({ seededGkOrganizations: {} });
  const dependencies = buildDependencies(pool);
  const result = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
});

test("enableKaiForOrganization fails closed before any write when the GK organization name is blank", async () => {
  const pool = createFakeEnablementPool({ seededGkOrganizations: { 1: "   " } });
  const dependencies = buildDependencies(pool);
  const result = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(pool.kaiOrganizations.length, 0);
  assert.equal(pool.bindings.length, 0);
});

test("enableKaiForOrganization is disabled behind the KAI_SPRINT2_ENABLED feature flag", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool);
  dependencies.env = { KAI_SPRINT2_ENABLED: "false" };
  const result = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("enableKaiForOrganization inserts a real kai.organizations row using the authoritative GK organization name", async () => {
  const pool = createFakeEnablementPool({ seededGkOrganizations: { 1: "Metro Vancouver Food Security Society" } });
  const dependencies = buildDependencies(pool);
  const result = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(result.ok, true);
  assert.equal(pool.kaiOrganizations.length, 1);
  const orgRow = pool.kaiOrganizations[0];
  assert.equal(orgRow.name, "Metro Vancouver Food Security Society");
  assert.equal(orgRow.legacy_public_organization_id, 1);
  assert.equal(orgRow.legacy_public_organization_source, "public.organizations");
  assert.equal(pool.bindings.length, 1);
  assert.equal(pool.bindings[0].kai_organization_id, orgRow.organization_id);
  assert.equal(pool.engagements.length, 1);
  assert.equal(pool.engagements[0].organization_id, orgRow.organization_id);
  assert.equal(result.data.kai_organization_id, orgRow.organization_id);
  assert.equal(result.data.engagement_code, DEFAULT_INITIAL_ENGAGEMENT_CODE);
});

test("enableKaiForOrganization is idempotent: a second identical call returns the same resources and creates no second organization row", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool);
  const first = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  const second = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.deepEqual(second.data, first.data);
  assert.equal(pool.kaiOrganizations.length, 1);
  assert.equal(pool.bindings.length, 1);
  assert.equal(pool.engagements.length, 1);
});

test("enableKaiForOrganization concurrent calls for the same organization cannot produce duplicates", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies)),
  );
  assert.ok(results.every((r) => r.ok));
  assert.equal(new Set(results.map((r) => r.data.kai_organization_id)).size, 1);
  assert.equal(new Set(results.map((r) => r.data.engagement_id)).size, 1);
  assert.equal(pool.kaiOrganizations.length, 1);
  assert.equal(pool.bindings.length, 1);
  assert.equal(pool.engagements.length, 1);
});

test("forced engagement failure rolls back the newly created organization and binding", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool, {
    overrides: {
      insertInitialEngagement: async () => {
        throw new Error("forced_engagement_failure");
      },
    },
  });
  const result = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(result.ok, false);
  assert.equal(pool.kaiOrganizations.length, 0);
  assert.equal(pool.bindings.length, 0);
  assert.equal(pool.engagements.length, 0);
});

test("forced required-audit failure rolls back the newly created organization, binding, and engagement", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool, {
    overrides: {
      createProductionMetadataOnlyAuditForOrganizationKaiEnablement: () => ({
        prepareMetadataOnlyAudit: () => ({
          ok: true,
          async publish() {
            throw new Error("forced_audit_failure");
          },
        }),
      }),
    },
  });
  const result = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(result.ok, false);
  assert.equal(pool.kaiOrganizations.length, 0);
  assert.equal(pool.bindings.length, 0);
  assert.equal(pool.engagements.length, 0);
});

test("an active binding referencing a missing kai.organizations row fails closed with zero repair writes", async () => {
  const pool = createFakeEnablementPool();
  // Seed an inconsistent binding directly (bypassing insertGkOrganizationBinding,
  // which would require a real kai.organizations row to already exist under
  // this fake pool's own invariants).
  const client = await pool.connect();
  await client.query(
    "INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2, 'active')",
    [1, "b5d17c5a-c55f-43af-9b21-fe63aafe733f"],
  );
  await client.query("COMMIT");

  const dependencies = buildDependencies(pool);
  const result = await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict");
  assert.equal(pool.kaiOrganizations.length, 0);
  assert.equal(pool.engagements.length, 0);
});

test("legacy_public_organization_id is never used as an ON CONFLICT target or uniqueness authority", () => {
  const querySource = fs.readFileSync(
    path.join(__dirname, "..", "Backend", "kai", "db", "kaiOrganizationEnablementQueries.js"),
    "utf8",
  );
  assert.doesNotMatch(querySource, /ON CONFLICT[^;]*legacy_public_organization_id/is);
});

test("getKaiEnablementStatusForOrganization issues no INSERT/UPDATE/DELETE and does not create a missing engagement", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool);
  const before = await getKaiEnablementStatusForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(before.ok, true);
  assert.equal(before.data.kai_enabled, false);
  assert.equal(pool.kaiOrganizations.length, 0);
  assert.equal(pool.bindings.length, 0);
  assert.equal(pool.engagements.length, 0);
});

test("getKaiEnablementStatusForOrganization reports enabled only once organization, binding, and engagement all exist", async () => {
  const pool = createFakeEnablementPool();
  const dependencies = buildDependencies(pool);

  await enableKaiForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);

  const after = await getKaiEnablementStatusForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(after.ok, true);
  assert.equal(after.data.kai_enabled, true);
  assert.ok(after.data.kai_organization_id);
  assert.ok(after.data.engagement_id);
});

test("getKaiEnablementStatusForOrganization fails closed on an active binding with no corresponding organization row", async () => {
  const pool = createFakeEnablementPool();
  const client = await pool.connect();
  await client.query(
    "INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2, 'active')",
    [1, "b5d17c5a-c55f-43af-9b21-fe63aafe733f"],
  );
  await client.query("COMMIT");
  const dependencies = buildDependencies(pool);
  const status = await getKaiEnablementStatusForOrganization({ gkOrganizationId: 1, req: { user: { id: 501 } } }, dependencies);
  assert.equal(status.ok, false);
  assert.equal(status.error.code, "conflict");
});

test("client_admin derivation still works once an active binding exists (unchanged authority module)", () => {
  const kaiOrganizationId = KAI_ORG_UUID_A;
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

test("DEFAULT_INITIAL_ENGAGEMENT_CODE remains unrenamed and documented as NOT_CONFIRMED", () => {
  const querySource = fs.readFileSync(
    path.join(__dirname, "..", "Backend", "kai", "db", "kaiOrganizationEnablementQueries.js"),
    "utf8",
  );
  assert.match(querySource, /DEFAULT_INITIAL_ENGAGEMENT_CODE = "initial-pilot-assessment"/);
  assert.match(querySource, /NOT_CONFIRMED/);
  assert.equal(DEFAULT_INITIAL_ENGAGEMENT_CODE, "initial-pilot-assessment");
});
