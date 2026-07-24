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
OWNER_DECISION.P0_05F.ZIP_CLASSIFICATION_BOUNDARY_V1
OWNER_DECISION.P0_05F.PDF_INCOMPLETE_SHALLOW_IDENTITY_CATEGORY
OWNER_DECISION.P0_05F.RESIDUAL_UNKNOWN_BINARY_FIXTURE_V1
OWNER_DECISION.P0_05F.CLASSIFICATION_PRECEDENCE_V1
OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
decision_scope: deterministic P0 gate for terminal extension, declared file MIME, shallow byte signature, minimum structural-type identity, and agreement between those signals
broader_file_security_assessment_completed: false
runtime_behavior_changed_by_this_decision: false
```

All required type signals must agree. A legitimate file with an inconsistent extension, declared MIME, detected signature, or minimum structure is blocked rather than guessed, repaired, or reclassified. Extension, declared MIME, detected signature, and minimum structure must all satisfy the committed agreement matrix.

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

This rule applies symmetrically to every naturally reachable permitted-type contradiction. It is not a PDF-specific exception. `declared_type_mismatch` covers both: terminal extension and declared MIME disagree with each other; and terminal extension and declared MIME agree on one permitted type, but deterministic byte signature and required minimum structure establish a different permitted type. The jointly declared metadata type does not become authoritative merely because its extension and MIME agree with each other. No signal rewrites, repairs, or reclassifies another signal. The file blocks rather than rewriting the extension, rewriting the declared MIME, reclassifying the file, selecting another type, or accepting because one signal pair agrees.

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

This detected permitted-type contradiction case is not `unsupported_file_type`, because the extension and declared MIME are individually permitted; not `truncated_or_malformed_type`, because the detected permitted type satisfies its complete committed shallow identity; not `disallowed_binary_signature`, because the detected type is a permitted P0 type, not MZ, ELF, RAR 4, RAR 5, 7z, gzip, or another recognized disallowed signature; not `standalone_archive_or_non_xlsx`, because complete XLSX shallow identity is established when the detected type is XLSX; not `ambiguous_file_type`, because one different permitted byte-established type is deterministically identified and multiple permitted types do not remain plausible; and not `unknown_binary`, because the bytes are deterministically identified as a permitted PDF or XLSX type.

A pass establishes only:

```text
type_agreement_pass_only
```

It does not establish document validity, document usability, machine-readable PDF status, encryption or password status, macro safety, active-content safety, archive-expansion safety, malware cleanliness, profile eligibility, source eligibility, upload acceptance, or complete file-policy pass.

CSV, MD, and TXT have no unique reliable magic signature for this P0 gate. For those types, extension and declared MIME select the permitted text subtype; bytes must pass strict UTF-8 and deterministic binary-content validation; no semantic parsing distinguishes CSV, MD, or TXT; content meaning is not inspected; and instruction-like content remains inert data. Do not invent byte-level cross-type distinction among CSV, MD, and TXT. CSV uses the committed strict UTF-8, BOM, NUL, prohibited-control, and lone-CR boundary already established for P0 text bytes. This does not decide CSV row limits, CSV delimiter validity, CSV header validity, CSV formula handling, or CSV parser behavior. Valid permitted text containing HTML, JavaScript, shell syntax, prompt injection, or other instruction-like strings is not reclassified as HTML or script content merely because those strings occur in the text. HTML and script uploads are blocked through unsupported extension/MIME and recognized disallowed binary identity, not through heuristic scanning of valid permitted text. Empty CSV, MD, or TXT bytes may pass this gate only when extension and MIME agree and the strict text-byte gate passes; the result remains `type_agreement_pass_only`.

A candidate PDF must use extension `.pdf`, declare `application/pdf`, begin at byte offset zero with ASCII `%PDF-`, and contain ASCII `%%EOF` within the final 1024 bytes. Complete PDF shallow identity returns `allow / type_agreement_pass / type_agreement_pass_only` when the extension and declared MIME also agree as `.pdf` plus `application/pdf`. Leading bytes before `%PDF-` are not accepted. The PDF shallow identity rule does not establish machine-readable text layer, unencrypted status, password-free status, valid cross-reference structure, absence of JavaScript, absence of active actions, absence of embedded files, or complete PDF validity.

`OWNER_DECISION.P0_05F.PDF_INCOMPLETE_SHALLOW_IDENTITY_CATEGORY` records the owner-authorized deterministic result for narrowly defined incomplete PDF signalling:

```text
policy: block
category: truncated_or_malformed_type
scope: pdf_shallow_identity_block_only
```

This decision applies only to narrowly established PDF-signalling bytes that fail the committed minimum PDF shallow-identity rule. Complete PDF shallow identity is evaluated first; a complete PDF shallow identity returns `allow / type_agreement_pass`. Only PDF-signalling bytes that fail the complete shallow-identity rule are classified as `truncated_or_malformed_type`. Only bytes that establish neither complete PDF identity nor the narrowly defined incomplete PDF signalling may proceed to other applicable deterministic rows or the residual `unknown_binary` fallback. A valid PDF must never be swept into `truncated_or_malformed_type`, and the incomplete-PDF row is evaluated before the residual `unknown_binary` fallback.

For this decision, incomplete PDF signalling exists only when extension is `.pdf`, declared MIME is `application/pdf`, and one of the following byte conditions is established:

```text
A. ASCII %PDF- exists but begins after byte offset zero.

B. The byte stream begins at byte offset zero with the exact four ASCII bytes
   %PDF
   represented as:
   25 50 44 46
   but does not contain the required following ASCII hyphen byte 2D at that position.

C. ASCII %PDF- begins at byte offset zero, but ASCII %%EOF is absent.

D. ASCII %PDF- begins at byte offset zero and ASCII %%EOF exists, but no %%EOF occurrence is within the final 1024 bytes.
```

Condition B must not be generalized to `%P`, `%PD`, arbitrary percent-prefixed bytes, arbitrary bytes described as PDF-like, arbitrary bytes merely named `.pdf`, or arbitrary bytes merely declaring `application/pdf`. These four incomplete PDF signal families block as `truncated_or_malformed_type` and do not fall through to `unknown_binary`.

A candidate XLSX must use extension `.xlsx`, declare `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, begin with a ZIP local-file-header signature, expose a structurally readable end-of-central-directory record, expose a structurally readable central directory, and contain exact case-sensitive central-directory entry names `[Content_Types].xml`, `_rels/.rels`, and `xl/workbook.xml`. A generic ZIP prefix is insufficient, and finding a required name somewhere in raw bytes is not proof that it is a valid central-directory entry.

`OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1` records the owner's explicit ratification of the stricter XLSX identity boundary identified by read-only audit of commit `854e3ccf06f477e014999aa4983814cbd8b8a310`. This owner decision was made after reviewing the exact contract diff and is not merely acceptance of an implementation side effect.

The XLSX shallow identity rule establishes ZIP entry identity only by parsing ZIP structure. It must locate and validate the end-of-central-directory record; read the recorded central-directory offset and byte length; verify those values remain within fixture byte bounds; iterate valid central-directory records; obtain entry names from those records; validate each record length before advancing; validate each recorded local-header offset; verify the expected number of directory entries; and establish required-entry presence from the parsed directory-name set. It must not establish required-entry presence through raw-byte substring search, regular-expression search over the byte buffer, decoded whole-buffer text search, or grep-like matching.

