# KAI P3-16 Patch Notes — Export-Candidate Identity and Limitation-Snapshot Foundation

## Owner decision on scope

`OWNER_DECISION.P3_EXPORT_CANDIDATE_V1` and
`OWNER_DECISION.P3_EXPORT_LIMITATION_SNAPSHOT_V1` authorize exactly two new
additive, append-only authoritative foundations: human-confirmed limitation
snapshots and export-candidate identities. Both are dormant service/repository
writes with no route, UI, worker, or production composition. This package does
not change `generated_content_drafts.draft_status`, does not touch
VAL-EXP-001/`exportEligible`/`draftIsStillDraft` wiring, and creates no
`client_reviewed`/`funder_ready`/`public_ready`/`export_authority_granted`/
`finalGate`/manifest/final-export state.

## Added

- `migrations/kai_sprint2_p3_16_export_candidate_foundation.sql` /
  `.rollback.sql` — forward/rollback migration creating `kai.limitation_snapshots`,
  `kai.limitation_snapshot_entries`, `kai.export_candidates`, the
  `kai.p3_16_limitation_codes_valid` helper function, the partial unique index
  enforcing at most one non-superseded snapshot per draft, and the two new
  `limitation_snapshot_confirmed`/`export_candidate_created` metadata-only audit
  operation branches on the existing `kai.upload_lifecycle_audit`.
- `scripts/kai-sprint2-p3-16-export-candidate-foundation-verifier.sql` —
  catalog verification (tables, indexes, constraints, audit contract, and the
  "no export-authority/final-gate/manifest state anywhere" negative check).
- `scripts/kai-sprint2-p3-16-export-candidate-foundation-smoke-seed.sql` —
  seeds one real, fully-eligible (resolved/resolved on both queues)
  generated-content draft with two claims, each against its own committed
  evidence item, cited by one block.
- `scripts/kai-sprint2-p3-16-export-candidate-foundation-smoke-verifier.sql` —
  exercises fresh confirmation, supersession lineage, export-candidate
  creation, and replay convergence directly in SQL.
- `scripts/kai-sprint2-p3-16-export-candidate-foundation-failure-checks.sql` —
  read-only (each attempted write is caught and its effect never committed)
  negative checks: a second current snapshot, a malformed limitation code, a
  duplicate cited-pair entry, a cross-tenant entry, a missing snapshot
  reference, an unsupported fingerprint contract version, and a
  non-reviewer/admin `confirmed_by_role`.
- `scripts/kai-sprint2-p3-16-export-candidate-foundation-local-postgres.js` —
  ephemeral loopback PostgreSQL 16 runner
  (`npm run verify:kai-sprint2-p3-16-export-candidate-foundation`), following
  the P3-13 runner's exact mechanism.
- `Backend/kai/dictionary/exportCandidateContract.js` — static contract
  constants (allowed roles, limitation-code syntax, audience/content-type
  vocabulary, fingerprint contract version, audit operation/contract names).
- `Backend/kai/dictionary/postgresExportCandidateRepository.js` — new
  repository: `confirmLimitationSnapshot`, `createExportCandidate`, and the
  private read-only `evaluateExportCandidateCurrentnessInTransaction`
  evaluator (not wired into VAL-EXP-001).
- `Backend/kai/services/kaiExportCandidateService.js` — new dormant service
  layer: `confirmGeneratedDraftLimitationSnapshot`,
  `createGeneratedDraftExportCandidate`. Not composed into any route.
- `__tests__/kai-sprint2-p3-16-export-candidate-foundation-boundary.spec.js`,
  `.integration.spec.js` — focused boundary (pure-function/service-gate,
  no database) and PostgreSQL-backed integration tests.

## Changed (additive only)

- `package.json` — added `verify:kai-sprint2-p3-16-export-candidate-foundation`
  and `test:kai-sprint2-p3-16-export-candidate-foundation` scripts.
- `kai.upload_lifecycle_audit` — its operation and metadata-object CHECK
  constraints are extended with two new branches, preserving every earlier
  branch verbatim.

## Not changed

No Gate A through P3-15 migration, rollback, runner, verifier, smoke,
repository, service, or route file was edited. `draft_status`, the
generated-content-review and export-review lifecycle contracts,
`exportEligible`, `affirmativeHumanExportAuthority`, and `finalGate` are
unchanged and unreferenced by any write in this package. No route, listener,
scheduler, startup hook, or production composition was added.

## Behavior summary

**Limitation snapshots.** `confirmGeneratedDraftLimitationSnapshot` is gated
by `KAI_SPRINT2_ENABLED`/`KAI_GENERATION_ENABLED`/`KAI_PUBLIC_EXPORT_ENABLED`,
a mapped human actor, and an active `gk_reviewer`/`gk_admin` membership. The
caller supplies only cited `claimId`/`evidenceItemId` pairs and their
confirmed structured limitation-code sets (an explicit empty array is a real
confirmed "no limitations" fact, distinct from no snapshot at all); the
server loads the tenant-scoped cited-pair set from the draft's own
block/citation graph and rejects missing, duplicate, extra/uncited, or
malformed entries. An exact-content replay (same canonical entries fingerprint)
converges with zero additional writes and zero additional audit. A changed
limitation posture creates a new append-only snapshot and points the prior
snapshot's `superseded_by_snapshot_id` at it — the prior row is never
rewritten. At most one non-superseded ("current") snapshot exists per draft
at any time (partial unique index).

**Export candidates.** `createGeneratedDraftExportCandidate` is gated the
same way, restricted to `gk_admin` only, and requires the generated-content
review queue item, the export-review queue item, and a current
non-superseded limitation snapshot to all already be resolved/confirmed —
queue resolution itself is workflow completion only, never authority. The
server loads the exact graph, persisted `requestedAudience`, and the current
snapshot in one tenant-scoped transaction; it never trusts caller-supplied
content, citations, lineage, audience, eligibility, or authority facts. A
deterministic canonical representation (organization/draft identity,
content type, requested audience, ordinal blocks with exact text and
canonicalized citation sets carrying resolved `sourceId`/`sourceVersionId`
lineage, and the bound snapshot's canonical limitation semantics) is
SHA-256'd; mutable live state (statuses, `currentUseEligible`,
`exportEligible`, blockers, actor/role, timestamps, human authority,
`finalGate`) is never part of that representation. An exact-fingerprint
replay converges to the existing row with zero additional writes; a changed
graph, lineage, snapshot, content type, or audience produces a new
append-only candidate row. The private `evaluateExportCandidateCurrentnessInTransaction`
evaluator reports a candidate as not-current if its bound snapshot has been
superseded or the current graph no longer reproduces the stored fingerprint —
it is read-only and is not called from VAL-EXP-001 or any route.

Each fresh successful write publishes exactly one metadata-only audit row
(counts, identifiers, actor, role, fingerprint — never draft/claim/citation/
limitation-code content, credentials, or authority/final-gate tokens) inside
the same transaction as the write it records.
