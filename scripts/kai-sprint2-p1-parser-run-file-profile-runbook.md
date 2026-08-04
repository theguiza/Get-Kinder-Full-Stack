# KAI P1-02 Parser-Run and File-Profile Persistence Runbook

This package verifies only the persistent P1 parser-run and file-profile substrate (`kai.intake_parser_runs`, `kai.intake_file_profiles`) in an isolated local PostgreSQL 16 instance created by the runner.

Run:

```sh
DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p1-parser-run-file-profile
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_p1_parser_run_file_profile_synthetic`;
- applies the synthetic bootstrap schema, the existing frozen Gate A P0 upload-lifecycle and policy-decision-replay migrations (prerequisites, unmodified), the new P1-02 migration, the existing Gate A smoke seed, and the new P1-02 smoke seed;
- runs the P1-02 catalog verifier, read-only failure checks, and smoke verifier, asserting no `FAIL`;
- applies the P1-02 rollback draft, then the existing policy-decision-replay and upload-lifecycle rollbacks;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback address, port, `listen_addresses`, and PostgreSQL 16 version. It must not be pointed at a shared, quarantined, cloud, production, or real-client-data database.

## Scope

This package is pure database substrate: one forward migration, one rollback draft, and SQL-only verification. No repository, service, or route code was added or modified, so `KAI_SPRINT2_ENABLED` gating is unaffected — there is no new application code path for it to gate. The accepted identity for both tables is `intake_file_id + parser_name + parser_version + checksum`, tenant-scoped by `organization_id`, using `intake_files.checksum` (the declared checksum, present from reservation onward).

This package does not implement a repository adapter, application selection of any adapter, routes, listeners, production composition, cloud/storage integration, Gate B/C/D work, data dictionaries, quality records, sensitivity records, review workflow, source candidates, promotion decisions, `source`, or `source_version`.
