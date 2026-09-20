export const KAI_ERROR_STATUS = Object.freeze({
  feature_disabled: 403,
  unauthorized: 401,
  mapped_kai_user_required: 403,
  authorization_denied: 403,
  tenant_boundary_violation: 403,
  validation_blocker: 422,
  validation_error: 422,
  invalid_request: 400,
  request_too_large: 413,
  unsupported_media_type: 415,
  abuse_limited: 429,
  not_found: 404,
  conflict: 409,
  conflict_current_state_changed: 409,
  checksum_mismatch: 409,
  duplicate_conflict: 409,
  human_review_incomplete: 409,
  dimension_not_unresolved: 409,
  batch_code_conflict: 409,
  storage_provider_not_configured: 503,
  operation_not_enabled: 422,
  state_transition_denied: 422,
  blocked: 422,
  blocked_attempt: 422,
  audit_payload_rejected: 422,
  not_implemented: 501,
  system_error: 500,
  role_not_found: 404,
  last_admin_protection: 409,
  membership_state_conflict: 409,
  engagement_requirement_applicability_not_confirmed: 422,
  funder_use_not_currently_eligible: 422,
  claim_reviewed_not_supported: 422,
});

export const KAI_ERROR_MESSAGES = Object.freeze({
  feature_disabled: "KAI Sprint 2 intake is not enabled.",
  unauthorized: "Unauthorized.",
  mapped_kai_user_required: "Authenticated user is not mapped to kai.users.",
  authorization_denied: "Actor is not authorized for this operation.",
  tenant_boundary_violation: "Request crosses tenant boundaries.",
  validation_blocker: "Request failed KAI validation.",
  validation_error: "Request failed KAI validation.",
  invalid_request: "Invalid request.",
  request_too_large: "Request body is too large.",
  unsupported_media_type: "Unsupported media type.",
  abuse_limited: "Too many mutation attempts. Try again later.",
  not_found: "Resource not found.",
  conflict: "Resource conflict.",
  conflict_current_state_changed: "Current resource state changed.",
  checksum_mismatch: "Uploaded object checksum does not match the declared checksum.",
  duplicate_conflict: "Idempotency key conflicts with a different payload.",
  human_review_incomplete: "P2-09 evidence-review and claim-review must be complete before a coverage decision can be recorded.",
  dimension_not_unresolved: "Target coverage dimension is not currently unresolved.",
  batch_code_conflict: "That batch number is already in use. Enter a different batch number.",
  storage_provider_not_configured: "Storage adapter unavailable.",
  operation_not_enabled: "Operation is not enabled for KAI Sprint 2 P0.",
  state_transition_denied: "State transition is not allowed.",
  blocked: "Operation is blocked for KAI Sprint 2 P0.",
  blocked_attempt: "Operation attempt is blocked for KAI Sprint 2 P0.",
  audit_payload_rejected: "Blocked-attempt audit payload is not metadata-safe.",
  not_implemented: "Operation is not implemented for KAI Sprint 2 P0.",
  system_error: "KAI Sprint 2 server error.",
  role_not_found: "Requested KAI role does not exist.",
  last_admin_protection: "This change would leave the organization with no effective active client_admin.",
  membership_state_conflict: "More than one stored client-role row exists for this user in this organization; resolve the conflict before mutating.",
  engagement_requirement_applicability_not_confirmed: "This requirement's requirement set does not have current, reviewed, effective-applicable Package 2B applicability for this engagement against its current approved target.",
  funder_use_not_currently_eligible: "One or more requested claims is not currently funder-eligible.",
  claim_reviewed_not_supported: "One or more requested claims has a terminal reviewed_not_supported claim strength and cannot be used for generation.",
});

export function buildKaiError(code, overrides = {}) {
  const status = overrides.status || KAI_ERROR_STATUS[code] || 500;
  return {
    ok: false,
    error: {
      code,
      message: overrides.message || KAI_ERROR_MESSAGES[code] || KAI_ERROR_MESSAGES.system_error,
      status,
    },
    ...(overrides.blockers ? { blockers: overrides.blockers } : {}),
    ...(overrides.warnings ? { warnings: overrides.warnings } : {}),
    ...(Object.hasOwn(overrides, "data") ? { data: overrides.data } : {}),
    ...(overrides.audit_context ? { audit_context: overrides.audit_context } : {}),
  };
}

export function sendKaiError(res, code, overrides = {}) {
  const body = buildKaiError(code, overrides);
  return res.status(body.error.status).json(body);
}

export function withUploadUrlPhase(result, phase) {
  const existingData =
    result?.data
    && typeof result.data === "object"
    && !Array.isArray(result.data)
      ? result.data
      : {};

  return {
    ...result,
    data: {
      ...existingData,
      exact_verification_phase: phase,
    },
  };
}

export function featureDisabled(overrides = {}) {
  return buildKaiError("feature_disabled", {
    ...overrides,
    status: 403,
  });
}

