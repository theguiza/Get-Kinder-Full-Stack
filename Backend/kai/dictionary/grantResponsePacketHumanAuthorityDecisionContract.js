// P14-07B1 static contract constants for the Grant Response Packet human
// final-release authority decision ledger. Mirrors the shape of the existing
// P3-17 humanAuthorityDecisionContract.js exactly, narrowed to the single
// decision type this package is authorized to add for a packet candidate -
// export_authority_granted - since a Grant Response Packet's audience is
// always exactly "funder" (see GRANT_RESPONSE_PACKET_AUDIENCE), so no
// client_reviewed/funder_ready/public_ready equivalent exists here.

export const GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_TYPES = Object.freeze([
  "export_authority_granted",
]);

export const GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_ACTIONS = Object.freeze(["grant", "revoke"]);

export const GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE = Object.freeze({
  export_authority_granted: "gk_admin",
});

export function isGrantResponsePacketHumanAuthorityDecisionType(value) {
  return GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_TYPES.includes(value);
}

export function isGrantResponsePacketHumanAuthorityDecisionAction(value) {
  return GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_ACTIONS.includes(value);
}

export function roleRequiredForGrantResponsePacketHumanAuthorityDecisionType(decisionType) {
  return GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_ROLE_BY_TYPE[decisionType] || null;
}
