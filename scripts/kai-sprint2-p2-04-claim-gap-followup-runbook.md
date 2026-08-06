# KAI P2-04 Deterministic Claim-Gap/Client-Followup Foundation Runbook

This package creates two canonical, previously-untracked tables -
`kai.gap_log_items` and `kai.client_followup_items` - and one narrow,
human-authorized, idempotent path - `generateClaimGapFollowups` - that
deterministically generates claim-scoped gaps and their client-answerable
follow-ups from the authoritative P2-02 read-only evidence-coverage-assessment
result and the P2-03 claim/evidence lineage, atomically compounded with each
follow-up's `kai.review_queue_items` `'client_followup'` item. It changes no
Gate A through P2-03 migration, rollback, runner, verifier, smoke, repository,
service, or runbook artifact, other than the additive `ALTER TABLE` statements
this package's own forward migration issues against
`kai.upload_lifecycle_audit` and `kai.review_queue_items` (see "Additive schema
changes to earlier tables" below), and the additive `getScopedClaimById` query
function added to `Backend/kai/db/kaiIntakeQueries.js`.

Run:

```sh
npm run verify:kai-sprint2-p2-04-claim-gap-followup
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_p2_04_claim_gap_followup_synthetic`;
- applies the existing synthetic bootstrap schema and the existing frozen Gate A
  through P2-03 migrations, all unmodified, then the new P2-04 forward
  migration;
- runs the P2-04 catalog verifier and read-only failure checks, then the
  existing Gate A through P2-03 smoke seeds followed by the new P2-04 smoke
  seed (which creates one real, committed `kai.claims`/
  `kai.claim_evidence_links` row against the already-promoted P2-01 evidence
  item, since P2-03's own smoke verifier always rolls its own claim-proposal
  simulation back) and smoke verifier;
- runs `__tests__/kai-sprint2-p2-04-claim-gap-followup.integration.spec.js`
  against that runner-owned target only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback
address, port, `listen_addresses`, and PostgreSQL 16 version. It must not be
pointed at a shared, quarantined, cloud, production, or real-client-data
database. The integration spec skips itself unless
`KAI_P2_04_CLAIM_GAP_FOLLOWUP_DATABASE_URL` is set by that runner.

The runner also fails closed on any real `FAIL` status cell returned by the
catalog verifier, read-only failure checks, or smoke verifier (`assertNoFail`,
`scripts/kai-sprint2-p2-04-claim-gap-followup-runner-assertions.js`), copying
the established P2-01/P2-03 `assertNoFail` pattern.
`__tests__/kai-sprint2-p2-04-claim-gap-followup-runner-self-test.spec.js`
proves this deterministically.

The non-database schema-contract and boundary specs
(`__tests__/kai-sprint2-p2-04-claim-gap-followup-schema-contract.spec.js`,
`__tests__/kai-sprint2-p2-04-claim-gap-followup-boundary.spec.js`) run in the
normal suites and need no database.

## Scope

`Backend/kai/dictionary/postgresClaimGapFollowupRepository.js` is the only
authorized location for this package's SQL, other than the reused
`getScoped*` lookups added to `Backend/kai/db/kaiIntakeQueries.js`
(`getScopedClaimById` is new; `getScopedClaimEvidenceLinkByClaimId`,
`getScopedEvidenceItemById`, `getScopedSourceLocatorById`,
`getScopedSourceById`, `getScopedSourceVersionById`,
`getScopedSourceCandidateByIdentity`,
`getScopedPromotionDecisionBySourceVersionId`, and
`getScopedEvidenceReviewQueueItemByEvidenceItemId` are reused unmodified from
P1-08/P2-01/P2-03) plus three P2-02-owned read helpers
(`readSensitivityProfileForAssessment`, `readDataDictionaryFieldsForAssessment`,
`readDataQualityFindingsForAssessment`, `readEvidenceCoverageFieldKeys`) reused
directly, via `postgresEvidenceCoverageAssessmentRepository.js`'s own exported
testables, rather than duplicated. `generateClaimGapFollowups`
(`Backend/kai/services/kaiClaimGapFollowupService.js`) contains no SQL and
imports no database pool: it validates its input allowlist, checks
`KAI_SPRINT2_ENABLED` before any repository read, lock, validator side effect,
or audit activity, enforces AUTH-KAI-003 (reapplied from P1-06 through P2-03),
and then delegates tenant-membership and role authorization to the existing
shared validator-group mechanisms (`validateActorCanPerformOperation`,
`validateTenantBoundaryConsistency`). It is not composed into any route,
listener, scheduler, or production path. Like P2-01/P2-02/P2-03, no
package-specific feature flag is added - this package stays dormant under
`KAI_SPRINT2_ENABLED` alone.

## Service input (exact allowlist)

```
organizationId
claimId
actorContext
now
```

No other fields are accepted; an unknown key or a missing required key is
rejected as `validation_blocker` before any repository call.

**AUTH-KAI-003** (human-actor authorization): `actorContext.actorType` must be
exactly `"human"` with a non-empty `actorUserId`. Every non-human actor type is
rejected with `authorization_denied`. There is no bypass.

**VAL-TEN-001** (tenant membership): the actor must hold an active membership
in the requested `organizationId` with `role_name` in `gk_admin`,
`gk_operator`, or `gk_reviewer`. A role without active tenant membership is
rejected by `validateActorCanPerformOperation`'s own membership check.

## No forked P2-02 dimension logic

This package imports and calls the exact P2-02 dimension-assessment functions
(`assessMissingness`, `assessDuplicates`, `assessDefinitionClarity`,
`assessDenominatorClarity`, `assessTimePeriodClarity`,
`assessEntityLevelClarity`, `assessSmallCellRisk`,
`assessConflictingSourceIndicators`, `assessRequirementAlignment`,
`assessCoverageGaps`) from
`Backend/kai/validators/kaiEvidenceCoverageAssessmentValidators.js` - it never
copies, forks, renames, or reimplements any of the ten dimensions or the
`resolved_clear` / `resolved_risk_flagged` / `unresolved` result vocabulary.
Every dimension function is invoked against this package's own
transaction-scoped authoritative reads (never against a separate transaction
P2-02 opens itself): P2-02's own `readEvidenceCoverageAssessmentFacts` seam is
never called by this package.

## Owner contract: identity, gap generation, and state boundaries

**Immutable identities**: gap item and client follow-up are both
`organization_id + claim_id + dimension_key`; the `client_followup`
`kai.review_queue_items` row is `organization_id + queue_type +
target_object_type + target_object_id`.

**Gap generation**: one `kai.gap_log_items` row per dimension whose
authoritative `assessment_status` is not `resolved_clear`
(`gap_log_items_p2_04_assessment_status_check` excludes `resolved_clear` at the
database level - a resolved_clear dimension can never produce a persisted gap
row). Persisted columns are limited to identifiers, the authoritative
`assessment_status`, the dimension's own `validator_key` (a reason code, e.g.
`VAL-KAI-P2-02-missingness`), the fixed deterministic `safe_summary` template
(`gap_log_items_p2_04_safe_summary_check` enforces it exactly: `"Claim gap
requires review for dimension: <dimension_key>."`), and four metadata-safe
integer counts (`open_finding_count`, `field_count`, `undefined_field_count`,
`uncovered_field_count`) - never a raw row, sample, uncovered-field-key list,
claim/evidence text, filename, or unrestricted metadata.

