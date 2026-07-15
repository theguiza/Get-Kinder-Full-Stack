# KAI Sprint 2 P0 repository contract

```text
contract_version: 0.3.5
decision_origin: USER_CONFIRMED owner-approved values in the living ExecPlan
repository_artifact_status: TOOL_VERIFIED only after the package tests pass
deployed_kai_schema_compatibility: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
```

This is the single non-executable repository contract for KAI Sprint 2 P0. The matching runtime constants are in `Backend/kai/config/kaiSprint2P0Contract.js`. This document defines intended repository behavior; it is not DDL, a migration, proof of a deployed schema, or authorization to access a database, storage provider, or production environment.

## Request and resource limits

Metadata JSON routes use these upper bounds before any larger global parser consumes the request:

```text
maximum_raw_JSON_body: 102400 bytes (100 KiB)
maximum_JSON_depth: 4
maximum_total_keys: 64
maximum_array_length: 25, only for route-allowlisted array fields
unknown_keys: reject
unknown_nested_objects: reject
maximum_files_per_batch: 25
pagination_default_limit: 100
pagination_max_limit: 100
pagination_order: stable route-specific key with a unique tie-breaker
```

Routes may impose lower bounds. Arrays and nested objects are rejected unless the route schema explicitly names them.

String and identifier limits are:

```text
checksum: exactly 64 hexadecimal characters on input; canonical form is 64 lowercase hexadecimal characters
hash_algorithm: exact literal sha256
idempotency_key: 8-128 characters
safe_filename: 1-181 characters
original_filename: 1-255 characters
MIME type: 1-128 characters
UUID: canonical hyphenated UUID syntax
machine status/error/reason code: 1-64 characters
human display label/title: 1-200 characters
safe operator note or required action: 1-1000 characters
unlisted string field: reject
```

The declared checksum is caller metadata and remains unverified until the exact immutable object version is independently streamed and hashed. The field name is `checksum`; executable repository verifiers must not require `checksum_sha256`. Uppercase hexadecimal input may be normalized to lowercase only after it passes the exact 64-character hexadecimal validator. A `sha256:` prefix is not accepted.

## Abuse, concurrency, and timing

```text
actor_mutation_attempts: 120 per 15-minute window
organization_mutation_attempts: 600 per 15-minute window
concurrent_uploads_per_actor: 2
concurrent_uploads_per_organization: 5
upload_idle_timeout: 30 seconds
upload_total_timeout: 270 seconds
reservation_expiry: 24 hours after reservation creation
```

Both mutation limiters count every attempt once a safe scope key can be derived, including failed authentication, authorization, tenant, schema, and validation attempts. Limit responses use HTTP 429, the canonical safe KAI error body, `Retry-After`, and standard rate-limit headers without exposing membership, identifiers, storage details, or infrastructure.

In-memory counters and permits are test-only and single-process. Production or multi-process enforcement requires a shared atomic coordination store. Concurrent-upload permits require separate actor and organization keys, bounded leases, expiry, partial-acquisition rollback, release on completion or abort, and crash recovery. Upload fails closed when shared enforcement is unavailable. No production coordination provider is selected by this contract.

The application total timeout must remain below every effective enclosing Node and upstream timeout. If an enclosing timeout is 270 seconds or less, implementation stops for the smallest owner-approved adjustment. Timeout cleanup may remove only incomplete test-local state and never deletes a confirmed object.

## Upload lifecycle and integrity

Transport lifecycle is not stored in `processing_status`, `parse_status`, or `review_status`. The intended dedicated `upload_state` vocabulary is:

```text
reserved
upload_started
uploaded_unconfirmed
confirmed
policy_blocked
abandoned
expired
```

The durable mapping must include an exact existing equivalent or, after Gate A authorization, fields for:

```text
upload_state_changed_at
upload_expires_at
provider-neutral immutable object-version identity
verified checksum state
verified checksum timestamp
```

Lifecycle semantics are:

- `reserved`: the reservation exists; `processing_status = quarantined`, `parse_status = quarantined`, `file_policy_status = pending`, expiry is 24 hours, and the caller checksum is unverified.
- `upload_started`: the first accepted byte or provider upload session start is recorded.
- `uploaded_unconfirmed`: the exact object version completed but independent size and checksum confirmation did not.
- `confirmed`: exact object version, byte size, and independently computed SHA-256 are verified.
- `policy_blocked`: `upload_state = policy_blocked` and `file_policy_status = blocked`.
- `abandoned`: explicit authorized abandonment before confirmation.
- `expired`: current time exceeds `upload_expires_at` before confirmation.

