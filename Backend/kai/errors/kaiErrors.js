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
  storage_provider_not_configured: 503,
  operation_not_enabled: 422,
  state_transition_denied: 422,
  blocked: 422,
  blocked_attempt: 422,
  audit_payload_rejected: 422,
  not_implemented: 501,
  system_error: 500,
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
  storage_provider_not_configured: "Storage adapter unavailable.",
  operation_not_enabled: "Operation is not enabled for KAI Sprint 2 P0.",
  state_transition_denied: "State transition is not allowed.",
  blocked: "Operation is blocked for KAI Sprint 2 P0.",
  blocked_attempt: "Operation attempt is blocked for KAI Sprint 2 P0.",
  audit_payload_rejected: "Blocked-attempt audit payload is not metadata-safe.",
  not_implemented: "Operation is not implemented for KAI Sprint 2 P0.",
  system_error: "KAI Sprint 2 server error.",
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
