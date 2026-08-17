import express from "express";
import { KAI_ERROR_STATUS, sendKaiError } from "../errors/kaiErrors.js";
import {
  areKaiSprint2UploadFeaturesEnabled,
  areKaiSprint2WorkerFeaturesEnabled,
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
  validateCompleteClaimReviewRequest,
  validateCompleteClientFollowupRequest,
  validateCompleteEvidenceReviewRequest,
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
import {
  createProductionMetadataOnlyAuditForClaimGapFollowup,
  createProductionMetadataOnlyAuditForClaimProposal,
  createProductionMetadataOnlyAuditForClaimReview,
  createProductionMetadataOnlyAuditForClientFollowupCompletion,
  createProductionMetadataOnlyAuditForConflictReviewCandidate,
  createProductionMetadataOnlyAuditForCoverageReviewDecision,
  createProductionMetadataOnlyAuditForEvidenceReview,
  createProductionMetadataOnlyAuditForGeneratedContentDraft,
  createProductionMetadataOnlyAuditForGeneratedContentReview,
  createProductionMetadataOnlyAuditForSourceVersion,
} from "../services/kaiMetadataOnlyAuditComposition.js";

const router = express.Router();
let intakeServiceOverride = null;
let intakeServicePromise = null;
let reviewQueueServicePromise = null;
let reviewCockpitServicePromise = null;
let exportReviewServicePromise = null;
let evidenceLineageServicePromise = null;
let evidenceCoverageAssessmentServicePromise = null;
let claimProposalServicePromise = null;
let claimGapFollowupServicePromise = null;
let conflictReviewCandidateServicePromise = null;
let generatedContentServicePromise = null;

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
  if (
    typeof data.google_api === "string"
    && /^(iamcredentials|storage|sts|oauth|unknown)$/.test(data.google_api)
  ) {
    sanitized.google_api = data.google_api;
  }
  if (typeof data.error_info_reason === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(data.error_info_reason)) {
    sanitized.error_info_reason = data.error_info_reason;
  }
  if (
    typeof data.error_info_domain === "string"
    && /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/.test(data.error_info_domain)
  ) {
    sanitized.error_info_domain = data.error_info_domain;
  }
  if (
    typeof data.error_info_service === "string"
    && /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/.test(data.error_info_service)
  ) {
    sanitized.error_info_service = data.error_info_service;
  }
  if (
    typeof data.error_info_permission === "string"
    && /^[a-zA-Z0-9_]{1,64}(?:\.[a-zA-Z0-9_]{1,64}){1,4}$/.test(data.error_info_permission)
  ) {
    sanitized.error_info_permission = data.error_info_permission;
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
      googleApi: null,
      errorInfoReason: null,
      errorInfoDomain: null,
      errorInfoService: null,
      errorInfoPermission: null,
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
  const googleApi =
    typeof body.data?.google_api === "string" && /^(iamcredentials|storage|sts|oauth|unknown)$/.test(body.data.google_api)
      ? body.data.google_api
      : null;
  const errorInfoReason =
    typeof body.data?.error_info_reason === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(body.data.error_info_reason)
      ? body.data.error_info_reason
      : null;
  const errorInfoDomain =
    typeof body.data?.error_info_domain === "string"
    && /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/.test(body.data.error_info_domain)
      ? body.data.error_info_domain
      : null;
  const errorInfoService =
    typeof body.data?.error_info_service === "string"
    && /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/.test(body.data.error_info_service)
      ? body.data.error_info_service
      : null;
  const errorInfoPermission =
    typeof body.data?.error_info_permission === "string"
    && /^[a-zA-Z0-9_]{1,64}(?:\.[a-zA-Z0-9_]{1,64}){1,4}$/.test(body.data.error_info_permission)
      ? body.data.error_info_permission
      : null;
  return {
    errorCode,
    exactVerificationPhase,
    gcsHeadObjectFailureCode,
    gcsHeadObjectFailureReason,
    providerHttpStatus,
    providerStatus,
    googleApi,
    errorInfoReason,
    errorInfoDomain,
    errorInfoService,
    errorInfoPermission,
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
    googleApi,
    errorInfoReason,
    errorInfoDomain,
    errorInfoService,
    errorInfoPermission,
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
    google_api: googleApi,
    error_info_reason: errorInfoReason,
    error_info_domain: errorInfoDomain,
    error_info_service: errorInfoService,
    error_info_permission: errorInfoPermission,
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
  } catch (error) {
    console.error("[kai-sprint2-intake] system_error", error);
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
  const workerFeaturesEnabled = areKaiSprint2WorkerFeaturesEnabled(env);
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
    parser_worker_enabled: workerFeaturesEnabled,
    profiling_enabled: workerFeaturesEnabled,
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

let engagementContextServicePromise = null;
async function getEngagementContextService() {
  if (intakeServiceOverride?.listAuthorizedEngagements) return intakeServiceOverride;
  engagementContextServicePromise ||= import("../services/kaiEngagementContextService.js");
  return engagementContextServicePromise;
}

let organizationContextServicePromise = null;
async function getOrganizationContextService() {
  if (intakeServiceOverride?.listAuthorizedOrganizations) return intakeServiceOverride;
  organizationContextServicePromise ||= import("../services/kaiOrganizationContextService.js");
  return organizationContextServicePromise;
}

let organizationEnablementServicePromise = null;
async function getOrganizationEnablementService() {
  if (intakeServiceOverride?.enableKaiForOrganization) return intakeServiceOverride;
  organizationEnablementServicePromise ||= import("../services/kaiOrganizationEnablementService.js");
  return organizationEnablementServicePromise;
}

const GK_ORGANIZATION_ID_PATTERN = /^[1-9][0-9]{0,9}$/;

/**
 * KAI Web Intake organization-bootstrap read: the authenticated actor's own
 * organizations authorized for ordinary intake, so the browser never has to
 * know or type an organization id. Read-only, derived entirely from the
 * freshly resolved server-side actor context - the caller supplies nothing
 * that could steer which organizations come back.
 */
router.get("/admin/organizations", async (req, res) => {
  return invokeService(res, async () => {
    const service = await getOrganizationContextService();
    return service.listAuthorizedOrganizations({ req: { user: safeAuthenticatedUser(req) } });
  });
});

/**
 * KAI intake-context read: existing tenant-authoritative engagement contexts
 * for an organization, so the Web Intake UI never has to fabricate one.
 * Read-only; gated the same as `create_intake_batch` (enforced inside the
 * service, not here).
 */
router.get("/admin/organizations/:organizationId/engagements", async (req, res) => {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) {
    return sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id")],
    });
  }
  return invokeService(res, async () => {
    const service = await getEngagementContextService();
    return service.listAuthorizedEngagements({
      organizationId,
      req: { user: safeAuthenticatedUser(req) },
    });
  });
});

