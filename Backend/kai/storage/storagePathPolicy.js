import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";

const SAFE_FILENAME_PATTERN = KAI_SPRINT2_P0_PATTERNS.safeFilename;
const UUID_PATTERN = KAI_SPRINT2_P0_PATTERNS.uuid;

export function validateSafeFilename(filename) {
  if (typeof filename !== "string" || !filename.trim()) {
    return { ok: false, error_code: "missing_filename" };
  }
  const value = filename.trim();
  if (value !== filename || value.includes("/") || value.includes("\\") || value.includes("..")) {
    return { ok: false, error_code: "unsafe_filename_path" };
  }
  if (!SAFE_FILENAME_PATTERN.test(value)) {
    return { ok: false, error_code: "unsafe_filename_chars" };
  }
  return { ok: true, safeFilename: value };
}

export function buildObjectKey({ organizationId, intakeBatchId, intakeFileId, safeFilename }) {
  const filenameResult = validateSafeFilename(safeFilename);
  if (!filenameResult.ok) return filenameResult;

  for (const [name, value] of Object.entries({ organizationId, intakeBatchId, intakeFileId })) {
    if (!UUID_PATTERN.test(String(value || ""))) {
      return { ok: false, error_code: `invalid_${name}` };
    }
  }

  return {
    ok: true,
    objectKey: `kai/org/${organizationId}/intake/${intakeBatchId}/${intakeFileId}/${filenameResult.safeFilename}`,
  };
}

export function validateObjectKeyPolicy({
  objectKey,
  organizationId,
  intakeBatchId,
  intakeFileId,
  safeFilename,
}) {
  if (typeof objectKey !== "string" || objectKey.includes("..") || objectKey.includes("\\") || objectKey.startsWith("/")) {
    return { ok: false, error_code: "invalid_storage_path" };
  }

  const expected = buildObjectKey({ organizationId, intakeBatchId, intakeFileId, safeFilename });
  if (!expected.ok) return expected;

  if (objectKey !== expected.objectKey) {
    return { ok: false, error_code: "storage_path_policy_mismatch" };
  }

  return { ok: true };
}
