import express from "express";
import { sendKaiError } from "../errors/kaiErrors.js";
import { requireKaiSprint2Enabled } from "../config/kaiSprint2Config.js";

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

router.get("/admin/access-check", (req, res) => {
  return sendKaiError(res, "operation_not_enabled", {
    status: 422,
    message: "KAI Sprint 2 admin intake operations are disabled for this pass.",
  });
});

router.post("/admin/batches", (req, res) => {
  return sendKaiError(res, "operation_not_enabled", {
    status: 422,
    message: "KAI Sprint 2 admin intake operations are disabled for this pass.",
  });
});

router.post("/admin/batches/:intakeBatchId/file-reservations", (req, res) => {
  if (req.is("multipart/form-data")) {
    return sendKaiError(res, "invalid_request", {
      status: 400,
      message: "Raw file upload is disabled for KAI Sprint 2 P0 Pass 1D.",
    });
  }

  return sendKaiError(res, "operation_not_enabled", {
    status: 422,
    message: "KAI Sprint 2 file reservation operations are disabled for this pass.",
  });
});

export default router;

export const __testables = {
  sendServiceResult,
};