The future shallow XLSX identity detector may inspect ZIP signatures, local headers, central-directory metadata, end-of-central-directory metadata, entry names, entry offsets, and stored and compressed lengths needed for bounded structural verification. It must not, in this P0-05F identity gate, decompress entry contents, parse worksheet XML, parse workbook XML content, read cell values, expand archive data, execute macros, follow relationships, use the filesystem, or invoke external ZIP utilities. A test-only ZIP builder may create deterministic stored empty entries without adding a dependency, but it must calculate and encode local-file-header offsets, central-directory record offsets, central-directory byte length, central-directory start offset, entry count, and end-of-central-directory metadata.

The positive minimum XLSX fixture must be a readable ZIP whose central-directory offsets, record lengths, entry counts, bounds, and local-header references are internally consistent; it expects `allow / type_agreement_pass / type_agreement_pass_only`. Missing-entry negative fixtures must be separate readable ZIPs for missing `[Content_Types].xml`, missing `_rels/.rels`, and missing `xl/workbook.xml`, each with the other two required entries present and exactly the claimed entry absent; each expects `block / standalone_archive_or_non_xlsx`. A wrong-case fixture must be a readable ZIP with exactly one required entry present only under incorrect case, such as `xl/Workbook.xml`; it expects `block / standalone_archive_or_non_xlsx`. A renamed non-OOXML ZIP must remain readable, omit at least one exact required OOXML entry, and not qualify merely because raw bytes contain similar strings; it expects `block / standalone_archive_or_non_xlsx`. Malformed and truncated ZIP fixtures must remain separate from missing-entry and standalone-archive fixtures, including truncated local-file-header signature, local header without readable central directory, invalid or out-of-bounds central-directory offset, and truncated central-directory record; each expects `block / truncated_or_malformed_type`.

`OWNER_DECISION.P0_05F.ZIP_CLASSIFICATION_BOUNDARY_V1` records that when ZIP-signalling bytes satisfy the complete committed XLSX shallow identity, the byte-established type is permitted XLSX. Complete XLSX identity requires the ZIP local-file-header signature, readable EOCD, valid and in-bounds central directory, valid central-directory records, valid entry count, valid local-header offsets, and exact required central-directory entries `[Content_Types].xml`, `_rels/.rels`, and `xl/workbook.xml`. `.xlsx` plus `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` allows as `type_agreement_pass`; another internally agreeing permitted P0 metadata type blocks as `declared_type_mismatch`. Complete XLSX identity is not `standalone_archive_or_non_xlsx`, `disallowed_binary_signature`, `truncated_or_malformed_type`, or `unknown_binary`.

Structurally readable ZIP bytes without complete XLSX identity block as `standalone_archive_or_non_xlsx`. This applies when otherwise permitted metadata claims XLSX or another permitted non-XLSX P0 type. Examples include `.xlsx` plus XLSX MIME with readable ZIP bytes missing required OOXML identity, and `.txt` plus `text/plain` with readable ZIP bytes without complete XLSX identity. The latter example is not `declared_type_mismatch`, `disallowed_binary_signature`, or `unknown_binary`; the bytes establish a readable standalone archive or non-XLSX ZIP container, not another complete permitted P0 type.

Readable non-XLSX ZIP coverage has two distinct classes: readable ZIP with `.xlsx` metadata but missing complete XLSX identity, and readable ZIP with otherwise permitted non-XLSX metadata and missing complete XLSX identity. The previously separated Case A, readable arbitrary ZIP with permitted non-XLSX metadata, and Case C, recognized standalone-ZIP signature with permitted non-XLSX metadata, are not distinct deterministic cases under the committed P0 signal model. A structurally readable ZIP necessarily carries the recognized ZIP signature. When complete XLSX identity is absent and otherwise permitted non-XLSX metadata is used, both expose the same relevant signals and block as `standalone_archive_or_non_xlsx`. Do not manufacture a distinction using fixture names, descriptions, byte length, arbitrary archive entry names, or the term "signature" in a fixture ID. Only one canonical permitted-non-XLSX readable-ZIP semantic fixture is required. This rule does not establish macro absence, external-relationship absence, encryption/password status, OOXML path safety, sheet limits, cell limits, entry-count limits, expanded-size limits, compression-ratio safety, or complete workbook validity.

Fixture packages are graded against frozen owner authority. Fixture packages must never modify this contract. When a fixture package discovers a contract gap, execution must stop for an owner decision. Contract and fixture changes must not be combined in one implementation commit.

The future corpus must include deterministic block cases for at least DOS/PE MZ, ELF, RAR 4, RAR 5, 7z, gzip, structurally readable ZIP without complete XLSX identity, malformed or truncated ZIP/XLSX-signalling bytes, and narrowly defined incomplete PDF-signalling bytes. The recognized disallowed-signature set is exactly DOS/PE MZ, ELF, RAR 4, RAR 5, 7z, and gzip. Each recognized disallowed signature blocks as `disallowed_binary_signature` regardless of an allowed extension or declared MIME. `declared_type_mismatch` must not absorb MZ, ELF, RAR 4, RAR 5, 7z, gzip, readable non-XLSX ZIP, malformed or truncated ZIP/XLSX-signalling bytes, narrowly defined incomplete PDF-signalling bytes, or unknown binary cases. The detected permitted-type contradiction decision applies only where the byte-established type is itself a permitted P0 type and its complete committed shallow identity is satisfied. Structurally readable ZIP without complete XLSX identity must not be described as `disallowed_binary_signature`. Malformed or truncated ZIP/XLSX-signalling bytes remain separate and block as `truncated_or_malformed_type`, including truncated local-file-header signature, local header without readable central directory, invalid or out-of-bounds central-directory offset, and truncated central-directory record. Narrowly defined incomplete PDF-signalling bytes also remain separate and block as `truncated_or_malformed_type`. Unsupported extension or declared MIME remains `unsupported_file_type`; this ZIP classification decision does not determine mixed cases where unsupported metadata and ZIP bytes coexist. A non-text byte stream matching no complete permitted identity, no recognized disallowed signature, no readable ZIP classification, no malformed or truncated ZIP/XLSX signalling, and no narrowly defined complete or incomplete PDF signalling blocks as `unknown_binary`. This list does not mean every executable or archive format is individually identified; unknown binary input remains fail-closed.

`OWNER_DECISION.P0_05F.DISALLOWED_SIGNATURE_BYTES` records the owner-authorized exact recognition bytes and required offset for each recognized disallowed-signature family. Each recognized disallowed signature is a fixed byte sequence matched at byte offset zero. A match requires the complete family-specific byte sequence present beginning at byte offset zero; a partial sequence, a shorter prefix, or an occurrence at any non-zero offset is not a match. The committed sequences are:

- DOS/PE MZ: `4D 5A` at byte offset zero.
- ELF: `7F 45 4C 46` at byte offset zero.
- gzip: `1F 8B` at byte offset zero.
- 7z: `37 7A BC AF 27 1C` at byte offset zero.
- RAR 4: `52 61 72 21 1A 07 00` at byte offset zero.
- RAR 5: `52 61 72 21 1A 07 01 00` at byte offset zero.

