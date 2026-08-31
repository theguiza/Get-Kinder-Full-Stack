import {
  KAI_SPRINT2_P0_PATTERNS,
  KAI_SPRINT2_P0_REVIEW_QUEUE_STATUSES,
  KAI_SPRINT2_P0_REQUEST_LIMITS,
  KAI_SPRINT2_P0_STRING_LIMITS,
} from "../config/kaiSprint2P0Contract.js";
import {
  EVIDENCE_REVIEW_DECISION_OUTCOMES,
  CLAIM_REVIEW_DECISION_OUTCOMES,
  CLAIM_REVIEW_APPROVED_AUDIENCE_VALUES,
  evidenceReviewLimitationNotesRequired,
  claimReviewLimitationNotesRequired,
  claimReviewApprovedAudiencesRequired,
} from "../dictionary/humanReviewDecisionContract.js";
import {
  SENSITIVITY_ALLOWED_USE_DECISION_OUTCOMES,
  sensitivityReviewedSnapshotRequired,
  validateSensitivityReviewedSnapshot,
} from "../dictionary/sensitivityAllowedUseDecisionContract.js";

const SENSITIVITY_PROFILE_DECISION_REQUEST_KEYS = new Set([
  "expected_updated_at",
  "review_queue_item_id",
  "decision",
  "reviewed_snapshot",
]);

const HUMAN_REVIEW_LIMITATION_NOTE_MAX_LENGTH = 500;
const HUMAN_REVIEW_LIMITATION_NOTES_MAX_COUNT = 20;

export const INTAKE_BATCH_FILES_DEFAULT_LIMIT = 25;
export const INTAKE_BATCH_FILES_MAX_LIMIT = 25;
export const REVIEW_QUEUE_DEFAULT_LIMIT = 25;
export const REVIEW_QUEUE_MAX_LIMIT = 25;

const INTAKE_BATCH_FILES_QUERY_KEYS = new Set(["organization_id", "limit", "cursor"]);
const INTAKE_BATCH_FILES_CURSOR_KEYS = Object.freeze(["created_at", "intake_file_id"]);
const REVIEW_QUEUE_QUERY_KEYS = new Set(["organization_id", "limit", "cursor"]);
const REVIEW_QUEUE_CURSOR_KEYS = Object.freeze(["created_at", "review_queue_item_id"]);
export const FILE_POLICY_BLOCKING_REASON_CODES = Object.freeze([
  "unsafe_filename",
  "unsupported_mime_type",
  "file_too_large",
  "checksum_conflict",
  "malware_failed",
  "csv_formula_injection_risk",
  "storage_path_invalid",
  "other_policy_violation",
]);
const FILE_POLICY_BLOCK_REQUEST_KEYS = new Set([
  "expected_file_policy_status",
  "blocking_reason_code",
]);
const REVIEW_QUEUE_STATUS_REQUEST_KEYS = new Set([
  "expected_queue_status",
  "new_queue_status",
]);
const START_EXPORT_REVIEW_REQUEST_KEYS = new Set([
  "expected_updated_at",
]);
const COMPLETE_EXPORT_REVIEW_REQUEST_KEYS = new Set([
  "expected_updated_at",
]);
const COMPLETE_EVIDENCE_REVIEW_REQUEST_KEYS = new Set([
  "expected_updated_at",
  "decision",
  "limitation_notes",
]);
const COMPLETE_CLAIM_REVIEW_REQUEST_KEYS = new Set([
  "expected_updated_at",
  "decision",
  "limitation_notes",
  "approved_audiences",
]);
const COMPLETE_CLIENT_FOLLOWUP_REQUEST_KEYS = new Set([
  "expected_updated_at",
]);
const FILE_POLICY_BLOCKING_REASON_CODE_SET = new Set(FILE_POLICY_BLOCKING_REASON_CODES);
const REVIEW_QUEUE_STATUS_SET = new Set(KAI_SPRINT2_P0_REVIEW_QUEUE_STATUSES);
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const CANONICAL_ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const metadataMarkerSchema = Object.freeze({
  p0_pass: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.machineCodeMaxLength },
  gate_plan: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.displayLabelMaxLength },
  synthetic_only: { type: "boolean" },
  raw_upload_enabled: { type: "boolean" },
  signed_url_enabled: { type: "boolean" },
  parser_worker_enabled: { type: "boolean" },
  source_promotion_enabled: { type: "boolean" },
  no_raw_object_created: { type: "boolean" },
});

