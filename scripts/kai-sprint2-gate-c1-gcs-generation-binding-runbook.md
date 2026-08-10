# KAI Gate C-1 GCS Generation Binding Foundation Runbook

This package adds exactly one new column
(`kai.intake_files.gcs_generation`) plus two additive repository methods
(`bindGcsGeneration`, `resolveGcsGenerationBinding`) and one dormant GCS
storage provider. It changes no Gate A migration, rollback, runner, verifier,
smoke, repository, service, or route artifact.

Run:

```sh
npm run verify:kai-sprint2-gate-c1-gcs-generation-binding
```

The runner:

- creates a temporary data directory under the OS temp directory;
- starts PostgreSQL 16 bound only to `127.0.0.1` on a runner-chosen port;
- creates the synthetic database `kai_gate_c1_gcs_generation_binding_synthetic`;
- applies the existing synthetic bootstrap schema and the existing frozen
  Gate A migrations, unmodified, then the new Gate C-1 forward migration;
- runs the Gate A verifier (regression) and the new Gate C-1 catalog
  verifier;
- runs the existing Gate A smoke seed/verifier/failure-checks, then the new
  Gate C-1 smoke seed, smoke verifier, and read-only failure checks;
- applies the Gate C-1 rollback, proves `gcs_generation` is gone, re-runs the
  Gate A verifier to prove Gate A is untouched, then reapplies the Gate C-1
  forward migration and re-runs its verifier;
- runs the Gate C-1 integration spec together with the existing Gate A
  upload-lifecycle-repository specs (in-memory, PostgreSQL, cross-implementation
  parity) against that runner-owned target only;
- stops PostgreSQL and removes the temporary directory.

The runner fails closed unless it proves the target database name, loopback
address, port, and `listen_addresses`. It must not be pointed at a shared,
quarantined, cloud, production, or real-client-data database.

The provider boundary spec
(`__tests__/kai-sprint2-gate-c1-gcs-provider-boundary.spec.js`) uses a mocked
`@google-cloud/storage` SDK and runs in the normal suites — it needs no
database and never contacts Google Cloud.

## Scope boundary

This package adds **no** live GCS connectivity, no application composition
change, and no feature-flag enablement. Not added (explicitly out of scope):

- selecting the GCS provider as the application's active storage provider;
- selecting `postgresUploadLifecycleRepository` in application startup;
- wiring `sprint2IntakeApi` to either;
- staging environment values, deployment, or cloud credential inspection;
- Gate C-2, P3-18, or any later gate.

## Pre-edit storage-binding check (why only `gcs_generation` was needed)

Before this migration existed, `kai.intake_files` already carried
`organization_id`, `intake_batch_id`, `intake_file_id`, `safe_filename`
(Gate A / P0), and `object_version_id` (Gate A). `storagePathPolicy.buildObjectKey`
already derives the deterministic GCS object key from exactly those four
values with no additional persistence. The only fact GCS's own identity
model requires that was not already durably resolvable was the native
`generation` number itself, since a GCS generation has no deterministic
relationship to any existing column. This package therefore adds exactly one
column, one pair of `CHECK` constraints, and one immutability trigger — no
new relation, no global `objectVersionId` lookup, and no change to
`storagePathPolicy` or the object-key structure.

## Schema

`gcs_generation numeric(20,0)`, nullable. `numeric(20,0)` (not `bigint`) is
used because a `pg` driver query returns `numeric` columns as JavaScript
strings, not `Number`s — this is what lets an exact GCS generation (which can
exceed `Number.MAX_SAFE_INTEGER`) round-trip through this column without
floating-point precision loss.

- `intake_files_gate_c1_gcs_generation_positive_check` — `gcs_generation IS
  NULL OR gcs_generation > 0`.
- `intake_files_gate_c1_generation_requires_object_version_check` —
  `gcs_generation IS NULL OR object_version_id IS NOT NULL`: binding cannot
  happen before Gate A's own `object_version_id` exists (i.e. not before
  `uploaded_unconfirmed`).
- `kai.enforce_gate_c1_gcs_generation_binding` (trigger
  `trg_gate_c1_gcs_generation_binding`, `BEFORE UPDATE`) — once
  `gcs_generation` is non-`NULL`, any attempt to change it raises an
  exception. This is a separate function/trigger from Gate A's
  `kai.enforce_gate_a_p0_upload_lifecycle`, so Gate A's existing
  transition/immutability logic is not touched by this migration.

## Repository binding

