# KAI P3-20 Patch Notes — Export Manifest Durable Review Binding

## Owner decision on scope

This package operationalizes the accepted `FUNCTIONAL_DEPENDENCY_PROOF`'s
`SELECTED_MODEL: DIRECT_MANIFEST_REVIEW_BINDING`: every P3-19 export
manifest now persists the exact `exportReviewQueueItemId` its finalization
call was made against, atomically, inside the same write transaction as the
existing, unmodified P3-18/VAL-EXP-001 PASS and the manifest insert itself.

The proof traced the real eligibility control flow
(`evaluateFinalExportEligibilityInTransaction` →
`evaluateGeneratedDraftExportReviewPacketInTransaction` →
`evaluateExportReviewRequestStateInTransaction` →
`isExportReviewQueueContractRow`) and the P3-05
`ux_review_queue_items_p3_05_export_review_identity` unique index to
establish that exactly one `exportReviewQueueItemId` can ever legitimately
pass P3-18 for a given export candidate (because that candidate's draft can
have at most one `export_review` queue item, ever, and P3-18 rejects any
review-item argument whose `target_object_id` does not match that draft).
This package persists that already-proven functional dependency; it changes
no eligibility, currentness, or fingerprint logic anywhere.

Explicitly not authorized or added: `UNIQUE(export_review_queue_item_id)`,
any `latest`/`current`/`active` selection column or query, any frontend/UI
recovery work, any route, and any production database access or mutation.

## Added

- `migrations/kai_sprint2_p3_20_export_manifest_review_binding.sql` /
  `.rollback.sql` — adds `kai.review_queue_items_p3_20_id_org_unique`
  (the same tenant-safe `(id, organization_id)` identity pattern already
  used by every other FK-target table in this schema), adds
  `kai.export_manifests.export_review_queue_item_id` (nullable first, then
  deterministically backfilled, then set `NOT NULL`), and adds
  `export_manifests_p3_20_review_queue_item_fk` (tenant-safe, RESTRICT) plus
  a non-unique `ix_export_manifests_p3_20_review_queue_item` lookup index.
  No `UNIQUE` constraint on `export_review_queue_item_id` alone was added -
  one review item legitimately backs multiple historical manifests, both
  across distinct export candidates sharing a draft and across P3-17
  grant/revoke/re-grant cycles on the same candidate. The backfill loop is
  fail-closed: any existing manifest row that resolves to zero or more than
  one matching `export_review` queue item raises an exception rather than
  guessing (no such row exists in this repository's own local/synthetic
  proof - see the runbook). The P3-19 append-only trigger is disabled only
  for the duration of this migration's own backfill `UPDATE`s and is
  re-enabled before commit; ordinary application `UPDATE`/`DELETE` of
  `kai.export_manifests` remains rejected exactly as before.
- `scripts/kai-sprint2-p3-20-export-manifest-review-binding-verifier.sql` —
  catalog verification (column, FK, tenant-safe unique constraint, absence
  of any unique constraint on `export_review_queue_item_id` alone, the
  lookup index, the unchanged P3-19 append-only trigger and replay-
  convergence key, and the absence of any latest/current/active column).
- `scripts/kai-sprint2-p3-20-export-manifest-review-binding-smoke-seed.sql` —
  extends the existing P3-19 smoke-seed's `org1`/`draft1`/`candidate1`
  identity with a revoke-then-re-grant decision cycle, producing a second
  real effective authority decision on the same candidate.
- `scripts/kai-sprint2-p3-20-export-manifest-review-binding-smoke-verifier.sql` —
  proves the P3-19 smoke-verifier's own pre-existing `manifest1` row (a
  genuine pre-P3-20 legacy row, not a fabricated one) was deterministically
  backfilled to the exact, unique review item for its candidate's draft;
  proves a second manifest bound to the second effective decision carries
  the exact same `export_review_queue_item_id`; proves cross-tenant and
  missing-review-item bindings are rejected; proves the append-only
  invariant still covers the new column.