export const KAI_SPRINT2_ROUTE_SCHEMAS = Object.freeze({
  create_intake_batch: Object.freeze({
    organization_id: { type: "uuid" },
    engagement_id: { type: "uuid" },
    batch_code: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.machineCodeMaxLength },
    idempotency_key: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.idempotencyKeyMaxLength },
    intake_method: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.machineCodeMaxLength },
    source_system_name: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.displayLabelMaxLength },
    source_system_ref: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.displayLabelMaxLength },
    notes: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.operatorTextMaxLength },
    batch_metadata: { type: "object", schema: metadataMarkerSchema },
  }),
  reserve_intake_file_metadata: Object.freeze({
    organization_id: { type: "uuid" },
    engagement_id: { type: "uuid" },
    idempotency_key: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.idempotencyKeyMaxLength },
    original_filename: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.originalFilenameMaxLength },
    mime_type: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.mimeTypeMaxLength },
    file_extension: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.machineCodeMaxLength },
    file_size_bytes: { type: "nonnegative_integer" },
    checksum: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.checksumSha256HexLength },
    hash_algorithm: { type: "string", maxLength: KAI_SPRINT2_P0_STRING_LIMITS.machineCodeMaxLength },
    reservation_metadata: { type: "object", schema: metadataMarkerSchema },
  }),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalIsoTimestamp(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string" || !CANONICAL_ISO_TIMESTAMP_RE.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) return null;
  return value;
}

function canonicalCursorUuid(value) {
  if (typeof value !== "string" || value !== value.toLowerCase()) return null;
  return KAI_SPRINT2_P0_PATTERNS.uuid.test(value) ? value : null;
}

function validatedCursorObject(value, cursorKeys, identifierKey) {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== cursorKeys.length) return null;
  if (!cursorKeys.every((key, index) => keys[index] === key)) return null;

  const createdAt = canonicalIsoTimestamp(value.created_at);
  const identifier = canonicalCursorUuid(value[identifierKey]);
  if (!createdAt || !identifier) return null;
  return { created_at: createdAt, [identifierKey]: identifier };
}

function decodeCollectionCursor(token, cursorKeys, identifierKey) {
  if (typeof token !== "string" || !BASE64URL_RE.test(token)) return null;
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.length === 0 || bytes.toString("base64url") !== token) return null;
    return validatedCursorObject(JSON.parse(bytes.toString("utf8")), cursorKeys, identifierKey);
  } catch {
    return null;
  }
}

function decodeIntakeBatchFilesCursor(token) {
  return decodeCollectionCursor(token, INTAKE_BATCH_FILES_CURSOR_KEYS, "intake_file_id");
}

function decodeReviewQueueCursor(token) {
  return decodeCollectionCursor(token, REVIEW_QUEUE_CURSOR_KEYS, "review_queue_item_id");
}

export function validateIntakeBatchFilesPagination(value = {}) {
  if (!isPlainObject(value)) return { ok: false };
  const limit = value.limit ?? INTAKE_BATCH_FILES_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > INTAKE_BATCH_FILES_MAX_LIMIT) {
    return { ok: false };
  }
  if (value.cursor == null) return { ok: true, pagination: { limit, cursor: null } };
  const cursor = validatedCursorObject(
    value.cursor,
    INTAKE_BATCH_FILES_CURSOR_KEYS,
    "intake_file_id",
  );
  return cursor
    ? { ok: true, pagination: { limit, cursor } }
    : { ok: false };
}

