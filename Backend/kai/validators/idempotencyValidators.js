import { blockerResult, passResult } from "./types.js";

const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;
const CHECKSUM_PATTERN = /^(?:sha256:)?[a-fA-F0-9]{64}$/;

function hasValue(value) {
  return value != null && String(value).trim() !== "";
}

function getPayloadValue(context = {}, camelName, snakeName) {
  return context[camelName] || context[snakeName] || context.payload?.[camelName] || context.payload?.[snakeName] || null;
}

export function getIdempotencyKey(context = {}) {
  return getPayloadValue(context, "idempotencyKey", "idempotency_key");
}

export function getProvidedChecksum(context = {}) {
  return getPayloadValue(context, "checksum", "checksum");
}

export function idempotency_key_required(context = {}) {
  const idempotencyKey = getIdempotencyKey(context);
  if (!hasValue(idempotencyKey)) {
    return blockerResult("VAL-IDEMP-001", "idempotency_key is required for metadata write contracts.", {
      object_type: "intake_metadata_write",
      object_code: "idempotency_key",
      blocking_reason: "missing_idempotency_key",
      required_fix: "Provide a stable idempotency key from the caller.",
      evidence: { idempotency_key_present: false },
    });
  }

  return passResult("VAL-IDEMP-001", "idempotency_key is present.", { idempotency_key_present: true });
}

export function idempotency_key_format_supported(context = {}) {
  const idempotencyKey = getIdempotencyKey(context);
  if (!hasValue(idempotencyKey) || !IDEMPOTENCY_KEY_PATTERN.test(String(idempotencyKey))) {
    return blockerResult("VAL-IDEMP-002", "idempotency_key format is not supported.", {
      object_type: "intake_metadata_write",
      object_code: "idempotency_key",
      blocking_reason: "invalid_idempotency_key",
      required_fix: "Use 8 to 128 characters from letters, numbers, dot, underscore, colon, or hyphen.",
    });
  }

  return passResult("VAL-IDEMP-002", "idempotency_key format is supported.");
}

export function checksum_required(context = {}) {
  const checksum = getProvidedChecksum(context);
  if (!hasValue(checksum)) {
    return blockerResult("VAL-IDEMP-003", "checksum is required for file metadata contracts.", {
      object_type: "intake_file_metadata",
      object_code: "checksum",
      blocking_reason: "missing_checksum",
      required_fix: "Provide a caller-supplied metadata checksum value.",
      evidence: { checksum_present: false },
    });
  }

  return passResult("VAL-IDEMP-003", "checksum is present.", { checksum_present: true });
}

export function checksum_format_supported(context = {}) {
  const checksum = getProvidedChecksum(context);
  if (!hasValue(checksum) || !CHECKSUM_PATTERN.test(String(checksum))) {
    return blockerResult("VAL-IDEMP-004", "checksum format is not supported.", {
      object_type: "intake_file_metadata",
      object_code: "checksum",
      blocking_reason: "invalid_checksum",
      required_fix: "Provide a sha256 metadata checksum as 64 hex characters, optionally prefixed by sha256:.",
    });
  }

  return passResult("VAL-IDEMP-004", "checksum format is supported.");
}

export function idempotent_replay_checksum_matches(context = {}) {
  const checksum = getProvidedChecksum(context);
  const existingChecksum = getPayloadValue(context, "existingChecksum", "existing_checksum");
  if (hasValue(existingChecksum) && hasValue(checksum) && String(existingChecksum) !== String(checksum)) {
    return blockerResult("VAL-IDEMP-005", "Idempotency key conflicts with a different checksum.", {
      object_type: "intake_file_metadata",
      object_code: "checksum",
      blocking_reason: "idempotency_checksum_conflict",
      required_fix: "Reuse an idempotency key only with the same metadata checksum.",
    });
  }

  return passResult("VAL-IDEMP-005", "Idempotency checksum replay is consistent.");
}

export function duplicate_checksum_blocked(context = {}) {
  const checksum = getProvidedChecksum(context);
  const duplicateChecksums = context.duplicateChecksums || context.duplicate_checksums || context.payload?.duplicate_checksums || [];
  if (hasValue(checksum) && Array.isArray(duplicateChecksums) && duplicateChecksums.includes(checksum)) {
    return blockerResult("VAL-IDEMP-006", "Duplicate file metadata checksum is blocked.", {
      object_type: "intake_file_metadata",
      object_code: "checksum",
      blocking_reason: "duplicate_checksum",
      required_fix: "Use an existing intake file reference or provide unique file metadata.",
    });
  }

  return passResult("VAL-IDEMP-006", "Duplicate checksum was not detected from supplied metadata.");
}

export const idempotencyValidatorGroups = Object.freeze({
  metadata_batch_write: Object.freeze([
    idempotency_key_required,
    idempotency_key_format_supported,
  ]),
  metadata_file_write: Object.freeze([
    idempotency_key_required,
    idempotency_key_format_supported,
    checksum_required,
    checksum_format_supported,
    idempotent_replay_checksum_matches,
    duplicate_checksum_blocked,
  ]),
});
