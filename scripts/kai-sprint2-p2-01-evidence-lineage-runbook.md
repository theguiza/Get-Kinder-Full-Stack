# KAI P2-01 Deterministic Evidence-Lineage Foundation Runbook

This package creates two canonical, previously-untracked tables -
`kai.source_locators` and `kai.evidence_items` - and one narrow, human-authorized,
idempotent path - `extractEvidenceFromSourceVersion` - that deterministically
derives evidence statements from the CURRENT `kai.source_versions` row of a fully
promoted P1-08 source, atomically compounded with the `kai.source_locators`
`'column'` coordinate each per-field fact is bound to and the `kai.review_queue_items`
`'evidence_review'` item each fresh evidence item requires. It changes no Gate A
through P1-08 migration, rollback, runner, verifier, smoke, repository, service, or
runbook artifact, other than the additive `ALTER TABLE` statements this package's
own forward migration issues against `kai.upload_lifecycle_audit` and
`kai.review_queue_items` (see "Additive schema changes to earlier tables" below),
and the additive `getScoped*` query functions added to
`Backend/kai/db/kaiIntakeQueries.js`.

Run:

```sh
npm run verify:kai-sprint2-p2-01-evidence-lineage
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_p2_01_evidence_lineage_synthetic`;
- applies the existing synthetic bootstrap schema and the existing frozen Gate A
  through P1-08 migrations, all unmodified, then the new P2-01 forward migration;
- runs the P2-01 catalog verifier and read-only failure checks, then the existing
  Gate A through P1-08 smoke seeds followed by the new P2-01 smoke seed (which
  advances the already-seeded P1-07 candidate/review pair through the exact P1-08
  promotion this package depends on, since P1-08's own smoke verifier always rolls
  its own promotion simulation back) and smoke verifier;
- runs `__tests__/kai-sprint2-p2-01-evidence-lineage.integration.spec.js` against
  that runner-owned target only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback
address, port, `listen_addresses`, and PostgreSQL 16 version. It must not be
pointed at a shared, quarantined, cloud, production, or real-client-data database.
The integration spec skips itself unless `KAI_P2_01_EVIDENCE_LINEAGE_DATABASE_URL`
is set by that runner.

The runner also fails closed on any real `FAIL` status cell returned by the
catalog verifier, read-only failure checks, or smoke verifier (`assertNoFail`,
`scripts/kai-sprint2-p2-01-evidence-lineage-runner-assertions.js`), copying the
established P1-08 `assertNoFail` pattern.
`__tests__/kai-sprint2-p2-01-evidence-lineage-runner-self-test.spec.js` proves this
deterministically.

The non-database schema-contract and boundary specs
(`__tests__/kai-sprint2-p2-01-evidence-lineage-schema-contract.spec.js`,
`__tests__/kai-sprint2-p2-01-evidence-lineage-boundary.spec.js`) run in the normal
suites and need no database.

## Scope

`Backend/kai/dictionary/postgresEvidenceLineageRepository.js` is the only
authorized location for this package's SQL and row locking, other than the reused
`getScoped*` lookups added to `Backend/kai/db/kaiIntakeQueries.js`
(`getScopedPromotionDecisionBySourceVersionId`, `getScopedSensitivityProfileById`,
`getScopedDataDictionaryById`, `getScopedDataDictionaryFieldsByDictionaryId`,
`getScopedEvidenceItemByStatementFingerprint`, `getScopedSourceLocatorByFingerprint`,
`getScopedEvidenceReviewQueueItemByEvidenceItemId`; `getScopedSourceVersionById`,
`getScopedSourceById`, and `getScopedSourceCandidateByIdentity` are reused
unmodified from P1-08). `extractEvidenceFromSourceVersion`
(`Backend/kai/services/kaiEvidenceLineageService.js`) contains no SQL and imports
no database pool: it validates its input allowlist, checks `KAI_SPRINT2_ENABLED`
before any repository read, lock, validator side effect, or audit activity,
enforces AUTH-KAI-003 (reapplied from P1-06 through P1-08), and then delegates
tenant-membership and role authorization to the existing shared validator-group
mechanisms (`validateActorCanPerformOperation`, `validateTenantBoundaryConsistency`).
It is not composed into any route, listener, scheduler, or production path.