export function validateIntakeBatchFilesQuery(query = {}) {
  if (!isPlainObject(query)) return { ok: false };
  if (Object.keys(query).some((key) => !INTAKE_BATCH_FILES_QUERY_KEYS.has(key))) {
    return { ok: false };
  }

  let limit = INTAKE_BATCH_FILES_DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    if (typeof query.limit !== "string" || !/^\d+$/.test(query.limit)) return { ok: false };
    limit = Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > INTAKE_BATCH_FILES_MAX_LIMIT) {
      return { ok: false };
    }
  }

  let cursor = null;
  if (query.cursor !== undefined) {
    cursor = decodeIntakeBatchFilesCursor(query.cursor);
    if (!cursor) return { ok: false };
  }

  return { ok: true, pagination: { limit, cursor } };
}

export function encodeIntakeBatchFilesCursor(value) {
  const cursor = validatedCursorObject(
    value,
    INTAKE_BATCH_FILES_CURSOR_KEYS,
    "intake_file_id",
  );
  if (!cursor) throw new TypeError("Cannot encode an invalid intake-file cursor.");
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function validateReviewQueuePagination(value = {}) {
  if (!isPlainObject(value)) return { ok: false };
  const limit = value.limit ?? REVIEW_QUEUE_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > REVIEW_QUEUE_MAX_LIMIT) {
    return { ok: false };
  }
  if (value.cursor == null) return { ok: true, pagination: { limit, cursor: null } };
  const cursor = validatedCursorObject(
    value.cursor,
    REVIEW_QUEUE_CURSOR_KEYS,
    "review_queue_item_id",
  );
  return cursor
    ? { ok: true, pagination: { limit, cursor } }
    : { ok: false };
}

export function validateReviewQueueQuery(query = {}) {
  if (!isPlainObject(query)) return { ok: false };
  if (Object.keys(query).some((key) => !REVIEW_QUEUE_QUERY_KEYS.has(key))) {
    return { ok: false };
  }

  let limit = REVIEW_QUEUE_DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    if (typeof query.limit !== "string" || !/^\d+$/.test(query.limit)) return { ok: false };
    limit = Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > REVIEW_QUEUE_MAX_LIMIT) {
      return { ok: false };
    }
  }

  let cursor = null;
  if (query.cursor !== undefined) {
    cursor = decodeReviewQueueCursor(query.cursor);
    if (!cursor) return { ok: false };
  }

  return { ok: true, pagination: { limit, cursor } };
}

