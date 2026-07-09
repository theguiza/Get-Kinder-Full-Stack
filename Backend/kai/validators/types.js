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

export function pass(validatorKey, message = "Validation passed.", evidence = {}) {
  return createValidatorResult({
    validator_key: validatorKey,
    severity: "pass",
    message,
    evidence,
  });
}

export function warning(validatorKey, message, fields = {}) {
  return createValidatorResult({
    validator_key: validatorKey,
    severity: "warning",
    message,
    ...fields,
  });
}

export function blocker(validatorKey, message, fields = {}) {
  return createValidatorResult({
    validator_key: validatorKey,
    severity: "blocker",
    message,
    ...fields,
  });
}

export function passResult(validatorKey, message = "Validation passed.", evidence = {}) {
  return pass(validatorKey, message, evidence);
}

export function warningResult(validatorKey, message, fields = {}) {
  return warning(validatorKey, message, fields);
}

export function blockerResult(validatorKey, message, fields = {}) {
  return blocker(validatorKey, message, fields);
}

export function buildValidatorGroupResult({ group_key = "validator_group", results = [] } = {}) {
  const normalizedResults = results.filter(Boolean);
  const blockers = normalizedResults.filter((result) => result.severity === "blocker");
  const warnings = normalizedResults.filter((result) => result.severity === "warning");

  return {
    ok: blockers.length === 0,
    group_key,
    results: normalizedResults,
    blockers,
    warnings,
  };
}
