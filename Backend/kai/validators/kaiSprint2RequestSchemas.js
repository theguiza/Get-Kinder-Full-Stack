import {
  KAI_SPRINT2_P0_PATTERNS,
  KAI_SPRINT2_P0_REQUEST_LIMITS,
  KAI_SPRINT2_P0_STRING_LIMITS,
} from "../config/kaiSprint2P0Contract.js";

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

export const __testables = {
  measureStructure,
};
