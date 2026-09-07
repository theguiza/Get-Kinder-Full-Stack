# KAI P3-19 Patch Notes — Export Manifest Persistence Foundation

## Owner decision on scope

P3-19 is authorized as one bounded local package: an additive schema/service
foundation persisting an **export manifest identity** - the first durable
object saying "this export candidate, under this effective human export
authority, has been identified for export" - once the shared, unmodified
P3-18/VAL-EXP-001 composition PASSes inside the same write transaction as the
insert. No renderer, artifact bytes, storage, signed URL, download, or
reuse-lifecycle work is authorized or started by this package.

Two genuine gaps were found and corrected during implementation, both
resolved additively (see the runbook's "Issue 1"/"Issue 2"/"Issue 3"
sections for the full inspection/decision record):

1. The manifest write must run the exact same authoritative P3-18/VAL-EXP-001
   composition as the public evaluator - never a reduced reconstruction from
   selected P3-16/P3-17 checks - so
   `kaiFinalExportEligibilityGateService.js` was split into an internal,
   transaction-scoped composition and an unchanged public wrapper.
2. `kai.upload_lifecycle_audit` is not a valid audit sink for this operation
   (its `intake_file_id` is `NOT NULL`, and a manifest's citation graph can
   span multiple source files with no truthful single-file identity);
   `kai.audit_events` - the sink every other non-file-scoped export-track
   object already uses - is valid instead, and its real persistence is
   proven via a test-only synthetic bootstrap of that externally-owned
   table, reusing an existing sibling package's own precedent, rather than a
   test-double callback.

## Added

- `migrations/kai_sprint2_p3_19_export_manifest_foundation.sql` /
  `.rollback.sql` — forward/rollback migration creating
  `kai.export_manifests` (FK'd to `kai.export_candidates` and, scoped to
  `decision_type = 'export_authority_granted'`, to
  `kai.human_authority_decisions`), the replay-convergence unique constraint,
  and the `kai.p3_19_reject_authority_mutation` append-only trigger. No
  existing table, column, constraint, or lifecycle from Gate A through P3-18
  is altered; no `kai.upload_lifecycle_audit` change is made.