`bindGcsGeneration({ organizationId, intakeFileId, objectVersionId,
gcsGeneration, now })`, added identically to
`postgresUploadLifecycleRepository.js` and `inMemoryUploadLifecycleRepository.js`
outside the three-operation DI contract (mirroring the existing
`compareAndSetPolicyDecision` addition):

- validates `gcsGeneration` as a positive digit string
  (`/^[1-9][0-9]{0,19}$/`) that survives `Number(...)` without precision
  loss — fails closed (`validation_blocker`) otherwise, since the SDK's own
  generation option is passed through `Number(...)` internally and a value
  that cannot survive that conversion could bind to the wrong generation;
- requires the row's already-bound `object_version_id` to equal the caller's
  `objectVersionId` (fails closed with `conflict_current_state_changed`
  otherwise);
- if `gcs_generation` is already set: returns a same-fact replay success if
  it matches, otherwise a conflict (immutability) failure;
- otherwise persists it in one compare-and-set `UPDATE ... WHERE
  gcs_generation IS NULL` (Postgres) / equivalent guarded map write
  (in-memory).

`resolveGcsGenerationBinding({ organizationId, intakeFileId })` returns only
`{ object_version_id, gcs_generation }` — this is the sole read path for the
binding. `gcs_generation` is never added to the `record` shape returned by
`createReservedUploadLifecycle`, `getUploadLifecycle`,
`transitionUploadLifecycle`, or `compareAndSetPolicyDecision`, so it cannot
reach an ordinary DTO, audit payload, or log line through those paths.

## GCS provider

`Backend/kai/storage/googleCloudStorageProvider.js` never imports
`kaiDb.js`, any `pg` client, or any `kai.*` query helper — it only ever
receives an already-resolved object key and generation from its caller.
Credentials: `new Storage({ projectId })` with no `keyFilename` and no
embedded key material — Application Default Credentials only.
`Backend/kai/config/kaiSprint2GcsConfig.js` reads exactly one non-secret
environment key for the bucket name and fails closed (returns a disabled
provider) if it is absent or fails the safe-bucket-name pattern; the provider
is never selected as the application's active storage adapter by this
package.

### Signed upload

`createSignedUploadUrl({ objectKey, contentType })` calls the SDK's
`file.getSignedUrl({ version: "v4", action: "write", expires, contentType,
extensionHeaders: { "x-goog-content-length-range": "0,<max>",
"x-goog-if-generation-match": "0" } })`. SDK inspection
(`node_modules/@google-cloud/storage/build/cjs/src/signer.js`) confirms V4
signing merges `extensionHeaders` with `content-type` and includes every
resulting header key in `signedHeaders`, so the exact PUT method, object,
expiry, content type, size range, and create-only precondition are all part
of the signed request — not just advisory metadata the eventual PUT could
omit.

### Exact-generation stat/read/stream

`statExactGeneration`/`openExactGenerationReadStream` construct
`bucket.file(objectKey, { generation })` before calling `getMetadata()` /
`createReadStream({ validation: "crc32c" })`. A mismatched or later
generation causes GCS to respond with a `404` (the SDK surfaces this as an
error, not as a silent fallback to the current object), so an older
`objectVersionId` binding can never be satisfied by a newer generation.

### CRC32C

SDK inspection of `file.js`'s `createReadStream` (the code path used by
`openExactGenerationReadStream`) shows CRC32C validation is applied whenever
the read is a full, non-range read of an identity-encoded object: the SDK
parses the response's `x-goog-hash` header, builds a `HashStreamValidator`,
and destroys the stream with an error on mismatch. This package always
performs a full read and explicitly requests `validation: "crc32c"`. No
independent KAI CRC32C implementation is added. Real (non-mocked) CRC32C
behavior against a live bucket remains to be proven before
`P0_NONPRODUCTION_STORAGE_VERIFIED`, per Gate B.

## Rollback

`migrations/kai_sprint2_gate_c1_gcs_generation_binding.rollback.sql` drops
the new trigger and function, both new `CHECK` constraints, and the
`gcs_generation` column, in that order. It touches no Gate A object. The
runner proves this by re-running the Gate A verifier immediately after
rollback and before reapplying the Gate C-1 forward migration.

## Remaining facts requiring real synthetic GCS proof (not established here)

- actual signed-PUT enforcement (method, expiry, content-type, size-range,
  create-only precondition) by a real GCS bucket;
- actual CRC32C fail-closed behavior against real transferred bytes;
- actual generation-mismatch rejection against a real object with multiple
  generations;
- CORS behavior.

These remain explicitly deferred to Gate B/Gate C, which this package does
not begin.
