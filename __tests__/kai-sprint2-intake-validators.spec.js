import test from "node:test";
import assert from "node:assert/strict";

import { validateReviewQueueType, VALID_REVIEW_QUEUE_TYPES } from "../Backend/kai/validators/intakeValidators.js";

test("review queue uses DDL-valid queue_type values only", () => {
  assert.equal(validateReviewQueueType({ queueType: "intake_file_review" }).severity, "pass");
  assert.equal(validateReviewQueueType({ queueType: "client_followup" }).severity, "pass");
  assert.equal(validateReviewQueueType({ queueType: "file_policy_blocked" }).severity, "blocker");
  assert.equal(validateReviewQueueType({ queueType: "source_candidate_review_stub" }).severity, "blocker");
  assert.equal(VALID_REVIEW_QUEUE_TYPES.includes("file_policy_blocked"), false);
});
