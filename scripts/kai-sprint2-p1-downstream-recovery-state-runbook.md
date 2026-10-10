# KAI P1 Downstream Recovery State Runbook

Run:

```sh
npm run verify:kai-sprint2-p1-worker
```

The runner (`scripts/kai-sprint2-p1-worker-local-postgres.js`):

- creates a temporary data directory and starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- proves, for every database it creates, the synthetic database name, loopback address, port, `listen_addresses`, and PostgreSQL 16 before use;
- **migration verification pack** (database `kai_p1_worker_recovery_migration_synthetic`):
  1. applies the synthetic bootstrap schema, the existing Gate A, P1-02, P1-04, and P1-05 migrations (unmodified), the existing test-only column/audit extension, and the new forward migration;
  2. runs `scripts/kai-sprint2-p1-downstream-recovery-state-verifier.sql`, which checks the table, columns, PK, composite FK, CHECKs, and index, and that the existing parser status vocabulary, the parser retry cap, and the lifecycle-audit operation list are unchanged and no column was added to an existing table;
  3. runs `scripts/kai-sprint2-p1-downstream-recovery-state-failure-checks.sql` (read-only data invariants) on the empty table;
  4. applies `scripts/kai-sprint2-p1-downstream-recovery-state-smoke-seed.sql` and runs `scripts/kai-sprint2-p1-downstream-recovery-state-smoke-verifier.sql`, whose constraint probes each run in a rolled-back subtransaction;
  5. re-runs the failure checks on the seeded table;
  6. applies the rollback draft in this disposable database only, asserts that exactly the recovery table is gone and earlier-package rows are intact, then re-applies the forward migration twice (idempotent) and re-runs the verifier;
- runs `__tests__/kai-sprint2-p1-worker-actionable-candidate-discovery.integration.spec.js` and `__tests__/kai-sprint2-p1-worker-file-processing.integration.spec.js`, each in its own freshly migrated database. Crash proofs spawn `__tests__/support/kaiP1WorkerCrashChild.js`, which is killed with `SIGKILL`;
- stops PostgreSQL and removes the temporary directory.

The runner fails on any `FAIL` cell (`assertNoFail`) and on any verifier step that returns no `PASS` rows. The integration specs skip themselves unless the runner sets their own `KAI_P1_WORKER_*_DATABASE_URL`.

Never point the runner, the smoke seed, or the rollback at a shared, production, cloud, or real-client-data database. The verifier and failure-check SQL are read-only. The smoke seed and smoke verifier write synthetic rows. The rollback drops recovery state.

## Operating notes

- `getKaiP1RecoveryStatus` (service only, mapped-human GK `read_intake`) lists each file's downstream rows (`recovery_state`, `attempt_count`, `last_error_code`, `next_eligible_at`) and parser runs (`requires_manual_review`). `exhausted` and `operator_attention` rows, and a parser run failed with `parser_run_lease_expired`, need a human decision. No automatic path clears them.
- Cron logs: `[kai-p1-worker] candidates=N completed_through_p1_05=… deferred=… busy=… exhausted=… operator_attention=… not_eligible=… stopped=… rejected=… failed=…`, `[kai-p1-worker] tick skipped: previous tick still running`, `[kai-p1-worker] tick failed`. Dispatch logs: `[kai-p1-dispatch] outcome=… stage=… code=…`. No identifiers, storage locations, content, or raw errors.
- The one-minute cadence is a polling interval while the application scheduler runs, not a completion guarantee.
