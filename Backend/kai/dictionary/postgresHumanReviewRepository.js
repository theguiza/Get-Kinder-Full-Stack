import {
  getScopedEvidenceItemById,
  getScopedSourceLocatorById,
  getScopedSourceById,
  getScopedSourceVersionById,
  getScopedSourceCandidateByIdentity,
  getScopedEvidenceReviewQueueItemByEvidenceItemId,
  getScopedClaimById,
  getScopedClaimEvidenceLinkByClaimId,
  getScopedClaimReviewQueueItemByClaimId,
} from "../db/kaiIntakeQueries.js";
import {
  findCurrentEvidenceReviewDecision,
  findCurrentClaimReviewDecision,
  insertEvidenceReviewDecision,
  insertClaimReviewDecision,
} from "./postgresHumanReviewDecisionRepository.js";
import {
  isEvidenceReviewTerminalOutcome,
  isClaimReviewTerminalOutcome,
  evidenceReviewStatusForOutcome,
  claimReviewStatusForOutcome,
  supportStrengthForOutcome,
  claimStrengthForOutcome,
} from "./humanReviewDecisionContract.js";

/**
 * KAI P2-12 (Problem A1) human evidence-review and claim-review repository:
 * repairs the P2-09 contract, which could only ever write ONE outcome
 * (support_strength/claim_strength = 'reviewed_supported'), accepted no
 * reviewer decision content, and let `queue resolved` alone stand in for
 * "reviewed" with no persisted decision. This module now binds every queue/
 * domain-column transition to a real, immutable, append-only decision row in
 * kai.evidence_review_decisions / kai.claim_review_decisions (see
 * Backend/kai/dictionary/postgresHumanReviewDecisionRepository.js and
 * migrations/kai_sprint2_p2_12_human_review_decision_ledger.sql) in the same
 * transaction as the queue CAS, the domain-column write, and the required
 * audit. It never touches claims.claim_status or any audience-gate boolean -
 * P2-05's own conflict-candidate detection
 * (Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js)
 * still depends on claim_status='proposed', which this package leaves
 * completely untouched.
 */

const HUMAN_REVIEW_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  evidence_review_unresolved: 409,
  governance_ceiling_exceeded: 422,
  system_error: 500,
});

const EVIDENCE_REVIEW_QUEUE_TYPE = "evidence_review";
const EVIDENCE_REVIEW_TARGET_TYPE = "evidence_item";
const CLAIM_REVIEW_QUEUE_TYPE = "claim_review";
const CLAIM_REVIEW_TARGET_TYPE = "claim";

const FRESH_QUEUE_STATUS = "open";
const FRESH_REVIEW_STATUS = "needs_gk_review";
const RESOLVED_QUEUE_STATUS = "resolved";
const RESOLVED_REVIEW_STATUS = "resolved";
const UNASSESSED_STRENGTH = "unassessed";
const REVIEWED_SUPPORTED_STRENGTH = "reviewed_supported";

const EVIDENCE_REVIEW_AUDIT_CONTRACT = "p2_12_evidence_review_decision_v1";
const CLAIM_REVIEW_AUDIT_CONTRACT = "p2_12_claim_review_decision_v1";
const EVIDENCE_REVIEW_AUDIT_OPERATION = "evidence_review_completed";
const CLAIM_REVIEW_AUDIT_OPERATION = "claim_review_completed_internal_approval";
const EVIDENCE_REVIEW_VALIDATOR_KEY = "VAL-KAI-P2-12-001";
const CLAIM_REVIEW_VALIDATOR_KEY = "VAL-KAI-P2-12-002";

function failure(code) {
  return { ok: false, data: null, error: { code, status: HUMAN_REVIEW_RESULT_STATUS[code] || 500 } };
}

