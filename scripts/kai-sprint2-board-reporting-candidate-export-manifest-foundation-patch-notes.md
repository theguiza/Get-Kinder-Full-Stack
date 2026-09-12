# KAI Patch Notes — Board Reporting Candidate Export Manifest Schema Foundation

## Owner decision on scope

Authorized as exactly one new additive, append-only schema foundation: a
Board-specific export-manifest identity table binding an existing, immutable
BR-02 Board Reporting candidate to the exact effective BR-04
`export_authority_granted` decision that authorized it, plus its migration
package and an ephemeral-PostgreSQL structural proof. No manifest create
service, route, Board delivery, final Board Summary, production migration,
or push was performed. `BOARD_SPECIFIC_MANIFEST_REQUIRED` and
`SCHEMA_CHANGE_REQUIRED` were established by prior inspection and are not
reopened here.

## Reuse decision

The closest existing precedent is P14-08A's `kai.
grant_response_packet_export_manifests`, itself the packet-level sibling of
P3-19's `kai.export_manifests`. Neither existing manifest table's hard
composite candidate/authority FKs can represent a Board Reporting candidate:
`kai.export_manifests` is pinned to `kai.export_candidates` /
`kai.human_authority_decisions` (member-level, P3-16/P3-17), and `kai.
grant_response_packet_export_manifests` is pinned to `kai.
grant_response_packet_export_candidates` / `kai.
grant_response_packet_human_authority_decisions` (packet-level, P14-03/
P14-07B1). `kai.board_reporting_candidates` (BR-02) and `kai.
board_reporting_candidate_human_authority_decisions` (BR-04) are a third,
structurally disjoint candidate/authority lineage with no compatible row in
either existing pair, so widening either existing manifest table's FKs into
a polymorphic/nullable reference was rejected for the same reason P14-08A
rejected it for packets: this migration adds one Board-scoped sibling
manifest table instead, following the established identity shape (id/org
unique key, replay-convergence unique key, tenant-safe composite candidate
and authority FKs, pinned decision-type/fingerprint-contract-version/
created-by-type checks, append-only trigger) rather than inventing a new
polymorphic manifest identity.

## Review binding and final-eligibility snapshot: not persisted

Unlike P3-19's `kai.export_manifests`, which later gained an
`export_review_queue_item_id` binding column in the separate P3-20
migration only after an accepted `FUNCTIONAL_DEPENDENCY_PROOF` established
that exactly one `export_review` queue item is ever valid for a given
manifest's candidate, **no equivalent proof has been established for Board
Reporting** in this package or any prior accepted package. This foundation
therefore persists no `board_reporting_candidate_review` queue-item
identity on the manifest row - the same posture P14-08A's foundation itself
took (it has no P3-20-equivalent follow-on migration at all). If such a
proof is established for Board in a future package, review binding can be
added the same way P3-20 added it: a separate, additive migration widening
this table, not a change to this foundation.

Similarly, no final-eligibility snapshot (`finalGate`-equivalent) field is
persisted. The existing Board final-eligibility gate
(`kaiBoardReportingFinalEligibilityGateService.evaluateBoardReportingFinalEligibility`)
is a fresh, read-only, run-time composition over current governed state; no
inspected manifest or Board contract establishes that a point-in-time copy
of that composition belongs in durable manifest identity, and this package
does not invent that pattern.

## Added

- `migrations/kai_sprint2_board_reporting_candidate_export_manifest_foundation.sql`
  / `.rollback.sql` — forward/rollback migration creating `kai.
  board_reporting_candidate_export_manifests`: id/org identity, replay-
  convergence unique key, tenant-safe composite candidate FK (into BR-02)
  and authority-decision FK (into BR-04), pinned decision-type/fingerprint-
  contract-version/canonical-fingerprint-shape/created-by-type checks, and
  the `kai.brcem_reject_manifest_mutation` append-only trigger. Fails closed
  on rollback while any manifest row is persisted, mirroring the BR-04
  rollback discipline.
- `scripts/kai-sprint2-board-reporting-candidate-export-manifest-foundation-verifier.sql`
  — catalog verification (table, constraints, trigger, absence of any
  review-queue-item/audience/eligibility-snapshot column, and the existing
  P3-19/P14-08A "unaltered" negative checks).
- `scripts/kai-sprint2-board-reporting-candidate-export-manifest-foundation-smoke-seed.sql`
  — seeds the exact BR-04 smoke candidates/decision (converging on the same
  rows via `ON CONFLICT ... DO NOTHING`) and one manifest row for candidate
  A bound to its effective root grant decision.
- `scripts/kai-sprint2-board-reporting-candidate-export-manifest-foundation-smoke-verifier.sql`
  — exercises candidate/authority binding, cross-candidate isolation, and
  replay convergence directly in SQL.
- `scripts/kai-sprint2-board-reporting-candidate-export-manifest-foundation-failure-checks.sql`
  — read-only (each attempted write is caught and its effect never
  committed) negative checks: malformed fingerprint contract version/shape,
  malformed decision type, non-human `created_by_type`, a missing candidate
  reference, a missing authority-decision reference, cross-candidate
  authority-decision substitution, member-candidate substitution, wrong-
  tenant candidate binding, conflicting replay identity, and append-only
  `UPDATE`/`DELETE` rejection.
- `scripts/kai-sprint2-board-reporting-candidate-export-manifest-foundation-local-postgres.js`
  — ephemeral loopback PostgreSQL 16 runner
  (`npm run verify:kai-sprint2-board-reporting-candidate-export-manifest-foundation`),
  extending BR-04's runner-installed migration chain with BR-04's own
  migration as an additional prerequisite before applying this package's
  forward migration.

## Changed (additive only)

- `package.json` — added
  `verify:kai-sprint2-board-reporting-candidate-export-manifest-foundation`.
  No existing script is changed.

## Not changed

No Gate A through BR-04 migration, rollback, runner, verifier, smoke,
repository, service, or route file was edited. `kai.export_manifests`
(P3-19) and `kai.grant_response_packet_export_manifests` (P14-08A) are
unchanged and unreferenced by any write in this package. No manifest-create
service, route, listener, scheduler, UI control, Board delivery, final
Board Summary, or production composition was added. No production/shared
database migration, deployment, or push was performed.
