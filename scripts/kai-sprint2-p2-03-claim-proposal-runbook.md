# KAI P2-03 Deterministic Claim-Proposal Foundation Runbook

This package creates two canonical, previously-untracked tables -
`kai.claims` and `kai.claim_evidence_links` - and one narrow, human-authorized,
idempotent path - `proposeClaim` - that deterministically proposes exactly one
internal-only, GK-review-gated `'finding'` claim per already-committed P2-01
`kai.evidence_items` row, atomically compounded with the canonical
`kai.claim_evidence_links` row and the `kai.review_queue_items` `'claim_review'`
item each fresh claim requires. It changes no Gate A through P2-01 migration,
rollback, runner, verifier, smoke, repository, service, or runbook artifact,
other than the additive `ALTER TABLE` statements this package's own forward
migration issues against `kai.upload_lifecycle_audit` and
`kai.review_queue_items` (see "Additive schema changes to earlier tables"
below), and the additive `getScoped*` query functions added to
`Backend/kai/db/kaiIntakeQueries.js`.

Run:

```sh
npm run verify:kai-sprint2-p2-03-claim-proposal
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_p2_03_claim_proposal_synthetic`;
- applies the existing synthetic bootstrap schema and the existing frozen Gate A
  through P2-01 migrations, all unmodified, then the new P2-03 forward
  migration;
- runs the P2-03 catalog verifier and read-only failure checks, then the
  existing Gate A through P2-01 smoke seeds followed by the new P2-03 smoke
  seed (which creates one real, committed evidence item/locator/evidence_review
  pair against the already-promoted P1-08 fixture, since P2-01's own smoke
  verifier always rolls its own evidence-lineage simulation back) and smoke
  verifier;
- runs `__tests__/kai-sprint2-p2-03-claim-proposal.integration.spec.js` against
  that runner-owned target only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback
address, port, `listen_addresses`, and PostgreSQL 16 version. It must not be
pointed at a shared, quarantined, cloud, production, or real-client-data
database. The integration spec skips itself unless
`KAI_P2_03_CLAIM_PROPOSAL_DATABASE_URL` is set by that runner.

The runner also fails closed on any real `FAIL` status cell returned by the
catalog verifier, read-only failure checks, or smoke verifier (`assertNoFail`,
`scripts/kai-sprint2-p2-03-claim-proposal-runner-assertions.js`), copying the
established P2-01 `assertNoFail` pattern.
`__tests__/kai-sprint2-p2-03-claim-proposal-runner-self-test.spec.js` proves
this deterministically.

The non-database schema-contract and boundary specs
(`__tests__/kai-sprint2-p2-03-claim-proposal-schema-contract.spec.js`,
`__tests__/kai-sprint2-p2-03-claim-proposal-boundary.spec.js`) run in the normal
suites and need no database.

## Scope

`Backend/kai/dictionary/postgresClaimProposalRepository.js` is the only
authorized location for this package's SQL and row locking, other than the
reused `getScoped*` lookups added to `Backend/kai/db/kaiIntakeQueries.js`
(`getScopedEvidenceItemById`, `getScopedSourceLocatorById`,
`getScopedClaimByEvidenceIdentity`, `getScopedClaimEvidenceLinkByClaimId`,
`getScopedClaimReviewQueueItemByClaimId`; `getScopedSourceById`,
`getScopedSourceVersionById`, `getScopedSourceCandidateByIdentity`,
`getScopedPromotionDecisionBySourceVersionId`, and
`getScopedEvidenceReviewQueueItemByEvidenceItemId` are reused unmodified from
P1-08/P2-01). `proposeClaim` (`Backend/kai/services/kaiClaimProposalService.js`)
contains no SQL and imports no database pool: it validates its input allowlist,
checks `KAI_SPRINT2_ENABLED` before any repository read, lock, validator side
effect, or audit activity, enforces AUTH-KAI-003 (reapplied from P1-06 through
P2-01), and then delegates tenant-membership and role authorization to the
existing shared validator-group mechanisms (`validateActorCanPerformOperation`,
`validateTenantBoundaryConsistency`). It is not composed into any route,
listener, scheduler, or production path. Like P2-01/P2-02, no package-specific
feature flag is added - this package stays dormant under `KAI_SPRINT2_ENABLED`
alone.

