/**
 * KAI P2-03 deterministic claim-proposal validators: pure predicates over
 * already-read rows (or, for `validateUnsupportedClaimPromotion`, over the
 * literal write-plan constants this package is about to write). No SQL, no
 * database access - every row inspected must already have been read, fresh and
 * authoritative, by the caller (the P2-03 repository, inside its own
 * transaction).
 *
 * Return shape (boolean-gate, adapted from
 * `Backend/kai/validators/kaiEvidenceLineageValidators.js` with an added
 * `warnings` array of `createValidatorResult`-shaped objects from
 * `Backend/kai/validators/types.js`):
 *   - `{ ok: true, warnings: [...] }` on pass (warnings may be empty)
 *   - `{ ok: false, code }` on the first failing check, fail-closed
 *
 * `rows` shape for `validateClaimHasLoadBearingEvidence`:
 * `{ evidenceItemRow, locatorRow, sourceRow, sourceVersionRow, candidateRow,
 * decisionRow, evidenceReviewQueueItemRow }`, each either the row object or
 * null/undefined if missing.
 */

import { warning } from "./types.js";

const VALIDATOR_KEY_LOAD_BEARING_EVIDENCE = "VAL-KAI-P2-03-001";
const VALIDATOR_KEY_UNSUPPORTED_PROMOTION = "VAL-KAI-P2-03-002";
const VALIDATOR_KEY_REQUIREMENT_COVERAGE = "VAL-KAI-P2-03-003";

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * VAL-KAI-P2-03-001: requires complete tenant-safe evidence/source/version/
 * locator lineage plus the compatible `evidence_review` queue-item pair, then
 * treats that complete direct lineage as load-bearing for INTERNAL proposal
 * only. Warns (never blocks) while the evidence item's own `support_strength`
 * remains `'unassessed'` or its `evidence_review` queue item's `review_status`
 * remains unresolved - this warning always fires in this package's current
 * world, because P2-01 only ever creates evidence in exactly that state; it is
 * intentional and is what "block approval/export under those unresolved
 * conditions" means downstream.
 */
export function validateClaimHasLoadBearingEvidence(rows) {
  const {
    evidenceItemRow,
    locatorRow,
    sourceRow,
    sourceVersionRow,
    candidateRow,
    decisionRow,
    evidenceReviewQueueItemRow,
  } = rows || {};

  // 1. Any of the seven rows missing.
  if (
    !evidenceItemRow ||
    !locatorRow ||
    !sourceRow ||
    !sourceVersionRow ||
    !candidateRow ||
    !decisionRow ||
    !evidenceReviewQueueItemRow
  ) {
    return { ok: false, code: "not_found" };
  }

  // 2. Cross-row tenant consistency: never trusts any single row alone.
  const organizationIds = [
    evidenceItemRow.organization_id,
    locatorRow.organization_id,
    sourceRow.organization_id,
    sourceVersionRow.organization_id,
    candidateRow.organization_id,
    decisionRow.organization_id,
    evidenceReviewQueueItemRow.organization_id,
  ];
  if (new Set(organizationIds).size !== 1) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  // 3. The evidence item's own lineage-binding columns must match the exact
  // rows read for it.
  if (
    evidenceItemRow.source_locator_id !== locatorRow.source_locator_id ||
    evidenceItemRow.source_id !== sourceRow.source_id ||
    evidenceItemRow.source_version_id !== sourceVersionRow.source_version_id
  ) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  // 4. The locator must be bound to the same source_version as the evidence
  // item, and the source_version must belong to the exact source row read.
  if (
    locatorRow.source_version_id !== sourceVersionRow.source_version_id ||
    sourceVersionRow.source_id !== sourceRow.source_id
  ) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  // 5. The candidate must have reached its terminal promoted status.
  if (candidateRow.candidate_status !== "promoted") {
    return { ok: false, code: "validation_blocker" };
  }

  // 6. The promotion decision must have reached its terminal promoted status
  // and be bound to exactly this source/version.
  if (
    decisionRow.decision_status !== "promoted" ||
    decisionRow.source_id !== sourceRow.source_id ||
    decisionRow.source_version_id !== sourceVersionRow.source_version_id
  ) {
    return decisionRow.decision_status !== "promoted"
      ? { ok: false, code: "validation_blocker" }
      : { ok: false, code: "conflict_current_state_changed" };
  }

  // 7. The evidence item's own sourceVersion must in turn belong to the
  // candidate read (organization-scoped identity, not merely a coincidental id
  // match).
  if (sourceVersionRow.intake_source_candidate_id !== candidateRow.intake_source_candidate_id) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  // 8. The source_version must still be the current version of its source.
  // A superseded source_version is not sufficient for load-bearing evidence,
  // regardless of whether the evidence item, locator, source row, candidate,
  // decision, or evidence_review item still reference/remain promoted.
  if (sourceVersionRow.is_current !== true) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  // 9. The evidence_review queue-item pair must be immutably compatible: exact
  // queue_type/target_object_type/target_object_id/tenant match against this
  // evidence item. A missing pair was already caught by check 1 (not_found); an
  // incompatible pair is a conflict.
  if (
    evidenceReviewQueueItemRow.queue_type !== "evidence_review" ||
    evidenceReviewQueueItemRow.target_object_type !== "evidence_item" ||
    evidenceReviewQueueItemRow.target_object_id !== evidenceItemRow.evidence_item_id
  ) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  const warnings = [];
  if (
    evidenceItemRow.support_strength === "unassessed" ||
    evidenceReviewQueueItemRow.review_status !== "resolved"
  ) {
    warnings.push(
      warning(
        VALIDATOR_KEY_LOAD_BEARING_EVIDENCE,
        "The claim's load-bearing evidence has unresolved support strength and/or an unresolved evidence review - this must block approval, promotion, or export until resolved.",
        {
          object_type: "evidence_item",
          object_id: evidenceItemRow.evidence_item_id,
          evidence: {
            support_strength: evidenceItemRow.support_strength,
            evidence_review_status: evidenceReviewQueueItemRow.review_status,
          },
        },
      ),
    );
  }

  return { ok: true, warnings };
}