function validateGkOrganizationIdParamOrSend(req, res) {
  const gkOrganizationId = typeof req.params?.gkOrganizationId === "string" ? req.params.gkOrganizationId : "";
  if (!GK_ORGANIZATION_ID_PATTERN.test(gkOrganizationId)) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_gk_organization_id_field", "gk_organization_id")],
    });
    return null;
  }
  return Number(gkOrganizationId);
}

/**
 * Get Kinder organization -> KAI provisioning read: lets the organization
 * administration UI show "Not enabled" / "Enable KAI" versus "Enabled" /
 * "Open KAI" without ever creating anything. Read-only.
 */
router.get("/admin/gk-organizations/:gkOrganizationId/kai-enablement", async (req, res) => {
  const gkOrganizationId = validateGkOrganizationIdParamOrSend(req, res);
  if (gkOrganizationId === null) return;
  return invokeService(res, async () => {
    const service = await getOrganizationEnablementService();
    return service.getKaiEnablementStatusForOrganization({
      gkOrganizationId,
      req: { user: safeAuthenticatedUser(req) },
    });
  });
});

/**
 * Get Kinder organization -> KAI provisioning write: creates or reuses the
 * KAI organization binding and its one initial engagement for the requesting
 * Get Kinder organization administrator's own organization. No body is
 * accepted - the browser never supplies a kai_organization_id, engagement_id,
 * or binding id.
 */
router.post("/admin/gk-organizations/:gkOrganizationId/kai-enablement", async (req, res) => {
  const gkOrganizationId = validateGkOrganizationIdParamOrSend(req, res);
  if (gkOrganizationId === null) return;
  if (Object.keys(requestPayload(req)).length !== 0) {
    return sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("unknown_field", "body")],
    });
  }
  return invokeService(res, async () => {
    const service = await getOrganizationEnablementService();
    return service.enableKaiForOrganization({
      gkOrganizationId,
      req: { user: safeAuthenticatedUser(req) },
    });
  }, 201);
});

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

async function getEvidenceLineageService() {
  if (intakeServiceOverride?.extractEvidenceFromSourceVersion) return intakeServiceOverride;
  evidenceLineageServicePromise ||= import("../services/kaiEvidenceLineageService.js");
  return evidenceLineageServicePromise;
}

function sourceVersionEvidenceExtractionIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const sourceVersionId = typeof req.params?.sourceVersionId === "string" ? req.params.sourceVersionId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(sourceVersionId) || sourceVersionId !== sourceVersionId.toLowerCase()) return null;
  return { organizationId, sourceVersionId };
}

function validateEvidenceExtractionRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = sourceVersionEvidenceExtractionIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_source_version_id")],
    });
    return null;
  }
  if (Object.keys(requestPayload(req)).length !== 0) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("unknown_field", "body")],
    });
    return null;
  }
  return identifiers;
}

/**
 * KAI P2-01 evidence-lineage extraction route. Mirrors the export-review
 * routes' organization-scoped path convention and actorContext derivation
 * (`sprint2MappedActorContext`) exactly, because - like those routes, and
 * unlike the review-cockpit routes - `extractEvidenceFromSourceVersion` expects
 * an already-resolved `actorContext`, not a raw authenticated-user identifier
 * for the service to resolve itself.
 */
router.post(
  "/admin/organizations/:organizationId/source-versions/:sourceVersionId/evidence-extraction",
  async (req, res) => {
    const identifiers = validateEvidenceExtractionRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getEvidenceLineageService();
      return service.extractEvidenceFromSourceVersion({
        organizationId: identifiers.organizationId,
        sourceVersionId: identifiers.sourceVersionId,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForSourceVersion({
          organizationId: identifiers.organizationId,
          sourceVersionId: identifiers.sourceVersionId,
          actorContext,
          now,
        }),
      });
    });
  },
);

async function getEvidenceCoverageAssessmentService() {
  if (intakeServiceOverride?.assessEvidenceCoverageForSourceVersion) return intakeServiceOverride;
  evidenceCoverageAssessmentServicePromise ||= import("../services/kaiEvidenceCoverageAssessmentService.js");
  return evidenceCoverageAssessmentServicePromise;
}

/**
 * KAI P2-02 evidence-coverage-assessment route. Reuses the exact P2-01
 * organization/source-version path identity and identifier validation
 * (`sourceVersionEvidenceExtractionIdentifiers`) and actorContext derivation
 * (`sprint2MappedActorContext`) unchanged, on the same mounted router, since
 * `assessEvidenceCoverageForSourceVersion` is scoped to the identical
 * organizationId/sourceVersionId resource identity and also expects an
 * already-resolved actorContext. Read-only: no body, no persistence, no
 * audit write - the service only reads already-committed rows and returns a
 * computed-fresh result.
 */
