import { createHash, randomUUID } from "crypto";
import {
  areKaiSprint2UploadFeaturesEnabled,
  isKaiSprint2Enabled,
} from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError, validationBlocked } from "../errors/kaiErrors.js";
import { kaiIdempotentWriteConflict } from "../internal/kaiIdempotentWriteConflict.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import {
  blockIntakeFilePolicyStatus,
  findIntakeBatchByIdempotencyKey,
  findIntakeFileReservationByChecksum,
  findIntakeFileReservationByIdempotencyKey,
  insertIntakeBatchMetadata,
  insertIntakeFileMetadata,
} from "../db/kaiIntakeQueries.js";
import { withTransaction } from "../db/kaiDb.js";
import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";
import {
  RequiredAuditPersistenceError,
  orchestrateMutationWithRequiredAudit,
} from "../internal/kaiMutationOrchestration.js";
import {
  getIntakeBatchDetail as readIntakeBatchDetail,
  getIntakeFileMetadata as readIntakeFileMetadata,
  listIntakeBatchesForOrganization as readIntakeBatchesForOrganization,
  listIntakeFilesForBatch as readIntakeFilesForBatch,
  listIntakeFileReviewQueueItems as readIntakeFileReviewQueueItems,
} from "../db/kaiReadModels.js";
import {
  FILE_POLICY_BLOCKING_REASON_CODES,
  encodeIntakeBatchFilesCursor,
  encodeReviewQueueCursor,
  validateIntakeBatchFilesPagination,
  validateReviewQueuePagination,
} from "../validators/kaiSprint2RequestSchemas.js";
import { getEngagementTenantState, getIntakeBatchTenantState } from "../db/kaiQueries.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  buildObjectKey,
  detectGroundedFilenameHazard,
  validateSafeFilename,
} from "../storage/storagePathPolicy.js";
import {
  validateStorageProviderDbValue,
  validateFilePolicyStatusTransition,
} from "../validators/stateTransitionValidators.js";
import {
  canonicalizeSha256Checksum,
  duplicate_checksum_blocked,
  idempotencyValidatorGroups,
} from "../validators/idempotencyValidators.js";
import { runValidators } from "../validators/runValidators.js";
import { recordBlockedAttempt } from "./kaiAuditService.js";

const PASS2_MARKER = "pass2_admin_metadata_intake_verification";
const PASS2_GATE_PLAN = "KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0.1.1";
const ALLOWED_METADATA_ONLY_MIME_TYPES = new Set(["text/csv", "application/csv", "text/plain"]);
const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;
const STORED_FINGERPRINT_RE = /^[0-9a-f]{64}$/;
const PRELIMINARY_DUPLICATE_VALIDATORS = Object.freeze([duplicate_checksum_blocked]);
const GK_REVIEW_QUEUE_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const FILE_POLICY_BLOCKING_VALIDATOR_KEYS = Object.freeze([
  "VAL-AUT-001",
  "VAL-AUT-002",
  "VAL-AUT-003",
  "VAL-AUT-004",
  "VAL-AST-001",
  "VAL-STA-001",
]);
const KNOWN_TERMINAL_FILE_POLICY_STATUSES = new Set(["passed", "failed", "skipped"]);
const FILE_POLICY_BLOCKING_REASON_CODE_SET = new Set(FILE_POLICY_BLOCKING_REASON_CODES);
const ACTIVE_REVIEW_QUEUE_STATUSES = new Set([
  "open",
  "in_progress",
  "blocked",
  "waiting_on_client",
  "waiting_on_gk",
]);
const CANONICAL_ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REVIEW_QUEUE_PRIORITY_RE = /^[a-z0-9_]{1,64}$/;
const DISALLOWED_TEXT_CONTROLS_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;
const BIDI_FORMATTING_CONTROLS_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const PROVIDER_NEUTRAL_OBJECT_VERSION_ID_RE = /^ov_[a-f0-9]{32}$/;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function actorError(actorResult) {
  if (actorResult.error_code === "mapped_kai_user_required") return buildKaiError("mapped_kai_user_required");
  return buildKaiError("unauthorized");
}

class KaiRouteMutationError extends Error {
  constructor(code) {
    super(code);
    this.name = "KaiRouteMutationError";
    this.code = code;
  }
}

function routeName(inputRoute, fallback) {
  return inputRoute || fallback;
}

async function validateMetadataMutationInput(operation, context) {
  const validators = operation === "create_intake_batch"
    ? idempotencyValidatorGroups.metadata_batch_write
    : idempotencyValidatorGroups.metadata_file_write;
  return await runValidators(
    validators,
    context,
    { group_key: `${operation}_metadata_mutation` },
  );
}

function targetObjectTypeForOperation(operation) {
  if (operation === "create_intake_batch") return "intake_batch";
  if (operation === "reserve_intake_file_metadata" || operation === "create_intake_file") return "intake_file";
  if (operation === "check_admin_access") return "engagement";
  return "other";
}

async function toBlockerResponse(blockers, actorContext, operation, metadata, dependencies) {
  let auditResult = null;
  const warnings = [];
  try {
    auditResult = await recordBlockedAttempt({
      actorContext,
      operation,
      blockers,
      metadata: {
        p0_pass: PASS2_MARKER,
        target_object_type: targetObjectTypeForOperation(operation),
        blocked: true,
        metadata_only: true,
        ...metadata,
      },
      dependencies,
    });
    if (auditResult?.skipped || auditResult?.ok === false) {
      warnings.push({
        code: "blocked_attempt_audit_not_written",
        message: "Blocked-attempt audit was not written.",
        reason: auditResult.reason || "unknown",
      });
    }
  } catch (error) {
    auditResult = { ok: false, reason: "audit_insert_failed" };
    warnings.push({
      code: "blocked_attempt_audit_failed",
      message: "Blocked-attempt audit failed without changing the validator response.",
      reason: "audit_insert_failed",
    });
  }
  return validationBlocked(blockers, {
    audit_context: {
      actor_user_id: actorContext?.actorUserId || null,
      actor_type: actorContext?.actorType || "human",
      operation,
      blocked_attempt_audit: {
        attempted: true,
        ok: auditResult?.ok === true,
        skipped: auditResult?.skipped === true,
        reason: auditResult?.reason || null,
        audit_event_id: auditResult?.auditEventId || null,
      },
    },
    ...(warnings.length ? { warnings } : {}),
  });
}

function normalizeBatchMetadata(payload = {}) {
  return {
    ...(payload.batch_metadata && typeof payload.batch_metadata === "object" ? payload.batch_metadata : {}),
    p0_pass: PASS2_MARKER,
    gate_plan: PASS2_GATE_PLAN,
    synthetic_only: true,
    raw_upload_enabled: false,
    signed_url_enabled: false,
    parser_worker_enabled: false,
    source_promotion_enabled: false,
  };
}

function batchPayloadFingerprint({ organizationId, engagementId, batchCode, idempotencyKey, payload }) {
  return sha256({
    organization_id: organizationId,
    engagement_id: engagementId || null,
    batch_code: batchCode,
    idempotency_key: idempotencyKey || null,
    intake_method: payload?.intake_method || "manual_upload",
    source_system_name: payload?.source_system_name || null,
    source_system_ref: payload?.source_system_ref || null,
    notes: payload?.notes || null,
    batch_metadata: normalizeBatchMetadata(payload),
  });
}

