# KAI P1 Downstream Recovery State — Patch Notes

Package: KAI processing latency fix, Package 3 of 3 (durable recovery, bounded failures, one-minute scheduled fallback).

## Schema (additive)

`migrations/kai_sprint2_p1_downstream_recovery_state.sql` adds one table, `kai.intake_p1_downstream_attempts`, and one index. No existing table, column, constraint, status vocabulary, or audit operation changes.

| Column | Why it exists |
| --- | --- |
| `organization_id`, `intake_file_id` | Tenant and file identity; every read and write is scoped by them. |
| `file_profile_id`, `parser_name`, `parser_version`, `checksum` | The exact committed P1-03 profile the state governs, bound by a composite FK to `kai.intake_file_profiles`. State for one profile or checksum can never suppress another file version or profile. |
| `stage` | `p1_04_data_dictionary` or `p1_05_sensitivity_profile`; each stage has its own budget. |
| `recovery_state` | `in_progress`, `retry_scheduled`, `succeeded`, `exhausted`, `operator_attention`. |
| `attempt_count` | Automatic attempts reserved so far (0–3). Incremented before the stage runs. |
| `claim_token`, `claim_expires_at` | PostgreSQL-owned claim and its 120-second lease. The token fences acknowledgment, so a worker whose claim was replaced cannot overwrite newer state. |
| `last_attempt_at`, `next_eligible_at` | Cooldown bookkeeping (1 minute before attempt 2, 5 minutes before attempt 3). |
| `last_error_code` | Safe lower-case token only (CHECK `^[a-z0-9_]{1,64}$`); no message, stack, path, or content. |

Primary key `(organization_id, file_profile_id, stage)`. A state/fact CHECK ties each state to its required facts (for example, `exhausted` requires `attempt_count = 3`).

## Behaviour

- **Downstream claims.** `Backend/kai/parsing/postgresP1DownstreamRecoveryRepository.js`. A claim runs in one transaction: it re-checks file eligibility under `FOR SHARE`, locks the attempt row, reconciles any committed P1-04/P1-05 output (recorded as `succeeded` without another attempt), then reserves and counts the attempt. Acknowledgment is fenced by the claim token. Every state change commits together with its required metadata-only audit.
- **Retry policy.** Only `system_error` (the repositories' infrastructure class: the stage transaction rolled back, and the stage is idempotent) is retried, up to 3 total attempts. Every other known code, any unrecognized code, a malformed result, or a thrown stage goes to `operator_attention`. The completed P1-03 profile is never re-run or marked failed.
- **Sweep.** `listActionableKaiP1WorkCandidates` keeps oldest-first ordering and `LIMIT 25`, and now takes a clock. It excludes a file whose current-checksum stage is live-claimed, cooling down, exhausted, or awaiting an operator, so persistently failing files leave the window between and after their bounded attempts.
- **Orphaned P1-03 runs.** A `running` run older than its 15-minute lease is recovered by `recoverExpiredRunningParserRun`. The lost attempt counts in `retry_count`. Below the cap the run is re-queued and claimed; at the cap (3) it becomes an ordinary `failed` run (`parser_run_lease_expired`, manual review), never retried automatically. The claim's `started_at` is the fencing token: completion and safe failure only commit while it is unchanged, so the original worker cannot commit after a takeover.
- **Eligibility guard.** `Backend/kai/parsing/p1StageTransaction.js` wraps every default P1-03/P1-04/P1-05 repository transaction with a `FOR SHARE` re-check of the confirmed/passed/verified-checksum state. A file blocked after its initial check can commit no further P1 output.
- **Cron.** `Backend/kai/parsing/p1WorkerCron.js` runs every minute (`* * * * *`, `America/Vancouver`), only with both worker gates. A fire that overlaps a running tick is skipped, not queued, and logs carry outcome counts only.
- **Operator read.** `Backend/kai/services/kaiP1RecoveryStatusService.js` (`getKaiP1RecoveryStatus`) is a read-only, mapped-human GK `read_intake` view of downstream state and parser runs. It is not mounted on any route.

## Release order (not executed)

1. Apply `migrations/kai_sprint2_p1_downstream_recovery_state.sql` and run the catalog verifier and read-only failure checks against the target, under separate authorization.
2. Only then deploy the application version containing this package. Its sweep query and P1 runtime read and write the new table and fail closed without it.

Rollback reverses this order: roll back the application first, then (only if separately authorized) apply `migrations/kai_sprint2_p1_downstream_recovery_state.rollback.sql`.
