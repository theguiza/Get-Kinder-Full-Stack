export const HUMAN_AUTHORITY_DECISION_TYPES = Object.freeze([
  "client_reviewed",
  "funder_ready",
  "public_ready",
  "export_authority_granted",
]);

export const HUMAN_AUTHORITY_DECISION_ACTIONS = Object.freeze(["grant", "revoke"]);

export const HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE = Object.freeze({
  client_reviewed: "client_reviewer",
  funder_ready: "gk_admin",
  public_ready: "gk_admin",
  export_authority_granted: "gk_admin",
});

export const HUMAN_AUTHORITY_DECISION_AUDIENCE_BY_TYPE = Object.freeze({
  funder_ready: "funder",
  public_ready: "public",
});

export function isHumanAuthorityDecisionType(value) {
  return HUMAN_AUTHORITY_DECISION_TYPES.includes(value);
}

export function isHumanAuthorityDecisionAction(value) {
  return HUMAN_AUTHORITY_DECISION_ACTIONS.includes(value);
}

export function roleRequiredForDecisionType(decisionType) {
  return HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE[decisionType] || null;
}