RAR 4 and RAR 5 share the first six bytes `52 61 72 21 1A 07` and differ only in the terminator; RAR 4 ends `00` at the seventh byte, and RAR 5 ends `01 00` at the seventh and eighth bytes. A RAR 4 match requires its complete seven-byte sequence, and a RAR 5 match requires its complete eight-byte sequence. The shared six-byte prefix alone is not a match for either family, RAR 4's seven-byte sequence must not be treated as matched by the RAR 5 prefix, and a RAR 5 stream must not be classified as RAR 4 on the strength of the shared prefix. Each committed match blocks as `disallowed_binary_signature` regardless of an allowed extension or declared MIME, consistent with the recognized disallowed-signature set already established above.

The DOS/PE MZ match is the two-byte offset-zero prefix `4D 5A` only. This decision does not establish DOS/PE header traversal, PE structure validation, or any inspection beyond the committed offset-zero prefix bytes. For every family, this decision commits recognition bytes only for the six disallowed families named above; it does not establish archive parsing, decompression, container inspection, format validation, or recognition of any format outside these six. A binary byte stream matching none of the six committed signatures, no complete permitted identity, no readable ZIP/non-XLSX archive classification, no malformed or truncated ZIP/XLSX signalling, and no narrowly defined complete or incomplete PDF signalling remains fail-closed as `unknown_binary`.

`OWNER_DECISION.P0_05F.CLASSIFICATION_PRECEDENCE_V1` records the deterministic classification precedence for P0-05F. Fixtures do not create precedence authority. The existing contract did not previously settle the newly decided pairs recorded in this decision, and this package supplies that missing owner authority. Every ordering below is a new owner decision authored by this package, except unsupported metadata before residual `unknown_binary`, which is already grounded by the existing residual ordering. The existing committed rules remain preserved: complete PDF identity is evaluated before incomplete PDF signalling; complete XLSX identity is evaluated before readable non-XLSX ZIP; and all named higher-priority outcomes are evaluated before residual `unknown_binary`.

The P0-05F classification evaluation order is:

```text
1. recognized MZ, ELF, gzip, 7z, RAR 4, or RAR 5 signature
2. unsupported extension or declared MIME
3. supported extension/MIME disagreement
4. complete permitted PDF or XLSX identity
5. readable non-XLSX ZIP or malformed/truncated ZIP/XLSX classification
6. incomplete PDF signalling
7. TXT/MD/CSV strict text-byte gate
8. defensive ambiguous_file_type
9. residual unknown_binary
```

This precedence has these committed consequences:

```text
recognized signature before TXT/MD/CSV text-gate failure
recognized signature before incomplete-PDF signalling
recognized signature before unsupported metadata
unsupported metadata before PDF, XLSX/ZIP, text-gate, ambiguity, and residual unknown_binary
text-gate outcome before residual unknown_binary
unknown_binary remains the final residual outcome
```

This decision is documentation-only authority. P0-05F.4 remains unimplemented and unstarted. The `application/json` runtime-alignment leaf remains separate and unstarted. Runtime behavior is unchanged.

`OWNER_DECISION.P0_05F.RESIDUAL_UNKNOWN_BINARY_FIXTURE_V1` authorizes exactly one future synthetic fixture for P0-05F.2d3:

```text
bytes: 00 01
byte_offset: zero
extension: .pdf
declared_mime: application/pdf
expected_policy: block
expected_category: unknown_binary
expected_scope: unknown_binary_block_only
```

This decision creates the scope label `unknown_binary_block_only`, which did not previously exist. The fixture reaches `unknown_binary` only after establishing none of these higher-priority outcomes, each evaluated first: complete PDF identity, because the bytes are not `%PDF-` at offset zero with `%%EOF` in the final 1024 bytes; narrowly defined incomplete PDF signalling, because the bytes are not the `%PDF` prefix `25 50 44 46`; complete XLSX identity, readable ZIP, or non-XLSX ZIP, because the bytes are not `50 4B 03 04`; malformed or truncated ZIP/XLSX signalling; recognized disallowed signature, because the bytes are not `4D 5A`, `7F 45 4C 46`, `1F 8B`, `37 7A BC AF 27 1C`, `52 61 72 21 1A 07 00`, or `52 61 72 21 1A 07 01 00`; another complete permitted identity; detected permitted-type contradiction; `declared_type_mismatch`; `ambiguous_file_type`; or `unsupported_file_type`.

This decision does not alter P0-05C, P0-05D, or P0-05E. Bytes `00 01` under `.txt`, `.md`, or `.csv` metadata remain governed by the existing text-byte gate, not this residual unknown-binary decision. No partial-signature policy is authorized. No additional unknown-binary fixture family is authorized. This fixture proves only reachability of the existing residual `unknown_binary` category. It establishes nothing about malware, parser safety, archive validity, or upload eligibility.

Deterministic block outcomes:

```text
unsupported extension or MIME -> block / unsupported_file_type
extension and MIME disagreement -> block / declared_type_mismatch
extension and MIME agree on one permitted type but complete byte identity establishes another permitted type -> block / declared_type_mismatch
recognized MZ, ELF, RAR 4, RAR 5, 7z, or gzip signature matched at byte offset zero per OWNER_DECISION.P0_05F.DISALLOWED_SIGNATURE_BYTES -> block / disallowed_binary_signature
structurally readable ZIP without complete XLSX identity -> block / standalone_archive_or_non_xlsx
malformed or truncated ZIP/XLSX-signalling bytes -> block / truncated_or_malformed_type
narrowly defined incomplete PDF-signalling bytes after complete PDF identity has failed -> block / truncated_or_malformed_type
multiple permitted types genuinely remain plausible after applying all committed signals -> block / ambiguous_file_type
non-text bytes matching no complete permitted identity, no recognized disallowed signature, no readable ZIP/non-XLSX archive classification, no malformed or truncated ZIP/XLSX signalling, and no narrowly defined complete or incomplete PDF signalling -> block / unknown_binary
```

No ambiguous, malformed, truncated, or unknown input is permitted. `ambiguous_file_type` is a defensive fail-closed category. The future fixture corpus must not invent a contrived or semantically impossible byte case solely to exercise it; include an `ambiguous_file_type` fixture only if a naturally reachable case exists under the committed matrix, otherwise record the category as defensive and currently unexercised. Do not weaken or alter another fixture merely to manufacture ambiguity, and do not treat absence of an ambiguity fixture as incomplete coverage when the category is unreachable by construction.

Future sequence:

```text
P0-05F.2: complete synthetic extension/MIME/signature fixture corpus
P0-05F.3: read-only detector measurement against the corpus
P0-05F.4: pure unwired detector if measurement confirms absence
separate runtime-alignment leaf: remove application/json and align the current declared file-MIME runtime allowlist only after explicit authorization
```

The fixture corpus must precede detector implementation, and the runtime-alignment change must not be silently merged into fixture or detector packages. The future fixture corpus must include every allowed extension/MIME pairing; every grounded cross-type mismatch; uppercase extension normalization; unsupported extensions; unsupported MIME values; `application/json` rejection; `application/octet-stream` declared-MIME rejection; MIME-parameter rejection; empty text-family cases; PDF positive and truncated cases; XLSX positive minimum structure; readable ZIP without complete XLSX identity; renamed ZIP; recognized non-ZIP executable/archive signatures; unknown binary; instruction-like permitted text remaining inert; and `ambiguous_file_type` only under the defensive-category rule.

This decision does not settle or implement CSV row count, CSV delimiter/header validity, CSV formula-injection handling, XLSX macro detection, XLSX external relationships, OOXML path traversal, archive expansion limits, PDF text-layer proof, PDF encryption, PDF JavaScript/actions, PDF embedded files, malware scanning, upload transport, storage integration, parser/profile behavior, or production wiring. It does not reopen P0-05A through P0-05E.

