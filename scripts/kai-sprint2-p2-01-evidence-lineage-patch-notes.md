# KAI P2-01 Patch Notes — Deterministic Evidence-Lineage Foundation

## Owner decision on scope and boundary

Research before implementation confirmed `kai.source_locators`, `kai.evidence_items`,
and `extractEvidenceFromSourceVersion` do not exist anywhere in the repository; all
are introduced fresh by this package. Evidence composition, locator creation, and
review-queue-item creation are kept compounded in one atomic operation, matching the
established compound-boundary idiom P1-07/P1-08 already use for their own multi-row
writes.

## Owner decision on the locator_type vocabulary (single-value pin)

`locator_type` is pinned to the single value `'column'` - not a widened
vocabulary - because this package's extractor only ever creates that one
coordinate kind. `profile_field_key` is the only exact, already-committed,
non-fabricated coordinate available from upstream metadata without reading raw
file content. Sheet/row/paragraph/section/page/cell-range coordinates are not
implemented in this package because no currently committed upstream metadata
source supplies them; record-ID and redacted-extract locators are excluded from
this package entirely, per the disclosed owner decision that governs it. This
package never invents or fabricates the missing coordinate kinds to fill out a
wider vocabulary - it simply never claims to produce what it cannot exactly prove.

## Owner decision on validator_key

`VAL-KAI-P2-01-001` is this package's disclosed, convention-consistent validator
key, following the exact `VAL-KAI-P1-08-00N` naming idiom P1-08 itself used. It is
not quoted from, and is not claimed to be mandated by, any owner-authorized
governing source.

## Owner decision on the audit operation name

`evidence_lineage_extracted` is this package's own audit operation name, added to
`kai.upload_lifecycle_audit`'s existing operation/metadata CHECK constraints
through this package's own forward migration - never by editing an earlier
package's accepted migration file. The audit metadata carries a compound-operation
summary only (counts and identifiers): it deliberately never carries `statement`
or `statement_fingerprint`, so a reviewer of the audit trail can prove an
extraction happened and how many facts it produced, without the audit row itself
ever reconstructing which specific fields or values were found.

## Owner decision on the migration/rollback filenames

`migrations/kai_sprint2_p2_01_evidence_lineage.sql` and its `.rollback.sql`,
following the exact `kai_sprint2_p1_0N_<topic>` naming idiom already established
by every prior package in this sprint.

## Owner decision on reapplying P1-08's exact permission predicate

