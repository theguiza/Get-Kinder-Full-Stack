# KAI P14-02 Patch Notes — Grant Response Packet Export Identity Foundation

## Owner decision on scope

Authorized as one bounded, **local-only** schema/persistence package (no
production or shared database access, no deployment, no push, no feature
flags, no credentials, no real client data): give the existing read-only
`organizationId + engagementId` Grant Response Packet composite (see
`Backend/kai/services/kaiGrantResponsePacketService.js`) a durable identity
of its own, so a later, separately authorized package can bind governed
final-release/manifest state to a packet rather than to a member draft.

This package deliberately does **not**:

- reopen P14-01, packet membership, composition, preview, or frontend work;
- create any route, service call site, or UI affordance that mints or reads
  a row (the repository module is added but not wired into any service,
  route, or existing packet DTO);
- assign any member's existing `exportCandidateId`/`exportManifestId` as the
  packet's identity — packet-level identity is new and independent of
  per-member export identity;
- touch `kai.export_candidates`, `kai.export_manifests`,
  `kai.human_authority_decisions`, or the final eligibility gate.

**Identity shape decision:** unlike `kai.export_candidates` /
`kai.export_manifests` (whose identity converges on a `canonical_fingerprint`
hash of mutable draft/authority state, because the same content can
legitimately recur), a Grant Response Packet's identity is already fully
determined by its `(organization_id, engagement_id, packet_audience)` triple
— that triple itself is the durable, structural identity key, so no content
fingerprint is needed. `packet_audience` is pinned to `'funder'`, the
packet DTO's only currently supported audience.

## Added

- `migrations/kai_sprint2_p14_02_grant_response_packet_export_identity_foundation.sql`
  / `.rollback.sql` — forward/rollback migration creating
  `kai.grant_response_packet_export_identities`: a tenant-safe composite FK
  into `kai.engagements`, a `UNIQUE (organization_id, engagement_id,
  packet_audience)` replay-convergence key, and the
  `kai.p14_02_reject_identity_mutation` append-only trigger (mirroring the
  P3-19 export-manifest immutability convention). Preflight requires
  `kai.engagements`, `kai.generation_runs`, and the P14-01
  `generation_runs.engagement_id` column to already exist.
- `Backend/kai/dictionary/postgresGrantResponsePacketExportIdentityRepository.js`
  — `createPostgresGrantResponsePacketExportIdentityRepository()` exposes one
  idempotent `getOrCreateGrantResponsePacketExportIdentity(input)` (exact-keys
  `organizationId` + `engagementId` + `actorContext`; `packetAudience` is
  never accepted from the caller) plus a read-only
  `loadGrantResponsePacketExportIdentityInTransaction(tx, {organizationId,
  engagementId})` that never mints a row. Neither function is called from any
  service or route in this package.
- `scripts/kai-sprint2-p14-02-grant-response-packet-export-identity-foundation-{verifier,smoke-seed,smoke-verifier,failure-checks}.sql`
  and `-local-postgres.js` — catalog verification, replay-convergence smoke
  proof, and negative checks (fabricated engagement, cross-tenant engagement,
  non-`funder` audience, `NULL` engagement, append-only UPDATE/DELETE
  rejection), run against a runner-owned, loopback-only ephemeral Postgres 16
  instance. This runner bootstraps only the minimal
  `kai.organizations`/`kai.engagements`/`kai.generation_runs` shape this
  table's own FK and preflight require — not the full Gate A-through-P3-19
  chain another package's runner exercises — because this migration reads or
  writes no export-candidate, export-manifest, or authority-decision table.
- `__tests__/kai-sprint2-p14-02-grant-response-packet-export-identity-foundation.integration.spec.js`
  — real-persisted proof of get-or-create convergence, tenant-safety, the
  read-only loader, and immutability, gated on
  `KAI_P14_02_GRANT_RESPONSE_PACKET_EXPORT_IDENTITY_FOUNDATION_DATABASE_URL`
  (loopback-only, validated before any connection).
- `__tests__/kai-grant-response-packet-export-identity-boundary.spec.js` —
  no-DB input-contract proof: exact-keys validation, UUID checks, rejection
  of a client-supplied `packetAudience`,
  `grantResponsePacketExportIdentityId`, `exportCandidateId`, or
  `exportManifestId`.
- `package.json`:
  `verify:kai-sprint2-p14-02-grant-response-packet-export-identity-foundation`.

## Constraint-naming note

The natural name `grant_response_packet_export_identities_p14_02_created_by_type_check`
exceeds Postgres's 63-byte identifier limit and silently truncates on
creation; the migration instead names it
`..._p14_02_created_by_chk` (61 bytes) so the catalog name matches what the
migration and verifier both declare, with no silent truncation. Every other
constraint/trigger name on this table was measured and confirmed to fit
within the limit.

## Verification

`npm run verify:kai-sprint2-p14-02-grant-response-packet-export-identity-foundation`
passed: migration verifier (9/9 checks), smoke-seed + smoke-verifier (3/3
checks), failure-checks (6/6 checks: fabricated engagement rejected,
cross-tenant engagement rejected, non-`funder` audience rejected, `NULL`
engagement rejected, append-only UPDATE rejected, append-only DELETE
rejected), and the focused Node test files above (15/15). Forward migration
→ rollback → forward re-application was proven idempotent and clean (no
truncation notice) against a separate ephemeral Postgres instance.
`DATABASE_URL` was set to the non-listening loopback sentinel for every
Node/npm command. Full suite (`npm test`) returned 3587 passed, 7 failed, 62
skipped — the 7 failures are the pre-existing, unrelated batch/file-detail
baseline already documented in the living ExecPlan (child-file read model,
batch-files collection contract, file-detail 15-field allowlist, file-detail
contract); no new failure was introduced.

## Not done (explicitly out of scope)

- No route, service, or existing packet DTO reads or writes this table.
- No binding from a packet identity to any export candidate, export
  manifest, or human authority decision.
- No approval, finalization, or final-release authority is granted or
  implied by a row existing in this table.
- No production/shared database change, deployment, push, or credential
  work.
