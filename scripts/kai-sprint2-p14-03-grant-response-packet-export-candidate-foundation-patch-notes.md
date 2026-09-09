# KAI P14-03 Patch Notes — Grant Response Packet Export Candidate + Authoritative Member Snapshot Foundation

## Owner decision on scope

Authorized as one bounded, **local-only** schema/persistence package (no
production or shared database access, no deployment, no push, no feature
flags, no credentials, no real client data, no packet manifest creation, no
final-release authority): give the existing durable P14-02 packet identity
(`kai.grant_response_packet_export_identities`) a fingerprint-convergent
EXPORT CANDIDATE, plus a server-derived, ordered MEMBER SNAPSHOT of exactly
which `generated_content_draft` rows made up that candidate at creation
time.

This package deliberately does **not**:

- reopen P14-01, P14-02, packet membership, composition, preview, or
  frontend work, or modify P14-02's table/trigger/constraint;
- touch `kai.export_candidates`, `kai.export_manifests`, or
  `kai.human_authority_decisions`;
- create any approval, final-release, or manifest state, or grant any export
  authority — creating a candidate is purely a durable, replay-convergent
  snapshot;
- add a member `exportCandidateId`/`exportManifestId` column to either new
  table — the single-draft export track (P3-16/17/18/19/20) is untouched and
  unreferenced by this package's schema.

