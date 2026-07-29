import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  KAI_SPRINT2_P0_ABUSE_LIMITS,
  KAI_SPRINT2_P0_ARCHIVE_LIMITS,
  KAI_SPRINT2_P0_CONTRACT_VERSION,
  KAI_SPRINT2_P0_CSV_LIMITS,
  KAI_SPRINT2_P0_FINGERPRINT,
  KAI_SPRINT2_P0_HASH_ALGORITHM,
  KAI_SPRINT2_P0_OPERATION_ROLES,
  KAI_SPRINT2_P0_PATTERNS,
  KAI_SPRINT2_P0_REQUEST_LIMITS,
  KAI_SPRINT2_P0_RESOURCE_LIMITS,
  KAI_SPRINT2_P0_REVIEW_QUEUE_TYPES,
  KAI_SPRINT2_P0_SECURITY_EXECUTOR,
  KAI_SPRINT2_P0_STRING_LIMITS,
  KAI_SPRINT2_P0_UPLOAD_STATES,
  KAI_SPRINT2_P0_UPLOAD_TIMING,
  KAI_SPRINT2_P0_XLSX_LIMITS,
} from "../Backend/kai/config/kaiSprint2P0Contract.js";
import { VALID_REVIEW_QUEUE_TYPES } from "../Backend/kai/validators/intakeValidators.js";

const contract = readFileSync("Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md", "utf8");
const prewriteVerifier = readFileSync(
  "scripts/kai-sprint2-pass2-admin-metadata-intake-prewrite-verifier.sql",
  "utf8",
);

test("repository contract locks request, string, and resource limits", () => {
  assert.equal(KAI_SPRINT2_P0_CONTRACT_VERSION, "0.3.5");
  assert.deepEqual(KAI_SPRINT2_P0_REQUEST_LIMITS, {
    metadataJsonMaxRawBytes: 102400,
    metadataJsonMaxDepth: 4,
    metadataJsonMaxTotalKeys: 64,
    allowlistedArrayMaxLength: 25,
  });
  assert.equal(KAI_SPRINT2_P0_STRING_LIMITS.checksumSha256HexLength, 64);
  assert.equal(KAI_SPRINT2_P0_STRING_LIMITS.idempotencyKeyMinLength, 8);
  assert.equal(KAI_SPRINT2_P0_STRING_LIMITS.idempotencyKeyMaxLength, 128);
  assert.equal(KAI_SPRINT2_P0_STRING_LIMITS.safeFilenameMaxLength, 181);
  assert.equal(KAI_SPRINT2_P0_STRING_LIMITS.originalFilenameMaxLength, 255);
  assert.equal(KAI_SPRINT2_P0_STRING_LIMITS.mimeTypeMaxLength, 128);
  assert.equal(KAI_SPRINT2_P0_STRING_LIMITS.machineCodeMaxLength, 64);
  assert.equal(KAI_SPRINT2_P0_STRING_LIMITS.displayLabelMaxLength, 200);
  assert.equal(KAI_SPRINT2_P0_STRING_LIMITS.operatorTextMaxLength, 1000);
  assert.deepEqual(KAI_SPRINT2_P0_RESOURCE_LIMITS, {
    maxFilesPerBatch: 25,
    paginationDefaultLimit: 100,
    paginationMaxLimit: 100,
  });
  assert.deepEqual(KAI_SPRINT2_P0_CSV_LIMITS, {
    maxLogicalRecords: 100000,
  });
  assert.deepEqual(KAI_SPRINT2_P0_XLSX_LIMITS, {
    maxSheets: 20,
    maxCells: 1000000,
  });
  assert.deepEqual(KAI_SPRINT2_P0_ARCHIVE_LIMITS, {
    maxEntries: 2000,
    maxExpandedBytes: 262144000,
    maxCompressionRatio: 100,
    assessorTimeoutMs: 10000,
  });
});

