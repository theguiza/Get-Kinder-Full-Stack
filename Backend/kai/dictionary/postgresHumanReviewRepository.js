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

/**
 * KAI P2-09 human evidence-review and claim-review/internal-approval
 * repository: the smallest authoritative transition that lets a valid P2
 * claim/evidence chain move from its review-gated proposed state to INTERNAL
 * usability, exactly as required by P2-06's own eligibility evaluator
 * (Backend/kai/dictionary/postgresClaimTraceabilityRepository.js). P2-06's
 * `support_strength_unassessed` blocker fires whenever
 * evidence_items.support_strength or claims.claim_strength still reads
 * 'unassessed'; its `evidence_review_unresolved`/`claim_review_unresolved`
 * blockers fire whenever the linked `evidence_review`/`claim_review`
 * kai.review_queue_items row's own review_status is not 'resolved'/'approved'/
 * 'complete'. This module writes exactly those fields and nothing else: it
 * never touches evidence_items.evidence_review_status, claims.claim_status, or
 * claims.claim_review_status (P2-05's own conflict-candidate detection,
 * Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js,
 * requires claim_status = 'proposed' AND claim_review_status =
 * 'needs_gk_review' for its own contract check - this package must not
 * disturb that foundation), and it never touches audience-gate booleans,
 * export_ready, or the P2-06 evaluator's audience-approval/coverage-dimension
 * logic. Both transitions are human-only (`gk_reviewer`/`gk_admin`), tenant-
 * scoped, optimistic-concurrency-guarded (`expected_updated_at` against the
 * queue item's own `updated_at`), idempotent on exact replay, and rolled back
 * whole on any post-write validation or required-audit failure.
 */

const HUMAN_REVIEW_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  evidence_review_unresolved: 409,
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

const EVIDENCE_REVIEW_AUDIT_CONTRACT = "p2_09_evidence_review_completion_v1";
const CLAIM_REVIEW_AUDIT_CONTRACT = "p2_09_claim_review_internal_approval_v1";
const EVIDENCE_REVIEW_AUDIT_OPERATION = "evidence_review_completed";
const CLAIM_REVIEW_AUDIT_OPERATION = "claim_review_completed_internal_approval";
const EVIDENCE_REVIEW_VALIDATOR_KEY = "VAL-KAI-P2-09-001";
const CLAIM_REVIEW_VALIDATOR_KEY = "VAL-KAI-P2-09-002";

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