router.get(
  "/admin/organizations/:organizationId/source-versions/:sourceVersionId/evidence-coverage-assessment",
  async (req, res) => {
    const identifiers = sourceVersionEvidenceExtractionIdentifiers(req);
    if (!identifiers) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_source_version_id")],
      });
    }
    return invokeService(res, async () => {
      const service = await getEvidenceCoverageAssessmentService();
      return service.assessEvidenceCoverageForSourceVersion({
        organizationId: identifiers.organizationId,
        sourceVersionId: identifiers.sourceVersionId,
        actorContext: sprint2MappedActorContext(req),
      });
    });
  },
);

async function getClaimProposalService() {
  if (intakeServiceOverride?.proposeClaim) return intakeServiceOverride;
  claimProposalServicePromise ||= import("../services/kaiClaimProposalService.js");
  return claimProposalServicePromise;
}

function evidenceItemClaimProposalIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const evidenceItemId = typeof req.params?.evidenceItemId === "string" ? req.params.evidenceItemId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(evidenceItemId) || evidenceItemId !== evidenceItemId.toLowerCase()) return null;
  return { organizationId, evidenceItemId };
}

function validateClaimProposalRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = evidenceItemClaimProposalIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_evidence_item_id")],
    });
    return null;
  }
  if (Object.keys(requestPayload(req)).length !== 0) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("unknown_field", "body")],
    });
    return null;
  }
  return identifiers;
}

/**
 * KAI P2-03 claim-proposal route. Mirrors the P2-01 evidence-extraction
 * route's organization-scoped path convention, empty-body requirement, and
 * actorContext/now derivation exactly, on the same mounted router - the
 * resource identity here is the evidenceItemId, not the sourceVersionId,
 * because `proposeClaim` is scoped to an already-committed evidence item.
 */
router.post(
  "/admin/organizations/:organizationId/evidence-items/:evidenceItemId/claim-proposal",
  async (req, res) => {
    const identifiers = validateClaimProposalRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getClaimProposalService();
      return service.proposeClaim({
        organizationId: identifiers.organizationId,
        evidenceItemId: identifiers.evidenceItemId,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForClaimProposal({
          organizationId: identifiers.organizationId,
          evidenceItemId: identifiers.evidenceItemId,
          actorContext,
          now,
        }),
      });
    });
  },
);

async function getClaimGapFollowupService() {
  if (intakeServiceOverride?.generateClaimGapFollowups) return intakeServiceOverride;
  claimGapFollowupServicePromise ||= import("../services/kaiClaimGapFollowupService.js");
  return claimGapFollowupServicePromise;
}

function claimGapFollowupIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const claimId = typeof req.params?.claimId === "string" ? req.params.claimId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(claimId) || claimId !== claimId.toLowerCase()) return null;
  return { organizationId, claimId };
}

function validateClaimGapFollowupRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = claimGapFollowupIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_claim_id")],
    });
    return null;
  }
  if (Object.keys(requestPayload(req)).length !== 0) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("unknown_field", "body")],
    });
    return null;
  }
  return identifiers;
}

/**
 * KAI P2-04 claim-gap/client-followup route. Mirrors the P2-03 claim-proposal
 * route's organization-scoped path convention, empty-body requirement, and
 * actorContext/now derivation exactly, on the same mounted router - the
 * resource identity here is the claimId, not the evidenceItemId, because
 * `generateClaimGapFollowups` is scoped to an already-proposed P2-03 claim.
 */
router.post(
  "/admin/organizations/:organizationId/claims/:claimId/claim-gap-followups",
  async (req, res) => {
    const identifiers = validateClaimGapFollowupRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getClaimGapFollowupService();
      return service.generateClaimGapFollowups({
        organizationId: identifiers.organizationId,
        claimId: identifiers.claimId,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForClaimGapFollowup({
          organizationId: identifiers.organizationId,
          claimId: identifiers.claimId,
          actorContext,
          now,
        }),
      });
    });
  },
);

async function getConflictReviewCandidateService() {
  if (intakeServiceOverride?.createConflictReviewCandidate) return intakeServiceOverride;
  conflictReviewCandidateServicePromise ||= import("../services/kaiConflictReviewCandidateService.js");
  return conflictReviewCandidateServicePromise;
}

function conflictReviewCandidateIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const firstClaimId = typeof req.params?.firstClaimId === "string" ? req.params.firstClaimId : "";
  const secondClaimId = typeof req.params?.secondClaimId === "string" ? req.params.secondClaimId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(firstClaimId) || firstClaimId !== firstClaimId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(secondClaimId) || secondClaimId !== secondClaimId.toLowerCase()) return null;
  return { organizationId, firstClaimId, secondClaimId };
}

function validateConflictReviewCandidateRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = conflictReviewCandidateIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_first_claim_id_or_second_claim_id")],
    });
    return null;
  }
  if (Object.keys(requestPayload(req)).length !== 0) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("unknown_field", "body")],
    });
    return null;
  }
  return identifiers;
}

/**
 * KAI P2-05 potential conflict-review candidate route. Mirrors the preceding
 * claim-scoped routes' organization-scoped path convention, empty-body
 * requirement, and actorContext/now derivation exactly, on the same mounted
 * router. Both claim resource identifiers are carried in the path, following
 * this router's existing nested-resource-id convention (e.g. the
 * export-review-queue routes' two path identifiers), rather than inventing a
 * body-based transport; `createConflictReviewCandidate` alone owns
 * lower/higher claim normalization, so the route forwards
 * firstClaimId/secondClaimId unchanged and never reinterprets their order.
 */
router.post(
  "/admin/organizations/:organizationId/claims/:firstClaimId/potential-conflicts/:secondClaimId",
  async (req, res) => {
    const identifiers = validateConflictReviewCandidateRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getConflictReviewCandidateService();
      return service.createConflictReviewCandidate({
        organizationId: identifiers.organizationId,
        firstClaimId: identifiers.firstClaimId,
        secondClaimId: identifiers.secondClaimId,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForConflictReviewCandidate({
          organizationId: identifiers.organizationId,
          actorContext,
          now,
        }),
      });
    });
  },
);

