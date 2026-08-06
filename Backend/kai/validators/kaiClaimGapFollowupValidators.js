/**
 * KAI P2-04 deterministic claim-gap/client-followup validators: pure
 * predicates over already-read rows or literal write-plan objects this package
 * is about to write. No SQL, no database access - every row inspected must
 * already have been read, fresh and authoritative, by the caller (the P2-04
 * repository, inside its own transaction).
 *
 * This module deliberately reuses, rather than forks or reimplements, two
 * already-accepted validators: P2-03's `validateClaimHasLoadBearingEvidence`
 * (evidence/locator/source/source_version/candidate/decision/evidence_review
 * lineage, including the current-source_version gate) and P2-02's
 * `validateEvidenceCoverageAssessmentIsPermitted` (dictionary/profile lineage
 * plus the allowed-use permission gate). P2-04 adds only its own claim-identity
 * binding on top of that reused lineage.
 *
 * Return shape (boolean-gate, matching
 * `Backend/kai/validators/kaiClaimProposalValidators.js`):
 *   - `{ ok: true, warnings: [...] }` on pass (warnings may be empty)
 *   - `{ ok: false, code }` on the first failing check, fail-closed
 */

import { validateClaimHasLoadBearingEvidence } from "./kaiClaimProposalValidators.js";
import { validateEvidenceCoverageAssessmentIsPermitted } from "./kaiEvidenceCoverageAssessmentValidators.js";

const VALIDATOR_KEY_CLAIM_GAP_LINEAGE = "VAL-KAI-P2-04-001";
const VALIDATOR_KEY_CLIENT_FOLLOWUP_ROUTING = "VAL-KAI-P2-04-002";

export const CLIENT_ANSWERABLE_DIMENSION_KEYS = Object.freeze([
  "definition_clarity",
  "denominator_clarity",
  "time_period_clarity",
  "entity_level_clarity",
]);

export const CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION = Object.freeze({
  definition_clarity: "Confirm the business meaning of the unresolved field or measure.",
  denominator_clarity: "Confirm the denominator and how it is calculated.",
  time_period_clarity: "Confirm the reporting period represented by this source.",
  entity_level_clarity: "Confirm the entity level represented by the unresolved field or measure.",
});

export const CLIENT_FOLLOWUP_QUEUE_TYPE = "client_followup";
export const CLIENT_FOLLOWUP_TARGET_OBJECT_TYPE = "client_followup_item";
export const CLIENT_FOLLOWUP_QUEUE_STATUS = "waiting_on_client";
export const CLIENT_FOLLOWUP_REVIEW_STATUS = "proposed";
export const CLIENT_FOLLOWUP_PRIORITY = "normal";
export const CLIENT_FOLLOWUP_SUMMARY = "Client clarification is required for an unresolved claim gap.";

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * VAL-KAI-P2-04-001: requires the P2-04 service's own claim (by claimId) and
 * its canonical claim-to-evidence link to be present and tenant-consistent
 * with each other and with the evidence item the link binds to, then delegates
 * every deeper lineage/permission judgment to the already-accepted P2-03 and
 * P2-02 validators rather than reimplementing them. `rows` shape: everything
 * `validateClaimHasLoadBearingEvidence` and
 * `validateEvidenceCoverageAssessmentIsPermitted` require, plus `claimRow` and
 * `claimEvidenceLinkRow`.
 */
export function validateClaimGapLineage(rows) {
  const { claimRow, claimEvidenceLinkRow, evidenceItemRow } = rows || {};

  if (!claimRow || !claimEvidenceLinkRow) {
    return { ok: false, code: "not_found" };
  }

  if (
    claimRow.organization_id !== claimEvidenceLinkRow.organization_id ||
    claimEvidenceLinkRow.claim_id !== claimRow.claim_id
  ) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  if (evidenceItemRow && claimEvidenceLinkRow.evidence_item_id !== evidenceItemRow.evidence_item_id) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  if (evidenceItemRow && claimRow.evidence_item_id !== evidenceItemRow.evidence_item_id) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  const lineage = validateClaimHasLoadBearingEvidence(rows);
  if (!lineage.ok) return lineage;

  const permitted = validateEvidenceCoverageAssessmentIsPermitted(rows);
  if (!permitted.ok) return permitted;

  return { ok: true, warnings: lineage.warnings || [] };
}

