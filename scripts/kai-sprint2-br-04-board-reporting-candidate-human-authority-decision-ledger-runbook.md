# KAI BR-04 Board Reporting Candidate Human Authority Decision Ledger Foundation Runbook

This package creates one new, previously-untracked table - `kai.
board_reporting_candidate_human_authority_decisions` - bound to an existing,
immutable BR-02 Board Reporting candidate. It changes no Gate A through
BR-03B migration, rollback, runner, verifier, smoke, repository, service, or
route artifact.

Run:

```sh
npm run verify:kai-sprint2-br-04-board-reporting-candidate-human-authority-decision-ledger
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database
  `kai_br_04_board_reporting_candidate_human_authority_decision_ledger_synthetic`;
- applies the existing synthetic bootstrap schema and the existing frozen
  Gate A through BR-03B migrations, all unmodified, then the new BR-04
  forward migration;
- runs the new BR-04 catalog verifier (which also proves the existing
  P3-17/P14-07B1 candidate FKs remain unaltered);
- runs the new BR-04 smoke seed, smoke verifier, and read-only failure
  checks;
- proves the rollback fails closed while any decision row is persisted, then
  succeeds once the ledger is empty, then re-applies the forward migration
  and re-proves the verifier/smoke/failure checks;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback
address, port, and `listen_addresses`. It must not be pointed at a shared,
quarantined, cloud, production, or real-client-data database.

## Scope boundary

This package adds **no** runtime grant/revoke service, route, repository,
listener, or UI. Synthetic migration/smoke fixtures insert `kai.
board_reporting_candidate_human_authority_decisions` rows directly for proof
only, the same way P3-17's and P14-07B1's own smoke-verifiers insert their
respective ledger rows directly rather than through a service.

Not added in this package (explicitly out of scope):

- Board human grant/revoke routes, services, or UI;
- reading/enforcing `board_reporting_candidate_review` queue resolution as
  an authorization precondition (deferred to the future mutation service);
- Board final eligibility, `finalGate`-equivalent, manifest, or delivery
  state.

## Decision model

`kai.board_reporting_candidate_human_authority_decisions` columns:
`decision_id` (PK), `organization_id`, `board_reporting_candidate_id`,
`decision_type`, `decision_action`, `decided_by`, `decided_by_role`,
`supersedes_decision_id`, `created_by_type` (pinned to `'human'`),
`created_at`.

**Decision type**: `export_authority_granted` only (`CHECK`) - the same
label the existing P3-17 and P14-07B1 ledgers use for the equivalent
concept; no `board_approved`/`board_release`/`board_finalized` vocabulary
was invented. **Decision actions**: `grant`, `revoke`.

**Human ownership** (`brchad_br_04_role_check`): `export_authority_granted`
requires `decided_by_role = 'gk_admin'`.

**The first event in a lineage must be a grant**
(`brchad_br_04_root_is_grant_check`): a root row (no predecessor) can never
be a `revoke`.

### Append-only lineage (backward pointer, following the P3-17/P14-07B1 pattern)

```
new decision
    -> supersedes_decision_id
prior decision
```

- `supersedes_decision_id` is `NULL` for the first (root) decision of a
  lineage, and otherwise names the prior current head - set once, at
  `INSERT` time, and never altered afterward.
- `brchad_br_04_supersedes_fk` is a composite, non-deferred, self-referencing
  foreign key on `(supersedes_decision_id, organization_id,
  board_reporting_candidate_id, decision_type)`: a predecessor must already
  exist and must belong to the exact same organization, Board candidate, and
  decision type as the new row. Lineage can never cross organization,
  candidate, or decision type.
- `ux_brchad_br_04_root_per_lineage` (partial unique index on
  `(organization_id, board_reporting_candidate_id, decision_type)` where
  `supersedes_decision_id IS NULL`) allows at most one root decision per
  lineage.
- `ux_brchad_br_04_single_successor` (partial unique index on
  `supersedes_decision_id` where it is not null) allows at most one direct
  successor per predecessor. Combined with the root-per-lineage index, a
  lineage is always a single linear chain, and its current head is always
  the unique row that no other row names as its predecessor.
- `brchad_br_04_not_self_superseding`
  (`CHECK (supersedes_decision_id IS DISTINCT FROM decision_id)`) rejects a
  decision naming itself as its own predecessor.
- `kai.br_04_reject_authority_mutation`, attached as a `BEFORE UPDATE OR
  DELETE` trigger, unconditionally raises an exception. Ordinary application
  code, migrations, or ad-hoc SQL cannot rewrite or remove any persisted
  decision - this is enforced at the database boundary.

## Candidate binding

`brchad_br_04_candidate_fk` binds every decision to exactly one existing
`(board_reporting_candidate_id, organization_id)` row in `kai.
board_reporting_candidates` (BR-02) - the candidate is the source of truth
for organization, engagement, and canonical fingerprint. No caller-supplied
copy of those facts is trusted, and none is duplicated onto the ledger row.
No audience-compatibility trigger exists (unlike P3-17's funder_ready/
public_ready trigger) because a Board Reporting candidate's
`packet_audience` is always exactly `internal`.

## Rollback

`migrations/kai_sprint2_br_04_board_reporting_candidate_human_authority_decision_ledger.rollback.sql`
first fails closed if any row exists in `kai.
board_reporting_candidate_human_authority_decisions` - dropping the table
while a decision is persisted would silently destroy immutable human
authority history, which neither the P3-17 nor P14-07B1 rollback precedent
guards against but this package requires. Once the table is empty, it drops
the append-only trigger, `kai.
board_reporting_candidate_human_authority_decisions`, and the
`kai.br_04_reject_authority_mutation` function (child-first). It alters no
Gate A through BR-03B table, column, or constraint, and leaves the existing
P3-17/P14-07B1 ledgers and all other Board/review-queue/candidate state
untouched.
