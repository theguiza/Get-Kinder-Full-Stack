import { blockerResult, passResult } from "./types.js";

export const FORBIDDEN_ASSISTANT_OPERATIONS = new Set([
  "promote_source",
  "promote_intake_source",
  "approve_source",
  "approve_review_decision",
  "approve",
  "finalize",
  "export",
  "generate_report_export",
  "generate_funder_text",
  "generate_public_text",
  "generate_report_from_intake",
  "access_raw_file_url",
  "access_raw_file",
  "issue_signed_read_url",
  "receive_signed_url",
  "create_claim",
  "create_claim_from_intake",
  "create_evidence",
  "convert_parser_output_to_claims",
  "bypass_human_review",
]);

const ASSISTANT_ACTOR_TYPES = new Set(["assistant", "system"]);

export function isAssistantRestrictedOperation(operation) {
  return FORBIDDEN_ASSISTANT_OPERATIONS.has(operation);
}

export function validateAssistantBoundary({ actorContext, operation } = {}) {
  const actorType = actorContext?.actorType;
  if (ASSISTANT_ACTOR_TYPES.has(actorType) && isAssistantRestrictedOperation(operation)) {
    return blockerResult("VAL-AST-001", "Assistant/system actor cannot perform this operation.", {
      object_type: "operation",
      object_code: operation,
      blocking_reason: "assistant_boundary",
      required_fix: "Route the operation through an authorized human review path.",
    });
  }
  return passResult("VAL-AST-001", "Assistant boundary passed.", { operation });
}

export function assistant_raw_file_access_blocked(context = {}) {
  return validateAssistantBoundary({ ...context, operation: "access_raw_file" });
}

export function assistant_signed_url_access_blocked(context = {}) {
  return validateAssistantBoundary({ ...context, operation: "receive_signed_url" });
}

export function assistant_review_approval_blocked(context = {}) {
  return validateAssistantBoundary({ ...context, operation: "approve_review_decision" });
}

export function assistant_source_promotion_blocked(context = {}) {
  return validateAssistantBoundary({ ...context, operation: "promote_intake_source" });
}

export function assistant_claim_creation_blocked(context = {}) {
  return validateAssistantBoundary({ ...context, operation: "create_claim_from_intake" });
}

export function assistant_evidence_creation_blocked(context = {}) {
  return validateAssistantBoundary({ ...context, operation: "create_evidence" });
}

export function assistant_report_export_generation_blocked(context = {}) {
  return validateAssistantBoundary({ ...context, operation: "generate_report_export" });
}

export function assistant_human_review_bypass_blocked(context = {}) {
  return validateAssistantBoundary({ ...context, operation: "bypass_human_review" });
}
