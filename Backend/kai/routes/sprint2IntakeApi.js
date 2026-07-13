import express from "express";
import { sendKaiError } from "../errors/kaiErrors.js";
import { requireKaiSprint2Enabled } from "../config/kaiSprint2Config.js";

const router = express.Router();
let intakeServiceOverride = null;
let intakeServicePromise = null;

export function sendServiceResult(res, result, successStatus = 200) {
  if (result?.ok) return res.status(successStatus).json(result);
  if (result?.error?.code === "validation_blocker") {
    return res.status(422).json(result);
  }
  const code = result?.error?.code || "system_error";
  return sendKaiError(res, code, {
    message: result?.error?.message,
    status: result?.error?.status,
    blockers: result?.blockers,
    warnings: result?.warnings,
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

function requestContext(req = {}, route) {
  const payload = requestPayload(req);
  return {
    req: { user: safeAuthenticatedUser(req) },
    payload,
    organizationId: payload.organization_id,
    engagementId: payload.engagement_id,
    idempotencyKey: payload.idempotency_key || null,
    route,
  };
}

async function getIntakeService() {
  if (intakeServiceOverride) return intakeServiceOverride;
  intakeServicePromise ||= import("../services/kaiIntakeService.js");
  return intakeServicePromise;
}

router.use(requireKaiSprint2Enabled);

router.get("/status", (req, res) => {
  res.json({
    ok: true,
    data: {
      feature_enabled: true,
      route: "/api/kai/sprint2/intake",
      mode: "admin_metadata_only",
      contract: "p0_pass1d_intake_validator_service_contract",
      pass1f_contract: "p0_pass1f_metadata_write_storage_boundary_contract",
      metadata_write_enabled: false,
      storage_provider_enabled: false,
      storage_upload_enabled: false,
      signed_upload_enabled: false,
      signed_read_enabled: false,
      parser_worker_enabled: false,
      source_promotion_enabled: false,
    },
    warnings: [],
  });
});

router.get("/admin/access-check", async (req, res) => {
  const payload = requestPayload(req);
  const service = await getIntakeService();
  const result = await service.checkAdminAccess({
    ...requestContext(req, "/api/kai/sprint2/intake/admin/access-check"),
    organizationId: req.query?.organization_id || payload.organization_id,
    engagementId: req.query?.engagement_id || payload.engagement_id,
  });
  return sendServiceResult(res, result);
});

router.get("/admin/batches", async (req, res) => {
  const service = await getIntakeService();
  const result = await service.listIntakeBatchesForOrganization({
    ...requestContext(req, "/api/kai/sprint2/intake/admin/batches"),
    organizationId: req.query?.organization_id,
  });
  return sendServiceResult(res, result);
});

router.post("/admin/batches", async (req, res) => {
  const payload = requestPayload(req);
  const service = await getIntakeService();
  const result = await service.createIntakeBatch({
    ...requestContext(req, "/api/kai/sprint2/intake/admin/batches"),
    batchCode: payload.batch_code,
    sourceSystemName: payload.source_system_name || null,
    sourceSystemRef: payload.source_system_ref || null,
    notes: payload.notes || null,
  });
  return sendServiceResult(res, result, 201);
});

router.post("/admin/batches/:intakeBatchId/file-reservations", async (req, res) => {
  if (req.is("multipart/form-data")) {
    return sendKaiError(res, "invalid_request", {
      status: 400,
      message: "Raw file upload is disabled for KAI Sprint 2 P0 Pass 1D.",
    });
  }

  const payload = requestPayload(req);
  const service = await getIntakeService();
  const result = await service.reserveIntakeFileMetadata({
    ...requestContext(req, "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations"),
    intakeBatchId: req.params?.intakeBatchId,
    intakeFileId: payload.intake_file_id,
    originalFilename: payload.original_filename,
    safeFilename: payload.safe_filename,
    fileExtension: payload.file_extension,
    mimeType: payload.mime_type,
    fileSizeBytes: payload.file_size_bytes,
    checksum: payload.checksum,
    hashAlgorithm: payload.hash_algorithm,
    storageProvider: payload.storage_provider,
    storageBucket: payload.storage_bucket,
    filePolicyStatus: payload.file_policy_status,
    malwareScanStatus: payload.malware_scan_status,
  });
  return sendServiceResult(res, result, 201);
});

export default router;

export const __testables = {
  requestContext,
  requestPayload,
  safeAuthenticatedUser,
  sendServiceResult,
  setIntakeServiceForTest(service) {
    intakeServiceOverride = service;
    return () => {
      intakeServiceOverride = null;
    };
  },
};
