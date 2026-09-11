# KAI Generated-Content Review-Start Audit-Contract Runbook

This package repairs one repository-confirmed gap: `kai.upload_lifecycle_audit`'s
`upload_lifecycle_audit_gate_a_operation_check` allowlist has never included
`generated_content_review_started`, the audit operation
`Backend/kai/dictionary/postgresGeneratedContentRepository.js` has always
written on every real `startGeneratedContentReview` (`/start`) transaction.
Every real `/start` database write has therefore always raised a PostgreSQL
23514 check-violation on that INSERT, surfaced to the client as HTTP 422
`validation_blocker`. This is the same class of gap P3-17's own
`kai_sprint2_p3_17_authority_audit_gate_a_operation_repair.sql` previously
fixed for a different operation, and mirrors exactly how P3-04 added
`generated_content_review_completed` and P3-09 added
`export_review_started`.

Run:

```sh
npm run verify:kai-sprint2-generated-content-review-start-audit-contract
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_gcrs_audit_contract_synthetic`;
- applies the existing organization-enablement/Gate-A synthetic bootstrap
  schemas and the frozen Gate A through P3-09 migrations (the exact
  predecessor state this repair extends);
- runs the existing Gate A/P1/P2 smoke seeds;
- **PRE-MIGRATION proof**: runs the integration suite in `pre` phase, which
  builds a real generated-content draft/review-queue item through the real
  `createEvidenceSummaryDraft` service call, then calls the real
  `startGeneratedContentReview` service function end to end and asserts it
  fails with `validation_blocker`/`VAL-REV-START-001`, that the queue item is
  left unchanged (`open`/`needs_gk_review`), and that no audit row was left
  behind - plus a direct raw-SQL proof of the exact SQLSTATE 23514 /
  `upload_lifecycle_audit_gate_a_operation_check` constraint name;
- applies this package's forward migration (twice, proving idempotence);
- runs this package's catalog verifier, smoke seed/verifier, and
  read-only failure-checks;
- **POST-MIGRATION proof**: runs the integration suite in `post` phase,
  proving the same real transaction now commits, the queue item transitions
  to `in_progress`/`needs_gk_review`, exactly one audit row persists with
  the exact expected metadata key set, a replay converges idempotently, and
  the negative cases (stale `expectedUpdatedAt`, wrong draft/queue pairing,
  already-in_progress replay, missing/invalid metadata, invalid operation)
  all remain fail-closed;
- runs the P3-04/P3-09/P3-01/P3-02 boundary regression specs;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback
address, port, and `listen_addresses`. It must not be pointed at a shared,
quarantined, cloud, production, or real-client-data database. The
integration spec skips itself unless
`KAI_GCRS_AUDIT_CONTRACT_DATABASE_URL` and an explicit
`KAI_GCRS_AUDIT_CONTRACT_PHASE` (`pre` or `post`) are set by that runner, and
validates the URL as loopback-only before any dynamic import.

## Scope boundary

Not changed by this package:

- `review_queue_items_p3_04_generated_content_review_contract_check` (already
  admits the `in_progress`/`needs_gk_review` lifecycle state; left in place
  and verified unmodified);
- any Gate A through P3-17 migration or rollback file;
- any route, authorization rule, or feature flag;
- `Backend/kai/dictionary/postgresGeneratedContentRepository.js` (the
  already-committed, separate local diagnostic fix to its
  22P02/23514-mapping and blocker-propagation path is a distinct, secondary
  repair, not part of this package).

## Production application (NOT executed by this package)

This package proves the repair locally only. Applying
`migrations/kai_sprint2_generated_content_review_start_audit_contract.sql`
to production requires separate, explicit owner authorization, following
whatever read-only production PostgreSQL inspection (via the established
pgAdmin surface) confirms about the live constraint's current predicate
first.
