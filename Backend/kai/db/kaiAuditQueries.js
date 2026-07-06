import pool from "./kaiDb.js";

const REQUIRED_AUDIT_INSERT_COLUMNS = [
  "organization_id",
  "actor_user_id",
  "actor_type",
  "action",
  "metadata",
  "object_type",
  "reason_code",
  "reason_text",
];

const AUDIT_COLUMNS_TO_LOOKUP = [
  "audit_event_id",
  ...REQUIRED_AUDIT_INSERT_COLUMNS,
  "created_at",
];

const SAFE_AUDIT_METADATA_KEYS = new Set([
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

const FORCED_FALSE_METADATA_FLAGS = [
  "contains_raw_file_content",
  "contains_raw_parsed_rows",
  "contains_client_pii",
  "contains_prompt_text",
  "contains_unsafe_generated_text",
  "contains_signed_urls",
  "contains_storage_credentials",
];

const SENSITIVE_TEXT_PATTERN = /(?:BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY|X-Goog-Signature|X-Amz-Signature|X-Goog-Credential|AWSAccessKeyId|storage_credentials?|signed_?urls?|prompt_text|raw_file|raw_parsed|client_pii|unsafe_generated|password|secret|token=)/i;
const SAFE_IDENTIFIER_PATTERN = /^[a-z0-9_:-]{1,96}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeIdentifier(value, fallback = null) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return SAFE_IDENTIFIER_PATTERN.test(normalized) ? normalized : fallback;
}

function normalizeUuid(value) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" && UUID_PATTERN.test(value.trim()) ? value.trim() : null;
}

function normalizeSafeText(value, fallback = null, maxLength = 240) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return fallback;
  const normalized = String(value).trim();
  if (!normalized || SENSITIVE_TEXT_PATTERN.test(normalized)) return fallback;
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function normalizeRoute(value) {
  if (typeof value !== "string") return null;
  const route = value.trim();
  if (!route.startsWith("/") || route.includes("?") || route.includes("://") || SENSITIVE_TEXT_PATTERN.test(route)) {
    return null;
  }
  return route.length > 256 ? route.slice(0, 256) : route;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .map((item) => normalizeIdentifier(item))
    .filter(Boolean);
  return normalized.length > 0 ? normalized : null;
}

function normalizeAuditMetadataValue(key, value) {
  if (key.endsWith("_id")) return normalizeUuid(value);
  if (["operation", "validator_key", "blocker_code", "object_type", "target_object_type", "actor_type", "created_by_service", "p0_pass"].includes(key)) {
    return normalizeIdentifier(value);
  }
  if (key === "blocker_codes") return normalizeStringArray(value);
  if (key === "blocked" || key === "metadata_only") return value === true;
  if (key === "http_status") {
    const status = Number(value);
    return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  }
  if (key === "route") return normalizeRoute(value);
  if (key === "safe_message") return normalizeSafeText(value, "KAI validator blocked the operation.");
  if (FORCED_FALSE_METADATA_FLAGS.includes(key)) return false;
  return normalizeSafeText(value, null, 128);
}

export function sanitizeAuditMetadataForStorage(metadata = {}) {
  const sanitized = {};
  for (const key of SAFE_AUDIT_METADATA_KEYS) {
    if (!Object.hasOwn(metadata, key)) continue;
    const value = normalizeAuditMetadataValue(key, metadata[key]);
    if (value !== null && value !== undefined) sanitized[key] = value;
  }
  for (const key of FORCED_FALSE_METADATA_FLAGS) {
    sanitized[key] = false;
  }
  return sanitized;
}

export function buildBlockedAttemptAuditEventRecord(metadata = {}, objectType) {
  const conceptualMetadata = {
    ...(metadata.eventMetadata && typeof metadata.eventMetadata === "object" && !Array.isArray(metadata.eventMetadata)
      ? metadata.eventMetadata
      : {}),
    ...metadata,
  };
  delete conceptualMetadata.eventType;
  delete conceptualMetadata.eventMetadata;

  const action = normalizeIdentifier(
    metadata.eventType || metadata.action,
    "validator_blocked_attempt",
  );
  const sanitizedMetadata = sanitizeAuditMetadataForStorage(conceptualMetadata);
  const reasonCode = normalizeIdentifier(
    sanitizedMetadata.blocker_code || sanitizedMetadata.validator_key,
    "validation_blocker",
  );
  const reasonText = normalizeSafeText(
    sanitizedMetadata.safe_message,
    "KAI validator blocked the operation.",
    500,
  );

  return {
    organization_id: sanitizedMetadata.organization_id || null,
    actor_user_id: sanitizedMetadata.actor_user_id || null,
    actor_type: sanitizedMetadata.actor_type || "system",
    action,
    metadata: sanitizedMetadata,
    object_type: objectType,
    reason_code: reasonCode,
    reason_text: reasonText,
  };
}

function resolveAuditObjectType(metadata = {}, enumLabels = []) {
  const labels = new Set(enumLabels);
  if (metadata.target_object_type === "intake_batch" || metadata.target_object_type === "intake_file") {
    return labels.has("other") ? "other" : null;
  }
  if (metadata.object_type === "intake_batch" || metadata.object_type === "intake_file") {
    return labels.has("other") ? "other" : null;
  }
  if (labels.has(metadata.object_type)) return metadata.object_type;
  return labels.has("other") ? "other" : null;
}

export async function getAuditEventColumnNames(db = pool) {
  const { rows } = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'kai'
        AND table_name = 'audit_events'
        AND column_name = ANY($1::text[])
      ORDER BY column_name`,
    [AUDIT_COLUMNS_TO_LOOKUP],
  );
  return rows.map((row) => row.column_name);
}

export async function getAuditObjectTypeEnumLabels(db = pool) {
  const { rows } = await db.query(
    `SELECT e.enumlabel
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname = 'kai'
        AND t.typname = 'object_type_enum'
      ORDER BY e.enumsortorder`,
  );
  return rows.map((row) => row.enumlabel);
}

export async function insertBlockedAttemptAuditEvent(metadata, db = pool) {
  const columns = await getAuditEventColumnNames(db);
  const available = new Set(columns);
  for (const column of REQUIRED_AUDIT_INSERT_COLUMNS) {
    if (!available.has(column)) {
      return { ok: false, skipped: true, reason: "audit_insert_shape_unavailable" };
    }
  }

  const enumLabels = await getAuditObjectTypeEnumLabels(db);
  const objectType = resolveAuditObjectType(metadata, enumLabels);
  if (!objectType) {
    return { ok: false, skipped: true, reason: "audit_object_type_enum_unavailable" };
  }

  const record = buildBlockedAttemptAuditEventRecord(metadata, objectType);
  const returningClause = available.has("audit_event_id") ? " RETURNING audit_event_id" : "";
  const { rows } = await db.query(
    `INSERT INTO kai.audit_events (
       organization_id,
       actor_user_id,
       actor_type,
       action,
       metadata,
       object_type,
       reason_code,
       reason_text
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)${returningClause}`,
    [
      record.organization_id,
      record.actor_user_id,
      record.actor_type,
      record.action,
      JSON.stringify(record.metadata),
      record.object_type,
      record.reason_code,
      record.reason_text,
    ],
  );

  return { ok: true, auditEventId: rows[0]?.audit_event_id || null };
}
