# KAI P3-17 Human Authority Decision Ledger Foundation Runbook

This package creates one new, previously-untracked table -
`kai.human_authority_decisions` - and exactly one dormant, read-only
evaluator: `evaluateHumanAuthorityEffectivenessInTransaction`. It changes no
Gate A through P3-16 migration, rollback, runner, verifier, smoke,
repository, service, or route artifact.

Run:

```sh
npm run verify:kai-sprint2-p3-17-human-authority-decision-ledger
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database
  `kai_p3_17_human_authority_decision_ledger_synthetic`;
- applies the existing synthetic bootstrap schema and the existing frozen
  Gate A through P3-16 migrations, all unmodified, then the new P3-17
  forward migration;
- runs the P3-04/P3-13/P3-16 verifiers (regression) and the new P3-17
  catalog verifier;
- runs the existing Gate A through P3-16 smoke seeds/verifiers/failure
  checks, then the new P3-17 smoke seed, smoke verifier, and read-only
  failure checks;
- runs the P3-17 integration and boundary specs together with the P3-16
  through P3-01 focused regression specs against that runner-owned target
  only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback
address, port, and `listen_addresses`. It must not be pointed at a shared,
quarantined, cloud, production, or real-client-data database. The
integration spec skips itself unless
`KAI_P3_17_HUMAN_AUTHORITY_DECISION_LEDGER_DATABASE_URL` is set by that
runner, and validates it as loopback-only before any dynamic import.

The non-database boundary spec
(`__tests__/kai-sprint2-p3-17-human-authority-decision-ledger-boundary.spec.js`)
runs in the normal suites and needs no database.

## Scope boundary

This package adds **no** runtime grant/revoke service, route, listener, or
UI. `Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js`
exposes exactly one method, `evaluateEffectiveness`, on its factory - there
is no write path anywhere in this file or package. Synthetic migration/smoke
fixtures insert `kai.human_authority_decisions` rows directly for proof only,
the same way P3-16's own smoke-verifier inserts `limitation_snapshots`/
`export_candidates` rows directly rather than through a service.

Not added in this package (explicitly out of scope):

- human grant/revoke routes or UI;
- client/funder/public readiness operations;
- export-authority operation;
- `finalGate`;
- `draftIsStillDraft`/VAL-EXP-001 wiring;
- `exportEligible = true`;
- manifest;
- export artifact/event.

## Decision model

`kai.human_authority_decisions` columns: `decision_id` (PK), `organization_id`,
`export_candidate_id`, `decision_type`, `decision_action`, `decided_by`,
`decided_by_role`, `supersedes_decision_id`, `created_by_type` (pinned to
`'human'`), `created_at`.

**Decision types**: `client_reviewed`, `funder_ready`, `public_ready`,
`export_authority_granted`. **Decision actions**: `grant`, `revoke`.

**Human ownership** (`human_authority_decisions_p3_17_role_by_type_check`):
`client_reviewed` requires `decided_by_role = 'client_reviewer'`; every other
decision type requires `decided_by_role = 'gk_admin'`.

**The first event in a lineage must be a grant**
(`human_authority_decisions_p3_17_root_is_grant_check`): a root row (no
predecessor) can never be a `revoke`.

### Append-only lineage (backward pointer, following the P3-16 corrected pattern)

```
new decision
    -> supersedes_decision_id
