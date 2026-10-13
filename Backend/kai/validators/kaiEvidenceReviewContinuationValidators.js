/**
 * KAI J3-3 / Decision C Option A (owner-accepted 2026-10-13): the governed
 * decision-bound continuation from a committed P2-12 evidence-review decision
 * into the existing P2-02 coverage assessment and P2-03 claim proposal.
 *
 * Pure validator over rows the caller has ALREADY read from the database
 * through its own scoped repository: the current lineage-head
 * `kai.evidence_review_decisions` row (no successor), the evidence item, and
 * its `evidence_review` queue item. It never accepts a caller-supplied
 * decision object, id, or marker as authority - the only authority it
 * recognizes is the persisted head decision, and only for the human who made
 * it.
 *
 * The continuation authority is exactly:
 *   - the current head decision exists for this organization and evidence item;
 *   - it was decided by this same actor (decided_by), in a P2-12 role;
 *   - its outcome is positive (supported / supported_with_limitation);
 *   - it decided this evidence item's own evidence_review queue item, which is
 *     still resolved, and the evidence item still carries the reviewed,
 *     reviewed_supported projection that decision wrote.
 * Source-version currentness and promotion lineage stay with the existing
 * P2-02 permission validator and P2-03 load-bearing-evidence validator.
 */

export const EVIDENCE_REVIEW_CONTINUATION_VALIDATOR_KEY = "VAL-KAI-P2-12-003";
export const EVIDENCE_REVIEW_CONTINUATION_AUTHORITY_SOURCE = "evidence_review_decision";

// Mirrors the evidence_review_decisions decided_by_role CHECK
// (migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql).
const DECIDED_BY_ROLES = new Set(["gk_reviewer", "gk_admin"]);
const POSITIVE_OUTCOMES = new Set(["supported", "supported_with_limitation"]);
const REVIEWED_SUPPORTED = "reviewed_supported";
const REVIEWED = "reviewed";
const RESOLVED = "resolved";

function blocker(blockingReason, message, requiredFix, objectId) {
  return {
    validator_key: EVIDENCE_REVIEW_CONTINUATION_VALIDATOR_KEY,
    severity: "blocker",
    object_type: "evidence_item",
    object_id: objectId ?? null,
    message,
    blocking_reason: blockingReason,
    required_fix: requiredFix,
    evidence: { bypass_allowed: false },
  };
}

function refused(code, blockingReason, message, requiredFix, objectId) {
  return { ok: false, code, blockers: [blocker(blockingReason, message, requiredFix, objectId)] };
}

export function validateEvidenceReviewDecisionContinuation({
  organizationId,
  evidenceItemId,
  actorUserId,
  decisionRow,
  evidenceItemRow,
  evidenceReviewQueueItemRow,
} = {}) {
  if (
    !decisionRow
    || decisionRow.organization_id !== organizationId
    || decisionRow.evidence_item_id !== evidenceItemId
  ) {
    return refused(
      "authorization_denied",
      "evidence_review_decision_required",
      "No committed evidence-review decision authorizes this continuation.",
      "Record a positive P2-12 evidence-review decision for this evidence item.",
      evidenceItemId,
    );
  }
  if (typeof actorUserId !== "string" || decisionRow.decided_by !== actorUserId) {
    return refused(
      "authorization_denied",
      "evidence_review_decision_not_by_actor",
      "The current evidence-review decision was not made by this actor.",
      "Only the human who made the current evidence-review decision can continue it.",
      evidenceItemId,
    );
  }
  if (!DECIDED_BY_ROLES.has(decisionRow.decided_by_role)) {
    return refused(
      "authorization_denied",
      "evidence_review_decision_role_not_allowed",
      "The current evidence-review decision was not recorded in a P2-12 review role.",
      "Record the evidence-review decision as gk_reviewer or gk_admin.",
      evidenceItemId,
    );
  }
  if (!POSITIVE_OUTCOMES.has(decisionRow.decision_outcome)) {
    return refused(
      "authorization_denied",
      "evidence_review_decision_not_positive",
      "The current evidence-review decision does not support the evidence.",
      "Only a supported or supported_with_limitation decision continues to claim proposal.",
      evidenceItemId,
    );
  }
  if (
    !evidenceItemRow
    || evidenceItemRow.organization_id !== organizationId
    || evidenceItemRow.evidence_item_id !== evidenceItemId
    || !evidenceReviewQueueItemRow
    || evidenceReviewQueueItemRow.organization_id !== organizationId
  ) {
    return { ok: false, code: "not_found", blockers: [] };
  }
  if (
    evidenceReviewQueueItemRow.review_queue_item_id !== decisionRow.review_queue_item_id
    || evidenceReviewQueueItemRow.queue_type !== "evidence_review"
    || evidenceReviewQueueItemRow.target_object_type !== "evidence_item"
    || evidenceReviewQueueItemRow.target_object_id !== evidenceItemId
    || evidenceReviewQueueItemRow.queue_status !== RESOLVED
    || evidenceReviewQueueItemRow.review_status !== RESOLVED
    || evidenceItemRow.evidence_review_status !== REVIEWED
    || evidenceItemRow.support_strength !== REVIEWED_SUPPORTED
  ) {
    return refused(
      "conflict_current_state_changed",
      "evidence_review_decision_not_current",
      "The evidence item's review state no longer matches the current evidence-review decision.",
      "Re-read the evidence item and review it again.",
      evidenceItemId,
    );
  }
  return {
    ok: true,
    decision: {
      decision_id: decisionRow.decision_id,
      decided_by_role: decisionRow.decided_by_role,
      decision_outcome: decisionRow.decision_outcome,
    },
  };
}
