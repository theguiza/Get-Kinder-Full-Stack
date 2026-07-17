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

The internal repository interface defines one exact-identity, repository-neutral signal for an idempotent repository write conflict. Batch creation and intake-file metadata reservation both use that same exact-identity signal for write-time idempotency-conflict recovery. Neither live SQL insert adapter is claimed to emit it. PostgreSQL mapping, constraints, two-session proof, and atomicity remain Gate-A-dependent, and deployed-schema compatibility remains `NOT_CONFIRMED`.

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

## Owner-confirmed intake-batch file collection read

```text
route: GET /api/kai/sprint2/intake/admin/batches/:intakeBatchId/files
operation: read_intake
surface: internal operator collection read
implementation_status: unimplemented
decision_evidence: USER_CONFIRMED
```

This owner decision authorizes one later bounded implementation package for this route only. It does not implement or mount the route and does not authorize another P0-04 leaf or any mutation.

### Authorization, tenant controls, and parent validation

The route requires an authenticated mapped human actor, one contract-approved `read_intake` role, and active membership in the requested organization. It uses the established organization-input convention, including canonical organization UUID validation, without redefining that convention. `intakeBatchId` must also be a canonical UUID. Authorization, role, membership, and identifier validation must complete before any tenant-sensitive repository read. The accepted outer composition remains feature gate before authentication.

Before reading child files, the implementation must perform exactly one explicit tenant-scoped parent-batch lookup using both:

```text
organizationId
intakeBatchId
```

Parent validation follows these rules:

- No parent row returns the canonical `not_found` 404.
- A returned parent whose `organization_id` differs from the requested organization returns the identical canonical `not_found` 404.
- The public result never discloses whether a cross-tenant parent exists.
- The child-file query is not executed when parent validation fails.
- An existing authorized parent with no child files returns a successful 200 empty collection.
- No ID-only, organization-only, or unscoped fallback parent lookup is permitted.

### Repository-safe keyset pagination

The intended route-specific file cap is 25, but deployed enforcement is `NOT_CONFIRMED`. Keyset pagination is therefore load-bearing at the repository-safe boundary: it prevents unbounded reads when deployed or legacy data exceeds the intended cap, does not assume that a database constraint currently enforces 25 files, and remains valid if this route's collection size changes later.

The accepted pagination query parameters are `limit` and `cursor`, in addition to the route's already-established organization context. This route decision does not redefine the organization-input convention.

`limit` is optional and must be a decimal integer. Its minimum is 1, default is 25, and maximum is 25. Zero, negative, fractional, non-numeric, malformed, or above-maximum values return the canonical `invalid_request` result.

`cursor` is optional and is an opaque base64url token. Its decoded value must contain exactly:

```text
created_at: valid canonical ISO-8601 timestamp
intake_file_id: canonical UUID
```

Missing, extra, malformed, undecodable, incorrectly typed, or invalid cursor values return the canonical `invalid_request` result. Clients must not depend on the cursor's internal representation. Unknown pagination parameters must not silently change paging behavior and return the canonical `invalid_request` result.

Canonical ordering is:

```text
created_at DESC, intake_file_id DESC
```

`intake_file_id` is the unique tie-breaker. Continuation is exclusive:

```text
created_at < cursor.created_at
OR (
  created_at = cursor.created_at
  AND intake_file_id < cursor.intake_file_id
)
```

The child-file repository read must:

- fetch at most `limit + 1` rows;
- use both organization ID and intake batch ID predicates;
- apply the cursor predicate only when a valid cursor is supplied;
- never use offset pagination;
- never execute an unbounded query; and
- never add an unscoped fallback.

The service must return at most `limit` items. It sets `next_cursor` only when the extra row proves another page exists, derives `next_cursor` from the final returned item, and uses `next_cursor: null` when no later page exists.

### Success response and file-summary DTO

The route preserves the established outer KAI success envelope. Its successful `data` object is exactly:

```text
{
  items: FileSummary[],
  pagination: {
    limit: number,
    next_cursor: string | null
  }
}
```

