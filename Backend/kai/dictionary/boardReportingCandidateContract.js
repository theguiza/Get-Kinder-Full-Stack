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
