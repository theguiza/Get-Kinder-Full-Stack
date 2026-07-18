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

## P0-05B filename rejection boundary

P0-05B rejects:

- the exact reserved basenames CON, PRN, AUX, NUL, COM1 and LPT1,
  case-insensitively;
- a terminal .exe suffix, case-insensitively;
- the specifically approved controls, bidi characters, traversal,
  separators and empty filename cases.

Direct-service safeFilename and payload.safe_filename bypasses for
those exact grounded categories are closed.

NOT completed by P0-05B:

- reserved names with extensions, including con.txt;
- trailing-dot or trailing-space reserved-name semantics;
- COM2-COM9 and LPT2-LPT9;
- other platform-specific reserved names;
- .bat, .cmd, .com, .scr, .js, .vbs, .sh or other executable/script suffixes;
- arbitrary multiple-extension or double-extension policy;
- .backup and other unspecified extension patterns;
- extension/MIME/signature agreement;
- general Unicode-normalization policy;
- Content-Disposition serialization.

The P0-05B gate does not decide decomposed Unicode, ordinary spaces, ordinary punctuation, drive-style path candidates without slash or backslash separators, con.txt, .backup, other reserved-name variants, other executable/script/markup suffixes, or arbitrary multiple-extension patterns.

## P0-05C TXT/MD encoding and deterministic binary-content boundary

```text
decision_evidence: USER_CONFIRMED
owner_decisions:
OWNER_DECISION.P0_05C.STRICT_UTF8_ONLY
OWNER_DECISION.P0_05C.UTF8_BOM_ALLOWED
OWNER_DECISION.P0_05C.UNSUPPORTED_BOM_REJECTION
OWNER_DECISION.P0_05C.INVALID_UTF8_REJECTION
OWNER_DECISION.P0_05C.NUL_REJECTION
OWNER_DECISION.P0_05C.PROHIBITED_CONTROL_REJECTION
OWNER_DECISION.P0_05C.LONE_CR_REJECTION
OWNER_DECISION.P0_05C.EMPTY_CONTENT_ENCODING_GATE_PASS
OWNER_DECISION.P0_05C.INSTRUCTION_TEXT_IS_INERT_DATA
OWNER_DECISION.P0_05C.NONLEADING_UFEFF_ALLOWED_AS_TEXT
```

`OWNER_DECISION.P0_05C.LONE_CR_REJECTION` records that a TXT or MD file using CR-only line endings is rejected by the P0 encoding and deterministic binary-content gate. This includes legacy Mac-style text where line boundaries are represented only by `U+000D CR`, unless each CR is immediately followed by `U+000A LF`. P0 accepts LF and CRLF, rejects lone CR, does not normalize line endings, does not rewrite the quarantined object, and does not transcode legacy line-ending formats. CR-only text must not be described as malformed UTF-8 merely because of the lone CR rule; it may be valid UTF-8 but is blocked under the deterministic binary-content policy.

`OWNER_DECISION.P0_05C.EMPTY_CONTENT_ENCODING_GATE_PASS` records that an empty TXT or MD byte sequence passes only this narrow check:

```text
strict UTF-8 and deterministic binary-content gate
```

The empty-content result is:

```text
encoding_gate_pass_only
not_document_validity
not_content_usability
not_profile_eligibility
not_source_eligibility
not_security_assessment_completion
```

Do not use broad completion language such as `empty files are valid`, `empty uploads are accepted`, or `empty documents are supported`. A later validator may block empty content for usefulness or workflow reasons as a separate decision.

The planned TXT/MD fixture corpus must cite owner-decision identifiers for every expected result. The future empty-file fixture must include metadata equivalent to:

```text
expected_policy: allow
expected_category: encoding_gate_pass
scope_note: encoding_gate_pass_only
usable_document_claim: false
source_eligibility_claim: false
corpus_status: corpus_only
```

No fixture may convert an encoding-gate result into a broader document-validity claim.

