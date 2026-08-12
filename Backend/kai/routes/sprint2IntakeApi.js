import express from "express";
import { KAI_ERROR_STATUS, sendKaiError } from "../errors/kaiErrors.js";
import {
  areKaiSprint2UploadFeaturesEnabled,
  requireKaiSprint2Enabled,
} from "../config/kaiSprint2Config.js";
import { isKaiGateC1GcsProviderEnabled } from "../config/kaiSprint2GcsConfig.js";
import {
  KAI_SPRINT2_P0_CONTRACT_VERSION,
  KAI_SPRINT2_P0_PATTERNS,
} from "../config/kaiSprint2P0Contract.js";
import {
  attachKaiSprint2UploadByteSource,
  requireKaiSprint2UploadMediaType,
  setKaiSprint2NoStore,
} from "../middleware/kaiSprint2RequestSafety.js";
import {
  validateCompleteExportReviewRequest,
  validateIntakeBatchFilesQuery,
  validateFilePolicyBlockRequest,
  validateKaiSprint2MutationRequest,
  validateReviewQueueQuery,
  validateReviewQueueStatusRequest,
  validateStartExportReviewRequest,
} from "../validators/kaiSprint2RequestSchemas.js";
import {
  validateReviewCockpitQueueQuery,
  validateSourceCandidateDecisionRequest,
} from "../validators/kaiReviewCockpitRequestSchemas.js";

const router = express.Router();
let intakeServiceOverride = null;
let intakeServicePromise = null;
let reviewQueueServicePromise = null;
let reviewCockpitServicePromise = null;
let exportReviewServicePromise = null;

export function sendServiceResult(res, result, successStatus = 200) {
  if (result?.ok) {
    return res.status(successStatus).json({
      ok: true,
      data: result?.data ?? null,
      warnings: sanitizeServiceWarnings(result?.warnings),
    });
  }

  const requestedCode = result?.error?.code;
  const code = requestedCode && Object.hasOwn(KAI_ERROR_STATUS, requestedCode)
    ? requestedCode
    : "system_error";
  const includeExpectedDetails = code !== "system_error";
  return sendKaiError(res, code, {
    data: sanitizeServiceData(result?.data),
    blockers: includeExpectedDetails ? sanitizeServiceBlockers(result?.blockers) : [],
    warnings: includeExpectedDetails ? sanitizeServiceWarnings(result?.warnings) : [],
  });
}

const EXACT_VERIFICATION_PHASE_PATTERN =
  /^(confirm_upload_authorization|upload_lifecycle_read|gcs_generation_binding_lookup|gcs_head_object|gcs_stat_exact_generation|gcs_open_exact_generation|gcs_stream_exact_generation|gcs_size_check|gcs_checksum_check|gcs_lifecycle_start|gcs_lifecycle_complete|gcs_generation_bind|gcs_lifecycle_confirm|confirm_upload_route_service)$/;

const SAFE_SERVICE_WARNING_MESSAGES = Object.freeze({
  blocked_attempt_audit_not_written: "Blocked-attempt audit was not written.",
  blocked_attempt_audit_failed: "Blocked-attempt audit failed without changing the validator response.",
});

function sanitizeServiceWarnings(warnings) {
  if (!Array.isArray(warnings)) return [];
  return warnings.flatMap((warning) => {
    const code = typeof warning?.code === "string" ? warning.code : "";
    const message = SAFE_SERVICE_WARNING_MESSAGES[code];
    return message ? [{ code, message }] : [];
  });
}

function sanitizeServiceBlockers(blockers) {
  if (!Array.isArray(blockers)) return [];
  return blockers.flatMap((blocker) => {
    if (!blocker || typeof blocker !== "object" || Array.isArray(blocker)) return [];
    return [{
      validator_key: String(blocker.validator_key || "VAL-SYS-P0-001").slice(0, 64),
      severity: "blocker",
      object_type: String(blocker.object_type || "request").slice(0, 64),
      object_code: String(blocker.object_code || "request").slice(0, 64),
      object_id: null,
      message: String(blocker.message || "Request failed KAI validation.").slice(0, 200),
      blocking_reason: String(blocker.blocking_reason || "validation_blocker").slice(0, 64),
      required_fix: String(blocker.required_fix || "Correct the request and retry.").slice(0, 1000),
      evidence: {},
    }];
  });
}

