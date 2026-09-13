# Engagements Tenant-Safe-Identity Prerequisite Runbook

This package is test/local-only. It never runs against a real, shared, or production database - `kai.engagements` is externally owned, and production already carries the required `UNIQUE (engagement_id, organization_id)` prerequisite (USER_CONFIRMED) under its own name. See the patch notes for the ownership-model rationale.

Run locally with:

```sh
DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel node scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-local-postgres.js
```

The runner creates a loopback-only ephemeral PostgreSQL instance and proves both rollback-ownership directions:

- CASE A - no pre-existing constraint: verifier FAILs, converge creates the constraint, verifier PASSes, converge re-applied is an idempotent no-op, smoke seed/verifier/failure-checks pass, rollback removes exactly the constraint this package created, verifier FAILs again.
- CASE B - a compatible constraint already exists under a different name (the real-production shape): verifier already PASSes, converge no-ops (no duplicate constraint is added and the pre-existing one is untouched), rollback leaves the pre-existing constraint fully intact, verifier still PASSes.

## Consuming this package from another local-postgres runner

Call the converge script immediately after building the synthetic `kai.engagements` mirror (via `scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql` or an equivalent synthetic bootstrap), and before applying `migrations/kai_sprint2_br_02_board_reporting_candidate_foundation.sql`:

```js
psqlFile("scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql");
psqlFile("scripts/kai-sprint2-engagements-tenant-safe-identity-prerequisite-converge.sql");
// ... continue the migration chain, e.g. Gate A, then BR-02 ...
```

Never add `kai-sprint2-engagements-tenant-safe-identity-prerequisite-converge.sql` (or its rollback) to `migrations/`, and never run either against a real/shared database.

Do not apply this package to production or any shared database. It has no production role: production's prerequisite is already established externally.
