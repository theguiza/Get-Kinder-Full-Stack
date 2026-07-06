import { createHash, randomUUID } from "crypto";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError, validationBlocked } from "../errors/kaiErrors.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import {
  findIntakeBatchByIdempotencyKey,
  findIntakeFileReservationByIdempotencyKey,
  insertIntakeBatchMetadata,
  insertIntakeFileMetadata,
} from "../db/kaiIntakeQueries.js";
import { getEngagementTenantState, getIntakeBatchTenantState } from "../db/kaiQueries.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { validateSafeFilename, buildObjectKey } from "../storage/storagePathPolicy.js";
import {
  validateFilePolicyStatusTransition,
  validateMalwareScanStatusDbValue,
  validateStorageProviderDbValue,
} from "../validators/stateTransitionValidators.js";
import { recordBlockedAttempt } from "./kaiAuditService.js";

const PASS2_MARKER = "pass2_admin_metadata_intake_verification";
const ALLOWED_METADATA_ONLY_MIME_TYPES = new Set(["text/csv", "application/csv", "text/plain", "application/json"]);

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

function routeName(inputRoute, fallback) {
  return inputRoute || fallback;
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

function hasConflictingFingerprint(row, expectedFingerprint, metadataColumn) {
  const metadata = row?.[metadataColumn] || {};
  const existingFingerprint = metadata.normalized_payload_hash || metadata.reservation_payload_hash;
  return existingFingerprint && existingFingerprint !== expectedFingerprint;
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
  if (safeFilename) return { ok: true, safeFilename };
  const original = String(originalFilename || "").trim();
  if (!original || original.includes("/") || original.includes("\\") || original.includes("..")) {
    return { ok: false, error_code: "unsafe_filename" };
  }
  const extension = String(fileExtension || "").trim().toLowerCase();
  const normalized = original
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9.]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .replace(/^_+|_+$/g, "");
  const candidate = extension && !normalized.endsWith(extension) ? `${normalized}${extension}` : normalized;
  return { ok: true, safeFilename: candidate };
}

function normalizeReservationMetadata({ payload, idempotencyKey, reservationPayloadHash }) {
  return {
    ...(payload.reservation_metadata && typeof payload.reservation_metadata === "object" ? payload.reservation_metadata : {}),
    ...(payload.file_metadata && typeof payload.file_metadata === "object" ? payload.file_metadata : {}),
    p0_pass: PASS2_MARKER,
    synthetic_only: true,
    raw_upload_enabled: false,
    signed_url_enabled: false,
    no_raw_object_created: true,
    checksum_scope: "metadata_reservation_no_raw_file",
    idempotency_key: idempotencyKey || null,
    reservation_payload_hash: reservationPayloadHash,
  };
}

function reservationPayloadFingerprint({ organizationId, engagementId, intakeBatchId, idempotencyKey, payload, safeFilename }) {
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
    storage_provider: row?.storage_provider,
    storage_bucket: row?.storage_bucket || null,
    storage_object_key: row?.storage_object_key,
    file_policy_status: row?.file_policy_status,
    malware_scan_status: row?.malware_scan_status,
    processing_status: row?.processing_status,
    parse_status: row?.parse_status,
    review_status: row?.review_status,
    metadata_only: true,
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

  const normalizedPayloadHash = batchPayloadFingerprint({ organizationId, engagementId, batchCode, idempotencyKey, payload });
  const findExisting = dependencies.findIntakeBatchByIdempotencyKey || findIntakeBatchByIdempotencyKey;
  const existing = await findExisting({ organizationId, idempotencyKey });
  if (existing) {
    if (hasConflictingFingerprint(existing, normalizedPayloadHash, "batch_metadata")) {
      return buildKaiError("duplicate_conflict");
    }
    return {
      ok: true,
      data: responseBatch(existing),
      warnings: [],
      audit_context: {
        actor_user_id: actorContext.actorUserId,
        actor_type: actorContext.actorType,
        operation: "create_intake_batch",
      },
    };
  }

  const insertBatch = dependencies.insertIntakeBatchMetadata || insertIntakeBatchMetadata;
  const row = await insertBatch({
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
    ? await dependencies.getIntakeBatchTenantState(intakeBatchId)
    : await getIntakeBatchTenantState(intakeBatchId);
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
    safeFilename: input.safeFilename || payload.safe_filename,
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
  const objectKeyResult = buildObjectKey({
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

  const statusResult = validateFilePolicyStatusTransition({ from: "pending", to: input.filePolicyStatus || "skipped" });
  if (statusResult.severity === "blocker") {
    return await toBlockerResponse([statusResult], actorContext, "reserve_intake_file_metadata", {
      organization_id: organizationId,
      engagement_id: engagementId,
      route: routeName(input.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations"),
      request_id: input.requestId || null,
    }, dependencies);
  }

  const storageProvider = input.storageProvider || payload.storage_provider || "gcs";
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

  const malwareScanStatus = input.malwareScanStatus || payload.malware_scan_status || "skipped";
  const malwareScanStatusResult = validateMalwareScanStatusDbValue({ malwareScanStatus });
  if (malwareScanStatusResult.severity === "blocker") {
    return await toBlockerResponse([malwareScanStatusResult], actorContext, "reserve_intake_file_metadata", {
      organization_id: organizationId,
      engagement_id: engagementId,
      intake_batch_id: intakeBatchId,
      route: routeName(input.route, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations"),
      request_id: input.requestId || null,
    }, dependencies);
  }

  const reservationPayloadHash = reservationPayloadFingerprint({
    organizationId,
    engagementId,
    intakeBatchId,
    idempotencyKey,
    payload,
    safeFilename: filenameResult.safeFilename,
  });
  const findExisting = dependencies.findIntakeFileReservationByIdempotencyKey || findIntakeFileReservationByIdempotencyKey;
  const existing = await findExisting({ organizationId, engagementId, intakeBatchId, idempotencyKey });
  if (existing) {
    if (hasConflictingFingerprint(existing, reservationPayloadHash, "file_metadata")) {
      return buildKaiError("duplicate_conflict");
    }
    return {
      ok: true,
      data: responseFile(existing),
      warnings: [],
      audit_context: {
        actor_user_id: actorContext.actorUserId,
        actor_type: actorContext.actorType,
        operation: "reserve_intake_file_metadata",
      },
    };
  }

  const fileMetadata = normalizeReservationMetadata({ payload, idempotencyKey, reservationPayloadHash });
  const checksum = input.checksum || payload.checksum || sha256(fileMetadata);
  const storageBucket = input.storageBucket || payload.storage_bucket || null;
  const storageUri =
    input.storageUri ||
    `reservation://kai/${storageProvider}/org/${organizationId}/intake/${intakeBatchId}/${intakeFileId}/${filenameResult.safeFilename}`;

  const insertFile = dependencies.insertIntakeFileMetadata || insertIntakeFileMetadata;
  const row = await insertFile({
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
    hashAlgorithm: input.hashAlgorithm || payload.hash_algorithm || "sha256",
    rawFileRetained: false,
    filePolicyStatus: input.filePolicyStatus || "skipped",
    malwareScanStatus,
    fileMetadata,
    createdBy: actorContext.actorUserId,
    createdByType: actorContext.actorType,
  });

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

export async function requestUploadUrl(dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  return buildKaiError("storage_provider_not_configured");
}