let claimTraceabilityServicePromise = null;
async function getClaimTraceabilityService() {
  if (intakeServiceOverride?.getClaimTraceabilitySummary) return intakeServiceOverride;
  claimTraceabilityServicePromise ||= import("../services/kaiClaimTraceabilityService.js");
  return claimTraceabilityServicePromise;
}

const KAI_P2_06_REQUESTED_AUDIENCES = new Set(["internal", "funder", "public"]);

/**
 * KAI P2-06 requestedAudience query-string convention: this router's existing
 * GET routes never carry an enumerated caller-controlled field via query
 * string (only pagination/organization_id), so requestedAudience travels as
 * its own dedicated query parameter (`requested_audience`) rather than
 * reusing an unrelated key or inventing a body on a GET request. The value is
 * validated against the exact enum
 * `kaiClaimTraceabilityService.js`'s `REQUESTED_AUDIENCES` already accepts, so
 * an invalid audience fails closed here with the router's standard
 * validation_blocker shape before the service is ever called.
 */
function claimTraceabilityRequestedAudienceFromQuery(req = {}) {
  const keys = Object.keys(req.query || {});
  if (keys.length !== 1 || keys[0] !== "requested_audience") return null;
  const value = req.query.requested_audience;
  return typeof value === "string" && KAI_P2_06_REQUESTED_AUDIENCES.has(value) ? value : null;
}

/**
 * KAI P2-06 human claim-traceability read route. Reuses the exact
 * organizationId/claimId path identity and validation
 * (`claimGapFollowupIdentifiers`) already proven by the P2-04 route above,
 * and the same actorContext derivation (`sprint2MappedActorContext`)
 * unchanged, on the same mounted router - the resource identity here is the
 * same claimId, because `getClaimTraceabilitySummary` is scoped to the
 * identical organizationId/claimId pair. Strictly read-only: the route
 * performs no SQL, no direct database or kai schema access, no audit
 * dependency injection, and no audit write - it derives organizationId
 * (path) and actorContext (server session) and delegates exactly once to
 * the already-accepted P2-06 service, which alone owns eligibility
 * evaluation, blocker ordering, and tenant/role authorization.
 */
router.get(
  "/admin/organizations/:organizationId/claims/:claimId/traceability",
  async (req, res) => {
    const identifiers = claimGapFollowupIdentifiers(req);
    const requestedAudience = claimTraceabilityRequestedAudienceFromQuery(req);
    if (!identifiers || !requestedAudience) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker(
          "invalid_uuid_field_or_requested_audience",
          "organization_id_claim_id_or_requested_audience",
        )],
      });
    }
    return invokeService(res, async () => {
      const service = await getClaimTraceabilityService();
      return service.getClaimTraceabilitySummary({
        organizationId: identifiers.organizationId,
        claimId: identifiers.claimId,
        requestedAudience,
        actorContext: sprint2MappedActorContext(req),
      });
    });
  },
);

let eligibleClaimsForAudienceServicePromise = null;
async function getEligibleClaimsForAudienceService() {
  if (intakeServiceOverride?.listEligibleClaimsForAudience) return intakeServiceOverride;
  eligibleClaimsForAudienceServicePromise ||= import("../services/kaiEligibleClaimsForAudienceService.js");
  return eligibleClaimsForAudienceServicePromise;
}

let claimLibraryServicePromise = null;
async function getClaimLibraryService() {
  if (intakeServiceOverride?.listClaimLibraryCandidates) return intakeServiceOverride;
  claimLibraryServicePromise ||= import("../services/kaiClaimLibraryService.js");
  return claimLibraryServicePromise;
}

const KAI_P2_08_DEFAULT_LIMIT = 25;
const KAI_P2_08_MAX_LIMIT = 100;

function eligibleClaimsForAudienceOrganizationIdentifier(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  return { organizationId };
}

/**
 * KAI P2-08 requestedAudience/limit/afterClaimId query-string convention:
 * reuses the exact P2-06 `requested_audience` query-parameter shape and
 * enum, plus this router's existing `limit` string-digit query convention
 * (as already used by the review-queue and intake-batch-files list routes),
 * clamped to the exact 1-100 range
 * `kaiEligibleClaimsForAudienceService.js` itself already enforces (not the
 * narrower 25-item cap those older list routes use for their own resources).
 * `afterClaimId` travels as a plain `after_claim_id` UUID query parameter,
 * because the P2-08 service's own cursor is already a raw claimId - not an
 * opaque encoded cursor object like the older review-queue/intake-batch-
 * files list routes - so no new cursor-encoding scheme is introduced. Any
 * other or missing/invalid query field fails closed as `validation_blocker`
 * before the service is ever reached.
 */
function eligibleClaimsForAudienceQuery(req = {}) {
  const allowedKeys = new Set(["requested_audience", "limit", "after_claim_id"]);
  const keys = Object.keys(req.query || {});
  if (keys.length === 0 || !keys.every((key) => allowedKeys.has(key))) return null;

  const requestedAudience = req.query.requested_audience;
  if (typeof requestedAudience !== "string" || !KAI_P2_06_REQUESTED_AUDIENCES.has(requestedAudience)) return null;

  let limit = KAI_P2_08_DEFAULT_LIMIT;
  if (req.query.limit !== undefined) {
    if (typeof req.query.limit !== "string" || !/^\d+$/.test(req.query.limit)) return null;
    limit = Number(req.query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > KAI_P2_08_MAX_LIMIT) return null;
  }

  let afterClaimId = null;
  if (req.query.after_claim_id !== undefined) {
    const candidate = normalizedUuid(req.query.after_claim_id);
    if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(candidate)) return null;
    afterClaimId = candidate;
  }

  return { requestedAudience, limit, afterClaimId };
}