test("checksum, idempotency key, filename, UUID, and hash constants match the contract", () => {
  assert.equal(KAI_SPRINT2_P0_HASH_ALGORITHM, "sha256");
  assert.equal(KAI_SPRINT2_P0_PATTERNS.checksumSha256.test("a".repeat(64)), true);
  assert.equal(KAI_SPRINT2_P0_PATTERNS.checksumSha256.test("A".repeat(64)), true);
  assert.equal(KAI_SPRINT2_P0_PATTERNS.checksumSha256.test(`sha256:${"a".repeat(64)}`), false);
  assert.equal(KAI_SPRINT2_P0_PATTERNS.idempotencyKey.test("12345678"), true);
  assert.equal(KAI_SPRINT2_P0_PATTERNS.idempotencyKey.test("short"), false);
  assert.equal(KAI_SPRINT2_P0_PATTERNS.safeFilename.test("a".repeat(181)), true);
  assert.equal(KAI_SPRINT2_P0_PATTERNS.safeFilename.test("a".repeat(182)), false);
  assert.equal(KAI_SPRINT2_P0_PATTERNS.uuid.test("a5d17c5a-c55f-43af-9b21-fe63aafe733f"), true);
  assert.equal(KAI_SPRINT2_P0_PATTERNS.uuid.test("a".repeat(64)), false);
});

test("abuse, upload timing, and synthetic lifecycle values are exact", () => {
  assert.deepEqual(KAI_SPRINT2_P0_ABUSE_LIMITS, {
    windowMs: 900000,
    actorMutationAttempts: 120,
    organizationMutationAttempts: 600,
    concurrentUploadsPerActor: 2,
    concurrentUploadsPerOrganization: 5,
  });
  assert.deepEqual(KAI_SPRINT2_P0_UPLOAD_TIMING, {
    idleTimeoutMs: 30000,
    totalTimeoutMs: 270000,
    reservationExpiryMs: 86400000,
  });
  assert.deepEqual(KAI_SPRINT2_P0_UPLOAD_STATES, [
    "reserved",
    "upload_started",
    "uploaded_unconfirmed",
    "confirmed",
    "policy_blocked",
    "abandoned",
    "expired",
  ]);
});

test("fingerprint version, exact fields, persisted representation, and compatibility limits are recorded", () => {
  assert.equal(KAI_SPRINT2_P0_FINGERPRINT.algorithm, "sha256");
  assert.equal(KAI_SPRINT2_P0_FINGERPRINT.version, "kai-sprint2-p0-fingerprint-v1");
  assert.deepEqual(KAI_SPRINT2_P0_FINGERPRINT.batchFields, [
    "organization_id",
    "engagement_id",
    "batch_code",
    "idempotency_key",
    "intake_method",
    "source_system_name",
    "source_system_ref",
    "notes",
    "batch_metadata",
  ]);
  assert.deepEqual(KAI_SPRINT2_P0_FINGERPRINT.fileReservationFields, [
    "organization_id",
    "engagement_id",
    "intake_batch_id",
    "idempotency_key",
    "original_filename",
    "safe_filename",
    "mime_type",
    "file_extension",
    "file_size_bytes",
    "checksum",
    "hash_algorithm",
    "reservation_metadata",
  ]);
  assert.match(contract, /installed and only supported P0 fingerprint version identifier/);
  assert.match(contract, /identifier does not participate in the canonical hash input/);
  assert.match(contract, /exactly a bare 64-character lowercase SHA-256 hexadecimal digest/);
  assert.match(contract, /No separate version discriminator is persisted/);
  assert.match(contract, /no second fingerprint version may be introduced until persisted-version compatibility is resolved/);
  assert.match(contract, /missing, null, empty, non-string, malformed, or different stored fingerprint fails closed as a 409 conflict/);
  assert.match(contract, /Unsupported-version detection is not currently possible/);
  assert.match(contract, /remains deferred to Gate A/);
  assert.match(contract, /Deployed-schema compatibility remains `NOT_CONFIRMED`/);
});

