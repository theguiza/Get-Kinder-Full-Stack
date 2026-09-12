// BR-04 static contract constants for the Board Reporting candidate human
// final-release authority decision ledger. Mirrors the shape of the existing
// P3-17 humanAuthorityDecisionContract.js and P14-07B1
// grantResponsePacketHumanAuthorityDecisionContract.js exactly, narrowed to
// the single decision type this package is authorized to add for a Board
// Reporting candidate - export_authority_granted - since a Board Reporting
// candidate's packet_audience is always exactly "internal" (BR-02), so no
// client_reviewed/funder_ready/public_ready equivalent exists here, and no
// requested_audience concept is ever accepted.

export const BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_TYPES = Object.freeze([
  "export_authority_granted",
]);

export const BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_ACTIONS = Object.freeze(["grant", "revoke"]);

export const BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE = Object.freeze({
  export_authority_granted: "gk_admin",
});

export function isBoardReportingCandidateHumanAuthorityDecisionType(value) {
  return BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_TYPES.includes(value);
}

export function isBoardReportingCandidateHumanAuthorityDecisionAction(value) {
  return BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_ACTIONS.includes(value);
}

export function roleRequiredForBoardReportingCandidateHumanAuthorityDecisionType(decisionType) {
  return BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE[decisionType] || null;
}
