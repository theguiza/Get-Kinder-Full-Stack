# KAI P1-07 Patch Notes — Intake Source-Candidate Foundation and Review-Item Creation

## Owner decision on scope

Research before implementation confirmed `kai.intake_source_candidates` does not exist
anywhere in `migrations/` and `createSourceCandidateStub` does not exist anywhere in
the repository; both are introduced fresh by this package. The `source_candidate_review`
queue_type was already reserved in `kai.review_queue_items`'s CHECK vocabulary by the
accepted P1-06 migration and in `Backend/kai/config/kaiSprint2P0Contract.js`, so this
package reuses that existing vocabulary value rather than adding a new one, and does
not edit the accepted P1-06 migration to do so.

## Owner decision on identity and lineage

`kai.intake_sensitivity_profiles` carries a unique constraint on
`(organization_id, file_profile_id, data_dictionary_id)` but none spanning its own
primary key together with that tuple, so a composite foreign key from
`kai.intake_source_candidates` tying `intake_sensitivity_profile_id` to the *same
row's* tenant/lineage tuple required a new unique constraint. This package adds
`intake_sensitivity_profiles_p1_07_candidate_lineage_unique` through its own forward
migration — following the accepted P1-06 precedent of extending an earlier package's
table from a later package's migration — rather than editing the accepted P1-05
migration file.

The P1-07 idempotency identity is `organization_id` + `intake_sensitivity_profile_id`:
the narrowest immutable identity that represents one logical candidate per committed
P1-05 profile, matching the 1:1 relationship already enforced by P1-05's own
`(organization_id, file_profile_id, data_dictionary_id)` uniqueness. No currently
authorized producer contract emits a finer-grained candidate-source classification
that would justify a narrower identity.

## Owner decision on proposed_source_type

Fresh inspection found no currently authorized producer contract that emits an
explicit source-type classification. `proposed_source_type` is therefore pinned to the
existing repository-authorized `'unknown'` representation (the same `'unknown'` idiom
P1-05 established) rather than fabricated to satisfy a non-null column, exactly
mirroring how P1-05 pinned its own fail-closed columns for the same reason.

## Owner decision on validator_key

`VAL-KAI-P1-07-001` is a P1-07 implementation decision — the smallest
convention-consistent validator key for this package's creation-trigger predicate and
required audit — matching the naming idiom P1-05 itself used
(`VAL-KAI-P1-05-001`, `scripts/kai-sprint2-p1-05-intake-sensitivity-profile-smoke-seed.sql`).
It is not quoted from, and is not claimed to be mandated by, any owner-authorized
governing source, unlike P1-06's reused `VAL-FUP-001-P0`.

## Added

- `migrations/kai_sprint2_p1_07_intake_source_candidate.sql` — forward migration
  creating the canonical `kai.intake_source_candidates` table (`intake_source_candidate_id`,
  `organization_id`, `intake_file_id`, `file_profile_id`, `data_dictionary_id`,
  `intake_sensitivity_profile_id`, `profile_canonical_sha256`, `proposed_source_type`,
  `candidate_status`, `created_by`, `created_by_type`, `created_at`), tenant-safe
  composite lineage foreign keys chaining file → profile → dictionary → sensitivity
  profile, the new `intake_sensitivity_profiles_p1_07_candidate_lineage_unique`
  constraint, the P1-07 identity-unique constraint, a partial unique index scoping the
  `source_candidate_review` idempotency identity on the existing
  `kai.review_queue_items` table, and the new `intake_source_candidate_persisted`
  audit operation/metadata branch on the existing `kai.upload_lifecycle_audit`. Adds no
  table-wide foreign key on the shared `target_object_id` column.
- `migrations/kai_sprint2_p1_07_intake_source_candidate.rollback.sql` — removes only
  the P1-07 table, its indexes, the P1-07-only review-queue partial unique index, the
  P1-07-only sensitivity-profile lineage-unique constraint, and the P1-07 audit
  rows/branch, restoring the exact prior audit constraints.
- `scripts/kai-sprint2-p1-07-source-candidate-verifier.sql`, `-failure-checks.sql`,
  `-smoke-seed.sql`, `-smoke-verifier.sql` — catalog verification (every check embeds
  PASS/FAIL in its own CASE), read-only-transaction negative-scope checks
  (proposed_source_type/candidate_status pinning, checksum shape, created_by_type
  vocabulary, composite-FK rejection of fabricated/mismatched lineage, identity-unique
  enforcement, and proof that no other queue_type is affected by the new partial
  unique index), a fixture-free synthetic smoke seed (documenting reuse of the
  existing predicate-satisfying P1-05 sensitivity profiles already committed by the
  Gate A/P1-04/P1-05/P1-06 smoke-seed chain), and smoke verification (creation, replay,
  idempotency-key convergence, concurrent-insert convergence, cross-tenant
  invisibility, composite-FK enforcement, and transaction+audit atomicity).
