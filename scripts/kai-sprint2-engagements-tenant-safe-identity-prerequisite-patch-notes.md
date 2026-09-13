# Engagements Tenant-Safe-Identity Prerequisite Patch Notes

BR-02's `kai.board_reporting_candidates` declares a composite `FOREIGN KEY (engagement_id, organization_id) REFERENCES kai.engagements (engagement_id, organization_id)`. PostgreSQL requires a UNIQUE (or PK) constraint over exactly that referenced column set, and BR-02's own migration already fails closed unless one is present (`migrations/kai_sprint2_br_02_board_reporting_candidate_foundation.sql`, precondition block). Production already carries this constraint (USER_CONFIRMED). `kai.engagements` is externally owned - it is not created by any repository migration.

## Ownership decision

Repository precedent (`migrations/kai_sprint2_gk_organization_tenant_binding.sql`, which never issues `ALTER TABLE` against the externally-owned `public.organizations`; `migrations/kai_sprint2_p3_19_export_manifest_foundation.sql`, whose comment states the externally-owned `kai.audit_events` needs "no schema change ... made here"; and the `kai-sprint2-*-bootstrap-synthetic-schema.sql` convention for building externally-owned tables only inside local/ephemeral test databases) establishes that a KAI package never owns a schema mutation against an externally-established table, and that the mechanism for such external preconditions is a fail-closed, semantic existence check - already present in BR-02 itself.

Following that precedent, this package is **not** a `migrations/*.sql` forward migration. It is a test/local-only convergence package under `scripts/`, consumed only by this repository's own local-postgres runners so their synthetic `kai.engagements` mirror can satisfy the same prerequisite BR-02 already requires, without ever asserting migration ownership over the real, externally-owned production table.

## What this package adds

- `kai-sprint2-engagements-tenant-safe-identity-prerequisite-converge.sql` - test/local-only forward convergence: adds `UNIQUE (engagement_id, organization_id)` to a runner-owned synthetic `kai.engagements` only if no constraint with that exact column set already exists (detected semantically, never by name). No-ops wherever the prerequisite is already satisfied, under any name.
- `kai-sprint2-engagements-tenant-safe-identity-prerequisite-rollback.sql` - drops only the constraint this package's own converge script would have created, under its own fixed name. Never touches a pre-existing, differently-named constraint.
- `kai-sprint2-engagements-tenant-safe-identity-prerequisite-verifier.sql` - read-only structural verifier, safe against any database including real production: table exists, `engagement_id`/`organization_id` columns exist, and a UNIQUE constraint exists over exactly those two columns.
- `kai-sprint2-engagements-tenant-safe-identity-prerequisite-smoke-seed.sql` / `-smoke-verifier.sql` - synthetic data proving the constraint is actually usable by a composite FK (the real BR-02 consumption shape), not merely present in the catalog.
- `kai-sprint2-engagements-tenant-safe-identity-prerequisite-failure-checks.sql` - read-only proof that a duplicate `(engagement_id, organization_id)` pair is rejected.
- `kai-sprint2-engagements-tenant-safe-identity-prerequisite-local-postgres.js` - proves both rollback-ownership directions against a real ephemeral local PostgreSQL: (a) no pre-existing constraint - converge creates it, rollback removes exactly what it created; (b) a compatible constraint already exists under a different name - converge no-ops, rollback leaves the pre-existing constraint fully intact.

## Consumers updated

- `scripts/kai-sprint2-board-reporting-candidate-export-manifest-foundation-local-postgres.js` now calls this package's converge script instead of an inline `ALTER TABLE kai.engagements ADD CONSTRAINT ...` of its own.

## Out of scope

- No change to any real/shared/production database.
- No change to BR-02, BR-03A, BR-03B, BR-04, Board final eligibility, Board manifest creation, or Board final delivery.
- No change to `kai.engagements`'s externally-owned schema outside a runner-owned synthetic database.