`OWNER_DECISION.P0_05C.NONLEADING_UFEFF_ALLOWED_AS_TEXT` records that one `EF BB BF` sequence is treated specially as the optional UTF-8 BOM only when it begins at byte offset zero. That one leading sequence may be ignored for strict UTF-8 encoding-gate validation. An `EF BB BF` sequence occurring anywhere after byte offset zero decodes as Unicode `U+FEFF`. Non-leading `U+FEFF` passes the narrow P0 TXT/MD encoding and deterministic binary-content gate because it is valid strict UTF-8, not NUL, not a prohibited C0 control, not DEL, not a C1 control, and not lone CR.

The gate must not strip non-leading `U+FEFF`, normalize non-leading `U+FEFF`, reinterpret it as another BOM, reject it merely because its UTF-8 encoding is `EF BB BF`, attach semantic meaning to it, or treat it as an instruction, policy, approval, or review decision.

When two consecutive `EF BB BF` sequences occur at the beginning of the byte stream, the first may be treated as the single optional leading UTF-8 BOM and the second decodes and remains as an ordinary permitted `U+FEFF` character.

Passing this decision establishes only:

```text
encoding_gate_pass_only
```

It does not establish:

```text
document validity
content usability
profile eligibility
source eligibility
evidence eligibility
semantic safety
security-assessment completion
upload acceptance
```

Do not generalize this decision to all zero-width characters, Unicode formatting characters, or Unicode format controls. It applies only to `U+FEFF` under the P0 TXT/MD encoding and deterministic binary-content gate.

The future P0-05D TXT/MD byte-fixture corpus must include a positive fixture containing non-leading `U+FEFF`. That fixture must cite `OWNER_DECISION.P0_05C.NONLEADING_UFEFF_ALLOWED_AS_TEXT` and use metadata equivalent to:

```text
expected_policy: allow
expected_category: encoding_gate_pass
scope_note: encoding_gate_pass_only
```

The future corpus must not contain a grounded blocking fixture whose only rationale is that `EF BB BF` occurs after byte offset zero or is described as a "non-leading UTF-8 BOM." A second `EF BB BF` immediately following the optional leading BOM is also a permitted `U+FEFF` case at this narrow gate.

Future P0-05D fixture-integrity tests must actively establish UTF-8 validity using:

```js
new TextDecoder("utf-8", { fatal: true })
```

Every fixture labeled valid UTF-8 must decode successfully in fatal mode. Every fixture labeled invalid UTF-8 must throw in fatal mode. Byte-array or hexadecimal comparison alone is insufficient to establish UTF-8 validity. Replacement-character decoding is not authoritative evidence of validity. The check must operate on the fixture bytes themselves and must not rely on JavaScript string coercion to construct or classify invalid UTF-8 fixtures. This is a future P0-05D requirement only; it does not implement tests, fixtures, helper code, or production decoding.

This P0-05C decision follows the required P0 security-policy style: deterministic and enumerated; reject rather than guess or silently transcode; no percentage, density, entropy, or language heuristics; no charset autodetection; no mutation of quarantined bytes; no execution or semantic interpretation of content; and raw bytes and decoded content excluded from blockers, responses, audit, metrics, and logs.

This statement guides later P0-05 decisions but does not define CSV, XLSX, PDF, MIME/signature, or malware policy. Those controls require separate owner decisions.

## P0-05F.1 extension, declared MIME, signature, and structural-type agreement

```text
decision_evidence: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1
owner_decisions:
OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1
OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1
OWNER_DECISION.P0_05F.DETECTED_PERMITTED_TYPE_CONTRADICTION_V1
decision_scope: deterministic P0 gate for terminal extension, declared file MIME, shallow byte signature, minimum structural-type identity, and agreement between those signals
broader_file_security_assessment_completed: false
runtime_behavior_changed_by_this_decision: false
```

All required type signals must agree. A legitimate file with an inconsistent extension, declared MIME, detected signature, or minimum structure is blocked rather than guessed, repaired, or reclassified. No signal wins over another: extension, declared MIME, detected signature, and minimum structure have no fallback precedence.

