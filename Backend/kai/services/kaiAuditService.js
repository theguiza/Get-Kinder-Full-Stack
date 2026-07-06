import { insertBlockedAttemptAuditEvent, sanitizeAuditMetadataForStorage } from "../db/kaiAuditQueries.js";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";

const ALLOWED_METADATA_KEYS = new Set([
  "p0_pass",
  "operation",
  "validator_key",
  "blocker_code",
  "blocker_codes",
  "object_type",
  "target_object_type",
  "object_id",
  "blocked",
  "organization_id",
  "engagement_id",
  "intake_batch_id",
  "intake_file_id",
  "actor_type",
  "actor_user_id",
  "request_id",
  "route",
  "http_status",
  "safe_message",
  "contains_raw_file_content",
  "contains_raw_parsed_rows",
  "contains_client_pii",
  "contains_prompt_text",
  "contains_unsafe_generated_text",
  "contains_signed_urls",
  "contains_storage_credentials",
  "created_by_service",
  "metadata_only",
]);

export function sanitizeBlockedAttemptMetadata(metadata = {}) {
  const sanitized = {};
  for (const key of ALLOWED_METADATA_KEYS) {
    if (Object.hasOwn(metadata, key)) sanitized[key] = metadata[key];
  }
  sanitized.contains_raw_file_content = false;
  sanitized.contains_raw_parsed_rows = false;
  sanitized.contains_client_pii = false;
  sanitized.contains_prompt_text = false;
  sanitized.contains_unsafe_generated_text = false;
  sanitized.contains_signed_urls = false;
  sanitized.contains_storage_credentials = false;
  return sanitizeAuditMetadataForStorage(sanitized);
}

export async function recordBlockedAttempt({ actorContext, operation, blockers = [], metadata = {}, dependencies = {} }) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return { ok: false, skipped: true, reason: "feature_disabled" };
  }

  const firstBlocker = blockers[0] || {};
  const safeMetadata = sanitizeBlockedAttemptMetadata({
    ...metadata,
    p0_pass: metadata.p0_pass || "pass2_admin_metadata_intake_verification",
    operation,
    validator_key: firstBlocker.validator_key || null,
    blocker_code: firstBlocker.blocking_reason || null,
    blocker_codes: blockers.map((blocker) => blocker.blocking_reason || blocker.validator_key).filter(Boolean),
    object_type: "other",
    target_object_type: metadata.target_object_type || firstBlocker.object_type || null,
    blocked: true,
    object_id: firstBlocker.object_id || null,
    actor_type: actorContext?.actorType || "system",
    actor_user_id: actorContext?.actorUserId || null,
    http_status: 422,
    safe_message: firstBlocker.message || "KAI validator blocked the operation.",
    created_by_service: metadata.created_by_service || "kaiIntakeService",
    metadata_only: true,
  });

  const insertAudit = dependencies.insertBlockedAttemptAuditEvent || insertBlockedAttemptAuditEvent;
  return insertAudit(safeMetadata);
}
