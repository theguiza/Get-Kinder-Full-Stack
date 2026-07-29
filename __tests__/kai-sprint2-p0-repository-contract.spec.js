import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  KAI_SPRINT2_P0_ABUSE_LIMITS,
  KAI_SPRINT2_P0_CONTRACT_VERSION,
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
