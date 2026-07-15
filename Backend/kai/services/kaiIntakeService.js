import { createHash, randomUUID } from "crypto";
import {
  areKaiSprint2UploadFeaturesEnabled,
  isKaiSprint2Enabled,
} from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError, validationBlocked } from "../errors/kaiErrors.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import {
  findIntakeBatchByIdempotencyKey,
  findIntakeFileReservationByChecksum,
  findIntakeFileReservationByIdempotencyKey,
  insertIntakeBatchMetadata,
  insertIntakeFileMetadata,
} from "../db/kaiIntakeQueries.js";
import { listIntakeBatchesForOrganization as readIntakeBatchesForOrganization } from "../db/kaiReadModels.js";
import { getEngagementTenantState, getIntakeBatchTenantState } from "../db/kaiQueries.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { validateSafeFilename, buildObjectKey } from "../storage/storagePathPolicy.js";
import {
  validateStorageProviderDbValue,
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
const ALLOWED_METADATA_ONLY_MIME_TYPES = new Set(["text/csv", "application/csv", "text/plain", "application/json"]);
const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;
const STORED_FINGERPRINT_RE = /^[0-9a-f]{64}$/;
const PRELIMINARY_DUPLICATE_VALIDATORS = Object.freeze([duplicate_checksum_blocked]);

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

function hasConflictingFingerprint(row, expectedFingerprint, metadataColumn, fingerprintField) {
  const metadata = row?.[metadataColumn];
  const existingFingerprint = metadata?.[fingerprintField];
  if (typeof existingFingerprint !== "string" || !STORED_FINGERPRINT_RE.test(existingFingerprint)) {
    return true;
  }
  return existingFingerprint !== expectedFingerprint;
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
  const existing = await findExisting({ organizationId, idempotencyKey });
  if (existing) {
    if (hasConflictingFingerprint(existing, normalizedPayloadHash, "batch_metadata", "normalized_payload_hash")) {
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
  const existing = await findExisting({ organizationId, engagementId, intakeBatchId, idempotencyKey });
  if (existing) {
    if (hasConflictingFingerprint(existing, reservationPayloadHash, "file_metadata", "reservation_payload_hash")) {
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
    hashAlgorithm,
    rawFileRetained: false,
    filePolicyStatus: "pending",
    malwareScanStatus: "not_configured",
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
