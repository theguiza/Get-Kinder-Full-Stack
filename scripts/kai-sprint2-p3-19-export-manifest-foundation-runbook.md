# KAI P3-19 Export Manifest Persistence Foundation Runbook

This package creates one new, previously-untracked table -
`kai.export_manifests` - and a minimum repository/service write path that
persists an **export manifest identity**: the first durable object saying
"this export candidate, under this effective human export authority, has
been identified for export." It changes no Gate A through P3-18 migration,
rollback, route, or product schema beyond the two additive corrections listed
under "Companion changes" below.

Run:

```sh
npm run verify:kai-sprint2-p3-19-export-manifest-foundation
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_p3_19_export_manifest_foundation_synthetic`;
- applies the existing synthetic bootstrap schema, **plus this package's own
  test-only `kai.audit_events`/`kai.object_type_enum` synthetic bootstrap**
  (see "Real audit persistence" below - not a product migration), and the
  existing frozen Gate A through P3-18 migrations, then the new P3-19 forward
  migration;
- runs the P3-04/P3-13 verifiers (regression) and the new P3-19 catalog
  verifier **in place of** P3-16's/P3-17's own verifiers, which each assert
  "no `export_manifests` table exists" - an invariant this package's own
  migration supersedes by design (the same "superseded verifier is not
  re-run" convention already established by the P3-13/P3-16/P3-17 runners);
- runs the existing Gate A through P3-17 smoke seeds/verifiers/failure
  checks, then the new P3-19 smoke seed, smoke verifier, and failure checks;
- runs the P3-19 integration and boundary specs together with the full
  P3-16/P3-17/P3-18 regression specs (these packages' shared files changed -
  see "Companion changes") against that runner-owned target only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback
address, port, and `listen_addresses`. It must not be pointed at a shared,
quarantined, cloud, production, or real-client-data database. The
integration spec skips itself unless
`KAI_P3_19_EXPORT_MANIFEST_FOUNDATION_DATABASE_URL` is set by that runner,
and validates it as loopback-only before any dynamic import.

## Scope boundary

Not added in this package (explicitly out of scope):

- artifact rendering, artifact bytes, Markdown/PDF/DOCX generation;
- object storage, storage keys, signed URLs, download/retrieval;
- public sharing or reuse of a manifest;
- any change to `generated_content_drafts`/`draft_status`;
- any HTTP route (schema + repository + minimum service only).

## Manifest identity

`kai.export_manifests` columns: `export_manifest_id` (PK), `organization_id`,
`export_candidate_id`, `effective_authority_decision_id`,
`effective_authority_decision_type` (pinned to `'export_authority_granted'`),
`fingerprint_contract_version` (pinned to
`'kai-sprint2-p3-19-export-manifest-fingerprint-v1'`), `canonical_fingerprint`
(lowercase 64-hex sha256), `created_by`, `created_by_type` (pinned to
`'human'`), `created_at`.

No `requested_audience` or `generated_content_draft_id` column - both are
derivable via `export_candidate_id` (mirroring `human_authority_decisions`,
which does not duplicate `requested_audience` either).

**Replay convergence**: `export_manifests_p3_19_replay_convergence_unique`
(`UNIQUE (organization_id, export_candidate_id, canonical_fingerprint)`) - the
same eligible state submitted twice converges to exactly one manifest row via
`INSERT ... ON CONFLICT DO NOTHING` + re-select, the same idiom P3-16's own
`createExportCandidate` uses.

**Immutable**: `kai.p3_19_reject_authority_mutation`, attached as a `BEFORE
UPDATE OR DELETE` trigger, unconditionally raises an exception - ordinary
application code, migrations, or ad-hoc SQL cannot rewrite or remove a
persisted manifest row.

## Issue 1 - shared, atomic eligibility composition (no reduced path)

The manifest write **never** reconstructs eligibility from selected P3-16/
P3-17 checks. `Backend/kai/services/kaiFinalExportEligibilityGateService.js`
was split into:

- `evaluateFinalExportEligibilityInTransaction(tx, input, dependencies)` -
  the full composition (candidate load, packet evaluation, P3-17
  effectiveness, VAL-EXP-001), executed against one shared, caller-supplied
  transaction. Internal-only: additionally returns
  `effectiveAuthorityDecisionId`.
- `evaluateFinalExportEligibility(input, dependencies)` - unchanged external
  behavior. Builds its public return object via an **explicit allowlist
  projection** (not a passthrough spread) naming only the seven
  historically-existing fields, so `effectiveAuthorityDecisionId` is never
  exposed publicly and the pre-existing route/API contract is pinned by
  construction.

`Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js`'s
already-correct private `evaluateHumanAuthorityEffectivenessInTransaction` is
now exported (visibility change only, no logic change) so the manifest write
can call it inside its **own** transaction - closing the TOCTOU gap between
"authority checked" and "manifest written" that exists whenever effectiveness
is checked in a separate transaction from a subsequent write.

`Backend/kai/dictionary/postgresExportManifestRepository.js#createExportManifest`
opens one read-write transaction, calls
`evaluateFinalExportEligibilityInTransaction` inside it, and inserts the
manifest **only if** `finalExportEligible === true`, using
`effectiveAuthorityDecisionId` read in that same transaction (no re-query).
Every not-PASS outcome (no decision, revoked, stale candidate, current-use
ineligible, review unresolved) maps to the same `validation_blocker` -
because the manifest layer never distinguishes *why* the shared gate said no,
only that it did.

## Issue 2 - audit object identity, not the candidate

`createProductionMetadataOnlyAuditForExportManifest` (new, in
`kaiMetadataOnlyAuditComposition.js`) identifies the audited object as the
manifest itself (`object_type: "export_manifest"`, `object_id` = the
manifest's own id, both read from `payload.export_manifest_id` at prepare
time - never taken as a constructor parameter, since the manifest's id does
not exist until inside the repository's own transaction). This mirrors the
P2-03/P2-11 adapters' identity discipline exactly, and never mislabels the
manifest as an `export_candidate`.

`Backend/kai/db/kaiAuditQueries.js`'s `SAFE_AUDIT_METADATA_KEYS` gained
exactly two new literal entries - `"export_manifest_id"` and
`"export_candidate_id"` - so both identifiers are carried by name (additive
only; nothing removed or renamed).

**No `kai.upload_lifecycle_audit` write in this package.** That table's
`intake_file_id` column is `NOT NULL`, and P3-16/P3-17 already resolve that
mandatory single-file identity by picking the *first* cited file when a
draft's citations span multiple source files - a pre-existing imprecision
this package does not repeat. `kai.audit_events` requires no file identity at
all and is the sink every other non-file-scoped export-track object already
uses.

## Issue 3 - real audit persistence, not a test double

`kai.audit_events`/`kai.object_type_enum` are externally-owned production
objects (no migration in this repo creates them), and the export-track
ephemeral harness doesn't bootstrap them either - which is why every prior
P3-17 "real-persisted" proof injects a test-double `auditRecorder()` for
`metadataOnlyAudit`. This package instead reuses the exact precedent already
established by `scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql`:
`scripts/kai-sprint2-p3-19-export-manifest-foundation-audit-events-bootstrap-synthetic-schema.sql`
is a byte-for-byte copy of that same minimal synthetic
`kai.audit_events`/`kai.object_type_enum` mirror (declaring only the
`'other'` fallback label - never asserting an `'export_manifest'` label
exists in the real, externally-owned production enum). Applied only by this
package's own runner, never by any product migration.

With this in place, the P3-19 integration suite exercises the **real**
`createProductionMetadataOnlyAuditForExportManifest` composition and a real
`INSERT INTO kai.audit_events`, inside the same transaction as the manifest
row, and asserts the persisted row directly - `REAL AUDIT PERSISTENCE:
CONFIRMED`, not a stubbed callback.

## Companion changes (shared files, behavior-preserving)

- `Backend/kai/services/kaiFinalExportEligibilityGateService.js` - split
  (Issue 1). Public contract byte-for-byte unchanged; proven by an explicit
  key-set assertion in the P3-19 boundary spec and by the full,
  unmodified-behavior P3-18 regression suite.
- `Backend/kai/dictionary/postgresHumanAuthorityDecisionRepository.js` - one
  `export` keyword added, no logic change.
- `Backend/kai/db/kaiAuditQueries.js` - two `SAFE_AUDIT_METADATA_KEYS`
  entries added.
- `__tests__/kai-sprint2-p3-17-human-authority-decision-ledger.integration.spec.js` -
  one pre-existing assertion ("P3-17 creates no ... manifest ... state
  anywhere in kai schema") updated to reflect this package's authorized,
  documented supersession of its `export_manifests` clause only; every other
  clause (`export_events`, `export_artifacts`, every finalGate/eligibility
  column) is unchanged and still asserted absent.

## Rollback

`migrations/kai_sprint2_p3_19_export_manifest_foundation.rollback.sql` drops
the append-only trigger, `kai.export_manifests`, and
`kai.p3_19_reject_authority_mutation` (child-first). It alters no Gate A
through P3-18 table, column, or constraint, and leaves all unrelated
generated-content/review-queue/draft/export-candidate/limitation-snapshot/
human-authority-decision state untouched. The companion changes to
`kaiFinalExportEligibilityGateService.js`,
`postgresHumanAuthorityDecisionRepository.js`, and `kaiAuditQueries.js` are
JS-only and not part of this SQL rollback; reverting them (if ever required)
is a separate, ordinary code revert, not a database migration.
