# KAI Generated-Content Review-Start Audit-Contract Patch Notes

## Owner decision on scope

Repository-evidence-driven repair: the reported production action
(generated Funder Evidence Summary → Generated Draft → Review →
`POST generated-content-review-queue/:reviewQueueItemId/start` → HTTP 422
`validation_blocker`) traces to a genuine repository defect, not a
production-only drift. `Backend/kai/dictionary/postgresGeneratedContentRepository.js`
has always written a `generated_content_review_started` audit row on every
real `/start` transaction (`START_REVIEW_AUDIT_OPERATION`), but no migration
ever added that operation string to `kai.upload_lifecycle_audit`'s
`upload_lifecycle_audit_gate_a_operation_check` allowlist - unlike its two
siblings, `generated_content_review_completed` (added by P3-04) and
`export_review_started` (added by P3-09). Every real `/start` database write
has therefore always raised SQLSTATE 23514 on that INSERT.

This package is scoped to exactly that gap: the missing audit-operation
allowlist entry and its metadata-only CHECK. It does not touch
`review_queue_items_p3_04_generated_content_review_contract_check` - that
constraint already admits the `queue_status='in_progress' AND
review_status='needs_gk_review'` state `startGeneratedContentReview`
transitions into, confirmed both by direct repository inspection and by
this package's own verifier.

## Added

- `migrations/kai_sprint2_generated_content_review_start_audit_contract.sql` /
  `.rollback.sql` - forward/rollback migration extending
  `upload_lifecycle_audit_gate_a_operation_check` to admit
  `generated_content_review_started` (monotonic predecessor-preservation:
  reads the current validated predicate via `pg_get_expr` and OR-extends it,
  never reconstructing a static historical allowlist - the same mechanism
  P3-04, P3-05, P3-09, and the P3-17 repair each established), and adding
  `upload_lifecycle_audit_gcrs_metadata_object_check`,
  a metadata-only CHECK derived from the exact fields
  `buildGeneratedContentStartReviewAuditMetadata` writes.
- `scripts/kai-sprint2-generated-content-review-start-audit-contract-verifier.sql` -
  catalog verification: the audit-operation vocabulary now includes the
  operation, the constraint is VALIDATED, the new metadata check exists, and
  `review_queue_items_p3_04_generated_content_review_contract_check` is left
  unmodified and already admits the in_progress/needs_gk_review state.
- `scripts/kai-sprint2-generated-content-review-start-audit-contract-smoke-seed.sql` /
  `-smoke-verifier.sql` - seeds one real generated-content-review queue item
  and a real `generated_content_review_started` audit row with the exact
  production metadata shape, then proves it persisted intact.
- `scripts/kai-sprint2-generated-content-review-start-audit-contract-failure-checks.sql` -
  negative checks: an unrelated invalid operation, missing required start
  metadata, a forbidden raw-content metadata key, and a wrong
  `generated_content_review` target all remain rejected (23514).
- `scripts/kai-sprint2-generated-content-review-start-audit-contract-local-postgres.js` -
  ephemeral loopback PostgreSQL 16 runner
  (`npm run verify:kai-sprint2-generated-content-review-start-audit-contract`),
  following the P3-04/P3-09 runners' exact mechanism: builds the real schema
  through P3-09, proves the real `startGeneratedContentReview` transaction is
  rejected (23514) BEFORE this migration, applies the migration (twice, to
  prove idempotence), runs the verifier/smoke/failure-check SQL, then proves
  the same transaction now commits with the exact expected durable shape,
  plus negative proofs (stale concurrency, wrong draft/queue relationship,
  invalid queue lifecycle, invalid/missing metadata, invalid operation).
- `__tests__/kai-sprint2-generated-content-review-start-audit-contract.integration.spec.js` -
  the real PostgreSQL-backed pre/post-migration proof described above,
  exercised through the real `startGeneratedContentReview` service function
  and `createPostgresGeneratedContentRepository` (no mocked `client.query`,
  no mocked persistence).
- `package.json` - added
  `verify:kai-sprint2-generated-content-review-start-audit-contract`. No
  existing script is changed.

## Not changed

No Gate A through P3-17 migration or rollback file is edited.
`review_queue_items_p3_04_generated_content_review_contract_check` is
untouched. No route, service authorization logic, or feature flag is
changed. `Backend/kai/dictionary/postgresGeneratedContentRepository.js` is
unchanged by this package (the separate, already-committed local diagnostic
fix to its error-mapping/blocker-propagation path is out of scope here and
remains a distinct, secondary repair).

## Behavior summary

**Before this migration**: every real `/start` transaction's audit INSERT
raises SQLSTATE 23514 on `upload_lifecycle_audit_gate_a_operation_check`,
which the repository's catch branch maps to `validation_blocker` (HTTP 422),
matching the reported production symptom exactly.

**After this migration**: the same transaction commits; the queue item
transitions to `in_progress`/`needs_gk_review`; a single
`generated_content_review_started` audit row persists with the exact
metadata-only contract; a replay of the identical request converges
idempotently with no second transition or audit row.
