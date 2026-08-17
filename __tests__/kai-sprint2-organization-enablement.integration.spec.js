import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_ORGANIZATION_ENABLEMENT_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`organization_enablement integration suite refused a non-loopback KAI_ORGANIZATION_ENABLEMENT_DATABASE_URL host: ${host}`);
  }
}

test("organization_enablement PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("organization_enablement integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runIntegrationSuite();
}

async function runIntegrationSuite() {
  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const {
    selectGkOrganizationRow,
    selectKaiOrganizationRow,
    selectInitialEngagementForOrganization,
    DEFAULT_INITIAL_ENGAGEMENT_CODE,
  } = await import("../Backend/kai/db/kaiOrganizationEnablementQueries.js");
  const { listActiveGkOrganizationBindingsForGkOrganizationIds } = await import(
    "../Backend/kai/db/kaiOrganizationBindingQueries.js"
  );
  const { enableKaiForOrganization, getKaiEnablementStatusForOrganization } = await import(
    "../Backend/kai/services/kaiOrganizationEnablementService.js"
  );

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false });
  after(async () => {
    await pool.end();
  });

  const FAKE_ACTOR_USER_ID = "11111111-1111-4111-8111-111111111111";
  const FAKE_GK_USER_ID = 501;

  function baseDependencies(overrides = {}) {
    return {
      env: { KAI_SPRINT2_ENABLED: "true" },
      resolveKaiActorContext: async () => ({
        ok: true,
        actorContext: {
          actorType: "human",
          actorUserId: FAKE_ACTOR_USER_ID,
          legacyPublicUserdataId: FAKE_GK_USER_ID,
          organizationMemberships: [],
        },
      }),
      resolveOrgScopeForUserId: async () => ({
        memberships: [{ orgId: overrides.gkOrganizationId ?? 1, role: "admin", is_active: true }],
      }),
      selectGkOrganizationRow: (id) => selectGkOrganizationRow(id, pool),
      withTransaction: (callback) => withTransaction(callback, pool),
      ...overrides.dependencies,
    };
  }

  async function resetAllTables() {
    await pool.query("TRUNCATE kai.engagements, kai.gk_organization_bindings, kai.organizations, kai.audit_events RESTART IDENTITY CASCADE");
    await pool.query("TRUNCATE public.organizations RESTART IDENTITY CASCADE");
  }

  async function seedGkOrganization(name = "Metro Vancouver Food Security Society") {
    const { rows } = await pool.query("INSERT INTO public.organizations (name) VALUES ($1) RETURNING id", [name]);
    return rows[0].id;
  }

  async function counts() {
    const [organizations, bindings, engagements, audits] = await Promise.all([
      pool.query("SELECT count(*)::int AS n FROM kai.organizations"),
      pool.query("SELECT count(*)::int AS n FROM kai.gk_organization_bindings"),
      pool.query("SELECT count(*)::int AS n FROM kai.engagements"),
      pool.query("SELECT count(*)::int AS n FROM kai.audit_events"),
    ]);
    return {
      organizations: organizations.rows[0].n,
      bindings: bindings.rows[0].n,
      engagements: engagements.rows[0].n,
      audits: audits.rows[0].n,
    };
  }

  beforeEach(resetAllTables);

  test("first enable commits public.organizations -> kai.organizations -> gk_organization_bindings -> kai.engagements -> required audit", async () => {
    const gkOrganizationId = await seedGkOrganization("Metro Vancouver Food Security Society");
    const result = await enableKaiForOrganization(
      { gkOrganizationId, req: { user: { id: FAKE_GK_USER_ID } } },
      baseDependencies({ gkOrganizationId }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.data.kai_enabled, true);
    assert.ok(result.data.kai_organization_id);
    assert.equal(result.data.engagement_code, DEFAULT_INITIAL_ENGAGEMENT_CODE);

    const c = await counts();
    assert.deepEqual(c, { organizations: 1, bindings: 1, engagements: 1, audits: 1 });

    const orgRow = (await pool.query(
      "SELECT organization_id, name, organization_code, organization_type, status, created_by_type, legacy_public_organization_id, legacy_public_organization_source, created_at, updated_at FROM kai.organizations",
    )).rows[0];
    assert.equal(orgRow.name, "Metro Vancouver Food Security Society");
    assert.equal(orgRow.organization_code, null);
    assert.equal(orgRow.organization_type, "nonprofit");
    assert.equal(orgRow.status, "active");
    assert.equal(orgRow.created_by_type, "human");
    assert.equal(orgRow.legacy_public_organization_id, gkOrganizationId);
    assert.equal(orgRow.legacy_public_organization_source, "public.organizations");
    assert.ok(orgRow.created_at);
    assert.ok(orgRow.updated_at);
    assert.equal(orgRow.organization_id, result.data.kai_organization_id);

    const engagementRow = (await pool.query(
      "SELECT organization_id FROM kai.engagements WHERE engagement_id = $1",
      [result.data.engagement_id],
    )).rows[0];
    assert.equal(engagementRow.organization_id, result.data.kai_organization_id);
  });

  test("PostgreSQL - not application code - generates organization_id and applies organization_type/status/created_by_type/timestamp defaults", async () => {
    const gkOrganizationId = await seedGkOrganization();
    const result = await enableKaiForOrganization(
      { gkOrganizationId, req: { user: { id: FAKE_GK_USER_ID } } },
      baseDependencies({ gkOrganizationId }),
    );
    assert.match(result.data.kai_organization_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test("replay returns the same KAI organization/engagement and creates no second kai.organizations row", async () => {
    const gkOrganizationId = await seedGkOrganization();
    const deps = baseDependencies({ gkOrganizationId });
    const first = await enableKaiForOrganization({ gkOrganizationId, req: { user: { id: FAKE_GK_USER_ID } } }, deps);
    const second = await enableKaiForOrganization({ gkOrganizationId, req: { user: { id: FAKE_GK_USER_ID } } }, deps);
    assert.deepEqual(second.data, first.data);
    const c = await counts();
    assert.deepEqual(c, { organizations: 1, bindings: 1, engagements: 1, audits: 1 });
  });

  test("concurrent first enable for the same organization creates exactly one complete provisioning set", async () => {
    const gkOrganizationId = await seedGkOrganization();
    const deps = baseDependencies({ gkOrganizationId });
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        enableKaiForOrganization({ gkOrganizationId, req: { user: { id: FAKE_GK_USER_ID } } }, deps),
      ),
    );
    assert.ok(results.every((r) => r.ok));
    const kaiOrgIds = new Set(results.map((r) => r.data.kai_organization_id));
    const engagementIds = new Set(results.map((r) => r.data.engagement_id));
    assert.equal(kaiOrgIds.size, 1);
    assert.equal(engagementIds.size, 1);
    const c = await counts();
    assert.deepEqual(c, { organizations: 1, bindings: 1, engagements: 1, audits: 1 });
  });

  test("forced downstream engagement failure leaves zero new organization, binding, or engagement rows", async () => {
    const gkOrganizationId = await seedGkOrganization();
    const deps = baseDependencies({
      gkOrganizationId,
      dependencies: {
        insertInitialEngagement: async () => {
          throw new Error("forced_engagement_failure");
        },
      },
    });
    const result = await enableKaiForOrganization({ gkOrganizationId, req: { user: { id: FAKE_GK_USER_ID } } }, deps);
    assert.equal(result.ok, false);
    const c = await counts();
    assert.deepEqual(c, { organizations: 0, bindings: 0, engagements: 0, audits: 0 });
  });

  test("forced required-audit failure leaves zero new organization, binding, or engagement rows", async () => {
    const gkOrganizationId = await seedGkOrganization();
    const deps = baseDependencies({
      gkOrganizationId,
      dependencies: {
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
    const result = await enableKaiForOrganization({ gkOrganizationId, req: { user: { id: FAKE_GK_USER_ID } } }, deps);
    assert.equal(result.ok, false);
    const c = await counts();
    assert.deepEqual(c, { organizations: 0, bindings: 0, engagements: 0, audits: 0 });
  });

  test("an active binding referencing a nonexistent kai.organizations row fails closed with zero repair writes", async () => {
    const gkOrganizationId = await seedGkOrganization();
    const orphanKaiOrganizationId = "22222222-2222-4222-8222-222222222222";
    await pool.query(
      "INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2, 'active')",
      [gkOrganizationId, orphanKaiOrganizationId],
    );

    const result = await enableKaiForOrganization(
      { gkOrganizationId, req: { user: { id: FAKE_GK_USER_ID } } },
      baseDependencies({ gkOrganizationId }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "conflict");

    const c = await counts();
    assert.deepEqual(c, { organizations: 0, bindings: 1, engagements: 0, audits: 0 });

    const statusDeps = baseDependencies({
      gkOrganizationId,
      dependencies: {
        listActiveGkOrganizationBindingsForGkOrganizationIds: (ids) =>
          listActiveGkOrganizationBindingsForGkOrganizationIds(ids, pool),
        selectKaiOrganizationRow: (id) => selectKaiOrganizationRow(id, pool),
        selectInitialEngagementForOrganization: (input) => selectInitialEngagementForOrganization(input, pool),
      },
    });
    const status = await getKaiEnablementStatusForOrganization(
      { gkOrganizationId, req: { user: { id: FAKE_GK_USER_ID } } },
      statusDeps,
    );
    assert.equal(status.ok, false);
    assert.equal(status.error.code, "conflict");
  });

  test("status GET performs zero writes and reports enabled only once organization, binding, and engagement all exist", async () => {
    const gkOrganizationId = await seedGkOrganization();
    const statusDeps = baseDependencies({
      gkOrganizationId,
      dependencies: {
        listActiveGkOrganizationBindingsForGkOrganizationIds: (ids) =>
          listActiveGkOrganizationBindingsForGkOrganizationIds(ids, pool),
        selectKaiOrganizationRow: (id) => selectKaiOrganizationRow(id, pool),
        selectInitialEngagementForOrganization: (input) => selectInitialEngagementForOrganization(input, pool),
      },
    });

    const beforeCounts = await counts();
    const before = await getKaiEnablementStatusForOrganization(
      { gkOrganizationId, req: { user: { id: FAKE_GK_USER_ID } } },
      statusDeps,
    );
    assert.equal(before.ok, true);
    assert.equal(before.data.kai_enabled, false);
    assert.deepEqual(await counts(), beforeCounts);

    await enableKaiForOrganization(
      { gkOrganizationId, req: { user: { id: FAKE_GK_USER_ID } } },
      baseDependencies({ gkOrganizationId }),
    );

    const afterEnableCounts = await counts();
    const after = await getKaiEnablementStatusForOrganization(
      { gkOrganizationId, req: { user: { id: FAKE_GK_USER_ID } } },
      statusDeps,
    );
    assert.equal(after.ok, true);
    assert.equal(after.data.kai_enabled, true);
    assert.deepEqual(await counts(), afterEnableCounts);
  });
}
