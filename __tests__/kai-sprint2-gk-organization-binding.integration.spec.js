import test, { after } from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_GK_ORGANIZATION_TENANT_BINDING_DATABASE_URL;

function assertLoopbackDatabaseUrl(urlString) {
  const parsed = new URL(urlString);
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`gk_organization_tenant_binding integration suite refused a non-loopback KAI_GK_ORGANIZATION_TENANT_BINDING_DATABASE_URL host: ${host}`);
  }
}

test("gk_organization_tenant_binding PostgreSQL isolation: a non-loopback runner-owned URL is rejected before any connection is attempted", () => {
  assert.throws(() => assertLoopbackDatabaseUrl("postgresql://user@example.com:5432/db"), /refused a non-loopback/);
  assert.doesNotThrow(() => assertLoopbackDatabaseUrl("postgresql://user@127.0.0.1:60000/db"));
});

if (!RUNNER_OWNED_DATABASE_URL) {
  test("gk_organization_tenant_binding integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);
  await runIntegrationSuite();
}

async function runIntegrationSuite() {
  const { Pool } = await import("pg");
  const { upsertGkOrganizationBinding, listActiveGkOrganizationBindingsForGkOrganizationIds } = await import(
    "../Backend/kai/db/kaiOrganizationBindingQueries.js"
  );

  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false });
  after(async () => {
    await pool.end();
  });

  async function resetBindings() {
    await pool.query("TRUNCATE kai.gk_organization_bindings");
  }

  test("upsertGkOrganizationBinding creates a real row against the deployed schema", async () => {
    await resetBindings();
    const result = await upsertGkOrganizationBinding({ gkOrganizationId: 1, kaiOrganizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f" }, pool);
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.equal(result.binding.status, "active");
  });

  test("upsertGkOrganizationBinding is idempotent against the real schema", async () => {
    await resetBindings();
    await upsertGkOrganizationBinding({ gkOrganizationId: 1, kaiOrganizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f" }, pool);
    const second = await upsertGkOrganizationBinding({ gkOrganizationId: 1, kaiOrganizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f" }, pool);
    assert.equal(second.ok, true);
    assert.equal(second.created, false);
  });

  test("upsertGkOrganizationBinding fails closed on a real active-uniqueness conflict on the KAI side", async () => {
    await resetBindings();
    await upsertGkOrganizationBinding({ gkOrganizationId: 1, kaiOrganizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f" }, pool);
    const conflict = await upsertGkOrganizationBinding({ gkOrganizationId: 2, kaiOrganizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f" }, pool);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error_code, "conflicting_binding");
  });

  test("upsertGkOrganizationBinding rejects a nonexistent Get Kinder organization id via the real foreign key", async () => {
    await resetBindings();
    await assert.rejects(() =>
      upsertGkOrganizationBinding({ gkOrganizationId: 999999, kaiOrganizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f" }, pool),
    );
  });

  test("listActiveGkOrganizationBindingsForGkOrganizationIds reads only active rows from the real schema", async () => {
    await resetBindings();
    await upsertGkOrganizationBinding({ gkOrganizationId: 1, kaiOrganizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f" }, pool);
    await upsertGkOrganizationBinding({ gkOrganizationId: 2, kaiOrganizationId: "b5d17c5a-c55f-43af-9b21-fe63aafe733f", status: "inactive" }, pool);
    const active = await listActiveGkOrganizationBindingsForGkOrganizationIds([1, 2], pool);
    assert.deepEqual(active.map((row) => row.gk_organization_id), [1]);
  });
}