## Service input (exact allowlist)

```
organizationId
evidenceItemId
actorContext
now
```

No other fields are accepted; an unknown key or a missing required key is
rejected as `validation_blocker` before any repository call. Every claim field
(text/type/status/strength/audience/evidence-identity/requirement-identity) is
server-derived - the caller cannot supply any of it.

**AUTH-KAI-003** (human-actor authorization): `actorContext.actorType` must be
exactly `"human"` with a non-empty `actorUserId`. Every non-human actor type is
rejected with `authorization_denied`. There is no bypass.

**VAL-TEN-001** (tenant membership): the actor must hold an active membership
in the requested `organizationId` with `role_name` in `gk_admin`,
`gk_operator`, or `gk_reviewer`. A role without active tenant membership is
rejected by `validateActorCanPerformOperation`'s own membership check.

## Owner contract: every claim column is server-derived and fail-closed-pinned

`claim_type` (`'finding'`), `claim_status` (`'proposed'`), `claim_review_status`
(`'needs_gk_review'`), and `claim_strength` (`'unassessed'`) are each pinned by
a single-value CHECK constraint - never a widened vocabulary. `internal_only`
is pinned `true`; `public_use_allowed`, `funder_use_allowed`,
`llm_processing_allowed`, `product_learning_allowed`, and `export_ready` are
each pinned `false`. This package proposes internal, unsupported-until-reviewed
findings only and grants no public, funder, LLM-processing, product-learning,
or export use.

## The claim statement is deterministic and server-derived only

The claim statement is derived **only** from the evidence item's own locator
coordinates - never from the evidence item's own `statement` text (which could
smuggle a different evidence_type's semantics into the claim), never from
caller-supplied text, and never from raw file content or a sample value:

> The promoted source contains the committed data-dictionary field
> "&lt;column_name&gt;" identified by locator &lt;locator_fingerprint&gt;.

It can therefore only ever assert that a field exists at a locator - never
participant counts, outcomes, denominators, reporting periods, causality,
requirement satisfaction, or external eligibility. `claims_p2_03_statement_check`
mirrors the exact P2-01 statement-safety regex and 1-500 character bound;
`claims_p2_03_statement_fingerprint_check` enforces the sha256 hex shape.

## Canonical claim-to-evidence links

`kai.claim_evidence_links` is a standalone junction table (rather than relying
solely on `kai.claims.evidence_item_id`) because "canonical claim-to-evidence
links" is listed as its own distinct deliverable from "canonical claims
persistence". Today's cardinality is always exactly one link per claim
(`claim_evidence_links_p2_03_one_link_per_claim_unique`); this package adds no
column or feature that would allow more than one - a later package may extend
claims to multiple evidence items without a schema migration of this table's
shape.

## Evidence and review-pair authority (loaded and validated before any write)

Before writing, inside the transaction, the repository authoritatively loads
and locks: the evidence item (`kai.evidence_items`), its source locator
(`kai.source_locators`), its source and source_version lineage
(`kai.sources`, `kai.source_versions`), its promoted candidate and promotion
decision (`kai.intake_source_candidates` - `FOR UPDATE`, the real
serialization point, exactly like P1-08/P2-01 - and
`kai.intake_promotion_decisions`), and its corresponding `evidence_review`
`kai.review_queue_items` row. Both the evidence item and its evidence_review
queue item must exist, be tenant-matched, and have compatible immutable
identity (`queue_type = 'evidence_review'`, `target_object_type =
'evidence_item'`, `target_object_id = evidence_item_id`). A missing pair ->
`not_found`; an incompatible pair -> `conflict_current_state_changed`. Both
paths: zero mutation, zero audit. P2-03 never mutates or resolves the
evidence_review item - it only reads it.

The loaded `source_version` row must also still be current
(`is_current === true`) (P2-03C correction). A superseded source_version is
never sufficient, regardless of whether the evidence item, locator, source
row, candidate, decision, or evidence_review item still reference it, still
remain promoted, or still exist - only evidence whose complete authoritative
lineage resolves to the current source_version may produce the P2-03
internal-only proposed claim. `is_current` missing, null, or `false` ->
`conflict_current_state_changed`, before any claim, claim-to-evidence link,
claim_review queue item, audit row, or audit publication.

