# KAI P14-03 Grant Response Packet Export Candidate Foundation Runbook

Run:

```sh
DATABASE_URL="postgres://127.0.0.1:9/kai_sentinel" \
  npm run verify:kai-sprint2-p14-03-grant-response-packet-export-candidate-foundation
```

The runner creates its own ephemeral PostgreSQL 16 target bound only to
`127.0.0.1`, on a randomly chosen high port, in a temp data directory. It
bootstraps the organization-enablement + Gate-A schema, then the full
P1/P2/P3-01/P14-01/P3-04/P3-05/P3-09/P3-13/P3-16/P3-17/P3-19/P14-02 migration
chain (this package's member table FKs into the real
`kai.generated_content_drafts`, which itself requires a real
`kai.generation_runs` row bound to a real `kai.engagements` row; P3-17/P3-19
are applied schema-only, with nothing seeded or exercised, purely so
`kai.human_authority_decisions`/`kai.export_manifests` exist for this
package's own "creates no approval/manifest rows" proof to query a real
table rather than a `to_regclass` no-op), then applies the P14-03 forward
migration.

It then runs, in order:

- the P14-03 catalog verifier (16 checks: both tables present, tenant-safe
  composite FKs — candidate → P14-02 identity, member → candidate, member →
  `kai.generated_content_drafts` — fingerprint contract/format CHECKs,
  replay-convergence UNIQUE, both append-only triggers, member `UNIQUE
  (candidate, draft)` / `UNIQUE (candidate, ordinal)`, no member
  `exportCandidateId`/`exportManifestId` column, and that
  `kai.export_candidates`/`kai.export_manifests` carry no P14-03-owned
  constraint);
- the P14-03 synthetic smoke seed (one candidate mint, one same-triple
  replay attempt, one member row) and smoke verifier (4 checks: exactly one
  candidate row survives; the replay attempt never created a second row; the
  first-minted id is the survivor; exactly one member row exists);
- the P14-03 failure checks (11 checks: fabricated packet identity rejected,
  cross-tenant packet identity rejected, non-pinned fingerprint-contract-
  version rejected, malformed fingerprint rejected, fabricated member draft
  rejected, duplicate (candidate, draft) member rejected, duplicate ordinal
  within a candidate rejected, append-only UPDATE rejected, append-only
  DELETE rejected — proven against both the candidate and member tables);
- the focused integration suite
  (`__tests__/kai-sprint2-p14-03-grant-response-packet-export-candidate-foundation.integration.spec.js`,
  14 tests) and the no-DB boundary suite
  (`__tests__/kai-grant-response-packet-export-candidate-boundary.spec.js`,
  20 tests), against the runner-owned database via
  `KAI_P14_03_GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_FOUNDATION_DATABASE_URL`
  (validated loopback-only before any connection).

It tears down Postgres and the temp directory afterward, on both success and
failure.

## Forward delta

Two new tables.

`kai.grant_response_packet_export_candidates`:

- `grant_response_packet_export_candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `organization_id uuid NOT NULL`
- `grant_response_packet_export_identity_id uuid NOT NULL` — composite FK to
  `kai.grant_response_packet_export_identities (grant_response_packet_export_identity_id, organization_id)`,
  `ON DELETE RESTRICT`
- `fingerprint_contract_version text NOT NULL` — pinned to
  `kai-sprint2-p14-03-grant-response-packet-export-candidate-fingerprint-v1`
- `canonical_fingerprint text NOT NULL` — `CHECK (~ '^[a-f0-9]{64}$')`
- `created_by uuid NOT NULL`, `created_by_type text NOT NULL DEFAULT 'human'`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `UNIQUE (grant_response_packet_export_candidate_id, organization_id)`
- `UNIQUE (organization_id, grant_response_packet_export_identity_id, canonical_fingerprint)`
  — the replay-convergence key
- `BEFORE UPDATE OR DELETE` trigger rejecting any mutation (append-only)

`kai.grant_response_packet_export_candidate_members`:

- `grant_response_packet_export_candidate_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `grant_response_packet_export_candidate_id uuid NOT NULL` — composite FK to
  the candidate table, `ON DELETE RESTRICT`
- `organization_id uuid NOT NULL`
- `generated_content_draft_id uuid NOT NULL` — composite FK to
  `kai.generated_content_drafts (generated_content_draft_id, organization_id)`,
  `ON DELETE RESTRICT`
- `ordinal integer NOT NULL` — `CHECK (ordinal >= 0)`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `UNIQUE (grant_response_packet_export_candidate_member_id, organization_id)`
- `UNIQUE (grant_response_packet_export_candidate_id, generated_content_draft_id)`
- `UNIQUE (grant_response_packet_export_candidate_id, ordinal)`
- `BEFORE UPDATE OR DELETE` trigger rejecting any mutation (append-only)

No existing table (`kai.grant_response_packet_export_identities`,
`kai.generated_content_drafts`, `kai.export_candidates`,
`kai.export_manifests`) is altered.

## Repository

`Backend/kai/dictionary/postgresGrantResponsePacketExportCandidateRepository.js`
exposes `createGrantResponsePacketExportCandidate(input, dependencies)`.
`input` accepts **only** `{organizationId, engagementId, actorContext, now}`.
Inside one transaction: composes the render model (via
`composeGrantResponsePacketRenderModel`, injectable as
`dependencies.composeRenderModel` for tests) → computes the canonical
fingerprint (`kaiGrantResponsePacketExportCandidateFingerprintService.js`) →
resolves (get-or-create) the P14-02 identity inline (targeting the literal
P14-02 table and its literal replay-convergence key, so identity resolution
and candidate creation are atomic) → inserts the candidate with
`ON CONFLICT ... DO NOTHING` (replay convergence) → on a genuine insert,
persists the ordered member snapshot rows and writes one metadata-only audit
event; on a replay, re-reads the existing member snapshot instead. Not
called from any route, service, or the existing packet DTO in this package —
wiring is explicitly deferred to a later, separately authorized package.

## Rollback

`migrations/kai_sprint2_p14_03_grant_response_packet_export_candidate_foundation.rollback.sql`
unconditionally drops both triggers, both tables, and the shared trigger
function — both are brand-new tables with no legacy/shared-column
data-loss concern. Proven locally: forward → rollback → forward
re-application, against a separate ephemeral Postgres instance, completed
cleanly with no error and no identifier-truncation notice.

## Known constraint-naming adjustment

Several natural names on the member table (and the candidate table's
convergence-unique constraint) exceeded Postgres's 63-byte `NAMEDATALEN`
limit and would have silently truncated. Renamed to fit (see patch notes for
the exact mapping); the migration, verifier, and failure-checks files all
agree on the shortened names, confirmed with no truncation notice on a live
forward → rollback → forward re-application.

## Production migration

Not performed. Not authorized. This runbook documents local, synthetic-
database proof only.