function responseBatch(row) {
  return {
    intake_batch_id: row?.intake_batch_id,
    organization_id: row?.organization_id,
    engagement_id: row?.engagement_id || null,
    batch_code: row?.batch_code,
    processing_status: row?.processing_status,
    review_status: row?.review_status,
    metadata_only: true,
  };
}

function responseBatchSummary(row) {
  return {
    intake_batch_id: row?.intake_batch_id,
    organization_id: row?.organization_id,
    engagement_id: row?.engagement_id || null,
    batch_code: row?.batch_code,
    processing_status: row?.processing_status,
    review_status: row?.review_status,
    created_at: row?.created_at,
    updated_at: row?.updated_at,
  };
}

function responseBatchDetail(row) {
  return {
    intake_batch_id: row.intake_batch_id,
    organization_id: row.organization_id,
    engagement_id: row.engagement_id,
    batch_code: row.batch_code,
    processing_status: row.processing_status,
    review_status: row.review_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function responseFileSummary(row) {
  return {
    intake_file_id: row.intake_file_id,
    intake_batch_id: row.intake_batch_id,
    organization_id: row.organization_id,
    engagement_id: row.engagement_id ?? null,
    safe_filename: row.safe_filename,
    mime_type: row.mime_type,
    file_size_bytes: row.file_size_bytes,
    file_policy_status: row.file_policy_status,
    malware_scan_status: row.malware_scan_status,
    processing_status: row.processing_status,
    parse_status: row.parse_status,
    review_status: row.review_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function requestValidationBlocker(blockingReason, objectCode) {
  return {
    validator_key: "VAL-REQ-P0-001",
    severity: "blocker",
    object_type: "request",
    object_code: objectCode,
    object_id: null,
    message: "Request does not match the KAI Sprint 2 route schema.",
    blocking_reason: blockingReason,
    required_fix: "Send only the documented metadata fields with their documented types and limits.",
    evidence: {},
  };
}

function isValidFileDtoRow(row, { organizationId, intakeFileId, expectedFilePolicyStatus = null } = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  if (row.organization_id !== organizationId || row.intake_file_id !== intakeFileId) return false;
  if (!canonicalUuid(row.intake_batch_id)) return false;
  if (row.engagement_id !== null && !canonicalUuid(row.engagement_id)) return false;
  if (typeof row.safe_filename !== "string" || row.safe_filename.length < 1) return false;
  if (row.mime_type !== null && typeof row.mime_type !== "string") return false;
  if (!Number.isSafeInteger(row.file_size_bytes) || row.file_size_bytes < 0) return false;
  if (expectedFilePolicyStatus && row.file_policy_status !== expectedFilePolicyStatus) return false;
  if (typeof row.malware_scan_status !== "string" || row.malware_scan_status.length < 1) return false;
  if (typeof row.processing_status !== "string" || row.processing_status.length < 1) return false;
  if (typeof row.parse_status !== "string" || row.parse_status.length < 1) return false;
  if (typeof row.review_status !== "string" || row.review_status.length < 1) return false;
  return Boolean(canonicalTimestamp(row.created_at) && canonicalTimestamp(row.updated_at));
}

function validateFilePolicyBlockBody(input = {}) {
  const expectedStatus = input.expectedFilePolicyStatus ?? input.payload?.expected_file_policy_status;
  const blockingReasonCode = input.blockingReasonCode ?? input.payload?.blocking_reason_code;
  if (expectedStatus !== "pending") {
    return {
      ok: false,
      blockers: [requestValidationBlocker("invalid_expected_file_policy_status", "expected_file_policy_status")],
    };
  }
  if (!FILE_POLICY_BLOCKING_REASON_CODE_SET.has(blockingReasonCode)) {
    return {
      ok: false,
      blockers: [requestValidationBlocker("invalid_blocking_reason_code", "blocking_reason_code")],
    };
  }
  return { ok: true, blockingReasonCode };
}

function didUnrelatedFileFieldsRemainUnchanged(before, after) {
  return [
    "intake_file_id",
    "intake_batch_id",
    "organization_id",
    "engagement_id",
    "safe_filename",
    "mime_type",
    "file_size_bytes",
    "malware_scan_status",
    "processing_status",
    "parse_status",
    "review_status",
    "created_at",
  ].every((field) => before[field] === after[field]);
}

function canonicalUuid(value) {
  return typeof value === "string"
    && value === value.toLowerCase()
    && UUID_RE.test(value);
}

function canonicalTimestamp(value, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value !== "string" || !CANONICAL_ISO_TIMESTAMP_RE.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value ? undefined : value;
}

function normalizedReviewQueueText(value, maximumCodePoints) {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const normalized = value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (
    normalized.length === 0
    || [...normalized].length > maximumCodePoints
    || DISALLOWED_TEXT_CONTROLS_RE.test(normalized)
    || BIDI_FORMATTING_CONTROLS_RE.test(normalized)
  ) {
    return { ok: false };
  }
  return { ok: true, value: normalized };
}

function responseReviewQueueItem(row, organizationId) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  if (
    !canonicalUuid(row.review_queue_item_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || row.queue_type !== "intake_file_review"
    || row.target_object_type !== "intake_file"
    || !canonicalUuid(row.target_object_id)
    || !ACTIVE_REVIEW_QUEUE_STATUSES.has(row.queue_status)
    || typeof row.priority !== "string"
    || !REVIEW_QUEUE_PRIORITY_RE.test(row.priority)
  ) {
    return null;
  }

  const dueAt = canonicalTimestamp(row.due_at, { nullable: true });
  const createdAt = canonicalTimestamp(row.created_at);
  const updatedAt = canonicalTimestamp(row.updated_at);
  const summary = normalizedReviewQueueText(row.summary, 200);
  const requiredAction = normalizedReviewQueueText(row.required_action, 1000);
  if (
    dueAt === undefined
    || createdAt === undefined
    || updatedAt === undefined
    || !summary.ok
    || !requiredAction.ok
  ) {
    return null;
  }

  return {
    review_queue_item_id: row.review_queue_item_id,
    organization_id: row.organization_id,
    queue_type: row.queue_type,
    target_object_type: row.target_object_type,
    target_object_id: row.target_object_id,
    priority: row.priority,
    queue_status: row.queue_status,
    due_at: dueAt,
    summary: summary.value,
    required_action: requiredAction.value,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function hasConflictingFingerprint(row, expectedFingerprint, metadataColumn, fingerprintField) {
  const metadata = row?.[metadataColumn];
  const existingFingerprint = metadata?.[fingerprintField];
  if (typeof existingFingerprint !== "string" || !STORED_FINGERPRINT_RE.test(existingFingerprint)) {
    return true;
  }
  return existingFingerprint !== expectedFingerprint;
}

function batchReplayResult(row, expectedFingerprint, actorContext) {
  if (hasConflictingFingerprint(row, expectedFingerprint, "batch_metadata", "normalized_payload_hash")) {
    return buildKaiError("duplicate_conflict");
  }
  return {
    ok: true,
    data: responseBatch(row),
    warnings: [],
    audit_context: {
      actor_user_id: actorContext.actorUserId,
      actor_type: actorContext.actorType,
      operation: "create_intake_batch",
    },
  };
}

function unsafeFilenameBlocker(reason = "unsafe_filename") {
  return {
    validator_key: "VAL-STO-004",
    severity: "blocker",
    object_type: "intake_file",
    object_code: "safe_filename",
    object_id: null,
    message: "Filename failed safe filename validation.",
    blocking_reason: reason,
    required_fix: "Use a basename with an allowed extension and no path characters.",
    evidence: {},
  };
}

function unsupportedMimeBlocker(mimeType) {
  return {
    validator_key: "VAL-STO-005",
    severity: "blocker",
    object_type: "intake_file",
    object_code: "mime_type",
    object_id: null,
    message: "MIME type is not allowed for metadata-only reservation.",
    blocking_reason: "unsupported_mime_type",
    required_fix: "Use a DDL-safe metadata-only MIME type.",
    evidence: { mime_type: mimeType || null },
  };
}

function missingEngagementIdBlocker(objectType = "engagement") {
  return {
    validator_key: "VAL-TEN-002",
    severity: "blocker",
    object_type: objectType,
    object_code: "engagement_id",
    object_id: null,
    message: "engagement_id is required for this Sprint 2 admin intake operation.",
    blocking_reason: "missing_engagement_id",
    required_fix: "Supply engagement_id from the authenticated tenant scope.",
    evidence: {},
  };
}

function engagementBatchTenantMismatchBlocker({ intakeBatchId, requestedEngagementId, batchEngagementId }) {
  return {
    validator_key: "VAL-TEN-003",
    severity: "blocker",
    object_type: "intake_batch",
    object_id: intakeBatchId || null,
    message: "Requested engagement does not match parent batch tenant state.",
    blocking_reason: "engagement_batch_tenant_mismatch",
    required_fix: "Use the engagement_id from the parent intake batch or reserve against the correct batch.",
    evidence: {
      requested_engagement_id: requestedEngagementId || null,
      batch_engagement_id: batchEngagementId || null,
    },
  };
}

function deriveSafeFilename({ originalFilename, safeFilename, fileExtension }) {
  if (safeFilename !== undefined && typeof safeFilename !== "string") {
    return { ok: false, error_code: "missing_filename" };
  }
  if (typeof safeFilename === "string") {
    const safeFilenameHazard = detectGroundedFilenameHazard(safeFilename);
    if (safeFilenameHazard.matched) return { ok: false, error_code: safeFilenameHazard.reason };
    return { ok: true, safeFilename };
  }
  const rawOriginal = String(originalFilename ?? "");
  const originalHazard = detectGroundedFilenameHazard(rawOriginal);
  if (originalHazard.matched) return { ok: false, error_code: originalHazard.reason };
  const original = rawOriginal.trim();
  const extension = String(fileExtension || "").trim().toLowerCase();
  const normalized = original
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .replace(/^_+|_+$/g, "");
  const candidate = extension && !normalized.endsWith(extension) ? `${normalized}${extension}` : normalized;
  if (candidate.length === 0) return { ok: false, error_code: "missing_filename" };
  if (extension) {
    const candidateHazard = detectGroundedFilenameHazard(candidate);
    if (candidateHazard.matched) return { ok: false, error_code: candidateHazard.reason };
  }
  return { ok: true, safeFilename: candidate };
}

function explicitSafeFilenameInput(input = {}, payload = {}) {
  if (Object.hasOwn(input, "safeFilename")) return input.safeFilename;
  if (Object.hasOwn(payload, "safe_filename")) return payload.safe_filename;
  return undefined;
}

function normalizeReservationMetadata({ payload, idempotencyKey, reservationPayloadHash }) {
  return {
    ...(payload.reservation_metadata && typeof payload.reservation_metadata === "object" ? payload.reservation_metadata : {}),
    ...(payload.file_metadata && typeof payload.file_metadata === "object" ? payload.file_metadata : {}),
    p0_pass: PASS2_MARKER,
    gate_plan: PASS2_GATE_PLAN,
    synthetic_only: true,
    raw_upload_enabled: false,
    signed_url_enabled: false,
    no_raw_object_created: true,
    checksum_scope: "metadata_reservation_no_raw_file",
    checksum_source: "caller_declared",
    checksum_verification_status: "unverified",
    idempotency_key: idempotencyKey || null,
    reservation_payload_hash: reservationPayloadHash,
  };
}

export async function listIntakeBatchesForOrganization(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const organizationId = String(input.organizationId || input.payload?.organization_id || "").trim().toLowerCase();
  if (!UUID_RE.test(organizationId)) {
    return buildKaiError("invalid_request", {
      message: "organization_id must be a valid UUID.",
    });
  }

  const actorContext = actorResult.actorContext;
  const auth = validateActorCanPerformOperation(actorContext, "read_intake", organizationId);
  if (!auth.ok) return buildKaiError(auth.error_code, { blockers: auth.blockers });

  const listBatches = dependencies.listIntakeBatchesForOrganization || readIntakeBatchesForOrganization;
  const rows = await listBatches(organizationId);
  const tenantResult = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
    currentRecords: rows,
  });
  if (tenantResult.severity === "blocker") {
    return validationBlocked([tenantResult]);
  }

  return {
    ok: true,
    data: {
      organization_id: organizationId,
      batches: rows
        .filter((row) => String(row?.organization_id || "").toLowerCase() === organizationId)
        .map((row) => responseBatchSummary(row)),
    },
    warnings: [],
  };
}

export const listIntakeBatches = listIntakeBatchesForOrganization;

export async function getIntakeBatchDetail(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const organizationId = String(input.organizationId || "").trim().toLowerCase();
  const intakeBatchId = String(input.intakeBatchId || "").trim().toLowerCase();
  if (!UUID_RE.test(organizationId) || !UUID_RE.test(intakeBatchId)) {
    return buildKaiError("invalid_request");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const actorContext = actorResult.actorContext;
  const auth = validateActorCanPerformOperation(actorContext, "read_intake", organizationId);
  if (!auth.ok) return buildKaiError(auth.error_code, { blockers: auth.blockers });

  const readBatch = dependencies.getIntakeBatchDetail || readIntakeBatchDetail;
  const row = await readBatch(organizationId, intakeBatchId);
  if (!row || String(row.intake_batch_id || "").toLowerCase() !== intakeBatchId) {
    return buildKaiError("not_found");
  }

  const tenantResult = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
    currentRecords: [row],
  });
  if (tenantResult.severity === "blocker") {
    return buildKaiError("not_found");
  }

  return {
    ok: true,
    data: responseBatchDetail(row),
    warnings: [],
  };
}

export async function getIntakeFileDetail(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const organizationId = String(input.organizationId || "").trim().toLowerCase();
  const intakeFileId = typeof input.intakeFileId === "string" ? input.intakeFileId : "";
  if (
    !UUID_RE.test(organizationId)
    || !UUID_RE.test(intakeFileId)
    || intakeFileId !== intakeFileId.toLowerCase()
  ) {
    return buildKaiError("invalid_request");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const actorContext = actorResult.actorContext;
  if (actorContext.actorType !== "human") return buildKaiError("authorization_denied");
  const auth = validateActorCanPerformOperation(actorContext, "read_intake", organizationId);
  if (!auth.ok) return buildKaiError(auth.error_code, { blockers: auth.blockers });

  const readFile = dependencies.getIntakeFileMetadata || readIntakeFileMetadata;
  const row = await readFile(organizationId, intakeFileId);
  if (!row || String(row.intake_file_id || "") !== intakeFileId) {
    return buildKaiError("not_found");
  }

  const tenantResult = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
    currentRecords: [row],
  });
  if (tenantResult.severity === "blocker") return buildKaiError("not_found");

  return {
    ok: true,
    data: responseFileSummary(row),
    warnings: [],
  };
}

export async function markIntakeFilePolicyBlocked(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const organizationId = String(input.organizationId || "").trim().toLowerCase();
  const intakeFileId = typeof input.intakeFileId === "string" ? input.intakeFileId : "";
  if (
    !UUID_RE.test(organizationId)
    || !UUID_RE.test(intakeFileId)
    || intakeFileId !== intakeFileId.toLowerCase()
  ) {
    return buildKaiError("validation_blocker", {
      blockers: [requestValidationBlocker("invalid_uuid_field", "organization_id_or_intake_file_id")],
    });
  }

  const bodyValidation = validateFilePolicyBlockBody(input);
  if (!bodyValidation.ok) return validationBlocked(bodyValidation.blockers);

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const actorContext = actorResult.actorContext;
  if (actorContext.actorType !== "human") return buildKaiError("authorization_denied");
  const auth = validateActorCanPerformOperation(actorContext, "mark_file_policy_blocked", organizationId);
  if (!auth.ok) return buildKaiError(auth.error_code, { blockers: auth.blockers });

  const readFile = dependencies.getIntakeFileMetadata || readIntakeFileMetadata;
  const writeBlocked = dependencies.blockIntakeFilePolicyStatus || blockIntakeFilePolicyStatus;
  const insertAudit = dependencies.insertRequiredSuccessfulAuditEvent || insertRequiredSuccessfulAuditEvent;
  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const requestId = input.requestId || randomUUID();
  const auditCreatedAt = (dependencies.now ? new Date(dependencies.now()) : new Date()).toISOString();
  const route = routeName(input.route, "/api/kai/sprint2/intake/admin/files/:intakeFileId/block");

  try {
    const mutationResult = await orchestrateMutationWithRequiredAudit(
      {
        mutation: {
          organizationId,
          intakeFileId,
          blockingReasonCode: bodyValidation.blockingReasonCode,
        },
        requiredAuditMetadata: {
          operation: "mark_file_policy_blocked",
          operation_type: "mark_file_policy_blocked",
          actor_user_id: actorContext.actorUserId,
          actor_type: actorContext.actorType,
          organization_id: organizationId,
          object_type: "intake_file",
          target_object_type: "intake_file",
          object_id: intakeFileId,
          reason_code: bodyValidation.blockingReasonCode,
          blocking_reason_code: bodyValidation.blockingReasonCode,
          validator_key: "VAL-STA-001",
          validator_keys: FILE_POLICY_BLOCKING_VALIDATOR_KEYS,
          request_id: requestId,
          route,
          from_state: "pending",
          to_state: "blocked",
          prior_status: "pending",
          new_status: "blocked",
          created_at: auditCreatedAt,
        },
        bestEffortMetricMetadata: {
          metric_name: "kai.file_policy.blocked",
          operation: "mark_file_policy_blocked",
          actor_type: actorContext.actorType,
          object_type: "intake_file",
          outcome: "success",
          reason_code: bodyValidation.blockingReasonCode,
          from_state: "pending",
          to_state: "blocked",
        },
      },
      {
        async persistMutation(_mutation, transactionContext) {
          const storedRow = await readFile(organizationId, intakeFileId, transactionContext);
          if (!storedRow) throw new KaiRouteMutationError("not_found");
          if (storedRow.organization_id !== organizationId || storedRow.intake_file_id !== intakeFileId) {
            throw new KaiRouteMutationError("not_found");
          }
          if (!isValidFileDtoRow(storedRow, { organizationId, intakeFileId })) {
            throw new KaiRouteMutationError("system_error");
          }

          const currentStatus = storedRow.file_policy_status;
          if (currentStatus === "blocked") throw new KaiRouteMutationError("conflict_current_state_changed");
          if (KNOWN_TERMINAL_FILE_POLICY_STATUSES.has(currentStatus)) {
            throw new KaiRouteMutationError("state_transition_denied");
          }
          if (currentStatus !== "pending") throw new KaiRouteMutationError("system_error");

          const transition = validateFilePolicyStatusTransition({ from: currentStatus, to: "blocked" });
          if (transition.severity === "blocker") {
            throw new KaiRouteMutationError("state_transition_denied");
          }

          const updatedRow = await writeBlocked({ organizationId, intakeFileId }, transactionContext);
          if (!updatedRow) throw new KaiRouteMutationError("conflict_current_state_changed");
          if (
            !isValidFileDtoRow(updatedRow, {
              organizationId,
              intakeFileId,
              expectedFilePolicyStatus: "blocked",
            })
            || !didUnrelatedFileFieldsRemainUnchanged(storedRow, updatedRow)
          ) {
            throw new KaiRouteMutationError("system_error");
          }

          return {
            ok: true,
            data: responseFileSummary(updatedRow),
            warnings: [],
          };
        },
        async persistRequiredAudit(metadata, transactionContext) {
          return await insertAudit(metadata, transactionContext);
        },
        ...(typeof dependencies.emitBestEffortMetric === "function"
          ? { emitBestEffortMetric: dependencies.emitBestEffortMetric }
          : {}),
      },
      (callback) => runInTransaction(callback),
    );

    return mutationResult;
  } catch (error) {
    if (error instanceof KaiRouteMutationError) return buildKaiError(error.code);
    if (error instanceof RequiredAuditPersistenceError) return buildKaiError("system_error");
    return buildKaiError("system_error");
  }
}

export async function listIntakeFilesForBatch(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const organizationId = String(input.organizationId || "").trim().toLowerCase();
  const intakeBatchId = String(input.intakeBatchId || "").trim().toLowerCase();
  if (!UUID_RE.test(organizationId) || !UUID_RE.test(intakeBatchId)) {
    return buildKaiError("invalid_request");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const actorContext = actorResult.actorContext;
  if (actorContext.actorType !== "human") return buildKaiError("authorization_denied");
  const auth = validateActorCanPerformOperation(actorContext, "read_intake", organizationId);
  if (!auth.ok) return buildKaiError(auth.error_code, { blockers: auth.blockers });

  const paginationResult = validateIntakeBatchFilesPagination(input.pagination);
  if (!paginationResult.ok) return buildKaiError("invalid_request");
  const { limit, cursor } = paginationResult.pagination;

  const readBatch = dependencies.getIntakeBatchDetail || readIntakeBatchDetail;
  const parent = await readBatch(organizationId, intakeBatchId);
  if (!parent || String(parent.intake_batch_id || "").toLowerCase() !== intakeBatchId) {
    return buildKaiError("not_found");
  }
  const tenantResult = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
    currentRecords: [parent],
  });
  if (tenantResult.severity === "blocker") return buildKaiError("not_found");

  const readFiles = dependencies.listIntakeFilesForBatch || readIntakeFilesForBatch;
  const rows = await readFiles(organizationId, intakeBatchId, { limit, cursor });
  const hasNextPage = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => responseFileSummary(row));
  const finalItem = items.at(-1);

  return {
    ok: true,
    data: {
      items,
      pagination: {
        limit,
        next_cursor: hasNextPage
          ? encodeIntakeBatchFilesCursor({
            created_at: finalItem.created_at,
            intake_file_id: finalItem.intake_file_id,
          })
          : null,
      },
    },
    warnings: [],
  };
}

