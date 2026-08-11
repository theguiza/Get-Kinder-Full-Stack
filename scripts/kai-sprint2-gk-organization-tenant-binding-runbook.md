# KAI Get Kinder Organization <-> Tenant Binding Runbook

This package adds exactly one new relation, `kai.gk_organization_bindings`,
the sole explicit, durable link between an existing Get Kinder
`public.organizations.id` (integer) and a KAI tenant `organization_id`
(uuid). It changes no other migration, repository, service, route, or
authorization artifact beyond what commit `63fc73b` already introduced
(`Backend/kai/db/kaiOrganizationBindingQueries.js`,
`Backend/kai/auth/gkOrganizationBindingAuthority.js`, the
`kaiActorContext.js`/`kaiAuthorizationService.js` wiring, and the associated
tests) — this verification pack adds no application behavior change.

Run:

```sh
npm run verify:kai-sprint2-gk-organization-tenant-binding
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_gk_organization_tenant_binding_synthetic`;
- applies a minimal synthetic bootstrap (`public.userdata(id)` and
  `public.organizations`, mirroring only the columns this migration's
  foreign key depends on — not the full Get Kinder application schema),
  then the forward migration;
- runs the catalog verifier;
- runs the smoke seed, smoke verifier, and read-only failure checks;
- applies the rollback, proves `kai.gk_organization_bindings` is gone and
  `public.organizations` is untouched, then reapplies the forward migration
  and re-runs the catalog verifier;
- runs `__tests__/kai-sprint2-gk-organization-binding.integration.spec.js`
  against that runner-owned target only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback
address, port, and `listen_addresses`. It must not be pointed at a shared,
quarantined, cloud, production, or real-client-data database.

## Scope boundary

This package adds **no** production migration execution, **no** production
binding row, and **no** application/authorization behavior change beyond
commit `63fc73b`. It exists solely to close the gap between that commit's
forward/rollback migration and the repository's established governing
migration rhythm (verification SQL, smoke seed, smoke verification,
read-only failure checks, patch notes, runbook), following the Gate C-1
gcs-generation-binding package's pattern exactly.

## Schema

`kai.gk_organization_bindings`:

- `gk_organization_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `gk_organization_id integer NOT NULL REFERENCES public.organizations (id)`
- `kai_organization_id uuid NOT NULL`
- `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz NOT NULL DEFAULT now()`, touched automatically by
  `kai.touch_gk_organization_bindings_updated_at()` (`BEFORE UPDATE` trigger
  `trg_gk_organization_bindings_touch_updated_at`)

Cardinality is schema-enforced, not just application-checked:

- `ux_gk_organization_bindings_active_gk_org` — `UNIQUE (gk_organization_id)
  WHERE status = 'active'`: at most one active binding per Get Kinder
  organization.
- `ux_gk_organization_bindings_active_kai_org` — `UNIQUE (kai_organization_id)
  WHERE status = 'active'`: at most one active binding per KAI tenant.

Both indexes are partial (`WHERE status = 'active'`), so deactivating a
binding (rather than deleting it) genuinely frees both sides for a new
active binding elsewhere, while retaining lifecycle history. The smoke
verifier proves this explicitly (`deactivation_frees_kai_org_for_new_active_binding`).

## Repository

`Backend/kai/db/kaiOrganizationBindingQueries.js#upsertGkOrganizationBinding`
is the only controlled write path (no route or controller calls it — see
the Gate C-2/C-3 review conventions this repository already follows for "no
SQL in routes"). It is explicit, idempotent, and uniqueness-safe: an
existing row for the requested Get Kinder organization is never silently
overwritten to a different KAI tenant (`conflicting_binding`), and a
database-level unique-violation on the KAI-tenant side (a genuine race, or
an attempt to bind an already-actively-bound KAI tenant to a second
organization) is caught and returned as the same `conflicting_binding`
result rather than propagating a raw Postgres error.

## Rollback

`migrations/kai_sprint2_gk_organization_tenant_binding.rollback.sql` drops
the trigger, the function, and the table, in that order. It touches no other
relation. The runner proves this by counting `public.organizations` rows
before and after the round trip (unchanged) and confirming
`kai.gk_organization_bindings` is absent immediately after rollback.

## Remaining facts requiring production proof (not established here)

- the exact deployed `kai.users` column/default/constraint set (tracked
  separately, not part of this package — see the living ExecPlan's
  outstanding read-only verification script);
- whether `public.organizations.id = 1` is the correct Get Kinder
  organization for the synthetic canary (owner-confirmed context, not
  re-derived here);
- actual production execution of this migration and creation of the real
  binding row, both explicitly deferred to the owner's pgAdmin workflow.
