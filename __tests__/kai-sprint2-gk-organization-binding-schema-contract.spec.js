import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import test from "node:test";

const migrationSource = readFileSync("migrations/kai_sprint2_gk_organization_tenant_binding.sql", "utf8");
const rollbackSource = readFileSync("migrations/kai_sprint2_gk_organization_tenant_binding.rollback.sql", "utf8");
const bindingQueriesSource = readFileSync("Backend/kai/db/kaiOrganizationBindingQueries.js", "utf8");

test("gk_organization_bindings migration declares the minimum durable binding contract", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.gk_organization_bindings/);
  assert.match(migrationSource, /gk_organization_id integer NOT NULL REFERENCES public\.organizations \(id\)/);
  assert.match(migrationSource, /kai_organization_id uuid NOT NULL/);
  assert.match(migrationSource, /status text NOT NULL DEFAULT 'active'/);
  assert.match(migrationSource, /CHECK \(status IN \('active', 'inactive'\)\)/);
});

test("gk_organization_bindings migration enforces active-mapping cardinality at the database level, not just in application code", () => {
  // At most one ACTIVE binding per Get Kinder organization.
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS ux_gk_organization_bindings_active_gk_org\s+ON kai\.gk_organization_bindings \(gk_organization_id\)\s+WHERE status = 'active'/,
  );
  // At most one ACTIVE binding per KAI tenant.
  assert.match(
    migrationSource,
    /CREATE UNIQUE INDEX IF NOT EXISTS ux_gk_organization_bindings_active_kai_org\s+ON kai\.gk_organization_bindings \(kai_organization_id\)\s+WHERE status = 'active'/,
  );
});

test("gk_organization_bindings migration fabricates no equality: it never derives organization_id from name, email, or any other inferred attribute", () => {
  assert.doesNotMatch(migrationSource, /\bname\b/i);
  assert.doesNotMatch(migrationSource, /\bemail\b/i);
  assert.doesNotMatch(migrationSource, /\borganizations\.id\s*=\s*organizations\.name\b/i);
  // The only relation this migration creates is the binding table itself.
  assert.doesNotMatch(migrationSource, /CREATE TABLE IF NOT EXISTS kai\.(?!gk_organization_bindings\b)/);
});

test("gk_organization_bindings migration guards on public.organizations existing and wraps in a transaction", () => {
  assert.match(migrationSource, /^BEGIN;/);
  assert.match(migrationSource, /to_regclass\('public\.organizations'\) IS NULL/);
  assert.match(migrationSource, /RAISE EXCEPTION/);
  assert.match(migrationSource, /COMMIT;\s*$/);
});

test("gk_organization_bindings rollback removes exactly what the forward migration created", () => {
  assert.match(rollbackSource, /DROP TABLE IF EXISTS kai\.gk_organization_bindings/);
  assert.match(rollbackSource, /DROP TRIGGER IF EXISTS trg_gk_organization_bindings_touch_updated_at ON kai\.gk_organization_bindings/);
  assert.match(rollbackSource, /DROP FUNCTION IF EXISTS kai\.touch_gk_organization_bindings_updated_at\(\)/);
});

test("the binding repository is the only controlled write path and performs no ad hoc equality/inference", () => {
  assert.match(bindingQueriesSource, /export async function upsertGkOrganizationBinding/);
  assert.doesNotMatch(bindingQueriesSource, /organizations\.name/i);
  assert.doesNotMatch(bindingQueriesSource, /\bLIKE\b/i);
});

test("no KAI Sprint 2 route file contains direct SQL for the organization binding (or any other) table", () => {
  const routeFiles = readdirSync("Backend/kai/routes").filter((name) => name.endsWith(".js"));
  assert.ok(routeFiles.length > 0);
  for (const fileName of routeFiles) {
    const source = readFileSync(`Backend/kai/routes/${fileName}`, "utf8");
    assert.doesNotMatch(
      source,
      /\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i,
      `${fileName} must not contain direct SQL`,
    );
    assert.doesNotMatch(source, /gk_organization_bindings/, `${fileName} must not reference the binding table directly`);
  }
});