- `scripts/kai-sprint2-p1-07-source-candidate-local-postgres.js` — ephemeral loopback
  PostgreSQL 16 runner (`npm run verify:kai-sprint2-p1-07-source-candidate`), reusing
  the P1-06 runner's exact mechanism/conventions.
- `scripts/kai-sprint2-p1-07-source-candidate-runner-assertions.js` — `assertNoFail`,
  copying the established P1-02/P1-05/P1-06 pattern.
- `scripts/kai-sprint2-p1-07-source-candidate-runbook.md` — package runbook.
- `Backend/kai/dictionary/postgresSourceCandidateRepository.js` — new repository: the
  only authorized location for P1-07 SQL and row locking. Reads exactly the P1-05
  `kai.intake_sensitivity_profiles` lineage/predicate columns needed, applies the
  VAL-KAI-P1-07-001 predicate, does authoritative existing-row lookups (candidate,
  then review item) before ever inserting either, and writes the required
  metadata-only `intake_source_candidate_persisted` audit row inside the same
  transaction as both inserts on first creation only (own-boolean-data-property audit
  predicate, copied from P1-05/P1-06's `prepareRequiredAudit`).
- `Backend/kai/db/kaiIntakeQueries.js` (additive) — added
  `getScopedSourceCandidateReviewQueueItemByIdentity`, a narrow, tenant-scoped,
  `FOR UPDATE` lookup scoped to `queue_type = 'source_candidate_review'` /
  `target_object_type = 'intake_source_candidate'` only. No existing exported function
  in this file was modified.
- `Backend/kai/services/kaiSourceCandidateService.js` — new file exporting
  `createSourceCandidateStub`. Validates its input allowlist (`organizationId`,
  `intakeSensitivityProfileId`, `actorContext`, `now` only), checks
  `KAI_SPRINT2_ENABLED`, enforces AUTH-KAI-003 (reapplied from P1-06) and VAL-TEN-001,
  then delegates to the injected P1-07 repository. Contains no SQL and imports no
  database pool. Not composed into any route.
- `__tests__/kai-sprint2-p1-07-source-candidate-schema-contract.spec.js`,
  `-boundary.spec.js`, `.integration.spec.js`, `-runner-self-test.spec.js` — focused
  schema, boundary, PostgreSQL-backed integration, and runner-assertion tests.

## Changed (additive only)

- `package.json` — added the `verify:kai-sprint2-p1-07-source-candidate` script.
- `Backend/kai/db/kaiIntakeQueries.js` — added one new exported function (see above);
  every existing exported function's signature and behavior is unchanged.

## Not changed

No P1-02 through P1-06 or Gate A migration, rollback, runner, verifier, smoke,
repository, service, or runbook artifact was edited. `Backend/kai/services/
kaiReviewQueueService.js` and its exports are unchanged. No route, listener,
scheduler, timer, startup hook, public barrel export, production composition,
feature-flag default, or cloud configuration was added. No candidate review
resolution/rejection, `intake_promotion_decisions`, source or source_version creation,
source codes/locators, evidence extraction, claims, approval/eligibility change, or
public/funder/LLM gate opening was implemented.

## Behavior summary

Idempotent creation of exactly one metadata-only `kai.intake_source_candidates` row per
`organization_id` + `intake_sensitivity_profile_id`, plus its exactly-one
`source_candidate_review` / `intake_source_candidate` `kai.review_queue_items` row,
gated by `KAI_SPRINT2_ENABLED`, a mapped human actor (`gk_admin`/`gk_operator`/
`gk_reviewer`) with active organization membership, and the VAL-KAI-P1-07-001
predicate (identical in substance to P1-06's VAL-FUP-001-P0, re-checked against the
same P1-05 row). The caller supplies only `organizationId`,
`intakeSensitivityProfileId`, `actorContext`, and `now`; every other field is
server-pinned or server-derived, including `proposed_source_type` (`'unknown'` —
pinned because no producer contract for an explicit classification currently exists)
and `candidate_status` (`'needs_gk_review'` — pinned because no promotion/approval
workflow exists yet). Same identity: replay, no duplicate insert, no duplicate audit.
Concurrent identical creation converges via `INSERT ... ON CONFLICT ... DO NOTHING
RETURNING` against dedicated unique constraints/indexes plus an authoritative re-read
of the losing side, never a raised `23505` re-read inside an aborted transaction, a
savepoint, an in-process lock, mutex, or advisory lock. The candidate insert, the
review-item insert, and the required metadata-only `intake_source_candidate_persisted`
audit row (exactly eleven allowlisted keys, no other keys, no raw content) happen
inside one transaction on first creation only; rejection of the required audit
prepare, a synchronous publish failure, a rejected publish promise, or a malformed
inserted row rolls back all of it together. The review item's `required_action`
states plainly that human review is required, this is a review-only stub, source
promotion is not authorized, and no source or source_version has been created.
