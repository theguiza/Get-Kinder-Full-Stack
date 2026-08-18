# KAI P1-06 Review Queue Foundation and Sensitivity-Review Item Creation Runbook

This package creates the canonical, previously-untracked `kai.review_queue_items`
table (already coded against by the existing, production-wired
`Backend/kai/db/kaiIntakeQueries.js` and `Backend/kai/services/kaiReviewQueueService.js`,
and already asserted by `scripts/kai-sprint2-ddl-vocabulary-status-check.sql`), then
adds one narrow, idempotent creation path — `createSensitivityReviewQueueItem` — for a
single `sensitivity_review` queue item per existing, predicate-satisfying P1-05
`kai.intake_sensitivity_profiles` row. It reuses the existing `insertReviewQueueItem`
seam rather than building a second queue abstraction, and it changes no P1-02, P1-03,
P1-04, P1-05, or Gate A migration, rollback, runner, verifier, smoke, repository,
service, or runbook artifact.

Run:

```sh
npm run verify:kai-sprint2-p1-06-review-queue
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_p1_06_review_queue_synthetic`;
- applies the existing synthetic bootstrap schema and the existing frozen Gate A P0
  upload-lifecycle, Gate A P0 policy-decision-replay, P1-02 parser-run/file-profile,
  P1-04 data-dictionary/quality, and P1-05 intake-sensitivity-profile migrations, all
  unmodified, then the new P1-06 forward migration;
- runs the P1-06 catalog verifier and read-only failure checks, then the existing
  Gate A, P1-04, and P1-05 smoke seeds followed by the new P1-06 smoke seed and smoke
  verifier;
- runs `__tests__/kai-sprint2-p1-06-review-queue.integration.spec.js` against that
  runner-owned target only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback address,
port, `listen_addresses`, and PostgreSQL 16 version. It must not be pointed at a
shared, quarantined, cloud, production, or real-client-data database. The integration
spec skips itself unless `KAI_P1_06_REVIEW_QUEUE_DATABASE_URL` is set by that runner.

The runner also fails closed on any real `FAIL` status cell returned by the catalog
verifier, read-only failure checks, or smoke verifier (`assertNoFail`,
`scripts/kai-sprint2-p1-06-review-queue-runner-assertions.js`), copying the
established P1-02/P1-05 `assertNoFail` pattern: a check name merely containing the
substring `FAIL_CLOSED` never trips it.
`__tests__/kai-sprint2-p1-06-review-queue-runner-self-test.spec.js` proves this
deterministically.

The non-database schema-contract and boundary specs
(`__tests__/kai-sprint2-p1-06-review-queue-schema-contract.spec.js`,
`__tests__/kai-sprint2-p1-06-review-queue-boundary.spec.js`) run in the normal suites
and need no database.

## Scope

`Backend/kai/dictionary/postgresReviewQueueRepository.js` is the only authorized
location for this package's SQL and row locking, other than the reused
`getScopedSensitivityReviewQueueItemByIdentity` seam in
`Backend/kai/db/kaiIntakeQueries.js`. The idempotent
`INSERT ... ON CONFLICT ... DO NOTHING RETURNING` lives in the repository itself
(not in the shared query module) because that module's other exports are relied on,
by an unrelated Gate-A/P1-02 idempotency contract, to never contain an ON
CONFLICT/unique-violation-catch pattern. `createSensitivityReviewQueueItem`
(`Backend/kai/services/kaiReviewQueueService.js`) contains no SQL and imports no
database pool: it validates its input allowlist, checks `KAI_SPRINT2_ENABLED`,
enforces AUTH-KAI-003 (a local, strictly narrower human-actor gate than the shared
assistant-boundary allowlist) and then delegates tenant-membership and role
authorization to the existing shared validator-group mechanisms
(`validateActorCanPerformOperation`, `validateTenantBoundaryConsistency`), preserving
their structured blockers rather than reimplementing membership/role logic locally.
It does not modify `createReviewQueueItem` or `updateReviewQueueStatus`, and it is not
composed into any route.

**AUTH-KAI-003** (human-actor authorization): `actorContext.actorType` must be exactly
`"human"` with a non-empty `actorUserId`. Every non-human actor type — `ai`, `system`,
`import`, `code`, or any other generic-service actor — is rejected with
`authorization_denied`. There is no bypass.

**VAL-TEN-001** (tenant membership): the actor must hold an active
(`membership_status = "active"`) membership in the requested `organizationId` with
`role_name` in `gk_admin`, `gk_operator`, or `gk_reviewer`. No tenant-membership
bypass.

**VAL-FUP-001-P0** (creation-trigger predicate): a `sensitivity_review` item may only
be created when the tenant-scoped, freshly re-read `kai.intake_sensitivity_profiles`
row has `human_review_required = true` and `public_use_allowed = funder_use_allowed =
llm_processing_allowed = product_learning_allowed = false` and `retention_posture =
'restricted_pending_review'`. Because every one of those columns is itself pinned by a
P1-05 CHECK constraint with no exception, every row that can actually be inserted into
`kai.intake_sensitivity_profiles` today already satisfies this predicate; a
predicate-failure result is only reachable defensively (via a fake transaction context
in the boundary test), exactly like P1-05's own analogous unreachable-through-real-
schema branch.