export async function listIntakeFileReviewQueueItems(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const organizationId = String(input.organizationId || "").trim().toLowerCase();
  if (!UUID_RE.test(organizationId)) return buildKaiError("invalid_request");

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const actorContext = actorResult.actorContext;
  if (actorContext.actorType !== "human") return buildKaiError("authorization_denied");
  const genericAuth = validateActorCanPerformOperation(
    actorContext,
    "read_intake",
    organizationId,
  );
  if (!genericAuth.ok) {
    return buildKaiError(genericAuth.error_code, { blockers: genericAuth.blockers });
  }
  const routeAuth = validateActorCanPerformOperation(
    actorContext,
    "read_intake",
    organizationId,
    { allowedRoles: GK_REVIEW_QUEUE_ROLES },
  );
  if (!routeAuth.ok) {
    return buildKaiError(routeAuth.error_code, { blockers: routeAuth.blockers });
  }

  const paginationResult = validateReviewQueuePagination(input.pagination);
  if (!paginationResult.ok) return buildKaiError("invalid_request");
  const { limit, cursor } = paginationResult.pagination;

  const readQueue = dependencies.listIntakeFileReviewQueueItems || readIntakeFileReviewQueueItems;
  const rows = await readQueue(organizationId, { limit, cursor });
  if (!Array.isArray(rows) || rows.length > limit + 1) return buildKaiError("system_error");

  const validatedRows = [];
  for (const row of rows) {
    const item = responseReviewQueueItem(row, organizationId);
    if (!item) return buildKaiError("system_error");
    validatedRows.push(item);
  }

  const hasNextPage = validatedRows.length > limit;
  const items = validatedRows.slice(0, limit);
  const finalItem = items.at(-1);

  return {
    ok: true,
    data: {
      items,
      pagination: {
        limit,
        next_cursor: hasNextPage
          ? encodeReviewQueueCursor({
            created_at: finalItem.created_at,
            review_queue_item_id: finalItem.review_queue_item_id,
          })
          : null,
      },
    },
    warnings: [],
  };
}

