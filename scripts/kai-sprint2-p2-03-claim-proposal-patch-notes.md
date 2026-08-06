# KAI P2-03 Patch Notes — Deterministic Claim-Proposal Foundation

## Owner decision on scope and boundary

Research before implementation confirmed `kai.claims`, `kai.claim_evidence_links`,
and `proposeClaim` do not exist anywhere in the repository; all are introduced
fresh by this package. P2-03 is the closest structural analog of P2-01 (both do
persistence + a queue item + a repository with idempotent writes + audit), so
its migration, repository, service, and validator files precisely copy P2-01's
structural conventions, adapted to the claim-proposal identity/columns/text.
P2-02 (read-only, no migration, no writes) is not copied structurally - only its
`createValidatorResult` warning idiom is a secondary reference, since the spec
calls for a `warnings` array on the boolean-gate return shape.

## Owner decision on the boolean-gate + warnings return shape

The three required validators (`validateClaimHasLoadBearingEvidence`,
`validateUnsupportedClaimPromotion`, `validateClaimRequirementCoverage`) use the
`{ ok: true, warnings: [...] } / { ok: false, code }` boolean-gate shape from
`Backend/kai/validators/kaiEvidenceLineageValidators.js`, adapted with an added
`warnings` array of `createValidatorResult`-shaped objects
(`Backend/kai/validators/types.js`), per the task's own explicit guidance -
never the P2-02 dimension-assessment shape (`assessment_status` embedded in
`evidence`), which does not fit a validate-before-write boolean gate.

## Owner decision on the smallest coherent schema for claim-to-evidence links

`kai.claim_evidence_links` is kept as its own standalone junction table, rather
than relying solely on a direct `evidence_item_id` foreign key on
`kai.claims` itself, because the task explicitly lists "canonical claim-to-
evidence links" as its own deliverable, distinct from "canonical claims
persistence". Today's cardinality is always exactly 1:1 (enforced by
`claim_evidence_links_p2_03_one_link_per_claim_unique`); no column or feature
enabling multiple links is added. `kai.claims` itself still also carries a
direct `evidence_item_id` column (used by its own identity-unique constraint
and its tenant-safe composite FK to `kai.evidence_items`), so both concerns -
"a claim has an evidence_item_id" and "a claim has a canonical link row" - are
independently verifiable.

## Owner decision on the claim statement derivation

The claim statement is composed only from the evidence item's own locator
coordinates (`locator.coordinates->>'column_name'` and
`locator.locator_fingerprint`) - never from the evidence item's own `statement`
text. This is a deliberate, disclosed choice per the task's own instruction: the
evidence item's `statement` field could, in a future evidence_type, carry
semantics (participant counts, outcomes, denominators, etc.) that a claim must
never inherit by copying text verbatim. Deriving independently from the
locator's coordinates means the claim can only ever say "the field exists at
this locator."

## Owner decision on validator_key and audit operation naming

`VAL-KAI-P2-03-001`/`-002`/`-003` and `claim_proposed` follow the exact
`VAL-KAI-PN-0N-00N` / `<topic>_persisted|extracted|proposed` naming idioms
P1-08/P2-01 already established. Neither is quoted from, or claimed to be
mandated by, any owner-authorized governing source.

## Added

- `migrations/kai_sprint2_p2_03_claim_proposal.sql` — forward migration creating
  the canonical `kai.claims` and `kai.claim_evidence_links` tables, their
  tenant-safe composite lineage foreign keys, the
  `ux_review_queue_items_p2_03_claim_review_identity` partial unique index, and
  the new `claim_proposed` audit operation/metadata branch on the existing
  `kai.upload_lifecycle_audit`.
- `migrations/kai_sprint2_p2_03_claim_proposal.rollback.sql` — removes only the
  P2-03 tables, their indexes, the partial unique index added onto
  `kai.review_queue_items`, and the P2-03 audit rows/branch, restoring the
  exact prior audit constraints.