Identity and replay (owner decision for P1-06): one `sensitivity_review` /
`intake_sensitivity_profile` item per `organization_id` +
`intake_sensitivity_profile_id`, enforced by the partial unique index
`ux_review_queue_items_p1_06_sensitivity_review_identity` (scoped to `queue_type =
'sensitivity_review'` only, so no other queue_type's legitimate multi-row-per-target
behavior is affected). The repository does an authoritative existing-item lookup
before ever inserting; if found, it replays that row with no duplicate insert and no
duplicate audit. Concurrent identical creation is resolved entirely by PostgreSQL's
partial unique index via `INSERT ... ON CONFLICT (organization_id, queue_type,
target_object_type, target_object_id) WHERE queue_type = 'sensitivity_review' DO
NOTHING RETURNING ...` (`insertSensitivityReviewQueueItemIfAbsent`,
`Backend/kai/db/kaiIntakeQueries.js`): the losing transaction observes zero returned
rows - never a raised `23505` that would abort its transaction before it could
re-read - then re-reads and replays the authoritative committed row, inside the same
transaction, never by a savepoint, in-process lock, mutex, in-flight map, or advisory
lock. Replay validates only tenant scope and the immutable creation identity
(`organization_id`, `queue_type`, `target_object_type`, `target_object_id`), never a
later-authorized mutable field such as `queue_status`, `priority`, `assigned_to`,
`due_at`, `summary`, or `required_action`; a tenant or identity mismatch is surfaced
as `conflict_current_state_changed`. A newly inserted row is fully validated against
every server-pinned field before its audit is prepared; a malformed inserted result
returns `system_error`, publishes no audit, and rolls back the transaction.

The caller supplies only `organizationId`, `intakeSensitivityProfileId`,
`actorContext`, and `now`. `queue_type` (`'sensitivity_review'`), `target_object_type`
(`'intake_sensitivity_profile'`), `target_object_id` (the re-read
`intake_sensitivity_profile_id`), `queue_status` (`'open'`), `priority` (`'medium'`),
`summary`, `required_action`, `assigned_to` (`null`), and `due_at` (`null`) are all
server-pinned constants or server-derived; the caller cannot provide or override any
of them, nor any lineage, classification, consent, allowed-use, audience-eligibility,
review-result, or approval fact.

Creating the item and writing the required metadata-only
`sensitivity_review_queue_item_created` audit row happen inside one transaction.
Rejection of the required audit prepare, a synchronous publish failure, or a rejected
publish promise rolls back the item insert in that same transaction (own-boolean-
data-property audit predicate, copied from P1-04/P1-05's `prepareRequiredAudit`). The
audit metadata carries exactly `metadata_only` (`true`), `contract`
(`'p1_sensitivity_review_queue_item_v1'`), `queue_type`, `target_object_type`,
`target_object_id`, `queue_status`, and `validator_key` (`'VAL-FUP-001-P0'`), and no
summary text, required-action text, profile content, classification, label, sample,
PII, path, URL, prompt, or credential.

`kai.review_queue_items` additionally enforces, for `queue_type = 'sensitivity_review'`
rows only, that `required_action` is present and non-blank
(`review_queue_items_p1_06_sensitivity_review_required_action_check`); every other
queue_type's `required_action` remains optional, unchanged.

When `KAI_SPRINT2_ENABLED` is disabled, the service returns the canonical
`feature_disabled` result with zero profile reads, membership checks, writes, locks,
audit preparation, or publication.

This package does not add a route, listener, scheduler, timer, polling loop, startup
hook, public barrel export, production composition, application repository selection,
feature-flag default, or cloud configuration. Status transitions beyond `null` →
`open`, resolution, approval, escalation, cancellation, reopening, promotion, and
source-candidate work are out of scope and are not implemented.

## No polymorphic FK

`kai.review_queue_items.target_object_id` is shared by ten queue_types pointing at
different target tables, so this package adds no table-wide `FOREIGN KEY` on that
column. `postgresReviewQueueRepository.js` authoritatively verifies, inside the same
transaction as the insert, that the referenced, tenant-matched
`kai.intake_sensitivity_profiles` row exists before writing a `sensitivity_review`
item against it. See the migration's own comment and
`scripts/kai-sprint2-p1-06-review-queue-failure-checks.sql`'s
`fabricated_target_no_db_level_fk_by_design` check for the documented proof that this
is a deliberate design choice.

## Rollback

`migrations/kai_sprint2_p1_06_review_queue.rollback.sql` removes only the P1-06 audit
rows/branch (restoring the exact prior audit constraints) and the
`kai.review_queue_items` table with its index, trigger, and trigger function. It
alters no P1-02, P1-03, P1-04, P1-05, or Gate A table, column, or constraint.