An existing authorized parent with no files returns:

```text
{
  items: [],
  pagination: {
    limit: <validated effective limit>,
    next_cursor: null
  }
}
```

Each `FileSummary` is constructed field-by-field and may contain only:

```text
intake_file_id
intake_batch_id
organization_id
engagement_id
safe_filename
mime_type
file_size_bytes
file_policy_status
malware_scan_status
processing_status
parse_status
review_status
created_at
updated_at
```

`file_policy_status` and `malware_scan_status` are the canonical persisted names. Aliases such as `policy_status` and `malware_status` are not permitted. Row spreading, generic row serialization, blacklist deletion, and spread-then-delete DTO construction are prohibited.

`mime_type` and `file_size_bytes` are approved operator-visible metadata for file triage and file-policy review. They do not authorize raw-file access. They remain caller-declared or repository metadata unless later independently verified, and their DTO presence must not be described as security verification.

The route must never return:

```text
storage_provider
storage_bucket
storage_object_key
storage_uri
signed_url
file_extension
checksum
hash_algorithm
notes
unrestricted metadata
raw content
credentials
actor or membership context
client data
unapproved PII
```

A field's presence in a repository projection does not authorize it in the response. `checksum` and `hash_algorithm` remain internal integrity metadata for this route.

### Synthetic acceptance boundary

```text
repository_safe_acceptance:
mounted controls, tenant-scoped parent and child mocked reads,
bounded keyset pagination, deterministic ordering,
and explicit DTO boundary verified

deployed_kai_schema_compatibility: NOT_CONFIRMED
live_read_query_behavior: NOT_CONFIRMED
database_file_count_enforcement: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
distributed abuse/concurrency coordination: NOT_CONFIRMED
```

This synthetic boundary does not establish that the 25-file cap is deployed or enforced, that the route works against PostgreSQL, that file metadata has been independently verified, or that storage or raw-file access is enabled.

## Owner-confirmed internal-GK intake-file review-queue collection read

```text
route: GET /api/kai/sprint2/intake/admin/review-queue
operation: read_intake
surface: internal GK review-queue collection read
decision_evidence: USER_CONFIRMED
queue_type: intake_file_review
target_object_type: intake_file
active_statuses: open, in_progress, blocked, waiting_on_client, waiting_on_gk
excluded_statuses: resolved, cancelled
```

This route is internal to GK. Before any tenant-sensitive read it requires an authenticated mapped human actor, the generic `read_intake` capability, active membership in the requested organization, and at least one route-specific active organization role of `gk_admin`, `gk_operator`, or `gk_reviewer`. A `client_admin`, `client_reviewer`, or `client_contributor` who otherwise passes generic `read_intake` and active-membership checks still receives the canonical authorization denial at the route-specific GK restriction. The accepted outer composition remains feature gate before authentication.

The route uses exactly one organization-scoped bounded collection query. The query must include all of:

```text
organization_id = requested organization
queue_type = intake_file_review
target_object_type = intake_file
queue_status IN (open, in_progress, blocked, waiting_on_client, waiting_on_gk)
```

There is no unscoped query, fallback query, per-row target lookup, or ID-only lookup. `target_object_id` is an opaque intake-file identifier and is never dereferenced by this route.

The optional `limit` and `cursor` parameters reuse the intake-batch file collection's canonical-integer parser, malformed-cursor behavior, opaque base64url codec, and success envelope. The default and maximum limit are both 25. The cursor contains exactly `created_at` and `review_queue_item_id`, where the timestamp is canonical ISO-8601 and the identifier is a canonical UUID. Ordering and exclusive continuation are:

```text
ORDER BY created_at DESC, review_queue_item_id DESC

created_at < cursor.created_at
OR (
  created_at = cursor.created_at
  AND review_queue_item_id < cursor.review_queue_item_id
)
```

The repository reads at most `limit + 1` rows. The service returns at most `limit` items, emits `next_cursor` only when the probe row proves another page exists, and derives that cursor from the final returned item rather than the probe row.

