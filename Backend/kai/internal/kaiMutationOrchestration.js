/**
 * Repository-neutral mutation orchestration core.
 *
 * This module has no production composition root yet. Repository structure and
 * the orchestration boundary test restrict imports to explicit test support;
 * JavaScript cannot make a direct file import technically impossible.
 */

export const REQUIRED_AUDIT_METADATA_ALLOWLIST = Object.freeze([
  "operation",
  "actor_user_id",
  "actor_type",
  "organization_id",
  "engagement_id",
  "object_type",
  "target_object_type",
  "object_id",
  "reason_code",
  "validator_key",
  "validator_keys",
  "blocking_reason_code",
  "request_id",
  "route",
  "from_state",
  "to_state",
  "prior_status",
  "new_status",
  "created_at",
  "duration_ms",
  "byte_count",
  "checksum_verification_outcome",
  "immutable_version_outcome",
]);

export const BEST_EFFORT_METRIC_METADATA_ALLOWLIST = Object.freeze([
  "metric_name",
  "operation",
  "actor_type",
  "object_type",
  "outcome",
  "reason_code",
  "from_state",
  "to_state",
  "duration_ms",
  "byte_count",
  "checksum_verification_outcome",
  "immutable_version_outcome",
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METADATA_CODE_PATTERN = /^[a-z][a-z0-9_.:-]{0,95}$/i;
const OPAQUE_REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/i;
const KAI_ROUTE_PATTERN = /^\/api\/kai(?:\/[a-z0-9_.:-]+)*$/i;
const CANONICAL_ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const FIELD_NORMALIZERS = Object.freeze({
  operation: normalizeCode,
  actor_user_id: normalizeUuid,
  actor_type: normalizeCode,
  organization_id: normalizeUuid,
  engagement_id: normalizeUuid,
  object_type: normalizeCode,
  target_object_type: normalizeCode,
  object_id: normalizeUuid,
  reason_code: normalizeCode,
  validator_key: normalizeCode,
  validator_keys: normalizeCodeArray,
  blocking_reason_code: normalizeCode,
  request_id: normalizeRequestId,
  route: normalizeRoute,
  from_state: normalizeCode,
  to_state: normalizeCode,
  prior_status: normalizeCode,
  new_status: normalizeCode,
  created_at: normalizeTimestamp,
  duration_ms: normalizeNonNegativeInteger,
  byte_count: normalizeNonNegativeInteger,
  checksum_verification_outcome: normalizeCode,
  immutable_version_outcome: normalizeCode,
  metric_name: normalizeCode,
  outcome: normalizeCode,
});

export class RequiredAuditPersistenceError extends Error {
  constructor() {
    super("Required audit persistence did not confirm success.");
    this.name = "RequiredAuditPersistenceError";
    this.code = "required_audit_failed";
  }
}

function normalizeCode(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return METADATA_CODE_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeUuid(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeRequestId(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return OPAQUE_REQUEST_ID_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeTimestamp(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value !== "string" || !CANONICAL_ISO_TIMESTAMP_RE.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value ? undefined : value;
}

function normalizeCodeArray(value) {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.map(normalizeCode).filter(Boolean);
  return normalized.length === value.length && normalized.length > 0
    ? Object.freeze(normalized)
    : undefined;
}

function normalizeRoute(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return KAI_ROUTE_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function sanitizeMetadata(metadata, allowlist) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return Object.freeze({});

  const sanitized = {};
  for (const key of allowlist) {
    if (!Object.hasOwn(metadata, key)) continue;
    const value = FIELD_NORMALIZERS[key](metadata[key]);
    if (value !== undefined) sanitized[key] = value;
  }
  return Object.freeze(sanitized);
}

export function sanitizeRequiredAuditMetadata(metadata = {}) {
  return sanitizeMetadata(metadata, REQUIRED_AUDIT_METADATA_ALLOWLIST);
}

export function sanitizeBestEffortMetricMetadata(metadata = {}) {
  return sanitizeMetadata(metadata, BEST_EFFORT_METRIC_METADATA_ALLOWLIST);
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be an injected function.`);
  }
  return value;
}

function didRequiredAuditSucceed(auditResult) {
  const okDescriptor =
    auditResult !== null && typeof auditResult === "object"
      ? Object.getOwnPropertyDescriptor(auditResult, "ok")
      : undefined;

  return (
    !Array.isArray(auditResult) &&
    okDescriptor !== undefined &&
    Object.hasOwn(okDescriptor, "value") &&
    okDescriptor.value === true
  );
}

/**
 * Persist one repository-neutral mutation and its required audit atomically,
 * then emit optional best-effort metrics after transaction completion.
 *
 * Only explicit test support currently constructs these injected dependencies.
 * A later authorized production package must supply a composition root before
 * this core can be used by a live path.
 */
export async function orchestrateMutationWithRequiredAudit(
  input = {},
  dependencies = {},
  runInTransaction,
) {
  const persistMutation = requireFunction(dependencies.persistMutation, "persistMutation");
  const persistRequiredAudit = requireFunction(dependencies.persistRequiredAudit, "persistRequiredAudit");
  const executeTransaction = requireFunction(runInTransaction, "runInTransaction");
  const emitBestEffortMetric = typeof dependencies.emitBestEffortMetric === "function"
    ? dependencies.emitBestEffortMetric
    : null;
  const requiredAuditMetadata = sanitizeRequiredAuditMetadata(input.requiredAuditMetadata);
  const bestEffortMetricMetadata = sanitizeBestEffortMetricMetadata(input.bestEffortMetricMetadata);

  const mutationResult = await executeTransaction(async (transactionContext) => {
    const result = await persistMutation(input.mutation, transactionContext);
    const auditResult = await persistRequiredAudit(requiredAuditMetadata, transactionContext);
    if (!didRequiredAuditSucceed(auditResult)) throw new RequiredAuditPersistenceError();
    return result;
  });

  if (emitBestEffortMetric) {
    try {
      await emitBestEffortMetric(bestEffortMetricMetadata);
    } catch {
      // Metrics are deliberately best-effort and cannot alter a committed result.
    }
  }

  return mutationResult;
}
