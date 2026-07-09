import { blockerResult, passResult } from "./types.js";

export const BLOCKED_ATTEMPT_AUDIT_METADATA_ALLOWLIST = Object.freeze([
  "attempted_operation",
  "actor_type",
  "blocked_reason_code",
  "contract",
  "file_policy_status",
  "object_type",
  "request_scope",
  "route_contract",
  "sprint_phase",
  "storage_provider",
  "storage_region_classification",
  "storage_residency_classification",
  "validator_key",
]);

const ALLOWED_AUDIT_METADATA_KEYS = new Set(BLOCKED_ATTEMPT_AUDIT_METADATA_ALLOWLIST);

const SENSITIVE_KEY_PATTERNS = Object.freeze([
  /raw.*file.*content/i,
  /raw.*parsed.*rows/i,
  /parsed.*rows/i,
  /^rows$/i,
  /^records$/i,
  /client.*(?:name|email|phone|address|pii)/i,
  /prompt/i,
  /generated.*(?:text|content|output)/i,
  /signed.*url/i,
  /storage.*credential/i,
  /credential/i,
  /secret/i,
  /token/i,
  /^storage_uri$/i,
  /storage.*(?:path|key|object)/i,
  /file.*(?:path|key)/i,
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function auditBlocker({ key, blocking_reason, message }) {
  return blockerResult("VAL-AUD-001", message, {
    object_type: "audit_payload",
    object_code: key || "payload",
    blocking_reason,
    required_fix: "Provide metadata-only blocked-attempt audit fields from the Pass 1E allowlist.",
  });
}

function classifyRejectedKey(key) {
  if (!key) return "audit_payload_not_object";
  if (key === "storage_uri") return "full_private_storage_uri_rejected_by_default";
  if (/signed.*url/i.test(key)) return "signed_urls_rejected";
  if (/credential|secret|token/i.test(key)) return "storage_credentials_rejected";
  if (/prompt/i.test(key)) return "prompt_text_rejected";
  if (/generated.*(?:text|content|output)/i.test(key)) return "unsafe_generated_text_rejected";
  if (/raw.*file.*content/i.test(key)) return "raw_file_content_rejected";
  if (/raw.*parsed.*rows|parsed.*rows|^rows$|^records$/i.test(key)) return "raw_parsed_rows_rejected";
  if (/client.*(?:name|email|phone|address|pii)/i.test(key)) return "client_pii_rejected";
  if (/storage.*(?:path|key|object)|file.*(?:path|key)/i.test(key)) return "unsafe_private_storage_layout_rejected";
  return "audit_payload_key_not_allowed";
}

function hasUnsafeStringValue(value) {
  if (typeof value !== "string") return false;
  return (
    /^https?:\/\/\S+/i.test(value) ||
    /^[a-z][a-z0-9+.-]*:\/\/\S+/i.test(value) ||
    value.includes("/") ||
    value.includes("\\") ||
    /(?:BEGIN|PRIVATE KEY|SECRET|TOKEN|CREDENTIAL)/i.test(value)
  );
}

export function sanitizeBlockedAttemptAuditMetadata(payload = {}) {
  if (!isPlainObject(payload)) {
    return {
      ok: false,
      sanitized: null,
      blockers: [
        auditBlocker({
          blocking_reason: "audit_payload_not_object",
          message: "Blocked-attempt audit payload must be a metadata object.",
        }),
      ],
    };
  }

  const sanitized = {};
  const blockers = [];

  for (const [key, value] of Object.entries(payload)) {
    const sensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
    if (!ALLOWED_AUDIT_METADATA_KEYS.has(key) || sensitiveKey) {
      blockers.push(
        auditBlocker({
          key,
          blocking_reason: classifyRejectedKey(key),
          message: "Blocked-attempt audit payload contains a disallowed metadata key.",
        }),
      );
      continue;
    }

    if (isPlainObject(value) || Array.isArray(value) || hasUnsafeStringValue(value)) {
      blockers.push(
        auditBlocker({
          key,
          blocking_reason: "audit_payload_value_not_metadata_safe",
          message: "Blocked-attempt audit payload contains a non-metadata-safe value.",
        }),
      );
      continue;
    }

    sanitized[key] = value;
  }

  return {
    ok: blockers.length === 0,
    sanitized: blockers.length === 0 ? sanitized : null,
    blockers,
  };
}

export function validateBlockedAttemptAuditPayload({ payload } = {}) {
  const result = sanitizeBlockedAttemptAuditMetadata(payload);
  if (!result.ok) return result.blockers[0];

  return passResult("VAL-AUD-001", "Blocked-attempt audit payload is metadata-only.", {
    allowed_keys: Object.keys(result.sanitized),
  });
}
