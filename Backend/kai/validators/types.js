export function createValidatorResult({
  validator_key,
  severity = "pass",
  object_type = null,
  object_code = null,
  object_id = null,
  message = "",
  blocking_reason = null,
  required_fix = null,
  evidence = {},
}) {
  return {
    validator_key,
    severity,
    object_type,
    object_code,
    object_id,
    message,
    blocking_reason,
    required_fix,
    evidence,
  };
}

export function passResult(validatorKey, message = "Validation passed.", evidence = {}) {
  return createValidatorResult({
    validator_key: validatorKey,
    severity: "pass",
    message,
    evidence,
  });
}

export function warningResult(validatorKey, message, fields = {}) {
  return createValidatorResult({
    validator_key: validatorKey,
    severity: "warning",
    message,
    ...fields,
  });
}

export function blockerResult(validatorKey, message, fields = {}) {
  return createValidatorResult({
    validator_key: validatorKey,
    severity: "blocker",
    message,
    ...fields,
  });
}
