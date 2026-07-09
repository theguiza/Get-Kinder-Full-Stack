import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { notImplemented, validationBlocked } from "../errors/kaiErrors.js";
import { sanitizeBlockedAttemptAuditMetadata } from "../validators/auditValidators.js";

export const PASS1E_AUDIT_CONTRACT = "p0_pass1e_blocked_attempt_audit_contract";

export async function recordBlockedAttemptAudit(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return {
      ok: false,
      error: {
        code: "feature_disabled",
        message: "KAI Sprint 2 intake is not enabled.",
        status: 403,
      },
      data: null,
      blockers: [],
      warnings: [],
    };
  }

  const validation = sanitizeBlockedAttemptAuditMetadata(input.payload || {});

  if (!validation.ok) {
    return validationBlocked(validation.blockers, {
      data: {
        contract: PASS1E_AUDIT_CONTRACT,
        audit_write_enabled: false,
        kai_audit_events_write_enabled: false,
      },
    });
  }

  return notImplemented({
    message: "Blocked-attempt audit writes are not implemented in Sprint 2 P0 Pass 1E.",
    blockers: [
      {
        validator_key: "VAL-AUD-SVC-001",
        severity: "blocker",
        object_type: "audit_service_contract",
        object_code: "record_blocked_attempt",
        object_id: null,
        message: "Audit persistence is disabled in Pass 1E.",
        blocking_reason: "audit_write_not_implemented_in_pass1e",
        required_fix: "Implement metadata-only audit persistence in a later controlled pass.",
        evidence: {
          contract: PASS1E_AUDIT_CONTRACT,
          audit_write_enabled: false,
          kai_audit_events_write_enabled: false,
        },
      },
    ],
    data: {
      contract: PASS1E_AUDIT_CONTRACT,
      audit_write_enabled: false,
      kai_audit_events_write_enabled: false,
      sanitized_payload: validation.sanitized,
    },
  });
}
