import { validateObjectKeyPolicy, validateSafeFilename } from "../storage/storagePathPolicy.js";
import { blockerResult, passResult } from "./types.js";

export function validateStoragePathPolicy({ objectKey, organizationId, intakeBatchId, intakeFileId, safeFilename } = {}) {
  const result = validateObjectKeyPolicy({
    objectKey,
    organizationId,
    intakeBatchId,
    intakeFileId,
    safeFilename,
  });

  if (!result.ok) {
    return blockerResult("VAL-STO-001", "Storage object key failed policy validation.", {
      object_type: "intake_file",
      blocking_reason: result.error_code,
      required_fix: "Build object keys with the KAI storage path policy helper.",
      evidence: { reason: result.error_code },
    });
  }

  return passResult("VAL-STO-001", "Storage object key passed policy validation.");
}

export function validateFilenamePolicy({ filename } = {}) {
  const result = validateSafeFilename(filename);
  if (!result.ok) {
    return blockerResult("VAL-STO-002", "Filename failed safety validation.", {
      object_type: "intake_file",
      blocking_reason: result.error_code,
      required_fix: "Use a basename with an allowed extension and no path characters.",
    });
  }
  return passResult("VAL-STO-002", "Filename passed safety validation.");
}

export function storage_provider_disabled_in_p0({ storageProvider = "gcs" } = {}) {
  return blockerResult("VAL-STO-003", "Storage provider execution is disabled in Sprint 2 P0 Pass 1F.", {
    object_type: "storage_provider",
    object_code: storageProvider,
    blocking_reason: "storage_provider_disabled_in_p0",
    required_fix: "Keep storage provider execution disabled until a later controlled pass enables it.",
    evidence: {
      storage_provider_enabled: false,
      raw_upload_enabled: false,
      signed_upload_enabled: false,
      signed_read_enabled: false,
    },
  });
}

export function upload_url_request_blocked_in_p0({ storageProvider = "gcs" } = {}) {
  return blockerResult("VAL-STO-004", "Upload URL issuance is blocked in Sprint 2 P0 Pass 1F.", {
    object_type: "storage_provider",
    object_code: storageProvider,
    blocking_reason: "upload_url_request_blocked_in_p0",
    required_fix: "Do not issue upload URLs in Pass 1F.",
  });
}
