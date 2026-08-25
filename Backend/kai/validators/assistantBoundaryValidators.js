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
  "delete_claim",
  "delete_evidence",
  "execute_retention",
  "retention_delete",
  "mutate_claim",
  "mutate_evidence",
  "mutate_review_queue",
  "invoke_service_function",
]);

const NON_HUMAN_ACTOR_TYPES = new Set(["assistant", "ai", "system", "internal_service"]);
const CLAIM_TRACEABILITY_METADATA_OPERATIONS = new Set([
  "get_claim_traceability_summary",
  "list_eligible_claims_for_audience",
  "list_governed_claims",
]);
const APPROVAL_OPERATION_PATTERN = /(approve|approval|finalize|promote|resolve|delete|retention)/i;
const RAW_ACCESS_OPERATION_PATTERN = /(raw|file|row|sample|storage|object_key|signed_url|url)/i;
const PROMPT_INJECTION_PATTERN =
  /\b(ignore|disregard|override|developer|system|instruction|prompt|jailbreak|tool|function|execute|invoke|approve|delete|export|generate)\b/i;
const P0_MUTATION_OPERATIONS = new Set([
  "create_intake_batch",
  "create_intake_file",
  "reserve_intake_file_metadata",
  "create_review_queue_item",
  "mark_file_policy_blocked",
  "update_review_queue_status",
]);

export function isAssistantRestrictedOperation(operation) {
  return FORBIDDEN_ASSISTANT_OPERATIONS.has(operation);
}

export function validateAssistantToolAuthorization({ operation } = {}) {
  if (CLAIM_TRACEABILITY_METADATA_OPERATIONS.has(operation)) {
    return passResult("VAL-AST-001", "Assistant tool authorization passed.", { operation });
  }
  return blockerResult("VAL-AST-001", "Assistant tool operation is not allowlisted.", {
    object_type: "operation",
    object_code: operation || null,
    blocking_reason: "assistant_tool_not_allowlisted",
    required_fix: "Use the exact allowlisted metadata-read assistant operation.",
  });
}

export function validateAssistantCannotApprove({ operation } = {}) {
  if (typeof operation === "string" && APPROVAL_OPERATION_PATTERN.test(operation)) {
    return blockerResult("VAL-AST-002", "Assistant cannot approve or finalize work.", {
      object_type: "operation",
      object_code: operation,
      blocking_reason: "assistant_approval_boundary",
      required_fix: "Route approval, finalization, promotion, deletion, and retention through authorized human workflows.",
    });
  }
  return passResult("VAL-AST-002", "Assistant approval boundary passed.", { operation });
}

export function validateAssistantCannotAccessRawFiles({ operation, payload } = {}) {
  const payloadText = JSON.stringify(payload ?? {});
  if (
    (typeof operation === "string" && RAW_ACCESS_OPERATION_PATTERN.test(operation)) ||
    /\b(raw_file|filename|file_name|storage|object_key|signed_url|source_text|claim_text|evidence_text|rows|samples)\b/i.test(payloadText)
  ) {
    return blockerResult("VAL-AST-003", "Assistant cannot access raw files, rows, storage keys, or signed URLs.", {
      object_type: "operation",
      object_code: operation || null,
      blocking_reason: "assistant_raw_access_boundary",
      required_fix: "Return metadata-safe identifiers and statuses only.",
    });
  }
  return passResult("VAL-AST-003", "Assistant raw-access boundary passed.", { operation });
}

export function validatePromptInjectionQuarantine({ payload } = {}) {
  const values = [];
  const collect = (value) => {
    if (typeof value === "string") values.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(payload);
  const suspicious = values.filter((value) => PROMPT_INJECTION_PATTERN.test(value));
  if (suspicious.length > 0) {
    return blockerResult("VAL-AST-004", "Prompt-like instructions in assistant tool data are quarantined.", {
      object_type: "assistant_tool_request",
      blocking_reason: "prompt_injection_quarantine",
      required_fix: "Treat caller-supplied and retrieved text as untrusted data, not instructions.",
      evidence: { quarantined_value_count: suspicious.length },
    });
  }
  return passResult("VAL-AST-004", "Prompt-injection quarantine passed.", {});
}

export function validateAssistantBoundary({ actorContext, operation } = {}) {
  const actorType = actorContext?.actorType;
  if (NON_HUMAN_ACTOR_TYPES.has(actorType) && (isAssistantRestrictedOperation(operation) || P0_MUTATION_OPERATIONS.has(operation))) {
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