function reservationPayloadFingerprint({
  organizationId,
  engagementId,
  intakeBatchId,
  idempotencyKey,
  checksum,
  hashAlgorithm,
  payload,
  safeFilename,
}) {
  return sha256({
    organization_id: organizationId,
    engagement_id: engagementId || null,
    intake_batch_id: intakeBatchId,
    idempotency_key: idempotencyKey || null,
    original_filename: payload?.original_filename || null,
    safe_filename: safeFilename,
    mime_type: payload?.mime_type || null,
    file_extension: payload?.file_extension || null,
    file_size_bytes: payload?.file_size_bytes ?? 0,
    checksum,
    hash_algorithm: hashAlgorithm,
    reservation_metadata: payload?.reservation_metadata || {},
  });
}

function responseFile(row) {
  return {
    intake_file_id: row?.intake_file_id,
    intake_batch_id: row?.intake_batch_id,
    organization_id: row?.organization_id,
    engagement_id: row?.engagement_id || null,
    safe_filename: row?.safe_filename,
    file_policy_status: row?.file_policy_status,
    malware_scan_status: row?.malware_scan_status,
    processing_status: row?.processing_status,
    parse_status: row?.parse_status,
    review_status: row?.review_status,
    metadata_only: true,
  };
}

function uploadFileIdentity({ organizationId, intakeFileId, intakeBatchId = null }) {
  return {
    organization_id: organizationId,
    intake_file_id: intakeFileId,
    ...(intakeBatchId ? { intake_batch_id: intakeBatchId } : {}),
  };
}