function success(data) {
  return { ok: true, data, error: null };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

function isNullableNonEmptyStringArray(value) {
  if (value === null || value === undefined) return true;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function isMetadataOnlyAuditDependency(value) {
  return Boolean(value) && typeof value.prepareMetadataOnlyAudit === "function";
}

class MalformedResultRowError extends Error {
  constructor(what) {
    super(`${what} row failed post-write validation`);
    this.name = "MalformedResultRowError";
  }
}

class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

function prepareRequiredAudit(metadataOnlyAudit, payload, tx) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({ payload, db: tx });
  const okDescriptor =
    prepared !== null && typeof prepared === "object" && !Array.isArray(prepared)
      ? Object.getOwnPropertyDescriptor(prepared, "ok")
      : undefined;
  const auditConfirmed =
    okDescriptor !== undefined &&
    Object.hasOwn(okDescriptor, "value") &&
    okDescriptor.value === true &&
    typeof prepared.publish === "function";
  if (!auditConfirmed) throw new RequiredAuditRejectedError();
  return prepared;
}

function logValidationBlockerClassification(reason, error) {
  console.error(JSON.stringify({
    event: "KAI_P2_12_HUMAN_REVIEW_VALIDATION_BLOCKER_CLASSIFICATION",
    reason,
    pg_code: error?.code || null,
    pg_constraint: error?.constraint || null,
  }));
}

function shapeError(error) {
  if (error instanceof MalformedResultRowError) return failure("system_error");
  if (error instanceof RequiredAuditRejectedError) {
    logValidationBlockerClassification("required_audit_rejected", error);
    return failure("validation_blocker");
  }
  if (error?.code === "23514" || error?.code === "22P02") {
    logValidationBlockerClassification(error.code === "23514" ? "check_constraint_violation" : "invalid_input_syntax", error);
    return failure("validation_blocker");
  }
  if (error?.code === "25001") return failure("conflict_current_state_changed");
  return failure("system_error");
}

async function readScopedUploadState(tx, organizationId, intakeFileId) {
  const result = await tx.query(
    `SELECT upload_state
       FROM kai.intake_files
      WHERE organization_id = $1::uuid
        AND intake_file_id = $2::uuid`,
    [organizationId, intakeFileId],
  );
  return result.rows[0]?.upload_state ?? null;
}

async function readLineageIntakeFileId(tx, { organizationId, evidenceItemId }) {
  const evidenceItemRow = await getScopedEvidenceItemById({ organizationId, evidenceItemId }, tx);
  if (!evidenceItemRow) return null;
  const locatorRow = await getScopedSourceLocatorById(
    { organizationId, sourceLocatorId: evidenceItemRow.source_locator_id },
    tx,
  );
  if (!locatorRow) return null;
  const sourceRow = await getScopedSourceById({ organizationId, sourceId: evidenceItemRow.source_id }, tx);
  if (!sourceRow) return null;
  const sourceVersionRow = await getScopedSourceVersionById(
    { organizationId, sourceVersionId: evidenceItemRow.source_version_id },
    tx,
  );
  if (!sourceVersionRow || sourceVersionRow.is_current !== true) return null;
  const candidateRow = await getScopedSourceCandidateByIdentity(
    { organizationId, intakeSourceCandidateId: sourceVersionRow.intake_source_candidate_id },
    tx,
  );
  if (!candidateRow) return null;
  return candidateRow.intake_file_id;
}

async function insertUploadLifecycleAudit(tx, { organizationId, intakeFileId, operation, uploadState, metadata, now }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $4, 'success', $5::jsonb, $6::timestamptz)`,
    [organizationId, intakeFileId, operation, uploadState, JSON.stringify(metadata), now],
  );
}

/**
 * Compare-and-set the linked review_queue_items row from EITHER of its two
 * coherent starting states ("fresh": open/needs_gk_review, or "re-review":
 * resolved/resolved) to the state this decisionOutcome projects
 * (resolved/resolved for a terminal outcome; open/needs_gk_review for
 * needs_more_information - which correctly reopens a previously-resolved
 * item, and is a no-op transition for an already-fresh one). Any other
 * queue_status/review_status combination (in_progress, blocked, cancelled,
 * waiting_on_client, ...) does not match either branch and yields 0 rows,
 * exactly like a genuine conflict.
 */
async function updateReviewQueueCompareAndSet(tx, { organizationId, reviewQueueItemId, queueType, targetObjectType, targetObjectId, expectedUpdatedAt, now, isTerminal }) {
  const targetQueueStatus = isTerminal ? RESOLVED_QUEUE_STATUS : FRESH_QUEUE_STATUS;
  const targetReviewStatus = isTerminal ? RESOLVED_REVIEW_STATUS : FRESH_REVIEW_STATUS;
  const result = await tx.query(
    `UPDATE kai.review_queue_items
        SET queue_status = $1,
            review_status = $2,
            updated_at = $3::timestamptz
      WHERE organization_id = $4::uuid
        AND review_queue_item_id = $5::uuid
        AND queue_type = $6
        AND target_object_type = $7
        AND target_object_id = $8::uuid
        AND (
          (queue_status = $9 AND review_status = $10)
          OR (queue_status = $11 AND review_status = $12)
        )
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $13::timestamptz)
      RETURNING review_queue_item_id, organization_id, queue_type, target_object_type,
                target_object_id, queue_status, review_status, updated_at`,
    [
      targetQueueStatus,
      targetReviewStatus,
      now,
      organizationId,
      reviewQueueItemId,
      queueType,
      targetObjectType,
      targetObjectId,
      FRESH_QUEUE_STATUS,
      FRESH_REVIEW_STATUS,
      RESOLVED_QUEUE_STATUS,
      RESOLVED_REVIEW_STATUS,
      expectedUpdatedAt,
    ],
  );
  return result.rows[0] || null;
}

async function readReviewQueueItemById(tx, { organizationId, reviewQueueItemId, queueType, targetObjectType, targetObjectId }) {
  const { rows } = await tx.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, queue_status, review_status, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND review_queue_item_id = $2::uuid
        AND queue_type = $3
        AND target_object_type = $4
        AND target_object_id = $5::uuid`,
    [organizationId, reviewQueueItemId, queueType, targetObjectType, targetObjectId],
  );
  return rows[0] || null;
}