export function validationError(blockers = [], overrides = {}) {
  return buildKaiError("validation_error", {
    ...overrides,
    status: 422,
    blockers,
  });
}

export function validationBlocked(blockers, overrides = {}) {
  return buildKaiError("validation_blocker", {
    ...overrides,
    status: 422,
    blockers,
  });
}

export function notImplemented(overrides = {}) {
  return buildKaiError("not_implemented", {
    ...overrides,
    status: overrides.status || 501,
  });
}

export function blockedAttempt(blockers = [], overrides = {}) {
  return buildKaiError("blocked_attempt", {
    ...overrides,
    status: 422,
    blockers,
  });
}

export function auditPayloadRejected(blockers = [], overrides = {}) {
  return buildKaiError("audit_payload_rejected", {
    ...overrides,
    status: 422,
    blockers,
  });
}

const DIAGNOSTIC_MACHINE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

// Shared fail-closed diagnostic for the export-eligibility call chain
// (evaluateFinalExportEligibilityInTransaction and its direct dependencies,
// plus the P3-19 repository's own final boundary): every one of those points
// can currently return an unstructured { ok:false, error.code:"validation_blocker" }
// with no blockers, which reaches the ordinary export-manifest HTTP response
// as an unexplained { blockers: [] }. This never changes any eligibility
// decision - it only attaches a bounded, machine-code-only stage
// discriminator (never a business reason, an id, or raw upstream detail) at
// whichever exact call site first observes the unstructured failure, so the
// response stays self-diagnosing without guessing why eligibility failed.
export function unstructuredExportEligibilityDiagnosticBlocker({
  failureStage,
  upstreamErrorCode,
  upstreamReason,
} = {}) {
  const safeStage = typeof failureStage === "string" && DIAGNOSTIC_MACHINE_CODE_PATTERN.test(failureStage)
    ? failureStage
    : "final_export_eligibility_evaluation";
  const safeUpstreamErrorCode =
    typeof upstreamErrorCode === "string" && DIAGNOSTIC_MACHINE_CODE_PATTERN.test(upstreamErrorCode)
      ? upstreamErrorCode
      : "validation_blocker";
  const safeUpstreamReason =
    typeof upstreamReason === "string" && DIAGNOSTIC_MACHINE_CODE_PATTERN.test(upstreamReason)
      ? upstreamReason
      : null;
  return [{
    validator_key: "VAL-SYS-P0-001",
    severity: "blocker",
    object_type: "export_candidate",
    message: "Export eligibility evaluation was blocked before a structured validator result was produced.",
    blocking_reason: "unstructured_export_eligibility_blocker",
    required_fix: "Use the diagnostic evidence to identify the failing export-eligibility stage.",
    evidence: {
      failure_stage: safeStage,
      upstream_error_code: safeUpstreamErrorCode,
      ...(safeUpstreamReason ? { upstream_reason: safeUpstreamReason } : {}),
    },
  }];
}

const EXPORT_MANIFEST_DIAGNOSTIC_FAILURE_STAGES = new Set([
  "service_input_contract",
  "repository_input_contract",
  "metadata_only_audit_dependency",
  "export_manifest_insert",
]);

// Postgres SQLSTATE codes (23503, 22P02, 23514, ...) are five characters of
// digits/uppercase letters - never matched by DIAGNOSTIC_MACHINE_CODE_PATTERN
// (which requires a leading lowercase letter), so they need their own check.
const POSTGRES_SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

// Shared fail-closed diagnostic for the three remaining bare
// { error.code: "validation_blocker", blockers: undefined } branches in
// postgresExportManifestRepository's createExportManifest: an invalid
// repository input, a missing metadataOnlyAudit dependency, or a
// constrained-integrity insert failure (23503/22P02/23514). Same bounded,
// machine-code-only shape as unstructuredExportEligibilityDiagnosticBlocker
// above - never a business reason, an id, SQL, or raw upstream detail.
export function unstructuredExportManifestDiagnosticBlocker({
  failureStage,
  upstreamErrorCode,
} = {}) {
  const safeStage = typeof failureStage === "string" && EXPORT_MANIFEST_DIAGNOSTIC_FAILURE_STAGES.has(failureStage)
    ? failureStage
    : "export_manifest_insert";
  const safeUpstreamErrorCode =
    typeof upstreamErrorCode === "string"
    && (DIAGNOSTIC_MACHINE_CODE_PATTERN.test(upstreamErrorCode) || POSTGRES_SQLSTATE_PATTERN.test(upstreamErrorCode))
      ? upstreamErrorCode
      : null;
  return [{
    validator_key: "VAL-SYS-P0-001",
    severity: "blocker",
    object_type: "export_manifest",
    message: "Export manifest creation was blocked before a structured validator result was produced.",
    blocking_reason: "unstructured_export_manifest_failure",
    required_fix: "Use the diagnostic evidence to identify the failing export-manifest stage.",
    evidence: {
      failure_stage: safeStage,
      ...(safeUpstreamErrorCode ? { upstream_error_code: safeUpstreamErrorCode } : {}),
    },
  }];
}