function sanitizeServiceData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const sanitized = {};
  if (typeof data.operation === "string") sanitized.operation = data.operation.slice(0, 64);
  if (data.provider === "gcs" || data.provider === "disabled") sanitized.provider = data.provider;
  if (typeof data.contract === "string" && /^[-_a-zA-Z0-9.]{1,128}$/.test(data.contract)) {
    sanitized.contract = data.contract;
  }
  if (
    typeof data.failure_phase === "string"
    && /^(initialize_storage_client|resolve_signing_context|sign_v4_string)$/.test(data.failure_phase)
  ) {
    sanitized.failure_phase = data.failure_phase;
  }
  if (
    typeof data.exact_verification_phase === "string"
    && EXACT_VERIFICATION_PHASE_PATTERN.test(data.exact_verification_phase)
  ) {
    sanitized.exact_verification_phase = data.exact_verification_phase;
  }
  if (
    typeof data.gcs_head_object_failure_code === "string"
    && /^(operation_not_enabled|validation_blocker|system_error|not_found|unhandled_exception|unclassified)$/.test(data.gcs_head_object_failure_code)
  ) {
    sanitized.gcs_head_object_failure_code = data.gcs_head_object_failure_code;
  }
  if (
    typeof data.gcs_head_object_failure_reason === "string"
    && /^(generation_unusable|size_unusable|provider_exception)$/.test(data.gcs_head_object_failure_reason)
  ) {
    sanitized.gcs_head_object_failure_reason = data.gcs_head_object_failure_reason;
  }
  if (
    typeof data.diagnostic_code === "string"
    && /^(source_credentials_unavailable|source_credentials_rejected|signing_unauthenticated|signing_permission_denied|signing_target_not_found|provider_unavailable_rate_limited|unclassified_signing_failure)$/.test(data.diagnostic_code)
  ) {
    sanitized.diagnostic_code = data.diagnostic_code;
  }
  if (
    Number.isSafeInteger(data.provider_http_status)
    && data.provider_http_status >= 100
    && data.provider_http_status <= 599
  ) {
    sanitized.provider_http_status = data.provider_http_status;
  }
  if (typeof data.provider_status === "string" && /^[A-Z_]{1,64}$/.test(data.provider_status)) {
    sanitized.provider_status = data.provider_status;
  }
  for (const key of [
    "storage_provider_enabled",
    "raw_upload_enabled",
    "signed_upload_enabled",
    "signed_read_enabled",
    "upload_confirmation_enabled",
  ]) {
    if (typeof data[key] === "boolean") sanitized[key] = data[key];
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function safeAuthenticatedUser(req = {}) {
  const user = req?.["user"];
  if (!user || typeof user !== "object" || Array.isArray(user)) return null;
  return {
    id: user.id,
  };
}

function requestPayload(req = {}) {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
}

function safeRequestId(req = {}) {
  const value = req.id || req.get?.("x-request-id") || req.headers?.["x-request-id"];
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(value) ? value : null;
}

function safeHeaderId(req = {}, headerName) {
  const value = req.get?.(headerName) || req.headers?.[String(headerName).toLowerCase()];
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value) ? value : null;
}

function safeOrganizationIdForLog(req = {}) {
  const payload = requestPayload(req);
  const value = normalizedUuid(req.query?.organization_id || payload.organization_id);
  return KAI_SPRINT2_P0_PATTERNS.uuid.test(value) ? value : null;
}

function safeRoutePathForLog(req = {}) {
  const value = typeof req.path === "string" ? req.path : "";
  return /^\/[-_a-zA-Z0-9/:.]{0,255}$/.test(value) ? value : null;
}