/**
 * KAI P2-08 human eligible-claims-for-audience read route. Reuses the exact
 * organization-scoped path convention already proven above (a single
 * organizationId path segment, as on the review-cockpit/review-queue list
 * routes), and the same actorContext derivation (`sprint2MappedActorContext`)
 * unchanged, on the same mounted router. Strictly read-only: the route
 * performs no SQL, no direct database or kai schema access, no audit
 * dependency injection, and no audit write - it derives organizationId
 * (path) and actorContext (server session), accepts only the
 * requestedAudience/limit/afterClaimId fields the existing P2-08 service
 * already accepts, and delegates exactly once to that already-accepted
 * service, which alone owns the P2-06 evaluator reuse, snapshot
 * consistency, candidate-scan cap, ordering, pagination, and eligibility
 * semantics.
 */
router.get(
  "/admin/organizations/:organizationId/eligible-claims",
  async (req, res) => {
    const identifiers = eligibleClaimsForAudienceOrganizationIdentifier(req);
    const query = eligibleClaimsForAudienceQuery(req);
    if (!identifiers || !query) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker(
          "invalid_organization_id_or_query",
          "organization_id_requested_audience_limit_or_after_claim_id",
        )],
      });
    }
    return invokeService(res, async () => {
      const service = await getEligibleClaimsForAudienceService();
      return service.listEligibleClaimsForAudience({
        organizationId: identifiers.organizationId,
        requestedAudience: query.requestedAudience,
        limit: query.limit,
        afterClaimId: query.afterClaimId,
        actorContext: sprint2MappedActorContext(req),
      });
    });
  },
);

function claimLibraryIndexQuery(req = {}) {
  const allowedKeys = new Set(["limit", "after_claim_id"]);
  const keys = Object.keys(req.query || {});
  if (!keys.every((key) => allowedKeys.has(key))) return null;

  let limit = 25;
  if (req.query.limit !== undefined) {
    if (typeof req.query.limit !== "string" || !/^\d+$/.test(req.query.limit)) return null;
    limit = Number(req.query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) return null;
  }

  let afterClaimId = null;
  if (req.query.after_claim_id !== undefined) {
    const candidate = normalizedUuid(req.query.after_claim_id);
    if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(candidate)) return null;
    afterClaimId = candidate;
  }

  return { limit, afterClaimId };
}

/**
 * First Impact Evidence Library navigation read. This route only enumerates
 * metadata-safe claim identities connected to existing P2 review/followup/conflict
 * queues. It does not calculate audience eligibility or blockers; the Library UI
 * must obtain usable claims from P2-08 and selected-claim explanations from P2-06.
 */
router.get(
  "/admin/organizations/:organizationId/claim-library/candidates",
  async (req, res) => {
    const identifiers = eligibleClaimsForAudienceOrganizationIdentifier(req);
    const query = claimLibraryIndexQuery(req);
    if (!identifiers || !query) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker(
          "invalid_organization_id_or_query",
          "organization_id_limit_or_after_claim_id",
        )],
      });
    }
    return invokeService(res, async () => {
      const service = await getClaimLibraryService();
      return service.listClaimLibraryCandidates({
        organizationId: identifiers.organizationId,
        limit: query.limit,
        afterClaimId: query.afterClaimId,
        actorContext: sprint2MappedActorContext(req),
      });
    });
  },
);

async function getGeneratedContentService() {
  if (
    intakeServiceOverride?.createEvidenceSummaryDraft
    || intakeServiceOverride?.getGeneratedDraftReviewPacket
    || intakeServiceOverride?.startGeneratedContentReview
    || intakeServiceOverride?.completeGeneratedContentReview
  ) return intakeServiceOverride;
  generatedContentServicePromise ||= import("../services/kaiGeneratedContentService.js");
  return generatedContentServicePromise;
}

let generatedDraftLibraryServicePromise = null;
async function getGeneratedDraftLibraryService() {
  if (intakeServiceOverride?.listGeneratedDraftLibraryIndex) return intakeServiceOverride;
  generatedDraftLibraryServicePromise ||= import("../services/kaiGeneratedDraftLibraryService.js");
  return generatedDraftLibraryServicePromise;
}

const KAI_GENERATED_DRAFT_LIBRARY_DEFAULT_LIMIT = 25;
const KAI_GENERATED_DRAFT_LIBRARY_MAX_LIMIT = 25;

function generatedDraftLibraryIndexQuery(req = {}) {
  const allowedKeys = new Set(["limit", "after_generated_content_draft_id"]);
  const keys = Object.keys(req.query || {});
  if (!keys.every((key) => allowedKeys.has(key))) return null;

  let limit = KAI_GENERATED_DRAFT_LIBRARY_DEFAULT_LIMIT;
  if (req.query.limit !== undefined) {
    if (typeof req.query.limit !== "string" || !/^\d+$/.test(req.query.limit)) return null;
    limit = Number(req.query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > KAI_GENERATED_DRAFT_LIBRARY_MAX_LIMIT) return null;
  }

  let afterGeneratedContentDraftId = null;
  if (req.query.after_generated_content_draft_id !== undefined) {
    const candidate = normalizedUuid(req.query.after_generated_content_draft_id);
    if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(candidate)) return null;
    afterGeneratedContentDraftId = candidate;
  }

  return { limit, afterGeneratedContentDraftId };
}

/**
 * Persistent Impact Evidence Library generated-drafts index. This route only
 * enumerates metadata-safe `evidence_summary`/`internal` generated-content-draft
 * identities already persisted through the accepted P3-01 path, so a persisted
 * draft remains rediscoverable across a fresh Library load independently of any
 * transient browser-only generation state. It performs no SQL/direct database
 * access itself and never invokes the model/provider; detailed draft content
 * (blocks, citations, limitations) remains P3-02's responsibility.
 */