Each review-queue DTO is constructed field-by-field in exactly this order:

```text
review_queue_item_id
organization_id
queue_type
target_object_type
target_object_id
priority
queue_status
due_at
summary
required_action
created_at
updated_at
```

`review_queue_item_id`, `organization_id`, and `target_object_id` are canonical UUID strings. The response never includes `assigned_to`, `blocked_reason`, queue metadata, internal notes, actor/session/membership context, storage information, credentials, raw content, client data, or PII. A blocked item may expose only its approved `queue_status`; a sanitized reason requires a separate owner decision. Markup characters in approved text remain inert JSON text and are never interpreted or rendered as HTML or Markdown by this route.

`summary` is null or a compact human-display synopsis of 1–200 Unicode code points after normalization. `required_action` is null or operator guidance of 1–1000 Unicode code points after normalization. Every non-null value must be a string, normalize to Unicode NFC, normalize CRLF and CR line endings to LF, trim outer whitespace, remain non-empty, and then be counted by Unicode code point. NUL, C0 or C1 controls other than tab and LF, and Unicode bidi embedding, override, isolate, or directional-formatting controls are rejected. Invalid text is not truncated, repaired, replaced, or silently stripped.

Every row returned by the bounded query, including the probe row, is validated before any response is serialized. Every row must match the requested organization, fixed queue type, fixed target type, active-status set, canonical identifiers, and text boundaries. Any inconsistent or malformed row fails the entire request with the canonical safe `500 system_error`, no items or partial collection, and no offending values or mismatched identifiers. Rows are never silently filtered.

```text
repository_safe_acceptance:
mounted feature/auth controls, GK-only route authorization after generic read authorization,
one bounded organization-scoped mocked read, fail-closed row validation,
stable duplicate-timestamp keyset pagination, and explicit DTO boundary verified

deployed_kai_schema_compatibility: NOT_CONFIRMED
live_read_query_behavior: NOT_CONFIRMED
database_atomicity: NOT_CONFIRMED
persistent_upload_lifecycle: NOT_CONFIRMED
distributed abuse/concurrency coordination: NOT_CONFIRMED
```

## Shared P0-04 human state-transition mutation contract

```text
decision_evidence: USER_CONFIRMED
applies_to: P0-04 human state-transition mutations
implementation_status: unimplemented
```

This shared decision records owner-approved rules for later route-specific P0-04 human state-transition mutations. It does not implement or mount any route, service, write helper, production export, role mapping, transition vocabulary, replay behavior, reason-code vocabulary, upload-state effect, review-queue effect, exact route error matrix beyond these shared rules, request body beyond the expected-status requirement, or success DTO.

### Expected-current-status concurrency

Each route must require a route-specific expected-current-status field. Do not introduce or require `record_version`.

Every target read and compare-and-set write must include:

```text
organization_id
target object ID
expected current status
```

A compare-and-set affecting zero rows after a valid scoped read returns canonical `409 conflict_current_state_changed`. An already-transitioned state is not a successful replay unless a later route-specific owner decision explicitly permits replay.

### Tenant-target non-disclosure

Every mutation must use organization-and-target-scoped reads and writes. No row and any defensive tenant mismatch must return the same canonical `404 not_found`.

The mutation must not use:

```text
ID-only lookup or write
separate tenant-probe query
fallback query
unscoped query
silent filtering
partial success
return of mismatched target identifiers
```

### Mutation and post-write validation ordering

The route-specific mutation must:

1. validate the scoped stored row;
2. perform the scoped compare-and-set mutation;
3. validate the returned post-write row;
4. only then persist the required audit event; and
5. commit only after required audit confirms success.

The returned row must match the requested organization, target ID, and approved new state, plus all route-specific stored-state invariants. A missing, malformed, cross-tenant, wrong-target, wrong-state, or internally inconsistent post-write row fails the mutation with canonical safe `500 system_error`.

Post-write validation failure suppresses required audit, suppresses metrics, rolls back all mutation side effects, and returns no partial result or offending identifiers.