function safeKaiResponseSummary(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      errorCode: null,
      exactVerificationPhase: null,
      gcsHeadObjectFailureCode: null,
      gcsHeadObjectFailureReason: null,
      providerHttpStatus: null,
      providerStatus: null,
    };
  }
  const errorCode = typeof body.error?.code === "string" && Object.hasOwn(KAI_ERROR_STATUS, body.error.code)
    ? body.error.code
    : null;
  const exactVerificationPhase =
    typeof body.data?.exact_verification_phase === "string"
    && EXACT_VERIFICATION_PHASE_PATTERN.test(body.data.exact_verification_phase)
      ? body.data.exact_verification_phase
      : null;
  const gcsHeadObjectFailureCode =
    typeof body.data?.gcs_head_object_failure_code === "string"
    && /^(operation_not_enabled|validation_blocker|system_error|not_found|unhandled_exception|unclassified)$/.test(body.data.gcs_head_object_failure_code)
      ? body.data.gcs_head_object_failure_code
      : null;
  const gcsHeadObjectFailureReason =
    typeof body.data?.gcs_head_object_failure_reason === "string"
    && /^(generation_unusable|size_unusable|provider_exception)$/.test(body.data.gcs_head_object_failure_reason)
      ? body.data.gcs_head_object_failure_reason
      : null;
  const providerHttpStatus =
    Number.isSafeInteger(body.data?.provider_http_status)
    && body.data.provider_http_status >= 100
    && body.data.provider_http_status <= 599
      ? body.data.provider_http_status
      : null;
  const providerStatus =
    typeof body.data?.provider_status === "string" && /^[A-Z_]{1,64}$/.test(body.data.provider_status)
      ? body.data.provider_status
      : null;
  return {
    errorCode,
    exactVerificationPhase,
    gcsHeadObjectFailureCode,
    gcsHeadObjectFailureReason,
    providerHttpStatus,
    providerStatus,
  };
}

function logKaiSprint2IntakeRequest(req, res, responseBody) {
  const {
    errorCode,
    exactVerificationPhase,
    gcsHeadObjectFailureCode,
    gcsHeadObjectFailureReason,
    providerHttpStatus,
    providerStatus,
  } = safeKaiResponseSummary(responseBody);
  console.log("[kai-sprint2-intake-route]", {
    method: req.method,
    path: safeRoutePathForLog(req),
    status: res.statusCode,
    "x-request-id": safeRequestId(req),
    "rndr-id": safeHeaderId(req, "rndr-id") || safeHeaderId(req, "x-render-request-id"),
    organization_id: safeOrganizationIdForLog(req),
    "error.code": errorCode,
    exact_verification_phase: exactVerificationPhase,
    gcs_head_object_failure_code: gcsHeadObjectFailureCode,
    gcs_head_object_failure_reason: gcsHeadObjectFailureReason,
    provider_http_status: providerHttpStatus,
    provider_status: providerStatus,
  });
}

function attachTemporarySafeIntakeRouteLogger(req, res, next) {
  let responseBody = null;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };
  res.on("finish", () => logKaiSprint2IntakeRequest(req, res, responseBody));
  next();
}

function requestContext(req = {}, route) {
  const payload = requestPayload(req);
  return {
    req: { user: safeAuthenticatedUser(req) },
    payload,
    organizationId: payload.organization_id,
    engagementId: payload.engagement_id,
    idempotencyKey: payload.idempotency_key || null,
    requestId: safeRequestId(req),
    route,
  };
}

function metadataContentTypeIsSupported(req = {}) {
  const header = req.get?.("content-type") || req.headers?.["content-type"] || "";
  if (!header) return true;
  const mediaType = String(header).split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType);
}

function normalizedUuid(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function batchDetailIdentifiers(req = {}) {
  const organizationId = normalizedUuid(req.query?.organization_id);
  const intakeBatchId = normalizedUuid(req.params?.intakeBatchId);
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId)) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(intakeBatchId)) return null;
  return { organizationId, intakeBatchId };
}

function fileDetailIdentifiers(req = {}) {
  const organizationId = normalizedUuid(req.query?.organization_id);
  const intakeFileId = typeof req.params?.intakeFileId === "string" ? req.params.intakeFileId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId)) return null;
  if (
    !KAI_SPRINT2_P0_PATTERNS.uuid.test(intakeFileId)
    || intakeFileId !== intakeFileId.toLowerCase()
  ) return null;
  return { organizationId, intakeFileId };
}

