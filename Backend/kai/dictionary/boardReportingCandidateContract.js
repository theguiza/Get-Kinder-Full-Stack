export const BOARD_REPORTING_CANDIDATE_AUDIENCE = "internal";

export const BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION =
  "kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1";

export const BOARD_REPORTING_CANDIDATE_CREATED_OPERATION =
  "board_reporting_candidate_created";

export const BOARD_REPORTING_CANDIDATE_AUDIT_CONTRACT =
  "br_02_board_reporting_candidate_v1";

export const BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT = Object.freeze({
  queueType: "board_reporting_candidate_review",
  targetObjectType: "board_reporting_candidate",
  priority: "medium",
  summary: "Board Reporting candidate requires review.",
  requiredAction: "Review internal Board packet membership and current-use support before release work.",
  assignedTo: null,
  dueAt: null,
  createdByType: "system",
});

export const BOARD_REPORTING_CANDIDATE_REVIEW_REQUESTED_OPERATION =
  "board_reporting_candidate_review_requested";

export const BOARD_REPORTING_CANDIDATE_REVIEW_AUDIT_CONTRACT =
  "br_03a_board_reporting_candidate_review_v1";

// BR-03B: the full Board review lifecycle this queue_type admits, in order.
// REQUEST (index 0) is the exact BR-03A contract, unchanged. START (index 1)
// and COMPLETE (index 2) are the exact queue_status/review_status pairs the
// BR-03B migration adds to the review_queue_items CHECK constraint, reusing
// the same open/needs_gk_review -> in_progress/needs_gk_review ->
// resolved/resolved vocabulary already established for export_review
// (P3-05/P3-09/P3-13) and for generated_content_review. This turn implements
// START only; COMPLETE is declared here so the migration can define the full
// lifecycle CHECK once, but no completion code path exists yet.
export const BOARD_REPORTING_CANDIDATE_REVIEW_LIFECYCLE_PROFILES = Object.freeze([
  Object.freeze({ queueStatus: "open", reviewStatus: "needs_gk_review" }),
  Object.freeze({ queueStatus: "in_progress", reviewStatus: "needs_gk_review" }),
  Object.freeze({ queueStatus: "resolved", reviewStatus: "resolved" }),
]);

export const BOARD_REPORTING_CANDIDATE_REVIEW_STARTED_OPERATION =
  "board_reporting_candidate_review_started";

export const BOARD_REPORTING_CANDIDATE_REVIEW_START_AUDIT_CONTRACT =
  "br_03b_board_reporting_candidate_review_start_v1";

// BR-03B COMPLETE: transitions the SAME 'board_reporting_candidate_review'
// queue row from in_progress/needs_gk_review to resolved/resolved only -
// the exact predecessor/result pair the BR-03B migration's widened
// review_queue_items_br_03b_board_reporting_candidate_review_contract_check
// already admits (index 2 of BOARD_REPORTING_CANDIDATE_REVIEW_LIFECYCLE_PROFILES
// above). Completion means only that a gk_admin completed the governed
// human Board review of this exact immutable Board Reporting candidate - it
// grants NO release authority, NO final eligibility, NO manifest, and NO
// delivery/board_update state. No new queue_type, no new lifecycle.
export const BOARD_REPORTING_CANDIDATE_REVIEW_COMPLETED_OPERATION =
  "board_reporting_candidate_review_completed";

export const BOARD_REPORTING_CANDIDATE_REVIEW_COMPLETE_AUDIT_CONTRACT =
  "br_03b_board_reporting_candidate_review_complete_v1";