No currently authorized package changes the P1-05 fail-closed columns
(`human_review_required`, `public_use_allowed`, `funder_use_allowed`,
`llm_processing_allowed`, `product_learning_allowed`, `retention_posture`), so
rather than inventing a new permission representation for "permission for internal
evidence processing," this package reapplies, verbatim, the exact predicate
P1-05/P1-06/P1-07/P1-08 already enforce against the same
`kai.intake_sensitivity_profiles` row (VAL-KAI-P1-08-002's predicate, now also
VAL-KAI-P2-01-001's check 9). Evidence extraction never itself changes any
allowed-use posture.

## Added

- `migrations/kai_sprint2_p2_01_evidence_lineage.sql` — forward migration creating
  the canonical `kai.source_locators` and `kai.evidence_items` tables, their
  tenant-safe composite lineage foreign keys, the
  `ux_review_queue_items_p2_01_evidence_review_identity` partial unique index, and
  the new `evidence_lineage_extracted` audit operation/metadata branch on the
  existing `kai.upload_lifecycle_audit`.
- `migrations/kai_sprint2_p2_01_evidence_lineage.rollback.sql` — removes only the
  P2-01 tables, their indexes, the partial unique index added onto
  `kai.review_queue_items`, and the P2-01 audit rows/branch, restoring the exact
  prior audit constraints.
- `scripts/kai-sprint2-p2-01-evidence-lineage-verifier.sql`, `-failure-checks.sql`,
  `-smoke-seed.sql`, `-smoke-verifier.sql` — catalog verification, read-only-
  transaction negative-scope checks (locator_type/coordinates/evidence_type/
  data_class/governance-boolean pinning, fingerprint shape enforcement,
  locator-binding invariant enforcement, composite-FK rejection of fabricated
  lineage, identity-unique enforcement at every level, and the
  evidence_review partial-unique-index enforcement), a smoke seed that advances
  the already-committed P1-07 candidate/review pair through the P1-08 promotion
  this package depends on (since P1-08's own smoke verifier always rolls its own
  promotion simulation back), and smoke verification (creation, replay,
  duplicate-identity rejection, concurrent-insert convergence, cross-tenant
  invisibility, and transaction+audit atomicity).
- `scripts/kai-sprint2-p2-01-evidence-lineage-local-postgres.js` — ephemeral
  loopback PostgreSQL 16 runner (`npm run verify:kai-sprint2-p2-01-evidence-lineage`),
  reusing the P1-08 runner's exact mechanism/conventions.
- `scripts/kai-sprint2-p2-01-evidence-lineage-runner-assertions.js` —
  `assertNoFail`, copying the established P1-02 through P1-08 pattern.
- `scripts/kai-sprint2-p2-01-evidence-lineage-runbook.md` — package runbook.
- `Backend/kai/validators/kaiEvidenceLineageValidators.js` — new pure, no-SQL
  validator module exporting `validateEvidenceHasSourceLineage`.
- `Backend/kai/dictionary/postgresEvidenceLineageRepository.js` — new repository:
  the only authorized location for P2-01 SQL and row locking. Reads the six
  authoritative lineage rows, calls the validator, composes the deterministic
  evidence plan, writes locators/evidence items/review-queue items via
  `ON CONFLICT ... DO NOTHING RETURNING` plus authoritative rereads, and writes the
  required metadata-only `evidence_lineage_extracted` audit row inside the same
  transaction as every insert, on first creation only.
- `Backend/kai/services/kaiEvidenceLineageService.js` — new file exporting
  `extractEvidenceFromSourceVersion`. Validates its input allowlist
  (`organizationId`, `sourceVersionId`, `actorContext`, `now` only), checks both
  `KAI_SPRINT2_ENABLED` and `KAI_EVIDENCE_LINEAGE_ENABLED`, enforces AUTH-KAI-003
  and VAL-TEN-001, then delegates to the injected P2-01 repository. Contains no
  SQL and imports no database pool. Not composed into any route.
- `Backend/kai/db/kaiIntakeQueries.js` (additive) — added
  `getScopedPromotionDecisionBySourceVersionId`, `getScopedSensitivityProfileById`,
  `getScopedDataDictionaryById`, `getScopedDataDictionaryFieldsByDictionaryId`,
  `getScopedEvidenceItemByStatementFingerprint`, `getScopedSourceLocatorByFingerprint`,
  `getScopedEvidenceReviewQueueItemByEvidenceItemId`. No existing exported function
  in this file was modified. `getScopedSensitivityProfileById` reads the same
  columns P1-08's own local `readScopedSensitivityProfile` already reads; the
  P1-08 repository file itself is not modified to consume this new export.
- `Backend/kai/config/kaiSprint2Config.js` (additive originally; removed by the
  P2-01C correction below) — originally added `isKaiEvidenceLineageEnabled`
  (reading `KAI_EVIDENCE_LINEAGE_ENABLED`, default false) and
  `areKaiSprint2EvidenceLineageFeaturesEnabled`. Both are removed by P2-01C;
  P2-01 is now gated by the pre-existing `isKaiSprint2Enabled`/
  `KAI_SPRINT2_ENABLED` alone.
- `__tests__/kai-sprint2-p2-01-evidence-lineage-schema-contract.spec.js`,
  `-boundary.spec.js`, `.integration.spec.js`, `-runner-self-test.spec.js` —
  focused schema, boundary, PostgreSQL-backed integration, and runner-assertion
  tests.

## Changed (additive only)

- `package.json` — added the `verify:kai-sprint2-p2-01-evidence-lineage` script.
- `Backend/kai/db/kaiIntakeQueries.js` — added seven new exported functions (see
  above); every existing exported function's signature and behavior is unchanged.
- `Backend/kai/config/kaiSprint2Config.js` — added two new exported functions (see
  above); every existing exported function's signature and behavior is unchanged.

## Not changed

No Gate A through P1-08 migration, rollback, runner, verifier, smoke, repository,
service, or runbook artifact was edited, other than the additive `ALTER TABLE`
statements this package's own forward migration issues (documented in the
runbook). `Backend/kai/dictionary/postgresSourcePromotionRepository.js` and
`Backend/kai/services/kaiSourcePromotionService.js` and their exports are
unchanged. P1-08 is accepted and closed and was not reopened or modified. No
route, listener, scheduler, timer, startup hook, public barrel export, production
composition, record-ID or redacted-extract locator, graph relationship, claim,
assistant tool, generation logic, cloud configuration, feature-flag default
enablement, or real-client-data handling was added or implemented.
`KAI_SPRINT2_ENABLED` is not enabled by this package; `KAI_EVIDENCE_LINEAGE_ENABLED`
has been removed entirely by the P2-01C correction (see below).

