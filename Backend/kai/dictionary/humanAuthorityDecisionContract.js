// Phase 14 owner-accepted semantics (2026-09-20): this vocabulary is an
// append-only ledger of decision TYPES the repository can persist, not a
// stack of mandatory final-release approvals. `export_authority_granted` is
// the sole operative human final-release authority consulted by
// kaiHumanAuthorityDecisionService.js / kaiFinalExportEligibilityGateService.js
// and their GRP/Board Reporting analogues - those callers hardcode this one
// decision type and never accept a client-supplied decisionType.
// `client_reviewed`/`funder_ready`/`public_ready` are dormant readiness/
// review vocabulary: real, persistable via this repository's generic
// recordDecision/evaluateEffectiveness, but not wired as an additional
// mandatory gate anywhere. Do not read their presence in this array as a
// requirement that a caller must record them before final export.
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
