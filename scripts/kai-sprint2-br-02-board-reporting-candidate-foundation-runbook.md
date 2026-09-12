# BR-02 Board Reporting Candidate Foundation Runbook

Run locally with:

```sh
DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-br-02-board-reporting-candidate-foundation
```

The runner creates a loopback-only ephemeral PostgreSQL instance, installs the exact dependency chain, applies the BR-02 migration, runs the read-only verifier, smoke seed/verifier, failure checks, and focused Node tests, then removes the temporary database directory.

Rollback draft:

```sh
psql -v ON_ERROR_STOP=1 -f migrations/kai_sprint2_br_02_board_reporting_candidate_foundation.rollback.sql
```

Do not apply this package to production or any shared database without separate owner authorization.