## P0-05F.3 detector measurement authority

```text
decision_evidence: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.DETECTOR_MEASUREMENT_AUTHORITY_V1
runtime_behavior_changed_by_this_decision: false
p0_05f_3_measurement_performed_by_this_decision: false
p0_05f_4_started_by_this_decision: false
```

P0-05F.3 must determine whether any existing repository module or composed production path implements the complete committed P0-05F classification capability. The measurement must separate capability completeness from implementation form.

Capability completeness is measured only by coverage of the committed classification behavior. A capability-complete implementation must cover all committed P0-05F.2e surfaces and return the required:

```text
policy
category
scope
evidence
```

Its coverage must include:

```text
extension and MIME normalization
allowed extension/MIME pairs
unsupported metadata
cross-type mismatches
text-byte validation
PDF identity
XLSX identity
ZIP classification
recognized disallowed signatures
unknown binary
defensive ambiguous-file handling
```

Wiring, purity, and I/O do not determine capability completeness. A wired service is not disqualified from the capability measurement merely because it is wired or performs I/O. It must instead be assessed on whether it actually implements the complete classification surface.

Implementation form must be established separately for every capability-complete candidate. The form measurement determines whether the candidate is:

```text
pure and deterministic
unwired to routes and services
free of database, network, filesystem, storage, audit, and other I/O
suitable as the P0-05F.4 pure unwired detector
```

Capability completeness and implementation form must not be merged into one criterion.

P0-05F.3 must report exactly one measurement result:

```text
COMPLETE_CAPABILITY_PRESENT_TARGET_FORM
```

A capability-complete implementation exists and already has the required pure, deterministic, unwired, no-I/O form.

```text
COMPLETE_CAPABILITY_PRESENT_NON_TARGET_FORM
```

A capability-complete implementation exists, but it is wired, performs I/O, or otherwise does not have the required P0-05F.4 form.

```text
COMPLETE_CAPABILITY_ABSENT_WITH_PARTIAL_HELPERS
```

No capability-complete implementation exists, but one or more modules or services implement part of the P0-05F surface.

```text
COMPLETE_CAPABILITY_ABSENT
```

No capability-complete implementation and no credible partial implementation exists.

```text
MEASUREMENT_INCONCLUSIVE
```

Required repository evidence is missing, conflicting, or insufficient.

Known candidate treatment:

```text
Backend/kai/validators/txtMdByteDetector.js must be measured as a potential partial implementation if current repository inspection confirms its reported behavior.

Backend/kai/services/kaiIntakeService.js must be measured for the metadata capability it actually implements. It must not be excluded merely because it is production-wired.

Metadata-only MIME validation is not capability-complete unless it independently satisfies every committed P0-05F surface.

Fixture corpora, test parsers, byte builders, and focused tests are test evidence, not production implementations.
```

P0-05F.4 handoff by P0-05F.3 measurement result:

```text
COMPLETE_CAPABILITY_PRESENT_TARGET_FORM:
P0-05F.4 is blocked because implementing another detector would duplicate an existing suitable detector.

COMPLETE_CAPABILITY_PRESENT_NON_TARGET_FORM:
P0-05F.4 is not automatically authorized. A separate owner review must decide whether to extract, refactor, wrap, or replace the existing capability.

COMPLETE_CAPABILITY_ABSENT_WITH_PARTIAL_HELPERS:
P0-05F.4 is authorized as a separate package to implement the missing complete pure unwired detector, preserving or reusing compatible helpers only where supported by inspection.

COMPLETE_CAPABILITY_ABSENT:
P0-05F.4 is authorized as a separate package to implement the complete pure unwired detector.

MEASUREMENT_INCONCLUSIVE:
P0-05F.4 remains blocked.
```

If current repository inspection confirms that production metadata validation still allows a value rejected by the committed P0-05F contract, record that only as a separate runtime-alignment drift. Do not modify the runtime allowlist in P0-05F.3. Do not merge runtime alignment into P0-05F.3 or P0-05F.4.

## P0-05F.4 detector-interface authority

```text
decision_evidence: USER_CONFIRMED
owner_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
runtime_behavior_changed_by_this_decision: false
p0_05f_4_implementation_status: unimplemented
p0_05f_4_interface_authority_status: recorded_by_this_package
runtime_integration_status: unstarted
runtime_alignment_status: separate_and_unstarted
application_json_allowlist_change: prohibited_in_p0_05f_4
```

P0-05F.4 may implement only a pure unwired detector interface. It must not alter routes, services, upload runtime behavior, declared MIME runtime allowlists, storage, databases, cloud services, feature flags, dependencies, lockfiles, fixtures, or tests except in a later separately authorized implementation-test package.

The authorized production detector interface is:

```text
production_module: Backend/kai/validators/p0FileTypeAgreementDetector.js
production_export: detectP0FileTypeAgreement
input:
{
  extension,
  declaredMime,
  bytes
}
extension_type: string
declared_mime_type: string
extension_required: true
declared_mime_required: true
extension_whitespace_trim: false
missing_or_non_string_extension: throw TypeError
missing_or_non_string_declared_mime: throw TypeError
empty_extension: valid input; block / unsupported_file_type
empty_declared_mime: valid input; block / unsupported_file_type
test_adapter_missing_extension: convert to empty string before invocation
test_adapter_missing_declared_mime: convert to empty string before invocation
filename_input: prohibited
extension canonicalizes using ASCII case-insensitive lowercase comparison
declared MIME trims surrounding ASCII whitespace
declared MIME type/subtype canonicalize to lowercase
MIME parameters are retained and classify as unsupported_file_type
bytes must be Uint8Array
bytes must not be mutated
bytes_type: Uint8Array
bytes_mutation: prohibited
non_Uint8Array: throw TypeError
```

`extension` is the already-selected terminal extension signal. Filename parsing, filename-hazard policy, multiple-extension policy, and path/name safety remain outside this detector and remain governed by the committed filename policy.

Every detector result must be a frozen object containing exactly these enumerable own keys:

```text
policy
category
scope
evidence
```

`policy`, `category`, and `scope` must be strings from the committed detector result table below. `evidence` must be a frozen closed object containing only bounded scalar or bounded enumerated diagnostic facts needed to prove which deterministic row fired. Evidence may include only these key families when relevant:

```text
normalized_extension
normalized_declared_mime
unsupported_signal
extension_supported
declared_mime_supported
metadata_pairing
recognized_signature_family
recognized_signature_offset
detected_permitted_type
zip_classification
pdf_classification
text_gate_category
text_gate_scope
evaluation_step
```

Evidence must exclude raw bytes, decoded text, file content, filesystem paths, storage identifiers, signed URLs, credentials, arbitrary objects, and unbounded arrays.

The declared file MIME parameter behavior is pre-existing contract authority, not fixture-derived authority and not a new owner decision in this P0-05F.4 package. Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md lines 211-236 already state that declared file MIME is normalized by trimming surrounding ASCII whitespace and lowercasing the type and subtype; MIME parameters are not accepted; `text/plain; charset=utf-8` blocks rather than being silently stripped or reinterpreted; and every declared MIME value not explicitly listed in the matrix is unsupported. Therefore:

```text
declared MIME normalization trims surrounding ASCII whitespace
declared MIME type/subtype canonicalize to lowercase
MIME parameters are not stripped
MIME parameters are not reinterpreted
parameterized text/plain; charset=utf-8 blocks as unsupported_file_type
authority_class: pre_existing_contract_authority
contract_source: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md lines 211-236
```