**P2-01C correction**: this package's own `KAI_EVIDENCE_LINEAGE_ENABLED` flag and
its `isKaiEvidenceLineageEnabled`/`areKaiSprint2EvidenceLineageFeaturesEnabled`
helpers have been removed entirely from `Backend/kai/config/kaiSprint2Config.js`.
P2-01 is gated by `KAI_SPRINT2_ENABLED` alone and remains dormant because it has no
route, worker, listener, or production composition - exactly like every other
still-unwired P2 package.

**AUTH-KAI-003** (human-actor authorization): `actorContext.actorType` must be
exactly `"human"` with a non-empty `actorUserId`. Every non-human actor type is
rejected with `authorization_denied`. There is no bypass.

**VAL-TEN-001** (tenant membership): the actor must hold an active membership in
the requested `organizationId` with `role_name` in `gk_admin`, `gk_operator`, or
`gk_reviewer`.

**VAL-KAI-P2-01-001** (`Backend/kai/validators/kaiEvidenceLineageValidators.js`,
`validateEvidenceHasSourceLineage`): a pure, no-SQL, no-database function over six
freshly re-read rows (source_version, source, candidate, promotion decision,
sensitivity profile, data dictionary), checked in this fixed order, fail-closed:

1. Any of the six rows missing -> `not_found`.
2. `source_version.is_current !== true` (must be the CURRENT version, never a
   superseded one) -> `conflict_current_state_changed`.
3. The source_version's own `source_id` must match the fetched source row's
   `source_id` -> `conflict_current_state_changed`.
4. The candidate must have reached `candidate_status = 'promoted'` ->
   `validation_blocker`.
5. The promotion decision must have reached `decision_status = 'promoted'` ->
   `validation_blocker`.
6. The promoted decision must be bound to exactly this source and source_version
   -> `conflict_current_state_changed`.
7. Cross-row lineage-field equality (`organization_id`,
   `intake_sensitivity_profile_id`, `file_profile_id`, `data_dictionary_id`,
   `profile_canonical_sha256`) across the version/candidate/profile/dictionary rows
   -> any mismatch -> `conflict_current_state_changed`.
8. Every `profile_canonical_sha256` field inspected in check 7 must itself be a
   well-formed sha256 hex digest -> `validation_blocker`.
9. The reapplied P1-08 permission predicate (`human_review_required = true`,
   `public_use_allowed = funder_use_allowed = llm_processing_allowed =
   product_learning_allowed = false`, `retention_posture =
   'restricted_pending_review'`) against the freshly re-read sensitivity-profile
   row -> `validation_blocker`.

## Evidence composition is deterministic and server-derived only

**P2-01C correction**: this package's extractor no longer creates an unlocated
aggregate item. It creates exactly one evidence kind, one row per already-
committed `kai.data_dictionary_fields` row bound to the current source_version:

- **`dictionary_field_presence_fact`** (one per committed field, in
  `profile_field_key ASC` order): "Source version's committed data dictionary
  includes field "X" of committed type "Y"." Bound to exactly one `'column'`
  `kai.source_locators` row whose `coordinates = { column_name: X }` -
  `source_locator_id` is now a `NOT NULL` column; there is no evidence shape that
  omits a locator.

Both the locator fingerprint (`organizationId|sourceVersionId|'column'|column_name`)
and the statement fingerprint (`organizationId|sourceVersionId|evidenceType|statement`)
are sha256 hex digests, computed only from these already-committed facts - never
from caller input, raw file content, or a sample value. **Only the `'column'`
locator coordinate is implemented**: `profile_field_key` is the only exact,
already-committed, non-fabricated coordinate available from upstream metadata
without reading raw file content. Sheet/row/paragraph/section/page/cell-range
coordinates are not implemented because no currently committed upstream metadata
source supplies them; this package never fabricates the missing ones.