**No independent gap/follow-up status vocabulary**: this package adds no
`gap_status`, `followup_status`, or equivalent column. Unresolved gap state is
represented by the persisted gap row plus its authoritative P2-02 assessment
result; client-follow-up workflow state is represented only by its
`client_followup` review-queue item's own `queue_status`/`review_status`.

**Unresolved conflict/requirement dimensions**: `conflicting_source_indicators`
and `requirement_alignment` are always `unresolved` today (P2-02's own
documented finding: no authoritative cross-source or requirement relationship
is committed anywhere in the current schema). This package creates an internal
gap item recording only that unresolved result for each - it never asserts a
conflict exists, never creates a `conflict_group` or `conflict_resolution`
queue item, never states a requirement is met/unmet/partially met, and never
infers a requirement or engagement relationship. Both dimensions are outside
the four client-answerable dimensions, so neither is ever routed to a client
follow-up.

## Client-follow-up generation and routing (VAL-KAI-P2-04-002)

A client follow-up is created only for an open gap on one of the four
client-answerable dimensions - `definition_clarity`, `denominator_clarity`,
`time_period_clarity`, `entity_level_clarity` - using only the fixed
server-owned question for that dimension (never augmented with a field
identifier, filename, or label):

| dimension_key           | question_text                                                                  |
|--------------------------|---------------------------------------------------------------------------------|
| `definition_clarity`     | Confirm the business meaning of the unresolved field or measure.               |
| `denominator_clarity`    | Confirm the denominator and how it is calculated.                             |
| `time_period_clarity`    | Confirm the reporting period represented by this source.                      |
| `entity_level_clarity`   | Confirm the entity level represented by the unresolved field or measure.       |