export function encodeReviewQueueCursor(value) {
  const cursor = validatedCursorObject(
    value,
    REVIEW_QUEUE_CURSOR_KEYS,
    "review_queue_item_id",
  );
  if (!cursor) throw new TypeError("Cannot encode an invalid review-queue cursor.");
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function requestBlocker(blockingReason, objectCode) {
  return {
    validator_key: "VAL-REQ-P0-001",
    severity: "blocker",
    object_type: "request",
    object_code: objectCode || "body",
    object_id: null,
    message: "Request does not match the KAI Sprint 2 route schema.",
    blocking_reason: blockingReason,
    required_fix: "Send only the documented metadata fields with their documented types and limits.",
    evidence: {},
  };
}

function measureStructure(value, depth = 1) {
  if (Array.isArray(value)) {
    let totalKeys = 0;
    let maxDepth = depth;
    for (const item of value) {
      const measured = measureStructure(item, depth + 1);
      totalKeys += measured.totalKeys;
      maxDepth = Math.max(maxDepth, measured.maxDepth);
    }
    return { totalKeys, maxDepth };
  }
  if (!isPlainObject(value)) return { totalKeys: 0, maxDepth: depth };

  let totalKeys = Object.keys(value).length;
  let maxDepth = depth;
  for (const child of Object.values(value)) {
    if (isPlainObject(child) || Array.isArray(child)) {
      const measured = measureStructure(child, depth + 1);
      totalKeys += measured.totalKeys;
      maxDepth = Math.max(maxDepth, measured.maxDepth);
    }
  }
  return { totalKeys, maxDepth };
}

function validateField(value, descriptor, fieldName) {
  if (descriptor.type === "string") {
    if (typeof value !== "string" || value.length < 1 || value.length > descriptor.maxLength) {
      return requestBlocker("invalid_string_field", fieldName);
    }
    return null;
  }
  if (descriptor.type === "uuid") {
    if (typeof value !== "string" || !KAI_SPRINT2_P0_PATTERNS.uuid.test(value)) {
      return requestBlocker("invalid_uuid_field", fieldName);
    }
    return null;
  }
  if (descriptor.type === "boolean") {
    return typeof value === "boolean" ? null : requestBlocker("invalid_boolean_field", fieldName);
  }
  if (descriptor.type === "nonnegative_integer") {
    return Number.isSafeInteger(value) && value >= 0
      ? null
      : requestBlocker("invalid_nonnegative_integer_field", fieldName);
  }
  if (descriptor.type === "object") {
    if (!isPlainObject(value)) return requestBlocker("invalid_nested_object", fieldName);
    return validateObjectAgainstSchema(value, descriptor.schema, fieldName);
  }
  return requestBlocker("unlisted_field_type", fieldName);
}

function validateObjectAgainstSchema(payload, schema, parentName = "body") {
  for (const [fieldName, value] of Object.entries(payload)) {
    const descriptor = schema[fieldName];
    if (!descriptor) return requestBlocker("unknown_field", `${parentName}.${fieldName}`);
    if (Array.isArray(value)) return requestBlocker("array_field_not_allowlisted", `${parentName}.${fieldName}`);
    const blocker = validateField(value, descriptor, `${parentName}.${fieldName}`);
    if (blocker) return blocker;
  }
  return null;
}

export function validateKaiSprint2MutationRequest(operation, payload, options = {}) {
  const schema = KAI_SPRINT2_ROUTE_SCHEMAS[operation];
  if (!schema) {
    return { ok: false, blockers: [requestBlocker("unknown_mutation_operation", "operation")] };
  }
  if (!isPlainObject(payload)) {
    return { ok: false, blockers: [requestBlocker("request_body_must_be_object", "body")] };
  }

  const measured = measureStructure(payload);
  if (measured.maxDepth > KAI_SPRINT2_P0_REQUEST_LIMITS.metadataJsonMaxDepth) {
    return { ok: false, blockers: [requestBlocker("maximum_json_depth_exceeded", "body")] };
  }
  if (measured.totalKeys > KAI_SPRINT2_P0_REQUEST_LIMITS.metadataJsonMaxTotalKeys) {
    return { ok: false, blockers: [requestBlocker("maximum_total_keys_exceeded", "body")] };
  }

  const blocker = validateObjectAgainstSchema(payload, schema);
  if (blocker) return { ok: false, blockers: [blocker] };

  if (options.intakeBatchId != null && !KAI_SPRINT2_P0_PATTERNS.uuid.test(String(options.intakeBatchId))) {
    return { ok: false, blockers: [requestBlocker("invalid_uuid_field", "path.intake_batch_id")] };
  }

  return { ok: true, blockers: [] };
}

export function validateFilePolicyBlockRequest(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, blockers: [requestBlocker("request_body_must_be_object", "body")] };
  }

  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!FILE_POLICY_BLOCK_REQUEST_KEYS.has(key)) {
      return { ok: false, blockers: [requestBlocker("unknown_field", `body.${key}`)] };
    }
    const value = payload[key];
    if (value === null) return { ok: false, blockers: [requestBlocker("null_field_not_allowed", `body.${key}`)] };
    if (Array.isArray(value)) return { ok: false, blockers: [requestBlocker("array_field_not_allowlisted", `body.${key}`)] };
    if (isPlainObject(value)) return { ok: false, blockers: [requestBlocker("nested_object_not_allowed", `body.${key}`)] };
    if (typeof value !== "string") return { ok: false, blockers: [requestBlocker("invalid_string_field", `body.${key}`)] };
  }

  for (const key of FILE_POLICY_BLOCK_REQUEST_KEYS) {
    if (!Object.hasOwn(payload, key)) {
      return { ok: false, blockers: [requestBlocker("required_field_missing", `body.${key}`)] };
    }
  }

  if (payload.expected_file_policy_status !== "pending") {
    return { ok: false, blockers: [requestBlocker("invalid_expected_file_policy_status", "body.expected_file_policy_status")] };
  }

  if (!FILE_POLICY_BLOCKING_REASON_CODE_SET.has(payload.blocking_reason_code)) {
    return { ok: false, blockers: [requestBlocker("invalid_blocking_reason_code", "body.blocking_reason_code")] };
  }

  return { ok: true, blockers: [] };
}