function uploadSuccessData({ organizationId, intakeFileId, intakeBatchId, record, objectVersionId, sizeBytes, replayed }) {
  return {
    ...uploadFileIdentity({ organizationId, intakeFileId, intakeBatchId }),
    upload_state: record.upload_state,
    object_version_id: objectVersionId,
    size_bytes: sizeBytes,
    replayed: replayed === true,
  };
}

function uploadNewReservationRequiredResult() {
  return buildKaiError("conflict_current_state_changed", {
    status: 409,
    message: "Upload attempt cannot continue. Reserve a new intake file.",
    data: {
      new_reservation_required: true,
    },
  });
}

function sanitizedStorageFailure(result, { newReservationRequired = false } = {}) {
  return buildKaiError(result?.error?.code || "system_error", {
    status: result?.error?.status || 500,
    ...(newReservationRequired ? { data: { new_reservation_required: true } } : {}),
  });
}

function sanitizedPostStartInternalFailure() {
  return buildKaiError("system_error", {
    status: 500,
    data: { new_reservation_required: true },
  });
}

function validatedStorageSuccessData(storage) {
  const objectVersionId = storage?.data?.object_version_id;
  const sizeBytes = storage?.data?.size_bytes;
  if (typeof objectVersionId !== "string") return null;
  if (!PROVIDER_NEUTRAL_OBJECT_VERSION_ID_RE.test(objectVersionId)) return null;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) return null;
  return {
    objectVersionId,
    sizeBytes,
  };
}

function validUploadStartedTransitionSuccess(result, { organizationId, intakeFileId }) {
  const data = result?.data;
  const record = data?.record;
  return Boolean(
    data
    && typeof data.replayed === "boolean"
    && record
    && record.organization_id === organizationId
    && record.intake_file_id === intakeFileId
    && record.upload_state === "upload_started"
    && (
      !Object.hasOwn(record, "object_version_id")
      || record.object_version_id === null
    ),
  );
}

function validUploadedUnconfirmedTransitionSuccess(result, { organizationId, intakeFileId, objectVersionId }) {
  const data = result?.data;
  const record = data?.record;
  return Boolean(
    data
    && typeof data.replayed === "boolean"
    && record
    && record.organization_id === organizationId
    && record.intake_file_id === intakeFileId
    && record.upload_state === "uploaded_unconfirmed"
    && record.object_version_id === objectVersionId,
  );
}

function resolveUploadNow(input = {}, dependencies = {}) {
  const candidate = Object.hasOwn(input, "now")
    ? input.now
    : (typeof dependencies.now === "function" ? dependencies.now() : null);
  return canonicalTimestamp(candidate) || null;
}