`validateClientFollowupRouting`
(`Backend/kai/validators/kaiClaimGapFollowupValidators.js`) is the sole gate
authorizing a follow-up plus its queue item: it verifies the dimension is one
of the four authorized keys, the target gap exists and is tenant/dimension-
matched to the claim, the follow-up and queue write plans carry the exact fixed
contract (dimension/question pairing, `queue_type = 'client_followup'`,
`target_object_type = 'client_followup_item'`, `queue_status =
'waiting_on_client'`, `review_status = 'proposed'`, `priority = 'normal'`,
`summary = 'Client clarification is required for an unresolved claim gap.'`,
`required_action` = the exact fixed question, `assigned_to = NULL`, `due_at =
NULL`), and that no field beyond that fixed allowlist is present - so no
internal-only reason, unsupported conflict/requirement assertion, raw content,
claim/evidence text, PII, or sensitive metadata can ever reach the client
queue. The repository calls this validator against the real, freshly inserted
gap row before writing each follow-up; any failure raises
`MalformedInsertedRowError` (this is an internal-consistency guard - the
service's own fixed constants and the freshly inserted gap identity are
expected to always agree).

No client reviewer is inferred, discovered, or assigned by this package
(`assigned_to`/`due_at` are always `NULL`).

## Client-follow-up queue contract

Mirrors `ux_review_queue_items_p1_06_sensitivity_review_identity` /
`ux_review_queue_items_p2_01_evidence_review_identity` /
`ux_review_queue_items_p2_03_claim_review_identity` exactly:
`'client_followup'` was already an accepted `queue_type` value in the P1-06
migration, unused until this package. A new
`ux_review_queue_items_p2_04_client_followup_identity` partial unique index
enforces the identity. Unlike P2-03's narrower required-action-only addition,
this package's task specification discloses the complete fixed
`'client_followup'` queue contract as an explicit deliverable, so
`review_queue_items_p2_04_client_followup_contract_check` enforces the entire
contract (`target_object_type`, `queue_status`, `review_status`, `priority`,
`summary`, `required_action`, `assigned_to`, `due_at`) at the database level,
scoped to `queue_type = 'client_followup'` rows only - no other queue_type's
behavior changes.

## Authoritative reads, lineage validation, and the current-source-version gate

`validateClaimGapLineage`
(`Backend/kai/validators/kaiClaimGapFollowupValidators.js`) requires the P2-04
service's own claim (`getScopedClaimById`, by `claimId`) and its canonical
`kai.claim_evidence_links` row to be present and tenant/identity-consistent
with each other and with the evidence item the link binds to, then delegates
every deeper lineage/permission judgment to the already-accepted validators
rather than reimplementing them: P2-03's `validateClaimHasLoadBearingEvidence`
(evidence/locator/source/source_version/candidate/decision/evidence_review
lineage, including the current-source_version gate - a source_version whose
`is_current` is anything other than boolean `true` fails closed with
`conflict_current_state_changed`, zero mutation, zero audit) and P2-02's
`validateEvidenceCoverageAssessmentIsPermitted` (dictionary/profile lineage
plus the allowed-use permission gate).

## Complete expected-set replay, partial-state rejection, and the "no gaps" case

Before any write, the repository reads every already-committed gap/
follow-up/`client_followup`-queue row for this claim and compares it against
the complete deterministic expected set computed from the ten P2-02 dimension
results:

1. **Nothing exists, and gaps are expected** -> the complete expected set
   (every gap, every client follow-up, every queue item) is written atomically
   via one multi-row `INSERT ... ON CONFLICT (...) DO NOTHING RETURNING` per
   table, followed by one required metadata-only audit row.
2. **Every expected row already exists, byte-for-byte** -> `replayed: true`,
   zero writes, zero audit.
3. **Only part of the expected set exists, an unexpected row exists for the
   same claim/dimension identity, a persisted assessment differs, or any
   immutable identity differs** -> `conflict_current_state_changed`, zero
   mutation, zero audit. This state is never repaired.
4. **All ten dimensions are `resolved_clear`** -> success with empty gap,
   follow-up, and queue collections, zero writes, zero audit.