Empty declared MIME and empty terminal extension have different authority labels:

```text
empty MIME:
  outcome: block / unsupported_file_type
  authority_class: pre_existing_contract_authority
  contract_source: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md lines 236-240

empty extension:
  outcome: block / unsupported_file_type
  authority_class: new_owner_decision
  rationale: this decision extends the committed every-other-extension-blocks rule to the empty-string extension input
  authority_created_by:
    OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
```

This empty-extension decision does not claim that the existing extension rule literally names the empty-string case.

The detector evaluation order remains exactly `OWNER_DECISION.P0_05F.CLASSIFICATION_PRECEDENCE_V1` and is not changed by this decision:

```text
1. recognized MZ, ELF, gzip, 7z, RAR 4, or RAR 5 signature
2. unsupported extension or declared MIME
3. supported extension/MIME disagreement
4. complete permitted PDF or XLSX identity
5. readable non-XLSX ZIP or malformed/truncated ZIP/XLSX classification
6. incomplete PDF signalling
7. TXT/MD/CSV strict text-byte gate
8. defensive ambiguous_file_type
9. residual unknown_binary
```

The existing text-byte helper may be wrapped, not redefined:

```text
helper: Backend/kai/validators/txtMdByteDetector.js
export: detectTxtMdBytePolicy
decision: wrap
applies_at_precedence_step: 7
applies_to:
.txt
.md
.csv

helper allow:
allow / type_agreement_pass / type_agreement_pass_only

helper block:
preserve encoding_binary_gate_block_only unchanged
```

A text-gate block must never become `unknown_binary` or `unknown_binary_block_only`. CSV uses the same strict text-byte boundary committed for TXT/MD/CSV.

Pre-existing scope authorities:

```text
scope: type_agreement_pass_only
contract_source: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md lines 271-281 and 319-321
authority_class: pre_existing_contract_authority

scope: pdf_shallow_identity_block_only
contract_source: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md lines 283-309
authority_class: pre_existing_contract_authority

scope: unknown_binary_block_only
contract_source: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md lines 373-387
authority_class: pre_existing_contract_authority

scope: encoding_gate_pass_only
contract_source: Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md lines 98-128 and 136-163
authority_class: pre_existing_contract_authority
```

newly_ratified_scopes:

```text
scope: unsupported_metadata_block_only
deterministic_condition: unsupported extension or declared MIME
contract_grounded_category: unsupported_file_type
fixture_source_path: __tests__/support/kaiSprint2UnsupportedExtensionMimeFixtureCorpus.js
fixture_source_matching_lines: __tests__/support/kaiSprint2UnsupportedExtensionMimeFixtureCorpus.js:105
fixture_source_evidence: TOOL_VERIFIED
pre_existing_contract_authority: false
authority_created_by:
  OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1

scope: type_agreement_block_only
deterministic_condition:
  1. supported extension/MIME disagreement
  2. recognized MZ, ELF, gzip, 7z, RAR 4, or RAR 5 signature at byte offset zero, regardless of extension or declared MIME
contract_grounded_category: declared_type_mismatch or disallowed_binary_signature
fixture_source_path: __tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js; __tests__/support/kaiSprint2TextTypeAgreementFixtureCorpus.js; __tests__/support/kaiSprint2RecognizedDisallowedSignatureFixtureCorpus.js
fixture_source_matching_lines: __tests__/support/kaiSprint2ExtensionMimeMatrixFixtureCorpus.js:129; __tests__/support/kaiSprint2TextTypeAgreementFixtureCorpus.js:175; __tests__/support/kaiSprint2RecognizedDisallowedSignatureFixtureCorpus.js:102, 117, 132, 147, 162, 177
fixture_source_evidence: TOOL_VERIFIED
pre_existing_contract_authority: false
authority_created_by:
  OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1

scope: type_agreement_block_only

scope_semantics:
generic P0-05F type-agreement blocking boundary; the scope identifies the bounded detector layer, not one exclusive category

authorized_conditions:
1. supported extension/MIME disagreement
   category: declared_type_mismatch

2. recognized MZ, ELF, gzip, 7z, RAR 4, or RAR 5 signature at byte offset zero, regardless of extension or declared MIME
   category: disallowed_binary_signature

shared_scope_authorized: true
authorized_condition_count: 2
additional_conditions_authorized: false
authority_created_by:
  OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1

scope: detected_permitted_type_contradiction_only
deterministic_condition: extension and declared MIME agree on one permitted type but complete byte identity establishes another permitted type
contract_grounded_category: declared_type_mismatch
fixture_source_path: __tests__/support/kaiSprint2DetectedPermittedTypeContradictionFixtureCorpus.js
fixture_source_matching_lines: __tests__/support/kaiSprint2DetectedPermittedTypeContradictionFixtureCorpus.js:77
fixture_source_evidence: TOOL_VERIFIED
pre_existing_contract_authority: false
authority_created_by:
  OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1

scope: standalone_archive_or_non_xlsx_block_only
deterministic_condition: structurally readable ZIP bytes without complete XLSX identity
contract_grounded_category: standalone_archive_or_non_xlsx
fixture_source_path: __tests__/support/kaiSprint2XlsxZipFixtureCorpus.js
fixture_source_matching_lines: none from required raw scope grep
fixture_source_evidence: USER_CONFIRMED
pre_existing_contract_authority: false
authority_created_by:
  OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1

scope: truncated_or_malformed_type_block_only
deterministic_condition: malformed or truncated ZIP/XLSX-signalling bytes
contract_grounded_category: truncated_or_malformed_type
fixture_source_path: __tests__/support/kaiSprint2XlsxZipFixtureCorpus.js
fixture_source_matching_lines: none from required raw scope grep
fixture_source_evidence: USER_CONFIRMED
pre_existing_contract_authority: false
authority_created_by:
  OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1

scope: encoding_binary_gate_block_only
deterministic_condition: TXT/MD/CSV strict text-byte helper block
contract_grounded_category: unsupported_bom_encoding, invalid_utf8, nul_rejection, prohibited_control, or lone_cr
fixture_source_path: __tests__/support/kaiSprint2TxtMdByteFixtureCorpus.js
fixture_source_matching_lines: __tests__/support/kaiSprint2TxtMdByteFixtureCorpus.js:279, 291, 303, 315, 327, 339, 351, 363, 375, 387, 399, 411, 423, 435, 447, 459
fixture_source_evidence: TOOL_VERIFIED
pre_existing_contract_authority: false
authority_created_by:
  OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1

scope: ambiguous_file_type_block_only
deterministic_condition: multiple permitted types genuinely remain plausible after applying all committed signals
contract_grounded_category: ambiguous_file_type
fixture_source_path: none
fixture_source_evidence: not_applicable
source_kind: contract-grounded defensive category
pre_existing_contract_authority: false
authority_created_by:
  OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
```

These newly ratified scopes are valid only because the attached category is explicitly contract-grounded, the cited fixture outcome does not conflict with controlling contract text, each deterministic condition resolves to an authorized scope, and the scope does not broaden the detector claim beyond the policy/category result.

Each deterministic condition must resolve to exactly one authorized scope.

A scope label may be shared across more than one deterministic condition only when this owner decision explicitly enumerates every condition and category permitted to use it.

type_agreement_block_only is shared only by the two conditions expressly listed above.

Detector result rows:

