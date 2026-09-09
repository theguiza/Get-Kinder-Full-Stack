# KAI P14-02 Grant Response Packet Export Identity Foundation Runbook

Run:

```sh
DATABASE_URL="postgres://127.0.0.1:9/kai_sentinel" \
  npm run verify:kai-sprint2-p14-02-grant-response-packet-export-identity-foundation
```

The runner creates its own ephemeral PostgreSQL 16 target bound only to
`127.0.0.1`, on a randomly chosen high port, in a temp data directory. It
bootstraps only the minimal `kai.organizations` / `kai.engagements` /
`kai.generation_runs` shape this migration's own composite FK and preflight
require (not the full Gate A-through-P3-19 chain — this table has no
dependency on `kai.export_candidates`, `kai.export_manifests`, or
`kai.human_authority_decisions`), then applies the P14-02 forward migration.

It then runs, in order:

- the P14-02 catalog verifier (9 checks: table present, tenant-safe
  composite engagement FK, audience/created-by-type CHECKs, the
  `(organization_id, engagement_id, packet_audience)` replay-convergence
  UNIQUE, the append-only trigger, no member `exportCandidateId`/
  `exportManifestId` column, and that `kai.export_candidates`/
  `kai.export_manifests` — where present — carry no P14-02-owned
  constraint);
- the P14-02 synthetic smoke seed (one identity mint, one same-triple replay
  attempt) and smoke verifier (exactly one row survives; the replay attempt
  never created a second row; the first-minted id is the one that survived);
- the P14-02 failure checks (fabricated engagement rejected, cross-tenant
  engagement/organization pair rejected, non-`funder` audience rejected,
  `NULL` engagement rejected, append-only UPDATE rejected, append-only
  DELETE rejected);
- the focused integration suite
  (`__tests__/kai-sprint2-p14-02-grant-response-packet-export-identity-foundation.integration.spec.js`)
  and the no-DB boundary suite
  (`__tests__/kai-grant-response-packet-export-identity-boundary.spec.js`),
  against the runner-owned database via
  `KAI_P14_02_GRANT_RESPONSE_PACKET_EXPORT_IDENTITY_FOUNDATION_DATABASE_URL`
  (validated loopback-only before any connection).

It tears down Postgres and the temp directory afterward, on both success and
failure.

## Forward delta

One new table, `kai.grant_response_packet_export_identities`:

- `grant_response_packet_export_identity_id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `organization_id uuid NOT NULL`
- `engagement_id uuid NOT NULL` — composite FK to
  `kai.engagements (engagement_id, organization_id)`, `ON DELETE RESTRICT`
- `packet_audience text NOT NULL` — `CHECK (packet_audience = 'funder')`
- `created_by uuid NOT NULL`, `created_by_type text NOT NULL DEFAULT 'human'`
  — `CHECK (created_by_type IN ('human', 'system'))`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `UNIQUE (grant_response_packet_export_identity_id, organization_id)` —
  tenant-safe FK-target shape, following repository convention
- `UNIQUE (organization_id, engagement_id, packet_audience)` — the durable
  composite identity key
- `BEFORE UPDATE OR DELETE` trigger rejecting any mutation (append-only)

No existing table (`kai.engagements`, `kai.generation_runs`,
`kai.export_candidates`, `kai.export_manifests`) is altered.

## Repository

`Backend/kai/dictionary/postgresGrantResponsePacketExportIdentityRepository.js`
exposes `getOrCreateGrantResponsePacketExportIdentity` (idempotent
get-or-create, `INSERT ... ON CONFLICT (organization_id, engagement_id,
packet_audience) DO NOTHING` + re-select) and
`loadGrantResponsePacketExportIdentityInTransaction` (read-only, never
mints). Neither is called anywhere else in the repository yet — wiring a
route, service, or the existing packet DTO to this identity is explicitly
left to a later, separately authorized package.

## Rollback

`migrations/kai_sprint2_p14_02_grant_response_packet_export_identity_foundation.rollback.sql`
unconditionally drops the trigger, table, and function — this is a brand-new
table with no legacy/shared-column data-loss concern (unlike P14-01's
`ALTER TABLE` rollback, which must refuse while non-null bindings exist).
Proven locally: forward → rollback → forward re-application, against a
separate ephemeral Postgres instance, completed cleanly with no error and no
identifier-truncation notice.

## Known constraint-naming adjustment

The natural constraint name `..._p14_02_created_by_type_check` is 68 bytes,
over Postgres's 63-byte `NAMEDATALEN` limit; Postgres would silently
truncate it on `CREATE TABLE` to `..._created_by_type_` with no error. The
migration instead names it `..._p14_02_created_by_chk` (61 bytes) so the
name in the migration, the verifier, and the live catalog all agree
exactly, with no silent truncation. Every other constraint and trigger name
on this table was measured and confirmed to fit within the limit.

## Production migration

Not performed. Not authorized. This runbook documents local, synthetic-
database proof only.
