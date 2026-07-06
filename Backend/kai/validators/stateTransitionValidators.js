import { blockerResult, passResult } from "./types.js";

export const FILE_POLICY_STATUSES = Object.freeze(["pending", "passed", "blocked", "failed", "skipped"]);
export const MALWARE_SCAN_PRODUCTION_DEFAULT = "not_configured";
export const STORAGE_PROVIDER_DB_VALUES = Object.freeze(["s3_compatible", "cloudflare_r2", "gcs", "supabase_storage", "local_dev", "other"]);
export const MALWARE_SCAN_STATUSES = Object.freeze(["not_configured", "queued", "running", "passed", "failed", "skipped"]);

const FILE_POLICY_TRANSITIONS = new Set([
  "pending->blocked",
  "pending->passed",
  "pending->failed",
  "pending->skipped",
]);

export function validateFilePolicyStatusTransition({ from = "pending", to } = {}) {
  if (!FILE_POLICY_STATUSES.includes(to)) {
    return blockerResult("VAL-STA-001", "File policy status is not DDL-valid.", {
      object_type: "intake_file",
      object_code: to,
      blocking_reason: "invalid_file_policy_status",
      required_fix: "Use a DDL-valid file_policy_status.",
    });
  }

  if (!FILE_POLICY_TRANSITIONS.has(`${from}->${to}`)) {
    return blockerResult("VAL-STA-001", "File policy transition is not allowed in P0.", {
      object_type: "intake_file",
      object_code: `${from}->${to}`,
      blocking_reason: "state_transition_denied",
      required_fix: "Use the P0 state-transition matrix.",
    });
  }

  return passResult("VAL-STA-001", "File policy transition is allowed.", { from, to });
}

export function validateStorageProviderDbValue({ storageProvider } = {}) {
  if (!STORAGE_PROVIDER_DB_VALUES.includes(storageProvider)) {
    return blockerResult("VAL-STA-002", "Storage provider is not DDL-valid.", {
      object_type: "intake_file",
      object_code: storageProvider,
      blocking_reason: "invalid_storage_provider",
      required_fix: "Use a DDL-valid storage_provider such as gcs; do not use google_cloud_storage, manual, or stub.",
    });
  }

  return passResult("VAL-STA-002", "Storage provider is DDL-valid.", { storageProvider });
}

export function validateMalwareScanStatusDbValue({ malwareScanStatus } = {}) {
  if (!MALWARE_SCAN_STATUSES.includes(malwareScanStatus)) {
    return blockerResult("VAL-STA-003", "Malware scan status is not DDL-valid.", {
      object_type: "intake_file",
      object_code: malwareScanStatus,
      blocking_reason: "invalid_malware_scan_status",
      required_fix: "Use one of not_configured, queued, running, passed, failed, skipped.",
    });
  }

  return passResult("VAL-STA-003", "Malware scan status is DDL-valid.", { malwareScanStatus });
}