function isQueueRowInState(row, queueStatus, reviewStatus) {
  return Boolean(row) && row.queue_status === queueStatus && row.review_status === reviewStatus;
}

/**
 * A replay is recognized when: the current decision-lineage head already
 * carries this exact decisionOutcome AND was recorded against this exact
 * expectedUpdatedAt (the optimistic-concurrency stamp this request targeted -
 * proof this is the same request re-sent, not a new/different one) AND the
 * queue row is currently in the state this decisionOutcome projects. Any
 * other post-CAS-miss state is a genuine conflict.
 */
function isReplayOfDecision({ currentHead, decisionOutcome, expectedUpdatedAt, existingQueueRow, isTerminal }) {
  if (!currentHead) return false;
  if (currentHead.decision_outcome !== decisionOutcome) return false;
  const headTargetMs = Date.parse(new Date(currentHead.target_updated_at).toISOString());
  const expectedMs = Date.parse(expectedUpdatedAt);
  if (!Number.isFinite(headTargetMs) || !Number.isFinite(expectedMs) || headTargetMs !== expectedMs) return false;
  const expectedQueueStatus = isTerminal ? RESOLVED_QUEUE_STATUS : FRESH_QUEUE_STATUS;
  const expectedReviewStatus = isTerminal ? RESOLVED_REVIEW_STATUS : FRESH_REVIEW_STATUS;
  return isQueueRowInState(existingQueueRow, expectedQueueStatus, expectedReviewStatus);
}

async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

const EVIDENCE_REVIEW_INPUT_ALLOWED_KEYS = new Set([
  "organizationId", "evidenceItemId", "reviewQueueItemId", "expectedUpdatedAt",
  "decisionOutcome", "limitationNotes", "actorUserId", "actorRole", "now", "metadataOnlyAudit",
]);

