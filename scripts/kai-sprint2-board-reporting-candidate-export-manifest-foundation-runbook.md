# KAI Board Reporting Candidate Export Manifest Foundation Runbook

This package creates one new, previously-untracked table - `kai.
board_reporting_candidate_export_manifests` - bound to an existing,
immutable BR-02 Board Reporting candidate and the exact effective BR-04
`export_authority_granted` decision that authorized it. It changes no Gate A
through BR-04 migration, rollback, runner, verifier, smoke, repository,
service, or route artifact, and it does not alter `kai.export_manifests`
(P3-19) or `kai.grant_response_packet_export_manifests` (P14-08A).

Run:

```sh
npm run verify:kai-sprint2-board-reporting-candidate-export-manifest-foundation
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates a synthetic database;
- applies the existing synthetic bootstrap schema and the existing frozen
  Gate A through BR-04 migrations, all unmodified, then this package's new
  forward migration;
- runs the new catalog verifier (which also proves the existing P3-19/
  P14-08A manifest tables remain unaltered if present);
- runs the new smoke seed, smoke verifier, and read-only failure checks;
- proves the rollback fails closed while any manifest row is persisted, then
  succeeds once the table is empty, then re-applies the forward migration
  and re-proves the verifier/smoke/failure checks;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback
address, port, and `listen_addresses`. It must not be pointed at a shared,
quarantined, cloud, production, or real-client-data database.

## Scope boundary

This package adds **no** manifest-create service, route, repository,
listener, or UI, and no Board delivery or final Board Summary. Synthetic
migration/smoke fixtures insert `kai.
board_reporting_candidate_export_manifests` rows directly for proof only,
the same way P3-19's, P14-08A's, and BR-04's own smoke-verifiers insert
their respective rows directly rather than through a service.

Not added in this package (explicitly out of scope):

- a manifest create service or route;
- Board delivery, final Board Summary, or any output artifact;
- `export_review_queue_item_id` binding (no `FUNCTIONAL_DEPENDENCY_PROOF`
  establishing a single valid Board review item per candidate has been
  established for this package - see the patch notes reuse decision);
- any final-eligibility snapshot column.

## Manifest identity model

`kai.board_reporting_candidate_export_manifests` columns:
`board_reporting_candidate_export_manifest_id` (PK), `organization_id`,
`board_reporting_candidate_id`, `effective_authority_decision_id`,
`effective_authority_decision_type` (pinned to `export_authority_granted`),
`fingerprint_contract_version` (pinned to
`kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1`),
`canonical_fingerprint` (lowercase 64-hex-char, checked by `CHECK`),
`created_by`, `created_by_type` (pinned to `human`), `created_at`.

**Candidate binding** (`brcem_candidate_fk`): a tenant-safe composite FK on
`(board_reporting_candidate_id, organization_id)` into `kai.
board_reporting_candidates` (BR-02) only - never `kai.export_candidates`
(member-level) or `kai.grant_response_packet_export_candidates`
(packet-level).

**Authority binding** (`brcem_authority_decision_fk`): a tenant-safe
composite FK on `(effective_authority_decision_id, organization_id,
board_reporting_candidate_id, effective_authority_decision_type)` into
`kai.board_reporting_candidate_human_authority_decisions` (BR-04) only -
the bound decision must belong to this same organization, candidate, and
decision type. A decision effective for one candidate can never be recorded
as the effective decision for another candidate's manifest.

**Replay/idempotency identity** (`brcem_replay_convergence_unique`): `UNIQUE
(organization_id, board_reporting_candidate_id, canonical_fingerprint)` - the
same effective-authority state submitted twice for the same candidate
converges to exactly one manifest row; a conflicting attempt with a
different manifest id or bound decision under the same
(organization, candidate, fingerprint) key is rejected, not silently
duplicated.

**Append-only**: `kai.brcem_reject_manifest_mutation`, attached as a
`BEFORE UPDATE OR DELETE` trigger, unconditionally raises an exception -
enforced at the database boundary, not just by convention.

## Rollback

`migrations/kai_sprint2_board_reporting_candidate_export_manifest_foundation.rollback.sql`
first fails closed if any row exists in `kai.
board_reporting_candidate_export_manifests` - dropping the table while a
manifest is persisted would silently destroy immutable manifest identity
history (mirroring the BR-04 rollback discipline, not the earlier
P3-19/P14-08A precedent, which drop unconditionally). Once the table is
empty, it drops the append-only trigger, `kai.
board_reporting_candidate_export_manifests`, and the
`kai.brcem_reject_manifest_mutation` function. It alters no Gate A through
BR-04 table, column, or constraint, and leaves `kai.export_manifests` and
`kai.grant_response_packet_export_manifests` untouched.