The only allowed P0 file extensions are:

```text
.csv
.xlsx
.md
.txt
.pdf
```

Extension comparison is ASCII case-insensitive, accepted extension input is canonicalized to lowercase, exactly one terminal extension is evaluated, every other extension is unsupported and blocks, and no filename extension can override MIME, signature, or minimum structure. Multiple-extension and filename-hazard rules remain governed by the committed filename policy. Examples: `REPORT.CSV` canonicalizes to `.csv`; `report.csv.exe` blocks as unsupported or dangerous terminal extension; `report.json` blocks as unsupported extension.

The declared file MIME is separate from the HTTP request-envelope `Content-Type`. Declared file MIME is normalized by trimming surrounding ASCII whitespace and lowercasing the type and subtype. MIME parameters are not accepted in P0 file metadata; for example, `text/plain; charset=utf-8` blocks rather than being silently stripped or reinterpreted.

The declared file-MIME matrix is:

```text
.csv
  text/csv
  application/csv

.xlsx
  application/vnd.openxmlformats-officedocument.spreadsheetml.sheet

.md
  text/markdown
  text/plain

.txt
  text/plain

.pdf
  application/pdf
```

Markdown MIME compatibility is asymmetric by owner decision: `.md + text/markdown` is permitted, `.md + text/plain` is permitted for P0, `.txt + text/plain` is permitted, and `.txt + text/markdown` blocks as `declared_type_mismatch`. Markdown may be declared as plain text in P0; a plain-text file is not thereby accepted as Markdown.

The following are not accepted as declared file MIME values: `application/json`, `application/octet-stream`, `text/html`, `text/javascript`, `application/javascript`, `application/zip`, `application/x-zip-compressed`, unknown MIME, empty MIME, and every value not explicitly listed in the matrix. `application/octet-stream` may later serve as an HTTP upload transport envelope; it is not an accepted declared file MIME.

Current runtime declared file-MIME behavior accepts `application/json`. That is current runtime behavior only, is not policy authority, conflicts with `OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1`, remains a known unresolved code-alignment gap after this documentation decision, and must be corrected only in a later separately authorized implementation package. This P0-05F.1 documentation decision does not remove `application/json` from the runtime allowlist and must not be represented as fixed or runtime-aligned.

Block when the extension is unsupported; the MIME is unsupported; extension and MIME do not map to the same permitted type; a detected signature identifies another type; minimum structure contradicts the declared type; bytes are ambiguous where a deterministic type cannot be established; bytes are truncated below the required minimum; or no permitted type can be established deterministically.

Do not trust declared MIME over bytes, trust extension over bytes, rewrite the declaration from detected bytes, guess a likely type, apply fallback MIME detection, accept because one signal matches, or repair inconsistent metadata automatically.

`OWNER_DECISION.P0_05F.DETECTED_PERMITTED_TYPE_CONTRADICTION_V1` records that when terminal extension and declared file MIME jointly identify one permitted P0 type, but byte signature and the required minimum structure deterministically establish a different permitted P0 type, the file blocks as `block / declared_type_mismatch`.

This rule applies symmetrically to every naturally reachable permitted-type contradiction. It is not a PDF-specific exception. `declared_type_mismatch` covers both: terminal extension and declared MIME disagree with each other; and terminal extension and declared MIME agree on one permitted type, but deterministic byte signature and required minimum structure establish a different permitted type. The jointly declared metadata type does not become authoritative merely because its extension and MIME agree with each other. No signal wins, rewrites, repairs, or reclassifies another signal. The file blocks rather than rewriting the extension, rewriting the declared MIME, reclassifying the file, selecting a fallback type, or accepting because one signal pair agrees.

Non-executable category examples:

```text
PDF contradiction
extension: .txt
declared MIME: text/plain
bytes: complete positive PDF shallow identity
  - %PDF- at offset zero
  - %%EOF within the final 1024 bytes
result: block / declared_type_mismatch

XLSX contradiction
extension: .txt
declared MIME: text/plain
bytes: complete positive XLSX shallow identity
  - ZIP local-file-header signature
  - readable EOCD and central directory
  - exact required OOXML entries
result: block / declared_type_mismatch
```