export function validateReviewQueueStatusRequest(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, blockers: [requestBlocker("request_body_must_be_object", "body")] };
  }

  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!REVIEW_QUEUE_STATUS_REQUEST_KEYS.has(key)) {
      return { ok: false, blockers: [requestBlocker("unknown_field", `body.${key}`)] };
    }
    const value = payload[key];
    if (value === null) return { ok: false, blockers: [requestBlocker("null_field_not_allowed", `body.${key}`)] };
    if (Array.isArray(value)) return { ok: false, blockers: [requestBlocker("array_field_not_allowlisted", `body.${key}`)] };
    if (isPlainObject(value)) return { ok: false, blockers: [requestBlocker("nested_object_not_allowed", `body.${key}`)] };
    if (typeof value !== "string") return { ok: false, blockers: [requestBlocker("invalid_string_field", `body.${key}`)] };
    if (!REVIEW_QUEUE_STATUS_SET.has(value)) {
      return { ok: false, blockers: [requestBlocker("invalid_queue_status", `body.${key}`)] };
    }
  }

  for (const key of REVIEW_QUEUE_STATUS_REQUEST_KEYS) {
    if (!Object.hasOwn(payload, key)) {
      return { ok: false, blockers: [requestBlocker("required_field_missing", `body.${key}`)] };
    }
  }

  return { ok: true, blockers: [] };
}

export function validateStartExportReviewRequest(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, blockers: [requestBlocker("request_body_must_be_object", "body")] };
  }

  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!START_EXPORT_REVIEW_REQUEST_KEYS.has(key)) {
      return { ok: false, blockers: [requestBlocker("unknown_field", `body.${key}`)] };
    }
    const value = payload[key];
    if (value === null) return { ok: false, blockers: [requestBlocker("null_field_not_allowed", `body.${key}`)] };
    if (Array.isArray(value)) return { ok: false, blockers: [requestBlocker("array_field_not_allowlisted", `body.${key}`)] };
    if (isPlainObject(value)) return { ok: false, blockers: [requestBlocker("nested_object_not_allowed", `body.${key}`)] };
    if (typeof value !== "string") return { ok: false, blockers: [requestBlocker("invalid_string_field", `body.${key}`)] };
    if (!canonicalIsoTimestamp(value)) {
      return { ok: false, blockers: [requestBlocker("invalid_expected_updated_at", `body.${key}`)] };
    }
  }

  for (const key of START_EXPORT_REVIEW_REQUEST_KEYS) {
    if (!Object.hasOwn(payload, key)) {
      return { ok: false, blockers: [requestBlocker("required_field_missing", `body.${key}`)] };
    }
  }

  return { ok: true, blockers: [] };
}

export function validateCompleteExportReviewRequest(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, blockers: [requestBlocker("request_body_must_be_object", "body")] };
  }

  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!COMPLETE_EXPORT_REVIEW_REQUEST_KEYS.has(key)) {
      return { ok: false, blockers: [requestBlocker("unknown_field", `body.${key}`)] };
    }
    const value = payload[key];
    if (value === null) return { ok: false, blockers: [requestBlocker("null_field_not_allowed", `body.${key}`)] };
    if (Array.isArray(value)) return { ok: false, blockers: [requestBlocker("array_field_not_allowlisted", `body.${key}`)] };
    if (isPlainObject(value)) return { ok: false, blockers: [requestBlocker("nested_object_not_allowed", `body.${key}`)] };
    if (typeof value !== "string") return { ok: false, blockers: [requestBlocker("invalid_string_field", `body.${key}`)] };
    if (!canonicalIsoTimestamp(value)) {
      return { ok: false, blockers: [requestBlocker("invalid_expected_updated_at", `body.${key}`)] };
    }
  }

  for (const key of COMPLETE_EXPORT_REVIEW_REQUEST_KEYS) {
    if (!Object.hasOwn(payload, key)) {
      return { ok: false, blockers: [requestBlocker("required_field_missing", `body.${key}`)] };
    }
  }

  return { ok: true, blockers: [] };
}

