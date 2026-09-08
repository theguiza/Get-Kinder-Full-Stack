# KAI P3-20 Export Manifest Durable Review Binding Runbook

This package persists, on every `kai.export_manifests` row, the exact
`export_review_queue_item_id` its own finalization call was made against -
implementing the accepted `FUNCTIONAL_DEPENDENCY_PROOF`'s
`SELECTED_MODEL: DIRECT_MANIFEST_REVIEW_BINDING`. It changes no P3-16
currentness/fingerprint, P3-17 effectiveness, P3-18/VAL-EXP-001, or P3-19
replay/fingerprint logic; it adds one column, one FK, one supporting tenant-
identity constraint on `kai.review_queue_items`, and one non-unique lookup
index.

Run:

```sh
npm run verify:kai-sprint2-p3-20-export-manifest-review-binding
```

(this is presently an alias for the same, extended,
`scripts/kai-sprint2-p3-19-export-manifest-foundation-local-postgres.js`
runner - see "Why one runner" below; `npm run
verify:kai-sprint2-p3-19-export-manifest-foundation` runs the identical
script).

The runner:

- creates a temporary data directory, starts PostgreSQL 16 bound only to
  `127.0.0.1`, creates the synthetic database;
- applies every existing Gate A through P3-19 migration and runs every
  existing P3-19 (and earlier) verifier, smoke-seed, smoke-verifier, and
  failure-check **exactly as before, unedited** - including
  `kai-sprint2-p3-19-export-manifest-foundation-smoke-verifier.sql`, which
  inserts one real manifest row (`manifest1`) bound to a real effective
  P3-17 grant decision;
- **only then** applies `migrations/kai_sprint2_p3_20_export_manifest_review_binding.sql`
  and proves its own 9-check catalog verifier;
- runs the new P3-20 smoke-seed (a revoke-then-re-grant cycle on the P3-19
  smoke-seed's own candidate), smoke-verifier, and failure-checks;
- runs the full P3-16 through P3-20 integration/boundary specs against that
  one runner-owned target;
- stops PostgreSQL and removes the temporary directory.

## Why the P3-19 runner is extended, not left alone

`Backend/kai/dictionary/postgresExportManifestRepository.js#createExportManifest`
is the one piece of shared, real-database-backed code this package changes:
its `INSERT` now always names `export_review_queue_item_id`. That repository
function is exercised, against a real database, by exactly one runner in
this repository -
`scripts/kai-sprint2-p3-19-export-manifest-foundation-local-postgres.js`
(via its own P3-19 integration spec). If that runner's own migration list
were left frozen at P3-19, its own integration spec would now fail with a
missing-column error the moment `createExportManifest` tried to insert. This
is the same situation this runner already resolved once before, when
`kai_sprint2_p3_17_authority_audit_gate_a_operation_repair.sql` (authored
after P3-17 shipped) had to be folded into this runner for its own P3-17
write-path tests to keep passing - so extending it again, in place, for
P3-20, follows the repository's own established precedent rather than
deviating from it. No other runner (P3-16's, P3-17's, P3-18's) ever applies
the P3-19 migration at all, so none of them are affected by this package.

## Deterministic backfill, proven against a real pre-existing row

Because P3-20 is applied only after the P3-19 smoke-verifier has already
inserted its own `manifest1` row (bound to a real effective grant decision,
with no `export_review_queue_item_id` column existing yet at that point in
the runner's timeline), that row is a genuine pre-P3-20 legacy row - not a
fabricated fixture. The P3-20 migration's own backfill loop resolves it,
inside the migration transaction, by joining
`export_manifests.export_candidate_id → export_candidates.generated_content_draft_id →`
the exactly-one (per P3-05's own unique index)
`kai.review_queue_items` row with `queue_type = 'export_review'` for that
draft. The P3-20 smoke-verifier's first check
(`legacy_manifest_backfilled_to_exact_review_item`) asserts the backfilled
value is exactly that review item's id.

If a future legacy row ever resolved to zero or more than one matching
review item, the migration raises an exception and refuses to proceed
(`RAISE EXCEPTION ... refusing to guess`) rather than picking one - per
owner instruction, this is a hard `STOP` condition, not a best-effort
selection, and this repository's own local/synthetic proof never exercises
that path because no such ambiguous row exists in it.

## Append-only preserved

`kai.export_manifests` keeps its P3-19 append-only trigger
(`trg_p3_19_export_manifests_append_only`) unconditionally rejecting
ordinary `UPDATE`/`DELETE`. The P3-20 migration's own backfill is the one
authorized, transaction-scoped exception: it disables the trigger only for
the duration of its own `UPDATE` statements and re-enables it before commit.
No application code path (repository, service, or test) can ever mutate an
existing manifest row after this migration completes - proven directly by
the P3-20 smoke-verifier's `ordinary_update_of_review_binding_rejected`
check.

## Cardinality preserved exactly as proven

No `UNIQUE (export_review_queue_item_id)` constraint exists anywhere. The
P3-20 smoke-verifier and integration spec both prove, against a real
database, that the same review item legitimately backs two distinct
historical manifests once a P3-17 revoke-then-re-grant cycle produces a
second effective decision on the same candidate - the exact cardinality the
accepted `FUNCTIONAL_DEPENDENCY_PROOF` required this package to preserve.

## Disclosed application-layer boundary (not silently assumed)

The new FK (`export_manifests_p3_20_review_queue_item_fk`) proves only that
the referenced `kai.review_queue_items` row exists and belongs to the same
`organization_id` as the manifest. `kai.review_queue_items` is deliberately
polymorphic across `queue_type` values with no FK of its own on
`target_object_id` (see P1-06's own migration notes), so the FK alone cannot
distinguish an `export_review`-typed row from, say, a
`generated_content_review`-typed row for the same draft. That distinction -
and the exact draft-identity match the accepted proof traced - is enforced
by `evaluateFinalExportEligibilityInTransaction` (via
`isExportReviewQueueContractRow`) inside the same write transaction as the
insert, before the FK is ever reached. The P3-20 failure-checks script
records this explicitly
(`cross_queue_type_review_item_is_a_documented_application_layer_boundary`)
rather than assuming it away.

## Scope boundary

Not added in this package (explicitly out of scope):

- any HTTP route, UI control, or read/page-reload recovery of a candidate's
  or manifest's identity (the deferred next dependency this package makes
  possible, not one it implements);
- any change to P3-16 currentness/fingerprint, P3-17 effectiveness,
  P3-18/VAL-EXP-001, or the P3-19 replay/fingerprint key;
- `latest`/`current`/`active` selection of any kind;
- artifact rendering, storage, signed URLs, download/retrieval;
- production database access, mutation, or migration application.
