import { blockerResult, passResult } from "./types.js";

const VALID_REVIEW_QUEUE_TYPES = Object.freeze([
  "intake_file_review",
  "source_candidate_review",
  "sensitivity_review",
  "data_dictionary_review",
  "evidence_review",
  "claim_review",
  "client_followup",
  "conflict_resolution",
  "generated_content_review",
  "export_review",
]);

const INVALID_P0_QUEUE_TYPES = new Set([
  "source_candidate_review_stub",
  "client_followup_stub",
  "file_policy_blocked",
]);

export function validateReviewQueueType({ queueType } = {}) {
  if (INVALID_P0_QUEUE_TYPES.has(queueType) || !VALID_REVIEW_QUEUE_TYPES.includes(queueType)) {
    return blockerResult("VAL-INT-001", "Review queue type is not DDL-valid.", {
      object_type: "review_queue_item",
      object_code: queueType,
      blocking_reason: "invalid_queue_type",
      required_fix: "Use a DDL-valid queue_type and put stub/blocking semantics in metadata/status fields.",
    });
  }

  return passResult("VAL-INT-001", "Review queue type is DDL-valid.", { queueType });
}

export { VALID_REVIEW_QUEUE_TYPES };
