import { blockerResult, buildValidatorGroupResult } from "./types.js";

export async function runValidators(validators, context = {}, options = {}) {
  const results = [];
  const group_key = options.group_key || options.groupKey || context.validatorGroupKey || "validator_group";

  for (const validator of validators) {
    try {
      const result = await validator(context);
      if (Array.isArray(result)) {
        results.push(...result);
      } else if (result) {
        results.push(result);
      }
    } catch (error) {
      results.push(
        blockerResult("VAL-RUN-001", "Validator execution failed closed.", {
          object_type: "validator",
          object_code: validator?.validatorKey || validator?.name || "anonymous_validator",
          blocking_reason: "validator_exception",
          required_fix: "Fix the validator contract before allowing this operation.",
          evidence: {
            error_name: error?.name || "Error",
          },
        }),
      );
    }
  }

  return buildValidatorGroupResult({ group_key, results });
}