```text
evaluation_condition: recognized MZ, ELF, gzip, 7z, RAR 4, or RAR 5 signature at byte offset zero
policy: block
category: disallowed_binary_signature
scope: type_agreement_block_only
scope_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
allowed_evidence_keys: recognized_signature_family, recognized_signature_offset, normalized_extension, normalized_declared_mime, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05F.DISALLOWED_SIGNATURE_BYTES

evaluation_condition: unsupported extension or declared MIME
policy: block
category: unsupported_file_type
scope: unsupported_metadata_block_only
scope_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1; empty MIME category pre-existing at Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md lines 236-240; empty extension scope created by this decision
allowed_evidence_keys: normalized_extension, normalized_declared_mime, unsupported_signal, extension_supported, declared_mime_supported, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1

evaluation_condition: supported extension/MIME disagreement
policy: block
category: declared_type_mismatch
scope: type_agreement_block_only
scope_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
allowed_evidence_keys: normalized_extension, normalized_declared_mime, metadata_pairing, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1

evaluation_condition: extension and declared MIME agree on one permitted type but complete byte identity establishes another permitted type
policy: block
category: declared_type_mismatch
scope: detected_permitted_type_contradiction_only
scope_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
allowed_evidence_keys: normalized_extension, normalized_declared_mime, metadata_pairing, detected_permitted_type, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05F.DETECTED_PERMITTED_TYPE_CONTRADICTION_V1

evaluation_condition: complete permitted PDF identity with .pdf plus application/pdf
policy: allow
category: type_agreement_pass
scope: type_agreement_pass_only
scope_authority: pre_existing_contract_authority
allowed_evidence_keys: normalized_extension, normalized_declared_mime, pdf_classification, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1

evaluation_condition: complete permitted XLSX identity with .xlsx plus application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
policy: allow
category: type_agreement_pass
scope: type_agreement_pass_only
scope_authority: pre_existing_contract_authority
allowed_evidence_keys: normalized_extension, normalized_declared_mime, zip_classification, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05F.XLSX_CENTRAL_DIRECTORY_BOUNDARY_V1

evaluation_condition: structurally readable ZIP bytes without complete XLSX identity
policy: block
category: standalone_archive_or_non_xlsx
scope: standalone_archive_or_non_xlsx_block_only
scope_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
allowed_evidence_keys: normalized_extension, normalized_declared_mime, zip_classification, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05F.ZIP_CLASSIFICATION_BOUNDARY_V1

evaluation_condition: malformed or truncated ZIP/XLSX-signalling bytes
policy: block
category: truncated_or_malformed_type
scope: truncated_or_malformed_type_block_only
scope_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
allowed_evidence_keys: normalized_extension, normalized_declared_mime, zip_classification, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05F.ZIP_CLASSIFICATION_BOUNDARY_V1

evaluation_condition: narrowly defined incomplete PDF signalling after complete PDF identity has failed
policy: block
category: truncated_or_malformed_type
scope: pdf_shallow_identity_block_only
scope_authority: pre_existing_contract_authority
allowed_evidence_keys: normalized_extension, normalized_declared_mime, pdf_classification, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05F.PDF_INCOMPLETE_SHALLOW_IDENTITY_CATEGORY

evaluation_condition: TXT/MD/CSV strict text-byte helper allow
policy: allow
category: type_agreement_pass
scope: type_agreement_pass_only
scope_authority: pre_existing_contract_authority
allowed_evidence_keys: normalized_extension, normalized_declared_mime, text_gate_category, text_gate_scope, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05F.TYPE_AGREEMENT_MATRIX_V1

evaluation_condition: TXT/MD/CSV strict text-byte helper block: unsupported BOM encoding
policy: block
category: unsupported_bom_encoding
scope: encoding_binary_gate_block_only
scope_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
allowed_evidence_keys: normalized_extension, normalized_declared_mime, text_gate_category, text_gate_scope, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05C.UNSUPPORTED_BOM_REJECTION

evaluation_condition: TXT/MD/CSV strict text-byte helper block: invalid UTF-8
policy: block
category: invalid_utf8
scope: encoding_binary_gate_block_only
scope_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
allowed_evidence_keys: normalized_extension, normalized_declared_mime, text_gate_category, text_gate_scope, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05C.INVALID_UTF8_REJECTION

evaluation_condition: TXT/MD/CSV strict text-byte helper block: NUL rejection
policy: block
category: nul_rejection
scope: encoding_binary_gate_block_only
scope_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
allowed_evidence_keys: normalized_extension, normalized_declared_mime, text_gate_category, text_gate_scope, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05C.NUL_REJECTION

evaluation_condition: TXT/MD/CSV strict text-byte helper block: prohibited control
policy: block
category: prohibited_control
scope: encoding_binary_gate_block_only
scope_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
allowed_evidence_keys: normalized_extension, normalized_declared_mime, text_gate_category, text_gate_scope, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05C.PROHIBITED_CONTROL_REJECTION

evaluation_condition: TXT/MD/CSV strict text-byte helper block: lone CR
policy: block
category: lone_cr
scope: encoding_binary_gate_block_only
scope_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
allowed_evidence_keys: normalized_extension, normalized_declared_mime, text_gate_category, text_gate_scope, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05C.LONE_CR_REJECTION

evaluation_condition: multiple permitted types genuinely remain plausible after applying all committed signals
policy: block
category: ambiguous_file_type
scope: ambiguous_file_type_block_only
scope_authority: OWNER_DECISION.P0_05F.PURE_DETECTOR_INTERFACE_V1
allowed_evidence_keys: normalized_extension, normalized_declared_mime, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05F.CLASSIFICATION_PRECEDENCE_V1

evaluation_condition: residual non-text bytes matching no complete permitted identity, no recognized disallowed signature, no readable ZIP/non-XLSX classification, no malformed/truncated ZIP/XLSX signalling, and no narrowly defined complete or incomplete PDF signalling
policy: block
category: unknown_binary
scope: unknown_binary_block_only
scope_authority: pre_existing_contract_authority
allowed_evidence_keys: normalized_extension, normalized_declared_mime, evaluation_step
contract_category_authority: OWNER_DECISION.P0_05F.RESIDUAL_UNKNOWN_BINARY_FIXTURE_V1
```

Future implementation-test boundary:

```text
test_module: __tests__/kai-sprint2-p0-file-type-agreement-detector.spec.js
frozen_corpus_count: 9
frozen_fixture_count: 101
existing_combined_completeness_spec_changed: false
```

The future detector test must import all nine frozen corpora, invoke the production detector exactly once for every one of the 101 fixtures, use explicit per-corpus input adapters, assert policy, category, scope, and closed evidence shape, prove 101 executions, and prove fixture IDs remain unique. The production detector must not import tests, corpora, fixture builders, or the combined-completeness specification. The corpus verifies the detector; it does not create categories, precedence, scopes, or production rules.

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

### OWNER_DECISION.P0_06A.SYNTHETIC_UPLOAD_LIFECYCLE_REPOSITORY_V1

```text
decision_evidence: USER_CONFIRMED
decision_scope: dependency-injected in-memory synthetic upload-lifecycle repository only
implementation_status: not_started
durable_schema_claim: false
p0_06b_authorized: false
```

This decision defines the executable contract for a later bounded P0-06A synthetic upload-lifecycle repository. It authorizes no route, listener, byte storage, database, cloud integration, durable schema, production binding, deletion, retention, or P0-06B implementation.