test("operation roles and the disabled security-executor identity are explicit", () => {
  assert.deepEqual(KAI_SPRINT2_P0_OPERATION_ROLES.create_intake_batch, ["gk_admin", "gk_operator"]);
  assert.deepEqual(KAI_SPRINT2_P0_OPERATION_ROLES.create_intake_file, ["gk_admin", "gk_operator"]);
  assert.deepEqual(KAI_SPRINT2_P0_OPERATION_ROLES.mark_file_policy_blocked, ["gk_admin", "gk_operator"]);
  assert.deepEqual(KAI_SPRINT2_P0_OPERATION_ROLES.update_review_queue_status, ["gk_admin", "gk_operator"]);
  assert.equal(KAI_SPRINT2_P0_SECURITY_EXECUTOR.actorType, "internal_service");
  assert.equal(KAI_SPRINT2_P0_SECURITY_EXECUTOR.serviceIdentity, "kai_file_security_executor");
  assert.equal(KAI_SPRINT2_P0_SECURITY_EXECUTOR.operationGroup, "file_security_assessment");
  assert.deepEqual(KAI_SPRINT2_P0_SECURITY_EXECUTOR.allowedOperations, [
    "record_file_security_result",
    "transition_file_policy_status",
    "write_file_security_audit",
  ]);
  assert.match(contract, /This package defines the identity but does not enable it\./);
});

