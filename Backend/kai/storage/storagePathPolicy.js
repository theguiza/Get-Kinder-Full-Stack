import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";

const SAFE_FILENAME_PATTERN = KAI_SPRINT2_P0_PATTERNS.safeFilename;
const UUID_PATTERN = KAI_SPRINT2_P0_PATTERNS.uuid;
const GROUNDED_RESERVED_BASENAMES = new Set(["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"]);
const C0_DEL_C1_CONTROLS_RE = /[\u0000-\u001F\u007F-\u009F]/u;
const APPROVED_BIDI_FORMATTING_CONTROLS_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
const TERMINAL_EXE_SUFFIX_RE = /\.exe$/iu;

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

export function detectGroundedFilenameHazard(filename) {
  if (typeof filename !== "string") {
    return { matched: true, reason: "missing_filename" };
  }
  if (filename.trim().length === 0) {
    return { matched: true, reason: "missing_filename" };
  }
  if (filename.includes("/") || filename.includes("\\")) {
    return { matched: true, reason: "unsafe_filename_path" };
  }
  if (filename.includes("..")) {
    return { matched: true, reason: "unsafe_filename_path" };
  }
  if (C0_DEL_C1_CONTROLS_RE.test(filename)) {
    return { matched: true, reason: "unsafe_filename_control" };
  }
  if (APPROVED_BIDI_FORMATTING_CONTROLS_RE.test(filename)) {
    return { matched: true, reason: "unsafe_filename_bidi" };
  }
  if (GROUNDED_RESERVED_BASENAMES.has(filename.toUpperCase())) {
    return { matched: true, reason: "unsafe_filename_reserved_basename" };
  }
  if (TERMINAL_EXE_SUFFIX_RE.test(filename)) {
    return { matched: true, reason: "unsafe_filename_terminal_exe" };
  }
  return { matched: false, reason: null };
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
