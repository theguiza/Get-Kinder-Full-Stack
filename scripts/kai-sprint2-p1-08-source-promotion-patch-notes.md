# KAI P1-08 Patch Notes — Source-Promotion Decision, Source, and Source-Version Creation

## Owner decision on scope and boundary

Research before implementation confirmed `kai.intake_promotion_decisions`,
`kai.sources`, and `kai.source_versions` do not exist anywhere in `migrations/`, and
`createSourcePromotionDecision` does not exist anywhere in the repository; all are
introduced fresh by this package. No prior P1-06/P1-07 package records a decision
without also completing its associated write in the same transaction, so decision
recording and promotion are kept compounded in one atomic operation, matching the
established compound-boundary idiom (P1-07 compounds its candidate insert and
review-item insert) rather than being split into two separately-atomic operations.

## Owner decision on identity

The P1-08 idempotency identity is `organization_id` + `intake_source_candidate_id`:
the narrowest immutable identity representing one decision per P1-07 candidate,
matching the 1:1 relationship P1-07 itself already enforces
(`intake_source_candidates_p1_07_identity_unique`). No currently authorized workflow
permits re-deciding or re-promoting the same candidate under a different
`reviewedSourceType`; attempting to do so returns `conflict_current_state_changed`.

## Owner decision on reviewed_source_type vocabulary

Fresh inspection found no currently authorized producer contract that emits an
explicit source-type classification (the same absence P1-07 found and disclosed for
its own `proposed_source_type`). `reviewed_source_type` is therefore pinned to a fixed,
disclosed, non-`'unknown'` vocabulary this package invents and discloses as its own
implementation decision (`organization_primary_record`,
`organization_secondary_record`, `third_party_provided_record`, `public_record`) -
never inferred from a filename, MIME type, field name, sample value, AI output, or
external lookup; always an explicit human selection carried through the decision
input.

## Owner decision on deterministic source-code generation and current-version semantics

`source_code` is a sha256 hex digest computed only from immutable, already-committed
lineage facts (`organizationId`, `intakeSensitivityProfileId`,
`profileCanonicalSha256`, `reviewedSourceType`) - never a filename, MIME type, sample
value, AI output, or external lookup. Because `intake_sensitivity_profile_id` is
already unique to one P1-07 candidate identity, this package's `kai.sources`/
`kai.source_versions` rows are effectively 1:1 with the candidate they were promoted
from; this package does not implement merging multiple candidates into one source's
version history (out of scope; a future package may). `kai.sources` and
`kai.source_versions` creation each defensively handle an existing row for the same
computed identity (authoritative replay) and a losing concurrent insert (re-read and
replay via `ON CONFLICT ... DO NOTHING RETURNING`, never a raised `23505`).
`ux_source_versions_p1_08_current_per_source` enforces at most one current version per
source as a forward-looking safety net even though, under this package's own 1:1
design, that conflict is not otherwise reachable.

## Owner decision on the governance/allowed-use/consent permission representation

No currently authorized package changes the P1-05 fail-closed columns
(`human_review_required`, `public_use_allowed`, `funder_use_allowed`,
`llm_processing_allowed`, `product_learning_allowed`, `retention_posture`), so rather
than inventing a new permission representation, this package reapplies the exact same
predicate P1-05/P1-06/P1-07 already enforce against the same row
(VAL-KAI-P1-08-002). Promotion creates source identity/lineage metadata only; it does
not itself change any allowed-use posture.

## Owner decision on validator_key

`VAL-KAI-P1-08-001` (candidate/review completeness and status), `VAL-KAI-P1-08-002`
(reapplied permission predicate), and `VAL-KAI-P1-08-003` (reviewed-source-type
vocabulary) are P1-08 implementation decisions, matching the naming idiom P1-05/P1-06/
P1-07 themselves used. They are not quoted from, and are not claimed to be mandated by,
any owner-authorized governing source. The required audit records
`VAL-KAI-P1-08-001` as its single disclosed key, matching the one-key-per-audit-row
idiom already established by P1-05 through P1-07.

## Added

- `migrations/kai_sprint2_p1_08_source_promotion.sql` — forward migration creating the
  canonical `kai.intake_promotion_decisions`, `kai.sources`, and `kai.source_versions`
  tables, their tenant-safe composite lineage foreign keys, the
  `ux_source_versions_p1_08_current_per_source` partial unique index, and the new
  `source_promotion_decision_persisted` audit operation/metadata branch on the existing
  `kai.upload_lifecycle_audit`. Widens `kai.intake_source_candidates.candidate_status`
  to accept `'promoted'` and adds the trivially-unique constraints described in the
  runbook's "Additive schema changes to earlier tables" section.