This detected permitted-type contradiction case is not `unsupported_file_type`, because the extension and declared MIME are individually permitted; not `truncated_or_malformed_type`, because the detected permitted type satisfies its complete committed shallow identity; not `disallowed_binary_signature`, because the detected type is a permitted P0 type, not MZ, ELF, standalone ZIP, RAR 4, RAR 5, 7z, gzip, or another recognized disallowed signature; not `standalone_archive_or_non_xlsx`, because complete XLSX shallow identity is established when the detected type is XLSX; not `ambiguous_file_type`, because one different permitted byte-established type is deterministically identified and multiple permitted types do not remain plausible; and not `unknown_binary`, because the bytes are deterministically identified as a permitted PDF or XLSX type.

A pass establishes only:

```text
type_agreement_pass_only
```

It does not establish document validity, document usability, machine-readable PDF status, encryption or password status, macro safety, active-content safety, archive-expansion safety, malware cleanliness, profile eligibility, source eligibility, upload acceptance, or complete file-policy pass.

CSV, MD, and TXT have no unique reliable magic signature for this P0 gate. For those types, extension and declared MIME select the permitted text subtype; bytes must pass strict UTF-8 and deterministic binary-content validation; no semantic parsing distinguishes CSV, MD, or TXT; content meaning is not inspected; and instruction-like content remains inert data. Do not invent byte-level cross-type distinction among CSV, MD, and TXT. CSV uses the committed strict UTF-8, BOM, NUL, prohibited-control, and lone-CR boundary already established for P0 text bytes. This does not decide CSV row limits, CSV delimiter validity, CSV header validity, CSV formula handling, or CSV parser behavior. Valid permitted text containing HTML, JavaScript, shell syntax, prompt injection, or other instruction-like strings is not reclassified as HTML or script content merely because those strings occur in the text. HTML and script uploads are blocked through unsupported extension/MIME and recognized disallowed binary identity, not through heuristic scanning of valid permitted text. Empty CSV, MD, or TXT bytes may pass this gate only when extension and MIME agree and the strict text-byte gate passes; the result remains `type_agreement_pass_only`.

A candidate PDF must use extension `.pdf`, declare `application/pdf`, begin at byte offset zero with ASCII `%PDF-`, and contain ASCII `%%EOF` within the final 1024 bytes. Leading bytes before `%PDF-` are not accepted. The PDF shallow identity rule does not establish machine-readable text layer, unencrypted status, password-free status, valid cross-reference structure, absence of JavaScript, absence of active actions, absence of embedded files, or complete PDF validity.

