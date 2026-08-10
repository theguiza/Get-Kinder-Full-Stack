# KAI P1-03 Parser/Profile Worker Orchestration Runbook

This package verifies only the dormant P1-03 parser/profile worker orchestration and its PostgreSQL parser-run adapter against the existing, unmodified P1-02 substrate (`kai.intake_parser_runs`, `kai.intake_file_profiles`) in an isolated local PostgreSQL 16 instance created by the runner. It adds no migration and changes no schema.

Run:

```sh
DATABASE_URL=postgres://127.0.0.1:9/kai_sentinel npm run verify:kai-sprint2-p1-03-parser-profile-worker
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_p1_03_parser_profile_worker_synthetic`;
- applies the existing synthetic bootstrap schema and the existing frozen Gate A P0 upload-lifecycle, Gate A P0 policy-decision-replay, and P1-02 parser-run/file-profile migrations, all unmodified;
- runs `__tests__/kai-sprint2-p1-03-parser-profile-worker.integration.spec.js` against that runner-owned target only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback address, port, `listen_addresses`, and PostgreSQL 16 version. It must not be pointed at a shared, quarantined, cloud, production, or real-client-data database. The integration spec skips itself unless `KAI_P1_03_PARSER_WORKER_DATABASE_URL` is set by that runner.

The non-database boundary spec `__tests__/kai-sprint2-p1-03-parser-profile-worker-boundary.spec.js` runs in the normal suites and needs no database.

## Scope

`Backend/kai/parsing/postgresParserRunRepository.js` is the only authorized location for this package's SQL and row locking. It uses the existing `withTransaction(callback)` helper, the existing P1-02 unique constraints (`intake_parser_runs_p1_identity_unique`), `FOR UPDATE`/`FOR UPDATE ... SKIP LOCKED`, the existing `encode(digest(profile::jsonb::text, 'sha256'), 'hex')` canonical-hash convention, and the already-installed `parser_run_recorded` and `file_profile_persisted` metadata-only audit operations with their exact required metadata keys. No new audit operation, metadata key, contract string, or validator key is introduced.

`Backend/kai/parsing/parserProfileWorkerOrchestration.js` contains no SQL, imports no database pool, and requires both the parser-run repository and the exact object-version byte source to be injected. It invokes only the existing deterministic profilers: the installed local profiling kernel for CSV, XLSX, Markdown, and TXT, and the installed governed PDF profiling worker boundary for machine-readable PDF. Exact object-version bytes stay transient and are never persisted, returned, logged, or audited.

The identity is the accepted P1-02 identity `intake_file_id + parser_name + parser_version + checksum`, tenant-scoped by `organization_id`. A new identity creates exactly one queued run; identical queued or running work replays the existing run; identical completed work replays the stored metadata-only profile and its canonical hash without re-profiling; concurrent queue requests for one identity resolve to exactly one authoritative run through the existing unique constraint. Successful completion and safe failure are each one transaction that includes the required metadata-only audit, and any audit failure rolls back every domain write in that transaction. Retry is explicit and internal only: it is allowed while `retry_count < 3`, never resets or decrements `retry_count`, refuses to claim, read bytes, or invoke a profiler at the cap and reports the derived `requires_manual_review` value instead, and never claims or retries a cancelled run. When `KAI_SPRINT2_ENABLED` is disabled every operation returns the canonical `feature_disabled` result with zero claims, writes, byte reads, profiler calls, and audit writes.

This package does not add a schema change, route, listener, scheduler, timer, polling loop, startup hook, public barrel export, production composition, application repository selection, feature-flag default, or cloud configuration. Sensitivity, data-dictionary, quality, review-workflow, source, `source_version`, evidence, claim, and generation records are out of scope and are not created.