Every evidence item carries: `organization_id`, `source_id`, `source_version_id`,
a non-null `source_locator_id`, `evidence_type` (pinned to
`'dictionary_field_presence_fact'`), `data_class` (pinned to
`'organization_committed_metadata'`), `sensitivity_level` (copied verbatim from the
authoritative `kai.data_dictionary_fields.sensitivity` value the item was derived
from, using exactly that column's own existing vocabulary), `support_strength`
(pinned to `'unassessed'`), `evidence_review_status = 'needs_gk_review'`,
`internal_only = true`, and `public_use_allowed = funder_use_allowed =
llm_processing_allowed = product_learning_allowed = false`.

`organization_id` + `source_id` + `source_version_id` is enforced as one
tenant-safe lineage tuple by a single three-column composite foreign key
(`evidence_items_p2_01_source_version_fk`, against the new
`source_versions_p2_01_id_source_org_unique` constraint added to the existing
P1-08 `kai.source_versions` table) - never by independent single-column or
two-column foreign keys, which could not by themselves prove the stored
source_version actually belongs to the stored source and organization.

Each fresh evidence item's `evidence_review` review-queue item now carries a
fixed, disclosed `required_action`: "Review the evidence item's lineage,
sensitivity, support strength, and audience eligibility before use." A new
`review_queue_items_p2_01_evidence_review_required_action_check` CHECK constraint
requires `required_action` to be present and non-blank for `queue_type =
'evidence_review'` rows only, mirroring the exact P1-06 `sensitivity_review`
precedent; no other `queue_type` is affected.

## Write order and the P1-07 partial-replay-repair correction reapplied

For each planned item (aggregate first, then field items in `profile_field_key ASC`
order): insert its locator (if any) via `ON CONFLICT ... DO NOTHING RETURNING`,
reread on a lost race; insert the evidence item the same way, tracking whether
THIS call's own insert returned a row (`isFreshlyCreated`); then, **strictly gated
on `isFreshlyCreated` for THIS evidence item** (never on "a queue item happens to
be missing"), insert its `evidence_review` review-queue item. This reapplies the
exact P1-07 correction (`Backend/kai/dictionary/postgresSourceCandidateRepository.js`
and its ExecPlan history: "removed the silent partial-replay repair path"): an
already-existing evidence item with a missing matching queue item is a conflict
(`ConcurrentStateChangedError`), never a silent repair-insert.

After every item is processed, an authoritative post-write count proves every
evidence item for this source_version has exactly one matching queue item; any
inconsistency raises `MalformedInsertedRowError` (system_error, rolled back).

## Replay and idempotency identity

The P2-01 idempotency identity is `organization_id` + `source_version_id` +
`statement_fingerprint` (evidence items) and `organization_id` +
`source_version_id` + `locator_fingerprint` (locators). If every one of this
call's own writes turned out to already exist (`fresh_write_count === 0`), the
call is a full identical replay: zero writes, zero audit, `replayed: true`.
Concurrent identical extraction at every step (locator, evidence item, queue item)
is resolved entirely by PostgreSQL's unique constraints via
`INSERT ... ON CONFLICT ... DO NOTHING RETURNING`, never a raised `23505` catch or
any application-level synchronization primitive.

## Required metadata-only audit

Exactly one `evidence_lineage_extracted` audit row is published per call that
performs at least one fresh write. The metadata carries exactly `metadata_only`
(`true`), `contract` (`'p2_evidence_lineage_extraction_v1'`), `source_version_id`,
`intake_sensitivity_profile_id`, `profile_canonical_sha256`,
`evidence_item_count`, `source_locator_count`, `review_queue_item_count`,
`fresh_write_count`, and `validator_key` (`'VAL-KAI-P2-01-001'`) - ten keys, no
more. **No `statement` or `statement_fingerprint` key is ever carried in audit
metadata**: the audit is a compound-operation summary, never derived statement
content or a per-item fingerprint that could reconstruct which fields exist.
Rejection of the required audit prepare, a synchronous publish failure, or a
rejected publish promise rolls back every mutation together (own-boolean-data-
property audit predicate, copied from P1-05 through P1-08's `prepareRequiredAudit`).

When `KAI_SPRINT2_ENABLED` is disabled, the service returns the canonical
`feature_disabled` result with zero repository reads, locks, validator side
effects, or audit activity.

This package does not add a route, listener, scheduler, timer, polling loop,
startup hook, public barrel export, production composition, feature-flag default
enablement, cloud configuration, record-ID or redacted-extract locator, graph
relationship, generation logic, or real-client-data handling.

## Additive schema changes to earlier tables

Following the accepted P1-07/P1-08 precedent of widening an earlier package's
CHECK-pinned vocabulary or adding a unique index through a later package's forward
migration (never editing the earlier package's accepted migration file):

- `kai.upload_lifecycle_audit`'s operation and metadata-object CHECK constraints
  are extended with the new `evidence_lineage_extracted` branch, preserving every
  earlier branch verbatim.
- One partial unique index is added to `kai.review_queue_items`
  (`ux_review_queue_items_p2_01_evidence_review_identity`, scoped to `queue_type =
  'evidence_review'` only), mirroring
  `ux_review_queue_items_p1_06_sensitivity_review_identity` and
  `ux_review_queue_items_p1_07_source_candidate_review_identity` exactly.
  `'evidence_review'` was already an accepted `queue_type` value in the P1-06
  migration, unused until this package, so no CHECK constraint on
  `kai.review_queue_items` is widened.

## PostgreSQL isolation (P2-01C correction)

`__tests__/kai-sprint2-p2-01-evidence-lineage.integration.spec.js` validates
`KAI_P2_01_EVIDENCE_LINEAGE_DATABASE_URL` as loopback-only (`127.0.0.1`,
`localhost`, or `::1`) synchronously, before performing a single dynamic import
of `pg` or any P2-01 module - and never imports `Backend/kai/db/kaiDb.js`
(which imports `Backend/db/pg.js`, itself capable of import-time construction of
the ambient application connection pool from whatever `DATABASE_URL`/
`DATABASE_URL_LOCAL`/etc happens to be set in the process environment) anywhere
in the file. `Backend/kai/dictionary/postgresEvidenceLineageRepository.js` no
longer statically imports `kaiDb.js` either: its default `withTransaction` is now
a deferred `await import(...)`, reached only when a caller does not inject its
own `runInTransaction` - the integration spec always does, via a test-local
`withTestTransaction` wrapper reimplemented over its own runner-owned `Pool`
(constructed only from the validated `KAI_P2_01_EVIDENCE_LINEAGE_DATABASE_URL`).
Ambient `DATABASE_URL` is therefore never read or consulted by this suite; a
non-loopback URL is rejected before any connection is attempted; and direct
execution with `KAI_P2_01_EVIDENCE_LINEAGE_DATABASE_URL` unset performs zero
database activity (the suite is skipped before any dynamic import is reached).

## Rollback

`migrations/kai_sprint2_p2_01_evidence_lineage.rollback.sql` removes only the
P2-01 audit rows/branch (restoring the exact prior audit constraints), the
`review_queue_items_p2_01_evidence_review_required_action_check` constraint, the
partial unique index on `kai.review_queue_items`, the `kai.evidence_items` and
`kai.source_locators` tables (child-first), and the
`source_versions_p2_01_id_source_org_unique` constraint added to the existing
P1-08 `kai.source_versions` table. It alters no Gate A through P1-08 table,
column, or constraint beyond that restoration.