- `migrations/kai_sprint2_p1_08_source_promotion.rollback.sql` — removes only the
  P1-08 tables, their indexes, the P1-08-only foreign keys/unique constraints added
  onto earlier tables, and the P1-08 audit rows/branch, restoring the exact prior audit
  constraints and `candidate_status` CHECK.
- `scripts/kai-sprint2-p1-08-source-promotion-verifier.sql`, `-failure-checks.sql`,
  `-smoke-seed.sql`, `-smoke-verifier.sql` — catalog verification, read-only-transaction
  negative-scope checks (reviewed-source-type vocabulary including the explicit
  rejection of `'unknown'`, decision_status/promoted-binding pinning, source_code shape,
  composite-FK rejection of fabricated/mismatched lineage, identity-unique enforcement
  at every level, current-source-version uniqueness, and candidate_status widening), a
  smoke seed that inserts the two complete candidate/review pairs this package's smoke
  verifier targets (no earlier smoke seed inserts an actual
  `kai.intake_source_candidates` row), and smoke verification (creation, replay,
  duplicate-identity rejection, concurrent-insert convergence, cross-tenant
  invisibility, and transaction+audit atomicity).
- `scripts/kai-sprint2-p1-08-source-promotion-local-postgres.js` — ephemeral loopback
  PostgreSQL 16 runner (`npm run verify:kai-sprint2-p1-08-source-promotion`), reusing
  the P1-07 runner's exact mechanism/conventions.
- `scripts/kai-sprint2-p1-08-source-promotion-runner-assertions.js` — `assertNoFail`,
  copying the established P1-02 through P1-07 pattern.
- `scripts/kai-sprint2-p1-08-source-promotion-runbook.md` — package runbook.
- `Backend/kai/dictionary/postgresSourcePromotionRepository.js` — new repository: the
  only authorized location for P1-08 SQL and row locking. Requires both feature flags
  before any read; reads exactly the P1-07 candidate, P1-07-established review item,
  and P1-05 sensitivity-profile lineage/predicate columns needed; applies
  VAL-KAI-P1-08-001/002/003; computes the deterministic `source_code`; does
  authoritative existing-row lookups (decision, then source, then source_version)
  before ever inserting; and writes the required metadata-only
  `source_promotion_decision_persisted` audit row inside the same transaction as every
  insert/transition on first creation only.
- `Backend/kai/services/kaiSourcePromotionService.js` — new file exporting
  `createSourcePromotionDecision`. Validates its input allowlist (`organizationId`,
  `intakeSourceCandidateId`, `reviewedSourceType`, `actorContext`, `now` only), checks
  both `KAI_SPRINT2_ENABLED` and `KAI_SOURCE_PROMOTION_ENABLED`, enforces AUTH-KAI-003
  and VAL-TEN-001, then delegates to the injected P1-08 repository. Contains no SQL and
  imports no database pool. Not composed into any route.
- `Backend/kai/db/kaiIntakeQueries.js` (additive) — added
  `getScopedSourceCandidateByIdentity`, `getScopedSourcePromotionDecisionByIdentity`,
  `getScopedSourceByCode`, `getScopedSourceById`,
  `getScopedSourceVersionByCandidateIdentity`, `getScopedSourceVersionById`. No existing
  exported function in this file was modified.
- `Backend/kai/config/kaiSprint2Config.js` (additive) — added
  `isKaiSourcePromotionEnabled` (reading `KAI_SOURCE_PROMOTION_ENABLED`, default false)
  and `areKaiSprint2SourcePromotionFeaturesEnabled`, matching the exact
  `isKaiFileUploadEnabled`/`areKaiSprint2UploadFeaturesEnabled` composition idiom
  already established in this file. No existing exported function was modified; neither
  flag is enabled by this package.
- `__tests__/kai-sprint2-p1-08-source-promotion-schema-contract.spec.js`,
  `-boundary.spec.js`, `.integration.spec.js`, `-runner-self-test.spec.js` — focused
  schema, boundary, PostgreSQL-backed integration, and runner-assertion tests.

## Changed (additive only)

- `package.json` — added the `verify:kai-sprint2-p1-08-source-promotion` script.
- `Backend/kai/db/kaiIntakeQueries.js` — added six new exported functions (see above);
  every existing exported function's signature and behavior is unchanged.
- `Backend/kai/config/kaiSprint2Config.js` — added two new exported functions (see
  above); every existing exported function's signature and behavior is unchanged.

## Not changed