#### Repository operations

The repository exposes exactly:

<!-- BEGIN_P0_06A_LIFECYCLE_OPERATIONS_V1 -->

```text
createReservedUploadLifecycle
getUploadLifecycle
transitionUploadLifecycle
```

<!-- END_P0_06A_LIFECYCLE_OPERATIONS_V1 -->

Inputs:

```text
createReservedUploadLifecycle({
  organizationId,
  intakeBatchId,
  intakeFileId,
  now
})

getUploadLifecycle({
  organizationId,
  intakeFileId
})

transitionUploadLifecycle({
  organizationId,
  intakeFileId,
  expectedUploadState,
  newUploadState,
  now,
  objectVersionId?,
  verifiedChecksum?,
  verifiedSizeBytes?
})
```

No list, delete, retention, cleanup, upload, confirmation, checksum-computation, audit, metric, storage, security-assessment, or executor operation is authorized.

#### State and record authority

Every `upload_state` is constrained by the existing committed `KAI_SPRINT2_P0_UPLOAD_STATES` constant. This decision creates no new state value or duplicate state vocabulary.

The synthetic record contains exactly:

<!-- BEGIN_P0_06A_SYNTHETIC_RECORD_FIELDS_V1 -->

```text
organization_id
intake_batch_id
intake_file_id
upload_state
file_policy_status
upload_state_changed_at
upload_expires_at
object_version_id
verified_checksum
verified_size_bytes
verified_at
created_at
```

<!-- END_P0_06A_SYNTHETIC_RECORD_FIELDS_V1 -->

These fields define only the in-memory synthetic record and make no durable-schema or deployed-database claim.

Creation initializes:

```text
upload_state: reserved
file_policy_status: pending
created_at: caller-supplied now
upload_state_changed_at: caller-supplied now
upload_expires_at: caller-supplied now plus exactly 24 hours
object_version_id: null
verified_checksum: null
verified_size_bytes: null
verified_at: null
```

`file_policy_status` remains governed by the existing committed `intake_files.file_policy_status` contract. This repository writes only `pending` at creation and `blocked` when entering `policy_blocked`. It creates no new file-policy value.

Always immutable:

```text
organization_id
intake_batch_id
intake_file_id
created_at
upload_expires_at
```

`object_version_id` is nullable until entering `uploaded_unconfirmed` and immutable after assignment.

`verified_checksum`, `verified_size_bytes`, and `verified_at` are nullable until confirmation and immutable afterward.

`upload_state_changed_at` changes only after a successful non-replay transition.

Returned records are defensive copies. The record contains no raw bytes, bucket, object key, path, URI, signed URL, provider-private identifier, or unrestricted metadata.

#### Authorized transition graph

<!-- BEGIN_P0_06A_UPLOAD_LIFECYCLE_EDGES_V1 -->

```text
reserved -> upload_started
reserved -> policy_blocked
reserved -> abandoned
reserved -> expired
upload_started -> uploaded_unconfirmed
upload_started -> policy_blocked
upload_started -> abandoned
upload_started -> expired
uploaded_unconfirmed -> confirmed
uploaded_unconfirmed -> policy_blocked
uploaded_unconfirmed -> abandoned
uploaded_unconfirmed -> expired
confirmed -> policy_blocked
```

<!-- END_P0_06A_UPLOAD_LIFECYCLE_EDGES_V1 -->

There are exactly 13 directed edges.

Terminal states:

```text
policy_blocked
abandoned
expired
```

No other edge is authorized.

`confirmed -> policy_blocked` is the sole post-confirmation edge. Confirmation establishes exact-version and integrity confirmation only; it does not establish safety, evidence approval, parsing completion, or generation eligibility.

#### Transition requirements

Entering `uploaded_unconfirmed` requires a non-empty opaque `object_version_id`. The value is generated outside this repository, is provider-neutral and version-bound, and becomes immutable when stored.

Entering `confirmed` requires:

```text
the same stored object_version_id
a canonical lowercase 64-hex SHA-256 verified_checksum
a positive integer verified_size_bytes (>= 1); zero is rejected as validation_blocker
caller-supplied now
```

On confirmation:

```text
verified_at = caller-supplied now
```

Entering `policy_blocked` sets:

```text
file_policy_status = blocked
```

`abandoned` is allowed only before confirmation.

`expired` is allowed only from `reserved`, `upload_started`, or `uploaded_unconfirmed`, and only when:

```text
caller-supplied now >= upload_expires_at
```

A confirmed record does not expire through this repository.

No transition deletes bytes, deletes an object, performs cleanup, or executes retention.

#### Clock and expiry

Creation and transition require a valid normalized caller-supplied `now`.

The repository never reads or constructs system time and does not obtain time from an environment, database, network, filesystem, storage provider, or cloud provider.

Replay does not alter timestamps or extend expiry. A retry’s `now` is not a replay-conflict fact.

Transition evaluation order is exactly:

```text
1. validate inputs and transition-specific facts
2. perform organization-scoped lookup
3. evaluate exact replay
4. enforce expiry for every non-replay pre-confirmation request
5. require stored upload_state to equal expected_upload_state
6. require an authorized directed edge
7. apply the complete transition atomically
```

Before `upload_expires_at`, a transition to `expired` is denied.

At or after `upload_expires_at`, the only new transition allowed for a pre-confirmation record is `expired`.

Because replay is evaluated first, a transition completed before expiry remains replayable afterward when all replay facts match.

#### Organization scope

The repository key and every read or transition use:

```text
organization_id
intake_file_id
```

Creation additionally requires `intake_batch_id`.

The service layer must validate the organization, batch, and file relationship before creation. The repository does not perform cross-organization scans or establish global file-identifier uniqueness.

No ID-only lookup, tenant probe, fallback lookup, or unscoped lookup is authorized.

Missing and nondisclosable scoped records return identical `not_found` / 404 results. No response discloses another organization’s record or whether one exists.

Separate in-memory repository instances share no state.

#### Creation replay

When no scoped record exists, `createReservedUploadLifecycle` creates the record in `reserved`.

An existing scoped record with the same `organization_id`, `intake_file_id`, and `intake_batch_id` returns the existing record with:

```text
replayed: true
```

Replay changes no stored field and does not extend expiry.

A scoped record with a conflicting `intake_batch_id` returns:

```text
conflict_current_state_changed — 409
```

#### Transition replay and conflict behavior

When stored state equals `expected_upload_state` and the requested edge is authorized, the transition succeeds with `replayed: false`.

When stored state already equals `new_upload_state` and all transition-specific facts match, return the existing record with `replayed: true`.

Replay facts:

```text
uploaded_unconfirmed:
  object_version_id

confirmed:
  object_version_id
  verified_checksum
  verified_size_bytes

policy_blocked:
  no caller-supplied transition fact

abandoned:
  no caller-supplied transition fact

expired:
  no caller-supplied transition fact
```

A same-target replay with conflicting facts returns `conflict_current_state_changed` / 409.

A stored state different from both the expected and target states returns `conflict_current_state_changed` / 409.

A recognized but unauthorized edge returns `state_transition_denied` / 422.

Every failed creation or transition leaves stored state unchanged.

#### Error and result contract

This decision creates no new lifecycle-specific error code and uses exactly:

<!-- BEGIN_P0_06A_LIFECYCLE_ERROR_CODES_V1 -->

```text
validation_blocker
state_transition_denied
conflict_current_state_changed
not_found
```