## Behavior summary

Human-authorized, idempotent extraction of one deterministic
`dictionary_field_presence_fact` evidence statement per already-committed
`kai.data_dictionary_fields` row from the CURRENT `kai.source_versions` row of a
fully promoted P1-08 source, gated by `KAI_SPRINT2_ENABLED`, a mapped human actor
(`gk_admin`/`gk_operator`/`gk_reviewer`) with active organization membership, and
VAL-KAI-P2-01-001's nine-check fixed-order lineage/permission predicate. The
caller supplies only `organizationId`, `sourceVersionId`, `actorContext`, and
`now`; every evidence statement and coordinate is server-derived from a fresh
authoritative re-read, never trusted from the caller and never fabricated from raw
file content or a sample value. Identical replay performs zero writes and zero
audit. Any missing/incomplete lineage, stale/non-current source_version,
mismatched cross-row lineage, malformed checksum, unmet permission predicate, or
cross-tenant identity fails closed with `not_found`, `validation_blocker`, or
`conflict_current_state_changed` and zero mutation. Concurrent identical
extraction converges via `INSERT ... ON CONFLICT ... DO NOTHING RETURNING` at
every step, never a raised `23505` catch or an application-level synchronization
primitive. Every write (locators, evidence items, review-queue items) and the
required metadata-only `evidence_lineage_extracted` audit row (exactly ten
allowlisted keys, no raw content, PII, statement text, statement fingerprint,
path, URL, prompt, credential, or storage pointer) happen inside one transaction;
any compare-and-set observing a genuine concurrent state change, a rejected
required-audit prepare, a synchronous publish failure, a rejected publish
promise, or a malformed inserted row rolls back all of it together.

## P2-01 CORRECTION (verification pass)

Four defects were found and fixed while running the PostgreSQL-backed integration
suite and the full repository test suite, before this package's evidence was
recorded as verified:

- **`beforeInsert()` ordering deadlock**: the repository originally called the
  test-only rendezvous seam after the authoritative reads, including the `FOR
  UPDATE`-locked read of the candidate row (`getScopedSourceCandidateByIdentity`).
  That lock is the real serialization point for two genuinely concurrent calls on
  the same identity, so the losing transaction blocked on it before ever reaching
  the seam - the two-overlapping-calls concurrency test could never observe both
  calls having arrived, and hung indefinitely. Fixed by moving `await
  beforeInsert()` to the very first line inside the transaction, before any read
  or lock, matching the exact P1-08 precedent this package was already supposed to
  mirror.
- **`ON CONFLICT` target mismatch on a partial index**: the review-queue-item
  insert used `ON CONFLICT (organization_id, queue_type, target_object_type,
  target_object_id) DO NOTHING` against `ux_review_queue_items_p2_01_evidence_review_identity`,
  which is a *partial* unique index (`WHERE queue_type = 'evidence_review'`).
  PostgreSQL's arbiter-index inference requires the INSERT's `ON CONFLICT` clause
  to carry the identical `WHERE` predicate to match a partial index; without it,
  every insert failed with "no unique or exclusion constraint matching the ON
  CONFLICT specification." Fixed by adding `WHERE queue_type = 'evidence_review'`
  to the `ON CONFLICT` clause, matching the exact syntax
  `Backend/kai/dictionary/postgresSourceCandidateRepository.js` already uses for
  its own partial-index target.
- **Fixture-identity collisions in the integration spec**: the integration spec's
  own `dictionaryId(index)` helper generated `61000000-...-0002` for index 2,
  which collides with the `dictionary2` fixture id already committed (via
  `COMMIT`, not rolled back) by the chained P1-05/P1-06/P1-07/P1-08 smoke-seed
  scripts that run ahead of this suite in the package's own local-postgres runner;
  and its `checksumFor(index)` helper produced identical checksums for indices
  differing by exactly 10 (e.g. 1 and 11), colliding on `kai.sources`'
  `(organization_id, source_code)` uniqueness. Fixed by moving to an unused
  `62000000-...` id prefix and an injective hex-based checksum generator.
