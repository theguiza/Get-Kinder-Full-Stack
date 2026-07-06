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