<!-- END_P0_06A_LIFECYCLE_ERROR_CODES_V1 -->

Mapping:

```text
invalid or malformed input:
  validation_blocker — 422

unauthorized transition:
  state_transition_denied — 422

creation, expected-state, or replay-fact conflict:
  conflict_current_state_changed — 409

missing or nondisclosable scoped record:
  not_found — 404
```

Creation and transition success:

```js
{
  ok: true,
  data: {
    record,
    replayed: boolean
  },
  error: null
}
```

Read success:

```js
{
  ok: true,
  data: {
    record
  },
  error: null
}
```

Failure:

```js
{
  ok: false,
  data: null,
  error: {
    code,
    status
  }
}
```

#### Implementation boundary

This decision authorizes only a later in-memory synthetic repository package under `Backend/kai/upload/`.

It does not authorize implementation in this documentation step, production composition, barrel export, upload or confirmation routes, listener behavior, byte storage, object-version generation, checksum computation, streaming, backpressure, size or timeout enforcement, abort or cleanup execution, concurrency permits, shared coordination, audit, metrics, security-assessment enqueueing, executor enablement, database or cloud persistence, schema changes, deletion, retention, feature enablement, P0-06B, deployment, or push.

### P0-06A local upload service orchestration

The service operation `uploadReservedIntakeFile` is authorized only as a bounded local service-layer orchestration over the dependency-injected synthetic upload-lifecycle repository and dependency-injected storage adapter. The service does not construct a local adapter from a root-directory dependency, does not accept service-level object-version factories, and fails closed when no adapter is injected. Production composition remains unchanged. It authorizes no route, listener, confirmation, database persistence, durable schema, production binding, cloud provider binding, parser, worker, audit, metric, security-assessment execution, P0-06B behavior, deployment, or live-upload readiness.

Fresh-upload mode is the only authorized upload orchestration mode in P0-06A. It requires organization and intake-file identity, a deterministic caller-supplied `now`, and exactly one byte source: `bytes` or `byteSource`. Caller-supplied recovery input, recovery `object_version_id`, recovery `size_bytes`, recovery envelopes, and same-reservation resume are not authorized.

Each intake-file reservation permits at most one storage attempt. After a reservation transitions to `upload_started`, any failure, replay, retry, abort, or final-transition conflict requires a new intake-file reservation. No same-reservation retry may create another object or bind a previously completed object.

The operation order is exactly:

```text
1. require KAI_SPRINT2_ENABLED and KAI_FILE_UPLOAD_ENABLED
2. resolve and authorize actor, role, active membership, organization scope, and exact intake-file scope
3. transition reserved -> upload_started
4. if that transition throws, return a sanitized internal failure indicating only that a new reservation is required and do not call storage
5. if that transition returns a contract-valid failure, return the repository failure and do not call storage
6. if that transition returns ok true, require data, boolean replayed, a record for the exact organization and intake file, upload_state upload_started, and null or absent object_version_id before storage may be called
7. if that transition is a replayed upload_started transition, return a sanitized failure indicating only that a new reservation is required and do not create another object
8. call the injected storageAdapter.createObjectVersion({ bytes, byteSource, signal })
9. if storage returns explicit `ok:false`, fails, or aborts, return a sanitized storage failure indicating only that a new reservation is required and do not transition to uploaded_unconfirmed; malformed storage results, including absent, primitive, empty, or non-boolean `ok` values, are sanitized internal failures and do not proceed
10. on storage success, independently validate that object_version_id is a primitive string matching `^ov_[a-f0-9]{32}$` and size_bytes is a non-negative safe integer, then transition upload_started -> uploaded_unconfirmed with the exact returned object_version_id
11. on final transition ok true, require data, boolean replayed, a record for the exact organization and intake file, upload_state uploaded_unconfirmed, and the exact object_version_id returned by storage before returning success
12. on transition success, return only intake-file identity, upload_state, provider-neutral object_version_id, size_bytes, and replayed
```

Malformed initial success envelopes, replayed initial transitions, malformed storage success results, thrown storage exceptions, and returned storage failures after `upload_started` are sanitized failures requiring a new reservation. No returned object identity from a malformed initial success, malformed storage result, or malformed final success may be exposed or bound. Boxed strings, arrays, numbers, objects with matching `toString()`, and all other non-string object-version values are invalid.

If storage succeeds but the final `uploaded_unconfirmed` transition fails, throws, or returns a malformed ok true envelope, the completed object must not be deleted, replaced, retried, compensated, exposed, or bound through a caller recovery path. The service returns a sanitized failure indicating only that a new reservation is required. It does not return `object_version_id`, `size_bytes`, a recovery token, or any other completed-object identity.

No filesystem root, path, object key, URI, bucket, signed URL, provider-private identifier, raw bytes, or storage-private diagnostic may be returned.

Completed-object compensation deletion is prohibited in every fresh, failure, abort, replay, and final-transition-conflict path. Only the adapter's operation-scoped incomplete-write cleanup may remove incomplete local write state. Durable bound recovery is deferred to P0-06B and Gate A; P0-06A implements no synthetic recovery, resume, recovery identity return, or storage stat recovery behavior.

P0-06A exact-version confirmation prerequisites may add a provider-neutral `openObjectVersionReadStream({ objectVersionId, signal? })` operation. A successful result returns only `{ object_version_id, size_bytes, byte_source }`, where the ID is the validated provider-neutral exact version, size is a non-negative safe integer obtained from the same opened object handle that supplies bytes, and `byte_source` is a streamed or async-iterable byte source rather than a whole-object `Buffer`. The operation must validate the version ID before filesystem access, resolve only adapter-controlled object locations, open the exact object version once, bind stat metadata and bytes to that same open handle, and transfer ownership of that open handle to `byte_source`. The `byte_source` must close the owned handle through one idempotent release path on normal completion, stream/read failure, abort during reading, abort before iteration begins, early consumer cancellation, consumer `throw()`, and explicit `byte_source.close()`; consumers must fully consume it or invoke its explicit close/release operation. Abort handling must be attached when the handle is transferred to `byte_source`, and abort must close the handle even before iteration begins. The internal exact-version verifier receives only service-controlled trusted facts: storage adapter, provider-neutral object-version ID, declared lowercase SHA-256 checksum, expected size, hash algorithm, and optional abort signal. It calls only `openObjectVersionReadStream({ objectVersionId, signal? })`, rejects malformed inputs before storage, rejects malformed storage envelopes, verifies storage `size_bytes` before consuming bytes, streams chunks through Node SHA-256 without whole-object buffering, verifies streamed byte count against both storage size and trusted expected size, and compares the computed lowercase SHA-256 to the trusted declared checksum. After accepting a valid byte source it must use `try/finally` and invoke `byte_source.close()` for every verification outcome, including success, checksum mismatch, size mismatch, malformed chunks, excess or insufficient bytes, read exceptions, aborts, and unexpected failures. The verifier returns only internal verified facts `{ objectVersionId, verifiedChecksum, verifiedSizeBytes }` on success and sanitized structured failures otherwise. It performs no authorization, metadata or lifecycle read, lifecycle transition, route response shaping, deletion, retention, database or cloud call, or production composition. The operation and verifier must not expose filesystem paths, object keys, URIs, buckets, native diagnostics, provider-private identifiers, raw bytes outside the byte source, or production composition. `confirmUpload` orchestration remains unimplemented in this package; P0-06B and Gate A remain unchanged and unauthorized.

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