- **Two doc-comments broke a repository-wide invariant test**: two new
  `Backend/kai/db/kaiIntakeQueries.js` doc-comments referenced the literal phrase
  "ON CONFLICT" in prose (describing the *repository's* pattern, not this file's
  own SQL), which tripped `kai-sprint2-file-idempotency-conflict.spec.js`'s
  repository-wide assertion that `kaiIntakeQueries.js` never contains
  `ON CONFLICT`/`23505`/`unique_violation`/`kaiIdempotentWriteConflict` anywhere
  (that file is architecturally reserved for plain reads/writes only - idempotent-
  conflict SQL belongs in package-specific repository files). Fixed by rewording
  both comments to avoid the literal phrase while preserving their meaning.

All four fixes were verified by rerunning the full focused P2-01 suite, the
package's own PostgreSQL-backed `local-postgres.js` runner end-to-end, the P1-08
verifier, the complete Sprint 2 suite, and the complete repository suite - all
green - before this package's evidence was recorded.

## P2-01C CORRECTION (evidence contract and PostgreSQL isolation)

A bounded correction applied on top of the accepted P2-01 package, addressing
defects found in the evidence contract and the integration suite's database
isolation:

- **Removed the unlocated aggregate evidence item.** The
  `dictionary_field_count_fact` evidence type (one aggregate item per extraction,
  with no `source_locator_id`) is removed entirely. `evidence_type` is now pinned
  to the single value `dictionary_field_presence_fact`; `source_locator_id` is now
  a `NOT NULL` column, and the conditional `evidence_items_p2_01_locator_binding_check`
  is removed as unnecessary.
- **Added `source_id`, `sensitivity_level`, and `support_strength` to
  `kai.evidence_items`.** `source_id` is `NOT NULL`. `sensitivity_level` copies
  the authoritative `kai.data_dictionary_fields.sensitivity` value verbatim
  (pinned to that column's own existing single vocabulary value, `'unknown'`).
  `support_strength` is pinned to `'unassessed'`.
- **Enforced organization_id + source_id + source_version_id as one tenant-safe
  lineage tuple.** A new `source_versions_p2_01_id_source_org_unique` constraint
  is added to the existing P1-08 `kai.source_versions` table; `evidence_items_p2_01_source_version_fk`
  is widened from a two-column `(source_version_id, organization_id)` foreign key
  to the three-column `(source_version_id, source_id, organization_id)` composite,
  proving the stored source_version actually belongs to the stored source and
  organization - independent single- or two-column foreign keys could not prove
  this by themselves.
- **Added a fixed `required_action` to every evidence-review queue item** ("Review
  the evidence item's lineage, sensitivity, support strength, and audience
  eligibility before use."), and a new
  `review_queue_items_p2_01_evidence_review_required_action_check` CHECK
  constraint requiring `required_action` to be present, non-blank, and within the
  existing 1-2000 character bound, for `queue_type = 'evidence_review'` rows only -
  mirroring the exact P1-06 `sensitivity_review` precedent. No other `queue_type`
  is affected.
- **Removed `KAI_EVIDENCE_LINEAGE_ENABLED`** and its
  `isKaiEvidenceLineageEnabled`/`areKaiSprint2EvidenceLineageFeaturesEnabled`
  helpers from `Backend/kai/config/kaiSprint2Config.js`, along with every test and
  doc reference to it. P2-01 is now gated by `KAI_SPRINT2_ENABLED` alone and
  remains dormant because it has no route, worker, listener, or production
  composition.
- **PostgreSQL isolation.** `Backend/kai/dictionary/postgresEvidenceLineageRepository.js`
  no longer statically imports `Backend/kai/db/kaiDb.js` at module load - its
  default transaction runner is now a deferred `await import(...)`, reached only
  when a caller does not inject its own `runInTransaction`. The integration spec
  now validates `KAI_P2_01_EVIDENCE_LINEAGE_DATABASE_URL` as loopback-only
  synchronously before any dynamic import, never imports `kaiDb.js`, and runs
  every repository call through a test-local `withTestTransaction` wrapper over
  its own runner-owned `Pool` - never through `kaiDb.js`'s ambient pool. Ambient
  `DATABASE_URL` is therefore never read by this suite; a non-loopback runner URL
  is rejected before any connection attempt; and direct execution without the
  runner-owned URL performs zero database activity.

Verified by rerunning the full focused P2-01 suite (schema-contract, boundary,
integration, runner-self-test), the package's own PostgreSQL-backed
`local-postgres.js` runner end-to-end, the P1-08 verifier, the complete Sprint 2
suite, and the complete repository suite - all green - before this correction's
evidence was recorded.