No lifecycle transition deletes an object or executes retention. P0-06A may implement this lifecycle only through dependency-injected interfaces and an in-memory synthetic repository. P0-06B durable persistence is blocked by Gate A.

Object integrity keeps declared and verified facts distinct:

```text
declared checksum: checksum + hash_algorithm
verified integrity: exact object-version identity + independently computed checksum + verified byte size + verified timestamp
declared media type: caller metadata, never authoritative
detected media type: deterministic security-assessor result
```

Bucket names, object keys, URIs, signed URLs, provider generations, and other provider-private identifiers are internal only. Ordinary DTOs, responses, errors, logs, metrics, and audits expose none of them. The provider-neutral object-version identity is opaque, server-generated, immutable, and version-bound.

## State and review vocabulary

Intended P0 state is:

```text
batch creation: processing_status = received; review_status = proposed
file reservation: processing_status = quarantined; parse_status = quarantined; review_status = proposed; file_policy_status = pending
file policy outcomes: pending, passed, blocked, failed
repository compatibility value not used for a new reservation: skipped
malware scan: not_configured, queued, running, passed, failed, skipped
review queue status: open, in_progress, blocked, waiting_on_client, waiting_on_gk, resolved, cancelled
```

No new enum value such as `security_assessment_pending` is introduced. A security pass changes only `file_policy_status`; the file remains quarantined and unparsed. No scanner means no policy pass.

The repository-recognized queue types are:

```text
intake_file_review
source_candidate_review
sensitivity_review
data_dictionary_review
evidence_review
claim_review
client_followup
conflict_resolution
generated_content_review
export_review
```

Only `intake_file_review` has a currently intended P0 target. A queue item may be created only for an existing organization-scoped target. P1 targets are not created to make later queue types usable. Review resolution is not approval, promotion, evidence eligibility, consent approval, or external-use authorization.

Mounted-P0 target types are `intake_batch` and `intake_file`. Metadata-only audit may additionally identify `engagement`, `review_queue_item`, `operation`, or `other`; audit object vocabulary does not authorize mutation of those targets.

## Idempotency, uniqueness, and versions

Fingerprints use SHA-256 over recursively stable JSON: object keys sorted lexicographically, array order preserved, JSON scalar encoding preserved, and omitted contract fields normalized to the exact defaults below. The installed and only supported P0 fingerprint version identifier is `kai-sprint2-p0-fingerprint-v1`. Inspection of the installed builders confirms that this identifier does not participate in the canonical hash input; this records current behavior and does not authorize changing the algorithm or input.

Batch fingerprint fields, in contract order, are:

```text
organization_id
engagement_id (null when absent)
batch_code
idempotency_key (null when absent)
intake_method (default manual_upload)
source_system_name (default null)
source_system_ref (default null)
notes (default null)
batch_metadata (normalized metadata-only P0 markers included)
```

File-reservation fingerprint fields are:

```text
organization_id
engagement_id (null when absent)
intake_batch_id
idempotency_key (null when absent)
original_filename (default null)
safe_filename
mime_type (default null)
file_extension (default null)
file_size_bytes (default 0)
checksum (canonical lowercase)
hash_algorithm (sha256)
reservation_metadata (default empty object)
```

The current persisted fingerprint representation remains exactly a bare 64-character lowercase SHA-256 hexadecimal digest, stored as `normalized_payload_hash` for batches or `reservation_payload_hash` for file reservations. No separate version discriminator is persisted. The current P0 implementation supports only the installed fingerprint version, and no second fingerprint version may be introduced until persisted-version compatibility is resolved.

Idempotency replay scope is organization plus operation plus idempotency key. An identical replay is allowed only when the stored fingerprint is a string in the exact current representation and equals the newly calculated fingerprint. A missing, null, empty, non-string, malformed, or different stored fingerprint fails closed as a 409 conflict; implementations do not regenerate, normalize, repair, accept, or overwrite the stored value during replay. Unsupported-version detection is not currently possible because no version discriminator is persisted and remains deferred to Gate A. Deployed-schema compatibility remains `NOT_CONFIRMED`.

