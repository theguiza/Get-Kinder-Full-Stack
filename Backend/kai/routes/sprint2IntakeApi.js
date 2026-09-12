import express from "express";
import { KAI_ERROR_STATUS, sendKaiError } from "../errors/kaiErrors.js";
import { attachKaiSprint2ActorContext } from "../middleware/kaiSprint2Authentication.js";
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
  validateCompleteBoardReportingCandidateReviewRequest,
  validateCompleteClaimReviewRequest,
  validateCompleteGrantResponsePacketExportReviewRequest,
  validateCompleteClientFollowupRequest,
  validateCompleteEvidenceReviewRequest,
  validateCompleteExportReviewRequest,
  validateCreateExportCandidateRequest,
  validateCreateGrantResponsePacketExportCandidateRequest,
  validateCreateGrantResponsePacketExportManifestRequest,
  validateCreateExportManifestRequest,
  validateGrantResponsePacketHumanFinalReleaseAuthorityRequest,
  validateHumanFinalReleaseAuthorityRequest,
  validateIntakeBatchFilesQuery,
  validateFilePolicyBlockRequest,
  validateKaiSprint2MutationRequest,
  validateRequestBoardReportingCandidateReviewRequest,
  validateRequestExportReviewRequest,
  validateRequestGrantResponsePacketExportReviewRequest,
  validateReviewQueueQuery,
  validateReviewQueueStatusRequest,
  validateSensitivityProfileDecisionRequest,
  validateStartBoardReportingCandidateReviewRequest,
  validateStartExportReviewRequest,
  validateStartGrantResponsePacketExportReviewRequest,
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
  createProductionMetadataOnlyAuditForGeneratedDraftExportCandidate,
  createProductionMetadataOnlyAuditForBoardReportingCandidate,
  createProductionMetadataOnlyAuditForGrantResponsePacketExportCandidate,
  createProductionMetadataOnlyAuditForGrantResponsePacketExportManifest,
  createProductionMetadataOnlyAuditForGrantResponsePacketExportReview,
  createProductionMetadataOnlyAuditForGrantResponsePacketHumanAuthorityDecision,
  createProductionMetadataOnlyAuditForExportManifest,
  createProductionMetadataOnlyAuditForHumanFinalReleaseAuthority,
  createProductionMetadataOnlyAuditForRequirementAssessment,
  createProductionMetadataOnlyAuditForSourceVersion,
} from "../services/kaiMetadataOnlyAuditComposition.js";

const router = express.Router();
let intakeServiceOverride = null;
let actorContextMiddlewareOverride = null;
let intakeServicePromise = null;
let reviewQueueServicePromise = null;
let reviewCockpitServicePromise = null;
let exportReviewServicePromise = null;
let exportCandidateServicePromise = null;
let humanAuthorityDecisionServicePromise = null;
let exportManifestServicePromise = null;
let exportManifestMarkdownServicePromise = null;
let exportManifestCsvServicePromise = null;
let exportManifestPdfServicePromise = null;
let exportManifestDocxServicePromise = null;
let grantResponsePacketMarkdownServicePromise = null;
let grantResponsePacketExportCandidateServicePromise = null;
let grantResponsePacketExportReviewServicePromise = null;
let grantResponsePacketHumanFinalReleaseAuthorityServicePromise = null;
let grantResponsePacketExportManifestServicePromise = null;
let grantResponsePacketExportManifestMarkdownServicePromise = null;
let boardReportingCandidateServicePromise = null;
let evidenceLineageServicePromise = null;
let evidenceCoverageAssessmentServicePromise = null;
let claimProposalServicePromise = null;
let claimGapFollowupServicePromise = null;
let conflictReviewCandidateServicePromise = null;
let generatedContentServicePromise = null;
let dataDictionaryServicePromise = null;
let externalRequirementSetRegistrationServicePromise = null;

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
  /^(confirm_upload_authorization|upload_lifecycle_read|gcs_generation_binding_lookup|gcs_head_object|gcs_stat_exact_generation|gcs_open_exact_generation|gcs_stream_exact_generation|gcs_size_check|gcs_checksum_check|gcs_lifecycle_start|gcs_lifecycle_complete|gcs_generation_bind|gcs_lifecycle_confirm|confirm_upload_route_service|upload_url_storage_provider_not_gcs|upload_url_object_key_missing|upload_url_mime_type_missing|upload_url_lifecycle_repository_missing|upload_url_gcs_provider_missing|upload_url_gcs_provider_disabled|upload_url_gcs_provider_signed_url_capability_missing|upload_url_gcs_provider_max_upload_size_missing|upload_url_gcs_provider_unclassified_storage_not_configured|source_promotion_repository_input_shape|source_promotion_required_audit_rejected|source_promotion_db_constraint_violation|source_promotion_reviewed_source_type_invalid|source_promotion_permission_predicate_failed|source_promotion_candidate_review_incomplete|source_promotion_service_input_shape|source_promotion_sensitivity_profile_read_23514|source_promotion_sensitivity_profile_read_p0001|source_promotion_sensitivity_profile_read_22p02|source_promotion_upload_state_read_23514|source_promotion_upload_state_read_p0001|source_promotion_upload_state_read_22p02|source_promotion_decision_insert_23514|source_promotion_decision_insert_p0001|source_promotion_decision_insert_22p02|source_promotion_decision_transition_23514|source_promotion_decision_transition_p0001|source_promotion_decision_transition_22p02|source_promotion_source_insert_23514|source_promotion_source_insert_p0001|source_promotion_source_insert_22p02|source_promotion_source_version_insert_23514|source_promotion_source_version_insert_p0001|source_promotion_source_version_insert_22p02|source_promotion_candidate_status_update_23514|source_promotion_candidate_status_update_p0001|source_promotion_candidate_status_update_22p02|source_promotion_review_queue_resolve_23514|source_promotion_review_queue_resolve_p0001|source_promotion_review_queue_resolve_22p02|source_promotion_review_queue_waiting_on_client_23514|source_promotion_review_queue_waiting_on_client_p0001|source_promotion_review_queue_waiting_on_client_22p02|source_promotion_audit_insert_23514|source_promotion_audit_insert_p0001|source_promotion_audit_insert_22p02)$/;

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
    typeof data.traceability_conflict_reason === "string"
    && /^(claim_evidence_link_mismatch|source_version_not_current|gap_dimension_requires_missing_p204_state|gap_followup_queue_mismatch|conflict_queue_count_mismatch|conflict_group_validation_failed)$/.test(data.traceability_conflict_reason)
  ) {
    sanitized.traceability_conflict_reason = data.traceability_conflict_reason;
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

const EXPORT_MANIFEST_MARKDOWN_ATTACHMENT_FILENAME = "kai-export-manifest.md";
const EXPORT_MANIFEST_MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
const GRANT_RESPONSE_PACKET_MARKDOWN_ATTACHMENT_FILENAME = "kai-grant-response-packet.md";
const GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_MARKDOWN_ATTACHMENT_FILENAME =
  "kai-grant-response-packet-export-manifest.md";
const EXPORT_MANIFEST_CSV_ATTACHMENT_FILENAME = "kai-export-manifest-evidence-appendix.csv";
const EXPORT_MANIFEST_CSV_CONTENT_TYPE = "text/csv; charset=utf-8";
const EXPORT_MANIFEST_PDF_ATTACHMENT_FILENAME = "kai-export-manifest.pdf";
const EXPORT_MANIFEST_PDF_CONTENT_TYPE = "application/pdf";
const EXPORT_MANIFEST_DOCX_ATTACHMENT_FILENAME = "kai-export-manifest.docx";
const EXPORT_MANIFEST_DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function sendMarkdownAttachment(res, result) {
  if (!result?.ok) return sendServiceResult(res, result);
  const markdown = typeof result.data?.markdown === "string" ? result.data.markdown : null;
  if (markdown == null) return sendKaiError(res, "system_error");

  res.status(200);
  res.setHeader("Content-Type", EXPORT_MANIFEST_MARKDOWN_CONTENT_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename="${EXPORT_MANIFEST_MARKDOWN_ATTACHMENT_FILENAME}"`);
  return res.send(markdown);
}

function sendGrantResponsePacketMarkdownAttachment(res, result) {
  if (!result?.ok) return sendServiceResult(res, result);
  const markdown = typeof result.data?.markdown === "string" ? result.data.markdown : null;
  if (markdown == null) return sendKaiError(res, "system_error");

  res.status(200);
  res.setHeader("Content-Type", EXPORT_MANIFEST_MARKDOWN_CONTENT_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename="${GRANT_RESPONSE_PACKET_MARKDOWN_ATTACHMENT_FILENAME}"`);
  return res.send(markdown);
}

function sendGrantResponsePacketExportManifestMarkdownAttachment(res, result) {
  if (!result?.ok) return sendServiceResult(res, result);
  const markdown = typeof result.data?.markdown === "string" ? result.data.markdown : null;
  if (markdown == null) return sendKaiError(res, "system_error");

  res.status(200);
  res.setHeader("Content-Type", EXPORT_MANIFEST_MARKDOWN_CONTENT_TYPE);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_MARKDOWN_ATTACHMENT_FILENAME}"`,
  );
  return res.send(markdown);
}

function sendCsvAttachment(res, result) {
  if (!result?.ok) return sendServiceResult(res, result);
  const csv = typeof result.data?.csv === "string" ? result.data.csv : null;
  if (csv == null) return sendKaiError(res, "system_error");

  res.status(200);
  res.setHeader("Content-Type", EXPORT_MANIFEST_CSV_CONTENT_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename="${EXPORT_MANIFEST_CSV_ATTACHMENT_FILENAME}"`);
  return res.send(csv);
}

function sendPdfAttachment(res, result) {
  if (!result?.ok) return sendServiceResult(res, result);
  const pdf = Buffer.isBuffer(result.data?.pdf) ? result.data.pdf : null;
  if (pdf == null) return sendKaiError(res, "system_error");

  res.status(200);
  res.setHeader("Content-Type", EXPORT_MANIFEST_PDF_CONTENT_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename="${EXPORT_MANIFEST_PDF_ATTACHMENT_FILENAME}"`);
  return res.send(pdf);
}