router.get(
  "/admin/organizations/:organizationId/generated-content-drafts",
  async (req, res) => {
    const identifiers = eligibleClaimsForAudienceOrganizationIdentifier(req);
    const query = generatedDraftLibraryIndexQuery(req);
    if (!identifiers || !query) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker(
          "invalid_organization_id_or_query",
          "organization_id_limit_or_after_generated_content_draft_id",
        )],
      });
    }
    return invokeService(res, async () => {
      const service = await getGeneratedDraftLibraryService();
      return service.listGeneratedDraftLibraryIndex({
        organizationId: identifiers.organizationId,
        limit: query.limit,
        afterGeneratedContentDraftId: query.afterGeneratedContentDraftId,
        actorContext: sprint2MappedActorContext(req),
      });
    });
  },
);

function generatedContentDraftIdentifier(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const generatedContentDraftId = typeof req.params?.generatedContentDraftId === "string"
    ? req.params.generatedContentDraftId
    : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(generatedContentDraftId) || generatedContentDraftId !== generatedContentDraftId.toLowerCase()) return null;
  return { organizationId, generatedContentDraftId };
}

function validateCreateEvidenceSummaryRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = eligibleClaimsForAudienceOrganizationIdentifier(req);
  const payload = requestPayload(req);
  const keys = Object.keys(payload);
  if (
    !identifiers
    || keys.length !== 2
    || !keys.every((key) => key === "claim_ids" || key === "idempotency_key")
    || !Array.isArray(payload.claim_ids)
    || payload.claim_ids.length < 1
    || payload.claim_ids.length > 20
    || payload.claim_ids.some((claimId) => typeof claimId !== "string" || !KAI_SPRINT2_P0_PATTERNS.uuid.test(claimId) || claimId !== claimId.toLowerCase())
    || payload.claim_ids.length !== new Set(payload.claim_ids).size
    || typeof payload.idempotency_key !== "string"
    || payload.idempotency_key !== payload.idempotency_key.trim()
    || !/^[ -~]{8,128}$/.test(payload.idempotency_key)
  ) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_internal_evidence_summary_generation_request",
        "organization_id_claim_ids_or_idempotency_key",
      )],
    });
    return null;
  }
  return {
    organizationId: identifiers.organizationId,
    claimIds: [...payload.claim_ids].sort(),
    idempotencyKey: payload.idempotency_key,
  };
}

router.post(
  "/admin/organizations/:organizationId/generated-content-drafts/evidence-summary",
  async (req, res) => {
    const parsed = validateCreateEvidenceSummaryRequestOrSend(req, res);
    if (!parsed) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getGeneratedContentService();
      const { createProductionEvidenceSummaryDraftGenerator } = await import("../services/kaiEvidenceSummaryDraftGenerator.js");
      return service.createEvidenceSummaryDraft({
        organizationId: parsed.organizationId,
        requestedAudience: "internal",
        claimIds: parsed.claimIds,
        idempotencyKey: parsed.idempotencyKey,
        actorContext,
        now,
      }, {
        draftGenerator: createProductionEvidenceSummaryDraftGenerator(),
        metadataOnlyAudit: createProductionMetadataOnlyAuditForGeneratedContentDraft({
          organizationId: parsed.organizationId,
          actorContext,
          now,
        }),
      });
    }, 201);
  },
);

router.get(
  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/review-packet",
  async (req, res) => {
    const identifiers = generatedContentDraftIdentifier(req);
    if (!identifiers || Object.keys(req.query || {}).length !== 0) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker(
          "invalid_organization_id_generated_content_draft_id_or_query",
          "organization_id_generated_content_draft_id",
        )],
      });
    }
    return invokeService(res, async () => {
      const service = await getGeneratedContentService();
      return service.getGeneratedDraftReviewPacket({
        organizationId: identifiers.organizationId,
        generatedContentDraftId: identifiers.generatedContentDraftId,
        actorContext: sprint2MappedActorContext(req),
      });
    });
  },
);

function generatedContentReviewQueueIdentifier(req = {}) {
  const root = generatedContentDraftIdentifier(req);
  const reviewQueueItemId = typeof req.params?.reviewQueueItemId === "string" ? req.params.reviewQueueItemId : "";
  if (!root) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(reviewQueueItemId) || reviewQueueItemId !== reviewQueueItemId.toLowerCase()) return null;
  return { ...root, reviewQueueItemId };
}

function validateGeneratedContentReviewTransitionRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = generatedContentReviewQueueIdentifier(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_organization_id_generated_content_draft_id_or_review_queue_item_id",
        "organization_id_generated_content_draft_id_or_review_queue_item_id",
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
  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/generated-content-review-queue/:reviewQueueItemId/start",
  async (req, res) => {
    const identifiers = validateGeneratedContentReviewTransitionRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    const payload = requestPayload(req);
    return invokeService(res, async () => {
      const service = await getGeneratedContentService();
      return service.startGeneratedContentReview({
        organizationId: identifiers.organizationId,
        generatedContentDraftId: identifiers.generatedContentDraftId,
        reviewQueueItemId: identifiers.reviewQueueItemId,
        expectedUpdatedAt: payload.expected_updated_at,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForGeneratedContentReview({
          organizationId: identifiers.organizationId,
          generatedContentDraftId: identifiers.generatedContentDraftId,
          reviewQueueItemId: identifiers.reviewQueueItemId,
          actorContext,
          now,
        }),
      });
    });
  },
);

router.post(
  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/generated-content-review-queue/:reviewQueueItemId/complete",
  async (req, res) => {
    const identifiers = validateGeneratedContentReviewTransitionRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    const payload = requestPayload(req);
    return invokeService(res, async () => {
      const service = await getGeneratedContentService();
      return service.completeGeneratedContentReview({
        organizationId: identifiers.organizationId,
        generatedContentDraftId: identifiers.generatedContentDraftId,
        reviewQueueItemId: identifiers.reviewQueueItemId,
        expectedUpdatedAt: payload.expected_updated_at,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForGeneratedContentReview({
          organizationId: identifiers.organizationId,
          generatedContentDraftId: identifiers.generatedContentDraftId,
          reviewQueueItemId: identifiers.reviewQueueItemId,
          actorContext,
          now,
        }),
      });
    });
  },
);