- `scripts/kai-sprint2-p3-20-export-manifest-review-binding-failure-checks.sql` —
  negative checks: `NULL`/nonexistent/tenant-mismatched
  `export_review_queue_item_id`, plus one explicitly disclosed (not
  silently assumed) application-layer boundary: the FK alone cannot see
  `queue_type`, so a same-tenant review item of a *different* `queue_type`
  for the same draft would satisfy the FK - `queue_type`/target-object
  correctness is the already-proven responsibility of
  `evaluateFinalExportEligibilityInTransaction`, never re-derived here.
- `__tests__/kai-sprint2-p3-20-export-manifest-review-binding-boundary.spec.js` —
  fake-transaction proof that the repository's INSERT always names and
  binds the exact caller-supplied `exportReviewQueueItemId`, that the
  success object carries it unchanged, and that no latest/current-shaped
  method exists on the repository's public surface.
- `__tests__/kai-sprint2-p3-20-export-manifest-review-binding.integration.spec.js` —
  real-database proof: returned `exportManifestId`'s persisted row matches
  the caller-supplied binding; one review item legitimately backs two
  distinct historical manifests across a revoke/re-grant cycle; replay is
  unaffected; cross-tenant candidates are still rejected; and a real but
  mismatched (wrong-draft) `exportReviewQueueItemId` fails the real P3-18
  gate and persists neither a manifest nor a binding.

## Changed (additive/behavior-preserving only)

- `Backend/kai/dictionary/postgresExportManifestRepository.js` —
  `insertExportManifest` now also writes `export_review_queue_item_id`
  (the exact value the caller already supplied and that
  `evaluateFinalExportEligibilityInTransaction` already required for PASS,
  in the same transaction); the success object now also carries
  `exportReviewQueueItemId`. No eligibility, fingerprint, or replay logic
  changed.
- `scripts/kai-sprint2-p3-19-export-manifest-foundation-local-postgres.js` —
  extended, in place, to also apply the P3-20 migration and its own
  verifier/smoke-seed/smoke-verifier/failure-checks after every existing
  P3-19 step, and to include the two new P3-20 spec files in its `node
  --test` run. This is required because this runner is the one place that
  exercises `postgresExportManifestRepository.js#createExportManifest`
  against a real database, and that repository now always writes the P3-20
  column - exactly the same reason this runner already folds in
  `kai_sprint2_p3_17_authority_audit_gate_a_operation_repair.sql`. No
  existing P3-19 step's own migration list, verifier, smoke-seed, or
  assertions were edited or reordered; the P3-20 steps are appended after
  all of them.
- `package.json` — added
  `verify:kai-sprint2-p3-20-export-manifest-review-binding` (an alias for
  the same, now-extended, runner file). No existing script changed.

## Not changed

No route, UI control, renderer, artifact byte, storage key, signed URL,
download/retrieval path, reuse-lifecycle capability, feature flag, or cloud
configuration was added or touched. `kai.export_candidates`,
`kai.human_authority_decisions`, P3-16 currentness/fingerprint, P3-17
effectiveness, P3-18/VAL-EXP-001, and the P3-19 replay/fingerprint key
(`UNIQUE (organization_id, export_candidate_id, canonical_fingerprint)`) are
all exactly unchanged - `export_review_queue_item_id` is not, and was never
proposed to be, part of that key. No frontend/read-recovery work (page-
reload/history recovery of a candidate's/manifest's identity from the
export-review page) is included in this package; it remains the deferred
next dependency this package makes possible, not one it implements.

## Behavior summary

**Binding identity.** Every `kai.export_manifests` row now carries the
exact `export_review_queue_item_id` its own finalization call supplied,
written in the same transaction as the manifest insert. Binding failure
(a nonexistent or tenant-mismatched review item) is a real foreign-key or
eligibility failure inside that same transaction - the whole transaction
rolls back, and no manifest row (and therefore no binding) is ever
persisted for a rejected attempt.

**Cardinality preserved exactly as proven.** No `UNIQUE
(export_review_queue_item_id)` was added. One review item may legitimately
back many historical manifests - both across multiple export candidates for
the same underlying draft, and across a P3-17 grant/revoke/re-grant
lineage on the same candidate - proven directly in this package's own
smoke-verifier and integration suite.

**No selection semantics.** The new lookup index
(`ix_export_manifests_p3_20_review_queue_item`) supports future reads of
"every historical manifest for this review item"; it is not, and cannot be
used as, a `latest`/`current`/`active` selector. No such column, method, or
query was added anywhere in this package.
