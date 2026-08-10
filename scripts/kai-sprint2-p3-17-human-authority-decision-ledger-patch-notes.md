# KAI P3-17 Patch Notes — Human Authority Decision Ledger Foundation

## Owner decision on scope

P3-17 is authorized as exactly one new additive, append-only authoritative
foundation: a human authority decision ledger for four decision types -
`client_reviewed`, `funder_ready`, `public_ready`, `export_authority_granted`
- each bound to an existing P3-16 export candidate. `finalGate` is not a
human decision and remains a later system preflight seal, out of scope here.
Queue resolution, role possession, audit history, absence of blockers, and
`exportEligible` never substitute for an authority decision. This package
adds only the dormant persistence/read foundation - no runtime grant/revoke
service, route, or UI.

## Added

- `migrations/kai_sprint2_p3_17_human_authority_decision_ledger.sql` /
  `.rollback.sql` — forward/rollback migration creating
  `kai.human_authority_decisions`, the append-only `supersedes_decision_id`
  backward-pointer lineage (scoped by a composite self-referencing FK to the
  same organization/export-candidate/decision-type), the partial unique
  indexes enforcing at most one root decision per lineage and at most one
  direct successor per predecessor, the `kai.p3_17_reject_authority_mutation`
  trigger rejecting ordinary `UPDATE`/`DELETE`, and the
  `kai.p3_17_enforce_decision_audience_compatibility` trigger enforcing that
  `funder_ready`/`public_ready` may only bind a candidate of the matching
  requested audience. No existing table, column, constraint, or lifecycle
  from Gate A through P3-16 is altered.
- `scripts/kai-sprint2-p3-17-human-authority-decision-ledger-verifier.sql` —
  catalog verification (table, constraints, indexes, triggers, and the "no
  finalGate/manifest/export-artifact state anywhere" negative check).
- `scripts/kai-sprint2-p3-17-human-authority-decision-ledger-smoke-seed.sql` —
  seeds three real, fully-eligible P3-16 export candidates for org1, one per
  requested audience (internal, funder, public).
- `scripts/kai-sprint2-p3-17-human-authority-decision-ledger-smoke-verifier.sql` —
  exercises audience compatibility, role/type compatibility, candidate
  binding, root-must-be-grant, append-only grant/revoke/re-grant lineage, and
  fork rejection directly in SQL.
- `scripts/kai-sprint2-p3-17-human-authority-decision-ledger-failure-checks.sql` —
  read-only (each attempted write is caught and its effect never committed)
  negative checks: malformed decision-type/action vocabulary,
  self-superseding, cross-candidate lineage, cross-decision-type lineage, a
  missing candidate reference, a role/type mismatch, and a non-human
  `created_by_type`.
- `scripts/kai-sprint2-p3-17-human-authority-decision-ledger-local-postgres.js` —
  ephemeral loopback PostgreSQL 16 runner
  (`npm run verify:kai-sprint2-p3-17-human-authority-decision-ledger`),
  following the P3-16 runner's exact mechanism.
- `Backend/kai/dictionary/humanAuthorityDecisionContract.js` — static
  contract constants (exact decision-type/action vocabulary, decision-type to
  required-role map, decision-type to required-audience map).
- `Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js` — the
  private, read-only `evaluateHumanAuthorityEffectivenessInTransaction`
  evaluator, exposed publicly only as `evaluateEffectiveness` on the
  repository factory - no grant/revoke write method exists anywhere in this
  file. Not wired into VAL-EXP-001 or any route.
- `__tests__/kai-sprint2-p3-17-human-authority-decision-ledger-boundary.spec.js`,
  `.integration.spec.js` — focused boundary (pure-function, no database) and
  PostgreSQL-backed integration coverage.

## Changed (additive only)

- `package.json` — added
  `verify:kai-sprint2-p3-17-human-authority-decision-ledger` and
  `test:kai-sprint2-p3-17-human-authority-decision-ledger` scripts. No
  existing script is changed.

## Not changed

No Gate A through P3-16 migration, rollback, runner, verifier, smoke,
repository, service, or route file was edited. `kai.export_candidates` and
`kai.limitation_snapshots` (P3-16), `draft_status`, the generated-content and
export-review lifecycle contracts, `exportEligible`, and `finalGate` are
unchanged and unreferenced by any write in this package. No route, listener,
scheduler, startup hook, UI control, manifest, export artifact/event, human
grant/revoke operation, or production composition was added.

## Behavior summary

**Decision model.** Each row in `kai.human_authority_decisions` is one
immutable decision event: `decision_type` (one of the four accepted types),
`decision_action` (`grant` or `revoke`), `decided_by`/`decided_by_role`, and
`export_candidate_id` binding it to exactly one P3-16 export candidate. The
first event in a lineage must be a `grant` (enforced by a `CHECK` on root
rows); every later event names its predecessor via `supersedes_decision_id`,
a backward pointer written once at `INSERT` time on the new row - never a
forward pointer, and never an `UPDATE` of an earlier row. A re-grant after a
revoke is simply another successor event. One predecessor may have at most
one successor, and each `(organization, export_candidate_id, decision_type)`
lineage has one deterministic head - the unique row no other row names as its
predecessor - enforced by the same two-partial-unique-index pattern P3-16
uses for limitation-snapshot lineage.

**Human ownership.** `client_reviewed` requires `decided_by_role =
client_reviewer`; every other decision type requires `decided_by_role =
gk_admin`. This is a single `CHECK` constraint - there is no code path that
can record a `client_reviewed` decision under `gk_admin` or vice versa.

**Candidate binding.** Every decision binds to exactly one existing P3-16
export candidate via a composite foreign key on `(export_candidate_id,
organization_id)`; the candidate is the source of truth for organization,
requested audience, and identity. `funder_ready` may only bind a candidate
whose `requested_audience = 'funder'`; `public_ready` may only bind a
candidate whose `requested_audience = 'public'` - enforced by a `BEFORE
INSERT` trigger that reads the candidate's own audience rather than trusting
any caller-supplied or duplicated copy of it. `client_reviewed` and
`export_authority_granted` remain bound to the candidate's actual audience,
whatever it is, without restriction. No audience value is duplicated onto the
ledger row.

**Effective authority (read-only, not wired).**
`evaluateHumanAuthorityEffectivenessInTransaction` derives: current head
exists AND current head action = `grant` AND the bound P3-16 export candidate
is still current (its bound limitation snapshot has not been superseded).
Historical decisions remain immutable and queryable even when no longer
effective. This evaluator is read-only, exported only via
`createPostgresHumanAuthorityDecisionRepository(...).evaluateEffectiveness`,
and is not called from VAL-EXP-001, `exportEligible`, `finalGate`, or any
route - that wiring is explicitly out of scope for this package.

**Fails closed** on: no decision recorded, a revoke as the current head, an
ambiguous (multi-row) head (defensive; the database's own constraints already
make this state unreachable), a missing/inconsistent candidate binding, or a
stale bound P3-16 export candidate. Queue resolution, role possession, audit
history, and absence of blockers never substitute for an authority decision -
none of those signals are read by the evaluator at all.