let evidenceReviewServicePromise = null;
async function getHumanReviewServiceForEvidenceReview() {
  if (intakeServiceOverride?.completeEvidenceReview) return intakeServiceOverride;
  evidenceReviewServicePromise ||= import("../services/kaiHumanReviewService.js");
  return evidenceReviewServicePromise;
}

let claimReviewServicePromise = null;
async function getHumanReviewServiceForClaimReview() {
  if (intakeServiceOverride?.completeClaimReviewInternalApproval) return intakeServiceOverride;
  claimReviewServicePromise ||= import("../services/kaiHumanReviewService.js");
  return claimReviewServicePromise;
}

function evidenceReviewCompletionIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const evidenceItemId = typeof req.params?.evidenceItemId === "string" ? req.params.evidenceItemId : "";
  const reviewQueueItemId = typeof req.params?.reviewQueueItemId === "string" ? req.params.reviewQueueItemId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(evidenceItemId) || evidenceItemId !== evidenceItemId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(reviewQueueItemId) || reviewQueueItemId !== reviewQueueItemId.toLowerCase()) return null;
  return { organizationId, evidenceItemId, reviewQueueItemId };
}

function validateEvidenceReviewCompletionRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = evidenceReviewCompletionIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field",
        "organization_id_evidence_item_id_or_review_queue_item_id",
      )],
    });
    return null;
  }
  const result = validateCompleteEvidenceReviewRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

/**
 * KAI P2-09 human evidence-review completion route. Mirrors the sibling
 * generated-content-review-completion route's `expected_updated_at` body
 * convention exactly, on the same mounted router. Contains no SQL, imports no
 * data-access layer, derives actor/tenant identity exclusively server-side
 * from `sprint2MappedActorContext`, and delegates exactly once to the
 * authorized P2-09 service, which alone owns the compare-and-set write,
 * post-write validation, and required same-transaction audit. Never
 * completes, resolves, or references the linked claim's own claim_review
 * queue item - completing an evidence review can never approve a claim.
 */
router.post(
  "/admin/organizations/:organizationId/evidence-items/:evidenceItemId/evidence-review/:reviewQueueItemId/complete",
  async (req, res) => {
    const identifiers = validateEvidenceReviewCompletionRequestOrSend(req, res);
    if (!identifiers) return;
    const payload = requestPayload(req);
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getHumanReviewServiceForEvidenceReview();
      return service.completeEvidenceReview({
        organizationId: identifiers.organizationId,
        evidenceItemId: identifiers.evidenceItemId,
        reviewQueueItemId: identifiers.reviewQueueItemId,
        expectedUpdatedAt: payload.expected_updated_at,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForEvidenceReview({
          organizationId: identifiers.organizationId,
          evidenceItemId: identifiers.evidenceItemId,
          actorContext,
          now,
        }),
      });
    });
  },
);

function claimReviewCompletionIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const claimId = typeof req.params?.claimId === "string" ? req.params.claimId : "";
  const reviewQueueItemId = typeof req.params?.reviewQueueItemId === "string" ? req.params.reviewQueueItemId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(claimId) || claimId !== claimId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(reviewQueueItemId) || reviewQueueItemId !== reviewQueueItemId.toLowerCase()) return null;
  return { organizationId, claimId, reviewQueueItemId };
}

function validateClaimReviewCompletionRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = claimReviewCompletionIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field",
        "organization_id_claim_id_or_review_queue_item_id",
      )],
    });
    return null;
  }
  const result = validateCompleteClaimReviewRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

/**
 * KAI P2-09 human claim-review/internal-approval completion route. Mirrors
 * the evidence-review completion route above exactly. It never invokes the
 * P2-08 eligible-claims-for-audience service, any Impact Evidence Library
 * service, or any P3/generation/export service - approving a claim internally
 * triggers no automatic downstream chaining.
 */
router.post(
  "/admin/organizations/:organizationId/claims/:claimId/claim-review/:reviewQueueItemId/complete",
  async (req, res) => {
    const identifiers = validateClaimReviewCompletionRequestOrSend(req, res);
    if (!identifiers) return;
    const payload = requestPayload(req);
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getHumanReviewServiceForClaimReview();
      return service.completeClaimReviewInternalApproval({
        organizationId: identifiers.organizationId,
        claimId: identifiers.claimId,
        reviewQueueItemId: identifiers.reviewQueueItemId,
        expectedUpdatedAt: payload.expected_updated_at,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForClaimReview({
          organizationId: identifiers.organizationId,
          claimId: identifiers.claimId,
          actorContext,
          now,
        }),
      });
    });
  },
);

let coverageReviewDecisionServicePromise = null;
async function getCoverageReviewDecisionService() {
  if (intakeServiceOverride?.acceptInternalCoverageLimitation) return intakeServiceOverride;
  coverageReviewDecisionServicePromise ||= import("../services/kaiCoverageReviewDecisionService.js");
  return coverageReviewDecisionServicePromise;
}

const KAI_P2_10_DIMENSION_KEYS = new Set([
  "missingness",
  "duplicates",
  "definition_clarity",
  "denominator_clarity",
  "time_period_clarity",
  "entity_level_clarity",
  "small_cell_risk",
  "conflicting_source_indicators",
  "requirement_alignment",
  "coverage_gaps",
]);

function coverageReviewDecisionIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const claimId = typeof req.params?.claimId === "string" ? req.params.claimId : "";
  const dimensionKey = typeof req.params?.dimensionKey === "string" ? req.params.dimensionKey : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(claimId) || claimId !== claimId.toLowerCase()) return null;
  if (!KAI_P2_10_DIMENSION_KEYS.has(dimensionKey)) return null;
  return { organizationId, claimId, dimensionKey };
}

function validateCoverageReviewDecisionRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = coverageReviewDecisionIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field_or_dimension_key",
        "organization_id_claim_id_or_dimension_key",
      )],
    });
    return null;
  }
  if (Object.keys(requestPayload(req)).length !== 0) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("unknown_field", "body")],
    });
    return null;
  }
  return identifiers;
}

