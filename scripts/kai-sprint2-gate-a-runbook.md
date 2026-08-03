# KAI Gate A P0 Upload Lifecycle Runbook

This package verifies only the persistent P0 upload-lifecycle substrate in an isolated local PostgreSQL 16 instance created by the runner.

Run:

```sh
DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-gate-a-p0
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_gate_a_p0_upload_lifecycle_synthetic`;
- applies the synthetic bootstrap schema, Gate A migration, smoke seed, catalog verifier, read-only failure checks, and smoke verifier;
- runs two-session concurrency checks through `pg`;
- applies the rollback draft;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback address, port, `listen_addresses`, and PostgreSQL 16 version. It must not be pointed at a shared, quarantined, cloud, production, or real-client-data database.

This package does not implement parser runs, profiles, dictionaries, quality or sensitivity records, review workflow, source candidates, promotion decisions, `source`, or `source_version`.