function shapeError(error) {
  if (error instanceof MalformedResultRowError) return failure("system_error");
  if (error instanceof RequiredAuditRejectedError) return failure("validation_blocker");
  if (error?.code === "23514" || error?.code === "22P02") return failure("validation_blocker");
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

async function updateReviewQueueCompareAndSet(tx, { organizationId, reviewQueueItemId, queueType, targetObjectType, targetObjectId, expectedUpdatedAt, now }) {
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
        AND queue_status = $9
        AND review_status = $10
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $11::timestamptz)
      RETURNING review_queue_item_id, organization_id, queue_type, target_object_type,
                target_object_id, queue_status, review_status, updated_at`,
    [
      RESOLVED_QUEUE_STATUS,
      RESOLVED_REVIEW_STATUS,
      now,
      organizationId,
      reviewQueueItemId,
      queueType,
      targetObjectType,
      targetObjectId,
      FRESH_QUEUE_STATUS,
      FRESH_REVIEW_STATUS,
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

function isResolvedQueueRow(row) {
  return Boolean(row) && row.queue_status === RESOLVED_QUEUE_STATUS && row.review_status === RESOLVED_REVIEW_STATUS;
}

async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

function isCompleteEvidenceReviewInput(input) {
  const allowedKeys = new Set([
    "organizationId", "evidenceItemId", "reviewQueueItemId", "expectedUpdatedAt",
    "actorUserId", "now", "metadataOnlyAudit",
  ]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.evidenceItemId) &&
    isNonEmptyString(input.reviewQueueItemId) &&
    isNormalizedNow(input.expectedUpdatedAt) &&
    isNonEmptyString(input.actorUserId) &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

function isCompleteClaimReviewInput(input) {
  const allowedKeys = new Set([
    "organizationId", "claimId", "reviewQueueItemId", "expectedUpdatedAt",
    "actorUserId", "now", "metadataOnlyAudit",
  ]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.claimId) &&
    isNonEmptyString(input.reviewQueueItemId) &&
    isNormalizedNow(input.expectedUpdatedAt) &&
    isNonEmptyString(input.actorUserId) &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

function toEvidenceReviewResult(queueRow, evidenceItemId, supportStrength, replayed) {
  return {
    evidence_item_id: evidenceItemId,
    review_queue_item_id: queueRow.review_queue_item_id,
    queue_status: queueRow.queue_status,
    review_status: queueRow.review_status,
    support_strength: supportStrength,
    replayed,
  };
}

function toClaimReviewResult(queueRow, claimId, claimStrength, replayed) {
  return {
    claim_id: claimId,
    review_queue_item_id: queueRow.review_queue_item_id,
    queue_status: queueRow.queue_status,
    review_status: queueRow.review_status,
    claim_strength: claimStrength,
    replayed,
  };
}

export function createPostgresHumanReviewRepository({ runInTransaction } = {}) {
  return Object.freeze({
    /**
     * Human evidence-review completion: the GK reviewer's positive support-
     * strength finding on one already-committed, still-authoritative P2-01
     * evidence item. Resolves the linked `evidence_review` queue item and
     * writes evidence_items.support_strength = 'reviewed_supported' atomically,
     * with a required same-transaction metadata-only audit. Never touches
     * claim state, audience gates, or export_ready.
     */
    async completeEvidenceReview(input) {
      if (!isCompleteEvidenceReviewInput(input)) return failure("validation_blocker");
      const { organizationId, evidenceItemId, reviewQueueItemId, expectedUpdatedAt, actorUserId, now, metadataOnlyAudit } = input;
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      try {
        return await run(async (tx) => {
          const evidenceItemRow = await getScopedEvidenceItemById({ organizationId, evidenceItemId }, tx);
          if (!evidenceItemRow) return failure("not_found");

          const intakeFileId = await readLineageIntakeFileId(tx, { organizationId, evidenceItemId });
          if (!intakeFileId) return failure("conflict_current_state_changed");

          const queueRow = await updateReviewQueueCompareAndSet(tx, {
            organizationId,
            reviewQueueItemId,
            queueType: EVIDENCE_REVIEW_QUEUE_TYPE,
            targetObjectType: EVIDENCE_REVIEW_TARGET_TYPE,
            targetObjectId: evidenceItemId,
            expectedUpdatedAt,
            now,
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
            const existingEvidenceRow = await getScopedEvidenceItemById({ organizationId, evidenceItemId }, tx);
            if (
              isResolvedQueueRow(existingQueueRow) &&
              existingEvidenceRow?.support_strength === REVIEWED_SUPPORTED_STRENGTH
            ) {
              return success(toEvidenceReviewResult(existingQueueRow, evidenceItemId, REVIEWED_SUPPORTED_STRENGTH, true));
            }
            return failure("conflict_current_state_changed");
          }

          const strengthResult = await tx.query(
            `UPDATE kai.evidence_items
                SET support_strength = $1
              WHERE organization_id = $2::uuid
                AND evidence_item_id = $3::uuid
                AND support_strength = $4
              RETURNING support_strength`,
            [REVIEWED_SUPPORTED_STRENGTH, organizationId, evidenceItemId, UNASSESSED_STRENGTH],
          );
          if (strengthResult.rows.length !== 1) throw new MalformedResultRowError("evidence_items");

          const uploadState = await readScopedUploadState(tx, organizationId, intakeFileId);
          if (!uploadState) throw new MalformedResultRowError("intake_files");

          const auditMetadata = {
            metadata_only: true,
            contract: EVIDENCE_REVIEW_AUDIT_CONTRACT,
            evidence_item_id: evidenceItemId,
            review_queue_item_id: reviewQueueItemId,
            previous_queue_status: FRESH_QUEUE_STATUS,
            resulting_queue_status: RESOLVED_QUEUE_STATUS,
            previous_review_status: FRESH_REVIEW_STATUS,
            resulting_review_status: RESOLVED_REVIEW_STATUS,
            previous_support_strength: UNASSESSED_STRENGTH,
            resulting_support_strength: REVIEWED_SUPPORTED_STRENGTH,
            validator_key: EVIDENCE_REVIEW_VALIDATOR_KEY,
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

          return success(toEvidenceReviewResult(queueRow, evidenceItemId, REVIEWED_SUPPORTED_STRENGTH, false));
        });
      } catch (error) {
        return shapeError(error);
      }
    },

    /**
     * Human claim-review/internal-approval completion: only after the linked
     * P2-01 evidence item's own `evidence_review` queue item is already
     * 'resolved' (the one non-approval blocker this transition is authorized
     * to require clear first) does this resolve the claim's `claim_review`
     * queue item and write claims.claim_strength = 'reviewed_supported'
     * atomically, with a required same-transaction metadata-only audit. This
     * never writes claim_status, claim_review_status, or any audience-gate/
     * export_ready column, and never invokes P2-06/P2-08 or any generation
     * path.
     */
    async completeClaimReviewInternalApproval(input) {
      if (!isCompleteClaimReviewInput(input)) return failure("validation_blocker");
      const { organizationId, claimId, reviewQueueItemId, expectedUpdatedAt, actorUserId, now, metadataOnlyAudit } = input;
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

          const queueRow = await updateReviewQueueCompareAndSet(tx, {
            organizationId,
            reviewQueueItemId,
            queueType: CLAIM_REVIEW_QUEUE_TYPE,
            targetObjectType: CLAIM_REVIEW_TARGET_TYPE,
            targetObjectId: claimId,
            expectedUpdatedAt,
            now,
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
            const existingClaimRow = await getScopedClaimById({ organizationId, claimId }, tx);
            if (
              isResolvedQueueRow(existingQueueRow) &&
              existingClaimRow?.claim_strength === REVIEWED_SUPPORTED_STRENGTH
            ) {
              return success(toClaimReviewResult(existingQueueRow, claimId, REVIEWED_SUPPORTED_STRENGTH, true));
            }
            return failure("conflict_current_state_changed");
          }

          const strengthResult = await tx.query(
            `UPDATE kai.claims
                SET claim_strength = $1
              WHERE organization_id = $2::uuid
                AND claim_id = $3::uuid
                AND claim_strength = $4
              RETURNING claim_strength`,
            [REVIEWED_SUPPORTED_STRENGTH, organizationId, claimId, UNASSESSED_STRENGTH],
          );
          if (strengthResult.rows.length !== 1) throw new MalformedResultRowError("claims");

          const uploadState = await readScopedUploadState(tx, organizationId, intakeFileId);
          if (!uploadState) throw new MalformedResultRowError("intake_files");

          const auditMetadata = {
            metadata_only: true,
            contract: CLAIM_REVIEW_AUDIT_CONTRACT,
            claim_id: claimId,
            evidence_item_id: evidenceItemId,
            review_queue_item_id: reviewQueueItemId,
            previous_queue_status: FRESH_QUEUE_STATUS,
            resulting_queue_status: RESOLVED_QUEUE_STATUS,
            previous_review_status: FRESH_REVIEW_STATUS,
            resulting_review_status: RESOLVED_REVIEW_STATUS,
            previous_claim_strength: UNASSESSED_STRENGTH,
            resulting_claim_strength: REVIEWED_SUPPORTED_STRENGTH,
            validator_key: CLAIM_REVIEW_VALIDATOR_KEY,
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

          return success(toClaimReviewResult(queueRow, claimId, REVIEWED_SUPPORTED_STRENGTH, false));
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
});