A candidate XLSX must use extension `.xlsx`, declare `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, begin with a ZIP local-file-header signature, expose a structurally readable end-of-central-directory record, expose a structurally readable central directory, and contain exact case-sensitive central-directory entry names `[Content_Types].xml`, `_rels/.rels`, and `xl/workbook.xml`. A generic ZIP prefix is insufficient, and finding a required name somewhere in raw bytes is not proof that it is a valid central-directory entry.

`OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1` records the owner's explicit ratification of the stricter XLSX identity boundary identified by read-only audit of commit `854e3ccf06f477e014999aa4983814cbd8b8a310`. This owner decision was made after reviewing the exact contract diff and is not merely acceptance of an implementation side effect.

The XLSX shallow identity rule establishes ZIP entry identity only by parsing ZIP structure. It must locate and validate the end-of-central-directory record; read the recorded central-directory offset and byte length; verify those values remain within fixture byte bounds; iterate valid central-directory records; obtain entry names from those records; validate each record length before advancing; validate each recorded local-header offset; verify the expected number of directory entries; and establish required-entry presence from the parsed directory-name set. It must not establish required-entry presence through raw-byte substring search, regular-expression search over the byte buffer, decoded whole-buffer text search, or grep-like matching.

The future shallow XLSX identity detector may inspect ZIP signatures, local headers, central-directory metadata, end-of-central-directory metadata, entry names, entry offsets, and stored and compressed lengths needed for bounded structural verification. It must not, in this P0-05F identity gate, decompress entry contents, parse worksheet XML, parse workbook XML content, read cell values, expand archive data, execute macros, follow relationships, use the filesystem, or invoke external ZIP utilities. A test-only ZIP builder may create deterministic stored empty entries without adding a dependency, but it must calculate and encode local-file-header offsets, central-directory record offsets, central-directory byte length, central-directory start offset, entry count, and end-of-central-directory metadata.

The positive minimum XLSX fixture must be a readable ZIP whose central-directory offsets, record lengths, entry counts, bounds, and local-header references are internally consistent; it expects `allow / type_agreement_pass / type_agreement_pass_only`. Missing-entry negative fixtures must be separate readable ZIPs for missing `[Content_Types].xml`, missing `_rels/.rels`, and missing `xl/workbook.xml`, each with the other two required entries present and exactly the claimed entry absent; each expects `block / standalone_archive_or_non_xlsx`. A wrong-case fixture must be a readable ZIP with exactly one required entry present only under incorrect case, such as `xl/Workbook.xml`; it expects `block / standalone_archive_or_non_xlsx`. A renamed non-OOXML ZIP must remain readable, omit at least one exact required OOXML entry, and not qualify merely because raw bytes contain similar strings; it expects `block / standalone_archive_or_non_xlsx`. Malformed and truncated ZIP fixtures must remain separate from missing-entry and standalone-archive fixtures, including truncated local-file-header signature, local header without readable central directory, invalid or out-of-bounds central-directory offset, and truncated central-directory record; each expects `block / truncated_or_malformed_type`.

Generic and standalone ZIP coverage must remain separate for readable arbitrary ZIP with allowed non-XLSX metadata, readable ZIP with `.xlsx` metadata but missing minimum OOXML structure, and recognized standalone ZIP signature with otherwise permitted non-XLSX metadata. This rule does not establish macro absence, external-relationship absence, encryption/password status, OOXML path safety, sheet limits, cell limits, entry-count limits, expanded-size limits, compression-ratio safety, or complete workbook validity.

Fixture packages are graded against frozen owner authority. Fixture packages must never modify this contract. When a fixture package discovers a contract gap, execution must stop for an owner decision. Contract and fixture changes must not be combined in one implementation commit.

The future corpus must include deterministic block cases for at least DOS/PE MZ, ELF, standalone ZIP, RAR 4, RAR 5, 7z, and gzip. A recognized disallowed signature blocks as `disallowed_binary_signature` regardless of an allowed extension or declared MIME. `declared_type_mismatch` must not absorb MZ, ELF, standalone ZIP, RAR 4, RAR 5, 7z, gzip, or unknown binary cases. The detected permitted-type contradiction decision applies only where the byte-established type is itself a permitted P0 type and its complete committed shallow identity is satisfied. A non-text byte stream that does not satisfy the permitted PDF or XLSX shallow identity rule blocks as `unknown_binary`. This list does not mean every executable or archive format is individually identified; unknown binary input remains fail-closed.

Deterministic block outcomes:

```text
unsupported extension or MIME -> block / unsupported_file_type
extension and MIME disagreement -> block / declared_type_mismatch
extension and MIME agree on one permitted type but complete byte identity establishes another permitted type -> block / declared_type_mismatch
recognized disallowed signature -> block / disallowed_binary_signature
ZIP without minimum XLSX structure -> block / standalone_archive_or_non_xlsx
PDF or XLSX signature present but minimum identity incomplete -> block / truncated_or_malformed_type
multiple permitted types genuinely remain plausible after applying all committed signals -> block / ambiguous_file_type
non-text bytes matching no permitted binary type -> block / unknown_binary
```

No ambiguous, malformed, truncated, or unknown input is permitted. `ambiguous_file_type` is a defensive fail-closed category. The future fixture corpus must not invent a contrived or semantically impossible byte case solely to exercise it; include an `ambiguous_file_type` fixture only if a naturally reachable case exists under the committed matrix, otherwise record the category as defensive and currently unexercised. Do not weaken or alter another fixture merely to manufacture ambiguity, and do not treat absence of an ambiguity fixture as incomplete coverage when the category is unreachable by construction.

Future sequence:

```text
P0-05F.2: complete synthetic extension/MIME/signature fixture corpus
P0-05F.3: read-only detector measurement against the corpus
P0-05F.4: pure unwired detector if measurement confirms absence
separate runtime-alignment leaf: remove application/json and align the current declared file-MIME runtime allowlist only after explicit authorization
```

The fixture corpus must precede detector implementation, and the runtime-alignment change must not be silently merged into fixture or detector packages. The future fixture corpus must include every allowed extension/MIME pairing; every grounded cross-type mismatch; uppercase extension normalization; unsupported extensions; unsupported MIME values; `application/json` rejection; `application/octet-stream` declared-MIME rejection; MIME-parameter rejection; empty text-family cases; PDF positive and truncated cases; XLSX positive minimum structure; standalone ZIP; renamed ZIP; recognized executable/archive signatures; unknown binary; instruction-like permitted text remaining inert; and `ambiguous_file_type` only under the defensive-category rule.

This decision does not settle or implement CSV row count, CSV delimiter/header validity, CSV formula-injection handling, XLSX macro detection, XLSX external relationships, OOXML path traversal, archive expansion limits, PDF text-layer proof, PDF encryption, PDF JavaScript/actions, PDF embedded files, malware scanning, upload transport, storage integration, parser/profile behavior, or production wiring. It does not reopen P0-05A through P0-05E.

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

## P0-04 route-specific human mutation: file policy block

```text
route: POST /api/kai/sprint2/intake/admin/files/:intakeFileId/block
operation: mark_file_policy_blocked
decision_evidence: USER_CONFIRMED
implementation_status: implemented in this package after verification
```

This route binds the shared P0-04 human state-transition mutation contract to one mounted operation only. It preserves the established feature-gate and authentication order, uses the mounted admin route organization-input convention, and validates both `organization_id` and lowercase canonical `intakeFileId` UUIDs before tenant-sensitive access.

Authorization requires a mapped human actor, `gk_admin` or `gk_operator`, and active membership in the requested organization before the scoped file read. `gk_reviewer`, client roles, AI, system, internal-service, import, and code actors are denied. The established actor- and organization-scoped mutation-attempt controls apply; no new limiter design or provider is introduced.

The request body accepts exactly:

```json
{
  "expected_file_policy_status": "pending",
  "blocking_reason_code": "unsafe_filename"
}
```

The only accepted `expected_file_policy_status` is `pending`. The accepted `blocking_reason_code` values are:

```text
unsafe_filename
unsupported_mime_type
file_too_large
checksum_conflict
malware_failed
csv_formula_injection_risk
storage_path_invalid
other_policy_violation
```

Unknown keys, nested objects, arrays, nulls, unrestricted `blocked_reason`, operator notes, `required_action`, queue fields, metadata objects, idempotency keys, `record_version`, and upload-state instructions are rejected with canonical `422 validation_blocker`.

The only permitted transition is:

```text
file_policy_status: pending -> blocked
```

Stored `pending` is eligible for the organization-and-file-scoped compare-and-set write. Stored `blocked` returns canonical `409 conflict_current_state_changed` and is not an idempotent success. Stored `passed`, `failed`, or `skipped` returns canonical `422 state_transition_denied`. Null, missing, unknown, malformed, or internally inconsistent stored status returns safe `500 system_error`.

Inside the shared transaction composition, this route performs one organization-and-file-scoped read, validates the complete stored row, performs one organization-and-file-scoped compare-and-set write requiring `file_policy_status = pending`, validates the returned post-write row, persists the required successful audit, and commits only after audit success. No ID-only lookup or write, tenant probe, fallback, unscoped query, partial response, or partial success is permitted. No row and defensive tenant mismatch return identical canonical `404 not_found`. A zero-row compare-and-set after a valid scoped read returns `409 conflict_current_state_changed`.

The write changes only `file_policy_status` to `blocked`; repository-managed `updated_at` may change only if the repository already manages it. The route leaves processing status, parse status, review status, malware status, storage and integrity fields, all upload-lifecycle fields or equivalents, and all unrelated file fields unchanged.

This route performs no review-queue mutation. It does not create, update, deduplicate, resolve, block, or otherwise modify an `intake_file_review` item and does not write `summary`, `required_action`, `blocked_reason`, `priority`, `assigned_to`, `due_at`, or queue metadata. Any later coupling between file blocking and queue work requires a separate owner-approved route contract.

The successful audit uses only the shared allowlist values applicable to this route: actor user ID, actor type, organization ID, operation type `mark_file_policy_blocked`, canonical route, request ID, target object type `intake_file`, target object ID, prior status `pending`, new status `blocked`, approved `blocking_reason_code`, validator keys actually executed, and created timestamp. It does not audit a copied request body or unrestricted text.

The success response uses the established KAI success envelope. Its `data` object is exactly the same 14-field file DTO as `GET /api/kai/sprint2/intake/admin/files/:intakeFileId`:

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

The response excludes storage provider, bucket, object key, URI, signed URLs, checksum, hash algorithm, upload-state and immutable-version details, raw content, unrestricted metadata, credentials, infrastructure, audit payload, transaction context, actor/session/membership context, review-queue internals, client data, and PII.

Durable `upload_state = policy_blocked`, persistent lifecycle compatibility, and the full two-field lifecycle mapping remain `NOT_CONFIRMED` and deferred to separately authorized lifecycle/Gate A work.

## P0-04 route-specific human mutation: review-queue status update

```text
route: POST /api/kai/sprint2/intake/admin/review-queue/:reviewQueueItemId/status
service: updateReviewQueueStatus
operation: update_review_queue_status
surface: internal GK status-only mutation
decision_evidence: USER_CONFIRMED
implementation_status: unimplemented
```

This route-specific owner decision binds the shared P0-04 human state-transition mutation contract to this review-queue status route only. It is documentation-only, does not implement or mount the route, and does not authorize orchestration-guard preauthorization, runtime code, tests, another leaf, P0-05 work, deployment, database access, schema work, feature-flag changes, tenant changes, or production configuration changes. The shared compare-and-set, tenant-nondisclosure, post-write-validation, transactional-audit, metrics, composition, and evidence-boundary rules remain controlling. The established composition remains feature gate before authentication, and the route uses the established mounted admin route organization-input convention.

Authorization requires an authenticated mapped human actor, `gk_admin` or `gk_operator`, and active membership in the requested organization before tenant-sensitive queue or target access. `gk_reviewer`, all client roles, AI actors, system actors, internal-service actors, import actors, and code actors are denied.

The request body accepts exactly:

```json
{
  "expected_queue_status": "open",
  "new_queue_status": "in_progress"
}
```

Both fields are required. Unknown keys, nulls, arrays, nested objects, `record_version`, idempotency or replay fields, reason codes, operator notes, `blocked_reason`, `summary`, `required_action`, `assigned_to`, `due_at`, and queue metadata are rejected.

The only authorized transition for this route version is:

```text
open -> in_progress
```

No other source-target pair is authorized. `open -> blocked` and `open -> waiting_on_client` are deliberately deferred even though they appear in the broader controlling product destination because their operational contracts are incomplete. `open -> blocked` is deferred because blocking is associated with reason, required-action, and remediation semantics that this status-only route does not accept or write. `open -> waiting_on_client` is deferred because no P0 client-response return path is currently defined.

`in_progress -> resolved` remains assigned to the separate `resolveReviewQueueItem` service and is not authorized or mounted through `updateReviewQueueStatus`.

This route also does not authorize:

```text
same-status replay
any transition from in_progress
any transition from blocked
any transition from waiting_on_client
any transition from waiting_on_gk
any transition from resolved
any transition from cancelled
any transition to blocked
any transition to waiting_on_client
any transition to waiting_on_gk
any transition to resolved
any transition to cancelled
any reopening to open
```

Do not describe `blocked`, `waiting_on_client`, `resolved`, or `cancelled` as globally terminal unless a later explicit graph decision establishes that. A syntactically valid pair outside the authorized transition returns canonical `422 state_transition_denied`. An already-transitioned request is not a successful replay. A stored queue status different from `expected_queue_status`, or a compare-and-set affecting zero rows after a valid scoped read, returns canonical `409 conflict_current_state_changed`.

A later owner-approved review-queue graph amendment must resolve all five of the following before deferred states are enabled:

1. Exit and recovery transitions: define every permitted path out of `blocked` and `waiting_on_client`, including whether return is to `open`, `in_progress`, another state, or no state.
2. Blocked-reason contract: define whether blocking uses a bounded machine reason code, sanitized operator-facing text, or both, including exact vocabulary, limits, normalization, rejection rules, storage, audit, and response exposure.
3. Required-action behavior: define whether entering `blocked` requires `required_action`, whether it is created or updated by the transition, its safe-text contract, and whether it is visible through the existing review-queue DTO.
4. Terminal versus revisitable semantics: decide explicitly whether `blocked` is terminal, revisitable, or recoverable, rather than allowing the absence of a return transition to decide that implicitly.
5. Client-response continuation: define how an item in `waiting_on_client` returns to active GK work after the client responds, including the authorized actor, target state, required metadata, and whether any client-facing route is needed.

These are deliberate deferrals, not forgotten transitions.

This route version is status-only. It accepts no machine reason code and no free text. It does not create, update, append, clear, or reinterpret `blocked_reason`, `summary`, `required_action`, `assigned_to`, `due_at`, `priority`, or queue metadata. All existing values remain unchanged.

The route is limited to:

```text
queue_type = intake_file_review
target_object_type = intake_file
```

The review-queue item and its linked intake-file target must both belong to the requested organization. The intake file is validated only for existence and tenant integrity and is not mutated. No ID-only queue-item lookup, ID-only target lookup, separate tenant-probe query, unscoped fallback, or cross-tenant disclosure is permitted. Missing or nondisclosable queue-item or target scope returns identical canonical `404 not_found`. The route does not read or return raw file content, storage identifiers, checksums, or unrestricted target metadata.

Implementation must inherit this shared sequence:

```text
scoped stored-row read
stored-row validation
expected-status compare-and-set
post-write row validation
required metadata-only audit in the same transaction
commit
post-commit best-effort metrics
```

Only these persisted fields may change:

```text
queue_status
repository-managed updated_at, if already established
```

The route-specific audit subset is:

```text
actor user ID
actor type
organization ID
operation type = update_review_queue_status
canonical route
request ID
target object type = review_queue_item
target object ID
prior queue status
new queue status
validator keys actually executed
created timestamp
```

The audit must not include request bodies, queue text, linked-file metadata, storage details, raw content, client data, or PII.

The success response returns the established review-queue DTO field-by-field in exactly this order:

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

The implementation must reuse the existing review-queue row and text validation rules. The response does not return `assigned_to`, `blocked_reason`, queue metadata, internal notes, audit payload, transaction context, actor/session/membership context, linked-file metadata, storage information, credentials, raw content, client data, or PII.

Repository-safe implementation may later establish:

```text
mocked compare-and-set behavior
queue-item and linked-target tenant scoping
post-write validation ordering
transactional audit behavior
post-commit metric ordering
DTO and response boundaries
mounted route composition
```

It will not establish:

```text
deployed-schema compatibility
live PostgreSQL compare-and-set behavior
two-session conflict behavior
database atomicity
durable successful-audit persistence
```

Those remain `NOT_CONFIRMED` pending separately authorized Gate A work.

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
