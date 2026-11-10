// Closed blocker vocabulary of the provisional internal draft admission
// (postgresProvisionalInternalDraftAdmission.js, owner Package 3). Pure: no
// database import, so the claim traceability service can project it before
// any repository is loaded.
export const PROVISIONAL_INTERNAL_DRAFT_BLOCKERS = Object.freeze([
  "allowed_use_not_allowed",
  "ai_processing_not_permitted",
  "sensitivity_decision_lineage_ambiguous",
  "claim_lineage_missing",
  "claim_reviewed_not_supported",
  "measured_claim_integrity_not_established",
  "derived_measurement_not_current",
]);
