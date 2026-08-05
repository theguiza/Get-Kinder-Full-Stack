# KAI P1-08 Source-Promotion Decision, Source, and Source-Version Creation Runbook

This package creates three canonical, previously-untracked tables -
`kai.intake_promotion_decisions`, `kai.sources`, and `kai.source_versions` - and one
narrow, human-authorized, idempotent path - `createSourcePromotionDecision` - that
atomically decides and promotes one complete, immutable P1-07 candidate/review pair
into a deterministic source and its current source_version. It changes no P1-02
through P1-07 or Gate A migration, rollback, runner, verifier, smoke, repository,
service, or runbook artifact, other than the additive `ALTER TABLE` statements this
package's own forward migration issues against `kai.intake_source_candidates`,
`kai.review_queue_items`, and `kai.upload_lifecycle_audit` (see "Additive schema
changes to earlier tables" below), and the additive `getScoped*` query functions added
to `Backend/kai/db/kaiIntakeQueries.js`.

Run:

```sh
npm run verify:kai-sprint2-p1-08-source-promotion
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_p1_08_source_promotion_synthetic`;
- applies the existing synthetic bootstrap schema and the existing frozen Gate A
  through P1-07 migrations, all unmodified, then the new P1-08 forward migration;
- runs the P1-08 catalog verifier and read-only failure checks, then the existing
  Gate A through P1-07 smoke seeds followed by the new P1-08 smoke seed (which seeds
  two complete candidate/review pairs, since no earlier package's smoke seed inserts
  an actual `kai.intake_source_candidates` row) and smoke verifier;
- runs `__tests__/kai-sprint2-p1-08-source-promotion.integration.spec.js` against that
  runner-owned target only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback address,
port, `listen_addresses`, and PostgreSQL 16 version. It must not be pointed at a
shared, quarantined, cloud, production, or real-client-data database. The integration
spec skips itself unless `KAI_P1_08_SOURCE_PROMOTION_DATABASE_URL` is set by that
runner.

The runner also fails closed on any real `FAIL` status cell returned by the catalog
verifier, read-only failure checks, or smoke verifier (`assertNoFail`,
`scripts/kai-sprint2-p1-08-source-promotion-runner-assertions.js`), copying the
established P1-07 `assertNoFail` pattern.
`__tests__/kai-sprint2-p1-08-source-promotion-runner-self-test.spec.js` proves this
deterministically.

The non-database schema-contract and boundary specs
(`__tests__/kai-sprint2-p1-08-source-promotion-schema-contract.spec.js`,
`__tests__/kai-sprint2-p1-08-source-promotion-boundary.spec.js`) run in the normal
suites and need no database.

## Scope

`Backend/kai/dictionary/postgresSourcePromotionRepository.js` is the only authorized
location for this package's SQL and row locking, other than the reused `getScoped*`
lookups added to `Backend/kai/db/kaiIntakeQueries.js`
(`getScopedSourceCandidateByIdentity`, `getScopedSourcePromotionDecisionByIdentity`,
`getScopedSourceByCode`, `getScopedSourceById`,
`getScopedSourceVersionByCandidateIdentity`, `getScopedSourceVersionById`).
`createSourcePromotionDecision` (`Backend/kai/services/kaiSourcePromotionService.js`)
contains no SQL and imports no database pool: it validates its input allowlist,
checks **both** `KAI_SPRINT2_ENABLED` and `KAI_SOURCE_PROMOTION_ENABLED` before any
repository read, lock, validator side effect, or audit activity, enforces AUTH-KAI-003
(reapplied from P1-06/P1-07: a local, strictly narrower human-actor gate than the
shared assistant-boundary allowlist), and then delegates tenant-membership and role
authorization to the existing shared validator-group mechanisms
(`validateActorCanPerformOperation`, `validateTenantBoundaryConsistency`). It is not
composed into any route, listener, scheduler, or production path, and neither feature
flag is enabled by this package (`KAI_SOURCE_PROMOTION_ENABLED` is added to
`Backend/kai/config/kaiSprint2Config.js` with default false).

**AUTH-KAI-003** (human-actor authorization): `actorContext.actorType` must be exactly
`"human"` with a non-empty `actorUserId`. Every non-human actor type is rejected with
`authorization_denied`. There is no bypass. A resolved review item is never itself
promotion authority: promotion requires this human-actor gate, the shared
tenant-membership/role check, and every repository validator below, all to pass.

**VAL-TEN-001** (tenant membership): the actor must hold an active
(`membership_status = "active"`) membership in the requested `organizationId` with
`role_name` in `gk_admin`, `gk_operator`, or `gk_reviewer`.

**VAL-KAI-P1-08-001** (candidate/review completeness and status predicate): the
candidate must still be at `candidate_status = 'needs_gk_review'`, and its matching
`source_candidate_review` / `intake_source_candidate` review item must still be
`queue_status = 'open'`. Both P1-07-established facts, re-read fresh, not trusted from
the caller.

**VAL-KAI-P1-08-002** (governance/allowed-use/consent permission predicate): this
package reapplies, verbatim, the exact fail-closed predicate P1-05/P1-06/P1-07 already
enforce against the same freshly re-read `kai.intake_sensitivity_profiles` row
(`human_review_required = true`, `public_use_allowed = funder_use_allowed =
llm_processing_allowed = product_learning_allowed = false`, `retention_posture =
'restricted_pending_review'`), rather than inventing a new permission representation.
No currently authorized package changes these columns.

**VAL-KAI-P1-08-003** (explicit reviewed-source-type predicate): `reviewedSourceType`
must be exactly one of `organization_primary_record`, `organization_secondary_record`,
`third_party_provided_record`, or `public_record` - a P1-08 owner-disclosed vocabulary,
never `'unknown'`, and never inferred from a filename, MIME type, field name, sample
value, AI output, or external lookup. This is the explicit, human-established
classification the promotion decision itself creates.

Matching file, profile, dictionary, and sensitivity lineage, and committed checksum:
the candidate row's own lineage columns are compared, inside the transaction, against a
fresh re-read of its authoritative P1-05 sensitivity-profile row; any mismatch returns
`conflict_current_state_changed` with zero mutation.

## Decision recording and promotion are one compound, atomic operation

No prior P1-06/P1-07 package records a decision without also completing its associated
write in the same transaction, so this package keeps decision recording and promotion
compounded in one atomic transaction rather than as two separately-atomic operations -
the same compound-boundary idiom P1-07 uses for its candidate insert and review-item
insert. Within that one transaction, `kai.intake_promotion_decisions.decision_status`
is inserted at `'decided'` and then, only after every validator above has passed and
the source/source_version identity has been established, updated to `'promoted'`
(bound to `source_id` and `source_version_id`) via a `decision_status = 'decided'`
compare-and-set. `kai.intake_source_candidates.candidate_status` transitions
`needs_gk_review -> promoted` and `kai.review_queue_items.queue_status` transitions
`open -> resolved` (with `review_status` also set to `'resolved'`) via their own
compare-and-set updates in the same transaction. Any compare-and-set observing zero
affected rows (a genuine concurrent state change) rolls back every mutation performed
by this call.

## Deterministic source identity and current-version uniqueness

`source_code` (P1-08 owner decision) is a sha256 hex digest computed only from
immutable, already-committed facts:
`organizationId + "|" + intakeSensitivityProfileId + "|" + profileCanonicalSha256 + "|" + reviewedSourceType`.
Never a filename, MIME type, sample value, AI output, or external lookup. Because
`intake_sensitivity_profile_id` is already unique to one P1-07 candidate identity, this
package's `kai.sources`/`kai.source_versions` rows are effectively 1:1 with the
candidate they were promoted from; this package does not implement merging multiple
candidates into one source's version history, and defensively handles the case of an
existing `kai.sources` row for the same computed code (authoritative replay of the
source identity) as well as a losing concurrent insert (re-read and replay, never a
raised `23505`). `ux_source_versions_p1_08_current_per_source` enforces at most one
`is_current = true` `kai.source_versions` row per `source_id`.

## Replay and idempotency identity

The P1-08 idempotency identity is `organization_id` + `intake_source_candidate_id`: the
same identity used for the decision, and (since decision/promotion are compounded) the
same identity used to look up the bound source_version. Same identity with a decision
already `decision_status = 'promoted'` and bound to the same `reviewedSourceType`:
replayed with zero writes and zero audit activity, reading back the bound candidate,
review item, source, and source_version rows. Any other decision state, or any mismatch
against the freshly re-read lineage, returns `conflict_current_state_changed`.
Concurrent identical creation at every step (decision, source, source_version) is
resolved entirely by PostgreSQL's unique constraints via
`INSERT ... ON CONFLICT ... DO NOTHING RETURNING`, never a raised `23505` catch, a
savepoint, an in-process lock, mutex, or advisory lock.

## Required metadata-only audit

Creating the decision, source, source_version, and the candidate/review transitions,
and writing the required metadata-only `source_promotion_decision_persisted` audit row
happen inside one transaction on first creation only. Rejection of the required audit
prepare, a synchronous publish failure, or a rejected publish promise rolls back every
mutation together (own-boolean-data-property audit predicate, copied from
P1-05/P1-06/P1-07's `prepareRequiredAudit`). The audit metadata carries exactly
`metadata_only` (`true`), `contract` (`'p1_source_promotion_decision_v1'`),
`intake_source_candidate_id`, `intake_sensitivity_profile_id`,
`profile_canonical_sha256`, `reviewed_source_type`, `decision_status`,
`candidate_status`, `queue_status`, `source_id`, `source_version_id`, and
`validator_key` (`'VAL-KAI-P1-08-001'`) - twelve keys, no more, no raw content, PII,
path, URL, prompt, credential, signed URL, or unrestricted storage path. `source_id`
and `source_version_id` are opaque server-generated identifiers, never storage
pointers.

When `KAI_SPRINT2_ENABLED` or `KAI_SOURCE_PROMOTION_ENABLED` is disabled, the service
returns the canonical `feature_disabled` result with zero repository reads, locks,
validator side effects, or audit activity.

This package does not add a route, listener, scheduler, timer, polling loop, startup
hook, public barrel export, production composition, feature-flag default enablement,
cloud configuration, source locator, graph relationship, evidence extraction, claim,
assistant tool, generation logic, or real-client-data handling.

## Additive schema changes to earlier tables

Following the accepted P1-07 precedent of widening an earlier package's CHECK-pinned
vocabulary or adding a unique constraint through a later package's forward migration
(never editing the earlier package's accepted migration file):

- `kai.intake_source_candidates.candidate_status` is widened from P1-07's single-value
  pin (`'needs_gk_review'` only) to `IN ('needs_gk_review', 'promoted')`. No other value
  is added.
- Two trivially-unique constraints are added to `kai.intake_source_candidates`
  (`intake_source_candidates_p1_08_identity_unique`,
  `intake_source_candidates_p1_08_promotion_lineage_unique`), needed as the exact
  matching targets of composite foreign keys from the new P1-08 tables.
- One trivially-unique constraint is added to `kai.review_queue_items`
  (`review_queue_items_p1_08_identity_unique`), needed as the exact matching target of
  `intake_promotion_decisions_p1_08_review_queue_item_fk`. `kai.review_queue_items`
  itself already accepted `queue_status`/`review_status` = `'resolved'` in the P1-06
  vocabulary, so no CHECK constraint on that table is widened.
- `kai.upload_lifecycle_audit`'s operation and metadata-object CHECK constraints are
  extended with the new `source_promotion_decision_persisted` branch, preserving every
  earlier branch verbatim.

## Rollback

`migrations/kai_sprint2_p1_08_source_promotion.rollback.sql` removes only the P1-08
audit rows/branch (restoring the exact prior audit constraints), the
`kai.intake_promotion_decisions`, `kai.sources`, and `kai.source_versions` tables with
their indexes, the P1-08-only foreign keys added onto
`kai.intake_promotion_decisions`, the P1-08-only unique constraint on
`kai.review_queue_items`, the P1-08-only unique constraints on
`kai.intake_source_candidates`, and restores `kai.intake_source_candidates`'s
`candidate_status` CHECK to its exact pre-P1-08 single-value pin. It alters no P1-02
through P1-07 or Gate A table, column, or constraint beyond that restoration.

## P1-08 CORRECTION (2026-08-05): three-outcome decision model

The original single-outcome (`'promoted'`-only, with a transient `'decided'`
intermediate `decision_status`) model above is corrected to a three-outcome model.
This section documents the correction; the sections above describe the original
`'promoted'` path, which is unchanged in its own mechanics (deterministic
`source_code`, replay, and concurrency idiom) except that the transient `'decided'`
intermediate value no longer exists - a decision row is now written directly at
whichever of the three outcomes below was requested.

**Outcome vocabulary** (`decision_status`, and the service/repository input field
`outcome`): `needs_more_information`, `rejected`, `promoted`.

**Legal transitions** (owner-authorized; every other requested transition returns
`conflict_current_state_changed` with zero mutation, via an authoritative
reread-and-compare-and-set, never a raced blind UPDATE):

- `null -> needs_more_information`
- `null -> rejected`
- `null -> promoted`
- `needs_more_information -> rejected`
- `needs_more_information -> promoted`

`rejected` and `promoted` are terminal except for an identical replay of the same
outcome (same identity, same recorded facts - zero writes, zero audit).
`needs_more_information` is also safely re-requestable as a zero-write, zero-audit
replay while still at `needs_more_information` (its `required_action` is a fixed
literal, so there are no caller-supplied facts that could ever mismatch).

**needs_more_information**: `reviewed_source_type`, `source_id`, `source_version_id`,
`promoted_at` all stay `NULL` on the decision row. No `kai.sources` or
`kai.source_versions` row is created. `kai.intake_source_candidates.candidate_status`
is untouched (stays `needs_gk_review`).
`kai.review_queue_items.queue_status` transitions `open -> waiting_on_client` (an
already-accepted P1-06 vocabulary value, not new) and `required_action` is set to the
exact fixed literal `"Obtain the missing client information before reconsidering
source promotion."` (`kai.review_queue_items.required_action` already existed as a
nullable P1-06 column; no schema addition was needed for it).

**rejected**: `reviewed_source_type`, `source_id`, `source_version_id`, `promoted_at`
all stay `NULL`. No `kai.sources`/`kai.source_versions` row is created.
`candidate_status` transitions to the new terminal value `'rejected'` (from either
`needs_gk_review` directly, or from `needs_gk_review` after a
`needs_more_information` detour - `candidate_status` never moves for
`needs_more_information` itself). `queue_status`/`review_status` transition to
`'resolved'` (from `'open'` for a direct decision, or from `'waiting_on_client'` for a
`needs_more_information -> rejected` follow-up).

**promoted**: unchanged mechanics (requires the same explicit non-`'unknown'`
`reviewedSourceType`, the same deterministic `source_code`, the same
creation-or-authoritative-replay path for `kai.sources`/`kai.source_versions`).
Reachable either directly (`null -> promoted`) or as a `needs_more_information ->
promoted` follow-up.

**Schema changes made by this correction** (all within this package's own
`migrations/kai_sprint2_p1_08_source_promotion.sql` - no P1-06/P1-07 migration file
was edited):

- `kai.intake_promotion_decisions.reviewed_source_type` changed from `NOT NULL` to
  nullable; its CHECK constraint (`intake_promotion_decisions_p1_08_reviewed_source_type_check`)
  now reads `reviewed_source_type IS NULL OR reviewed_source_type IN (...)`.
- `kai.intake_promotion_decisions.decision_status` dropped its `DEFAULT 'decided'`
  (no default; every write states its outcome explicitly), and its CHECK constraint
  (`intake_promotion_decisions_p1_08_decision_status_check`) now reads
  `decision_status IN ('needs_more_information', 'rejected', 'promoted')`.
- `intake_promotion_decisions_p1_08_promoted_binding_check` now requires
  `reviewed_source_type`/`source_id`/`source_version_id`/`promoted_at` all `NULL` for
  `needs_more_information`/`rejected`, and all `NOT NULL` for `promoted` (previously
  this only distinguished `'decided'` from `'promoted'` and did not gate
  `reviewed_source_type`).
- `kai.intake_source_candidates.candidate_status`'s CHECK
  (`intake_source_candidates_p1_07_candidate_status_check`) is widened again, from
  `IN ('needs_gk_review', 'promoted')` to `IN ('needs_gk_review', 'promoted',
  'rejected')`.
- No column or CHECK constraint was added to `kai.review_queue_items`:
  `'waiting_on_client'` was already an accepted `queue_status` value in the P1-06
  migration, and `required_action` already existed as a nullable P1-06 column.
- The `migrations/kai_sprint2_p1_08_source_promotion.rollback.sql` rollback continues
  to drop the three P1-08 tables outright and restore `candidate_status` to its exact
  pre-P1-08 single-value pin (`'needs_gk_review'` only), so it reverses this
  correction along with the rest of the package with no further changes needed.
