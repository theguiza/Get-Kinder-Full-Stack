# Package G Improvement Practices Foundation Runbook

Run locally with:

```sh
DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-package-g-improvement-practices-foundation
```

The runner creates a loopback-only ephemeral PostgreSQL instance (via
`initdb`/`pg_ctl`, no shared/production database, no credential discovery),
applies the full migration dependency chain through
`kai_sprint2_p2_04_claim_gap_followup.sql` (the prerequisite for
`kai.gap_log_items`) and then the Package G migration itself, runs the
read-only verifier, the smoke seed/verifier, the failure checks, and the
focused Node tests, then stops PostgreSQL and removes the temporary
database directory.

Rollback draft:

```sh
psql -v ON_ERROR_STOP=1 -f migrations/kai_sprint2_package_g_improvement_practices_foundation.rollback.sql
```

Do not apply this package to production or any shared database without
separate owner authorization. No production migration execution, database
mutation, deployment, or feature-flag change is performed by this runbook.