## VAL-KAI-P2-03-001/002/003 (`Backend/kai/validators/kaiClaimProposalValidators.js`)

Boolean-gate return shape, adapted from the P2-01 idiom with an added
`warnings` array of `createValidatorResult`-shaped objects
(`Backend/kai/validators/types.js`):

1. **`validateClaimHasLoadBearingEvidence`**: requires complete tenant-safe
   evidence/source/version/locator lineage (all rows present and cross-row
   org/lineage-consistent), that the source_version remain current
   (`is_current === true`; P2-03C), plus the compatible evidence_review pair;
   missing lineage -> `not_found`; incompatible lineage or a non-current
   source_version -> `conflict_current_state_changed`;
   non-promoted candidate/decision -> `validation_blocker`. Passing returns a
   warning while the evidence item's `support_strength` remains `'unassessed'`
   or its evidence_review's `review_status` remains unresolved - in this
   package's current world (P2-01 only ever creates evidence in exactly that
   state), this warning always fires, intentionally: it is what "block
   approval/export under those unresolved conditions" means downstream.
2. **`validateUnsupportedClaimPromotion`**: a fixed-shape assertion over the
   literal write-plan constants this package is about to write (never over
   caller input, since the caller cannot supply any of it) - a real, testable
   guard against a future accidental change to those constants. Passes only
   for the exact allowed proposed/needs_gk_review/unassessed/internal-only
   shape; any deviation -> `validation_blocker`.
3. **`validateClaimRequirementCoverage`**: always returns a pass with a warning
   that requirement coverage is unresolved/unbound, since no requirement-
   binding table exists yet. Takes no requirement-shaped input at all, and
   never creates or infers a requirement identity - this validator exists
   solely so a later package can replace it without changing the service's
   call shape.

All three run in order; the first `ok: false` aborts before any write with
that code. Every `warnings` array from a passing validator is collected and
returned in the service's success result.

## Claim-review queue item

Exactly one `kai.review_queue_items` row per fresh claim: `queue_type =
'claim_review'`, `target_object_type = 'claim'`, `target_object_id = claim_id`,
`priority = 'normal'`, `queue_status = 'open'`, `review_status =
'needs_gk_review'`, `summary = 'Review proposed internal-only claim.'`,
`required_action = "Review the claim's evidence lineage, support strength,
limitations, requirement coverage, and audience eligibility before any use."`.
`'claim_review'` was already an accepted `queue_type` value in the P1-06
migration, unused until this package. A new
`ux_review_queue_items_p2_03_claim_review_identity` partial unique index and a
`review_queue_items_p2_03_claim_review_required_action_check` CHECK constraint
mirror the exact P1-06/P2-01 precedent, scoped to `queue_type = 'claim_review'`
only.

## Write order and the P1-07/P2-01 partial-replay-repair correction reapplied

