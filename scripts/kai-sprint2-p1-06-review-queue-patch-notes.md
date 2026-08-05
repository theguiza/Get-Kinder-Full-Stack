# KAI P1-06 Patch Notes — Review Queue Foundation and Sensitivity-Review Item Creation

## Owner decision on the canonical table

Research before implementation found that `kai.review_queue_items` is not a new
concept: `Backend/kai/db/kaiIntakeQueries.js` (`insertReviewQueueItem`,
`getScopedIntakeFileReviewQueueItem`, `updateReviewQueueItemStatusIfCurrent`) and
`Backend/kai/services/kaiReviewQueueService.js` (`createReviewQueueItem`,
`updateReviewQueueStatus`, already route-wired) already code against this table today,
and `scripts/kai-sprint2-ddl-vocabulary-status-check.sql` already asserts its
`queue_type` vocabulary must include `sensitivity_review` alongside nine other
queue_types. This repository's tracked migration chain, however, never created this
table (no `CREATE TABLE ... review_queue_items` exists anywhere in `migrations/`, and
P1-05's own ephemeral-Postgres synthetic harness never bootstraps it). The owner
decision: create the canonical table (matching the full column set and vocabulary
`kaiIntakeQueries.js`/`kaiReviewQueueService.js` already assume) in this tracked P1-06
migration, then wire only the narrow `sensitivity_review` creation path through the
existing `kaiReviewQueueService`/`insertReviewQueueItem` seams - not a second,
competing queue abstraction, and not a parallel `kai.sensitivity_review_queue_items`
table.

## Added

- `migrations/kai_sprint2_p1_06_review_queue.sql` — forward migration creating the
  canonical `kai.review_queue_items` table (all 19 columns already assumed by
  `kaiIntakeQueries.js`/`kaiReviewQueueService.js`: `review_queue_item_id`,
  `organization_id`, `engagement_id`, `queue_type`, `target_object_type`,
  `target_object_id`, `priority`, `queue_status`, `review_status`, `blocked_reason`,
  `assigned_to`, `due_at`, `summary`, `required_action`, `queue_metadata`,
  `created_by`, `created_by_type`, `created_at`, `updated_at`), the
  `queue_type`/`queue_status` CHECK vocabularies matching
  `scripts/kai-sprint2-ddl-vocabulary-status-check.sql` exactly, a partial unique
  index scoping the P1-06 idempotency identity to `queue_type = 'sensitivity_review'`
  only (so no other queue_type's legitimate multi-row-per-target behavior is
  affected), an `updated_at`-maintenance trigger, and the new
  `sensitivity_review_queue_item_created` audit operation/metadata branch on the
  existing `kai.upload_lifecycle_audit`. Adds no table-wide foreign key on
  `target_object_id` (see "No polymorphic FK" below).
- `migrations/kai_sprint2_p1_06_review_queue.rollback.sql` — removes only the P1-06
  table, its index/trigger/function, and the P1-06 audit rows/branch, restoring the
  exact prior audit constraints.
- `scripts/kai-sprint2-p1-06-review-queue-verifier.sql`, `-failure-checks.sql`,
  `-smoke-seed.sql`, `-smoke-verifier.sql` — catalog verification (every check
  embeds PASS/FAIL in its own CASE, avoiding the P1-05-corrected WHERE-EXISTS
  filtering bug), read-only-transaction negative-scope checks (vocabulary rejection,
  NOT NULL enforcement, unique-identity enforcement, bounded-length enforcement, and
  proof that no other queue_type is affected by the new partial unique index),
  synthetic smoke seed (a second predicate-satisfying `kai.intake_sensitivity_profiles`
  row, reusing the P1-05 smoke seed's already predicate-satisfying `sensitivity1`
  row for the primary proof), and smoke verification (creation, replay,
  idempotency-key convergence, concurrent-insert convergence, cross-tenant
  invisibility, and transaction+audit atomicity).
- `scripts/kai-sprint2-p1-06-review-queue-local-postgres.js` — ephemeral loopback
  PostgreSQL 16 runner (`npm run verify:kai-sprint2-p1-06-review-queue`), reusing the
  P1-05 runner's exact mechanism/conventions.
- `scripts/kai-sprint2-p1-06-review-queue-runner-assertions.js` — `assertNoFail`,
  copying the established P1-02/P1-05 pattern.
- `scripts/kai-sprint2-p1-06-review-queue-runbook.md` — package runbook.
- `Backend/kai/dictionary/postgresReviewQueueRepository.js` — new repository: the only
  authorized location for P1-06 SQL and row locking. Reuses the existing
  `insertReviewQueueItem` seam (`Backend/kai/db/kaiIntakeQueries.js`) for the actual
  write rather than duplicating its SQL. Reads exactly the P1-05
  `kai.intake_sensitivity_profiles` columns needed for the VAL-FUP-001-P0 predicate,
  applies that predicate, does an authoritative existing-item lookup by the P1-06
  idempotency identity before ever inserting, and writes the required metadata-only
  `sensitivity_review_queue_item_created` audit row inside the same transaction as the
  insert (own-boolean-data-property audit predicate, copied from
  P1-04/P1-05's `prepareRequiredAudit`).
- `Backend/kai/db/kaiIntakeQueries.js` (additive) — added
  `getScopedSensitivityReviewQueueItemByIdentity`, a narrow, tenant-scoped, `FOR
  UPDATE` lookup scoped to `queue_type = 'sensitivity_review'` /
  `target_object_type = 'intake_sensitivity_profile'` only. No existing exported
  function in this file was modified.
- `Backend/kai/services/kaiReviewQueueService.js` (additive) — added
  `createSensitivityReviewQueueItem`, a new exported function alongside the existing
  `createReviewQueueItem`/`updateReviewQueueStatus` (neither of which was modified).
  Validates its input allowlist (`organizationId`, `intakeSensitivityProfileId`,
  `actorContext`, `now` only), checks `KAI_SPRINT2_ENABLED`, enforces AUTH-KAI-003
  (mapped human actor only - `ai`/`system`/`import`/`code`/any other non-human actor
  type is rejected outright) and VAL-TEN-001 (active organization membership with role
  `gk_admin`, `gk_operator`, or `gk_reviewer`), then delegates to the injected P1-06
  repository. Contains no SQL and imports no database pool. Not composed into any
  route.
- `__tests__/kai-sprint2-p1-06-review-queue-schema-contract.spec.js`, `-boundary.spec.js`,
  `.integration.spec.js`, `-runner-self-test.spec.js` — focused schema, boundary,
  PostgreSQL-backed integration, and runner-assertion tests.

## Changed (additive only)

- `package.json` — added the `verify:kai-sprint2-p1-06-review-queue` script.
- `Backend/kai/db/kaiIntakeQueries.js` — added one new exported function (see above);
  every existing exported function's signature and behavior is unchanged.
- `Backend/kai/services/kaiReviewQueueService.js` — added one new exported function
  (see above); `createReviewQueueItem` and `updateReviewQueueStatus`, and the routes
  that call them, are unchanged.

## No polymorphic FK

`kai.review_queue_items.target_object_id` is shared by ten queue_types, each pointing
at a different target table (for example `intake_file_review` → `kai.intake_files`,
`sensitivity_review` → `kai.intake_sensitivity_profiles`). A single table-wide
`FOREIGN KEY` on that shared column cannot express "when queue_type = X, reference
table Y" without conditional/polymorphic FK machinery, which was explicitly out of
scope. Instead, `postgresReviewQueueRepository.js` authoritatively verifies - inside
the same transaction as the insert - that the referenced, tenant-matched
`kai.intake_sensitivity_profiles` row exists before writing a `sensitivity_review`
item against it. `scripts/kai-sprint2-p1-06-review-queue-failure-checks.sql` proves
this is a deliberate, documented choice (a fabricated `intake_sensitivity_profile_id`
is not rejected at the raw-SQL level) rather than a gap.

## Not changed

No P1-02, P1-03, P1-04, P1-05, or Gate A migration, rollback, runner, verifier, smoke,
repository, service, or runbook artifact was edited. `createReviewQueueItem`,
`updateReviewQueueStatus`, and their existing route wiring are unchanged and were not
composed into by this package. No route, listener, scheduler, timer, startup hook,
public barrel export, production composition, feature-flag default, or cloud
configuration was added. No status transition beyond `null` → `open`, resolution,
approval, escalation, cancellation, reopening, promotion, or source-candidate work was
implemented.

## Behavior summary

Idempotent creation of exactly one `sensitivity_review` / `intake_sensitivity_profile`
`kai.review_queue_items` row per `organization_id` + `intake_sensitivity_profile_id`,
gated by `KAI_SPRINT2_ENABLED`, a mapped human actor (`gk_admin`/`gk_operator`/
`gk_reviewer`) with active organization membership, and the VAL-FUP-001-P0 predicate
(`human_review_required = true` and `public_use_allowed = funder_use_allowed =
llm_processing_allowed = product_learning_allowed = false` and `retention_posture =
'restricted_pending_review'`). The caller supplies only `organizationId`,
`intakeSensitivityProfileId`, `actorContext`, and `now`; every other field
(`queue_type`, `target_object_type`, `target_object_id`, `queue_status`, `priority`,
`summary`, `required_action`, `assigned_to`, `due_at`) is server-pinned or
server-derived. Same identity: replay, no duplicate insert, no duplicate audit.
Concurrent identical creation converges via the partial unique index plus an
authoritative re-read, never an in-process lock. The insert and its required
metadata-only `sensitivity_review_queue_item_created` audit row (exactly `contract`,
`queue_type`, `target_object_type`, `target_object_id`, `queue_status`,
`validator_key`, no other keys) happen inside one transaction; rejection of the
required audit prepare, a synchronous publish failure, or a rejected publish promise
rolls back both together.
