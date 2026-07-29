export const KAI_SPRINT2_P0_CONTRACT_VERSION = "0.3.5";

export const KAI_SPRINT2_P0_REQUEST_LIMITS = Object.freeze({
  metadataJsonMaxRawBytes: 100 * 1024,
  metadataJsonMaxDepth: 4,
  metadataJsonMaxTotalKeys: 64,
  allowlistedArrayMaxLength: 25,
});

export const KAI_SPRINT2_P0_STRING_LIMITS = Object.freeze({
  checksumSha256HexLength: 64,
  idempotencyKeyMinLength: 8,
  idempotencyKeyMaxLength: 128,
  safeFilenameMinLength: 1,
  safeFilenameMaxLength: 181,
  originalFilenameMinLength: 1,
  originalFilenameMaxLength: 255,
  mimeTypeMinLength: 1,
  mimeTypeMaxLength: 128,
  machineCodeMinLength: 1,
  machineCodeMaxLength: 64,
  displayLabelMinLength: 1,
  displayLabelMaxLength: 200,
  operatorTextMinLength: 1,
  operatorTextMaxLength: 1000,
});

export const KAI_SPRINT2_P0_PATTERNS = Object.freeze({
  checksumSha256: /^[a-fA-F0-9]{64}$/,
  idempotencyKey: /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/,
  safeFilename: /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
});

export const KAI_SPRINT2_P0_HASH_ALGORITHM = "sha256";

export const KAI_SPRINT2_P0_ABUSE_LIMITS = Object.freeze({
  windowMs: 15 * 60 * 1000,
  actorMutationAttempts: 120,
  organizationMutationAttempts: 600,
  concurrentUploadsPerActor: 2,
  concurrentUploadsPerOrganization: 5,
});

export const KAI_SPRINT2_P0_UPLOAD_TIMING = Object.freeze({
  idleTimeoutMs: 30 * 1000,
  totalTimeoutMs: 270 * 1000,
  reservationExpiryMs: 24 * 60 * 60 * 1000,
});

export const KAI_SPRINT2_P0_RESOURCE_LIMITS = Object.freeze({
  maxFilesPerBatch: 25,
  paginationDefaultLimit: 100,
  paginationMaxLimit: 100,
});

export const KAI_SPRINT2_P0_CSV_LIMITS = Object.freeze({
  maxLogicalRecords: 100000,
});

export const KAI_SPRINT2_P0_XLSX_LIMITS = Object.freeze({
  maxSheets: 20,
  maxCells: 1000000,
});

export const KAI_SPRINT2_P0_ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 2000,
  maxExpandedBytes: 262144000,
  maxCompressionRatio: 100,
  assessorTimeoutMs: 10000,
});

export const KAI_SPRINT2_P0_UPLOAD_STATES = Object.freeze([
  "reserved",
  "upload_started",
  "uploaded_unconfirmed",
  "confirmed",
  "policy_blocked",
  "abandoned",
  "expired",
]);

export const KAI_SPRINT2_P0_REVIEW_QUEUE_TYPES = Object.freeze([
  "intake_file_review",
  "source_candidate_review",
  "sensitivity_review",
  "data_dictionary_review",
  "evidence_review",
  "claim_review",
  "client_followup",
  "conflict_resolution",
  "generated_content_review",
  "export_review",
]);

export const KAI_SPRINT2_P0_REVIEW_QUEUE_STATUSES = Object.freeze([
  "open",
  "in_progress",
  "blocked",
  "waiting_on_client",
  "waiting_on_gk",
  "resolved",
  "cancelled",
]);

export const KAI_SPRINT2_P0_FINGERPRINT = Object.freeze({
  algorithm: "sha256",
  version: "kai-sprint2-p0-fingerprint-v1",
  batchFields: Object.freeze([
    "organization_id",
    "engagement_id",
    "batch_code",
    "idempotency_key",
    "intake_method",
    "source_system_name",
    "source_system_ref",
    "notes",
    "batch_metadata",
  ]),
  fileReservationFields: Object.freeze([
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
  ]),
});

export const KAI_SPRINT2_P0_SECURITY_EXECUTOR = Object.freeze({
  actorType: "internal_service",
  serviceIdentity: "kai_file_security_executor",
  operationGroup: "file_security_assessment",
  allowedOperations: Object.freeze([
    "record_file_security_result",
    "transition_file_policy_status",
    "write_file_security_audit",
  ]),
});

export const KAI_SPRINT2_P0_OPERATION_ROLES = Object.freeze({
  create_intake_batch: Object.freeze(["gk_admin", "gk_operator"]),
  create_intake_file: Object.freeze(["gk_admin", "gk_operator"]),
  create_review_queue_item: Object.freeze(["gk_admin", "gk_operator"]),
  mark_file_policy_blocked: Object.freeze(["gk_admin", "gk_operator"]),
  update_review_queue_status: Object.freeze(["gk_admin", "gk_operator"]),
  read_intake: Object.freeze([
    "gk_admin",
    "gk_operator",
    "gk_reviewer",
    "client_admin",
    "client_reviewer",
    "client_contributor",
  ]),
});
