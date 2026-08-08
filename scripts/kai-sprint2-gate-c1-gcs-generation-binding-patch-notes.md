# KAI Gate C-1 Patch Notes — GCS Generation Binding Foundation

## Owner decision on scope

Gate C-1 authorizes exactly one bounded, local-synthetic package: a dormant
GCS storage-provider foundation plus the minimum additive private
storage-binding persistence required to resolve the existing provider-neutral
`objectVersionId` to an exact, private, immutable native GCS generation. The
pre-edit binding check found that the existing Gate A authoritative metadata
(`organization_id`, `intake_batch_id`, `intake_file_id`, `safe_filename` via
`storagePathPolicy.buildObjectKey`, plus the existing `object_version_id`
column) already provides every other fact needed to resolve
`objectVersionId -> exact GCS object identity`. The only missing durable fact
is the native GCS generation number itself, so this package adds exactly one
new column, no new relation, and no global cross-tenant lookup.

## Added

- `migrations/kai_sprint2_gate_c1_gcs_generation_binding.sql` / `.rollback.sql`
  — forward/rollback migration adding `kai.intake_files.gcs_generation
  numeric(20,0)` (nullable), a `CHECK` requiring it be `NULL` or positive, a
  `CHECK` requiring `object_version_id` already be set before
  `gcs_generation` may be set, and a new, separate
  `kai.enforce_gate_c1_gcs_generation_binding` trigger enforcing that
  `gcs_generation` is immutable once bound. `numeric(20,0)` (not `bigint`) is
  used so the exact digit string round-trips through the `pg` driver without
  floating-point precision loss, since a native GCS generation can exceed
  `Number.MAX_SAFE_INTEGER`. No existing Gate A column, constraint, trigger,
  or transition edge is altered.
- `scripts/kai-sprint2-gate-c1-gcs-generation-binding-verifier.sql` — catalog
  verification (column type, both new `CHECK` constraints, the new trigger,
  and that the Gate A trigger/constraint remain present and unmodified).
- `scripts/kai-sprint2-gate-c1-gcs-generation-binding-smoke-seed.sql` — seeds
  one org1 `uploaded_unconfirmed` row (already past Gate A's object-version
  point) so the smoke verifier can exercise binding without re-deriving Gate
  A's own transition mechanics.
- `scripts/kai-sprint2-gate-c1-gcs-generation-binding-smoke-verifier.sql` —
  proves: generation absent before the lifecycle point at which binding is
  valid; a valid generation persists exactly once with no precision loss;
  the same row's generation is immutable once bound; a malformed
  (non-positive) generation is rejected; a generation cannot be bound before
  `object_version_id` exists; and the seeded row's existing Gate A
  `uploaded_unconfirmed -> confirmed` transition still works unchanged.
- `scripts/kai-sprint2-gate-c1-gcs-generation-binding-failure-checks.sql` —
  read-only negative checks: no new relation/global lookup table exists, no
  database view re-exposes `gcs_generation`, the new trigger's raised message
  does not embed raw generation/object-version facts, and the Gate A
  tenant-uniqueness index and object-version format check are unchanged.
- `scripts/kai-sprint2-gate-c1-gcs-generation-binding-local-postgres.js` —
  ephemeral loopback PostgreSQL 16 runner
  (`npm run verify:kai-sprint2-gate-c1-gcs-generation-binding`), following the
  existing Gate A/P3-16/P3-17 runners' exact mechanism, including a rollback
  -> verify-absent -> reapply -> verify-present round trip.
- `Backend/kai/upload/postgresUploadLifecycleRepository.js`,
  `Backend/kai/upload/inMemoryUploadLifecycleRepository.js` — added
  `bindGcsGeneration`, one additive method on each repository (outside the
  three-operation DI contract, following the exact
  `compareAndSetPolicyDecision` pattern already established for
  post-confirmation additions), and `resolveGcsGenerationBinding`, a private
  read accessor. Neither the ordinary `record` returned by
  `createReservedUploadLifecycle` / `getUploadLifecycle` /
  `transitionUploadLifecycle`, nor `compareAndSetPolicyDecision`'s record,
  exposes `gcs_generation` — it is only readable via
  `resolveGcsGenerationBinding`, which returns the minimal
  `{ object_version_id, gcs_generation }` pair and nothing else.
- `Backend/kai/storage/googleCloudStorageProvider.js` — replaced the
  zero-SDK disabled stub with a real (but dormant/disabled-by-default)
  provider using the pinned `@google-cloud/storage` SDK: keyless
  Application-Default-Credentials construction (no `keyFilename`, no
  embedded credentials), V4 signed-PUT construction (`createSignedUploadUrl`)
  with the exact required signed headers, and exact-generation
  stat/read/open-stream operations (`statExactGeneration`,
  `openExactGenerationReadStream`) that pin every call to a caller-supplied
  generation and never resolve "latest." Never imports or calls any SQL/`kai.*`
  database helper.
- `Backend/kai/config/kaiSprint2GcsConfig.js` — smallest non-secret
  configuration-key reader (bucket name, signed-upload expiry) and a
  dormant/disabled-by-default provider-selection factory seam
  (`createConfiguredGoogleCloudStorageProvider`). Missing or malformed
  configuration fails closed (returns a disabled provider, never throws into
  request handling).