function uploadIdentifiers(req = {}) {
  const organizationId = normalizedUuid(req.query?.organization_id);
  const engagementId = normalizedUuid(req.query?.engagement_id);
  const intakeBatchId = normalizedUuid(req.query?.intake_batch_id);
  const intakeFileId = typeof req.params?.intakeFileId === "string" ? req.params.intakeFileId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId)) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(engagementId)) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(intakeBatchId)) return null;
  if (
    !KAI_SPRINT2_P0_PATTERNS.uuid.test(intakeFileId)
    || intakeFileId !== intakeFileId.toLowerCase()
  ) return null;
  return { organizationId, engagementId, intakeBatchId, intakeFileId };
}

function validateUploadUrlRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const payload = requestPayload(req);
  const organizationId = normalizedUuid(payload.organization_id);
  const engagementId = normalizedUuid(payload.engagement_id);
  const intakeBatchId = normalizedUuid(req.params?.intakeBatchId);
  const intakeFileId = normalizedUuid(payload.intake_file_id);
  if (
    !KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId)
    || !KAI_SPRINT2_P0_PATTERNS.uuid.test(engagementId)
    || !KAI_SPRINT2_P0_PATTERNS.uuid.test(intakeBatchId)
    || !KAI_SPRINT2_P0_PATTERNS.uuid.test(intakeFileId)
  ) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_engagement_id_batch_id_or_intake_file_id")],
    });
    return null;
  }
  const allowedKeys = new Set(["organization_id", "engagement_id", "intake_file_id"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("unknown_field", "body")],
    });
    return null;
  }
  return { organizationId, engagementId, intakeBatchId, intakeFileId };
}

function validateConfirmUploadRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = fileDetailIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_intake_file_id")],
    });
    return null;
  }
  const payload = requestPayload(req);
  const keys = Object.keys(payload);
  if (
    keys.length !== 1
    || keys[0] !== "organization_id"
    || payload.organization_id !== identifiers.organizationId
  ) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_confirm_upload_request", "body")],
    });
    return null;
  }
  return identifiers;
}

function reviewQueueStatusIdentifiers(req = {}) {
  const organizationId = normalizedUuid(req.query?.organization_id);
  const reviewQueueItemId = typeof req.params?.reviewQueueItemId === "string"
    ? req.params.reviewQueueItemId
    : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId)) return null;
  if (
    !KAI_SPRINT2_P0_PATTERNS.uuid.test(reviewQueueItemId)
    || reviewQueueItemId !== reviewQueueItemId.toLowerCase()
  ) return null;
  return { organizationId, reviewQueueItemId };
}

function validateMutationRequestOrSend(req, res, operation, options = {}) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return false;
  }
  const result = validateKaiSprint2MutationRequest(operation, requestPayload(req), options);
  if (result.ok) return true;
  sendKaiError(res, "invalid_request", { blockers: result.blockers });
  return false;
}

function routeValidationBlocker(blockingReason, objectCode) {
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

function validateFilePolicyBlockRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = fileDetailIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_intake_file_id")],
    });
    return null;
  }
  const result = validateFilePolicyBlockRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

function validateReviewQueueStatusRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = reviewQueueStatusIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_review_queue_item_id")],
    });
    return null;
  }
  const result = validateReviewQueueStatusRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

async function invokeService(res, serviceCall, successStatus = 200, exceptionData = null) {
  try {
    return sendServiceResult(res, await serviceCall(), successStatus);
  } catch {
    if (exceptionData) {
      return sendServiceResult(res, {
        ok: false,
        error: { code: "system_error", status: 500 },
        data: exceptionData,
      });
    }
    return sendKaiError(res, "system_error");
  }
}

async function getIntakeService() {
  if (intakeServiceOverride) return intakeServiceOverride;
  intakeServicePromise ||= import("../services/kaiIntakeRuntimeService.js");
  return intakeServicePromise;
}

async function getReviewQueueService() {
  if (intakeServiceOverride?.updateReviewQueueStatus) return intakeServiceOverride;
  reviewQueueServicePromise ||= import("../services/kaiReviewQueueService.js");
  return reviewQueueServicePromise;
}

async function getReviewCockpitService() {
  reviewCockpitServicePromise ||= import("../services/kaiReviewCockpitService.js");
  return reviewCockpitServicePromise;
}

