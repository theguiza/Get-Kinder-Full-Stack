import express from "express";
import { KAI_ERROR_STATUS, sendKaiError } from "../errors/kaiErrors.js";
import { requireKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import {
  KAI_SPRINT2_P0_CONTRACT_VERSION,
  KAI_SPRINT2_P0_PATTERNS,
} from "../config/kaiSprint2P0Contract.js";
import { setKaiSprint2NoStore } from "../middleware/kaiSprint2RequestSafety.js";
import {
  validateIntakeBatchFilesQuery,
  validateFilePolicyBlockRequest,
  validateKaiSprint2MutationRequest,
  validateReviewQueueQuery,
  validateReviewQueueStatusRequest,
} from "../validators/kaiSprint2RequestSchemas.js";

const router = express.Router();
let intakeServiceOverride = null;
let intakeServicePromise = null;
let reviewQueueServicePromise = null;

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
    data: null,
    blockers: includeExpectedDetails ? sanitizeServiceBlockers(result?.blockers) : [],
    warnings: includeExpectedDetails ? sanitizeServiceWarnings(result?.warnings) : [],
  });
}

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

async function invokeService(res, serviceCall, successStatus = 200) {
  try {
    return sendServiceResult(res, await serviceCall(), successStatus);
  } catch {
    return sendKaiError(res, "system_error");
  }
}

async function getIntakeService() {
  if (intakeServiceOverride) return intakeServiceOverride;
  intakeServicePromise ||= import("../services/kaiIntakeService.js");
  return intakeServicePromise;
}

async function getReviewQueueService() {
  if (intakeServiceOverride?.updateReviewQueueStatus) return intakeServiceOverride;
  reviewQueueServicePromise ||= import("../services/kaiReviewQueueService.js");
  return reviewQueueServicePromise;
}

router.use(requireKaiSprint2Enabled);
router.use(setKaiSprint2NoStore);

export function sendStatus(req, res) {
  return res.json({
    ok: true,
    data: {
      feature_enabled: true,
      route: "/api/kai/sprint2/intake",
      mode: "admin_metadata_only",
      contract: `kai_sprint2_p0_repository_contract_v${KAI_SPRINT2_P0_CONTRACT_VERSION}`,
      metadata_write_enabled: true,
      file_upload_enabled: false,
      upload_confirmation_enabled: false,
      storage_provider_enabled: false,
      storage_upload_enabled: false,
      signed_upload_enabled: false,
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
    },
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
  validateReviewQueueStatusRequestOrSend,
  setIntakeServiceForTest(service) {
    intakeServiceOverride = service;
    return () => {
      intakeServiceOverride = null;
    };
  },
};