- `scripts/kai-sprint2-p2-03-claim-proposal-verifier.sql`, `-failure-checks.sql`,
  `-smoke-seed.sql`, `-smoke-verifier.sql` — catalog verification, read-only-
  transaction negative-scope checks (claim_type/claim_status/claim_review_status/
  claim_strength pinning, every audience-gate boolean pin including
  export_ready, statement safe-content/length/fingerprint enforcement,
  cross-tenant and fabricated FK rejection, identity-unique enforcement at
  every level, one-link-per-claim enforcement, and the claim_review partial-
  unique-index enforcement), a smoke seed that creates one real, committed
  evidence item/locator/evidence_review pair against the already-promoted
  P1-08 fixture (since P2-01's own smoke verifier always rolls its own
  evidence-lineage simulation back), and smoke verification (creation, replay,
  duplicate-identity rejection, concurrent-insert convergence, cross-tenant
  invisibility, and transaction+audit atomicity).
- `scripts/kai-sprint2-p2-03-claim-proposal-local-postgres.js` — ephemeral
  loopback PostgreSQL 16 runner (`npm run verify:kai-sprint2-p2-03-claim-proposal`),
  reusing the P2-01 runner's exact mechanism/conventions, applying every prior
  migration through `kai_sprint2_p2_01_evidence_lineage.sql` (P2-02 added no
  migration) then this package's own.
- `scripts/kai-sprint2-p2-03-claim-proposal-runner-assertions.js` —
  `assertNoFail`, copied into this package's own file rather than imported
  cross-package, matching the established per-package-copy convention.
- `scripts/kai-sprint2-p2-03-claim-proposal-runbook.md` — package runbook.
- `Backend/kai/validators/kaiClaimProposalValidators.js` — new pure, no-SQL
  validator module exporting `validateClaimHasLoadBearingEvidence`,
  `validateUnsupportedClaimPromotion`, and `validateClaimRequirementCoverage`.
- `Backend/kai/dictionary/postgresClaimProposalRepository.js` — new repository:
  the only authorized location for P2-03 SQL and row locking. Reads the seven
  authoritative lineage/pairing rows, calls the three validators, composes the
  deterministic claim statement, writes the claim/link/queue item via
  `ON CONFLICT ... DO NOTHING RETURNING` plus authoritative rereads, verifies
  the full post-write/replay contract, and writes the required metadata-only
  `claim_proposed` audit row inside the same transaction as every insert, on
  first creation only.
- `Backend/kai/services/kaiClaimProposalService.js` — new file exporting
  `proposeClaim`. Validates its input allowlist (`organizationId`,
  `evidenceItemId`, `actorContext`, `now` only), checks `KAI_SPRINT2_ENABLED`,
  enforces AUTH-KAI-003 and VAL-TEN-001, then delegates to the injected P2-03
  repository. Contains no SQL and imports no database pool. Not composed into
  any route.
- `Backend/kai/db/kaiIntakeQueries.js` (additive) — added
  `getScopedEvidenceItemById`, `getScopedSourceLocatorById`,
  `getScopedClaimByEvidenceIdentity`, `getScopedClaimEvidenceLinkByClaimId`,
  `getScopedClaimReviewQueueItemByClaimId`. No existing exported function in
  this file was modified.
- `__tests__/kai-sprint2-p2-03-claim-proposal-schema-contract.spec.js`,
  `-boundary.spec.js`, `.integration.spec.js`, `-runner-self-test.spec.js` —
  focused schema, boundary, PostgreSQL-backed integration, and runner-assertion
  tests.

## Changed (additive only)

- `package.json` — added the `verify:kai-sprint2-p2-03-claim-proposal` script.
- `Backend/kai/db/kaiIntakeQueries.js` — added five new exported functions (see
  above); every existing exported function's signature and behavior is
  unchanged.

## Not changed