/**
 * KAI P1-09 internal review-cockpit path identifiers. Every cockpit route requires
 * an explicit, canonically-lowercased organization_id query parameter plus a
 * canonically-lowercased object identifier: there is no implicit tenant scope, and
 * no identifier is ever coerced into a different case or shape.
 */
function reviewCockpitIdentifiers(req = {}, parameterName) {
  const organizationId = normalizedUuid(req.query?.organization_id);
  const objectId = typeof req.params?.[parameterName] === "string" ? req.params[parameterName] : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId)) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(objectId) || objectId !== objectId.toLowerCase()) return null;
  return { organizationId, objectId };
}

function exportReviewPacketIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const generatedContentDraftId = typeof req.params?.generatedContentDraftId === "string"
    ? req.params.generatedContentDraftId
    : "";
  const exportReviewQueueItemId = typeof req.params?.exportReviewQueueItemId === "string"
    ? req.params.exportReviewQueueItemId
    : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(generatedContentDraftId) || generatedContentDraftId !== generatedContentDraftId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(exportReviewQueueItemId) || exportReviewQueueItemId !== exportReviewQueueItemId.toLowerCase()) return null;
  return { organizationId, generatedContentDraftId, exportReviewQueueItemId };
}

function sprint2MappedActorContext(req = {}) {
  return req.kaiSprint2ActorContext;
}

router.use(requireKaiSprint2Enabled);
router.use(setKaiSprint2NoStore);
router.use(attachTemporarySafeIntakeRouteLogger);

function statusData(env = process.env) {
  const uploadFeaturesEnabled = areKaiSprint2UploadFeaturesEnabled(env);
  const storageProviderEnabled = isKaiGateC1GcsProviderEnabled(env);
  return {
    feature_enabled: true,
    route: "/api/kai/sprint2/intake",
    mode: "admin_metadata_only",
    contract: `kai_sprint2_p0_repository_contract_v${KAI_SPRINT2_P0_CONTRACT_VERSION}`,
    metadata_write_enabled: true,
    file_upload_enabled: uploadFeaturesEnabled,
    upload_confirmation_enabled: uploadFeaturesEnabled,
    storage_provider_enabled: storageProviderEnabled,
    storage_upload_enabled: uploadFeaturesEnabled,
    signed_upload_enabled: uploadFeaturesEnabled && storageProviderEnabled,
    signed_read_enabled: false,
    parser_worker_enabled: false,
    profiling_enabled: false,
    data_dictionary_generation_enabled: false,
    source_promotion_enabled: false,
    evidence_creation_enabled: false,
    claim_creation_enabled: false,
    generation_enabled: false,
    export_enabled: false,
    client_review_enabled: false,
  };
}

export function sendStatus(req, res) {
  return res.json({
    ok: true,
    data: statusData(req?.kaiSprint2StatusEnv || process.env),
    warnings: [],
  });
}

router.get("/status", sendStatus);

router.get("/admin/access-check", async (req, res) => {
  const payload = requestPayload(req);
  return invokeService(res, async () => {
    const service = await getIntakeService();
    return service.checkAdminAccess({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/access-check"),
      organizationId: req.query?.organization_id || payload.organization_id,
      engagementId: req.query?.engagement_id || payload.engagement_id,
    });
  });
});

router.get("/admin/batches", async (req, res) => {
  return invokeService(res, async () => {
    const service = await getIntakeService();
    return service.listIntakeBatchesForOrganization({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/batches"),
      organizationId: req.query?.organization_id,
    });
  });
});

router.get("/admin/batches/:intakeBatchId", async (req, res) => {
  const identifiers = batchDetailIdentifiers(req);
  if (!identifiers) return sendKaiError(res, "invalid_request");
  return invokeService(res, async () => {
    const service = await getIntakeService();
    return service.getIntakeBatchDetail({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId"),
      ...identifiers,
    });
  });
});

router.get("/admin/batches/:intakeBatchId/files", async (req, res) => {
  const identifiers = batchDetailIdentifiers(req);
  const queryResult = validateIntakeBatchFilesQuery(req.query);
  if (!identifiers || !queryResult.ok) return sendKaiError(res, "invalid_request");
  return invokeService(res, async () => {
    const service = await getIntakeService();
    return service.listIntakeFilesForBatch({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/files"),
      ...identifiers,
      pagination: queryResult.pagination,
    });
  });
});

