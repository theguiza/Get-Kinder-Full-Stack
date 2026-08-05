# KAI P1-07 Intake Source-Candidate Foundation and Review-Item Creation Runbook

This package creates the canonical, previously-untracked `kai.intake_source_candidates`
table and one narrow, idempotent creation path — `createSourceCandidateStub` — that
atomically creates one metadata-only source-candidate stub and its corresponding
`source_candidate_review` item on the existing `kai.review_queue_items` table, for a
single existing, predicate-satisfying P1-05 `kai.intake_sensitivity_profiles` row. It
changes no P1-02, P1-03, P1-04, P1-05, P1-06, or Gate A migration, rollback, runner,
verifier, smoke, repository, service, or runbook artifact.

Run:

```sh
npm run verify:kai-sprint2-p1-07-source-candidate
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_p1_07_source_candidate_synthetic`;
- applies the existing synthetic bootstrap schema and the existing frozen Gate A P0
  upload-lifecycle, Gate A P0 policy-decision-replay, P1-02 parser-run/file-profile,
  P1-04 data-dictionary/quality, P1-05 intake-sensitivity-profile, and P1-06
  review-queue migrations, all unmodified, then the new P1-07 forward migration;
- runs the P1-07 catalog verifier and read-only failure checks, then the existing
  Gate A, P1-04, P1-05, and P1-06 smoke seeds followed by the new (fixture-free) P1-07
  smoke seed and smoke verifier;
- runs `__tests__/kai-sprint2-p1-07-source-candidate.integration.spec.js` against that
  runner-owned target only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback address,
port, `listen_addresses`, and PostgreSQL 16 version. It must not be pointed at a
shared, quarantined, cloud, production, or real-client-data database. The integration
spec skips itself unless `KAI_P1_07_SOURCE_CANDIDATE_DATABASE_URL` is set by that
runner.

The runner also fails closed on any real `FAIL` status cell returned by the catalog
verifier, read-only failure checks, or smoke verifier (`assertNoFail`,
`scripts/kai-sprint2-p1-07-source-candidate-runner-assertions.js`), copying the
established P1-02/P1-05/P1-06 `assertNoFail` pattern: a check name merely containing
the substring `FAIL_CLOSED` never trips it.
`__tests__/kai-sprint2-p1-07-source-candidate-runner-self-test.spec.js` proves this
deterministically.

The non-database schema-contract and boundary specs
(`__tests__/kai-sprint2-p1-07-source-candidate-schema-contract.spec.js`,
`__tests__/kai-sprint2-p1-07-source-candidate-boundary.spec.js`) run in the normal
suites and need no database.

## Scope

`Backend/kai/dictionary/postgresSourceCandidateRepository.js` is the only authorized
location for this package's SQL and row locking, other than the reused
`getScopedSourceCandidateReviewQueueItemByIdentity` seam added to
`Backend/kai/db/kaiIntakeQueries.js`. Both idempotent
`INSERT ... ON CONFLICT ... DO NOTHING RETURNING` statements (candidate and review
item) live in the repository itself, matching the P1-06 precedent of keeping ON
CONFLICT/unique-violation patterns out of the shared query module.
`createSourceCandidateStub` (`Backend/kai/services/kaiSourceCandidateService.js`)
contains no SQL and imports no database pool: it validates its input allowlist, checks
`KAI_SPRINT2_ENABLED`, enforces AUTH-KAI-003 (reapplied from P1-06: a local, strictly
narrower human-actor gate than the shared assistant-boundary allowlist) and then
delegates tenant-membership and role authorization to the existing shared
validator-group mechanisms (`validateActorCanPerformOperation`,
`validateTenantBoundaryConsistency`), preserving their structured blockers rather than
reimplementing membership/role logic locally. It is not composed into any route,
listener, scheduler, or production path.

**AUTH-KAI-003** (human-actor authorization): `actorContext.actorType` must be exactly
`"human"` with a non-empty `actorUserId`. Every non-human actor type — `ai`, `system`,
`import`, `code`, or any other generic-service actor — is rejected with
`authorization_denied`. There is no bypass.

**VAL-TEN-001** (tenant membership): the actor must hold an active
(`membership_status = "active"`) membership in the requested `organizationId` with
`role_name` in `gk_admin`, `gk_operator`, or `gk_reviewer`. No tenant-membership
bypass.

**VAL-KAI-P1-07-001** (creation-trigger predicate; a P1-07 implementation decision, not
an owner-quoted key): a source-candidate stub may only be created when the
tenant-scoped, freshly re-read `kai.intake_sensitivity_profiles` row has
`human_review_required = true` and `public_use_allowed = funder_use_allowed =
llm_processing_allowed = product_learning_allowed = false` and `retention_posture =
'restricted_pending_review'` — the identical predicate P1-06 already enforces against
the same P1-05 row. Because every one of those columns is itself pinned by a P1-05
CHECK constraint with no exception, every row that can actually be inserted into
`kai.intake_sensitivity_profiles` today already satisfies this predicate; a
predicate-failure result is only reachable defensively (via a fake transaction context
in the boundary test).