function sendDocxAttachment(res, result) {
  if (!result?.ok) return sendServiceResult(res, result);
  const docx = Buffer.isBuffer(result.data?.docx) ? result.data.docx : null;
  if (docx == null) return sendKaiError(res, "system_error");

  res.status(200);
  res.setHeader("Content-Type", EXPORT_MANIFEST_DOCX_CONTENT_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename="${EXPORT_MANIFEST_DOCX_ATTACHMENT_FILENAME}"`);
  return res.send(docx);
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
  if (intakeServiceOverride?.updateReviewQueueStatus || intakeServiceOverride?.ensureSensitivityReviewQueueItem) {
    return intakeServiceOverride;
  }
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

/**
 * Attaches the resolved Sprint 2 actor context. Applied directly to only the
 * specific route registrations below whose handlers read
 * sprint2MappedActorContext(req) - not router-wide - because several routes on
 * this router (e.g. the organizations/engagements/kai-enablement/batch routes)
 * resolve actor identity through their own service-level path instead and must
 * not pay this resolver's cost or failure modes.
 */
function sprint2ActorContextMiddleware(req, res, next) {
  return (actorContextMiddlewareOverride || attachKaiSprint2ActorContext)(req, res, next);
}

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
 * All routes are already behind this router's `requireKaiSprint2Enabled` gate (and
 * the mount-level gate in index.js), so KAI_SPRINT2_ENABLED gates every one of
 * them, including the decision route.
 */
/**
 * KAI B1A-3B: a safe, read-only capability probe so a product-facing page
 * (e.g. the Impact Evidence Library) can decide whether to fetch/show
 * actionable Phase-5 sensitivity-review controls, without ever hardcoding the
 * GK role list client-side and without attempting the GK-only sensitivity
 * routes just to read a 403. Never returns queue/profile/decision data;
 * always 200 for an authenticated actor regardless of authorization outcome
 * (the boolean itself IS the answer) - a genuinely unauthenticated request is
 * still rejected the same way every other route on this router already
 * rejects one.
 */
router.get("/admin/review-cockpit/capabilities", async (req, res) => {
  const organizationId = normalizedUuid(req.query?.organization_id);
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId)) {
    return sendKaiError(res, "invalid_request");
  }
  return invokeService(res, async () => {
    const service = await getReviewCockpitService();
    return service.getReviewCockpitCapabilities({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/review-cockpit/capabilities"),
      organizationId,
    });
  });
});

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

router.get("/admin/review-cockpit/sensitivity-profiles/:intakeSensitivityProfileId", async (req, res) => {
  const identifiers = reviewCockpitIdentifiers(req, "intakeSensitivityProfileId");
  if (!identifiers) return sendKaiError(res, "invalid_request");
  return invokeService(res, async () => {
    const service = await getReviewCockpitService();
    return service.getReviewCockpitSensitivityProfileDetail({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/review-cockpit/sensitivity-profiles/:intakeSensitivityProfileId"),
      organizationId: identifiers.organizationId,
      intakeSensitivityProfileId: identifiers.objectId,
    });
  });
});

/**
 * KAI B1A-2 Phase-5 sensitivity/allowed-use decision route. Structurally identical
 * to the source-candidate decision route below (validator -> service ->
 * repository): it contains no SQL, imports no database pool, and calls exactly one
 * authorized service function, which performs its own feature gating, mapped-human
 * actor/role/tenant authorization, optimistic-concurrency check, transactional
 * append-only ledger write, P1-06 queue transition, and required same-transaction
 * audit. The reviewer identity and organization are never taken from the body.
 */
router.post("/admin/review-cockpit/sensitivity-profiles/:intakeSensitivityProfileId/decision", async (req, res) => {
  if (!metadataContentTypeIsSupported(req)) return sendKaiError(res, "unsupported_media_type");
  const identifiers = reviewCockpitIdentifiers(req, "intakeSensitivityProfileId");
  if (!identifiers) {
    return sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_intake_sensitivity_profile_id")],
    });
  }
  const bodyResult = validateSensitivityProfileDecisionRequest(req.body);
  if (!bodyResult.ok) {
    return sendKaiError(res, "validation_blocker", { blockers: bodyResult.blockers });
  }
  return invokeService(res, async () => {
    const service = await getReviewCockpitService();
    return service.submitSensitivityProfileDecision({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/review-cockpit/sensitivity-profiles/:intakeSensitivityProfileId/decision"),
      organizationId: identifiers.organizationId,
      intakeSensitivityProfileId: identifiers.objectId,
      payload: requestPayload(req),
    });
  });
});

/**
 * KAI B1A-2R review-work route: closes the one missing P1-05 -> P1-06 lifecycle
 * edge. Normal runtime creates a P1-05 sensitivity profile, but no normal
 * application path previously created the corresponding P1-06
 * 'sensitivity_review' work item, which left B1A-2's already-built Phase-5
 * decision route above practically unreachable outside manual/synthetic
 * database seeding. This route means exactly "ensure the sensitivity_review
 * work item exists" - it starts no substantive review authority, records no
 * classification/consent/allowed-use, grants no LLM/funder/public/product-
 * learning permission, and records or resolves no Phase-5 decision. Contains no
 * SQL and imports no database pool: it validates its request shape (an explicit
 * organization_id query parameter, the path's own intake_sensitivity_profile_id,
 * and a strictly empty body - the caller cannot choose actor identity, role,
 * queue_type, target_object_type, queue_status, priority, or any classification/
 * decision field) and then delegates entirely, exactly once, to the existing,
 * unmodified P1-06 `createSensitivityReviewQueueItem` via
 * `ensureSensitivityReviewQueueItem`, which reuses AUTH-KAI-003 and
 * VAL-FUP-001-P0 as-is rather than reimplementing either.
 */
router.post("/admin/review-cockpit/sensitivity-profiles/:intakeSensitivityProfileId/review-work", async (req, res) => {
  if (!metadataContentTypeIsSupported(req)) return sendKaiError(res, "unsupported_media_type");
  const identifiers = reviewCockpitIdentifiers(req, "intakeSensitivityProfileId");
  if (!identifiers) {
    return sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_intake_sensitivity_profile_id")],
    });
  }
  if (Object.keys(requestPayload(req)).length !== 0) {
    return sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("unknown_field", "body")],
    });
  }
  return invokeService(res, async () => {
    const service = await getReviewQueueService();
    return service.ensureSensitivityReviewQueueItem({
      ...requestContext(req, "/api/kai/sprint2/intake/admin/review-cockpit/sensitivity-profiles/:intakeSensitivityProfileId/review-work"),
      organizationId: identifiers.organizationId,
      intakeSensitivityProfileId: identifiers.objectId,
    });
  }, 201);
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
    intakeServiceOverride?.requestGeneratedDraftExportReview
    || intakeServiceOverride?.getGeneratedDraftExportReviewPacket
    || intakeServiceOverride?.startGeneratedDraftExportReview
    || intakeServiceOverride?.completeGeneratedDraftExportReview
  ) return intakeServiceOverride;
  exportReviewServicePromise ||= import("../services/kaiExportReviewService.js");
  return exportReviewServicePromise;
}

async function getExportCandidateService() {
  if (intakeServiceOverride?.createGeneratedDraftExportCandidate) return intakeServiceOverride;
  exportCandidateServicePromise ||= import("../services/kaiExportCandidateService.js");
  return exportCandidateServicePromise;
}

async function getHumanAuthorityDecisionService() {
  if (intakeServiceOverride?.recordHumanFinalReleaseAuthorityDecision) return intakeServiceOverride;
  humanAuthorityDecisionServicePromise ||= import("../services/kaiHumanAuthorityDecisionService.js");
  return humanAuthorityDecisionServicePromise;
}

function generatedContentDraftIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const generatedContentDraftId = typeof req.params?.generatedContentDraftId === "string"
    ? req.params.generatedContentDraftId
    : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(generatedContentDraftId) || generatedContentDraftId !== generatedContentDraftId.toLowerCase()) return null;
  return { organizationId, generatedContentDraftId };
}

function exportCandidateIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const exportCandidateId = typeof req.params?.exportCandidateId === "string"
    ? req.params.exportCandidateId
    : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(exportCandidateId) || exportCandidateId !== exportCandidateId.toLowerCase()) return null;
  return { organizationId, exportCandidateId };
}

function validateRequestExportReviewRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = generatedContentDraftIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_generated_content_draft_id")],
    });
    return null;
  }
  const result = validateRequestExportReviewRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

function validateCreateExportCandidateRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = generatedContentDraftIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_generated_content_draft_id")],
    });
    return null;
  }
  const result = validateCreateExportCandidateRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

function validateHumanFinalReleaseAuthorityRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = exportCandidateIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_export_candidate_id")],
    });
    return null;
  }
  const result = validateHumanFinalReleaseAuthorityRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

router.post(
  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-request",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateRequestExportReviewRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    const payload = requestPayload(req);
    return invokeService(res, async () => {
      const service = await getExportReviewService();
      return service.requestGeneratedDraftExportReview({
        organizationId: identifiers.organizationId,
        generatedContentDraftId: identifiers.generatedContentDraftId,
        requestedExportAudience: payload.requested_export_audience,
        actorContext,
        now,
      });
    }, 201);
  },
);

router.post(
  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-candidates",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateCreateExportCandidateRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getExportCandidateService();
      return service.createGeneratedDraftExportCandidate({
        organizationId: identifiers.organizationId,
        generatedContentDraftId: identifiers.generatedContentDraftId,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForGeneratedDraftExportCandidate({
          organizationId: identifiers.organizationId,
          generatedContentDraftId: identifiers.generatedContentDraftId,
          actorContext,
          now,
        }),
      });
    }, 201);
  },
);

router.post(
  "/admin/organizations/:organizationId/export-candidates/:exportCandidateId/final-release-authority",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateHumanFinalReleaseAuthorityRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    const payload = requestPayload(req);
    return invokeService(res, async () => {
      const service = await getHumanAuthorityDecisionService();
      return service.recordHumanFinalReleaseAuthorityDecision({
        organizationId: identifiers.organizationId,
        exportCandidateId: identifiers.exportCandidateId,
        requestedAudience: payload.requested_audience,
        decisionAction: payload.decision_action,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForHumanFinalReleaseAuthority({
          organizationId: identifiers.organizationId,
          exportCandidateId: identifiers.exportCandidateId,
          actorContext,
          now,
        }),
      });
    }, 201);
  },
);

async function getExportManifestService() {
  if (intakeServiceOverride?.createExportManifest) return intakeServiceOverride;
  exportManifestServicePromise ||= import("../services/kaiExportManifestService.js");
  return exportManifestServicePromise;
}

function validateCreateExportManifestRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = exportCandidateIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_export_candidate_id")],
    });
    return null;
  }
  const result = validateCreateExportManifestRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

router.post(
  "/admin/organizations/:organizationId/export-candidates/:exportCandidateId/export-manifests",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateCreateExportManifestRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    const payload = requestPayload(req);
    return invokeService(res, async () => {
      const service = await getExportManifestService();
      return service.createExportManifest({
        organizationId: identifiers.organizationId,
        exportCandidateId: identifiers.exportCandidateId,
        exportReviewQueueItemId: payload.export_review_queue_item_id,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForExportManifest({
          organizationId: identifiers.organizationId,
          exportCandidateId: identifiers.exportCandidateId,
          actorContext,
          now,
        }),
      });
    }, 201);
  },
);

async function getExportManifestMarkdownService() {
  if (intakeServiceOverride?.serializeExportManifestToMarkdown) return intakeServiceOverride;
  exportManifestMarkdownServicePromise ||= import("../services/kaiExportManifestMarkdownSerializer.js");
  return exportManifestMarkdownServicePromise;
}

async function getExportManifestCsvService() {
  if (intakeServiceOverride?.serializeExportManifestToCsv) return intakeServiceOverride;
  exportManifestCsvServicePromise ||= import("../services/kaiExportManifestCsvSerializer.js");
  return exportManifestCsvServicePromise;
}

async function getExportManifestPdfService() {
  if (intakeServiceOverride?.serializeExportManifestToPdf) return intakeServiceOverride;
  exportManifestPdfServicePromise ||= import("../services/kaiExportManifestPdfSerializer.js");
  return exportManifestPdfServicePromise;
}

async function getExportManifestDocxService() {
  if (intakeServiceOverride?.serializeExportManifestToDocx) return intakeServiceOverride;
  exportManifestDocxServicePromise ||= import("../services/kaiExportManifestDocxSerializer.js");
  return exportManifestDocxServicePromise;
}

function exportManifestIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const exportManifestId = typeof req.params?.exportManifestId === "string"
    ? req.params.exportManifestId
    : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(exportManifestId) || exportManifestId !== exportManifestId.toLowerCase()) return null;
  return { organizationId, exportManifestId };
}

router.get(
  "/admin/organizations/:organizationId/export-manifests/:exportManifestId/markdown",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = exportManifestIdentifiers(req);
    if (!identifiers) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_export_manifest_id")],
      });
    }
    try {
      const service = await getExportManifestMarkdownService();
      return sendMarkdownAttachment(res, await service.serializeExportManifestToMarkdown({
        organizationId: identifiers.organizationId,
        exportManifestId: identifiers.exportManifestId,
        actorContext: sprint2MappedActorContext(req),
      }));
    } catch (error) {
      console.error("[kai-sprint2-intake] system_error", error);
      return sendKaiError(res, "system_error");
    }
  },
);

router.get(
  "/admin/organizations/:organizationId/export-manifests/:exportManifestId/csv",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = exportManifestIdentifiers(req);
    if (!identifiers) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_export_manifest_id")],
      });
    }
    try {
      const service = await getExportManifestCsvService();
      return sendCsvAttachment(res, await service.serializeExportManifestToCsv({
        organizationId: identifiers.organizationId,
        exportManifestId: identifiers.exportManifestId,
        actorContext: sprint2MappedActorContext(req),
      }));
    } catch (error) {
      console.error("[kai-sprint2-intake] system_error", error);
      return sendKaiError(res, "system_error");
    }
  },
);

router.get(
  "/admin/organizations/:organizationId/export-manifests/:exportManifestId/pdf",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = exportManifestIdentifiers(req);
    if (!identifiers) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_export_manifest_id")],
      });
    }
    try {
      const service = await getExportManifestPdfService();
      return sendPdfAttachment(res, await service.serializeExportManifestToPdf({
        organizationId: identifiers.organizationId,
        exportManifestId: identifiers.exportManifestId,
        actorContext: sprint2MappedActorContext(req),
      }));
    } catch (error) {
      console.error("[kai-sprint2-intake] system_error", error);
      return sendKaiError(res, "system_error");
    }
  },
);

router.get(
  "/admin/organizations/:organizationId/export-manifests/:exportManifestId/docx",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = exportManifestIdentifiers(req);
    if (!identifiers) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_export_manifest_id")],
      });
    }
    try {
      const service = await getExportManifestDocxService();
      return sendDocxAttachment(res, await service.serializeExportManifestToDocx({
        organizationId: identifiers.organizationId,
        exportManifestId: identifiers.exportManifestId,
        actorContext: sprint2MappedActorContext(req),
      }));
    } catch (error) {
      console.error("[kai-sprint2-intake] system_error", error);
      return sendKaiError(res, "system_error");
    }
  },
);

router.get(
  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-queue/:exportReviewQueueItemId/packet",
  sprint2ActorContextMiddleware,
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
  sprint2ActorContextMiddleware,
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
  sprint2ActorContextMiddleware,
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
  if (
    intakeServiceOverride?.listAuthorizedEngagements ||
    intakeServiceOverride?.updateEngagementRequirementTarget ||
    intakeServiceOverride?.classifyEngagementFunderRequirementsState
  ) {
    return intakeServiceOverride;
  }
  engagementContextServicePromise ||= import("../services/kaiEngagementContextService.js");
  return engagementContextServicePromise;
}

let engagementRequirementApplicabilityServicePromise = null;
async function getEngagementRequirementApplicabilityService() {
  if (
    intakeServiceOverride?.proposeEngagementRequirementSetApplicability ||
    intakeServiceOverride?.approveEngagementRequirementSetApplicability
  ) {
    return intakeServiceOverride;
  }
  engagementRequirementApplicabilityServicePromise ||= import("../services/kaiEngagementRequirementApplicabilityService.js");
  return engagementRequirementApplicabilityServicePromise;
}

let engagementFunderRequirementsCompositionServicePromise = null;
async function getEngagementFunderRequirementsCompositionService() {
  if (intakeServiceOverride?.getEngagementFunderRequirementsForImpactLibrary) {
    return intakeServiceOverride;
  }
  engagementFunderRequirementsCompositionServicePromise ||= import(
    "../services/kaiEngagementFunderRequirementsCompositionService.js"
  );
  return engagementFunderRequirementsCompositionServicePromise;
}

async function getExternalRequirementSetRegistrationService() {
  if (intakeServiceOverride?.registerExternalRequirementSet) return intakeServiceOverride;
  externalRequirementSetRegistrationServicePromise ||= import(
    "../services/kaiExternalRequirementSetRegistrationService.js"
  );
  return externalRequirementSetRegistrationServicePromise;
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

/**
 * Structured external requirement-set registration: creates/replays only the
 * existing catalogue objects (`requirement_sources` -> framework version ->
 * requirement set -> requirements). It does not create
 * engagement_requirement_sets applicability rows or requirement assessments.
 * The route accepts only structured JSON and delegates authorization,
 * validation, transaction, persistence, audit, and DTO allowlisting to the
 * service layer.
 */
router.post(
  "/admin/organizations/:organizationId/external-requirement-sets",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    if (!metadataContentTypeIsSupported(req)) {
      return sendKaiError(res, "unsupported_media_type");
    }
    const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
    if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id")],
      });
    }
    return invokeService(res, async () => {
      const service = await getExternalRequirementSetRegistrationService();
      return service.registerExternalRequirementSet({
        organizationId,
        payload: requestPayload(req),
        actorContext: sprint2MappedActorContext(req),
      });
    });
  },
);

router.put("/admin/organizations/:organizationId/engagements/:engagementId/requirement-target", async (req, res) => {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const engagementId = typeof req.params?.engagementId === "string" ? req.params.engagementId : "";
  if (
    !KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) ||
    organizationId !== organizationId.toLowerCase() ||
    !KAI_SPRINT2_P0_PATTERNS.uuid.test(engagementId) ||
    engagementId !== engagementId.toLowerCase()
  ) {
    return sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_engagement_id")],
    });
  }

  const payload = requestPayload(req);
  const payloadKeys = Object.keys(payload);
  if (payloadKeys.length !== 1 || !Object.hasOwn(payload, "target")) {
    return sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("unknown_field", "body")],
    });
  }

  return invokeService(res, async () => {
    const service = await getEngagementContextService();
    return service.updateEngagementRequirementTarget({
      organizationId,
      engagementId,
      target: payload.target,
      req: { user: safeAuthenticatedUser(req) },
    });
  });
});

router.get("/admin/organizations/:organizationId/engagements/:engagementId/funder-requirements-state", async (req, res) => {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const engagementId = typeof req.params?.engagementId === "string" ? req.params.engagementId : "";
  if (
    !KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) ||
    organizationId !== organizationId.toLowerCase() ||
    !KAI_SPRINT2_P0_PATTERNS.uuid.test(engagementId) ||
    engagementId !== engagementId.toLowerCase()
  ) {
    return sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_engagement_id")],
    });
  }

  return invokeService(res, async () => {
    const service = await getEngagementContextService();
    return service.classifyEngagementFunderRequirementsState({
      organizationId,
      engagementId,
      req: { user: safeAuthenticatedUser(req) },
    });
  });
});

/**
 * KAI Package 4: the read-only `/impact-library` Funder Requirements
 * composition. Strictly read-only and additive to the Package 1B classifier
 * route above - it delegates to the classifier for applicability state, and,
 * only when that state is `applicable_requirement_set_assessment_not_available`
 * (a currently applicable requirement set exists), further delegates to the
 * Package 3A/3B engagement-scoped assessment read for each governed
 * requirement in that set. Never touches the generic organization-scope
 * (`engagement_id IS NULL`) requirement-assessment repository. Contains no
 * SQL and no direct database access, delegating exactly once (per
 * requirement) to the authorized composition service.
 */
router.get(
  "/admin/organizations/:organizationId/engagements/:engagementId/funder-requirements",
  async (req, res) => {
    const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
    const engagementId = typeof req.params?.engagementId === "string" ? req.params.engagementId : "";
    if (
      !KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) ||
      organizationId !== organizationId.toLowerCase() ||
      !KAI_SPRINT2_P0_PATTERNS.uuid.test(engagementId) ||
      engagementId !== engagementId.toLowerCase()
    ) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_engagement_id")],
      });
    }

    return invokeService(res, async () => {
      const service = await getEngagementFunderRequirementsCompositionService();
      return service.getEngagementFunderRequirementsForImpactLibrary({
        organizationId,
        engagementId,
        req: { user: safeAuthenticatedUser(req) },
      });
    });
  },
);

/**
 * KAI Package 2B-A: propose that an authoritative external requirement set
 * applies to this engagement. Non-authoritative - it never establishes
 * current applicability; the service validates organization/engagement
 * ownership, that the requirement set exists and is external/governed
 * (never `kai_standard`), and that its exact source_code/framework_code
 * identity matches the engagement's current selected target. The request
 * accepts only `requirementSetId`; the client cannot set applicability
 * status, effective state, or any reviewed/target-snapshot field.
 */
router.post(
  "/admin/organizations/:organizationId/engagements/:engagementId/requirement-set-applicability-proposals",
  async (req, res) => {
    const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
    const engagementId = typeof req.params?.engagementId === "string" ? req.params.engagementId : "";
    if (
      !KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) ||
      organizationId !== organizationId.toLowerCase() ||
      !KAI_SPRINT2_P0_PATTERNS.uuid.test(engagementId) ||
      engagementId !== engagementId.toLowerCase()
    ) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_engagement_id")],
      });
    }

    const payload = requestPayload(req);
    const payloadKeys = Object.keys(payload);
    const requirementSetId = typeof payload.requirementSetId === "string" ? payload.requirementSetId : "";
    if (
      payloadKeys.length !== 1 ||
      !Object.hasOwn(payload, "requirementSetId") ||
      !KAI_SPRINT2_P0_PATTERNS.uuid.test(requirementSetId) ||
      requirementSetId !== requirementSetId.toLowerCase()
    ) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "requirement_set_id")],
      });
    }

    return invokeService(res, async () => {
      const service = await getEngagementRequirementApplicabilityService();
      return service.proposeEngagementRequirementSetApplicability({
        organizationId,
        engagementId,
        requirementSetId,
        req: { user: safeAuthenticatedUser(req) },
      });
    });
  },
);

const ENGAGEMENT_REQUIREMENT_SET_APPLICABILITY_REVIEW_DECISIONS = new Set(["applicable", "not_applicable", "retired"]);

/**
 * KAI Package 2B: authorized human review/approval of the current decision
 * for one governed (organization, engagement, requirement_set) identity -
 * the service resolves which row is "current" using the Package 2A
 * current-authority predicate, so the client never supplies a row id to
 * supersede. On a first review this confirms the non-authoritative proposal
 * (Package 2B-A); on a later review it governedly replaces an already
 * reviewed decision (Package 2B-B) - the prior row is preserved unchanged as
 * history. The request body accepts only `decision`, constrained to the
 * three reviewed states Package 2A's schema already supports (`applicable`,
 * `not_applicable`, `retired`); reviewer identity, review timestamp,
 * target snapshot, and supersession identity are all derived server-side
 * inside a governed transaction, never accepted from the client. Only the
 * fixed `gk_reviewer` role may review; the service itself rejects any
 * non-human (AI/system) actor unconditionally.
 */
router.post(
  "/admin/organizations/:organizationId/engagements/:engagementId/requirement-sets/:requirementSetId/applicability-review",
  async (req, res) => {
    const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
    const engagementId = typeof req.params?.engagementId === "string" ? req.params.engagementId : "";
    const requirementSetId = typeof req.params?.requirementSetId === "string" ? req.params.requirementSetId : "";
    if (
      !KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) ||
      organizationId !== organizationId.toLowerCase() ||
      !KAI_SPRINT2_P0_PATTERNS.uuid.test(engagementId) ||
      engagementId !== engagementId.toLowerCase() ||
      !KAI_SPRINT2_P0_PATTERNS.uuid.test(requirementSetId) ||
      requirementSetId !== requirementSetId.toLowerCase()
    ) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_engagement_id_or_requirement_set_id")],
      });
    }

    const payload = requestPayload(req);
    const payloadKeys = Object.keys(payload);
    if (
      payloadKeys.length !== 1 ||
      !Object.hasOwn(payload, "decision") ||
      !ENGAGEMENT_REQUIREMENT_SET_APPLICABILITY_REVIEW_DECISIONS.has(payload.decision)
    ) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_enum_field", "decision")],
      });
    }

    return invokeService(res, async () => {
      const service = await getEngagementRequirementApplicabilityService();
      return service.approveEngagementRequirementSetApplicability({
        organizationId,
        engagementId,
        requirementSetId,
        decision: payload.decision,
        req: { user: safeAuthenticatedUser(req) },
      });
    });
  },
);

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
  sprint2ActorContextMiddleware,
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
  sprint2ActorContextMiddleware,
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
  sprint2ActorContextMiddleware,
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
  sprint2ActorContextMiddleware,
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
  sprint2ActorContextMiddleware,
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
  sprint2ActorContextMiddleware,
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

async function getDataDictionaryService() {
  if (intakeServiceOverride?.listDataDictionaryEntries) return intakeServiceOverride;
  dataDictionaryServicePromise ||= import("../services/kaiDataDictionaryService.js");
  return dataDictionaryServicePromise;
}

const KAI_P2_08_DEFAULT_LIMIT = 25;
const KAI_P2_08_MAX_LIMIT = 100;

function eligibleClaimsForAudienceOrganizationIdentifier(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  return { organizationId };
}

function dataDictionaryEntriesIdentifier(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const dataDictionaryId = typeof req.params?.dataDictionaryId === "string" ? req.params.dataDictionaryId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(dataDictionaryId) || dataDictionaryId !== dataDictionaryId.toLowerCase()) return null;
  return { organizationId, dataDictionaryId };
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
  sprint2ActorContextMiddleware,
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
  sprint2ActorContextMiddleware,
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
    || intakeServiceOverride?.createImpactNarrativeDraft
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
  sprint2ActorContextMiddleware,
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
    || keys.length !== 3
    || !keys.every((key) => key === "claim_ids" || key === "idempotency_key" || key === "engagement_id")
    || typeof payload.engagement_id !== "string"
    || !KAI_SPRINT2_P0_PATTERNS.uuid.test(payload.engagement_id)
    || payload.engagement_id !== payload.engagement_id.toLowerCase()
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
        "organization_id_claim_ids_idempotency_key_or_engagement_id",
      )],
    });
    return null;
  }
  return {
    organizationId: identifiers.organizationId,
    claimIds: [...payload.claim_ids].sort(),
    idempotencyKey: payload.idempotency_key,
    engagementId: payload.engagement_id,
  };
}

router.post(
  "/admin/organizations/:organizationId/generated-content-drafts/evidence-summary",
  sprint2ActorContextMiddleware,
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
        engagementId: parsed.engagementId,
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

/**
 * P14-09: governed FUNDER evidence-summary generation for an explicit
 * engagement. This is a distinct, additive route - the existing internal
 * evidence-summary route above is completely unchanged and stays fixed to
 * requestedAudience "internal". The accepted request body shape is
 * identical to the internal route (claim_ids, idempotency_key,
 * engagement_id only); requestedAudience is never read from the client and
 * is instead set server-side to "funder" below. The same
 * createEvidenceSummaryDraft service/repository/generator/validator/audit
 * vertical is reused unmodified in its persistence, idempotency, and audit
 * mechanics - only requestedAudience differs, and the repository's own
 * freshly-evaluated funder-eligibility gate (pre- and post-generation)
 * governs whether generation may proceed.
 */
function validateCreateFunderEvidenceSummaryRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = eligibleClaimsForAudienceOrganizationIdentifier(req);
  const payload = requestPayload(req);
  const keys = Object.keys(payload);
  if (
    !identifiers
    || keys.length !== 3
    || !keys.every((key) => key === "claim_ids" || key === "idempotency_key" || key === "engagement_id")
    || typeof payload.engagement_id !== "string"
    || !KAI_SPRINT2_P0_PATTERNS.uuid.test(payload.engagement_id)
    || payload.engagement_id !== payload.engagement_id.toLowerCase()
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
        "invalid_funder_evidence_summary_generation_request",
        "organization_id_claim_ids_idempotency_key_or_engagement_id",
      )],
    });
    return null;
  }
  return {
    organizationId: identifiers.organizationId,
    claimIds: [...payload.claim_ids].sort(),
    idempotencyKey: payload.idempotency_key,
    engagementId: payload.engagement_id,
  };
}

router.post(
  "/admin/organizations/:organizationId/generated-content-drafts/evidence-summary/funder",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const parsed = validateCreateFunderEvidenceSummaryRequestOrSend(req, res);
    if (!parsed) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getGeneratedContentService();
      const { createProductionEvidenceSummaryDraftGenerator } = await import("../services/kaiEvidenceSummaryDraftGenerator.js");
      return service.createEvidenceSummaryDraft({
        organizationId: parsed.organizationId,
        engagementId: parsed.engagementId,
        requestedAudience: "funder",
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
          route: "p14_09_create_funder_evidence_summary_draft",
        }),
      });
    }, 201);
  },
);

function validateCreateImpactNarrativeRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = eligibleClaimsForAudienceOrganizationIdentifier(req);
  const payload = requestPayload(req);
  const keys = Object.keys(payload);
  if (
    !identifiers
    || keys.length !== 3
    || !keys.every((key) => key === "claim_ids" || key === "idempotency_key" || key === "engagement_id")
    || typeof payload.engagement_id !== "string"
    || !KAI_SPRINT2_P0_PATTERNS.uuid.test(payload.engagement_id)
    || payload.engagement_id !== payload.engagement_id.toLowerCase()
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
        "invalid_internal_impact_narrative_generation_request",
        "organization_id_claim_ids_idempotency_key_or_engagement_id",
      )],
    });
    return null;
  }
  return {
    organizationId: identifiers.organizationId,
    claimIds: [...payload.claim_ids].sort(),
    idempotencyKey: payload.idempotency_key,
    engagementId: payload.engagement_id,
  };
}

router.post(
  "/admin/organizations/:organizationId/generated-content-drafts/impact-narrative",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const parsed = validateCreateImpactNarrativeRequestOrSend(req, res);
    if (!parsed) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getGeneratedContentService();
      const { createProductionImpactNarrativeDraftGenerator } = await import("../services/kaiImpactNarrativeDraftGenerator.js");
      return service.createImpactNarrativeDraft({
        organizationId: parsed.organizationId,
        engagementId: parsed.engagementId,
        requestedAudience: "internal",
        claimIds: parsed.claimIds,
        idempotencyKey: parsed.idempotencyKey,
        actorContext,
        now,
      }, {
        draftGenerator: createProductionImpactNarrativeDraftGenerator(),
        metadataOnlyAudit: createProductionMetadataOnlyAuditForGeneratedContentDraft({
          organizationId: parsed.organizationId,
          actorContext,
          now,
          route: "p13_01_create_impact_narrative_draft",
        }),
      });
    }, 201);
  },
);

router.get(
  "/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/review-packet",
  sprint2ActorContextMiddleware,
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

function grantResponsePacketIdentifier(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const engagementId = typeof req.params?.engagementId === "string" ? req.params.engagementId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(engagementId) || engagementId !== engagementId.toLowerCase()) return null;
  return { organizationId, engagementId };
}

let grantResponsePacketServicePromise = null;
async function getGrantResponsePacketService() {
  if (intakeServiceOverride?.getGrantResponsePacket) return intakeServiceOverride;
  grantResponsePacketServicePromise ||= import("../services/kaiGrantResponsePacketService.js");
  return grantResponsePacketServicePromise;
}

async function getGrantResponsePacketMarkdownService() {
  if (intakeServiceOverride?.serializeGrantResponsePacketToMarkdown) return intakeServiceOverride;
  grantResponsePacketMarkdownServicePromise ||= import("../services/kaiGrantResponsePacketMarkdownSerializer.js");
  return grantResponsePacketMarkdownServicePromise;
}

async function getGrantResponsePacketExportCandidateService() {
  if (intakeServiceOverride?.createGrantResponsePacketExportCandidate) return intakeServiceOverride;
  grantResponsePacketExportCandidateServicePromise ||= import(
    "../services/kaiGrantResponsePacketExportCandidateService.js"
  );
  return grantResponsePacketExportCandidateServicePromise;
}

function validateCreateGrantResponsePacketExportCandidateRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = grantResponsePacketIdentifier(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_engagement_id")],
    });
    return null;
  }
  const result = validateCreateGrantResponsePacketExportCandidateRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

/**
 * Grant Response Packet: a read-only, engagement-scoped regrouping of
 * already-governed generated-draft review packets. Membership resolves
 * exclusively through generation_runs.engagement_id (never latest/newest/
 * preferred draft selection); each member draft is exactly the same
 * governed single-draft packet the /review-packet route above already
 * authorizes reading one at a time. Contains no SQL and no direct
 * database access - delegates once to kaiGrantResponsePacketService.
 * Grants no approval/export/finalization authority.
 */
router.get(
  "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = grantResponsePacketIdentifier(req);
    if (!identifiers || Object.keys(req.query || {}).length !== 0) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker(
          "invalid_organization_id_engagement_id_or_query",
          "organization_id_engagement_id",
        )],
      });
    }
    return invokeService(res, async () => {
      const service = await getGrantResponsePacketService();
      return service.getGrantResponsePacket({
        organizationId: identifiers.organizationId,
        engagementId: identifiers.engagementId,
        actorContext: sprint2MappedActorContext(req),
      });
    });
  },
);

/**
 * Grant Response Packet Markdown delivery: deterministic, read-only
 * packet-level representation composed exclusively from
 * composeGrantResponsePacketRenderModel(authoritative packet result).
 * Contains no SQL, no mutation, no final-release claim, no client-selected
 * membership, and no packet candidate/manifest identity.
 */
router.get(
  "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/markdown",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = grantResponsePacketIdentifier(req);
    if (!identifiers || Object.keys(req.query || {}).length !== 0) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker(
          "invalid_organization_id_engagement_id_or_query",
          "organization_id_engagement_id",
        )],
      });
    }
    try {
      const service = await getGrantResponsePacketMarkdownService();
      return sendGrantResponsePacketMarkdownAttachment(res, await service.serializeGrantResponsePacketToMarkdown({
        organizationId: identifiers.organizationId,
        engagementId: identifiers.engagementId,
        actorContext: sprint2MappedActorContext(req),
      }));
    } catch (error) {
      console.error("[kai-sprint2-intake] system_error", error);
      return sendKaiError(res, "system_error");
    }
  },
);

async function getBoardReportingCandidateService() {
  if (
    intakeServiceOverride?.requestBoardReportingCandidateReview
    || intakeServiceOverride?.startBoardReportingCandidateReview
    || intakeServiceOverride?.completeBoardReportingCandidateReview
  ) return intakeServiceOverride;
  boardReportingCandidateServicePromise ||= import("../services/kaiBoardReportingCandidateService.js");
  return boardReportingCandidateServicePromise;
}

function boardReportingCandidateReviewIdentifier(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const engagementId = typeof req.params?.engagementId === "string" ? req.params.engagementId : "";
  const boardReportingCandidateId = typeof req.params?.boardReportingCandidateId === "string"
    ? req.params.boardReportingCandidateId
    : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(engagementId) || engagementId !== engagementId.toLowerCase()) return null;
  if (
    !KAI_SPRINT2_P0_PATTERNS.uuid.test(boardReportingCandidateId)
    || boardReportingCandidateId !== boardReportingCandidateId.toLowerCase()
  ) return null;
  return { organizationId, engagementId, boardReportingCandidateId };
}

function validateRequestBoardReportingCandidateReviewRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = boardReportingCandidateReviewIdentifier(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field",
        "organization_id_engagement_id_or_board_reporting_candidate_id",
      )],
    });
    return null;
  }
  const result = validateRequestBoardReportingCandidateReviewRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

router.post(
  "/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId/review-request",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateRequestBoardReportingCandidateReviewRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getBoardReportingCandidateService();
      return service.requestBoardReportingCandidateReview({
        organizationId: identifiers.organizationId,
        engagementId: identifiers.engagementId,
        boardReportingCandidateId: identifiers.boardReportingCandidateId,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForBoardReportingCandidate({
          organizationId: identifiers.organizationId,
          engagementId: identifiers.engagementId,
          actorContext,
          now,
        }),
      });
    }, 201);
  },
);

function boardReportingCandidateReviewQueueIdentifier(req = {}) {
  const root = boardReportingCandidateReviewIdentifier(req);
  if (!root) return null;
  const reviewQueueItemId = typeof req.params?.reviewQueueItemId === "string" ? req.params.reviewQueueItemId : "";
  if (
    !KAI_SPRINT2_P0_PATTERNS.uuid.test(reviewQueueItemId)
    || reviewQueueItemId !== reviewQueueItemId.toLowerCase()
  ) return null;
  return { ...root, reviewQueueItemId };
}

function validateStartBoardReportingCandidateReviewRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = boardReportingCandidateReviewQueueIdentifier(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field",
        "organization_id_engagement_id_board_reporting_candidate_id_or_review_queue_item_id",
      )],
    });
    return null;
  }
  const result = validateStartBoardReportingCandidateReviewRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

// BR-03B: Board review START. Delegates the entire lifecycle transition to
// kaiBoardReportingCandidateService/postgresBoardReportingCandidateRepository
// - no SQL, no direct kai.* access, no raw KAI DB-helper access here. Mutates
// only the existing review_queue_items row's queue_status/review_status; it
// never touches the immutable board_reporting_candidates/
// board_reporting_candidate_members rows, and creates no release authority,
// final eligibility, manifest, or delivery state.
router.post(
  "/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId/review-queue/:reviewQueueItemId/start",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateStartBoardReportingCandidateReviewRequestOrSend(req, res);
    if (!identifiers) return;
    const payload = requestPayload(req);
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getBoardReportingCandidateService();
      return service.startBoardReportingCandidateReview({
        organizationId: identifiers.organizationId,
        engagementId: identifiers.engagementId,
        boardReportingCandidateId: identifiers.boardReportingCandidateId,
        reviewQueueItemId: identifiers.reviewQueueItemId,
        expectedUpdatedAt: payload.expected_updated_at,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForBoardReportingCandidate({
          organizationId: identifiers.organizationId,
          engagementId: identifiers.engagementId,
          actorContext,
          now,
        }),
      });
    });
  },
);

function validateCompleteBoardReportingCandidateReviewRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = boardReportingCandidateReviewQueueIdentifier(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field",
        "organization_id_engagement_id_board_reporting_candidate_id_or_review_queue_item_id",
      )],
    });
    return null;
  }
  const result = validateCompleteBoardReportingCandidateReviewRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

// BR-03B: Board review COMPLETE. Delegates the entire lifecycle transition
// to kaiBoardReportingCandidateService/postgresBoardReportingCandidateRepository
// - no SQL, no direct kai.* access, no raw KAI DB-helper access here.
// Transitions the EXACT existing 'board_reporting_candidate_review' queue
// row identified by the route's own reviewQueueItemId from
// in_progress/needs_gk_review to resolved/resolved only, reusing the same
// optimistic expected_updated_at CAS/replay contract the START route above
// already uses. It never touches the immutable board_reporting_candidates/
// board_reporting_candidate_members rows, and creates no release authority,
// final eligibility, manifest, or delivery state - completion means only
// that a gk_admin completed the governed human Board review of this exact
// immutable Board Reporting candidate.
router.post(
  "/admin/organizations/:organizationId/engagements/:engagementId/board-reporting/candidates/:boardReportingCandidateId/review-queue/:reviewQueueItemId/complete",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateCompleteBoardReportingCandidateReviewRequestOrSend(req, res);
    if (!identifiers) return;
    const payload = requestPayload(req);
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getBoardReportingCandidateService();
      return service.completeBoardReportingCandidateReview({
        organizationId: identifiers.organizationId,
        engagementId: identifiers.engagementId,
        boardReportingCandidateId: identifiers.boardReportingCandidateId,
        reviewQueueItemId: identifiers.reviewQueueItemId,
        expectedUpdatedAt: payload.expected_updated_at,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForBoardReportingCandidate({
          organizationId: identifiers.organizationId,
          engagementId: identifiers.engagementId,
          actorContext,
          now,
        }),
      });
    });
  },
);

/**
 * Grant Response Packet export-candidate workflow wiring (P14-04): creates
 * or reuses (on replay) the P14-03 packet-candidate + authoritative member
 * snapshot for the route's own organizationId/engagementId. The browser
 * supplies no candidate composition - no packetAudience, packet identity
 * id, candidate id, member ids, ordering, or fingerprint - actorContext is
 * derived exclusively from the authenticated server context, and every
 * piece of candidate state is resolved server-side through the one
 * existing P14-03 service/repository path. Contains no SQL and no direct
 * database access - delegates once to
 * kaiGrantResponsePacketExportCandidateService. Creating/reusing a
 * candidate grants no approval, no funder/public readiness, no export
 * authority, no final release, and no manifest.
 */
router.post(
  "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateCreateGrantResponsePacketExportCandidateRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getGrantResponsePacketExportCandidateService();
      return service.createGrantResponsePacketExportCandidate({
        organizationId: identifiers.organizationId,
        engagementId: identifiers.engagementId,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForGrantResponsePacketExportCandidate({
          organizationId: identifiers.organizationId,
          engagementId: identifiers.engagementId,
          actorContext,
          now,
        }),
      });
    }, 201);
  },
);

function grantResponsePacketExportCandidateReviewIdentifier(req = {}) {
  const root = grantResponsePacketIdentifier(req);
  const grantResponsePacketExportCandidateId = typeof req.params?.grantResponsePacketExportCandidateId === "string"
    ? req.params.grantResponsePacketExportCandidateId
    : "";
  if (!root) return null;
  if (
    !KAI_SPRINT2_P0_PATTERNS.uuid.test(grantResponsePacketExportCandidateId)
    || grantResponsePacketExportCandidateId !== grantResponsePacketExportCandidateId.toLowerCase()
  ) return null;
  return { ...root, grantResponsePacketExportCandidateId };
}

async function getGrantResponsePacketExportReviewService() {
  if (
    intakeServiceOverride?.requestGrantResponsePacketExportReview
    || intakeServiceOverride?.startGrantResponsePacketExportReview
    || intakeServiceOverride?.completeGrantResponsePacketExportReview
  ) return intakeServiceOverride;
  grantResponsePacketExportReviewServicePromise ||= import(
    "../services/kaiGrantResponsePacketExportReviewService.js"
  );
  return grantResponsePacketExportReviewServicePromise;
}

function grantResponsePacketExportReviewStartIdentifier(req = {}) {
  const root = grantResponsePacketExportCandidateReviewIdentifier(req);
  const exportReviewQueueItemId = typeof req.params?.exportReviewQueueItemId === "string"
    ? req.params.exportReviewQueueItemId
    : "";
  if (!root) return null;
  if (
    !KAI_SPRINT2_P0_PATTERNS.uuid.test(exportReviewQueueItemId)
    || exportReviewQueueItemId !== exportReviewQueueItemId.toLowerCase()
  ) return null;
  return { ...root, exportReviewQueueItemId };
}

function validateRequestGrantResponsePacketExportReviewRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = grantResponsePacketExportCandidateReviewIdentifier(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field",
        "organization_id_engagement_id_or_grant_response_packet_export_candidate_id",
      )],
    });
    return null;
  }
  const result = validateRequestGrantResponsePacketExportReviewRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

/**
 * Grant Response Packet export-review binding (P14-05): requests governed
 * export review for the EXACT existing, immutable P14-03 packet export
 * candidate identified by the route's own organizationId/engagementId/
 * grantResponsePacketExportCandidateId - never a client-selected latest/
 * newest/preferred candidate, and never client-supplied membership,
 * fingerprint, memberCount, or manifest identity. Reuses the one existing
 * governed 'export_review' queue_type/lifecycle via the P14-05 widened
 * review_queue_items contract - no parallel packet review state machine.
 * Contains no SQL and no direct database access - delegates once to
 * kaiGrantResponsePacketExportReviewService. Requesting review grants no
 * approval, no funder/public readiness, no export authority, no final
 * release, and no manifest.
 */
router.post(
  "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates/:grantResponsePacketExportCandidateId/export-review-request",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateRequestGrantResponsePacketExportReviewRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getGrantResponsePacketExportReviewService();
      return service.requestGrantResponsePacketExportReview({
        organizationId: identifiers.organizationId,
        engagementId: identifiers.engagementId,
        grantResponsePacketExportCandidateId: identifiers.grantResponsePacketExportCandidateId,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForGrantResponsePacketExportReview({
          organizationId: identifiers.organizationId,
          engagementId: identifiers.engagementId,
          actorContext,
          now,
        }),
      });
    }, 201);
  },
);

function validateStartGrantResponsePacketExportReviewRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = grantResponsePacketExportReviewStartIdentifier(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field",
        "organization_id_engagement_id_grant_response_packet_export_candidate_id_or_export_review_queue_item_id",
      )],
    });
    return null;
  }
  const result = validateStartGrantResponsePacketExportReviewRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

/**
 * Grant Response Packet export-review binding (P14-06A): starts governed
 * export review for the EXACT existing 'export_review' queue row identified
 * by the route's own exportReviewQueueItemId, targeting the EXACT existing,
 * immutable P14-03 packet export candidate identified by the route's own
 * grantResponsePacketExportCandidateId - never a client-selected latest/
 * newest/preferred candidate or queue item, and never client-supplied
 * membership, fingerprint, memberCount, or manifest identity. Transitions
 * open/needs_gk_review to in_progress/needs_gk_review only, reusing the
 * same optimistic expected_updated_at CAS/replay contract the single-draft
 * P3-09 start route already uses. Contains no SQL and no direct database
 * access - delegates once to kaiGrantResponsePacketExportReviewService.
 * Starting review grants no final eligibility evaluation, no approval, no
 * funder/public readiness, no export authority, no final
 * release, and no manifest.
 */
router.post(
  "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates/:grantResponsePacketExportCandidateId/export-review-queue/:exportReviewQueueItemId/start",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateStartGrantResponsePacketExportReviewRequestOrSend(req, res);
    if (!identifiers) return;
    const payload = requestPayload(req);
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getGrantResponsePacketExportReviewService();
      return service.startGrantResponsePacketExportReview({
        organizationId: identifiers.organizationId,
        engagementId: identifiers.engagementId,
        grantResponsePacketExportCandidateId: identifiers.grantResponsePacketExportCandidateId,
        exportReviewQueueItemId: identifiers.exportReviewQueueItemId,
        expectedUpdatedAt: payload.expected_updated_at,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForGrantResponsePacketExportReview({
          organizationId: identifiers.organizationId,
          engagementId: identifiers.engagementId,
          actorContext,
          now,
        }),
      });
    });
  },
);

function validateCompleteGrantResponsePacketExportReviewRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = grantResponsePacketExportReviewStartIdentifier(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field",
        "organization_id_engagement_id_grant_response_packet_export_candidate_id_or_export_review_queue_item_id",
      )],
    });
    return null;
  }
  const result = validateCompleteGrantResponsePacketExportReviewRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

/**
 * Grant Response Packet export-review binding (P14-06B): completes governed
 * export review for the EXACT existing 'export_review' queue row identified
 * by the route's own exportReviewQueueItemId, targeting the EXACT existing,
 * immutable P14-03 packet export candidate identified by the route's own
 * grantResponsePacketExportCandidateId - never a client-selected latest/
 * newest/preferred candidate or queue item, and never client-supplied
 * membership, fingerprint, memberCount, or manifest identity. Transitions
 * in_progress/needs_gk_review to resolved/resolved only, reusing the same
 * optimistic expected_updated_at CAS/replay contract the single-draft
 * P3-13 complete route already uses. Contains no SQL and no direct
 * database access - delegates once to
 * kaiGrantResponsePacketExportReviewService. Completing review means only
 * that a gk_admin completed the governed human export review of this exact
 * immutable packet candidate - it grants no final eligibility evaluation,
 * no approval, no funder/public readiness, no export authority, no final
 * release, and no manifest.
 */
router.post(
  "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates/:grantResponsePacketExportCandidateId/export-review-queue/:exportReviewQueueItemId/complete",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateCompleteGrantResponsePacketExportReviewRequestOrSend(req, res);
    if (!identifiers) return;
    const payload = requestPayload(req);
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getGrantResponsePacketExportReviewService();
      return service.completeGrantResponsePacketExportReview({
        organizationId: identifiers.organizationId,
        engagementId: identifiers.engagementId,
        grantResponsePacketExportCandidateId: identifiers.grantResponsePacketExportCandidateId,
        exportReviewQueueItemId: identifiers.exportReviewQueueItemId,
        expectedUpdatedAt: payload.expected_updated_at,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForGrantResponsePacketExportReview({
          organizationId: identifiers.organizationId,
          engagementId: identifiers.engagementId,
          actorContext,
          now,
        }),
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

async function getGrantResponsePacketHumanFinalReleaseAuthorityService() {
  if (intakeServiceOverride?.recordGrantResponsePacketHumanFinalReleaseAuthorityDecision) return intakeServiceOverride;
  grantResponsePacketHumanFinalReleaseAuthorityServicePromise ||= import(
    "../services/kaiGrantResponsePacketHumanFinalReleaseAuthorityService.js"
  );
  return grantResponsePacketHumanFinalReleaseAuthorityServicePromise;
}

function validateGrantResponsePacketHumanFinalReleaseAuthorityRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = grantResponsePacketExportCandidateReviewIdentifier(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field",
        "organization_id_engagement_id_or_grant_response_packet_export_candidate_id",
      )],
    });
    return null;
  }
  const result = validateGrantResponsePacketHumanFinalReleaseAuthorityRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

/**
 * P14-07: governed human final-release authority application for the EXACT
 * existing, immutable P14-03 packet export candidate identified by the
 * route's own grantResponsePacketExportCandidateId - never a client-selected
 * latest/newest/preferred candidate. organizationId, engagementId, and the
 * candidate id all come from the route path; actorContext/now are always
 * server-derived. The request body carries only decision_action
 * (grant|revoke) - never requested_audience (a Grant Response Packet's
 * audience is always exactly "funder"), fingerprint, members, memberCount,
 * review state, eligibility, authority state, or manifest identity. Contains
 * no SQL and no direct database access - delegates once to
 * kaiGrantResponsePacketHumanFinalReleaseAuthorityService, which itself
 * delegates once to the existing P14-07B1
 * postgresGrantResponsePacketHumanAuthorityDecisionRepository.js. Recording a
 * decision here grants only the same "human final-release authority"
 * concept the existing single-draft P3-17 route already grants - no final
 * packet manifest and no final packet bytes are ever produced by this
 * route.
 */
router.post(
  "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates/:grantResponsePacketExportCandidateId/final-release-authority",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateGrantResponsePacketHumanFinalReleaseAuthorityRequestOrSend(req, res);
    if (!identifiers) return;
    const payload = requestPayload(req);
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getGrantResponsePacketHumanFinalReleaseAuthorityService();
      return service.recordGrantResponsePacketHumanFinalReleaseAuthorityDecision({
        organizationId: identifiers.organizationId,
        engagementId: identifiers.engagementId,
        grantResponsePacketExportCandidateId: identifiers.grantResponsePacketExportCandidateId,
        decisionAction: payload.decision_action,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForGrantResponsePacketHumanAuthorityDecision({
          organizationId: identifiers.organizationId,
          engagementId: identifiers.engagementId,
          actorContext,
          now,
        }),
      });
    }, 201);
  },
);

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
  sprint2ActorContextMiddleware,
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
  sprint2ActorContextMiddleware,
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
  if (intakeServiceOverride?.recordEvidenceReviewDecision) return intakeServiceOverride;
  evidenceReviewServicePromise ||= import("../services/kaiHumanReviewService.js");
  return evidenceReviewServicePromise;
}

let claimReviewServicePromise = null;
async function getHumanReviewServiceForClaimReview() {
  if (intakeServiceOverride?.recordClaimReviewDecision) return intakeServiceOverride;
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
 * KAI P2-12 (Problem A1) human evidence-review decision route. Mirrors the
 * sibling generated-content-review-completion route's `expected_updated_at`
 * body convention, on the same mounted router, extended with the reviewer's
 * decision content (`decision`, `limitation_notes`). Contains no SQL, imports
 * no data-access layer, derives actor/tenant identity exclusively server-side
 * from `sprint2MappedActorContext`, and delegates exactly once to the
 * authorized service, which alone owns writing the new append-only decision-
 * ledger row, the compare-and-set queue/domain-column write, post-write
 * validation, and required same-transaction audit. Never completes,
 * resolves, or references the linked claim's own claim_review queue item -
 * completing an evidence review can never approve a claim.
 */
router.post(
  "/admin/organizations/:organizationId/evidence-items/:evidenceItemId/evidence-review/:reviewQueueItemId/complete",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateEvidenceReviewCompletionRequestOrSend(req, res);
    if (!identifiers) return;
    const payload = requestPayload(req);
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getHumanReviewServiceForEvidenceReview();
      return service.recordEvidenceReviewDecision({
        organizationId: identifiers.organizationId,
        evidenceItemId: identifiers.evidenceItemId,
        reviewQueueItemId: identifiers.reviewQueueItemId,
        expectedUpdatedAt: payload.expected_updated_at,
        decision: payload.decision,
        limitationNotes: payload.limitation_notes,
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
 * KAI P2-12 (Problem A1) human claim-review decision route. Mirrors the
 * evidence-review decision route above, extended with `approved_audiences`.
 * It never invokes the P2-08 eligible-claims-for-audience service, any
 * Impact Evidence Library service, or any P3/generation/export service -
 * recording a claim-review decision internally triggers no automatic
 * downstream chaining.
 */
router.post(
  "/admin/organizations/:organizationId/claims/:claimId/claim-review/:reviewQueueItemId/complete",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateClaimReviewCompletionRequestOrSend(req, res);
    if (!identifiers) return;
    const payload = requestPayload(req);
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getHumanReviewServiceForClaimReview();
      return service.recordClaimReviewDecision({
        organizationId: identifiers.organizationId,
        claimId: identifiers.claimId,
        reviewQueueItemId: identifiers.reviewQueueItemId,
        expectedUpdatedAt: payload.expected_updated_at,
        decision: payload.decision,
        limitationNotes: payload.limitation_notes,
        approvedAudiences: payload.approved_audiences,
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
  if (
    intakeServiceOverride?.acceptInternalCoverageLimitation
    || intakeServiceOverride?.acceptFunderCoverageLimitation
  ) return intakeServiceOverride;
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
  sprint2ActorContextMiddleware,
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

router.post(
  "/admin/organizations/:organizationId/claims/:claimId/coverage-dimensions/:dimensionKey/funder-acceptance",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateCoverageReviewDecisionRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getCoverageReviewDecisionService();
      return service.acceptFunderCoverageLimitation({
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
router.get("/admin/organizations/:organizationId/client-followups", sprint2ActorContextMiddleware, async (req, res) => {
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

let sourceLibraryServicePromise = null;
async function getSourceLibraryService() {
  if (intakeServiceOverride?.listOrganizationSources) return intakeServiceOverride;
  sourceLibraryServicePromise ||= import("../services/kaiSourceLibraryService.js");
  return sourceLibraryServicePromise;
}

/**
 * KAI Data Sources completion package: organization-scoped browse read of
 * governed sources and their source versions, so an authorized
 * /impact-library user can discover a source_version_id instead of already
 * knowing one before using the existing P2-01 evidence-extraction / P2-02
 * evidence-coverage-assessment actions below. Read-only: no body, no SQL, no
 * direct database or schema access - delegates exactly once to the
 * authorized source-library service.
 */
router.get("/admin/organizations/:organizationId/sources", sprint2ActorContextMiddleware, async (req, res) => {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) {
    return sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id")],
    });
  }
  return invokeService(res, async () => {
    const service = await getSourceLibraryService();
    return service.listOrganizationSources({
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
  sprint2ActorContextMiddleware,
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

let requirementAssessmentServicePromise = null;
async function getRequirementAssessmentService() {
  if (intakeServiceOverride?.assessOrganizationRequirement) return intakeServiceOverride;
  requirementAssessmentServicePromise ||= import("../services/kaiRequirementAssessmentService.js");
  return requirementAssessmentServicePromise;
}

function requirementAssessmentIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const requirementId = typeof req.params?.requirementId === "string" ? req.params.requirementId : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(requirementId) || requirementId !== requirementId.toLowerCase()) return null;
  return { organizationId, requirementId };
}

function validateAssessRequirementRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = requirementAssessmentIdentifiers(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_requirement_id")],
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
 * KAI C3.A2 organization-scope requirement-assessment write route: creates
 * or replays a deterministic assessment of exactly `ir_contrib_002`
 * ("Known limitations affecting confidence in a reported result are
 * documented") against the organization's current governed evidence/claim
 * strength state. The caller identifies only the target organization and
 * requirement via the path; actor, tenant, assessment content (state/
 * explanation/fingerprint), and provenance are all server-controlled by the
 * authorized C3.A2 service/repository, never accepted from the request
 * body. Any requirement other than `ir_contrib_002` fails closed with
 * `unsupported_requirement` before any write, exactly like every other
 * "fail closed on the wrong resource" route on this router.
 */
router.post(
  "/admin/organizations/:organizationId/requirements/:requirementId/assessment",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateAssessRequirementRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getRequirementAssessmentService();
      return service.assessOrganizationRequirement({
        organizationId: identifiers.organizationId,
        requirementId: identifiers.requirementId,
        actorContext,
        now,
      }, {
        metadataOnlyAudit: createProductionMetadataOnlyAuditForRequirementAssessment({
          organizationId: identifiers.organizationId,
          requirementId: identifiers.requirementId,
          actorContext,
          now,
        }),
      });
    }, 201);
  },
);

/**
 * KAI C3.A2 organization-scope requirement-assessment read-back route.
 * Strictly read-only: recomputes the state_fingerprint live from the
 * organization's current governed evidence/claim state and returns exactly
 * the persisted assessment matching that fingerprint (the C2.1 recompute-
 * and-compare currency mechanism), together with its exact provenance link
 * sets. Contains no SQL and no direct database access, delegating exactly
 * once to the authorized C3.A2 service.
 */
router.get(
  "/admin/organizations/:organizationId/requirements/:requirementId/assessment",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = requirementAssessmentIdentifiers(req);
    if (!identifiers) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_requirement_id")],
      });
    }
    return invokeService(res, async () => {
      const service = await getRequirementAssessmentService();
      return service.getOrganizationRequirementAssessment({
        organizationId: identifiers.organizationId,
        requirementId: identifiers.requirementId,
        actorContext: sprint2MappedActorContext(req),
      });
    });
  },
);

/**
 * KAI requirements-readiness rollup read route: strictly read-only, exactly
 * like the single-requirement GET above, but reports every requirement this
 * repository supports in one response instead of requiring one round trip
 * per requirement. Contains no SQL and no direct database access, delegating
 * exactly once to the authorized requirement-assessment service.
 */
router.get(
  "/admin/organizations/:organizationId/requirements",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = eligibleClaimsForAudienceOrganizationIdentifier(req);
    if (!identifiers) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id")],
      });
    }
    return invokeService(res, async () => {
      const service = await getRequirementAssessmentService();
      return service.listOrganizationRequirementsReadiness({
        organizationId: identifiers.organizationId,
        actorContext: sprint2MappedActorContext(req),
      });
    });
  },
);

/**
 * KAI Review Queue rollup read route: organization-scope product projection
 * of current attention needs, reusing the exact same
 * evaluateClaimTraceabilityInTransaction blocker computation the
 * single-claim traceability route above calls - never a second blocker
 * system. Strictly read-only. Contains no SQL and no direct database
 * access, delegating exactly once to the authorized claim-traceability
 * service.
 */
router.get(
  "/admin/organizations/:organizationId/review-queue",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = eligibleClaimsForAudienceOrganizationIdentifier(req);
    if (!identifiers) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id")],
      });
    }
    return invokeService(res, async () => {
      const service = await getClaimTraceabilityService();
      return service.listOrganizationReviewQueue({
        organizationId: identifiers.organizationId,
        actorContext: sprint2MappedActorContext(req),
      });
    });
  },
);

/**
 * KAI data-dictionary entries read route: organization-scoped, read-only,
 * and safe-DTO-only. The route contains no SQL and delegates authorization,
 * tenant checks, and field allowlisting to the data-dictionary service.
 */
router.get(
  "/admin/organizations/:organizationId/data-dictionaries/:dataDictionaryId/entries",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = dataDictionaryEntriesIdentifier(req);
    if (!identifiers) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker("invalid_uuid_field", "organization_id_or_data_dictionary_id")],
      });
    }
    return invokeService(res, async () => {
      const service = await getDataDictionaryService();
      return service.listDataDictionaryEntries({
        organizationId: identifiers.organizationId,
        dataDictionaryId: identifiers.dataDictionaryId,
        actorContext: sprint2MappedActorContext(req),
      });
    });
  },
);

async function getGrantResponsePacketExportManifestService() {
  if (intakeServiceOverride?.createGrantResponsePacketExportManifest) return intakeServiceOverride;
  grantResponsePacketExportManifestServicePromise ||= import(
    "../services/kaiGrantResponsePacketExportManifestService.js"
  );
  return grantResponsePacketExportManifestServicePromise;
}

function validateCreateGrantResponsePacketExportManifestRequestOrSend(req, res) {
  if (!metadataContentTypeIsSupported(req)) {
    sendKaiError(res, "unsupported_media_type");
    return null;
  }
  const identifiers = grantResponsePacketExportCandidateReviewIdentifier(req);
  if (!identifiers) {
    sendKaiError(res, "validation_blocker", {
      blockers: [routeValidationBlocker(
        "invalid_uuid_field",
        "organization_id_engagement_id_or_grant_response_packet_export_candidate_id",
      )],
    });
    return null;
  }
  const result = validateCreateGrantResponsePacketExportManifestRequest(req.body);
  if (!result.ok) {
    sendKaiError(res, "validation_blocker", { blockers: result.blockers });
    return null;
  }
  return identifiers;
}

/**
 * P14-08B: governed Grant Response Packet export-manifest persistence for
 * the EXACT existing, immutable P14-03 packet export candidate identified by
 * the route's own grantResponsePacketExportCandidateId - never a
 * client-selected latest/newest/preferred candidate. organizationId,
 * engagementId, and the candidate id all come from the route path;
 * actorContext/now are always server-derived. The request body is empty -
 * no eligibility, authority, fingerprint, member, review-state, or manifest-
 * identity field is ever accepted. Contains no SQL and no direct database
 * access - delegates once to kaiGrantResponsePacketExportManifestService,
 * which itself delegates to the P14-08A
 * postgresGrantResponsePacketExportManifestRepository.js (real P14-07
 * eligibility + real P14-07B1 effectiveness, reimplemented nowhere). Produces
 * no final packet Markdown/PDF/DOCX/CSV bytes and publishes nothing
 * externally.
 */
router.post(
  "/admin/organizations/:organizationId/engagements/:engagementId/grant-response-packet/export-candidates/:grantResponsePacketExportCandidateId/export-manifests",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = validateCreateGrantResponsePacketExportManifestRequestOrSend(req, res);
    if (!identifiers) return;
    const actorContext = sprint2MappedActorContext(req);
    const now = new Date().toISOString();
    return invokeService(res, async () => {
      const service = await getGrantResponsePacketExportManifestService();
      return service.createGrantResponsePacketExportManifest({
        organizationId: identifiers.organizationId,
        engagementId: identifiers.engagementId,
        grantResponsePacketExportCandidateId: identifiers.grantResponsePacketExportCandidateId,
        actorContext,
      }, {
        now,
        metadataOnlyAudit: createProductionMetadataOnlyAuditForGrantResponsePacketExportManifest({
          organizationId: identifiers.organizationId,
          engagementId: identifiers.engagementId,
          grantResponsePacketExportCandidateId: identifiers.grantResponsePacketExportCandidateId,
          actorContext,
          now,
        }),
      });
    }, 201);
  },
);

async function getGrantResponsePacketExportManifestMarkdownService() {
  if (intakeServiceOverride?.serializeGrantResponsePacketExportManifestToMarkdown) return intakeServiceOverride;
  grantResponsePacketExportManifestMarkdownServicePromise ||= import(
    "../services/kaiGrantResponsePacketExportManifestMarkdownSerializer.js"
  );
  return grantResponsePacketExportManifestMarkdownServicePromise;
}

function grantResponsePacketExportManifestIdentifiers(req = {}) {
  const organizationId = typeof req.params?.organizationId === "string" ? req.params.organizationId : "";
  const grantResponsePacketExportManifestId = typeof req.params?.grantResponsePacketExportManifestId === "string"
    ? req.params.grantResponsePacketExportManifestId
    : "";
  if (!KAI_SPRINT2_P0_PATTERNS.uuid.test(organizationId) || organizationId !== organizationId.toLowerCase()) return null;
  if (
    !KAI_SPRINT2_P0_PATTERNS.uuid.test(grantResponsePacketExportManifestId)
    || grantResponsePacketExportManifestId !== grantResponsePacketExportManifestId.toLowerCase()
  ) return null;
  return { organizationId, grantResponsePacketExportManifestId };
}

/**
 * P14-08C: governed Grant Response Packet FINAL Markdown delivery, authorized
 * solely by the route's own exact grantResponsePacketExportManifestId - never
 * by organizationId+engagementId alone, a candidate id without its manifest,
 * a member-level manifest/candidate id, or a latest/newest/preferred
 * selection. Distinct from, and never a substitute for, the existing
 * engagement-scoped PREVIEW_READ_ONLY
 * /engagements/:engagementId/grant-response-packet/markdown route above.
 * Contains no SQL and no direct database access - delegates once to
 * kaiGrantResponsePacketExportManifestMarkdownSerializer.js, which itself
 * delegates the manifest-bound render-model reconstruction (including the
 * packet-native currentness/fingerprint proof) to the new P14-08C
 * postgresGrantResponsePacketExportManifestRenderModelRepository.js. Creates
 * no manifest, mutates no authority, and publishes nothing externally.
 */
router.get(
  "/admin/organizations/:organizationId/grant-response-packet/export-manifests/:grantResponsePacketExportManifestId/markdown",
  sprint2ActorContextMiddleware,
  async (req, res) => {
    const identifiers = grantResponsePacketExportManifestIdentifiers(req);
    if (!identifiers) {
      return sendKaiError(res, "validation_blocker", {
        blockers: [routeValidationBlocker(
          "invalid_uuid_field",
          "organization_id_or_grant_response_packet_export_manifest_id",
        )],
      });
    }
    try {
      const service = await getGrantResponsePacketExportManifestMarkdownService();
      return sendGrantResponsePacketExportManifestMarkdownAttachment(
        res,
        await service.serializeGrantResponsePacketExportManifestToMarkdown({
          organizationId: identifiers.organizationId,
          grantResponsePacketExportManifestId: identifiers.grantResponsePacketExportManifestId,
          actorContext: sprint2MappedActorContext(req),
        }),
      );
    } catch (error) {
      console.error("[kai-sprint2-intake] system_error", error);
      return sendKaiError(res, "system_error");
    }
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
  generatedContentDraftIdentifiers,
  exportCandidateIdentifiers,
  validateRequestExportReviewRequestOrSend,
  validateCreateExportCandidateRequestOrSend,
  validateHumanFinalReleaseAuthorityRequestOrSend,
  exportManifestIdentifiers,
  sendMarkdownAttachment,
  sendGrantResponsePacketMarkdownAttachment,
  sendGrantResponsePacketExportManifestMarkdownAttachment,
  grantResponsePacketExportManifestIdentifiers,
  boardReportingCandidateReviewIdentifier,
  validateRequestBoardReportingCandidateReviewRequestOrSend,
  boardReportingCandidateReviewQueueIdentifier,
  validateStartBoardReportingCandidateReviewRequestOrSend,
  validateCompleteBoardReportingCandidateReviewRequestOrSend,
  grantResponsePacketIdentifier,
  validateCreateGrantResponsePacketExportCandidateRequestOrSend,
  grantResponsePacketExportCandidateReviewIdentifier,
  validateRequestGrantResponsePacketExportReviewRequestOrSend,
  grantResponsePacketExportReviewStartIdentifier,
  validateStartGrantResponsePacketExportReviewRequestOrSend,
  validateCompleteGrantResponsePacketExportReviewRequestOrSend,
  validateGrantResponsePacketHumanFinalReleaseAuthorityRequestOrSend,
  sendCsvAttachment,
  sendPdfAttachment,
  sendDocxAttachment,
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
  requirementAssessmentIdentifiers,
  validateAssessRequirementRequestOrSend,
  safeKaiResponseSummary,
  logKaiSprint2IntakeRequest,
  setIntakeServiceForTest(service) {
    intakeServiceOverride = service;
    return () => {
      intakeServiceOverride = null;
    };
  },
  setActorContextMiddlewareForTest(middleware) {
    actorContextMiddlewareOverride = middleware;
    return () => {
      actorContextMiddlewareOverride = null;
    };
  },
};