router.get("/admin/files/:intakeFileId", async (req, res) => {
  const identifiers = fileDetailIdentifiers(req);
  if (!identifiers) return sendKaiError(res, "invalid_request");
  return invokeService(res, async () => {
    const service = await getIntakeService();
    return service.getIntakeFileDetail({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/files/:intakeFileId"),
      ...identifiers,
    });
  });
});

router.post("/admin/files/:intakeFileId/block", async (req, res) => {
  const identifiers = validateFilePolicyBlockRequestOrSend(req, res);
  if (!identifiers) return;
  const payload = requestPayload(req);
  return invokeService(res, async () => {
    const service = await getIntakeService();
    return service.markIntakeFilePolicyBlocked({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/files/:intakeFileId/block"),
      ...identifiers,
      expectedFilePolicyStatus: payload.expected_file_policy_status,
      blockingReasonCode: payload.blocking_reason_code,
    });
  });
});

router.post(
  "/admin/files/:intakeFileId/upload",
  requireKaiSprint2UploadMediaType,
  attachKaiSprint2UploadByteSource(),
  async (req, res) => {
    const identifiers = uploadIdentifiers(req);
    if (!identifiers) return sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_engagement_id_batch_id_or_intake_file_id")],
    });
    return invokeService(res, async () => {
      const service = await getIntakeService();
      return service.uploadReservedIntakeFile({
        ...requestContext(req, "/api/kai/sprint2/intake/admin/files/:intakeFileId/upload"),
        ...identifiers,
        byteSource: req.kaiSprint2UploadByteSource,
        signal: req.kaiSprint2UploadSignal,
      });
    }, 201);
  },
);

router.post("/admin/files/:intakeFileId/confirm-upload", async (req, res) => {
  const identifiers = validateConfirmUploadRequestOrSend(req, res);
  if (!identifiers) return;
  return invokeService(res, async () => {
    const service = await getIntakeService();
    return service.confirmUpload({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/files/:intakeFileId/confirm-upload"),
      ...identifiers,
      now: new Date().toISOString(),
    });
  }, 200, { exact_verification_phase: "confirm_upload_route_service" });
});

router.post("/admin/batches/:intakeBatchId/files/upload-url", async (req, res) => {
  const identifiers = validateUploadUrlRequestOrSend(req, res);
  if (!identifiers) return;
  return invokeService(res, async () => {
    const service = await getIntakeService();
    return service.requestUploadUrl({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/files/upload-url"),
      ...identifiers,
    });
  });
});

router.get("/admin/review-queue", async (req, res) => {
  const organizationId = normalizedUuid(req.query?.organization_id);
  const queryResult = validateReviewQueueQuery(req.query);
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || !queryResult.ok) {
    return sendKaiError(res, "invalid_request");
  }
  return invokeService(res, async () => {
    const service = await getIntakeService();
    return service.listIntakeFileReviewQueueItems({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/review-queue"),
      organizationId,
      pagination: queryResult.pagination,
    });
  });
});

router.post("/admin/review-queue/:reviewQueueItemId/status", async (req, res) => {
  const identifiers = validateReviewQueueStatusRequestOrSend(req, res);
  if (!identifiers) return;
  const payload = requestPayload(req);
  return invokeService(res, async () => {
    const service = await getReviewQueueService();
    return service.updateReviewQueueStatus({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/review-queue/:reviewQueueItemId/status"),
      ...identifiers,
      expectedQueueStatus: payload.expected_queue_status,
      newQueueStatus: payload.new_queue_status,
    });
  });
});

/**
 * KAI P1-09 internal review-cockpit routes.
 *
 * Internal, GK-authenticated only. These handlers contain no SQL, import no
 * database pool, touch no `kai.*` schema object directly, and call no KAI DB
 * helper: each one validates its request shape and then calls exactly one
 * authorized service function, which performs its own feature gating, actor/role/
 * tenant authorization, tenant-scoped reads, and response DTO allowlisting.
 *
 * All four are already behind this router's `requireKaiSprint2Enabled` gate (and
 * the mount-level gate in index.js), so KAI_SPRINT2_ENABLED gates every one of
 * them. The decision route additionally requires KAI_SOURCE_PROMOTION_ENABLED,
 * enforced inside the service, which returns the canonical feature_disabled result
 * rather than an error or a partial write when that flag is off. The three
 * read-only routes remain available under KAI_SPRINT2_ENABLED alone.
 */