No P1-02 through P1-07 or Gate A migration, rollback, runner, verifier, smoke,
repository, service, or runbook artifact was edited, other than the additive `ALTER
TABLE` statements this package's own forward migration issues (documented in the
runbook). `Backend/kai/services/kaiSourceCandidateService.js`,
`Backend/kai/services/kaiReviewQueueService.js`, and their exports are unchanged. P1-07
is accepted and closed and was not reopened or modified. No route, listener, scheduler,
timer, startup hook, public barrel export, production composition, source locator,
graph relationship, evidence extraction, claim, assistant tool, generation logic,
cloud configuration, feature-flag default enablement, or real-client-data handling was
added or implemented. Neither `KAI_SPRINT2_ENABLED` nor `KAI_SOURCE_PROMOTION_ENABLED`
is enabled by this package.

## Behavior summary

Human-authorized, idempotent creation of one `kai.intake_promotion_decisions` row per
`organization_id` + `intake_source_candidate_id`, compounded atomically with
deterministic `kai.sources`/`kai.source_versions` creation-or-authoritative-replay and
the candidate's/review item's required transitions, gated by both
`KAI_SPRINT2_ENABLED` and `KAI_SOURCE_PROMOTION_ENABLED`, a mapped human actor
(`gk_admin`/`gk_operator`/`gk_reviewer`) with active organization membership, and
VAL-KAI-P1-08-001/002/003. A resolved review item is never itself promotion authority.
The caller supplies only `organizationId`, `intakeSourceCandidateId`,
`reviewedSourceType`, `actorContext`, and `now`; every lineage fact is server-derived
from a fresh authoritative re-read, never trusted from the caller. Same identity with
an already-promoted decision bound to the same `reviewedSourceType`: replay, zero
mutation, zero audit. Any incomplete pair, stale/mismatched lineage, non-open review
item, already-promoted candidate, unrecognized or `'unknown'` reviewed type, or
cross-tenant identity fails closed with `not_found`, `validation_blocker`, or
`conflict_current_state_changed` and zero mutation. Concurrent identical creation
converges via `INSERT ... ON CONFLICT ... DO NOTHING RETURNING` at every step, never a
raised `23505` catch, a savepoint, an in-process lock, mutex, or advisory lock. The
decision insert, its promotion, the source/source_version creation-or-replay, the
candidate/review transitions, and the required metadata-only
`source_promotion_decision_persisted` audit row (exactly twelve allowlisted keys, no
raw content, PII, path, URL, prompt, credential, signed URL, or unrestricted storage
path) happen inside one transaction; any compare-and-set observing a genuine
concurrent state change, a rejected required-audit prepare, a synchronous publish
failure, a rejected publish promise, or a malformed inserted row rolls back all of it
together.

## P1-08 CORRECTION (2026-08-05): three-outcome decision model

The single-outcome (`'promoted'`-only) model above is corrected to three
owner-authorized outcomes: `needs_more_information`, `rejected`, `promoted`. See
`scripts/kai-sprint2-p1-08-source-promotion-runbook.md`'s "P1-08 CORRECTION" section
for the full transition matrix, schema changes, and per-outcome side-effect
description. Summary:

- The service/repository input field `reviewedSourceType` is replaced as the sole
  discriminator by a new `outcome` field (`needs_more_information` | `rejected` |
  `promoted`); `reviewedSourceType` is now required only when `outcome ===
  'promoted'` and must be entirely absent otherwise (a present value on a
  non-promotion outcome is rejected as `validation_blocker`, never silently
  ignored).
- `kai.intake_promotion_decisions.decision_status` no longer has a transient
  `'decided'` value; a decision row is written directly at whichever outcome was
  requested. `reviewed_source_type` is now nullable (bound only for `promoted`).
- `kai.intake_source_candidates.candidate_status` is widened again to also accept
  `'rejected'`.
- `kai.review_queue_items.queue_status` uses the already-accepted P1-06 value
  `'waiting_on_client'` for `needs_more_information`, with `required_action` set to
  the fixed literal `"Obtain the missing client information before reconsidering
  source promotion."` No new column or CHECK constraint was needed on
  `kai.review_queue_items`.
- `Backend/kai/dictionary/postgresSourcePromotionRepository.js` and
  `Backend/kai/services/kaiSourcePromotionService.js` were rewritten to support the
  full transition matrix (`null -> X` for all three outcomes,
  `needs_more_information -> rejected`/`promoted`), with every other requested
  transition returning `conflict_current_state_changed` via an authoritative
  reread-and-compare-and-set, and identical replay of any reachable outcome
  performing zero writes and zero audit.
- The four P1-08 test spec files, the P1-08 verifier/smoke-verifier/failure-checks/
  smoke-seed SQL scripts, and this runbook/patch-notes pair were updated to match.
  No P1-06/P1-07 file was touched; the correction remains entirely within this
  package's own migration, repository, service, scripts, and tests.