/**
 * KAI P2-10 owner-policy internal-coverage-acceptance route. Mirrors the
 * P2-04/P2-05 claim-scoped routes' organization-scoped path convention and
 * empty-body requirement exactly, on the same mounted router. The caller
 * identifies only the target claim and dimension via the path; actor, tenant,
 * decision value, audience (always internal), and decision timestamp are all
 * server-controlled by the authorized P2-10 service layer, never accepted
 * from the request body.
 */
router.post(
  "/admin/organizations/:organizationId/claims/:claimId/coverage-dimensions/:dimensionKey/internal-acceptance",
  async (req, res) => {
    const identifiers = validateCoverageReviewDecisionRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getCoverageReviewDecisionService();
      return service.acceptInternalCoverageLimitation({
        organizationId: identifiers.organizationId,
        claimId: identifiers.claimId,
        dimensionKey: identifiers.dimensionKey,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForCoverageReviewDecision({
          organizationId: identifiers.organizationId,
          claimId: identifiers.claimId,
          actorContext,
          now,
        }),
      });
    }, 201);
  },
);

let clientFollowupCompletionServicePromise = null;
async function getClientFollowupCompletionService() {
  if (intakeServiceOverride?.completeClientFollowup) return intakeServiceOverride;
  clientFollowupCompletionServicePromise ||= import("../services/kaiClientFollowupCompletionService.js");
  return clientFollowupCompletionServicePromise;
}

let clientFollowupReadServicePromise = null;
async function getClientFollowupReadService() {
  if (intakeServiceOverride?.listClientFollowupWorkflows) return intakeServiceOverride;
  clientFollowupReadServicePromise ||= import("../services/kaiClientFollowupReadService.js");
  return clientFollowupReadServicePromise;
}

/**
 * KAI P2-11 client-reviewer-facing read route. Exactly one organization-scoped
 * role - `client_reviewer` - is authorized (enforced inside the service, not
 * here). Read-only: exposes only the fixed, already-established-safe
 * client_followup workflow fields, never raw evidence/claim/answer content.
 */
router.get("/admin/organizations/:organizationId/client-followups", async (req, res) => {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) {
    return sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id")],
    });
  }
  return invokeService(res, async () => {
    const service = await getClientFollowupReadService();
    return service.listClientFollowupWorkflows({
      organizationId,
      actorContext: sprint2MappedActorContext(req),
    });
  });
});

function clientFollowupCompletionIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const claimId = typeof req.params?.claimId === "string" ? req.params.claimId : "";
  const clientFollowupItemId = typeof req.params?.clientFollowupItemId === "string" ? req.params.clientFollowupItemId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(claimId) || claimId !== claimId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(clientFollowupItemId) || clientFollowupItemId !== clientFollowupItemId.toLowerCase()) return null;
  return { organizationId, claimId, clientFollowupItemId };
}

function validateClientFollowupCompletionRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = clientFollowupCompletionIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field",
        "organization_id_claim_id_or_client_followup_item_id",
      )],
    });
    return null;
  }
  const result = validateCompleteClientFollowupRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

/**
 * KAI P2-11 client-followup-completion route. Mirrors the P2-09 evidence-
 * review/claim-review completion routes' `expected_updated_at` body
 * convention exactly, on the same mounted router. The only role ever
 * authorized for this route is the organization-scoped `client_reviewer` -
 * never a GK role, `client_admin`, or `client_contributor`. This records a
 * workflow disposition (the fixed follow-up question was reviewed and no
 * additional client information is being supplied), never a client answer:
 * the request body carries no answer/free-text field, and the route contains
 * no SQL or direct data-access-layer calls, delegating exactly once to the
 * authorized P2-11 service. It never invokes P2-06/P2-08 or any other
 * mutation - completing this workflow triggers no automatic downstream
 * chaining.
 */
router.post(
  "/admin/organizations/:organizationId/claims/:claimId/client-followups/:clientFollowupItemId/complete",
  async (req, res) => {
    const identifiers = validateClientFollowupCompletionRequestOrSend(req, res);
    if (!identifiers) return;
    const payload = requestPayload(req);
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getClientFollowupCompletionService();
      return service.completeClientFollowup({
        organizationId: identifiers.organizationId,
        claimId: identifiers.claimId,
        clientFollowupItemId: identifiers.clientFollowupItemId,
        expectedUpdatedAt: payload.expected_updated_at,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForClientFollowupCompletion({
          organizationId: identifiers.organizationId,
          claimId: identifiers.claimId,
          actorContext,
          now,
        }),
      });
    });
  },
);

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
  sourceVersionEvidenceExtractionIdentifiers,
  validateEvidenceExtractionRequestOrSend,
  evidenceItemClaimProposalIdentifiers,
  validateClaimProposalRequestOrSend,
  claimGapFollowupIdentifiers,
  validateClaimGapFollowupRequestOrSend,
  conflictReviewCandidateIdentifiers,
  validateConflictReviewCandidateRequestOrSend,
  claimTraceabilityRequestedAudienceFromQuery,
  eligibleClaimsForAudienceOrganizationIdentifier,
  eligibleClaimsForAudienceQuery,
  claimLibraryIndexQuery,
  generatedDraftLibraryIndexQuery,
  evidenceReviewCompletionIdentifiers,
  validateEvidenceReviewCompletionRequestOrSend,
  claimReviewCompletionIdentifiers,
  validateClaimReviewCompletionRequestOrSend,
  coverageReviewDecisionIdentifiers,
  validateCoverageReviewDecisionRequestOrSend,
  clientFollowupCompletionIdentifiers,
  validateClientFollowupCompletionRequestOrSend,
  setIntakeServiceForTest(service) {
    intakeServiceOverride = service;
    return () => {
      intakeServiceOverride = null;
    };
  },
};