router.get("/admin/review-cockpit/queue", async (req, res) => {
  const organizationId = normalizedUuid(req.query?.organization_id);
  const queryResult = validateReviewCockpitQueueQuery(req.query);
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || !queryResult.ok) {
    return sendKaiError(res, "invalid_request");
  }
  return invokeService(res, async () => {
    const service = await getReviewCockpitService();
    return service.listReviewCockpitQueue({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/review-cockpit/queue"),
      organizationId,
      selection: queryResult.selection,
    });
  });
});

router.get("/admin/review-cockpit/file-profiles/:fileProfileId", async (req, res) => {
  const identifiers = reviewCockpitIdentifiers(req, "fileProfileId");
  if (!identifiers) return sendKaiError(res, "invalid_request");
  return invokeService(res, async () => {
    const service = await getReviewCockpitService();
    return service.getReviewCockpitFileProfileDetail({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/review-cockpit/file-profiles/:fileProfileId"),
      organizationId: identifiers.organizationId,
      fileProfileId: identifiers.objectId,
    });
  });
});

router.get("/admin/review-cockpit/source-candidates/:intakeSourceCandidateId", async (req, res) => {
  const identifiers = reviewCockpitIdentifiers(req, "intakeSourceCandidateId");
  if (!identifiers) return sendKaiError(res, "invalid_request");
  return invokeService(res, async () => {
    const service = await getReviewCockpitService();
    return service.getReviewCockpitSourceCandidateDetail({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/review-cockpit/source-candidates/:intakeSourceCandidateId"),
      organizationId: identifiers.organizationId,
      intakeSourceCandidateId: identifiers.objectId,
    });
  });
});

router.post("/admin/review-cockpit/source-candidates/:intakeSourceCandidateId/decision", async (req, res) => {
  if (!metadataContentTypeIsSupported(req)) return sendKaiError(res, "unsupported_media_type");
  const identifiers = reviewCockpitIdentifiers(req, "intakeSourceCandidateId");
  if (!identifiers) {
    return sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_intake_source_candidate_id")],
    });
  }
  const bodyResult = validateSourceCandidateDecisionRequest(req.body);
  if (!bodyResult.ok) {
    return sendKaiError(res, "validation_blocker", { blockers: bodyResult.blockers });
  }
  return invokeService(res, async () => {
    const service = await getReviewCockpitService();
    return service.submitSourceCandidateDecision({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/review-cockpit/source-candidates/:intakeSourceCandidateId/decision"),
      organizationId: identifiers.organizationId,
      intakeSourceCandidateId: identifiers.objectId,
      payload: requestPayload(req),
    });
  });
});

async function getExportReviewService() {
  if (
    intakeServiceOverride?.getGeneratedDraftExportReviewPacket
    || intakeServiceOverride?.startGeneratedDraftExportReview
    || intakeServiceOverride?.completeGeneratedDraftExportReview
  ) return intakeServiceOverride;
  exportReviewServicePromise ||= import("../services/kaiExportReviewService.js");
  return exportReviewServicePromise;
}

router.get(
  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-queue/:exportReviewQueueItemId/packet",
  async (req, res) => {
    const identifiers = exportReviewPacketIdentifiers(req);
    if (!identifiers) return sendKaiError(res, "invalid_request");
    return invokeService(res, async () => {
      const service = await getExportReviewService();
      return service.getGeneratedDraftExportReviewPacket({
        organizationId: req.params.organizationId,
        generatedContentDraftId: req.params.generatedContentDraftId,
        exportReviewQueueItemId: req.params.exportReviewQueueItemId,
        actorContext: sprint2MappedActorContext(req),
      });
    });
  },
);

function validateStartExportReviewRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = exportReviewPacketIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field",
        "organization_id_generated_content_draft_id_or_export_review_queue_item_id",
      )],
    });
    return null;
  }
  const result = validateStartExportReviewRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