function isRecordEvidenceReviewDecisionInput(input) {
  if (!isPlainObject(input) || !hasOnlyKeys(input, EVIDENCE_REVIEW_INPUT_ALLOWED_KEYS)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.evidenceItemId) &&
    isNonEmptyString(input.reviewQueueItemId) &&
    isNormalizedNow(input.expectedUpdatedAt) &&
    isNonEmptyString(input.decisionOutcome) &&
    isNullableNonEmptyStringArray(input.limitationNotes) &&
    isNonEmptyString(input.actorUserId) &&
    isNonEmptyString(input.actorRole) &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

const CLAIM_REVIEW_INPUT_ALLOWED_KEYS = new Set([
  "organizationId", "claimId", "reviewQueueItemId", "expectedUpdatedAt",
  "decisionOutcome", "limitationNotes", "approvedAudiences", "actorUserId", "actorRole", "now", "metadataOnlyAudit",
]);

function isRecordClaimReviewDecisionInput(input) {
  if (!isPlainObject(input) || !hasOnlyKeys(input, CLAIM_REVIEW_INPUT_ALLOWED_KEYS)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.claimId) &&
    isNonEmptyString(input.reviewQueueItemId) &&
    isNormalizedNow(input.expectedUpdatedAt) &&
    isNonEmptyString(input.decisionOutcome) &&
    isNullableNonEmptyStringArray(input.limitationNotes) &&
    isNullableNonEmptyStringArray(input.approvedAudiences) &&
    isNonEmptyString(input.actorUserId) &&
    isNonEmptyString(input.actorRole) &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

function toEvidenceReviewResult(queueRow, evidenceItemId, evidenceReviewStatus, supportStrength, decisionId, decisionOutcome, replayed) {
  return {
    evidence_item_id: evidenceItemId,
    review_queue_item_id: queueRow.review_queue_item_id,
    queue_status: queueRow.queue_status,
    review_status: queueRow.review_status,
    evidence_review_status: evidenceReviewStatus,
    support_strength: supportStrength,
    decision_id: decisionId,
    decision_outcome: decisionOutcome,
    replayed,
  };
}

function toClaimReviewResult(queueRow, claimId, claimReviewStatus, claimStrength, decisionId, decisionOutcome, approvedAudiences, replayed) {
  return {
    claim_id: claimId,
    review_queue_item_id: queueRow.review_queue_item_id,
    queue_status: queueRow.queue_status,
    review_status: queueRow.review_status,
    claim_review_status: claimReviewStatus,
    claim_strength: claimStrength,
    decision_id: decisionId,
    decision_outcome: decisionOutcome,
    approved_audiences: approvedAudiences,
    replayed,
  };
}

export function createPostgresHumanReviewRepository({ runInTransaction } = {}) {
  return Object.freeze({
    /**
     * Human evidence-review decision recording: writes exactly one new
     * append-only row to kai.evidence_review_decisions, then transitions the
     * linked `evidence_review` queue item and evidence_items.
     * evidence_review_status/support_strength atomically, with a required
     * same-transaction audit. Never touches claim state, audience gates, or
     * export_ready.
     */
    async recordEvidenceReviewDecision(input) {
      if (!isRecordEvidenceReviewDecisionInput(input)) return failure("validation_blocker");
      const {
        organizationId, evidenceItemId, reviewQueueItemId, expectedUpdatedAt,
        decisionOutcome, limitationNotes, actorUserId, actorRole, now, metadataOnlyAudit,
      } = input;
      const isTerminal = isEvidenceReviewTerminalOutcome(decisionOutcome);
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      try {
        return await run(async (tx) => {
          const evidenceItemRow = await getScopedEvidenceItemById({ organizationId, evidenceItemId }, tx);
          if (!evidenceItemRow) return failure("not_found");

          const intakeFileId = await readLineageIntakeFileId(tx, { organizationId, evidenceItemId });
          if (!intakeFileId) return failure("conflict_current_state_changed");

          const currentHead = await findCurrentEvidenceReviewDecision(tx, { organizationId, evidenceItemId });

          const preImageQueueRow = await readReviewQueueItemById(tx, {
            organizationId,
            reviewQueueItemId,
            queueType: EVIDENCE_REVIEW_QUEUE_TYPE,
            targetObjectType: EVIDENCE_REVIEW_TARGET_TYPE,
            targetObjectId: evidenceItemId,
          });

          const queueRow = await updateReviewQueueCompareAndSet(tx, {
            organizationId,
            reviewQueueItemId,
            queueType: EVIDENCE_REVIEW_QUEUE_TYPE,
            targetObjectType: EVIDENCE_REVIEW_TARGET_TYPE,
            targetObjectId: evidenceItemId,
            expectedUpdatedAt,
            now,
            isTerminal,
          });

          if (!queueRow) {
            const existingQueueRow = await readReviewQueueItemById(tx, {
              organizationId,
              reviewQueueItemId,
              queueType: EVIDENCE_REVIEW_QUEUE_TYPE,
              targetObjectType: EVIDENCE_REVIEW_TARGET_TYPE,
              targetObjectId: evidenceItemId,
            });
            if (!existingQueueRow) return failure("not_found");
            if (isReplayOfDecision({ currentHead, decisionOutcome, expectedUpdatedAt, existingQueueRow, isTerminal })) {
              const existingEvidenceRow = await getScopedEvidenceItemById({ organizationId, evidenceItemId }, tx);
              return success(toEvidenceReviewResult(
                existingQueueRow,
                evidenceItemId,
                existingEvidenceRow?.evidence_review_status ?? evidenceReviewStatusForOutcome(decisionOutcome),
                existingEvidenceRow?.support_strength ?? supportStrengthForOutcome(decisionOutcome),
                currentHead.decision_id,
                currentHead.decision_outcome,
                true,
              ));
            }
            return failure("conflict_current_state_changed");
          }

          const projectedReviewStatus = evidenceReviewStatusForOutcome(decisionOutcome);
          const projectedStrength = supportStrengthForOutcome(decisionOutcome);

          const strengthResult = await tx.query(
            `UPDATE kai.evidence_items
                SET evidence_review_status = $1,
                    support_strength = $2
              WHERE organization_id = $3::uuid
                AND evidence_item_id = $4::uuid
              RETURNING evidence_review_status, support_strength`,
            [projectedReviewStatus, projectedStrength, organizationId, evidenceItemId],
          );
          if (strengthResult.rows.length !== 1) throw new MalformedResultRowError("evidence_items");

          const decisionRow = await insertEvidenceReviewDecision(tx, {
            organizationId,
            evidenceItemId,
            reviewQueueItemId,
            decisionOutcome,
            limitationNotes: limitationNotes || null,
            decidedBy: actorUserId,
            decidedByRole: actorRole,
            targetUpdatedAt: expectedUpdatedAt,
            supersedesDecisionId: currentHead ? currentHead.decision_id : null,
          });

          const uploadState = await readScopedUploadState(tx, organizationId, intakeFileId);
          if (!uploadState) throw new MalformedResultRowError("intake_files");

          const auditMetadata = {
            metadata_only: true,
            contract: EVIDENCE_REVIEW_AUDIT_CONTRACT,
            evidence_item_id: evidenceItemId,
            review_queue_item_id: reviewQueueItemId,
            previous_queue_status: preImageQueueRow.queue_status,
            resulting_queue_status: queueRow.queue_status,
            previous_review_status: preImageQueueRow.review_status,
            resulting_review_status: queueRow.review_status,
            previous_support_strength: evidenceItemRow.support_strength,
            resulting_support_strength: projectedStrength,
            previous_evidence_review_status: evidenceItemRow.evidence_review_status,
            resulting_evidence_review_status: projectedReviewStatus,
            validator_key: EVIDENCE_REVIEW_VALIDATOR_KEY,
            decision_id: decisionRow.decision_id,
            decision_outcome: decisionOutcome,
          };

          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, {
            attempted_operation: EVIDENCE_REVIEW_AUDIT_OPERATION,
            actor_type: "human",
            actor_user_id: actorUserId,
            contract: EVIDENCE_REVIEW_AUDIT_CONTRACT,
            object_type: "evidence_item",
            evidence_item_id: evidenceItemId,
            validator_key: EVIDENCE_REVIEW_VALIDATOR_KEY,
          }, tx);
          await insertUploadLifecycleAudit(tx, {
            organizationId,
            intakeFileId,
            operation: EVIDENCE_REVIEW_AUDIT_OPERATION,
            uploadState,
            metadata: auditMetadata,
            now,
          });
          await preparedAudit.publish();

          return success(toEvidenceReviewResult(
            queueRow,
            evidenceItemId,
            projectedReviewStatus,
            projectedStrength,
            decisionRow.decision_id,
            decisionOutcome,
            false,
          ));
        });
      } catch (error) {
        return shapeError(error);
      }
    },

    /**
     * Human claim-review decision recording: only after the linked P2-01
     * evidence item's own decision-lineage head is a TERMINAL evidence
     * outcome (never absent, never needs_more_information) does this write a
     * new append-only kai.claim_review_decisions row and transition the
     * claim's `claim_review` queue item and claims.claim_review_status/
     * claim_strength atomically, with a required same-transaction audit.
     * Never writes claim_status or any audience-gate/export_ready column.
     */
    async recordClaimReviewDecision(input) {
      if (!isRecordClaimReviewDecisionInput(input)) return failure("validation_blocker");
      const {
        organizationId, claimId, reviewQueueItemId, expectedUpdatedAt,
        decisionOutcome, limitationNotes, approvedAudiences, actorUserId, actorRole, now, metadataOnlyAudit,
      } = input;
      const isTerminal = isClaimReviewTerminalOutcome(decisionOutcome);
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      try {
        return await run(async (tx) => {
          const claimRow = await getScopedClaimById({ organizationId, claimId }, tx);
          if (!claimRow) return failure("not_found");

          const linkRow = await getScopedClaimEvidenceLinkByClaimId({ organizationId, claimId }, tx);
          if (!linkRow || linkRow.evidence_item_id !== claimRow.evidence_item_id) {
            return failure("conflict_current_state_changed");
          }
          const evidenceItemId = linkRow.evidence_item_id;

          const intakeFileId = await readLineageIntakeFileId(tx, { organizationId, evidenceItemId });
          if (!intakeFileId) return failure("conflict_current_state_changed");

          const evidenceReviewQueueItemRow = await getScopedEvidenceReviewQueueItemByEvidenceItemId(
            { organizationId, evidenceItemId },
            tx,
          );
          if (!evidenceReviewQueueItemRow) return failure("not_found");
          if (
            evidenceReviewQueueItemRow.queue_status !== RESOLVED_QUEUE_STATUS ||
            evidenceReviewQueueItemRow.review_status !== RESOLVED_REVIEW_STATUS
          ) {
            return failure("evidence_review_unresolved");
          }
          const evidenceHead = await findCurrentEvidenceReviewDecision(tx, { organizationId, evidenceItemId });
          if (!evidenceHead || !isEvidenceReviewTerminalOutcome(evidenceHead.decision_outcome)) {
            return failure("evidence_review_unresolved");
          }

          // Governance ceiling (Problem B is NOT opened here): funder/public
          // may only ever be requested if the bound claim's AND evidence
          // item's own funder_use_allowed/public_use_allowed booleans are
          // both true. Both are still hard-pinned false everywhere in this
          // schema, so only 'internal' can ever legitimately pass today.
          // This runs before any write in this transaction, so a rejection
          // here persists nothing.
          if (Array.isArray(approvedAudiences)) {
            const evidenceItemRow = await getScopedEvidenceItemById({ organizationId, evidenceItemId }, tx);
            if (!evidenceItemRow) return failure("not_found");
            for (const audience of approvedAudiences) {
              if (audience === "internal") continue;
              if (audience === "funder") {
                if (claimRow.funder_use_allowed === true && evidenceItemRow.funder_use_allowed === true) continue;
                return failure("governance_ceiling_exceeded");
              }
              if (audience === "public") {
                if (claimRow.public_use_allowed === true && evidenceItemRow.public_use_allowed === true) continue;
                return failure("governance_ceiling_exceeded");
              }
              return failure("validation_blocker");
            }
          }

          const currentHead = await findCurrentClaimReviewDecision(tx, { organizationId, claimId });

          const preImageQueueRow = await readReviewQueueItemById(tx, {
            organizationId,
            reviewQueueItemId,
            queueType: CLAIM_REVIEW_QUEUE_TYPE,
            targetObjectType: CLAIM_REVIEW_TARGET_TYPE,
            targetObjectId: claimId,
          });

          const queueRow = await updateReviewQueueCompareAndSet(tx, {
            organizationId,
            reviewQueueItemId,
            queueType: CLAIM_REVIEW_QUEUE_TYPE,
            targetObjectType: CLAIM_REVIEW_TARGET_TYPE,
            targetObjectId: claimId,
            expectedUpdatedAt,
            now,
            isTerminal,
          });

          if (!queueRow) {
            const existingQueueRow = await readReviewQueueItemById(tx, {
              organizationId,
              reviewQueueItemId,
              queueType: CLAIM_REVIEW_QUEUE_TYPE,
              targetObjectType: CLAIM_REVIEW_TARGET_TYPE,
              targetObjectId: claimId,
            });
            if (!existingQueueRow) return failure("not_found");
            if (isReplayOfDecision({ currentHead, decisionOutcome, expectedUpdatedAt, existingQueueRow, isTerminal })) {
              const existingClaimRow = await getScopedClaimById({ organizationId, claimId }, tx);
              return success(toClaimReviewResult(
                existingQueueRow,
                claimId,
                existingClaimRow?.claim_review_status ?? claimReviewStatusForOutcome(decisionOutcome),
                existingClaimRow?.claim_strength ?? claimStrengthForOutcome(decisionOutcome),
                currentHead.decision_id,
                currentHead.decision_outcome,
                currentHead.approved_audiences ?? null,
                true,
              ));
            }
            return failure("conflict_current_state_changed");
          }

          const projectedReviewStatus = claimReviewStatusForOutcome(decisionOutcome);
          const projectedStrength = claimStrengthForOutcome(decisionOutcome);

          const strengthResult = await tx.query(
            `UPDATE kai.claims
                SET claim_review_status = $1,
                    claim_strength = $2
              WHERE organization_id = $3::uuid
                AND claim_id = $4::uuid
              RETURNING claim_review_status, claim_strength`,
            [projectedReviewStatus, projectedStrength, organizationId, claimId],
          );
          if (strengthResult.rows.length !== 1) throw new MalformedResultRowError("claims");

          const decisionRow = await insertClaimReviewDecision(tx, {
            organizationId,
            claimId,
            reviewQueueItemId,
            decisionOutcome,
            limitationNotes: limitationNotes || null,
            approvedAudiences: approvedAudiences || null,
            decidedBy: actorUserId,
            decidedByRole: actorRole,
            targetUpdatedAt: expectedUpdatedAt,
            supersedesDecisionId: currentHead ? currentHead.decision_id : null,
          });

          const uploadState = await readScopedUploadState(tx, organizationId, intakeFileId);
          if (!uploadState) throw new MalformedResultRowError("intake_files");

          const auditMetadata = {
            metadata_only: true,
            contract: CLAIM_REVIEW_AUDIT_CONTRACT,
            claim_id: claimId,
            evidence_item_id: evidenceItemId,
            review_queue_item_id: reviewQueueItemId,
            previous_queue_status: preImageQueueRow.queue_status,
            resulting_queue_status: queueRow.queue_status,
            previous_review_status: preImageQueueRow.review_status,
            resulting_review_status: queueRow.review_status,
            previous_claim_strength: claimRow.claim_strength,
            resulting_claim_strength: projectedStrength,
            previous_claim_review_status: claimRow.claim_review_status,
            resulting_claim_review_status: projectedReviewStatus,
            validator_key: CLAIM_REVIEW_VALIDATOR_KEY,
            decision_id: decisionRow.decision_id,
            decision_outcome: decisionOutcome,
            approved_audiences: approvedAudiences || null,
          };

          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, {
            attempted_operation: CLAIM_REVIEW_AUDIT_OPERATION,
            actor_type: "human",
            actor_user_id: actorUserId,
            contract: CLAIM_REVIEW_AUDIT_CONTRACT,
            object_type: "claim",
            claim_id: claimId,
            validator_key: CLAIM_REVIEW_VALIDATOR_KEY,
          }, tx);
          await insertUploadLifecycleAudit(tx, {
            organizationId,
            intakeFileId,
            operation: CLAIM_REVIEW_AUDIT_OPERATION,
            uploadState,
            metadata: auditMetadata,
            now,
          });
          await preparedAudit.publish();

          return success(toClaimReviewResult(
            queueRow,
            claimId,
            projectedReviewStatus,
            projectedStrength,
            decisionRow.decision_id,
            decisionOutcome,
            approvedAudiences || null,
            false,
          ));
        });
      } catch (error) {
        return shapeError(error);
      }
    },
  });
}

export const __humanReviewRepositoryContract = Object.freeze({
  EVIDENCE_REVIEW_QUEUE_TYPE,
  EVIDENCE_REVIEW_TARGET_TYPE,
  CLAIM_REVIEW_QUEUE_TYPE,
  CLAIM_REVIEW_TARGET_TYPE,
  FRESH_QUEUE_STATUS,
  FRESH_REVIEW_STATUS,
  RESOLVED_QUEUE_STATUS,
  RESOLVED_REVIEW_STATUS,
  UNASSESSED_STRENGTH,
  REVIEWED_SUPPORTED_STRENGTH,
  EVIDENCE_REVIEW_AUDIT_OPERATION,
  CLAIM_REVIEW_AUDIT_OPERATION,
});

export const __humanReviewRepositoryTestables = Object.freeze({
  MalformedResultRowError,
  RequiredAuditRejectedError,
  prepareRequiredAudit,
  isReplayOfDecision,
});