No Gate A through P2-01/P2-02 migration, rollback, runner, verifier, smoke,
repository, service, or runbook artifact was edited, other than the additive
`ALTER TABLE` statements this package's own forward migration issues
(documented in the runbook). `Backend/kai/dictionary/postgresEvidenceLineageRepository.js`,
`Backend/kai/services/kaiEvidenceLineageService.js`,
`Backend/kai/validators/kaiEvidenceLineageValidators.js`,
`Backend/kai/dictionary/postgresEvidenceCoverageAssessmentRepository.js`, and
`Backend/kai/services/kaiEvidenceCoverageAssessmentService.js` and their
exports are unchanged. P2-01 and P2-02 are accepted and closed and were not
reopened or modified. The `review_queue_items_p1_06_queue_type_check`
constraint (`migrations/kai_sprint2_p1_06_review_queue.sql`) is never touched -
`'claim_review'` was already an accepted literal in that constraint, unused
until this package. No route, listener, scheduler, timer, startup hook, public
barrel export, production composition, claim approval/promotion, evidence-
review mutation, engagement/requirement persistence, coverage/conflict/gap/
follow-up persistence, external audience use/export, cloud configuration,
feature-flag default enablement, or real-client-data handling was added or
implemented. `KAI_SPRINT2_ENABLED` is not enabled by this package; no
package-specific feature flag is added.

## Behavior summary

Human-authorized, idempotent proposal of exactly one internal-only, GK-review-
gated `'finding'` claim per already-committed P2-01 `kai.evidence_items` row,
gated by `KAI_SPRINT2_ENABLED`, a mapped human actor (`gk_admin`/`gk_operator`/
`gk_reviewer`) with active organization membership, and
VAL-KAI-P2-03-001/002/003's fixed-order lineage/write-plan/requirement-coverage
predicates. The caller supplies only `organizationId`, `evidenceItemId`,
`actorContext`, and `now`; every claim field is server-derived from a fresh
authoritative re-read, never trusted from the caller and never fabricated from
raw file content, a sample value, or the evidence item's own `statement` text.
Identical replay performs zero writes and zero audit. Any missing/incomplete
lineage, incompatible evidence-review pairing, non-promoted candidate/decision,
mismatched cross-row lineage, or cross-tenant identity fails closed with
`not_found`, `validation_blocker`, or `conflict_current_state_changed` and zero
mutation. Concurrent identical proposal converges via `INSERT ... ON CONFLICT
... DO NOTHING RETURNING` at every step, never a raised `23505` catch or an
application-level synchronization primitive. Every write (claim, canonical
claim-evidence link, claim_review queue item) and the required metadata-only
`claim_proposed` audit row (exactly twelve allowlisted keys, no raw content,
PII, claim statement text, path, URL, prompt, credential, or storage pointer)
happen inside one transaction; any compare-and-set observing a genuine
concurrent state change, a rejected required-audit prepare, a synchronous
publish failure, a rejected publish promise, or a malformed inserted row rolls
back all of it together.

## P2-03C correction — current-source-version claim gate

`validateClaimHasLoadBearingEvidence` (`Backend/kai/validators/kaiClaimProposalValidators.js`)
did not require the loaded `sourceVersionRow.is_current` to be `true` before
allowing claim proposal, so a claim could be proposed from evidence whose
authoritative source_version had since been superseded, as long as the
evidence item, locator, source row, candidate, decision, and evidence_review
item all still otherwise existed and remained promoted.

Corrected: a new check (P2-03 check 8, renumbering the evidence_review-pair
check to 9) requires `sourceVersionRow.is_current === true`; anything else
(`false`, missing, `null`) returns `conflict_current_state_changed` before any
claim, claim-to-evidence link, claim_review queue item, audit row, or audit
publication. This mirrors P2-01's own equivalent current-source-version gate
(`Backend/kai/validators/kaiEvidenceLineageValidators.js`).

Added:
- One focused boundary test proving `is_current = false`/missing/`null` fails
  closed with `conflict_current_state_changed`, and `is_current = true`
  preserves the existing warning and no-warning paths
  (`__tests__/kai-sprint2-p2-03-claim-proposal-boundary.spec.js`).
- One PostgreSQL integration test seeding an otherwise-valid promoted evidence
  item/evidence_review pair, making its source_version non-current, and
  proving `conflict_current_state_changed` with zero new claim, link,
  claim_review queue item, or audit rows, and zero audit publication
  (`__tests__/kai-sprint2-p2-03-claim-proposal.integration.spec.js`).

No migration, rollback, repository, or service change was required: the
repository already reads `sourceVersionRow.is_current` via the shared
`getScopedSourceVersionById` helper (the same helper P2-01/P2-02 use); only
the validator was under-checking it. P2-02 remains accepted and closed and
was not touched.