- `__tests__/kai-sprint2-gate-c1-gcs-generation-binding.integration.spec.js`,
  `__tests__/kai-sprint2-gate-c1-gcs-provider-boundary.spec.js` — focused
  PostgreSQL-backed integration coverage for the binding, and boundary
  coverage (mocked SDK) for the provider contract, signed-header inclusion,
  CRC32C fail-closed behavior, generation-mismatch protection, and
  sanitized-error/no-leakage assertions.

## Changed (additive only)

- `package.json` — pinned `@google-cloud/storage` at exactly `7.21.0` (exact
  version, no range), plus added
  `verify:kai-sprint2-gate-c1-gcs-generation-binding` and
  `test:kai-sprint2-gate-c1-gcs-generation-binding` scripts. No existing
  script is changed.
- `Backend/kai/storage/googleCloudStorageProvider.js` — see "Added" above;
  this file's prior disabled-stub content is superseded by the real dormant
  provider this package authorizes. `Backend/kai/storage/storageProvider.js`
  (`DisabledStorageProvider`) is unchanged; the new provider does not extend
  it.
- `__tests__/kai-sprint2-storage-boundary.spec.js` — the assertion that
  `googleCloudStorageProvider.js` contains no `@google-cloud/storage` import
  is removed (superseded by this package's explicit authorization to
  implement the real SDK-backed provider); the assertion that the combined
  storage-provider source contains no database import/connection call is
  kept unchanged and now also covers the new provider file.

## Not changed

`Backend/kai/storage/storageAdapter.js`, `localDevStorageAdapter.js`,
`storagePathPolicy.js`, `objectStorageAdapter.js`, `kaiIntakeService.js`, and
every Gate A through P3-17 migration/repository/route/service file are
unedited. The new GCS provider is not selected anywhere in application
startup, `sprint2IntakeApi` is not wired to it, and
`postgresUploadLifecycleRepository` is not selected in application startup.
No feature flag is enabled. No cloud credential, bucket, or IAM/CORS
configuration was touched, inspected, or created. No route, listener,
scheduler, or UI control was added.

## Behavior summary

**Storage-binding design.** `objectVersionId` remains the sole
provider-neutral exact-version identity used across the API/service layer.
The exact private GCS object identity is derivable, without any new schema,
from the row's existing `organization_id` / `intake_batch_id` /
`intake_file_id` / `safe_filename` via `storagePathPolicy.buildObjectKey`.
The one previously-missing fact — the native GCS generation, which has no
deterministic relationship to any of those fields — is now persisted
privately and immutably on the same row via `gcs_generation`, bound at the
same lifecycle point Gate A already binds `object_version_id`
(`upload_started -> uploaded_unconfirmed`), and is never returned by any
ordinary record/DTO surface.

**Signed upload contract.** `createSignedUploadUrl` builds a V4
(`action: "write"`, method `PUT`) signed URL via the SDK's `getSignedUrl`,
with `extensionHeaders` carrying `x-goog-content-length-range` (bounded by
the existing `KAI_SPRINT2_MAX_FILE_SIZE_BYTES`) and
`x-goog-if-generation-match: 0` (create-only), plus the signed
`contentType`. SDK inspection of `signer.js` confirms every one of these
headers becomes part of the `signedHeaders` set actually included in the V4
canonical request, so the eventual raw HTTP `PUT` must supply them exactly as
signed or GCS will reject the request. No POST-policy or resumable-upload
path is used.

**CRC32C.** SDK inspection of `file.js`'s `createReadStream` shows CRC32C
validation defaults to `true` for a full (non-range) read of an
identity-encoded object, comparing against the `x-goog-hash` response header
and destroying the stream on mismatch. `openExactGenerationReadStream` always
performs a full (non-range) read and explicitly passes
`validation: "crc32c"` rather than relying on the default, so this fail-closed
path is exercised deliberately rather than incidentally. No duplicate KAI
CRC32C algorithm is implemented. Independent KAI SHA-256 verification
(`verifyExactObjectVersionStreamed`, unchanged) remains the separate,
mandatory identity check.

**Exact generation.** Every stat/read/open-stream call requires an explicit
`gcsGeneration` argument and pins the SDK `File` to that exact generation
(`bucket.file(objectKey, { generation })`); a later generation of the same
object never satisfies an older binding, since GCS itself returns a 404 for a
mismatched generation rather than silently serving the current one. Because
the SDK's own generation option is passed through `Number(...)` internally,
`normalizeExactGcsGeneration` fails closed (rejects) any digit-string
generation that would not survive that conversion without precision loss,
even though real-world GCS generation values are far below that bound today.

**Fails closed** on: missing/malformed provider configuration (bucket name
absent or not matching the safe-identifier pattern); a caller-supplied
generation that is not a positive, precision-safe digit string; a signed-URL
request for a disabled/unconfigured provider; and any provider error, which
is always re-shaped into a sanitized `{ ok: false, error_code }` result with
no bucket name, object key, generation, credential, or raw provider message
in its payload.