prior decision
```

- `supersedes_decision_id` is `NULL` for the first (root) decision of a
  lineage, and otherwise names the prior current head - set once, at
  `INSERT` time, and never altered afterward.
- `human_authority_decisions_p3_17_supersedes_fk` is a composite,
  non-deferred, self-referencing foreign key on `(supersedes_decision_id,
  organization_id, export_candidate_id, decision_type)`: a predecessor must
  already exist and must belong to the exact same organization, export
  candidate, and decision type as the new row. Lineage can never cross
  organization, candidate, or decision type.
- `ux_human_authority_decisions_p3_17_root_per_lineage` (partial unique index
  on `(organization_id, export_candidate_id, decision_type)` where
  `supersedes_decision_id IS NULL`) allows at most one root decision per
  lineage.
- `ux_human_authority_decisions_p3_17_single_successor` (partial unique index
  on `supersedes_decision_id` where it is not null) allows at most one direct
  successor per predecessor. Combined with the root-per-lineage index, a
  lineage is always a single linear chain, never a forest or a branch, and
  its **current head** is always the unique row that no other row names as
  its predecessor.
- `human_authority_decisions_p3_17_not_self_superseding`
  (`CHECK (supersedes_decision_id IS DISTINCT FROM decision_id)`) rejects a
  decision naming itself as its own predecessor - the self-referencing FK
  alone cannot catch this case, since a self-referencing row always satisfies
  its own FK.
- A re-grant after a revoke is simply another successor event, exactly like
  any other supersession.
- `kai.p3_17_reject_authority_mutation`, attached as a `BEFORE UPDATE OR
  DELETE` trigger, unconditionally raises an exception. Ordinary application
  code, migrations, or ad-hoc SQL cannot rewrite or remove any persisted
  decision - this is enforced at the database boundary.

## Candidate binding and audience compatibility

`human_authority_decisions_p3_17_candidate_fk` binds every decision to
exactly one existing `(export_candidate_id, organization_id)` row in
`kai.export_candidates` (P3-16) - the candidate is the source of truth for
organization, requested audience, canonical fingerprint, and
fingerprint-contract identity. No caller-supplied copy of those facts is
trusted, and none is duplicated onto the ledger row.

`kai.p3_17_enforce_decision_audience_compatibility`, a `BEFORE INSERT`
trigger, reads the bound candidate's own `requested_audience` and rejects:

- `funder_ready` bound to any candidate whose `requested_audience <> 'funder'`;
- `public_ready` bound to any candidate whose `requested_audience <> 'public'`.

`client_reviewed` and `export_authority_granted` are not restricted by this
trigger - they remain bound to the candidate's actual audience, whatever it
is. `funder_ready` is never inferred from `public_ready` or vice versa; each
is its own independent lineage keyed by its own `decision_type`.

## Effective authority (private, not wired)

`evaluateHumanAuthorityEffectivenessInTransaction` (exported only via
`__humanAuthorityDecisionRepositoryTestables` for this package's own tests,
and publicly as `evaluateEffectiveness` on
`createPostgresHumanAuthorityDecisionRepository(...)`) derives, for a given
`(organizationId, exportCandidateId, decisionType)`:

```
effective = current head exists
  AND current head action = 'grant'
  AND bound P3-16 export candidate is still current
```

"Still current" is checked the same cheap way P3-16's own currentness
evaluator checks it first: the candidate's bound `limitation_snapshot_id` has
no successor in `kai.limitation_snapshots`. If the bound snapshot has since
been superseded, an old grant becomes ineffective **without any mutation** of
the ledger row - the evaluator is read-only end to end.

Fails closed (`effective: false`) with a `reason` on:

- `no_decision` — no decision has ever been recorded for this lineage;
- `head_is_revoke` — the current head's action is `revoke`;
- `lineage_ambiguous` — more than one row was read back as a head (defensive
  only; the database's own root-per-lineage/single-successor unique indexes
  make this state unreachable in practice);
- `export_candidate_missing` / `limitation_snapshot_superseded` — the bound
  P3-16 export candidate no longer exists or is no longer current.

Historical decisions remain immutable and queryable via the ledger even when
no longer effective. Queue resolution, role possession, audit history, and
absence of blockers are never read by this evaluator and never substitute
for an authority decision. It is not called from VAL-EXP-001, `finalGate`,
`exportEligible`, or any route - that wiring is explicitly out of scope for
this package.

## Rollback

`migrations/kai_sprint2_p3_17_human_authority_decision_ledger.rollback.sql`
drops the audience-compatibility trigger, the append-only trigger,
`kai.human_authority_decisions`, and the
`kai.p3_17_enforce_decision_audience_compatibility` and
`kai.p3_17_reject_authority_mutation` functions (child-first). It alters no
Gate A through P3-16 table, column, or constraint, and leaves all unrelated
generated-content/review-queue/draft/export-candidate/limitation-snapshot
state untouched.
