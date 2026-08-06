# KAI P2-04 Patch Notes — Deterministic Claim-Gap/Client-Followup Foundation

## Owner decision on scope and boundary

Research before implementation confirmed `kai.gap_log_items`,
`kai.client_followup_items`, and `generateClaimGapFollowups` do not exist
anywhere in the repository; all are introduced fresh by this package. P2-04 is
the closest structural analog of P2-03 (persistence + queue item + repository
with idempotent writes + audit), so its migration, repository, service, and
validator files copy P2-03's structural conventions. Unlike P2-03 (one row per
claim), P2-04 generates a *set* of rows per claim (up to ten gaps, up to four
follow-ups, up to four queue items) - the write/replay logic is P2-03's
single-row idempotency pattern generalized to a whole expected set, with a
synchronous precheck read deciding fresh-write vs. replay vs. conflict before
any insert is attempted, rather than P2-03's per-row insert-then-reread
pattern. This is a deliberate, disclosed deviation from copying P2-03
verbatim, required by the task's own "compute the complete deterministic
expected set... before writing" instruction and its explicit prohibition on
repairing a partial set.

## Owner decision on reusing rather than forking P2-02

The task explicitly forbids copying, forking, renaming, or independently
reimplementing P2-02's ten dimensions or assessment-result vocabulary, and
forbids calling a P2-02 seam that opens a separate transaction. This package
therefore imports the ten dimension-assessment functions directly from
`Backend/kai/validators/kaiEvidenceCoverageAssessmentValidators.js` (pure
functions, no SQL) and reuses three of P2-02's own read helpers
(`readSensitivityProfileForAssessment`, `readDataDictionaryFieldsForAssessment`,
`readDataQualityFindingsForAssessment`, `readEvidenceCoverageFieldKeys`) via
`postgresEvidenceCoverageAssessmentRepository.js`'s own exported
`__evidenceCoverageAssessmentRepositoryTestables` - each is a plain
`(params, db)` function that takes this package's own transaction client
directly, rather than a function that opens its own transaction. P2-02's own
exported `readEvidenceCoverageAssessmentFacts` (which does open its own
transaction) is never called.

## Owner decision on the atomic-split concurrency mechanism