/**
 * VAL-KAI-P2-03-002: a fixed-shape assertion over the literal constants this
 * package is about to write - never over caller input, since the caller cannot
 * supply any of these values (the service input allowlist is
 * organizationId/evidenceItemId/actorContext/now only). This package's own write
 * plan is always exactly proposed/needs_gk_review/internal_only/unassessed, with
 * every audience-gate boolean and export_ready false; this validator is a real,
 * testable guard against a future accidental change to those constants, not a
 * no-op.
 */
export function validateUnsupportedClaimPromotion(writePlan) {
  const plan = writePlan || {};
  const isAllowedShape =
    plan.claimStatus === "proposed" &&
    plan.claimReviewStatus === "needs_gk_review" &&
    plan.claimStrength === "unassessed" &&
    plan.internalOnly === true &&
    plan.publicUseAllowed === false &&
    plan.funderUseAllowed === false &&
    plan.llmProcessingAllowed === false &&
    plan.productLearningAllowed === false &&
    plan.exportReady === false;

  if (!isAllowedShape) {
    return { ok: false, code: "validation_blocker" };
  }

  return { ok: true, warnings: [] };
}

/**
 * VAL-KAI-P2-03-003: always returns a pass with a warning that requirement
 * coverage is unresolved/unbound, since no requirement-binding table exists yet.
 * Takes no requirement-shaped input at all, and never creates or infers a
 * requirement identity - this validator exists solely so a later package can
 * replace it without changing the service's call shape.
 */
export function validateClaimRequirementCoverage() {
  return {
    ok: true,
    warnings: [
      warning(
        VALIDATOR_KEY_REQUIREMENT_COVERAGE,
        "Requirement coverage for this claim is unresolved: no requirement-binding table exists yet.",
        {
          object_type: "claim",
          evidence: { requirement_coverage_status: "unresolved" },
        },
      ),
    ],
  };
}

export const __claimProposalValidatorsTestables = Object.freeze({
  isNonEmptyString,
});

export const __claimProposalValidatorKeys = Object.freeze({
  VALIDATOR_KEY_LOAD_BEARING_EVIDENCE,
  VALIDATOR_KEY_UNSUPPORTED_PROMOTION,
  VALIDATOR_KEY_REQUIREMENT_COVERAGE,
});