function isNonEmptyTrimmedString(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isValidLimitationNotes(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= HUMAN_REVIEW_LIMITATION_NOTES_MAX_COUNT &&
    value.every((entry) => isNonEmptyTrimmedString(entry, HUMAN_REVIEW_LIMITATION_NOTE_MAX_LENGTH))
  );
}

/**
 * P2-12 (Problem A1) human evidence-review decision request. Repairs the
 * superseded P2-09 contract, which accepted no reviewer decision content at
 * all: `expected_updated_at` remains the optimistic-concurrency stamp for the
 * linked `evidence_review` review-queue item; `decision` is now required and
 * must be one of EVIDENCE_REVIEW_DECISION_OUTCOMES; `limitation_notes` is
 * required (a non-empty array of non-empty, length-bounded strings) if and
 * only if decision === 'supported_with_limitation', and forbidden otherwise.
 */
export function validateCompleteEvidenceReviewRequest(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, blockers: [requestBlocker("request_body_must_be_object", "body")] };
  }

  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!COMPLETE_EVIDENCE_REVIEW_REQUEST_KEYS.has(key)) {
      return { ok: false, blockers: [requestBlocker("unknown_field", `body.${key}`)] };
    }
  }

  if (!Object.hasOwn(payload, "expected_updated_at")) {
    return { ok: false, blockers: [requestBlocker("required_field_missing", "body.expected_updated_at")] };
  }
  const expectedUpdatedAt = payload.expected_updated_at;
  if (typeof expectedUpdatedAt !== "string" || !canonicalIsoTimestamp(expectedUpdatedAt)) {
    return { ok: false, blockers: [requestBlocker("invalid_expected_updated_at", "body.expected_updated_at")] };
  }

  if (!Object.hasOwn(payload, "decision")) {
    return { ok: false, blockers: [requestBlocker("required_field_missing", "body.decision")] };
  }
  const decision = payload.decision;
  if (typeof decision !== "string" || !EVIDENCE_REVIEW_DECISION_OUTCOMES.includes(decision)) {
    return { ok: false, blockers: [requestBlocker("invalid_decision", "body.decision")] };
  }

  const limitationNotesRequired = evidenceReviewLimitationNotesRequired(decision);
  const hasLimitationNotes = Object.hasOwn(payload, "limitation_notes");
  if (limitationNotesRequired) {
    if (!hasLimitationNotes) {
      return { ok: false, blockers: [requestBlocker("required_field_missing", "body.limitation_notes")] };
    }
    if (!isValidLimitationNotes(payload.limitation_notes)) {
      return { ok: false, blockers: [requestBlocker("invalid_limitation_notes", "body.limitation_notes")] };
    }
  } else if (hasLimitationNotes) {
    return { ok: false, blockers: [requestBlocker("unexpected_limitation_notes", "body.limitation_notes")] };
  }

  return { ok: true, blockers: [] };
}

/**
 * P2-12 (Problem A1) human claim-review decision request. Mirrors
 * validateCompleteEvidenceReviewRequest, extended with `approved_audiences`:
 * required (a non-empty array of unique values from
 * CLAIM_REVIEW_APPROVED_AUDIENCE_VALUES) if and only if decision is
 * 'approved'/'approved_with_limitation', and forbidden otherwise.
 * `limitation_notes` is required iff decision === 'approved_with_limitation'.
 */