Two genuinely concurrent identical calls converge via PostgreSQL's own
row-level locking rather than any application-level primitive: because both
calls' bulk `INSERT` statements target the identical full key set, the losing
transaction's insert blocks on the first colliding key until the winning
transaction commits, then finds every key already taken and returns zero rows
for that table - never a partial split. The losing call then authoritatively
rereads the complete committed set and returns `replayed: true`.

## Required metadata-only audit

Exactly one `claim_gap_and_followup_generated` audit row is published per call
that performs a fresh write. The metadata carries exactly `metadata_only`,
`contract` (`'p2_claim_gap_followup_v1'`), `claim_id`, `evidence_item_id`,
`source_version_id`, `gap_dimension_keys`, `client_followup_dimension_keys`,
`gap_count`, `client_followup_count`, `review_queue_item_count`,
`fresh_write_count`, and `validator_key` - twelve keys, no more. **Question
text, summaries, and safe_summary text are never carried in audit metadata**
(`NOT metadata ? 'question_text'`, `NOT metadata ? 'summary'`, `NOT metadata ?
'safe_summary'`): they live only in `kai.client_followup_items.question_text`
and `kai.gap_log_items.safe_summary`. Rejection of the required audit prepare,
a synchronous publish failure, or a rejected publish promise rolls back every
mutation together (own-boolean-data-property audit predicate, copied from
P1-05 through P2-03's `prepareRequiredAudit`). Identical replay and the empty
expected-set result create no audit row and perform no audit publication.

When `KAI_SPRINT2_ENABLED` is disabled, the service returns the canonical
`feature_disabled` result with zero repository reads, locks, validator side
effects, or audit activity.

This package does not add a route, listener, scheduler, timer, polling loop,
startup hook, public barrel export, production composition, feature-flag
default enablement, conflict-group persistence, conflict-resolution decisions,
operator-action persistence, client-review decisions, claim approval/
promotion/mutation, evidence-review mutation, source-promotion changes,
requirement/engagement persistence, assistant tools, traceability UI,
generation, public/funder export, cloud work, or real-client-data handling.

## Additive schema changes to earlier tables

Following the accepted P1-07/P1-08/P2-01/P2-03 precedent of widening an
earlier package's CHECK-pinned vocabulary or adding a unique index through a
later package's forward migration (never editing the earlier package's
accepted migration file):

- `kai.upload_lifecycle_audit`'s operation and metadata-object CHECK
  constraints are extended with the new `claim_gap_and_followup_generated`
  branch, preserving every earlier branch verbatim (including `claim_proposed`
  and `evidence_lineage_extracted`).
- One partial unique index is added to `kai.review_queue_items`
  (`ux_review_queue_items_p2_04_client_followup_identity`, scoped to
  `queue_type = 'client_followup'` only), and one scoped CHECK constraint
  (`review_queue_items_p2_04_client_followup_contract_check`) enforces the
  complete fixed queue contract for that `queue_type` only. `'client_followup'`
  was already an accepted `queue_type` value in the P1-06 migration - the
  `review_queue_items_p1_06_queue_type_check` constraint itself is never
  touched.

## PostgreSQL isolation

`__tests__/kai-sprint2-p2-04-claim-gap-followup.integration.spec.js` validates
`KAI_P2_04_CLAIM_GAP_FOLLOWUP_DATABASE_URL` as loopback-only (`127.0.0.1`,
`localhost`, or `::1`) synchronously, before performing a single dynamic
import of `pg` or any P2-04 module - and never imports
`Backend/kai/db/kaiDb.js` anywhere in the file.
`Backend/kai/dictionary/postgresClaimGapFollowupRepository.js` never statically
imports `kaiDb.js` either: its default `withTransaction` is a deferred `await
import(...)`, reached only when a caller does not inject its own
`runInTransaction` - the integration spec always does, via a test-local
`withRunnerOwnedTransaction` wrapper reimplemented over its own runner-owned
`Pool`. Ambient `DATABASE_URL` is therefore never read or consulted by this
suite; a non-loopback URL is rejected before any connection is attempted; and
direct execution with `KAI_P2_04_CLAIM_GAP_FOLLOWUP_DATABASE_URL` unset
performs zero database activity.

## Rollback

`migrations/kai_sprint2_p2_04_claim_gap_followup.rollback.sql` removes only the
P2-04 audit rows/branch (restoring the exact prior audit constraints), the
`review_queue_items_p2_04_client_followup_contract_check` constraint, the
partial unique index on `kai.review_queue_items`, and the
`kai.client_followup_items` and `kai.gap_log_items` tables (child-first). It
alters no Gate A through P2-03 table, column, or constraint beyond that
restoration.