test("repository contract records PDF encryption/password detector authority and boundaries", () => {
  assert.match(contract, /OWNER_DECISION\.P0_05_PDF_ENCRYPTION_PASSWORD_DETECTOR_V1/);
  assert.match(contract, /policy: block\s+category: encrypted_or_password_protected\s+exact_keys: policy, category/);
  assert.match(contract, /No block result:\s+```text\s+undefined/);
  assert.match(contract, /did not establish an encryption\/password block/);
  assert.match(contract, /not a file-policy pass, PDF-validity result, text-layer result, or authorization for downstream processing/);
  assert.match(contract, /Primary signal: `document\.needsPassword\(\) === true`/);
  assert.match(contract, /Secondary conservative signal: `document\.getMetaData\(Document\.META_ENCRYPTION\)`/);
  assert.match(contract, /document open fails; `needsPassword\(\)` throws; `needsPassword\(\)` returns anything other than a boolean/);
  assert.match(contract, /encryption metadata access throws; encryption metadata is an empty string; encryption metadata is neither a string nor `undefined`/);
  assert.match(contract, /Do not call `authenticatePassword`/);
  assert.match(contract, /committed extension\/MIME\/signature and complete shallow PDF identity\s+-> successful MuPDF open\s+-> encryption\/password detector/);
  assert.match(contract, /A protected result short-circuits later PDF checks/);
  assert.match(contract, /PDF integrity\/validity assessment is deferred to a later separately authorized leaf/);
  assert.match(contract, /must not be described as valid, clean, safe, machine-readable, or passed/);
  assert.match(contract, /directly changes none of `file_policy_status`, `processing_status`, `parse_status`, or `upload_state`/);
  assert.match(contract, /No executor mapping, service wiring, route wiring, listener wiring, database write, audit write, persistence, public API mapping, client serialization, deployment configuration, production configuration, or later PDF detector work/);
});

test("repository contract records PDF extractable-text detector authority and boundaries", () => {
  assert.match(contract, /OWNER_DECISION\.P0_05_PDF_EXTRACTABLE_TEXT_DETECTOR_V1/);
  assert.match(contract, /policy: block\s+category: pdf_no_extractable_text\s+exact_keys: policy, category/);
  assert.match(contract, /Text-present result:\s+```text\s+undefined/);
  assert.match(contract, /at least one extracted non-whitespace character was found/);
  assert.match(contract, /not a file-policy pass and does not establish PDF validity, integrity, active-content safety, parser eligibility, upload acceptance/);
  assert.match(contract, /encryption\/password detector returns undefined\s+-> bounded MuPDF page-level structured-text extraction/);
  assert.match(contract, /Document\.loadPage\(index\)`[^`]+`Page\.toStructuredText\(\)`[^`]+`StructuredText\.walk\(\{ onChar \}\)`/s);
  assert.match(contract, /Do not use OCR/);
  assert.match(contract, /Do not return, persist, log, expose, or store extracted text/);
  assert.match(contract, /valid blank PDFs and graphics\/image-only PDFs/);
  assert.match(contract, /short-circuits later PDF JavaScript, action, and embedded-file checks/);
  assert.match(contract, /MuPDF open failure, page count failure, page load failure, structured-text extraction failure/);
  assert.match(contract, /Use the existing sanitized worker-failure path/);
  assert.match(contract, /Repaired but openable PDFs remain subject to the previously recorded integrity deferral/);
  assert.match(contract, /directly changes none of `file_policy_status`, `processing_status`, `parse_status`, or `upload_state`/);
  assert.match(contract, /No executor mapping, service wiring, route wiring, listener wiring, database write, audit write, persistence, public API mapping, client serialization, OCR, deployment configuration, production configuration, PDF JavaScript\/action detection, embedded-file detection, or another PDF detector leaf/);
});

test("repository contract records PDF active-action and embedded-file detector authority and boundaries", () => {
  assert.match(contract, /OWNER_DECISION\.P0_05_PDF_ACTIVE_ACTION_EMBEDDED_FILE_DETECTOR_V1/);
  assert.match(contract, /policy: block\s+category: pdf_active_or_embedded_content\s+exact_keys: policy, category/);
  assert.match(contract, /No block result:\s+```text\s+undefined/);
  assert.match(contract, /did not establish an active-action or embedded-file block/);
  assert.match(contract, /not a file-policy pass and does not establish PDF validity, integrity, clean\/safe status/);
  assert.match(contract, /extractable-text detector returns undefined\s+-> bounded MuPDF PDF-object active-action and embedded-file traversal/);
  assert.match(contract, /`\/Names\/JavaScript`; JavaScript action or `\/JS` content; `\/Names\/EmbeddedFiles`; `\/EF` embedded-file reference; `\/AF` associated file; `\/FileAttachment` annotation/);
  assert.match(contract, /anything other than exact internal `\/GoTo`/);
  assert.match(contract, /missing, malformed, unresolved, or unknown `\/S`/);
  assert.match(contract, /For `\/OpenAction`, allow an internal destination and exact internal `\/GoTo`; block every other action/);
  assert.match(contract, /For `\/Link` annotations, allow no action and exact internal `\/GoTo`; block `\/URI`, `\/Launch`, `\/GoToR`, JavaScript/);
  assert.match(contract, /`Document\.asPDF\(\)`/);
  assert.match(contract, /`PDFDocument\.getTrailer\(\)`/);
  assert.match(contract, /`PDFDocument\.loadPage\(index\)`/);
  assert.match(contract, /`PDFPage\.getObject\(\)`/);
  assert.match(contract, /`PDFObject\.get\(\.\.\.\)`/);
  assert.match(contract, /`PDFObject\.resolve\(\)`/);
  assert.match(contract, /`PDFObject\.forEach\(\.\.\.\)`/);
  assert.match(contract, /Use the existing sanitized worker-failure path/);
  assert.match(contract, /Do not return or expose scripts or action contents; URLs or destinations; filenames or attachment names; embedded bytes; document text; object contents; paths, identifiers, stacks, dependency internals, or infrastructure details/);
  assert.match(contract, /directly changes none of `file_policy_status`, `processing_status`, `parse_status`, or `upload_state`/);
  assert.match(contract, /PDF active content\/embedded files -> pdf_active_or_embedded_content/);
});