Insert the claim via `ON CONFLICT (organization_id, evidence_item_id,
claim_type) DO NOTHING RETURNING`, reread on a lost race. Then, **strictly
gated on `isFreshlyCreated` for THIS claim** (never on "a link or queue item
happens to be missing"), insert the `kai.claim_evidence_links` row and the
`claim_review` queue item, each via its own `ON CONFLICT ... DO NOTHING
RETURNING`. On replay (claim already existed), a mismatched immutable claim
identity (statement-fingerprint drift for the same organization_id +
evidence_item_id + claim_type) is a genuine conflict, never a silent replay. A
full post-write/replay contract re-verification (`verifyPostWriteContract`)
checks organization_id, evidence_item_id, claim_type, statement,
statement_fingerprint, claim_status, claim_review_status, claim_strength,
every audience-gate boolean, the claim-to-evidence link identity, and the
claim_review identity + non-blank required_action - any mismatch raises
`MalformedInsertedRowError` (system_error, rolled back).

## Replay and idempotency identity

The P2-03 idempotency identity is `organization_id` + `evidence_item_id` +
`claim_type` (`claim_type` is always `'finding'`, but is included literally in
the unique constraint as named identity). If the claim already existed
(`isFreshlyCreated === false`), the call is a full identical replay: zero
writes, zero audit, `replayed: true`. Concurrent identical proposal at every
step (claim, link, queue item) is resolved entirely by PostgreSQL's unique
constraints via `INSERT ... ON CONFLICT ... DO NOTHING RETURNING`, never a
raised `23505` catch or any application-level synchronization primitive.

## Required metadata-only audit

Exactly one `claim_proposed` audit row is published per call that performs a
fresh write. The metadata carries exactly `metadata_only`, `contract`
(`'p2_claim_proposal_v1'`), `evidence_item_id`, `claim_id`, `claim_type`,
`claim_status`, `claim_review_status`, `requirement_coverage_status`
(`'unresolved'`), `warning_count`, `review_queue_item_count`,
`fresh_write_count`, and `validator_key` - twelve keys, no more. **The claim
statement text itself is never carried in audit metadata** (`NOT metadata ?
'claim_statement'`): it lives only in `kai.claims.statement`. Rejection of the
required audit prepare, a synchronous publish failure, or a rejected publish
promise rolls back every mutation together (own-boolean-data-property audit
predicate, copied from P1-05 through P2-01's `prepareRequiredAudit`).

When `KAI_SPRINT2_ENABLED` is disabled, the service returns the canonical
`feature_disabled` result with zero repository reads, locks, validator side
effects, or audit activity.

This package does not add a route, listener, scheduler, timer, polling loop,
startup hook, public barrel export, production composition, feature-flag
default enablement, cloud configuration, claim approval/promotion, evidence-
review mutation, engagement/requirement persistence, coverage/conflict/gap/
follow-up persistence, external audience use/export, or real-client-data
handling.

## Additive schema changes to earlier tables

Following the accepted P1-07/P1-08/P2-01 precedent of widening an earlier
package's CHECK-pinned vocabulary or adding a unique index through a later
package's forward migration (never editing the earlier package's accepted
migration file):

- `kai.upload_lifecycle_audit`'s operation and metadata-object CHECK
  constraints are extended with the new `claim_proposed` branch, preserving
  every earlier branch verbatim (including `evidence_lineage_extracted`).
- One partial unique index is added to `kai.review_queue_items`
  (`ux_review_queue_items_p2_03_claim_review_identity`, scoped to `queue_type =
  'claim_review'` only), mirroring
  `ux_review_queue_items_p1_06_sensitivity_review_identity` and
  `ux_review_queue_items_p2_01_evidence_review_identity` exactly.
  `'claim_review'` was already an accepted `queue_type` value in the P1-06
  migration - the `review_queue_items_p1_06_queue_type_check` constraint itself
  is never touched.

## PostgreSQL isolation

`__tests__/kai-sprint2-p2-03-claim-proposal.integration.spec.js` validates
`KAI_P2_03_CLAIM_PROPOSAL_DATABASE_URL` as loopback-only (`127.0.0.1`,
`localhost`, or `::1`) synchronously, before performing a single dynamic import
of `pg` or any P2-03 module - and never imports `Backend/kai/db/kaiDb.js`
anywhere in the file. `Backend/kai/dictionary/postgresClaimProposalRepository.js`
never statically imports `kaiDb.js` either: its default `withTransaction` is a
deferred `await import(...)`, reached only when a caller does not inject its
own `runInTransaction` - the integration spec always does, via a test-local
`withRunnerOwnedTransaction` wrapper reimplemented over its own runner-owned
`Pool`. Ambient `DATABASE_URL` is therefore never read or consulted by this
suite; a non-loopback URL is rejected before any connection is attempted; and
direct execution with `KAI_P2_03_CLAIM_PROPOSAL_DATABASE_URL` unset performs
zero database activity.

## Rollback

`migrations/kai_sprint2_p2_03_claim_proposal.rollback.sql` removes only the
P2-03 audit rows/branch (restoring the exact prior audit constraints), the
`review_queue_items_p2_03_claim_review_required_action_check` constraint, the
partial unique index on `kai.review_queue_items`, and the `kai.claims` and
`kai.claim_evidence_links` tables (child-first). It alters no Gate A through
P2-01 table, column, or constraint beyond that restoration.