Because P2-04 writes a *set* of rows rather than one row, per-row `INSERT ...
ON CONFLICT ... DO NOTHING RETURNING` (P2-03's pattern) risks a genuine
concurrent caller winning some rows and losing others, since different unique
keys do not block each other in PostgreSQL. This package instead issues one
multi-row `INSERT ... VALUES (...), (...), ... ON CONFLICT ... DO NOTHING
RETURNING` statement per table. Because both of two genuinely concurrent
identical calls target the exact same full key set, the losing transaction's
statement blocks on the first colliding key until the winning transaction's
whole outer transaction commits, then finds every key already taken and
returns zero rows for that table - a clean all-or-nothing split, never a
partial one. This is disclosed here because it is a real design decision, not
a no-op generalization of the P2-03 pattern; it is exercised directly by a
`beforeInsert`-gated two-way race integration test
(`__tests__/kai-sprint2-p2-04-claim-gap-followup.integration.spec.js`, test
"(c)"), mirroring the exact P2-03 rendezvous-seam mechanism.

## Owner decision on the "all dimensions resolved_clear" test seam

`assessMissingness`/`assessDuplicates` can never return `resolved_clear` from
a real committed `kai.data_quality_findings` row (that table's own
`finding_status` column is CHECK-pinned to the single value `'open'` - a
"resolved" finding row cannot exist - and P2-02's own dimension functions only
ever return `resolved_risk_flagged` when an open finding exists or
`unresolved` when none does); `denominator_clarity`, `time_period_clarity`,
`conflicting_source_indicators`, and `requirement_alignment` are unconditional
`unresolved` by P2-02's own design regardless of seeded state. A real,
committed, all-ten-dimensions-`resolved_clear` source_version is therefore
unreachable in the current schema - through no fault of this package. To still
prove the required "no gaps expected" integration behavior end to end (rather
than only at the pure-function boundary level, which is also covered), the
repository factory accepts an optional `computeDimensions` override (parallel
to P2-01/P2-03's existing `beforeInsert` test seam) that the integration test
uses to inject a synthetic ten-dimension all-`resolved_clear` result over an
otherwise real, fully seeded claim/evidence/lineage chain. Every other
integration test in this suite exercises the real, unmodified P2-02 dimension
functions.

## Owner decision on the client_followup queue contract's constraint scope

P2-03 added only a non-blank `required_action` CHECK for its own queue_type.
This package's task specification instead discloses the *complete* fixed
`client_followup` queue contract (`target_object_type`, `queue_status`,
`review_status`, `priority`, `summary`, `required_action`, `assigned_to`,
`due_at`) as an explicit deliverable. `review_queue_items_p2_04_client_followup_contract_check`
therefore enforces the complete contract at the database level, scoped
strictly to `queue_type = 'client_followup'` rows - no other queue_type's
CHECK-enforced behavior is widened or narrowed.

## Added

- `migrations/kai_sprint2_p2_04_claim_gap_followup.sql` — forward migration
  creating the canonical `kai.gap_log_items` and `kai.client_followup_items`
  tables, their tenant-safe composite lineage foreign keys, the
  `ux_review_queue_items_p2_04_client_followup_identity` partial unique index,
  the `review_queue_items_p2_04_client_followup_contract_check` CHECK, and the
  new `claim_gap_and_followup_generated` audit operation/metadata branch on the
  existing `kai.upload_lifecycle_audit`.
- `migrations/kai_sprint2_p2_04_claim_gap_followup.rollback.sql` — removes only
  the P2-04 tables, their indexes/constraints, the partial unique index and
  CHECK added onto `kai.review_queue_items`, and the P2-04 audit rows/branch,
  restoring the exact prior audit constraints.
- `scripts/kai-sprint2-p2-04-claim-gap-followup-verifier.sql`,
  `-failure-checks.sql`, `-smoke-seed.sql`, `-smoke-verifier.sql` — catalog
  verification, read-only-transaction negative-scope checks (dimension_key/
  assessment_status/validator_key/safe_summary vocabulary and template
  enforcement, negative-count rejection, cross-tenant and fabricated FK
  rejection, identity-unique enforcement at every level, one-follow-up-per-gap
  enforcement, dimension/question pairing enforcement, and the
  client_followup queue contract enforcement), a smoke seed that creates one
  real, committed `kai.claims`/`kai.claim_evidence_links` row against the
  already-promoted P2-01/P2-03 fixture (since P2-03's own smoke verifier
  always rolls its own claim-proposal simulation back), and smoke verification
  (creation of nine gaps/four follow-ups/four queue items/one audit row for
  the seeded mixed-status field, replay-shaped duplicate-identity rejection,
  concurrent-insert convergence, cross-tenant invisibility, and transaction
  atomicity).
- `scripts/kai-sprint2-p2-04-claim-gap-followup-local-postgres.js` — ephemeral
  loopback PostgreSQL 16 runner
  (`npm run verify:kai-sprint2-p2-04-claim-gap-followup`), reusing the
  P2-01/P2-03 runner's exact mechanism/conventions, applying every prior
  migration through `kai_sprint2_p2_03_claim_proposal.sql` (P2-02 added no
  migration) then this package's own.
- `scripts/kai-sprint2-p2-04-claim-gap-followup-runner-assertions.js` —
  `assertNoFail`, copied into this package's own file rather than imported
  cross-package, matching the established per-package-copy convention.
- `scripts/kai-sprint2-p2-04-claim-gap-followup-runbook.md` — package runbook.
- `Backend/kai/validators/kaiClaimGapFollowupValidators.js` — new pure, no-SQL
  validator module exporting `validateClaimGapLineage` (reuses P2-03's
  `validateClaimHasLoadBearingEvidence` and P2-02's
  `validateEvidenceCoverageAssessmentIsPermitted` rather than reimplementing
  either), `validateClientFollowupRouting`, `dimensionResultRequiresGap`, and
  the fixed dimension-key/question-text/queue-contract constants.
- `Backend/kai/dictionary/postgresClaimGapFollowupRepository.js` — new
  repository: the only authorized location for P2-04 SQL. Reads the complete
  claim/evidence/source lineage plus the exact P2-02-authoritative
  profile/dictionary/quality/evidence facts, invokes the ten P2-02 dimension
  functions, computes the complete expected gap/follow-up/queue-item set,
  precheck-reads existing state, and either returns empty/replayed/conflict or
  writes the complete set atomically (multi-row `ON CONFLICT ... DO NOTHING
  RETURNING` per table) plus the required metadata-only
  `claim_gap_and_followup_generated` audit row, all inside one transaction.
- `Backend/kai/services/kaiClaimGapFollowupService.js` — new file exporting
  `generateClaimGapFollowups`. Validates its input allowlist (`organizationId`,
  `claimId`, `actorContext`, `now` only), checks `KAI_SPRINT2_ENABLED`,
  enforces AUTH-KAI-003 and VAL-TEN-001, then delegates to the injected P2-04
  repository. Contains no SQL and imports no database pool. Not composed into
  any route.
- `Backend/kai/db/kaiIntakeQueries.js` (additive) — added
  `getScopedClaimById`. No existing exported function in this file was
  modified.
- `__tests__/kai-sprint2-p2-04-claim-gap-followup-schema-contract.spec.js`,
  `-boundary.spec.js`, `.integration.spec.js`, `-runner-self-test.spec.js` —
  focused schema, boundary, PostgreSQL-backed integration, and runner-assertion
  tests.

## Changed (additive only)

- `package.json` — added the `verify:kai-sprint2-p2-04-claim-gap-followup`
  script.
- `Backend/kai/db/kaiIntakeQueries.js` — added one new exported function (see
  above); every existing exported function's signature and behavior is
  unchanged.

## Not changed

No Gate A through P2-03 migration, rollback, runner, verifier, smoke,
repository, service, or runbook artifact was edited, other than the additive
`ALTER TABLE` statements this package's own forward migration issues
(documented in the runbook).
`Backend/kai/dictionary/postgresEvidenceLineageRepository.js`,
`Backend/kai/services/kaiEvidenceLineageService.js`,
`Backend/kai/validators/kaiEvidenceLineageValidators.js`,
`Backend/kai/dictionary/postgresEvidenceCoverageAssessmentRepository.js`,
`Backend/kai/services/kaiEvidenceCoverageAssessmentService.js`,
`Backend/kai/validators/kaiEvidenceCoverageAssessmentValidators.js`,
`Backend/kai/dictionary/postgresClaimProposalRepository.js`,
`Backend/kai/services/kaiClaimProposalService.js`, and
`Backend/kai/validators/kaiClaimProposalValidators.js` and their exports are
unchanged. P2-01, P2-02, and P2-03 are accepted and closed and were not
reopened or modified. The `review_queue_items_p1_06_queue_type_check`
constraint (`migrations/kai_sprint2_p1_06_review_queue.sql`) is never touched -
`'client_followup'` was already an accepted literal in that constraint, unused
until this package. No `conflict_groups` table, `conflict_resolution` queue
item, `operator_action_items` table, or independent persisted
coverage-assessment object was created. No `gap_status`, `followup_status`, or
equivalent state column was added. No route, listener, scheduler, timer,
startup hook, public barrel export, production composition, conflict-group
persistence, conflict-resolution decisions, operator-action persistence,
client-review decisions, claim approval/promotion/mutation, evidence-review
mutation, source-promotion changes, requirement/engagement persistence,
assistant tools, traceability UI, generation, public/funder export, cloud
configuration, feature-flag default enablement, or real-client-data handling
was added or implemented. `KAI_SPRINT2_ENABLED` is not enabled by this
package; no package-specific feature flag is added.

## Behavior summary

Human-authorized, idempotent generation of claim-scoped gaps
(`kai.gap_log_items`, one per P2-02 dimension whose authoritative
`assessment_status` is not `resolved_clear`) and their client-answerable
follow-ups (`kai.client_followup_items`, one per open gap on
`definition_clarity`/`denominator_clarity`/`time_period_clarity`/
`entity_level_clarity` only, using one of exactly four fixed server-owned
question templates), atomically compounded with each follow-up's
`client_followup` `kai.review_queue_items` item (`queue_status =
'waiting_on_client'`, `review_status = 'proposed'`, `priority = 'normal'`,
fixed `summary`, `required_action` = the exact question, `assigned_to`/
`due_at` always `NULL`). Gated by `KAI_SPRINT2_ENABLED`, a mapped human actor
(`gk_admin`/`gk_operator`/`gk_reviewer`) with active organization membership,
and `validateClaimGapLineage`'s reuse of the already-accepted P2-03
evidence-lineage and P2-02 permission/dictionary-lineage validators (including
the current-source-version gate: a superseded source_version fails closed
with `conflict_current_state_changed`, zero mutation, zero audit). The caller
supplies only `organizationId`, `claimId`, `actorContext`, and `now`; every
dimension result is computed fresh, inside this call's own transaction, from
the exact P2-02 dimension functions - never forked, never independently
reinterpreted. The complete deterministic expected set is computed before any
write; an empty existing state with a non-empty expected set writes the whole
set atomically; an existing state that exactly matches the expected set is a
full replay (zero writes, zero audit); a partial or mismatched existing state
fails closed as `conflict_current_state_changed` without repair; an all-
`resolved_clear` result returns empty collections with zero writes and zero
audit. Two genuinely concurrent identical calls converge via a full-set
multi-row `INSERT ... ON CONFLICT ... DO NOTHING RETURNING` per table, never a
raised `23505` catch or an application-level synchronization primitive. Every
write and the required metadata-only `claim_gap_and_followup_generated` audit
row (exactly twelve allowlisted keys - identifiers, dimension/reason codes,
counts, and the validator key only; never question text, summaries, claim/
evidence text, or any other free-form content) happen inside one transaction;
any conflict, a rejected required-audit prepare, a synchronous publish
failure, a rejected publish promise, or a malformed inserted/reread row rolls
back all of it together.