async function authorizeUploadReservedIntakeFile(input = {}, dependencies = {}) {
  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const payload = input.payload || {};
  const organizationId = String(input.organizationId || payload.organization_id || "").trim().toLowerCase();
  const intakeFileId = String(input.intakeFileId || payload.intake_file_id || "").trim().toLowerCase();
  const intakeBatchId = input.intakeBatchId || payload.intake_batch_id || null;
  const engagementId = input.engagementId || payload.engagement_id || null;

  if (!UUID_RE.test(organizationId) || !UUID_RE.test(intakeFileId)) {
    return buildKaiError("invalid_request");
  }

  const actorContext = actorResult.actorContext;
  if (actorContext.actorType !== "human") return buildKaiError("authorization_denied");
  const auth = validateActorCanPerformOperation(actorContext, "create_intake_file", organizationId);
  if (!auth.ok) return buildKaiError(auth.error_code, { blockers: auth.blockers });

  const readFile = dependencies.getIntakeFileMetadata || readIntakeFileMetadata;
  const row = await readFile(organizationId, intakeFileId);
  if (!row || String(row.intake_file_id || "").toLowerCase() !== intakeFileId) {
    return buildKaiError("not_found");
  }

  const tenantResult = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: {
      organization_id: organizationId,
      ...(engagementId ? { engagement_id: engagementId } : {}),
      ...(intakeBatchId ? { intake_batch_id: intakeBatchId } : {}),
    },
    currentRecords: [row],
  });
  if (tenantResult.severity === "blocker") return buildKaiError("not_found");
  if (intakeBatchId && row.intake_batch_id !== intakeBatchId) return buildKaiError("not_found");
  if (engagementId && row.engagement_id && row.engagement_id !== engagementId) return buildKaiError("not_found");

  return {
    ok: true,
    actorContext,
    organizationId,
    intakeFileId,
    intakeBatchId: intakeBatchId || row.intake_batch_id || null,
  };
}

function fileReservationReplayResult(row, expectedFingerprint, actorContext) {
  if (hasConflictingFingerprint(row, expectedFingerprint, "file_metadata", "reservation_payload_hash")) {
    return buildKaiError("duplicate_conflict");
  }
  return {
    ok: true,
    data: responseFile(row),
    warnings: [],
    audit_context: {
      actor_user_id: actorContext.actorUserId,
      actor_type: actorContext.actorType,
      operation: "reserve_intake_file_metadata",
    },
  };
}

export async function checkAdminAccess(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const actorContext = actorResult.actorContext;
  const organizationId = input.organizationId || input.payload?.organization_id;
  const engagementId = input.engagementId || input.payload?.engagement_id || null;

  const auth = validateActorCanPerformOperation(actorContext, "create_intake_batch", organizationId);
  if (!auth.ok) return buildKaiError(auth.error_code, { blockers: auth.blockers });
  const globalWriteRolePresent = (actorContext.kaiRoles || []).some((role) => role === "gk_admin" || role === "gk_operator");

  if (!engagementId) {
    return await toBlockerResponse([missingEngagementIdBlocker()], actorContext, "check_admin_access", {
      organization_id: organizationId,
      engagement_id: null,
      route: routeName(input.route, "/api/kai/sprint2/intake/admin/access-check"),
      request_id: input.requestId || null,
    }, dependencies);
  }

  const engagementRecord = dependencies.getEngagementTenantState
    ? await dependencies.getEngagementTenantState(engagementId)
    : await getEngagementTenantState(engagementId);
  const tenantResult = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId, engagement_id: engagementId },
    engagementRecord,
  });
  if (tenantResult.severity === "blocker") {
    return validationBlocked([tenantResult]);
  }

  return {
    ok: true,
    data: {
      actor_mapped: true,
      actor_type: actorContext.actorType,
      legacy_public_userdata_id: actorContext.legacyPublicUserdataId,
      kai_user_id: actorContext.actorUserId,
      organization_id: organizationId,
      engagement_id: engagementId,
      membership_active: true,
      global_write_role_present: globalWriteRolePresent,
      matched_write_role_family: globalWriteRolePresent ? "gk_admin_or_operator" : null,
      authorized_operations: ["create_intake_batch", "reserve_intake_file_metadata"],
    },
    warnings: [],
  };
}

export async function createIntakeBatch(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const actorContext = actorResult.actorContext;
  const payload = input.payload || {};
  const organizationId = input.organizationId || payload.organization_id;
  const engagementId = input.engagementId || payload.engagement_id || null;
  const batchCode = input.batchCode || payload.batch_code;
  const idempotencyKey = input.idempotencyKey || payload.idempotency_key || null;

  const auth = validateActorCanPerformOperation(actorContext, "create_intake_batch", organizationId);
  if (!auth.ok) return buildKaiError(auth.error_code, { blockers: auth.blockers });

  if (!engagementId) {
    return await toBlockerResponse([missingEngagementIdBlocker()], actorContext, "create_intake_batch", {
      organization_id: organizationId,
      engagement_id: null,
      route: routeName(input.route, "/api/kai/sprint2/intake/admin/batches"),
      request_id: input.requestId || null,
    }, dependencies);
  }

  const engagementRecord = dependencies.getEngagementTenantState
    ? await dependencies.getEngagementTenantState(engagementId)
    : await getEngagementTenantState(engagementId);
  const tenantResult = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId, engagement_id: engagementId },
    engagementRecord,
  });
  if (tenantResult.severity === "blocker") {
    return await toBlockerResponse([tenantResult], actorContext, "create_intake_batch", {
      organization_id: organizationId,
      engagement_id: engagementId,
      route: routeName(input.route, "/api/kai/sprint2/intake/admin/batches"),
      request_id: input.requestId || null,
    }, dependencies);
  }

  if (!batchCode) return buildKaiError("invalid_request", { message: "batch_code is required." });

  const idempotencyValidation = await validateMetadataMutationInput("create_intake_batch", {
    idempotencyKey,
    payload,
  });
  if (!idempotencyValidation.ok) {
    return validationBlocked(idempotencyValidation.blockers, { warnings: idempotencyValidation.warnings });
  }

  const normalizedPayloadHash = batchPayloadFingerprint({ organizationId, engagementId, batchCode, idempotencyKey, payload });
  const findExisting = dependencies.findIntakeBatchByIdempotencyKey || findIntakeBatchByIdempotencyKey;
  const idempotencyLookup = Object.freeze({
    organizationId,
    operation: "create_intake_batch",
    idempotencyKey,
  });
  const existing = await findExisting(idempotencyLookup);
  if (existing) {
    return batchReplayResult(existing, normalizedPayloadHash, actorContext);
  }

  const insertBatch = dependencies.insertIntakeBatchMetadata || insertIntakeBatchMetadata;
  let row;
  try {
    row = await insertBatch({
      organizationId,
      engagementId,
      batchCode,
      idempotencyKey,
      intakeMethod: payload.intake_method || "manual_upload",
      sourceSystemName: input.sourceSystemName || payload.source_system_name || null,
      sourceSystemRef: input.sourceSystemRef || payload.source_system_ref || null,
      notes: input.notes || payload.notes || null,
      batchMetadata: {
        ...normalizeBatchMetadata(payload),
        normalized_payload_hash: normalizedPayloadHash,
      },
      createdBy: actorContext.actorUserId,
      createdByType: actorContext.actorType,
    });
  } catch (error) {
    if (error !== kaiIdempotentWriteConflict) throw error;
    const conflictedExisting = await findExisting(idempotencyLookup);
    if (!conflictedExisting) return buildKaiError("duplicate_conflict");
    return batchReplayResult(conflictedExisting, normalizedPayloadHash, actorContext);
  }

  return {
    ok: true,
    data: responseBatch(row),
    warnings: [],
    audit_context: {
      actor_user_id: actorContext.actorUserId,
      actor_type: actorContext.actorType,
      operation: "create_intake_batch",
    },
  };
}

