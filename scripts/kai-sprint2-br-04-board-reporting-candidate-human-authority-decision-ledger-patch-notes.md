# KAI BR-04 Patch Notes — Board Reporting Candidate Human Authority Decision Ledger Foundation

## Owner decision on scope

BR-04 is authorized as exactly one new additive, append-only authoritative
foundation: a human final-release authority decision ledger for the single
decision type `export_authority_granted`, bound to an existing, immutable
BR-02 Board Reporting candidate. This is the same "human final-release
authority" concept the existing P3-17 `kai.human_authority_decisions` ledger
represents for a single-draft export candidate, and the same concept the
existing P14-07B1 `kai.grant_response_packet_human_authority_decisions`
ledger represents for a Grant Response Packet export candidate - not a
different concept (no `board_approved`/`board_release`/`board_finalized`
vocabulary). This package adds only the dormant persistence/schema
foundation - no runtime grant/revoke service, route, repository, or UI.

## Reuse decision

`BOARD_SPECIFIC_BINDING_REQUIRED`. Neither existing ledger's hard composite
candidate FK can represent a Board Reporting candidate: `kai.
human_authority_decisions` is pinned to `kai.export_candidates` (P3-16,
per-draft member export candidate), and `kai.
grant_response_packet_human_authority_decisions` is pinned to `kai.
grant_response_packet_export_candidates` (P14-03, packet-level Grant
candidate). `kai.board_reporting_candidates` (BR-02) is a third, structurally
disjoint immutable candidate table with no compatible row in either existing
table, so widening either existing FK into a polymorphic/nullable reference
was rejected for the same reason P14-07B1 rejected it for Grant packets:
this migration adds one Board-scoped sibling ledger instead, following the
established mechanism (append-only lineage, backward-pointer supersession,
root-is-grant, single-successor, gk_admin-only role) rather than cloning
either existing table's specific columns/checks.

## Added

- `migrations/kai_sprint2_br_04_board_reporting_candidate_human_authority_decision_ledger.sql`
  / `.rollback.sql` — forward/rollback migration creating `kai.
  board_reporting_candidate_human_authority_decisions`, the append-only
  `supersedes_decision_id` backward-pointer lineage (scoped by a composite
  self-referencing FK to the same organization/Board-candidate/decision-type),
  the partial unique indexes enforcing at most one root decision per lineage
  and at most one direct successor per predecessor, and the `kai.
  br_04_reject_authority_mutation` trigger rejecting ordinary
  `UPDATE`/`DELETE`. No existing table, column, constraint, or lifecycle from
  Gate A through BR-03B is altered; the existing P3-17 and P14-07B1 ledgers
  and their FKs into `kai.export_candidates` / `kai.
  grant_response_packet_export_candidates` are untouched.
- `scripts/kai-sprint2-br-04-board-reporting-candidate-human-authority-decision-ledger-verifier.sql` —
  catalog verification (table, constraints, indexes, trigger, absence of any
  audience column, and the "P3-17/P14-07B1 unaltered" negative checks).
- `scripts/kai-sprint2-br-04-board-reporting-candidate-human-authority-decision-ledger-smoke-seed.sql` —
  seeds the exact resolved/resolved (COMPLETE) BR-03B smoke candidate as
  candidate A, and the in-progress (START) BR-03B smoke candidate as
  candidate B, with a root grant on candidate A only.
- `scripts/kai-sprint2-br-04-board-reporting-candidate-human-authority-decision-ledger-smoke-verifier.sql` —
  exercises candidate binding, root-must-be-grant, append-only grant/revoke
  lineage, and cross-candidate isolation directly in SQL.
- `scripts/kai-sprint2-br-04-board-reporting-candidate-human-authority-decision-ledger-failure-checks.sql` —
  read-only (each attempted write is caught and its effect never committed)
  negative checks: malformed decision-type/action vocabulary,
  self-superseding, cross-candidate lineage, cross-decision-type/table
  substitution, a missing candidate reference, a role mismatch, and a
  non-human `created_by_type`.
- `scripts/kai-sprint2-br-04-board-reporting-candidate-human-authority-decision-ledger-local-postgres.js` —
  ephemeral loopback PostgreSQL 16 runner
  (`npm run verify:kai-sprint2-br-04-board-reporting-candidate-human-authority-decision-ledger`),
  following the P14-07B1/BR-03B runner mechanism, and additionally proving
  the rollback fails closed while any decision row is persisted (a stricter
  invariant than the P3-17/P14-07B1 precedents, which drop unconditionally).

## Changed (additive only)

- `package.json` — added
  `verify:kai-sprint2-br-04-board-reporting-candidate-human-authority-decision-ledger`.
  No existing script is changed.

## Not changed

No Gate A through BR-03B migration, rollback, runner, verifier, smoke,
repository, service, or route file was edited. `kai.
board_reporting_candidates`, `kai.board_reporting_candidate_members`,
`kai.human_authority_decisions`, `kai.
grant_response_packet_human_authority_decisions`, `kai.review_queue_items`,
the Board review lifecycle contract, and every other authority/candidate
table are unchanged and unreferenced by any write in this package. No route,
listener, scheduler, startup hook, UI control, manifest, export artifact/
event, human grant/revoke operation, or production composition was added.

## Behavior summary

**Decision model.** Each row in `kai.
board_reporting_candidate_human_authority_decisions` is one immutable
decision event: `decision_type` (pinned to `export_authority_granted`),
`decision_action` (`grant` or `revoke`), `decided_by`/`decided_by_role`
(pinned to `gk_admin`), and `board_reporting_candidate_id` binding it to
exactly one BR-02 Board Reporting candidate. The first event in a lineage
must be a `grant` (enforced by a `CHECK` on root rows); every later event
names its predecessor via `supersedes_decision_id`, a backward pointer
written once at `INSERT` time - never a forward pointer, and never an
`UPDATE` of an earlier row. A re-grant after a revoke is simply another
successor event. One predecessor may have at most one successor, and each
`(organization, board_reporting_candidate_id, decision_type)` lineage has one
deterministic head - the unique row no other row names as its predecessor.

**Human ownership.** `export_authority_granted` requires `decided_by_role =
gk_admin`. This is a single `CHECK` constraint - there is no code path that
can record a decision under any other role.

**Candidate binding.** Every decision binds to exactly one existing BR-02
Board Reporting candidate via a composite foreign key on
`(board_reporting_candidate_id, organization_id)`; the candidate is the
source of truth for organization, engagement, and canonical fingerprint. No
audience-compatibility trigger exists here (unlike P3-17's funder_ready/
public_ready trigger) because a Board Reporting candidate's
`packet_audience` is always exactly `internal`
(`board_reporting_candidates_br_02_audience_chk`), so there is no distinct
audience to enforce - and no `requested_audience`/`packet_audience` column is
duplicated onto the ledger row.

**Not enforced here (deliberately deferred to a future authority mutation
service).** Whether the bound candidate's `board_reporting_candidate_review`
queue item is resolved (`queue_status = 'resolved'`, `review_status =
'resolved'`) is a runtime authorization precondition, mirroring how the
existing Grant final-release path checks `exportCandidateId` +
`exportReviewQueueItemId` together at the service layer rather than as a
table constraint. Neither existing ledger (P3-17, P14-07B1) encodes its own
review-queue state as a schema constraint, and this package does not invent
that pattern.

**Fails closed on rollback.** Unlike the P3-17/P14-07B1 precedents (which
drop their tables unconditionally), this rollback refuses to run while any
row exists in `kai.
board_reporting_candidate_human_authority_decisions` - dropping the table
while a decision is persisted would silently destroy immutable human
authority history.