test("repository contract records CSV row-limit detector authority and boundaries", () => {
  assert.match(contract, /OWNER_DECISION\.P0_05_CSV_ROW_LIMIT_DETECTOR_V1/);
  assert.match(contract, /maximum_logical_records: 100000/);
  assert.match(contract, /policy: block\s+category: csv_row_limit_exceeded\s+exact_keys: policy, category/);
  assert.match(contract, /At-or-below-limit result:\s+```text\s+undefined/);
  assert.match(contract, /`undefined` means only that this detector did not establish a CSV row-limit block/);
  assert.match(contract, /not a file-policy pass/);
  assert.match(contract, /count every logical record, including the first; no header inference/);
  assert.match(contract, /stop immediately when logical record 100001 is established/);
  assert.match(contract, /quoted LF or CRLF does not end a record/);
  assert.match(contract, /Lone CR or malformed quoting uses the sanitized CSV row-limit failure path/);
  assert.match(contract, /Instruction-like and formula-like values beginning with `=`, `\+`, `-`, or `@` remain inert data/);
  assert.match(contract, /Do not execute, rewrite, neutralize, return, persist, expose, or log CSV content/);
  assert.match(contract, /directly changes none of `file_policy_status`, `processing_status`, `parse_status`, or `upload_state`/);
});

test("repository contract records XLSX sheet and cell limit detector authority and boundaries", () => {
  assert.match(contract, /OWNER_DECISION\.P0_05_XLSX_SHEET_CELL_LIMIT_DETECTOR_V1/);
  assert.match(contract, /maximum_sheets: 20/);
  assert.match(contract, /maximum_cells: 1000000/);
  assert.match(contract, /policy: block\s+category: xlsx_sheet_limit_exceeded\s+exact_keys: policy, category/);
  assert.match(contract, /policy: block\s+category: xlsx_cell_limit_exceeded\s+exact_keys: policy, category/);
  assert.match(contract, /No block result:\s+```text\s+undefined/);
  assert.match(contract, /`undefined` means only that this detector did not establish an XLSX sheet-limit or cell-limit block/);
  assert.match(contract, /complete XLSX shallow identity\s+-> bounded XLSX sheet-count detector\s+-> bounded XLSX cell-count detector/);
  assert.match(contract, /count direct `<sheet>` elements in the workbook `<sheets>` collection/);
  assert.match(contract, /visible, hidden, and veryHidden sheets all count/);
  assert.match(contract, /stop immediately when sheet 21 is established/);
  assert.match(contract, /count actual worksheet `<c>` XML elements by namespace\/local name/);
  assert.match(contract, /Do not use regex, byte searching, worksheet dimensions, row numbers, ranges, shared strings, comments, formulas/);
  assert.match(contract, /Do not count orphan worksheet files/);
  assert.match(contract, /missing, duplicate, unresolved, malformed, absolute, external, or traversal relationship mappings use the existing sanitized failure path/);
  assert.match(contract, /DTD\/entity declarations, unsupported XML, malformed ZIP\/XML, unsupported compression, decompression failure, or unexpected parser output use sanitized failure/);
  assert.match(contract, /Formula and instruction-like contents remain inert/);
  assert.match(contract, /Do not execute, evaluate, rewrite, return, retain, persist, expose, or log workbook content, formulas, filenames, relationship targets, XML, paths, stacks, parser internals, rows, cells, values, or counts/);
  assert.match(contract, /directly changes none of `file_policy_status`, `processing_status`, `parse_status`, or `upload_state`/);
});