// USER_CONFIRMED production kai.export_manifests constraint names (from an
// owner-supplied pgAdmin catalog result), used only as an internal
// exact-match allowlist - the raw constraint name is never serialized to the
// API client. Each entry maps to the safe, machine-readable classification
// the client is allowed to see.
const EXPORT_MANIFEST_CONSTRAINT_DIAGNOSTICS = new Map([
  ["export_manifests_p3_19_authority_decision_fk", {
    objectCode: "export_manifest_authority_reference",
    message: "The selected export authority decision is not valid for this export candidate.",
    blockingReason: "export_authority_reference_invalid",
    requiredFix:
      "Re-evaluate the current export authority decision for this organization and export candidate, then retry export finalization.",
    constraintKey: "authority_decision_fk",
  }],
  ["export_manifests_p3_19_candidate_fk", {
    objectCode: "export_manifest_candidate_reference",
    message: "The export candidate referenced by this export manifest is not valid.",
    blockingReason: "export_candidate_reference_invalid",
    requiredFix: "Re-evaluate the export candidate for this organization, then retry export finalization.",
    constraintKey: "candidate_fk",
  }],
  ["export_manifests_p3_20_review_queue_item_fk", {
    objectCode: "export_manifest_review_reference",
    message: "The export review queue item referenced by this export manifest is not valid.",
    blockingReason: "export_review_reference_invalid",
    requiredFix:
      "Re-evaluate the export review queue item for this organization and export candidate, then retry export finalization.",
    constraintKey: "review_queue_item_fk",
  }],
  ["export_manifests_p3_19_canonical_fingerprint_check", {
    objectCode: "export_manifest_canonical_fingerprint",
    message: "The computed export manifest fingerprint is not valid.",
    blockingReason: "canonical_fingerprint_invalid",
    requiredFix: "Retry export finalization; if this recurs, escalate it as a system defect.",
    constraintKey: "canonical_fingerprint_check",
  }],
  ["export_manifests_p3_19_created_by_type_check", {
    objectCode: "export_manifest_actor_type",
    message: "The export manifest actor type is not valid.",
    blockingReason: "export_manifest_actor_type_invalid",
    requiredFix: "Retry export finalization as a mapped human actor.",
    constraintKey: "created_by_type_check",
  }],
  ["export_manifests_p3_19_decision_type_check", {
    objectCode: "export_manifest_authority_decision_type",
    message: "The effective export authority decision type is not valid.",
    blockingReason: "export_authority_decision_type_invalid",
    requiredFix:
      "Re-evaluate the current export authority decision for this organization and export candidate, then retry export finalization.",
    constraintKey: "decision_type_check",
  }],
  ["export_manifests_p3_19_fingerprint_contract_version_check", {
    objectCode: "export_manifest_fingerprint_contract_version",
    message: "The export manifest fingerprint contract version is not valid.",
    blockingReason: "fingerprint_contract_version_invalid",
    requiredFix: "Retry export finalization; if this recurs, escalate it as a system defect.",
    constraintKey: "fingerprint_contract_version_check",
  }],
]);

// Actionable export-manifest insert diagnostic for a known constraint. Returns
// null (never a blocker) when `constraintName` is not an exact match in the
// USER_CONFIRMED allowlist above, so callers fall back to the existing
// generic unstructuredExportManifestDiagnosticBlocker for every unknown or
// missing constraint identifier. The raw constraint name is only ever used
// as a lookup key here; only the mapped constraintKey (a short, bounded,
// pre-declared machine code) is ever attached to the returned evidence.
export function exportManifestConstraintDiagnosticBlocker({ upstreamErrorCode, constraintName } = {}) {
  if (typeof constraintName !== "string") return null;
  const mapping = EXPORT_MANIFEST_CONSTRAINT_DIAGNOSTICS.get(constraintName);
  if (!mapping) return null;
  const safeUpstreamErrorCode =
    typeof upstreamErrorCode === "string" && POSTGRES_SQLSTATE_PATTERN.test(upstreamErrorCode)
      ? upstreamErrorCode
      : null;
  return [{
    validator_key: "VAL-SYS-P0-001",
    severity: "blocker",
    object_type: "export_manifest",
    object_code: mapping.objectCode,
    message: mapping.message,
    blocking_reason: mapping.blockingReason,
    required_fix: mapping.requiredFix,
    evidence: {
      failure_stage: "export_manifest_insert",
      ...(safeUpstreamErrorCode ? { upstream_error_code: safeUpstreamErrorCode } : {}),
      constraint_key: mapping.constraintKey,
    },
  }];
}

// True exactly when `result` is the unstructured-blocker shape this repair
// targets: ok:false, error.code validation_blocker, and no real blocker
// already attached (Rule A elsewhere always preserves a real blocker as-is).
export function isUnstructuredValidationBlockerFailure(result) {
  return Boolean(result)
    && result.ok === false
    && result.error?.code === "validation_blocker"
    && !(Array.isArray(result.blockers) && result.blockers.length > 0);
}
