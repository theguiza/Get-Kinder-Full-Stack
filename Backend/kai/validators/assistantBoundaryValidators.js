import { blockerResult, passResult } from "./types.js";

const FORBIDDEN_ASSISTANT_OPERATIONS = new Set([
  "promote_source",
  "approve_source",
  "approve",
  "finalize",
  "export",
  "access_raw_file_url",
  "issue_signed_read_url",
  "convert_parser_output_to_claims",
]);

export function isAssistantRestrictedOperation(operation) {
  return FORBIDDEN_ASSISTANT_OPERATIONS.has(operation);
}

export function validateAssistantBoundary({ actorContext, operation } = {}) {
  const actorType = actorContext?.actorType;
  if ((actorType === "assistant" || actorType === "system") && isAssistantRestrictedOperation(operation)) {
    return blockerResult("VAL-AST-001", "Assistant/system actor cannot perform this operation.", {
      object_type: "operation",
      object_code: operation,
      blocking_reason: "assistant_boundary",
      required_fix: "Route the operation through an authorized human review path.",
    });
  }
  return passResult("VAL-AST-001", "Assistant boundary passed.", { operation });
}

export { FORBIDDEN_ASSISTANT_OPERATIONS };
