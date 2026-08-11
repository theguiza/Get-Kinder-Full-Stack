# KAI Get Kinder Organization <-> Tenant Binding Patch Notes — Verification Pack

## Owner decision on scope

The owner authorized completion of the migration verification pack for
`migrations/kai_sprint2_gk_organization_tenant_binding.sql` (introduced in
commit `63fc73b`) before any production migration is applied. That commit
established the forward migration, the rollback, and a static (DB-less)
schema-contract test, but not the remaining governing-migration-rhythm
artifacts (deterministic verification SQL, synthetic smoke seed, smoke
verification, read-only failure checks, patch notes, runbook). This package
adds exactly those missing artifacts, following the Gate C-1
gcs-generation-binding package's established pattern. It changes no binding
architecture, no authorization behavior, and no application code.

## Added

- `scripts/kai-sprint2-gk-organization-tenant-binding-bootstrap-synthetic-schema.sql`
  — minimal synthetic `public.userdata(id)` / `public.organizations` mirror
  (only the columns this migration's foreign key depends on), for the
  ephemeral runner.
- `scripts/kai-sprint2-gk-organization-tenant-binding-verifier.sql` —
  catalog verification: table, column types/nullability, the foreign key to
  `public.organizations(id)`, the status `CHECK` and its default, both
  partial unique indexes, the `updated_at` trigger, and that exactly one
  relation exists in the `kai` schema.
- `scripts/kai-sprint2-gk-organization-tenant-binding-smoke-seed.sql` —
  seeds ten synthetic organizations plus one pre-existing active binding
  (org 1) and one pre-existing inactive binding (org 2) as starting state.
- `scripts/kai-sprint2-gk-organization-tenant-binding-smoke-verifier.sql` —
  proves: the seeded active binding reads back correctly; an inactive
  existing row does not block a new active binding for the same
  organization; a second simultaneous active binding for the same Get
  Kinder organization is rejected; a conflicting active binding to an
  already-bound KAI tenant is rejected; deactivating a binding frees both
  sides for a new active binding; `updated_at` advances automatically on
  `UPDATE` (as three separate top-level statements, since `now()` is fixed
  for the duration of one transaction/PL/pgSQL block and would otherwise
  falsely appear frozen); the foreign key rejects a nonexistent Get Kinder
  organization id; and the status `CHECK` rejects any value outside
  `active`/`inactive`.
- `scripts/kai-sprint2-gk-organization-tenant-binding-failure-checks.sql` —
  purely read-only catalog checks: no relation beyond the binding table
  exists in the `kai` schema, no view exposes the binding columns, the only
  foreign key targets `public.organizations(id)`, the status `CHECK` is an
  exact two-value vocabulary, both uniqueness indexes are partial
  (`WHERE status = 'active'`), and the foreign key has no `ON DELETE
  CASCADE` (deleting an organization must never silently delete binding
  history).
- `scripts/kai-sprint2-gk-organization-tenant-binding-local-postgres.js` —
  ephemeral loopback PostgreSQL runner
  (`npm run verify:kai-sprint2-gk-organization-tenant-binding`), following
  the Gate C-1 runner's exact mechanism (loopback-only proof before any
  query, bootstrap -> forward migration -> verifier -> smoke -> rollback
  round trip -> reapply -> re-verify -> integration tests -> teardown).
- `scripts/kai-sprint2-gk-organization-tenant-binding-runbook.md`,
  `scripts/kai-sprint2-gk-organization-tenant-binding-patch-notes.md` — this
  pair, following the established per-package documentation convention.
- `__tests__/kai-sprint2-gk-organization-binding.integration.spec.js` —
  skip-if-absent (`KAI_GK_ORGANIZATION_TENANT_BINDING_DATABASE_URL`)
  PostgreSQL-backed integration coverage for
  `upsertGkOrganizationBinding`/`listActiveGkOrganizationBindingsForGkOrganizationIds`
  against the real deployed schema shape (create, idempotency, KAI-side
  conflict, foreign-key rejection, active-only read filtering).

## Changed (additive only)

- `package.json` — added
  `verify:kai-sprint2-gk-organization-tenant-binding`. No existing script is
  changed.

## Not changed

`migrations/kai_sprint2_gk_organization_tenant_binding.sql` /
`.rollback.sql`, `Backend/kai/db/kaiOrganizationBindingQueries.js`,
`Backend/kai/auth/gkOrganizationBindingAuthority.js`,
`Backend/kai/auth/kaiActorContext.js`,
`Backend/kai/auth/kaiAuthorizationService.js`, and every test file added or
modified in commit `63fc73b` are unedited by this package. No production
database was accessed, migrated, or mutated. No binding row was created
anywhere. No feature flag, credential, or Render/cloud configuration was
touched.

## Behavior summary

**All eight checklist items are now present** for
`kai_sprint2_gk_organization_tenant_binding`: (1) forward migration, (2)
deterministic verification SQL, (3) rollback draft, (4) synthetic smoke
seed, (5) smoke verification, (6) read-only failure checks, (7) patch notes
(this file), (8) runbook.

**Verified for real, not just statically.** Unlike commit `63fc73b`'s
schema-contract test (regex assertions against the migration's SQL text,
with no live database), this package's runner genuinely executes the
migration against a real, ephemeral, loopback-only PostgreSQL instance and
proves: the table/columns/constraints/indexes/trigger exist exactly as
declared; the database itself (not just application code) rejects a second
active binding on either side; an inactive row does not block a new active
one; deactivating a binding frees it; the foreign key and status `CHECK` are
enforced by Postgres; rollback removes exactly the new relation and nothing
else; and the repository functions
(`upsertGkOrganizationBinding`/`listActiveGkOrganizationBindingsForGkOrganizationIds`)
behave identically against the real schema as they do against the fake-pool
unit tests already in commit `63fc73b`.

**Fails closed** on: a non-loopback target (the runner refuses to connect
before running any query); a second active binding on either the Get Kinder
or KAI side (real Postgres unique-violation, translated to
`conflicting_binding` by the repository, proven against both the fake pool
and the real schema); a binding for a nonexistent Get Kinder organization id
(real foreign-key violation); and any status value outside
`active`/`inactive` (real `CHECK` violation).