/**
 * VAL-KAI-P2-04-002 (validateClientFollowupRouting): the sole gate authorizing
 * a client_followup_item plus its client_followup queue item to be written.
 * Verifies every element the P2-04 task specification requires: only the four
 * client-answerable dimensions ever route, the target gap is tenant-matched and
 * dimension-consistent with the claim, the follow-up write plan and queue write
 * plan carry the exact fixed contract (never a caller-shaped or varied value),
 * and no field beyond that fixed allowlist is present - so no internal-only
 * reason, unsupported conflict assertion, unsupported requirement assertion,
 * raw content, claim/evidence text, PII, or sensitive metadata can ever reach
 * the client-facing queue.
 *
 * Input shape:
 *   dimensionKey: one of the ten P2-02 dimension keys (only the four
 *     client-answerable keys pass);
 *   gapRow: the authoritative kai.gap_log_items row this follow-up is for;
 *   claimRow: the authoritative kai.claims row;
 *   followupWritePlan: { organization_id, claim_id, gap_log_item_id,
 *     dimension_key, question_text } - the exact row this package is about to
 *     insert into kai.client_followup_items;
 *   queueWritePlan: { organization_id, queue_type, target_object_type,
 *     queue_status, review_status, priority, summary, required_action,
 *     assigned_to, due_at } - the exact row this package is about to insert
 *     into kai.review_queue_items (target_object_id is intentionally excluded:
 *     it is only known after the follow-up row itself is inserted).
 */
export function validateClientFollowupRouting({ dimensionKey, gapRow, claimRow, followupWritePlan, queueWritePlan } = {}) {
  if (!CLIENT_ANSWERABLE_DIMENSION_KEYS.includes(dimensionKey)) {
    return { ok: false, code: "validation_blocker" };
  }

  if (!gapRow || !claimRow) {
    return { ok: false, code: "not_found" };
  }

  if (gapRow.organization_id !== claimRow.organization_id) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  if (gapRow.claim_id !== claimRow.claim_id || gapRow.dimension_key !== dimensionKey) {
    return { ok: false, code: "conflict_current_state_changed" };
  }

  const expectedQuestion = CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[dimensionKey];

  if (!isPlainObject(followupWritePlan)) {
    return { ok: false, code: "validation_blocker" };
  }
  const followupAllowedKeys = new Set(["organization_id", "claim_id", "gap_log_item_id", "dimension_key", "question_text"]);
  const followupOk =
    Object.keys(followupWritePlan).every((key) => followupAllowedKeys.has(key)) &&
    followupWritePlan.organization_id === claimRow.organization_id &&
    followupWritePlan.claim_id === claimRow.claim_id &&
    followupWritePlan.gap_log_item_id === gapRow.gap_log_item_id &&
    followupWritePlan.dimension_key === dimensionKey &&
    followupWritePlan.question_text === expectedQuestion;
  if (!followupOk) {
    return { ok: false, code: "validation_blocker" };
  }

  if (!isPlainObject(queueWritePlan)) {
    return { ok: false, code: "validation_blocker" };
  }
  const queueAllowedKeys = new Set([
    "organization_id",
    "queue_type",
    "target_object_type",
    "queue_status",
    "review_status",
    "priority",
    "summary",
    "required_action",
    "assigned_to",
    "due_at",
  ]);
  const queueOk =
    Object.keys(queueWritePlan).every((key) => queueAllowedKeys.has(key)) &&
    queueWritePlan.organization_id === claimRow.organization_id &&
    queueWritePlan.queue_type === CLIENT_FOLLOWUP_QUEUE_TYPE &&
    queueWritePlan.target_object_type === CLIENT_FOLLOWUP_TARGET_OBJECT_TYPE &&
    queueWritePlan.queue_status === CLIENT_FOLLOWUP_QUEUE_STATUS &&
    queueWritePlan.review_status === CLIENT_FOLLOWUP_REVIEW_STATUS &&
    queueWritePlan.priority === CLIENT_FOLLOWUP_PRIORITY &&
    queueWritePlan.summary === CLIENT_FOLLOWUP_SUMMARY &&
    queueWritePlan.required_action === expectedQuestion &&
    queueWritePlan.assigned_to === null &&
    queueWritePlan.due_at === null;
  if (!queueOk) {
    return { ok: false, code: "validation_blocker" };
  }

  return { ok: true, warnings: [] };
}

/**
 * Pure predicate deciding whether one P2-02 dimension result requires a P2-04
 * gap: every assessment_status other than 'resolved_clear'. Never reinterprets
 * or renames the P2-02 assessment-result vocabulary.
 */
export function dimensionResultRequiresGap(dimensionResult) {
  return isNonEmptyString(dimensionResult?.evidence?.assessment_status) && dimensionResult.evidence.assessment_status !== "resolved_clear";
}

export const __claimGapFollowupValidatorKeys = Object.freeze({
  VALIDATOR_KEY_CLAIM_GAP_LINEAGE,
  VALIDATOR_KEY_CLIENT_FOLLOWUP_ROUTING,
});

export const __claimGapFollowupValidatorsTestables = Object.freeze({
  isNonEmptyString,
  isPlainObject,
});