### Required metadata-only audit

Every successful P0-04 human state transition requires field-allowlisted metadata-only audit persistence in the same transaction as all required mutation side effects.

The shared audit semantic allowlist is:

```text
actor user ID
actor type
organization ID
operation type
route
request ID
target object type
target object ID
prior status
new status
route-approved machine reason code, when applicable
validator keys actually executed
created timestamp
```

Each route may use only the applicable subset. It may not add request-derived fields without a further explicit owner decision. The audit payload must be constructed field-by-field from approved scalar values.

Forbidden audit material includes:

```text
raw content or parsed rows
prompts or generated text
unrestricted notes
copied request bodies
filenames or MIME values unless separately approved
checksums or hash values unless separately approved
storage provider, bucket, object key, URI, signed URL, or provider version identifier
credentials or infrastructure details
unrestricted actor, session, or membership records
unrestricted metadata
client data or unapproved PII
```

Audit persistence succeeds only when it returns an object with an own boolean data property named `ok` whose value is exactly `true`.

The following results are non-confirming and fail the transaction:

```text
thrown
rejected
skipped
missing
malformed
getter-backed ok
array with an ok property
non-boolean ok
ok !== true
```

Mutation failure suppresses audit and metrics. Required-audit failure rolls back all mutation side effects and suppresses metrics. Best-effort metrics run only after successful commit and cannot alter or roll back the successful mutation result.

### Composition boundary

Generic dependency injection and deterministic transaction providers must remain outside the canonical production barrel.

A mounted route may later add only a narrow internal production composition binding:

```text
the existing transaction interface
route-specific mutation persistence
route-specific required-audit persistence
optional post-commit metrics
```

Test injection remains accessible only through an explicitly test-only harness.

### Evidence boundary

Repository-safe tests may establish:

```text
mocked or in-memory compare-and-set behavior
identical transaction-context propagation
post-write validation ordering
required-audit rollback behavior
audit allowlist enforcement
post-commit metric ordering
```

They do not establish:

```text
deployed-schema compatibility
live PostgreSQL compare-and-set behavior
database atomicity
two-session conflict behavior
durable successful-audit persistence
persistent upload lifecycle
```

Those remain `NOT_CONFIRMED` until separately authorized Gate A verification.

## Audit, transaction, and persistence expectations

Audit payloads are metadata-only allowlists. Safe facts may include operation, actor type, organization-scoped object type and opaque ID, validator/reason code, request ID, route, state transition, timing, byte count, checksum verification outcome, and immutable version outcome. Raw content, parsed rows, prompts, credentials, signed URLs, private paths, bucket/object identifiers, unrestricted actor/session/membership records, and unapproved PII are forbidden.

Required audit is part of the authorized mutation transaction and rolls back with that mutation. Best-effort metrics are separate and never roll back a valid mutation. Final database atomicity remains `NOT_CONFIRMED` until Gate A.

The existing `withTransaction(callback)` helper in `Backend/kai/db/kaiDb.js` is the single authoritative callback-scoped repository transaction interface. Runtime orchestration supplies one callback, and that callback receives exactly one opaque transaction context. A successful callback completion commits and returns the callback result. A thrown error or rejected callback rolls back and rejects with that failure. Repository-neutral orchestration supplies the same context unchanged to injected mutation persistence and required-audit persistence. Real batch creation, file reservation, and audit repositories remain unwired to that orchestration.

Best-effort metrics are not an argument, callback, hook, or participant in this transaction interface. They run only after the transaction has committed, and outer orchestration contains any metrics failure so it cannot trigger rollback or replace the successful mutation result. Audit and metric payloads pass through separate explicit metadata-only allowlists; metrics exclude organization, object, request, and route identifiers. Runtime orchestration calls `withTransaction(callback)` without a provider. The optional transaction-provider parameter on the concrete helper is used only as an adapter-injection seam for deterministic contract tests; it does not add a second transaction interface. These repository-local interface tests establish orchestration semantics only and make no PostgreSQL atomicity or deployed-schema compatibility claim.

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