**Identity shape decision:** unlike P14-02 (whose identity is fully
structural — the `(organization_id, engagement_id, packet_audience)` triple
alone determines a packet's identity), a packet's *content* can legitimately
change over time as member drafts are reviewed/revised. So, exactly like
`kai.export_candidates`, this candidate's identity converges on a
`canonical_fingerprint` hash of the packet's own semantic render-model state
— scoped under (FK'd to) the existing P14-02 structural identity. The same
semantic packet state, requested any number of times, converges to the same
candidate row; changed semantic state produces a new one.

**Fingerprint contract:** computed exclusively from
`getGrantResponsePacket` → `composeGrantResponsePacketRenderModel` output
(never a raw DB row, never a client-supplied shape). Covers: `packetAudience
=== 'funder'` (funder-only; anything else is refused before a
representation is even built), the ordered list of member
`generatedContentDraftId`s, ordered block identities
(`ordinal`/`generatedContentBlockId`), ordered citation identities
(`claimId`/`evidenceItemId`/`sourceId`/`sourceVersionId`/
`generatedContentCitationId`), and material limitation/blocker state per
citation (`supportStrength`/`claimReviewStatus`/`evidenceReviewStatus`/
`currentEligible`/`blockerCodes`/`affectedDimensionKeys`/
`affectedObjectIds`) and per member (`draftStatus`/`currentUseEligible`).
Explicitly excludes every timestamp (`reviewUpdatedAt`,
`exportManifestHistory[].createdAt`) and the entire single-draft
export-review/export-manifest track
(`exportManifestId`/`exportManifestHistory`/`reviewQueueItemId`/
`exportReviewQueueItemId`/etc.) — see
`Backend/kai/services/kaiGrantResponsePacketExportCandidateFingerprintService.js`.

## Added

- `migrations/kai_sprint2_p14_03_grant_response_packet_export_candidate_foundation.sql`
  / `.rollback.sql` — forward/rollback migration creating
  `kai.grant_response_packet_export_candidates` (tenant-safe composite FK
  into `kai.grant_response_packet_export_identities`, `UNIQUE
  (organization_id, grant_response_packet_export_identity_id,
  canonical_fingerprint)` replay-convergence key, pinned
  `fingerprint_contract_version`, SHA-256-shaped `canonical_fingerprint`
  CHECK, append-only trigger) and
  `kai.grant_response_packet_export_candidate_members` (tenant-safe
  composite FKs into the candidate table and `kai.generated_content_drafts`,
  `UNIQUE (candidate, draft)`, `UNIQUE (candidate, ordinal)`, append-only
  trigger). No block text, raw evidence/source content, or artifact bytes is
  stored on either table.
- `Backend/kai/dictionary/grantResponsePacketExportCandidateContract.js` —
  static contract constants (fingerprint contract version, audit operation/
  contract names, pinned audience), mirroring the P3-16/P3-19 contract-file
  convention.
- `Backend/kai/services/kaiGrantResponsePacketExportCandidateFingerprintService.js`
  — `composeGrantResponsePacketExportCandidateFingerprint(renderModel)`: the
  single authoritative fingerprint composer described above.
- `Backend/kai/dictionary/postgresGrantResponsePacketExportCandidateRepository.js`
  — `createPostgresGrantResponsePacketExportCandidateRepository()` exposes
  one `createGrantResponsePacketExportCandidate(input, dependencies)`
  accepting **only** exact-keys `{organizationId, engagementId,
  actorContext, now}` — no `memberIds`, `generatedContentDraftIds`,
  `exportCandidateId`, `exportManifestId`, or `canonicalFingerprint` is ever
  accepted; every one of those is derived, inside one atomic transaction,
  exclusively from the render model this function composes itself. The
  transaction: composes the render model → computes the fingerprint →
  resolves (get-or-create, converging) the P14-02 structural identity →
  finds-or-creates the candidate (replay convergence) → derives the ordered
  member list from the render model's own order → persists the member
  snapshot rows → writes one non-file-scoped metadata-only audit event (see
  below). Creating a candidate touches no approval/manifest table.
- `Backend/kai/services/kaiMetadataOnlyAuditComposition.js` — added
  `createProductionMetadataOnlyAuditForGrantResponsePacketExportCandidate`,
  mirroring `createProductionMetadataOnlyAuditForExportManifest`'s
  non-file-scoped discipline exactly (`kai.audit_events` via
  `insertRequiredSuccessfulAuditEvent`, not `kai.upload_lifecycle_audit` —
  this is a packet-level, not intake-file-level, object). Records only the
  candidate's own id, the bound organization/engagement ids, and the
  operation name; the existing, unmodified `SAFE_AUDIT_METADATA_KEYS`
  allowlist (`Backend/kai/db/kaiAuditQueries.js`) — not touched by this
  package — silently drops any other field (fingerprint, member count) a
  caller passes, exactly as it already does for every other non-file-scoped
  export-track audit composed in this module.
- `scripts/kai-sprint2-p14-03-grant-response-packet-export-candidate-foundation-{verifier,smoke-seed,smoke-verifier,failure-checks}.sql`
  and `-local-postgres.js` — catalog verification (16 checks), replay-
  convergence smoke proof, and negative checks, run against a runner-owned,
  loopback-only ephemeral Postgres 16 instance bootstrapped with the full
  Gate-A-through-P14-02 migration chain (this package's member table FKs
  into the real `kai.generated_content_drafts`, which itself requires a real
  `kai.generation_runs` row; P3-17/P3-19 are additionally applied,
  schema-only, so `kai.human_authority_decisions`/`kai.export_manifests`
  exist for this package's own "creates no approval/manifest rows" proof to
  query a real table).
- `__tests__/kai-sprint2-p14-03-grant-response-packet-export-candidate-foundation.integration.spec.js`
  — real-persisted proof (14 tests): packet structural identity reuse,
  funder-only enforcement, replay convergence, changed-state new candidate,
  fabricated/cross-tenant identity rejection, cross-tenant member rejection,
  candidate-id/identity-id distinctness, no `export_manifest_id` column,
  duplicate ordinal/duplicate-member rejection, append-only UPDATE/DELETE
  rejection (candidate and member), and zero rows created in
  `kai.export_candidates`/`kai.export_manifests`/
  `kai.human_authority_decisions`. Gated on
  `KAI_P14_03_GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_FOUNDATION_DATABASE_URL`
  (loopback-only, validated before any connection).
- `__tests__/kai-grant-response-packet-export-candidate-boundary.spec.js` —
  no-DB proof (20 tests): exact-keys input contract (rejects
  `memberIds`/`generatedContentDraftIds`/`exportCandidateId`/
  `exportManifestId`/`canonicalFingerprint`/
  `grantResponsePacketExportCandidateId`), and fingerprint composition
  (funder-only, convergence, member-order sensitivity, citation/blocker-state
  sensitivity, timestamp/manifest-track exclusion, key-order-independent
  hashing).
- `package.json`:
  `verify:kai-sprint2-p14-03-grant-response-packet-export-candidate-foundation`.

## Constraint-naming note

Several natural constraint/trigger names on
`kai.grant_response_packet_export_candidates` /
`..._candidate_members` exceeded Postgres's 63-byte identifier limit and
would have silently truncated. Renamed to fit, with the migration, verifier,
and failure-checks all agreeing on the shortened names (e.g.
`..._p14_03_convergence_unique` → `..._p14_03_converge_unq`; the member
table's constraints use a `grppec_members_p14_03_*` prefix rather than the
full table name). Confirmed with no truncation notice on a live forward →
rollback → forward re-application.

## Verification

`npm run verify:kai-sprint2-p14-03-grant-response-packet-export-candidate-foundation`
passed: migration verifier (16/16 checks), smoke-seed + smoke-verifier (4/4
checks), failure-checks (11/11 checks), and the focused Node test files above
(34/34: 20 boundary + 14 integration). Forward migration → rollback →
forward re-application was proven idempotent and clean (no truncation
notice) against a separate ephemeral Postgres instance. `DATABASE_URL` was
set to the non-listening loopback sentinel for every Node/npm command.
Directly affected regressions passed unmodified: P14-02 identity foundation
boundary/integration (15+10), the Grant Response Packet backend/render-model/
markdown-delivery/Impact-Library boundary suites (101 total), and the P3-16/
P3-17/P3-18/P3-19/P3-20 boundary suites (103 total) — none of which changed
behavior. Full suite (`npm test`) returned 3607 passed, 7 failed, 63
skipped — the 7 failures are the same pre-existing, unrelated batch/
file-detail baseline already documented in the living ExecPlan (child-file
read model, batch-files collection contract, file-detail 15-field allowlist,
file-detail contract); no new failure was introduced.

## Not done (explicitly out of scope)

- No route, HTTP handler, or existing packet DTO calls this repository —
  wiring is explicitly deferred.
- No approval, finalization, final-release authority, or manifest state is
  granted or implied by a candidate row existing.
- No PDF/DOCX work, no Board Summary work.
- No production/shared database change, deployment, push, or credential
  work.