test("repository contract records OOXML path-traversal detector authority and boundaries", () => {
  assert.match(contract, /OWNER_DECISION\.P0_05_OOXML_PATH_TRAVERSAL_DETECTOR_V1/);
  assert.match(contract, /newly_authorized_result_shape: true/);
  assert.match(contract, /newly_authorized_duplicate_normalized_zip_entry_block: true/);
  assert.match(contract, /policy: block\s+category: ooxml_path_traversal\s+exact_keys: policy, category/);
  assert.match(contract, /No block result:\s+```text\s+undefined/);
  assert.match(contract, /did not establish an OOXML path-traversal block/);
  assert.match(contract, /not a file-policy pass, type-agreement pass, parser-eligibility result, upload acceptance result/);
  assert.match(contract, /bounded XLSX cell-count detector\s+-> OOXML path-traversal detector/);
  assert.match(contract, /Duplicate ZIP entry-name detection is the explicit exception/);
  assert.match(contract, /containing a `\.\.` slash-separated segment, backslash, NUL, drive-letter form, UNC form, or leading filesystem-absolute form/);
  assert.match(contract, /removing `\.` and empty slash-separated segments, preserving case and directory\/file distinction, and not percent-decoding/);
  assert.match(contract, /Exact duplicates and distinct central-directory entries resolving to the same normalized package name both block as `ooxml_path_traversal`/);
  assert.match(contract, /inspect every `<Relationship>` in every `\.rels` part/);
  assert.match(contract, /Inspect relationships whose `TargetMode` is `Internal` or absent; absent defaults to internal/);
  assert.match(contract, /`TargetMode="External"` is out of scope/);
  assert.match(contract, /A leading `\/` is package-absolute, resolves from the package root, and is allowed when it remains inside the package/);
  assert.match(contract, /Relative `\.\.` segments are allowed only when normalized resolution remains inside the package/);
  assert.match(contract, /Block escape above the package root, backslash, NUL, drive-letter form, UNC form, filesystem-path form, invalid percent encoding, or traversal revealed by one URI percent-decoding pass/);
  assert.match(contract, /Malformed or ambiguous ZIP\/XML\/relationship structures, missing targets, unsupported constructs, and thrown operations use the existing sanitized failure path/);
  assert.match(contract, /Duplicate normalized entries are the explicit exception: they block/);
  assert.match(contract, /Do not expose entry names, targets, XML, workbook content, paths, stacks, parser internals/);
  assert.match(contract, /must not be placed in, imported by, or executed inside the PDF worker/);
  assert.match(contract, /must not install dependencies or add archive-count, expanded-size, compression-ratio, timeout, macro, external-relationship/);
  assert.match(contract, /directly changes none of `file_policy_status`, `processing_status`, `parse_status`, or `upload_state`/);
});

test("repository contract records XLSX macro/external-relationship detector authority and boundaries", () => {
  assert.match(contract, /OWNER_DECISION\.P0_05_XLSX_MACRO_EXTERNAL_RELATIONSHIP_DETECTOR_V1/);
  assert.match(contract, /newly_authorized_result_shape: true/);
  assert.match(contract, /newly_authorized_category_fusion: true/);
  assert.match(contract, /newly_authorized_all_external_relationship_block: true/);
  assert.match(contract, /policy: block\s+category: xlsx_macro_or_external_relationship\s+exact_keys: policy, category/);
  assert.match(contract, /This category deliberately fuses macro presence and external-relationship presence into one P0 block result/);
  assert.match(contract, /P0 does not distinguish macro and external-relationship findings in this detector result/);
  assert.match(contract, /No block result:\s+```text\s+undefined/);
  assert.match(contract, /did not establish an XLSX macro or external-relationship block/);
  assert.match(contract, /not a file-policy pass, type-agreement pass, parser-eligibility result, upload acceptance result/);
  assert.match(contract, /OOXML path-traversal detector\s+-> XLSX macro\/external-relationship detector/);
  assert.match(contract, /runs only after the OOXML path-traversal detector returns `undefined`/);
  assert.match(contract, /If an earlier traversal block is established, that earlier block result is returned/);
  assert.match(contract, /a VBA project part or VBA signature part/);
  assert.match(contract, /macro-enabled workbook, macrosheet, international-macrosheet, VBA-project, or VBA-signature content type/);
  assert.match(contract, /VBA, VBA-signature, macrosheet, or international-macrosheet relationship type/);
  assert.match(contract, /any relationship whose `TargetMode` is exactly `External`, regardless of relationship type/);
  assert.match(contract, /All external relationships block in P0, including hyperlinks, linked images, `oleObject` links, and unknown external relationship types/);
  assert.match(contract, /`TargetMode` absent or exactly `Internal` does not block here/);
  assert.match(contract, /Any other `TargetMode` value uses the sanitized failure path/);
  assert.match(contract, /distinguishes `Default` and `Override` entries/);
  assert.match(contract, /inspect every `\.rels` part across root, workbook, worksheet, and other relationship parts/);
  assert.match(contract, /read every relationship `Type`, `Target`, and `TargetMode`/);
  assert.match(contract, /must not follow targets/);
  assert.match(contract, /Malformed or ambiguous ZIP\/XML\/content-type structures, unexpected parser output/);
  assert.match(contract, /Do not follow targets, read VBA bytes, execute macros, evaluate formulas/);
  assert.match(contract, /or expose entries, targets, XML, workbook content, paths, stacks, parser internals/);
  assert.match(contract, /must not be placed in, imported by, or executed inside the PDF worker/);
  assert.match(contract, /must not install dependencies or add archive-entry, expanded-size, compression-ratio, timeout/);
  assert.match(contract, /directly changes none of `file_policy_status`, `processing_status`, `parse_status`, or `upload_state`/);
  assert.match(contract, /macros\/external relationships -> xlsx_macro_or_external_relationship/);
});

