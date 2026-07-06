import express from "express";
import { sendKaiError } from "../errors/kaiErrors.js";
import {
  checkAdminAccess,
  createIntakeBatch,
  reserveIntakeFileMetadata,
} from "../services/kaiIntakeService.js";

const router = express.Router();

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

router.get("/status", (req, res) => {
  res.json({
    ok: true,
    data: {
      feature_enabled: true,
      route: "/api/kai/sprint2/intake",
      mode: "admin_metadata_only",
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
  try {
    const result = await checkAdminAccess({
      req,
      payload: req.query || {},
      organizationId: req.query?.organization_id,
      engagementId: req.query?.engagement_id,
      route: "/api/kai/sprint2/intake/admin/access-check",
      requestId: req.get("X-Request-Id") || null,
    });
    return sendServiceResult(res, result);
  } catch (error) {
    console.error("[kaiSprint2IntakeApi] GET /admin/access-check error:", error?.message);
    return sendKaiError(res, "system_error");
  }
});

router.post("/admin/batches", async (req, res) => {
  try {
    const result = await createIntakeBatch({
      req,
      payload: req.body || {},
      organizationId: req.body?.organization_id,
      engagementId: req.body?.engagement_id,
      batchCode: req.body?.batch_code,
      route: "/api/kai/sprint2/intake/admin/batches",
      requestId: req.get("X-Request-Id") || null,
    });
    return sendServiceResult(res, result, 201);
  } catch (error) {
    console.error("[kaiSprint2IntakeApi] POST /admin/batches error:", error?.message);
    return sendKaiError(res, "system_error");
  }
});

router.post("/admin/batches/:intakeBatchId/file-reservations", async (req, res) => {
  try {
    if (req.is("multipart/form-data")) {
      return sendKaiError(res, "invalid_request", {
        status: 400,
        message: "Raw file upload is disabled for KAI Sprint 2 P0 Pass 2.",
      });
    }

    const result = await reserveIntakeFileMetadata({
      req,
      payload: req.body || {},
      organizationId: req.body?.organization_id,
      engagementId: req.body?.engagement_id,
      intakeBatchId: req.params.intakeBatchId,
      route: "/api/kai/sprint2/intake/admin/batches/:intakeBatchId/file-reservations",
      requestId: req.get("X-Request-Id") || null,
    });
    return sendServiceResult(res, result, 201);
  } catch (error) {
    console.error("[kaiSprint2IntakeApi] POST /admin/batches/:intakeBatchId/file-reservations error:", error?.message);
    return sendKaiError(res, "system_error");
  }
});

export default router;

export const __testables = {
  sendServiceResult,
};