Identity and replay (owner decision for P1-07): one candidate per `organization_id` +
`intake_sensitivity_profile_id`, enforced by
`intake_source_candidates_p1_07_identity_unique`. One `source_candidate_review` /
`intake_source_candidate` review item per candidate, enforced by the partial unique
index `ux_review_queue_items_p1_07_source_candidate_review_identity` (scoped to
`queue_type = 'source_candidate_review'` only). The repository does an authoritative
existing-row lookup — candidate first, then review item — before ever inserting
either; a fully existing pair is replayed with no duplicate insert and no duplicate
audit. A *partial* replay (a candidate already exists but its review item does not —
reachable only if an earlier attempt's transaction failed after the candidate commit,
which cannot happen inside this package's own one-transaction design, but is defended
against as a repository-level invariant) creates only the missing review item and
still writes no candidate audit. Concurrent identical creation is resolved entirely by
PostgreSQL's unique constraints via `INSERT ... ON CONFLICT ... DO NOTHING
RETURNING`: the losing transaction observes zero returned rows — never a raised
`23505` that would abort its transaction before it could re-read — then re-reads and
replays the authoritative committed row, inside the same transaction, never by a
savepoint, in-process lock, mutex, in-flight map, or advisory lock. Replay validates
only tenant scope and the immutable creation identity, never a later-authorized
mutable field (this package implements no such workflow). A newly inserted row is
fully validated against every server-pinned field before the next step; a malformed
inserted result returns `system_error` and rolls back the transaction.

The caller supplies only `organizationId`, `intakeSensitivityProfileId`,
`actorContext`, and `now`. Every lineage field (`intakeFileId`, `fileProfileId`,
`dataDictionaryId`, `profileCanonicalSha256`), `proposedSourceType` (`'unknown'`),
`candidateStatus` (`'needs_gk_review'`), the review item's `queueType`
(`'source_candidate_review'`), `targetObjectType` (`'intake_source_candidate'`),
`targetObjectId` (the freshly created candidate id), `queueStatus` (`'open'`),
`summary`, `requiredAction`, and `queueMetadata.p0_stub` (`true`) are all server-pinned
constants or server-derived; the caller cannot provide or override any of them, nor
any classification, review-result, or promotion fact.

Creating the candidate, its review item, and writing the required metadata-only
`intake_source_candidate_persisted` audit row happen inside one transaction on first
creation only. Rejection of the required audit prepare, a synchronous publish failure,
or a rejected publish promise rolls back the candidate and review-item inserts
together (own-boolean-data-property audit predicate, copied from
P1-05/P1-06's `prepareRequiredAudit`). The audit metadata carries exactly
`metadata_only` (`true`), `contract` (`'p1_intake_source_candidate_v1'`),
`intake_sensitivity_profile_id`, `profile_canonical_sha256`, `proposed_source_type`,
`candidate_status`, `queue_type`, `target_object_type`, `target_object_id`,
`queue_status`, and `validator_key` (`'VAL-KAI-P1-07-001'`) — and no candidate
description text, review-item summary/required-action text, profile content,
classification, label, sample, PII, path, URL, prompt, or credential.

The review item's `required_action` states, in full: human review is required; this
is a review-only source-candidate stub; source promotion is not authorized; no source
or source_version has been created.

When `KAI_SPRINT2_ENABLED` is disabled, the service returns the canonical
`feature_disabled` result with zero profile reads, membership checks, writes, locks,
audit preparation, or publication.

This package does not add a route, listener, scheduler, timer, polling loop, startup
hook, public barrel export, production composition, application repository selection,
feature-flag default, or cloud configuration. Candidate review resolution/rejection,
`intake_promotion_decisions`, source or source_version creation, source codes/locators,
evidence extraction, claims, approval/eligibility changes, and any public/funder/LLM
gate opening are out of scope and are not implemented.

## No table-wide FK on the shared review-queue target column

`kai.review_queue_items.target_object_id` is shared by many queue_types pointing at
different target tables (unchanged from the P1-06 precedent), so this package adds no
table-wide `FOREIGN KEY` on that column for its own `source_candidate_review` rows
either. Unlike that shared column, however, `kai.intake_source_candidates` itself
carries a real composite foreign key on `intake_sensitivity_profile_id` (see the
migration), because that table is owned entirely by this package and is not
polymorphic.

## Rollback

`migrations/kai_sprint2_p1_07_intake_source_candidate.rollback.sql` removes only the
P1-07 audit rows/branch (restoring the exact prior audit constraints), the
`kai.intake_source_candidates` table with its indexes, the P1-07-only partial unique
index on `kai.review_queue_items`, and the P1-07-only candidate-lineage unique
constraint on `kai.intake_sensitivity_profiles`. It alters no P1-02 through P1-06 or
Gate A table, column, or constraint beyond that restoration.
