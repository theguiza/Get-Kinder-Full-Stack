# KAI P3-16 Export-Candidate Identity and Limitation-Snapshot Foundation Runbook

This package creates three new, previously-untracked tables —
`kai.limitation_snapshots`, `kai.limitation_snapshot_entries`, and
`kai.export_candidates` — and two narrow, human-authorized, dormant write
paths: `confirmGeneratedDraftLimitationSnapshot` and
`createGeneratedDraftExportCandidate`. It changes no Gate A through P3-15
migration, rollback, runner, verifier, smoke, repository, service, or route
artifact, other than the additive `ALTER TABLE` statements this package's own
forward migration issues against `kai.upload_lifecycle_audit` (see "Additive
schema changes to earlier tables" below).

Run:

```sh
npm run verify:kai-sprint2-p3-16-export-candidate-foundation
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_p3_16_export_candidate_foundation_synthetic`;
- applies the existing synthetic bootstrap schema and the existing frozen Gate
  A through P3-13 migrations, all unmodified, then the new P3-16 forward
  migration;
- runs the P3-04 and P3-13 verifiers (regression) and the new P3-16 catalog
  verifier;
- runs the existing Gate A through P2-03 smoke seeds, then the new P3-16
  smoke seed, smoke verifier, and read-only failure checks;
- runs the P3-16 integration and boundary specs together with the P3-01
  through P3-13 focused regression specs against that runner-owned target
  only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback
address, port, and `listen_addresses`. It must not be pointed at a shared,
quarantined, cloud, production, or real-client-data database. The integration
spec skips itself unless `KAI_P3_16_EXPORT_CANDIDATE_FOUNDATION_DATABASE_URL`
is set by that runner, and validates it as loopback-only before any dynamic
import.

The non-database boundary spec
(`__tests__/kai-sprint2-p3-16-export-candidate-foundation-boundary.spec.js`)
runs in the normal suites and needs no database.

## Scope

`Backend/kai/dictionary/postgresExportCandidateRepository.js` is the only
authorized location for this package's SQL. `Backend/kai/services/kaiExportCandidateService.js`
contains no SQL and imports no database pool: it validates its input
allowlist, checks the three feature flags, enforces mapped-human-actor and
role authorization via the shared `validateActorCanPerformOperation`, then
delegates to the injected P3-16 repository. Neither module is imported by any
route, listener, scheduler, or production path.

**Limitation-snapshot confirmation roles**: `gk_reviewer` or `gk_admin`, with
an active organization membership.

**Export-candidate creation role**: `gk_admin` only. Queue resolution is
workflow completion, not authority — creating a candidate is not approval,
readiness, export authority, or `finalGate`.

## Limitation snapshots

Caller input is exactly `{ organizationId, generatedContentDraftId, entries,
actorContext, now }`, where each entry is `{ claimId, evidenceItemId,
limitationCodes }`. The server loads the tenant-scoped, distinct
`(claim_id, evidence_item_id)` pairs actually cited by the draft's blocks and
requires `entries` to cover that exact set — no fewer, no more, no
duplicates, no pair outside it (which also excludes any cross-tenant pair,
since the cited-pair set itself is tenant-scoped by the loading query).
`limitationCodes` must be a deduplicated array (at most 32 entries) matching
`^[a-z][a-z0-9_.:-]{0,95}$`; an empty array is a valid, real, human-confirmed
"no identified limitations" fact for that pair.

`confirmed_by_role` is derived server-side from the actor's active,
org-scoped membership (never trusted from caller-supplied text) and must be
`gk_reviewer` or `gk_admin`.

The confirmed entries are canonicalized (sorted by claim/evidence pair, each
code set deduplicated and sorted) and SHA-256'd into `entries_fingerprint`.
If a current snapshot already exists for the draft:

- identical fingerprint → replay: zero additional rows, zero additional audit;
- different fingerprint → supersession: exactly one new row is inserted,
  carrying `supersedes_snapshot_id` set to the prior current snapshot's id.
  The prior row is never targeted by an `UPDATE` or `DELETE` — the
  supersession is one `INSERT` and nothing else.

### Append-only supersession (corrected)

Lineage is a **backward pointer on the new row**, not a forward pointer
written onto the prior row:

```
new snapshot
    -> supersedes_snapshot_id
prior snapshot
```

- `supersedes_snapshot_id` is `NULL` for the first (root) snapshot of a
  draft, and otherwise names the prior current snapshot — set once, at
  `INSERT` time, and never altered afterward.
- `limitation_snapshots_p3_16_supersedes_fk` is a composite, non-deferred
  foreign key on `(supersedes_snapshot_id, organization_id,
  generated_content_draft_id)`: a predecessor must already exist and must
  belong to the exact same organization and generated-content draft as the
  new row. Lineage can never cross tenant or draft, and therefore never
  crosses `requested_audience` either, since a draft's audience is fixed.
- `ux_limitation_snapshots_p3_16_root_per_draft` (partial unique index on
  `(organization_id, generated_content_draft_id)` where
  `supersedes_snapshot_id IS NULL`) allows at most one root snapshot per
  draft.
- `ux_limitation_snapshots_p3_16_single_successor` (partial unique index on
  `supersedes_snapshot_id` where it is not null) allows at most one direct
  successor per predecessor. Combined with the root-per-draft index, a
  draft's lineage is always a single linear chain, never a forest or a
  branch, and its **current** snapshot is always the unique row that no
  other row names as its predecessor.
- Two concurrent changed confirmations racing from the same current
  snapshot each attempt their own `INSERT`; only one can satisfy the
  single-successor (or, if the read raced ahead, the root-per-draft) unique
  index. The loser's `INSERT` fails with a unique-constraint violation,
  mapped to `conflict_current_state_changed` with zero rows written and
  zero audit published — it never silently rebases onto the winner's row or
  creates a second successor.
- `kai.p3_16_reject_authority_mutation`, attached as a `BEFORE UPDATE OR
  DELETE` trigger on both `kai.limitation_snapshots` and
  `kai.limitation_snapshot_entries`, unconditionally raises an exception.
  Ordinary application code, migrations, or ad-hoc SQL cannot rewrite or
  remove any persisted snapshot or entry — this is enforced at the database
  boundary regardless of what the repository layer does or doesn't attempt.

## Export candidates

Caller input is exactly `{ organizationId, generatedContentDraftId,
actorContext, now }` — no content, citation, lineage, audience, eligibility,
or authority fact is caller-supplied. Inside one tenant-scoped transaction,
the server requires:

1. the `generated_content_review` queue item for the draft to be
   `resolved`/`resolved`;
2. the `export_review` queue item for the draft to be `resolved`/`resolved`;
3. a current, non-superseded `kai.limitation_snapshots` row for the draft,
   whose entries exactly cover the draft's current cited-pair set.

Any missing/unmet prerequisite fails closed with `conflict_current_state_changed`
and zero writes; a pre-P3-16 draft with no governed snapshot is blocked the
same way — no assumed-empty snapshot is ever synthesized.

The canonical representation binds: `organizationId`, `generatedContentDraftId`,
`contentType`, the persisted `requestedAudience` (from the draft row, not the
caller), `blocks` in ordinal order with exact text and each block's citations
(canonicalized — sorted by claim/evidence pair — carrying each citation's
resolved `sourceId`/`sourceVersionId` lineage from `kai.evidence_items`), and
`limitations` (the bound snapshot's entries, sorted by claim/evidence pair,
each code set deduplicated and sorted). It never includes queue/review
statuses, `currentUseEligible`, `exportEligible`, blockers, actor/role,
timestamps, human authority, or `finalGate`. `kai.export_candidates` does not
reuse `generation_runs.request_fingerprint` — `canonicalFingerprint` is a
distinct SHA-256 over this distinct canonical shape, under its own pinned
`fingerprint_contract_version` (`kai-sprint2-p3-16-export-candidate-fingerprint-v1`).

`INSERT ... ON CONFLICT (organization_id, generated_content_draft_id,
requested_audience, canonical_fingerprint) DO NOTHING` makes an exact replay
converge to the existing row with zero additional writes and zero additional
audit; any change to the graph, lineage, snapshot, content type, or audience
produces a different fingerprint and therefore a new append-only candidate
row.

## Currentness evaluator (private, not wired)

`evaluateExportCandidateCurrentnessInTransaction` (exported only via
`__exportCandidateRepositoryTestables` for this package's own tests) is a
read-only evaluator: it reports `current: false` if an authoritative
successor now exists whose `supersedes_snapshot_id` names the candidate's
bound snapshot, or if recomputing the canonical fingerprint from the current
graph no longer matches the stored one. Currentness is derived solely from
whether such a successor exists — neither the bound snapshot nor the
candidate row is ever rewritten to reflect it. It is not called from
VAL-EXP-001, `exportEligible`, or any route — that wiring is explicitly out
of scope for this package.

## Required metadata-only audit

Exactly one audit row is published per call that performs a fresh write,
inside the same transaction as that write:

- `limitation_snapshot_confirmed` — `contract`, `organization_id`,
  `generated_content_draft_id`, `limitation_snapshot_id`,
  `superseded_snapshot_id`, `actor_id`, `actor_type`, `confirmed_by_role`,
  `cited_pair_count`, `entries_fingerprint`, `confirmation_timestamp`.
- `export_candidate_created` — `contract`, `organization_id`,
  `generated_content_draft_id`, `export_candidate_id`, `requested_audience`,
  `limitation_snapshot_id`, `fingerprint_contract_version`,
  `canonical_fingerprint`, `actor_id`, `actor_type`, `cited_pair_count`,
  `block_count`, `creation_timestamp`.

Neither branch's CHECK constraint admits `draft_text`/`claim_text`/
`evidence_text`/`block_text`/`citations`/`limitation_codes` (the actual
confirmed codes are never carried in audit — only fingerprints and counts),
or `credential`/`approval`/`export_authority`/`affirmative_human_export_authority`/
`final_export_gate`/`final_gate`/`export_eligible`/`manifest`.

## Additive schema changes to earlier tables

`kai.upload_lifecycle_audit`'s operation and metadata-object CHECK
constraints are extended with the two branches above, preserving every
earlier branch verbatim (following the accepted P3-01/P3-04/P3-05/P3-09/P3-13
precedent of widening this vocabulary through a later package's forward
migration, never editing an earlier package's accepted migration file).

## Rollback

`migrations/kai_sprint2_p3_16_export_candidate_foundation.rollback.sql`
removes the two new audit CHECK branches (restoring the exact prior audit
operation vocabulary), deletes only `limitation_snapshot_confirmed`/
`export_candidate_created` audit rows, and drops `kai.export_candidates`,
the append-only triggers, `kai.limitation_snapshot_entries`,
`kai.limitation_snapshots`, and the `kai.p3_16_reject_authority_mutation`
and `kai.p3_16_limitation_codes_valid` functions (child-first). It alters no
Gate A through P3-15 table, column, or constraint beyond that restoration,
and leaves all unrelated generated-content/review-queue/draft state
untouched.