export function validateCompleteClaimReviewRequest(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, blockers: [requestBlocker("request_body_must_be_object", "body")] };
  }

  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!COMPLETE_CLAIM_REVIEW_REQUEST_KEYS.has(key)) {
      return { ok: false, blockers: [requestBlocker("unknown_field", `body.${key}`)] };
    }
  }

  if (!Object.hasOwn(payload, "expected_updated_at")) {
    return { ok: false, blockers: [requestBlocker("required_field_missing", "body.expected_updated_at")] };
  }
  const expectedUpdatedAt = payload.expected_updated_at;
  if (typeof expectedUpdatedAt !== "string" || !canonicalIsoTimestamp(expectedUpdatedAt)) {
    return { ok: false, blockers: [requestBlocker("invalid_expected_updated_at", "body.expected_updated_at")] };
  }

  if (!Object.hasOwn(payload, "decision")) {
    return { ok: false, blockers: [requestBlocker("required_field_missing", "body.decision")] };
  }
  const decision = payload.decision;
  if (typeof decision !== "string" || !CLAIM_REVIEW_DECISION_OUTCOMES.includes(decision)) {
    return { ok: false, blockers: [requestBlocker("invalid_decision", "body.decision")] };
  }

  const limitationNotesRequired = claimReviewLimitationNotesRequired(decision);
  const hasLimitationNotes = Object.hasOwn(payload, "limitation_notes");
  if (limitationNotesRequired) {
    if (!hasLimitationNotes) {
      return { ok: false, blockers: [requestBlocker("required_field_missing", "body.limitation_notes")] };
    }
    if (!isValidLimitationNotes(payload.limitation_notes)) {
      return { ok: false, blockers: [requestBlocker("invalid_limitation_notes", "body.limitation_notes")] };
    }
  } else if (hasLimitationNotes) {
    return { ok: false, blockers: [requestBlocker("unexpected_limitation_notes", "body.limitation_notes")] };
  }

  const audiencesRequired = claimReviewApprovedAudiencesRequired(decision);
  const hasAudiences = Object.hasOwn(payload, "approved_audiences");
  if (audiencesRequired) {
    if (!hasAudiences) {
      return { ok: false, blockers: [requestBlocker("required_field_missing", "body.approved_audiences")] };
    }
    const audiences = payload.approved_audiences;
    const isValidAudienceArray =
      Array.isArray(audiences) &&
      audiences.length > 0 &&
      audiences.every((entry) => typeof entry === "string" && CLAIM_REVIEW_APPROVED_AUDIENCE_VALUES.includes(entry)) &&
      new Set(audiences).size === audiences.length;
    if (!isValidAudienceArray) {
      return { ok: false, blockers: [requestBlocker("invalid_approved_audiences", "body.approved_audiences")] };
    }
  } else if (hasAudiences) {
    return { ok: false, blockers: [requestBlocker("unexpected_approved_audiences", "body.approved_audiences")] };
  }

  return { ok: true, blockers: [] };
}

/**
 * P2-11 client-followup-completion request. Mirrors
 * validateCompleteClaimReviewRequest exactly: the request carries no client-
 * supplied answer, free-text, or disposition vocabulary at all - completing
 * this workflow has exactly one accepted outcome ("no additional client
 * information"), so `expected_updated_at` (the optimistic-concurrency stamp
 * for the linked `client_followup` review-queue item) is the only field this
 * route accepts.
 */
export function validateCompleteClientFollowupRequest(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, blockers: [requestBlocker("request_body_must_be_object", "body")] };
  }

  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!COMPLETE_CLIENT_FOLLOWUP_REQUEST_KEYS.has(key)) {
      return { ok: false, blockers: [requestBlocker("unknown_field", `body.${key}`)] };
    }
    const value = payload[key];
    if (value === null) return { ok: false, blockers: [requestBlocker("null_field_not_allowed", `body.${key}`)] };
    if (Array.isArray(value)) return { ok: false, blockers: [requestBlocker("array_field_not_allowlisted", `body.${key}`)] };
    if (isPlainObject(value)) return { ok: false, blockers: [requestBlocker("nested_object_not_allowed", `body.${key}`)] };
    if (typeof value !== "string") return { ok: false, blockers: [requestBlocker("invalid_string_field", `body.${key}`)] };
    if (!canonicalIsoTimestamp(value)) {
      return { ok: false, blockers: [requestBlocker("invalid_expected_updated_at", `body.${key}`)] };
    }
  }

  for (const key of COMPLETE_CLIENT_FOLLOWUP_REQUEST_KEYS) {
    if (!Object.hasOwn(payload, key)) {
      return { ok: false, blockers: [requestBlocker("required_field_missing", `body.${key}`)] };
    }
  }

  return { ok: true, blockers: [] };
}

