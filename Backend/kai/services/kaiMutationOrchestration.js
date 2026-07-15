import { withTransaction } from "../db/kaiDb.js";

export const REQUIRED_AUDIT_METADATA_ALLOWLIST = Object.freeze([
  "operation",
  "actor_type",
  "organization_id",
  "engagement_id",
  "object_type",
  "object_id",
  "reason_code",
  "validator_key",
  "request_id",
  "route",
  "from_state",
  "to_state",
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

const FIELD_NORMALIZERS = Object.freeze({
  operation: normalizeCode,
  actor_type: normalizeCode,
  organization_id: normalizeUuid,
  engagement_id: normalizeUuid,
  object_type: normalizeCode,
  object_id: normalizeUuid,
  reason_code: normalizeCode,
  validator_key: normalizeCode,
  request_id: normalizeRequestId,
  route: normalizeRoute,
  from_state: normalizeCode,
  to_state: normalizeCode,
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

function requirePersistenceDependency(dependencies, name) {
  if (typeof dependencies[name] !== "function") {
    throw new TypeError(`${name} must be an injected function.`);
  }
  return dependencies[name];
}

/**
 * Persist one repository-neutral mutation and its required audit atomically,
 * then emit optional best-effort metrics after the transaction has completed.
 *
 * Runtime callers use the existing callback-only `withTransaction(callback)`
 * interface. The transaction provider option is reserved for deterministic
 * tests and must not be supplied by production callers.
 */
export async function orchestrateMutationWithRequiredAudit(input = {}, dependencies = {}, testOptions = {}) {
  const persistMutation = requirePersistenceDependency(dependencies, "persistMutation");
  const persistRequiredAudit = requirePersistenceDependency(dependencies, "persistRequiredAudit");
  const emitBestEffortMetric = typeof dependencies.emitBestEffortMetric === "function"
    ? dependencies.emitBestEffortMetric
    : null;
  const requiredAuditMetadata = sanitizeRequiredAuditMetadata(input.requiredAuditMetadata);
  const bestEffortMetricMetadata = sanitizeBestEffortMetricMetadata(input.bestEffortMetricMetadata);

  const transactionCallback = async (transactionContext) => {
    const mutationResult = await persistMutation(input.mutation, transactionContext);
    const auditResult = await persistRequiredAudit(requiredAuditMetadata, transactionContext);
    if (auditResult?.ok !== true) throw new RequiredAuditPersistenceError();
    return mutationResult;
  };

  const mutationResult = testOptions.testOnlyTransactionProvider
    ? await withTransaction(transactionCallback, testOptions.testOnlyTransactionProvider)
    : await withTransaction(transactionCallback);

  if (emitBestEffortMetric) {
    try {
      await emitBestEffortMetric(bestEffortMetricMetadata);
    } catch {
      // Metrics are deliberately best-effort and cannot alter a committed result.
    }
  }

  return mutationResult;
}