test("repository contract records OOXML archive resource-limit detector authority and boundaries", () => {
  assert.match(contract, /OWNER_DECISION\.P0_05_OOXML_ARCHIVE_RESOURCE_LIMIT_DETECTOR_V1/);
  assert.match(contract, /maximum_zip_entries: 2000/);
  assert.match(contract, /maximum_total_expanded_bytes: 262144000/);
  assert.match(contract, /maximum_compression_ratio: 100:1/);
  assert.match(contract, /whole_assessor_timeout_ms_recorded_not_implemented: 10000/);
  assert.match(contract, /policy: block\s+category: archive_entry_limit_exceeded\s+exact_keys: policy, category/);
  assert.match(contract, /policy: block\s+category: archive_expanded_size_limit_exceeded\s+exact_keys: policy, category/);
  assert.match(contract, /policy: block\s+category: archive_compression_ratio_limit_exceeded\s+exact_keys: policy, category/);
  assert.match(contract, /No block result:\s+```text\s+undefined/);
  assert.match(contract, /did not establish an OOXML archive entry-count, expanded-size, or compression-ratio block/);
  assert.match(contract, /not a file-policy pass, type-agreement pass, parser-eligibility result, upload acceptance result/);
  assert.match(contract, /XLSX macro\/external-relationship detector\s+-> OOXML archive resource-limit detector/);
  assert.match(contract, /runs only after the XLSX macro\/external-relationship detector returns `undefined`/);
  assert.match(contract, /count every central-directory entry, including directories/);
  assert.match(contract, /2,000 entries pass; entry 2,001 blocks immediately/);
  assert.match(contract, /262,144,000 total expanded bytes pass/);
  assert.match(contract, /stop at emitted byte 262,144,001 and return `archive_expanded_size_limit_exceeded`/);
  assert.match(contract, /Declared sizes are cheap preflight facts only, never the enforced expanded-byte measurement/);
  assert.match(contract, /expanded_bytes \/ compressed_bytes/);
  assert.match(contract, /per entry and for the running archive aggregate/);
  assert.match(contract, /stored entries are 1:1/);
  assert.match(contract, /exactly 100:1 passes; strictly greater than 100:1 blocks/);
  assert.match(contract, /A non-empty entry with zero compressed bytes blocks as `archive_compression_ratio_limit_exceeded`/);
  assert.match(contract, /entry count\s+-> expanded size\s+-> compression ratio/);
  assert.match(contract, /If one entry breaches expanded-size and compression-ratio, return `archive_expanded_size_limit_exceeded`/);
  assert.match(contract, /Forged or inconsistent ZIP metadata, unsupported compression, decompression failure, malformed structure, or mismatched emitted sizes use the sanitized failure path/);
  assert.match(contract, /Do not retain or expose entry bytes, names, XML, workbook content, paths, stacks, or dependency internals/);
  assert.match(contract, /must not install dependencies, add standalone archive support, implement timeout or malware handling/);
  assert.match(contract, /directly changes none of `file_policy_status`, `processing_status`, `parse_status`, or `upload_state`/);
});

test("repository contract records worker-backed assessment timeout implementation scope", () => {
  assert.match(contract, /OWNER_DECISION\.P0_05_WORKER_BACKED_ASSESSOR_TIMEOUT_V1/);
  assert.match(contract, /fixed_worker_backed_assessment_deadline_ms: 10000/);
  assert.match(contract, /implementation_scope: existing worker-backed security-assessment boundary only/);
  assert.match(contract, /current_worker_backed_paths: PDF assessor worker boundary/);
  assert.match(contract, /synchronous_detector_scope: unchanged; no dispatcher and no forced worker migration/);
  assert.match(contract, /status: failed\s+category: security_assessment_timeout\s+exact_keys: status, category/);
  assert.match(contract, /No caller timeout override is authorized/);
  assert.match(contract, /does not convert timeout into a policy block or pass/);
});

test("queue vocabulary is shared by the repository contract and runtime validator", () => {
  assert.deepEqual(VALID_REVIEW_QUEUE_TYPES, KAI_SPRINT2_P0_REVIEW_QUEUE_TYPES);
  for (const queueType of KAI_SPRINT2_P0_REVIEW_QUEUE_TYPES) {
    assert.match(contract, new RegExp(`^${queueType}$`, "m"));
  }
});

test("contract retains the P0-06A boundary and unverified persistence labels", () => {
  assert.match(contract, /P0-06A may implement this lifecycle only through dependency-injected interfaces and an in-memory synthetic repository/);
  assert.match(contract, /P0-06B durable persistence is blocked by Gate A/);
  assert.match(contract, /deployed_kai_schema_compatibility: NOT_CONFIRMED/);
  assert.match(contract, /database_atomicity: NOT_CONFIRMED/);
  assert.match(contract, /persistent_upload_lifecycle: NOT_CONFIRMED/);
  assert.match(contract, /No lifecycle transition deletes an object or executes retention/);
});

test("one repository-neutral conflict signal covers batch and file reservation without claiming SQL mapping", () => {
  assert.match(contract, /one exact-identity, repository-neutral signal/);
  assert.match(contract, /Batch creation and intake-file metadata reservation both use that same exact-identity signal/);
  assert.match(contract, /Neither live SQL insert adapter is claimed to emit it/);
  assert.match(contract, /PostgreSQL mapping, constraints, two-session proof, and atomicity remain Gate-A-dependent/);
  assert.match(contract, /deployed-schema compatibility remains `NOT_CONFIRMED`/);
  assert.doesNotMatch(contract, /Only batch creation is integrated with that signal/);
});

test("executable prewrite verifier uses the repository checksum name", () => {
  assert.doesNotMatch(prewriteVerifier, /checksum_sha256/);
  assert.match(prewriteVerifier, /'intake_files', 'checksum'/);
  assert.match(prewriteVerifier, /ARRAY\['organization_id', 'checksum'\]/);
  assert.match(prewriteVerifier, /\(checksum IS NOT NULL\)/);
});