Declared-checksum duplicate detection is preliminary and organization-scoped. It never represents independent object verification. `force_new_version` may permit an explicitly authorized new version, but the new record must link to its predecessor, receive a new immutable object-version identity, and retain its own checksum and audit history. Final uniqueness and concurrency behavior require Gate A verification.

## Authorization and operation matrix

Every human operation requires a mapped actor and active membership in the target organization. P0 mutation additionally requires the named global role:

```text
create_intake_batch: gk_admin or gk_operator
create_intake_file: gk_admin or gk_operator
create_review_queue_item: gk_admin or gk_operator
read_intake: gk_admin, gk_operator, gk_reviewer, client_admin, client_reviewer, or client_contributor, subject to route-specific policy
```

AI actors and generic `system` actors are denied mutation. The later security assessor uses a distinct internal-service contract:

```text
actor_type: internal_service
service_identity: kai_file_security_executor
operation_group: file_security_assessment
allowed_operations:
  record_file_security_result
  transition_file_policy_status
  write_file_security_audit
```

That executor must be tenant-bound and may record bounded security results, set file policy to passed/blocked/failed, and write metadata-only audit. It cannot change tenant, approve review, profile files, create sources/evidence/claims, expose raw content, or invoke arbitrary service operations. This package defines the identity but does not enable it.

## Audit, transaction, and persistence expectations

Audit payloads are metadata-only allowlists. Safe facts may include operation, actor type, organization-scoped object type and opaque ID, validator/reason code, request ID, route, state transition, timing, byte count, checksum verification outcome, and immutable version outcome. Raw content, parsed rows, prompts, credentials, signed URLs, private paths, bucket/object identifiers, unrestricted actor/session/membership records, and unapproved PII are forbidden.

Required audit is part of the authorized mutation transaction and rolls back with that mutation. Best-effort metrics are separate and never roll back a valid mutation. Final database atomicity remains `NOT_CONFIRMED` until Gate A.

The existing `withTransaction(callback)` helper in `Backend/kai/db/kaiDb.js` is the single authoritative callback-scoped repository transaction interface. Runtime orchestration supplies one callback, and that callback receives exactly one opaque transaction context. A successful callback completion commits and returns the callback result. A thrown error or rejected callback rolls back and rejects with that failure. Future mutation persistence and required-audit persistence may receive the same context unchanged through their query-runner injection points. They are not wired to it in this package.

Best-effort metrics are not an argument, callback, hook, or participant in this transaction interface. They run only after the transaction has committed, and outer orchestration must contain any metrics failure so it cannot trigger rollback. The optional transaction-provider parameter on the concrete helper is only an adapter-injection seam for deterministic contract tests; it does not add a second transaction interface. These repository-local interface tests establish orchestration semantics only and make no PostgreSQL atomicity or deployed-schema compatibility claim.

Intended constraints and indexes, without executable DDL, include:

```text
unique organization_id + batch idempotency_key
unique organization_id + batch_code where the product contract requires it
organization-scoped declared-checksum lookup with force-new-version semantics
organization predicates on every tenant-sensitive read and write
bounded 25-file batch enforcement
allowed upload_state transitions and reservation expiry
immutable exact object-version confirmation and identical-replay rules
required foreign keys for organization, engagement, batch, file, review target, predecessor version, and actor where applicable
```

Any new column, check, enum, index, trigger, transaction assumption, or migration remains blocked by Gate A.

## Data ownership and disabled boundaries

`organization_id` is the tenant boundary. `engagement_id` is the project/engagement boundary and is carried on batches, files, reviews, audits, and jobs where supported. Target identifiers never establish tenant scope by themselves.

Retention metadata must distinguish retention classification, expiry, legal hold, and authorized disposition state. Exact persistent fields or equivalents require Gate A inspection; no P0 transition performs deletion, cleanup, or retention execution.

Upload, confirmation, storage execution, parser/profile/data-dictionary generation, source/evidence/claim creation, generation, export, graph behavior, and client-facing review remain disabled unless their later authorized package explicitly enables the repository-safe portion. Production/database-backed upload remains fail closed through P0-06A.

Completion of this contract does not establish database integration, deployed schema compatibility, persistent upload lifecycle, nonproduction storage integration, live-upload readiness, production readiness, or real-client-data readiness.
