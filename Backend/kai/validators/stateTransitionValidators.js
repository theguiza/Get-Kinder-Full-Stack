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

export const P0_BLOCKED_STATE_TRANSITION_REASONS = Object.freeze({
  promote_intake_source: "source_promotion_blocked_in_p0",
  create_claim_from_intake: "claim_creation_blocked_from_intake_in_p0",
  extract_evidence_from_raw_file: "evidence_extraction_blocked_from_raw_file_in_p0",
  generate_report_export: "report_export_generation_blocked_in_p0",
  open_public_funder_gate: "public_funder_gate_opening_blocked_in_p0",
});

const P0_SUPPORTED_INTAKE_TRANSITIONS = Object.freeze({
  file_policy_status: FILE_POLICY_TRANSITIONS,
});

function stateTransitionBlocker({ operation, blocking_reason, message, required_fix }) {
  return blockerResult("VAL-STA-P0-001", message, {
    object_type: "state_transition",
    object_code: operation || "unknown",
    blocking_reason,
    required_fix,
    evidence: {
      sprint2_p0_mutating_transition_enabled: false,
    },
  });
}

export function validateP0IntakeStateTransitionAttempt({ operation, objectType, from = "pending", to } = {}) {
  const blockedReason = P0_BLOCKED_STATE_TRANSITION_REASONS[operation];
  if (blockedReason) {
    return stateTransitionBlocker({
      operation,
      blocking_reason: blockedReason,
      message: "This state transition is blocked in Sprint 2 P0.",
      required_fix: "Keep this operation behind a later controlled implementation pass.",
    });
  }

  if (objectType === "file_policy_status") {
    if (P0_SUPPORTED_INTAKE_TRANSITIONS.file_policy_status.has(`${from}->${to}`)) {
      return passResult("VAL-STA-P0-001", "P0 intake state transition is allowed.", {
        object_type: objectType,
        from,
        to,
      });
    }

    return stateTransitionBlocker({
      operation: `${from}->${to}`,
      blocking_reason: "unknown_state_transition_blocked",
      message: "Unknown or unsupported state transition is blocked in Sprint 2 P0.",
      required_fix: "Use the explicit P0 intake state-transition matrix.",
    });
  }

  return stateTransitionBlocker({
    operation,
    blocking_reason: "unknown_state_transition_blocked",
    message: "Unknown or unsupported state transition is blocked in Sprint 2 P0.",
    required_fix: "Use an explicit supported P0 intake transition.",
  });
}

export function source_promotion_blocked_in_p0() {
  return validateP0IntakeStateTransitionAttempt({ operation: "promote_intake_source" });
}

export function claim_creation_blocked_from_intake_in_p0() {
  return validateP0IntakeStateTransitionAttempt({ operation: "create_claim_from_intake" });
}

export function evidence_extraction_blocked_from_raw_file_in_p0() {
  return validateP0IntakeStateTransitionAttempt({ operation: "extract_evidence_from_raw_file" });
}

export function report_export_generation_blocked_in_p0() {
  return validateP0IntakeStateTransitionAttempt({ operation: "generate_report_export" });
}

export function public_funder_gate_opening_blocked_in_p0() {
  return validateP0IntakeStateTransitionAttempt({ operation: "open_public_funder_gate" });
}

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