/**
 * KAI B1A-2 Phase-5 sensitivity/allowed-use decision request.
 *
 * `expected_updated_at` is the optimistic-concurrency stamp for the linked P1-06
 * 'sensitivity_review' review-queue item (the same OCC discipline P2-12 uses).
 * `review_queue_item_id` binds the decision to that exact queue item; the server
 * independently re-verifies, inside the decision transaction, that the item is a
 * 'sensitivity_review' item targeting this exact sensitivity profile.
 * `decision` must be one of SENSITIVITY_ALLOWED_USE_DECISION_OUTCOMES.
 * `reviewed_snapshot` is required (a complete, exact-keyed Phase-5 snapshot) if
 * and only if decision === 'reviewed', and forbidden otherwise - so a
 * needs_more_information request is structurally incapable of carrying a
 * permission.
 *
 * Reviewer identity, reviewer role, and organization are deliberately NOT accepted
 * here: the route derives the tenant from its own scope and the actor from the
 * authenticated actor context.
 */
export function validateSensitivityProfileDecisionRequest(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, blockers: [requestBlocker("request_body_must_be_object", "body")] };
  }

  for (const key of Object.keys(payload)) {
    if (!SENSITIVITY_PROFILE_DECISION_REQUEST_KEYS.has(key)) {
      return { ok: false, blockers: [requestBlocker("unknown_field", `body.${key}`)] };
    }
  }

  if (!Object.hasOwn(payload, "expected_updated_at")) {
    return { ok: false, blockers: [requestBlocker("required_field_missing", "body.expected_updated_at")] };
  }
  if (typeof payload.expected_updated_at !== "string" || !canonicalIsoTimestamp(payload.expected_updated_at)) {
    return { ok: false, blockers: [requestBlocker("invalid_expected_updated_at", "body.expected_updated_at")] };
  }

  if (!Object.hasOwn(payload, "review_queue_item_id")) {
    return { ok: false, blockers: [requestBlocker("required_field_missing", "body.review_queue_item_id")] };
  }
  const reviewQueueItemId = payload.review_queue_item_id;
  if (
    typeof reviewQueueItemId !== "string"
    || !KAI_SPRINT2_P0_PATTERNS.uuid.test(reviewQueueItemId)
    || reviewQueueItemId !== reviewQueueItemId.toLowerCase()
  ) {
    return { ok: false, blockers: [requestBlocker("invalid_uuid_field", "body.review_queue_item_id")] };
  }

  if (!Object.hasOwn(payload, "decision")) {
    return { ok: false, blockers: [requestBlocker("required_field_missing", "body.decision")] };
  }
  const decision = payload.decision;
  if (typeof decision !== "string" || !SENSITIVITY_ALLOWED_USE_DECISION_OUTCOMES.includes(decision)) {
    return { ok: false, blockers: [requestBlocker("invalid_decision", "body.decision")] };
  }

  const snapshotRequired = sensitivityReviewedSnapshotRequired(decision);
  const hasSnapshot = Object.hasOwn(payload, "reviewed_snapshot");
  if (!snapshotRequired) {
    if (hasSnapshot) {
      return { ok: false, blockers: [requestBlocker("unexpected_reviewed_snapshot", "body.reviewed_snapshot")] };
    }
    return { ok: true, blockers: [] };
  }
  if (!hasSnapshot) {
    return { ok: false, blockers: [requestBlocker("required_field_missing", "body.reviewed_snapshot")] };
  }
  if (!isPlainObject(payload.reviewed_snapshot)) {
    return { ok: false, blockers: [requestBlocker("invalid_reviewed_snapshot", "body.reviewed_snapshot")] };
  }
  const snapshotValidation = validateSensitivityReviewedSnapshot(payload.reviewed_snapshot);
  if (!snapshotValidation.ok) {
    return { ok: false, blockers: [requestBlocker(snapshotValidation.reason, "body.reviewed_snapshot")] };
  }

  return { ok: true, blockers: [] };
}

export const __testables = {
  canonicalIsoTimestamp,
  decodeIntakeBatchFilesCursor,
  decodeReviewQueueCursor,
  measureStructure,
  validatedCursorObject(value) {
    return validatedCursorObject(value, INTAKE_BATCH_FILES_CURSOR_KEYS, "intake_file_id");
  },
};