- `scripts/kai-sprint2-p3-19-export-manifest-foundation-verifier.sql` —
  catalog verification (table, constraints, FKs, trigger, and the negative
  checks that `draft_status`/`upload_lifecycle_audit`'s operation allowlist
  are unchanged), run in place of P3-16's/P3-17's own verifiers (which each
  assert "no `export_manifests` table exists" - superseded by this
  package's migration, exactly the established "superseded verifier is not
  re-run" convention).
- `scripts/kai-sprint2-p3-19-export-manifest-foundation-audit-events-bootstrap-synthetic-schema.sql` —
  test-only synthetic `kai.audit_events`/`kai.object_type_enum` mirror
  (byte-for-byte the organization-enablement package's own precedent),
  applied only by this package's runner, proving real audit persistence.
- `scripts/kai-sprint2-p3-19-export-manifest-foundation-smoke-seed.sql` —
  seeds one real, fully-eligible generated-content draft/export candidate for
  org1 plus one fresh, self-contained root `export_authority_granted` grant.
- `scripts/kai-sprint2-p3-19-export-manifest-foundation-smoke-verifier.sql` —
  exercises manifest binding to the effective grant, replay convergence,
  rejection of a non-`export_authority_granted` decision binding, cross-
  tenant rejection, and append-only mutation rejection directly in SQL.
- `scripts/kai-sprint2-p3-19-export-manifest-foundation-failure-checks.sql` —
  negative checks: missing decision/candidate reference, unsupported
  fingerprint contract version, malformed canonical fingerprint, non-human
  `created_by_type`, wrong decision type.
- `scripts/kai-sprint2-p3-19-export-manifest-foundation-local-postgres.js` —
  ephemeral loopback PostgreSQL 16 runner
  (`npm run verify:kai-sprint2-p3-19-export-manifest-foundation`), following
  the P3-17/P3-18 runners' exact mechanism.
- `Backend/kai/dictionary/exportManifestContract.js` — static contract
  constants (fingerprint contract version, allowed role, operation/contract
  strings).
- `Backend/kai/dictionary/postgresExportManifestRepository.js` —
  `createExportManifest`: one read-write transaction running the shared
  `evaluateFinalExportEligibilityInTransaction` composition, inserting the
  manifest only on PASS, with replay convergence and a real `kai.audit_events`
  publish inside the same transaction.
- `Backend/kai/services/kaiExportManifestService.js` — minimum service
  layer: feature-flag guard, human-actor guard, `gk_admin`-only
  authorization, delegates to the repository. Not route-mounted in this
  package.
- `__tests__/kai-sprint2-p3-19-export-manifest-foundation-boundary.spec.js`,
  `.integration.spec.js` — focused boundary (pure-function, no database) and
  PostgreSQL-backed integration coverage, including the Issue-1 public-
  contract key-set proof and the Issue-3 real-audit-persistence proof.

## Changed (additive/behavior-preserving only)

- `Backend/kai/services/kaiFinalExportEligibilityGateService.js` — split
  into `evaluateFinalExportEligibilityInTransaction` (new export) +
  unchanged-contract `evaluateFinalExportEligibility`.
- `Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js` — one
  `export` keyword added to the already-correct
  `evaluateHumanAuthorityEffectivenessInTransaction`; no logic change.
- `Backend/kai/db/kaiAuditQueries.js` — two `SAFE_AUDIT_METADATA_KEYS`
  entries added (`export_manifest_id`, `export_candidate_id`).
- `Backend/kai/services/kaiMetadataOnlyAuditComposition.js` — one new
  composition function, `createProductionMetadataOnlyAuditForExportManifest`.
- `package.json` — added
  `verify:kai-sprint2-p3-19-export-manifest-foundation`. No existing script
  is changed.
- `__tests__/kai-sprint2-p3-17-human-authority-decision-ledger.integration.spec.js` —
  one pre-existing assertion updated to reflect this package's authorized,
  documented supersession of its `export_manifests` clause only (see
  runbook).

## Not changed

No Gate A through P3-18 migration or rollback file was edited. No route,
listener, scheduler, startup hook, UI control, renderer, artifact byte,
storage key, signed URL, download/retrieval path, or reuse-lifecycle
capability was added. `kai.generated_content_drafts`/`draft_status`,
`kai.export_candidates`, `kai.human_authority_decisions`, and
`kai.upload_lifecycle_audit`'s operation allowlist are unchanged.

## Behavior summary

**Manifest identity.** One row per `(organization, export_candidate,
canonical_fingerprint)`; the fingerprint is a deterministic sha256 over
`{organizationId, exportCandidateId, effectiveAuthorityDecisionId}`, so the
same eligible state always converges to the same manifest row. Immutable:
an append-only trigger rejects ordinary `UPDATE`/`DELETE`.

**Eligibility.** The manifest write and the public evaluator share exactly
one composition (`evaluateFinalExportEligibilityInTransaction`) - candidate
load, packet evaluation (generated-content review + export review + current-
use eligibility), P3-17 effectiveness, and VAL-EXP-001 - executed inside the
manifest's own write transaction, closing the gap between "eligibility
checked" and "manifest written" that would otherwise exist across two
separate transactions. Every not-PASS outcome maps to `validation_blocker`;
the manifest layer never re-derives or narrows the reason.

**Authorization.** `gk_admin`-only; a `client_reviewer`, `gk_reviewer`, non-
human (AI/system) actor, or an actor without active membership in the
target organization is denied before the repository is ever reached. Client-
supplied `requestedAudience`/`finalGate`/`affirmativeHumanExportAuthority`/
any invented eligibility or currentness field is rejected at the input-
contract boundary, before any database access.

**Audit.** A real `kai.audit_events` row (not `kai.upload_lifecycle_audit`)
is published inside the same transaction as a real manifest insert -
`object_type: "export_manifest"`, `object_id` = the manifest's own id,
`export_manifest_id`/`export_candidate_id` both carried by name. No audit
row is published on a replay.
