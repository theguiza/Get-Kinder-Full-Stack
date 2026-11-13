import { getScopedDerivedMeasurementByEvidenceItemId, getScopedEvidenceItemById } from "../db/kaiIntakeQueries.js";
import { readEffectiveAiProcessingSourceDecisionsForClaims } from "./postgresEffectiveAllowedUseResolver.js";
import { measuredFactIntegrityHoldsInTransaction, traceabilityRecordsReviewRejection } from "./postgresOrdinaryInternalFactAuthority.js";
import { MEASUREMENT_EVIDENCE_TYPE } from "../validators/kaiSourceMeasurementValidators.js";
import {
  DERIVED_MEASUREMENT_EVIDENCE_TYPE,
  derivedContributingSourcesCurrent,
  derivedEvidenceIsCurrent,
  derivedMeasurementArithmeticHolds,
} from "../validators/kaiDerivedMeasurementValidators.js";
import { PROVISIONAL_INTERNAL_DRAFT_BLOCKERS } from "./postgresProvisionalInternalDraftAdmissionContract.js";

export { PROVISIONAL_INTERNAL_DRAFT_BLOCKERS };

/**
 * Provisional internal draft admission (owner Package 3, 2026-11-10): the
 * operation-specific answer to "may this claim be sent to the model for a new
 * INTERNAL provisional draft (Evidence Summary / Impact Narrative) now?".
 *
 * It is the composition of the same exported rules internal generation
 * applies (postgresGeneratedContentRepository.js createGeneratedContentDraft),
 * evaluated on a successful P2-06 internal result `data` in the caller's
 * transaction, so a client read can show it instead of inferring it:
 *
 * 1. source processing permission: the effective allowed-use and AI-processing
 *    decision of the claim's own source version and, for a cross-source
 *    measurement, of every reference version it combines
 *    (readEffectiveAiProcessingSourceDecisionsForClaims; VAL-KAI-B1A-02-003/004);
 * 2. a terminal "reviewed_not_supported" claim strength (VAL-GEN-CLAIM-STRENGTH-P0-001);
 * 3. a measured claim (record count or derived measurement): eligible, or no
 *    recorded review rejection and intact factual integrity
 *    (VAL-GEN-MEASURED-P2-01M-001, the Package 1 integrity rule);
 * 4. a derived measurement: current interpretation, current contributing
 *    versions and intact arithmetic.
 *
 * Currentness of the claim's own source version and of every contributing
 * version is already established by P2-06 succeeding (a superseded version is
 * a 409, never a `data`). Strict P2-06 eligibility, open review, coverage,
 * follow-ups and recorded sensitivity categories are NOT conditions here:
 * they are carried with the claim as limitations (owner direction 2026-11-06)
 * and remain the conditions of factual review, release, funder and public use.
 * This decides nothing about any of those, writes nothing and approves
 * nothing.
 *
 * Returns { admitted, blockerCodes, sourceRole } where blockerCodes is the
 * ordered subset of PROVISIONAL_INTERNAL_DRAFT_BLOCKERS and sourceRole names
 * which contributing version's processing decision refused the claim
 * ("primary" | "reference" | null). Never carries source content.
 */
const PROHIBITION_BLOCKERS = Object.freeze({
  reviewed_allowed_use_not_allowed: "allowed_use_not_allowed",
  intake_allowed_use_not_allowed: "allowed_use_not_allowed",
  reviewed_llm_processing_not_allowed: "ai_processing_not_permitted",
  sensitivity_ai_processing_unresolved: "ai_processing_not_permitted",
  sensitivity_decision_lineage_ambiguous: "sensitivity_decision_lineage_ambiguous",
  sensitivity_profile_missing: "claim_lineage_missing",
  claim_lineage_missing: "claim_lineage_missing",
});

export async function evaluateProvisionalInternalDraftAdmissionInTransaction(tx, { organizationId, data }) {
  const claimId = data?.claim?.claim_id;
  const evidenceItemId = data?.evidence?.evidence_item_id;
  if (data?.requestedAudience !== "internal" || !claimId || !evidenceItemId) {
    return { admitted: false, blockerCodes: ["claim_lineage_missing"], sourceRole: null };
  }
  const blockers = new Set();
  let sourceRole = null;

  const decisions = (await readEffectiveAiProcessingSourceDecisionsForClaims(tx, { organizationId, claimIds: [claimId] })).get(claimId)
    || [{ sourceRole: null, prohibition: "claim_lineage_missing" }];
  const refusing = decisions.find((decision) => decision.prohibition !== null);
  if (refusing) {
    blockers.add(PROHIBITION_BLOCKERS[refusing.prohibition] || "claim_lineage_missing");
    sourceRole = refusing.sourceRole;
  }

  if (traceabilityRecordsReviewRejection(data)) blockers.add("claim_reviewed_not_supported");

  const evidenceItemRow = await getScopedEvidenceItemById({ organizationId, evidenceItemId }, tx);
  const evidenceType = evidenceItemRow?.evidence_type ?? null;
  if (evidenceType === MEASUREMENT_EVIDENCE_TYPE || evidenceType === DERIVED_MEASUREMENT_EVIDENCE_TYPE) {
    if (data.eligible !== true) {
      if (traceabilityRecordsReviewRejection(data)) blockers.add("claim_reviewed_not_supported");
      else if (!(await measuredFactIntegrityHoldsInTransaction(tx, { organizationId, claimId, evidenceItemId }))) {
        blockers.add("measured_claim_integrity_not_established");
      }
    }
    if (evidenceType === DERIVED_MEASUREMENT_EVIDENCE_TYPE) {
      const derivedRow = await getScopedDerivedMeasurementByEvidenceItemId({ organizationId, evidenceItemId }, tx);
      if (!derivedEvidenceIsCurrent(derivedRow) || !derivedContributingSourcesCurrent(derivedRow) || !derivedMeasurementArithmeticHolds(derivedRow)) {
        blockers.add("derived_measurement_not_current");
      }
    }
  }

  const blockerCodes = PROVISIONAL_INTERNAL_DRAFT_BLOCKERS.filter((code) => blockers.has(code));
  return { admitted: blockerCodes.length === 0, blockerCodes, sourceRole: blockerCodes.length === 0 ? null : sourceRole };
}