router.post(
  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-queue/:exportReviewQueueItemId/start",
  async (req, res) => {
    const identifiers = validateStartExportReviewRequestOrSend(req, res);
    if (!identifiers) return;
    const payload = requestPayload(req);
    return invokeService(res, async () => {
      const service = await getExportReviewService();
      return service.startGeneratedDraftExportReview({
        organizationId: identifiers.organizationId,
        generatedContentDraftId: identifiers.generatedContentDraftId,
        exportReviewQueueItemId: identifiers.exportReviewQueueItemId,
        expectedUpdatedAt: payload.expected_updated_at,
        actorContext: sprint2MappedActorContext(req),
        now: new Date().toISOString(),
      });
    });
  },
);

function validateCompleteExportReviewRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = exportReviewPacketIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field",
        "organization_id_generated_content_draft_id_or_export_review_queue_item_id",
      )],
    });
    return null;
  }
  const result = validateCompleteExportReviewRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

router.post(
  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-queue/:exportReviewQueueItemId/complete",
  async (req, res) => {
    const identifiers = validateCompleteExportReviewRequestOrSend(req, res);
    if (!identifiers) return;
    const payload = requestPayload(req);
    return invokeService(res, async () => {
      const service = await getExportReviewService();
      return service.completeGeneratedDraftExportReview({
        organizationId: identifiers.organizationId,
        generatedContentDraftId: identifiers.generatedContentDraftId,
        exportReviewQueueItemId: identifiers.exportReviewQueueItemId,
        expectedUpdatedAt: payload.expected_updated_at,
        actorContext: sprint2MappedActorContext(req),
        now: new Date().toISOString(),
      });
    });
  },
);

router.post("/admin/batches", async (req, res) => {
  const payload = requestPayload(req);
  if (!validateMutationRequestOrSend(req, res, "create_intake_batch")) return;
  return invokeService(res, async () => {
    const service = await getIntakeService();
    return service.createIntakeBatch({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/batches"),
      batchCode: payload.batch_code,
      sourceSystemName: payload.source_system_name || null,
      sourceSystemRef: payload.source_system_ref || null,
      notes: payload.notes || null,
    });
  }, 201);
});

router.post("/admin/batches/:intakeBatchId/file-reservations", async (req, res) => {
  if (req.is?.("multipart/form-data")) {
    return sendKaiError(res, "unsupported_media_type", {
      message: "Raw file upload is disabled for KAI Sprint 2 P0 Pass 1D.",
    });
  }

  const payload = requestPayload(req);
  if (!validateMutationRequestOrSend(req, res, "reserve_intake_file_metadata", {
    intakeBatchId: req.params?.intakeBatchId,
  })) return;
  return invokeService(res, async () => {
    const service = await getIntakeService();
    return service.reserveIntakeFileMetadata({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations"),
      intakeBatchId: req.params?.intakeBatchId,
      originalFilename: payload.original_filename,
      fileExtension: payload.file_extension,
      mimeType: payload.mime_type,
      fileSizeBytes: payload.file_size_bytes,
      checksum: payload.checksum,
      hashAlgorithm: payload.hash_algorithm,
    });
  }, 201);
});

export default router;

export const __testables = {
  requestContext,
  requestPayload,
  safeAuthenticatedUser,
  batchDetailIdentifiers,
  fileDetailIdentifiers,
  uploadIdentifiers,
  reviewQueueStatusIdentifiers,
  validateIntakeBatchFilesQuery,
  validateReviewQueueQuery,
  validateReviewQueueStatusRequest,
  sendServiceResult,
  sanitizeServiceBlockers,
  sanitizeServiceWarnings,
  metadataContentTypeIsSupported,
  validateMutationRequestOrSend,
  validateFilePolicyBlockRequestOrSend,
  validateUploadUrlRequestOrSend,
  validateConfirmUploadRequestOrSend,
  validateReviewQueueStatusRequestOrSend,
  reviewCockpitIdentifiers,
  exportReviewPacketIdentifiers,
  sprint2MappedActorContext,
  validateStartExportReviewRequestOrSend,
  validateCompleteExportReviewRequestOrSend,
  setIntakeServiceForTest(service) {
    intakeServiceOverride = service;
    return () => {
      intakeServiceOverride = null;
    };
  },
};