export async function reserveIntakeFileMetadata(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const actorContext = actorResult.actorContext;
  const payload = input.payload || {};
  const organizationId = input.organizationId || payload.organization_id;
  const engagementId = input.engagementId || payload.engagement_id || null;
  const intakeBatchId = input.intakeBatchId || payload.intake_batch_id;
  const idempotencyKey = input.idempotencyKey || payload.idempotency_key || null;

  const auth = validateActorCanPerformOperation(actorContext, "create_intake_file", organizationId);
  if (!auth.ok) return buildKaiError(auth.error_code, { blockers: auth.blockers });

  const batchRecord = dependencies.getIntakeBatchTenantState
    ? await dependencies.getIntakeBatchTenantState(intakeBatchId, organizationId)
    : await getIntakeBatchTenantState(intakeBatchId, organizationId);
  if (!batchRecord) {
    return buildKaiError("not_found", { message: "Intake batch was not found for metadata reservation." });
  }

  if (batchRecord.engagement_id && engagementId !== batchRecord.engagement_id) {
    return await toBlockerResponse([
      engagementBatchTenantMismatchBlocker({
        intakeBatchId,
        requestedEngagementId: engagementId,
        batchEngagementId: batchRecord.engagement_id,
      }),
    ], actorContext, "reserve_intake_file_metadata", {
      organization_id: organizationId,
      engagement_id: engagementId,
      intake_batch_id: intakeBatchId,
      route: routeName(input.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations"),
      request_id: input.requestId || null,
    }, dependencies);
  }

  if (!engagementId) {
    return await toBlockerResponse([missingEngagementIdBlocker("intake_file")], actorContext, "reserve_intake_file_metadata", {
      organization_id: organizationId,
      engagement_id: null,
      intake_batch_id: intakeBatchId,
      route: routeName(input.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations"),
      request_id: input.requestId || null,
    }, dependencies);
  }

  const tenantResult = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: {
      organization_id: organizationId,
      engagement_id: engagementId,
      intake_batch_id: intakeBatchId,
    },
    currentRecords: [batchRecord],
  });
  if (tenantResult.severity === "blocker") {
    return await toBlockerResponse([tenantResult], actorContext, "reserve_intake_file_metadata", {
      organization_id: organizationId,
      engagement_id: engagementId,
      route: routeName(input.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations"),
      request_id: input.requestId || null,
    }, dependencies);
  }

  const derivedFilename = deriveSafeFilename({
    originalFilename: input.originalFilename || payload.original_filename,
    safeFilename: explicitSafeFilenameInput(input, payload),
    fileExtension: input.fileExtension || payload.file_extension,
  });
  if (!derivedFilename.ok) {
    return await toBlockerResponse([unsafeFilenameBlocker()], actorContext, "reserve_intake_file_metadata", {
      organization_id: organizationId,
      engagement_id: engagementId,
      route: routeName(input.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations"),
      request_id: input.requestId || null,
    }, dependencies);
  }

  const filenameResult = validateSafeFilename(derivedFilename.safeFilename);
  if (!filenameResult.ok) {
    return await toBlockerResponse([unsafeFilenameBlocker("unsafe_filename")], actorContext, "reserve_intake_file_metadata", {
      organization_id: organizationId,
      engagement_id: engagementId,
      route: routeName(input.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations"),
      request_id: input.requestId || null,
    }, dependencies);
  }

  const mimeType = input.mimeType || payload.mime_type || null;
  if (mimeType && !ALLOWED_METADATA_ONLY_MIME_TYPES.has(mimeType)) {
    return await toBlockerResponse([unsupportedMimeBlocker(mimeType)], actorContext, "reserve_intake_file_metadata", {
      organization_id: organizationId,
      engagement_id: engagementId,
      route: routeName(input.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations"),
      request_id: input.requestId || null,
    }, dependencies);
  }

  const intakeFileId = input.intakeFileId || randomUUID();
  const buildStorageObjectKey = dependencies.buildObjectKey || buildObjectKey;
  const objectKeyResult = buildStorageObjectKey({
    organizationId,
    intakeBatchId,
    intakeFileId,
    safeFilename: filenameResult.safeFilename,
  });
  if (!objectKeyResult.ok) {
    return await toBlockerResponse([unsafeFilenameBlocker(objectKeyResult.error_code)], actorContext, "reserve_intake_file_metadata", {
      organization_id: organizationId,
      engagement_id: engagementId,
      route: routeName(input.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations"),
      request_id: input.requestId || null,
    }, dependencies);
  }

  const storageProvider = dependencies.storageProvider || "gcs";
  const storageProviderResult = validateStorageProviderDbValue({ storageProvider });
  if (storageProviderResult.severity === "blocker") {
    return await toBlockerResponse([storageProviderResult], actorContext, "reserve_intake_file_metadata", {
      organization_id: organizationId,
      engagement_id: engagementId,
      intake_batch_id: intakeBatchId,
      route: routeName(input.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations"),
      request_id: input.requestId || null,
    }, dependencies);
  }

  const providedChecksum = input.checksum || payload.checksum || null;
  const providedHashAlgorithm = input.hashAlgorithm || payload.hash_algorithm || null;
  const mutationValidation = await validateMetadataMutationInput("reserve_intake_file_metadata", {
    idempotencyKey,
    checksum: providedChecksum,
    hashAlgorithm: providedHashAlgorithm,
    payload,
  });
  if (!mutationValidation.ok) {
    return validationBlocked(mutationValidation.blockers, { warnings: mutationValidation.warnings });
  }

  const checksum = canonicalizeSha256Checksum(providedChecksum);
  const hashAlgorithm = "sha256";

  const reservationPayloadHash = reservationPayloadFingerprint({
    organizationId,
    engagementId,
    intakeBatchId,
    idempotencyKey,
    checksum,
    hashAlgorithm,
    payload,
    safeFilename: filenameResult.safeFilename,
  });
  const findExisting = dependencies.findIntakeFileReservationByIdempotencyKey || findIntakeFileReservationByIdempotencyKey;
  const idempotencyLookup = Object.freeze({
    organizationId,
    operation: "reserve_intake_file_metadata",
    engagementId,
    intakeBatchId,
    idempotencyKey,
  });
  const existing = await findExisting(idempotencyLookup);
  if (existing) {
    return fileReservationReplayResult(existing, reservationPayloadHash, actorContext);
  }

  const findDuplicate = dependencies.findIntakeFileReservationByChecksum || findIntakeFileReservationByChecksum;
  const duplicate = await findDuplicate({ organizationId, checksum });
  if (duplicate) {
    const duplicateValidation = await runValidators(
      PRELIMINARY_DUPLICATE_VALIDATORS,
      { checksum, duplicateChecksums: [duplicate.checksum || checksum] },
      { group_key: "reserve_intake_file_metadata_preliminary_duplicate" },
    );
    if (!duplicateValidation.ok) {
      return await toBlockerResponse(duplicateValidation.blockers, actorContext, "reserve_intake_file_metadata", {
        organization_id: organizationId,
        engagement_id: engagementId,
        intake_batch_id: intakeBatchId,
        route: routeName(input.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations"),
        request_id: input.requestId || null,
        duplicate_evaluation: "preliminary_declared_checksum_match",
        storage_checksum_verified: false,
      }, dependencies);
    }
  }

  const fileMetadata = normalizeReservationMetadata({ payload, idempotencyKey, reservationPayloadHash });
  const storageBucket = dependencies.storageBucket || null;
  const storageUri =
    `reservation://kai/${storageProvider}/org/${organizationId}/intake/${intakeBatchId}/${intakeFileId}/${filenameResult.safeFilename}`;

  const insertFile = dependencies.insertIntakeFileMetadata || insertIntakeFileMetadata;
  let row;
  try {
    row = await insertFile({
      intakeFileId,
      intakeBatchId,
      organizationId,
      engagementId,
      originalFilename: input.originalFilename || payload.original_filename || filenameResult.safeFilename,
      safeFilename: filenameResult.safeFilename,
      storageUri,
      storageProvider,
      storageBucket,
      storageObjectKey: objectKeyResult.objectKey,
      mimeType,
      fileExtension: input.fileExtension || payload.file_extension || null,
      fileSizeBytes: input.fileSizeBytes ?? payload.file_size_bytes ?? 0,
      checksum,
      hashAlgorithm,
      rawFileRetained: false,
      filePolicyStatus: "pending",
      malwareScanStatus: "not_configured",
      fileMetadata,
      createdBy: actorContext.actorUserId,
      createdByType: actorContext.actorType,
    });
  } catch (error) {
    if (error !== kaiIdempotentWriteConflict) throw error;
    const conflictedExisting = await findExisting(idempotencyLookup);
    if (!conflictedExisting) return buildKaiError("duplicate_conflict");
    return fileReservationReplayResult(conflictedExisting, reservationPayloadHash, actorContext);
  }

  return {
    ok: true,
    data: responseFile(row),
    warnings: [],
    audit_context: {
      actor_user_id: actorContext.actorUserId,
      actor_type: actorContext.actorType,
      operation: "reserve_intake_file_metadata",
    },
  };
}

export const validateIntakeFileMetadata = reserveIntakeFileMetadata;

export async function uploadReservedIntakeFile(input = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) {
    return buildKaiError("feature_disabled");
  }
  if (!areKaiSprint2UploadFeaturesEnabled(env)) {
    return buildKaiError("feature_disabled", { message: "KAI file upload is not enabled." });
  }

  const auth = await authorizeUploadReservedIntakeFile(input, dependencies);
  if (!auth.ok) return auth;

  const now = resolveUploadNow(input, dependencies);
  if (!now) return buildKaiError("invalid_request", { message: "A deterministic canonical now value is required." });

  const hasBytes = input.bytes !== undefined;
  const hasByteSource = input.byteSource !== undefined;
  const payload = input.payload || {};
  if (
    input.recovery !== undefined ||
    input.objectVersionId !== undefined ||
    input.recoveryObjectVersionId !== undefined ||
    input.sizeBytes !== undefined ||
    input.recoverySizeBytes !== undefined ||
    payload.recovery !== undefined ||
    payload.object_version_id !== undefined ||
    payload.size_bytes !== undefined
  ) {
    return buildKaiError("invalid_request", { message: "Fresh upload attempts must not include recovery input." });
  }
  if (hasBytes === hasByteSource) {
    return buildKaiError("invalid_request", { message: "Fresh upload mode requires exactly one byte input." });
  }

  const lifecycleRepository = dependencies.uploadLifecycleRepository || dependencies.lifecycleRepository;
  if (!lifecycleRepository || typeof lifecycleRepository.transitionUploadLifecycle !== "function") {
    return buildKaiError("storage_provider_not_configured", {
      message: "Upload lifecycle repository is not configured.",
    });
  }

  const storageAdapter = dependencies.storageAdapter;
  if (!storageAdapter) {
    return buildKaiError("storage_provider_not_configured", {
      message: "Upload storage adapter is not configured.",
    });
  }

  const { organizationId, intakeFileId, intakeBatchId } = auth;

  if (typeof storageAdapter.createObjectVersion !== "function") {
    return buildKaiError("storage_provider_not_configured", {
      message: "Upload storage adapter cannot create object versions.",
    });
  }

  let started;
  try {
    started = await lifecycleRepository.transitionUploadLifecycle({
      organizationId,
      intakeFileId,
      expectedUploadState: "reserved",
      newUploadState: "upload_started",
      now,
    });
  } catch {
    return sanitizedPostStartInternalFailure();
  }
  if (started?.ok === false) return started;
  if (started?.ok !== true) return uploadNewReservationRequiredResult();
  if (!validUploadStartedTransitionSuccess(started, { organizationId, intakeFileId })) {
    return uploadNewReservationRequiredResult();
  }
  if (started.data.replayed === true) {
    return uploadNewReservationRequiredResult();
  }

  let storage;
  try {
    storage = await storageAdapter.createObjectVersion({
      ...(hasBytes ? { bytes: input.bytes } : { byteSource: input.byteSource }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch {
    return sanitizedPostStartInternalFailure();
  }
  if (!storage.ok) return sanitizedStorageFailure(storage, { newReservationRequired: true });

  const storageSuccessData = validatedStorageSuccessData(storage);
  if (!storageSuccessData) return sanitizedPostStartInternalFailure();
  const { objectVersionId, sizeBytes } = storageSuccessData;

  let uploaded;
  try {
    uploaded = await lifecycleRepository.transitionUploadLifecycle({
      organizationId,
      intakeFileId,
      expectedUploadState: "upload_started",
      newUploadState: "uploaded_unconfirmed",
      now,
      objectVersionId,
    });
  } catch {
    return uploadNewReservationRequiredResult();
  }
  if (uploaded?.ok !== true) {
    return uploadNewReservationRequiredResult();
  }
  if (!validUploadedUnconfirmedTransitionSuccess(uploaded, { organizationId, intakeFileId, objectVersionId })) {
    return uploadNewReservationRequiredResult();
  }

  return {
    ok: true,
    data: uploadSuccessData({
      organizationId,
      intakeFileId,
      intakeBatchId,
      record: uploaded.data.record,
      objectVersionId,
      sizeBytes,
      replayed: uploaded.data.replayed,
    }),
    warnings: [],
  };
}

export async function requestUploadUrl(dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!areKaiSprint2UploadFeaturesEnabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled", { message: "KAI file upload is not enabled." });
  }
  return buildKaiError("storage_provider_not_configured");
}

export async function confirmUpload(dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!areKaiSprint2UploadFeaturesEnabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled", { message: "KAI file upload is not enabled." });
  }
  return buildKaiError("storage_provider_not_configured");
}
