const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
