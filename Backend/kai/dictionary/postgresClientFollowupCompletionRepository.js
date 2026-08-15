import {
  getScopedEvidenceItemById,
  getScopedSourceLocatorById,
  getScopedSourceById,
  getScopedSourceVersionById,
  getScopedSourceCandidateByIdentity,
} from "../db/kaiIntakeQueries.js";

/**
 * KAI P2-11 client-followup-completion repository: the smallest authoritative
 * transition that lets an authorized organization-scoped `client_reviewer`
 * dispose of a CURRENT `client_followup` review-queue workflow. Per the P2-11
 * owner policy this is a workflow DISPOSITION, never a client answer: it
 * writes exactly one row - the linked `kai.review_queue_items` row's own
 * `queue_status`/`review_status`/`updated_at` - and nothing else. It never
 * touches `kai.client_followup_items` (the fixed question stays exactly as
 * P2-04 wrote it), `kai.gap_log_items` (the P2-04 gap stays open/unresolved),
 * or any P2-02 assessment_status. No client answer, free-text, or raw value is
 * ever read from the caller or persisted - the transition accepts no such
 * field.
 *
 * Mirrors P2-09's `completeEvidenceReview`
 * (Backend/kai/dictionary/postgresHumanReviewRepository.js) exactly for
 * concurrency/replay/audit shape: server-controlled actor/tenant/decision/
 * time, optimistic-concurrency compare-and-set guarded by
 * `expected_updated_at`, exact-replay idempotency (no duplicate mutation or
 * audit), and a required same-transaction metadata-only audit whose failure
 * rolls back the fresh queue-row write.
 */

const CLIENT_FOLLOWUP_COMPLETION_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  not_found: 404,
  conflict_current_state_changed: 409,
  system_error: 500,
});

const CLIENT_FOLLOWUP_QUEUE_TYPE = "client_followup";
const CLIENT_FOLLOWUP_TARGET_TYPE = "client_followup_item";

const FRESH_QUEUE_STATUS = "waiting_on_client";
const FRESH_REVIEW_STATUS = "proposed";
const RESOLVED_QUEUE_STATUS = "resolved";
const RESOLVED_REVIEW_STATUS = "resolved";

const CLIENT_FOLLOWUP_COMPLETION_DISPOSITION = "no_additional_client_information";
const CLIENT_FOLLOWUP_COMPLETION_AUDIT_CONTRACT = "p2_11_client_followup_completion_v1";
const CLIENT_FOLLOWUP_COMPLETION_AUDIT_OPERATION = "client_followup_completed";
const CLIENT_FOLLOWUP_COMPLETION_VALIDATOR_KEY = "VAL-KAI-P2-11-001";

function failure(code) {
  return { ok: false, data: null, error: { code, status: CLIENT_FOLLOWUP_COMPLETION_RESULT_STATUS[code] || 500 } };
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

async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

function isCompleteClientFollowupInput(input) {
  const allowedKeys = new Set([
    "organizationId", "claimId", "clientFollowupItemId", "expectedUpdatedAt",
    "actorUserId", "actorRole", "now", "metadataOnlyAudit",
  ]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.claimId) &&
    isNonEmptyString(input.clientFollowupItemId) &&
    isNormalizedNow(input.expectedUpdatedAt) &&
    isNonEmptyString(input.actorUserId) &&
    isNonEmptyString(input.actorRole) &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

async function readScopedClientFollowupItem(tx, { organizationId, claimId, clientFollowupItemId }) {
  const { rows } = await tx.query(
    `SELECT client_followup_item_id, organization_id, claim_id, gap_log_item_id, dimension_key
       FROM kai.client_followup_items
      WHERE organization_id = $1::uuid
        AND client_followup_item_id = $2::uuid
        AND claim_id = $3::uuid`,
    [organizationId, clientFollowupItemId, claimId],
  );
  return rows[0] || null;
}

async function readScopedGapLogItem(tx, { organizationId, gapLogItemId }) {
  const { rows } = await tx.query(
    `SELECT gap_log_item_id, organization_id, claim_id, evidence_item_id, dimension_key
       FROM kai.gap_log_items
      WHERE organization_id = $1::uuid
        AND gap_log_item_id = $2::uuid`,
    [organizationId, gapLogItemId],
  );
  return rows[0] || null;
}

async function readScopedUploadState(tx, organizationId, intakeFileId) {
  const { rows } = await tx.query(
    `SELECT upload_state
       FROM kai.intake_files
      WHERE organization_id = $1::uuid
        AND intake_file_id = $2::uuid`,
    [organizationId, intakeFileId],
  );
  return rows[0]?.upload_state ?? null;
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
  if (!sourceVersionRow) return null;
  const candidateRow = await getScopedSourceCandidateByIdentity(
    { organizationId, intakeSourceCandidateId: sourceVersionRow.intake_source_candidate_id },
    tx,
  );
  if (!candidateRow) return null;
  return candidateRow.intake_file_id;
}

async function updateReviewQueueCompareAndSet(tx, { organizationId, targetObjectId, expectedUpdatedAt, now }) {
  const { rows } = await tx.query(
    `UPDATE kai.review_queue_items
        SET queue_status = $1,
            review_status = $2,
            updated_at = $3::timestamptz
      WHERE organization_id = $4::uuid
        AND queue_type = $5
        AND target_object_type = $6
        AND target_object_id = $7::uuid
        AND queue_status = $8
        AND review_status = $9
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $10::timestamptz)
      RETURNING review_queue_item_id, organization_id, queue_type, target_object_type,
                target_object_id, queue_status, review_status, updated_at`,
    [
      RESOLVED_QUEUE_STATUS,
      RESOLVED_REVIEW_STATUS,
      now,
      organizationId,
      CLIENT_FOLLOWUP_QUEUE_TYPE,
      CLIENT_FOLLOWUP_TARGET_TYPE,
      targetObjectId,
      FRESH_QUEUE_STATUS,
      FRESH_REVIEW_STATUS,
      expectedUpdatedAt,
    ],
  );
  return rows[0] || null;
}

async function readReviewQueueItemByTarget(tx, { organizationId, targetObjectId }) {
  const { rows } = await tx.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, queue_status, review_status, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = $2
        AND target_object_type = $3
        AND target_object_id = $4::uuid`,
    [organizationId, CLIENT_FOLLOWUP_QUEUE_TYPE, CLIENT_FOLLOWUP_TARGET_TYPE, targetObjectId],
  );
  return rows[0] || null;
}

function isResolvedQueueRow(row) {
  return Boolean(row) && row.queue_status === RESOLVED_QUEUE_STATUS && row.review_status === RESOLVED_REVIEW_STATUS;
}

function toClientFollowupCompletionResult(queueRow, { clientFollowupItemId, gapLogItemId, dimensionKey }, replayed) {
  return {
    client_followup_item_id: clientFollowupItemId,
    gap_log_item_id: gapLogItemId,
    dimension_key: dimensionKey,
    review_queue_item_id: queueRow.review_queue_item_id,
    queue_status: queueRow.queue_status,
    review_status: queueRow.review_status,
    disposition: CLIENT_FOLLOWUP_COMPLETION_DISPOSITION,
    replayed,
  };
}

export function createPostgresClientFollowupCompletionRepository({ runInTransaction } = {}) {
  return Object.freeze({
    /**
     * P2-11 client-followup completion: records that the fixed follow-up
     * question was reviewed by an authorized `client_reviewer` and that no
     * additional client information is being supplied for this internal
     * workflow. Resolves the linked `client_followup` review-queue item only -
     * it never mutates the client_followup_item row, the gap_log_item row, or
     * any P2-02 assessment_status, and it accepts no answer/free-text/raw
     * value from the caller.
     */
    async completeClientFollowup(input) {
      if (!isCompleteClientFollowupInput(input)) return failure("validation_blocker");
      const {
        organizationId, claimId, clientFollowupItemId, expectedUpdatedAt,
        actorUserId, actorRole, now, metadataOnlyAudit,
      } = input;
      const run = runInTransaction || (await resolveDefaultRunInTransaction());

      try {
        return await run(async (tx) => {
          const followupRow = await readScopedClientFollowupItem(tx, { organizationId, claimId, clientFollowupItemId });
          if (!followupRow) return failure("not_found");

          const gapRow = await readScopedGapLogItem(tx, { organizationId, gapLogItemId: followupRow.gap_log_item_id });
          if (!gapRow || gapRow.claim_id !== claimId || gapRow.dimension_key !== followupRow.dimension_key) {
            return failure("conflict_current_state_changed");
          }

          const intakeFileId = await readLineageIntakeFileId(tx, {
            organizationId,
            evidenceItemId: gapRow.evidence_item_id,
          });
          if (!intakeFileId) return failure("conflict_current_state_changed");

          const queueRow = await updateReviewQueueCompareAndSet(tx, {
            organizationId,
            targetObjectId: clientFollowupItemId,
            expectedUpdatedAt,
            now,
          });

          if (!queueRow) {
            const existingQueueRow = await readReviewQueueItemByTarget(tx, { organizationId, targetObjectId: clientFollowupItemId });
            if (!existingQueueRow) return failure("not_found");
            if (isResolvedQueueRow(existingQueueRow)) {
              return success(toClientFollowupCompletionResult(existingQueueRow, {
                clientFollowupItemId,
                gapLogItemId: followupRow.gap_log_item_id,
                dimensionKey: followupRow.dimension_key,
              }, true));
            }
            return failure("conflict_current_state_changed");
          }

          const uploadState = await readScopedUploadState(tx, organizationId, intakeFileId);
          if (!uploadState) throw new MalformedResultRowError("intake_files");

          const auditMetadata = {
            metadata_only: true,
            contract: CLIENT_FOLLOWUP_COMPLETION_AUDIT_CONTRACT,
            claim_id: claimId,
            client_followup_item_id: clientFollowupItemId,
            gap_log_item_id: followupRow.gap_log_item_id,
            dimension_key: followupRow.dimension_key,
            review_queue_item_id: queueRow.review_queue_item_id,
            previous_queue_status: FRESH_QUEUE_STATUS,
            resulting_queue_status: RESOLVED_QUEUE_STATUS,
            previous_review_status: FRESH_REVIEW_STATUS,
            resulting_review_status: RESOLVED_REVIEW_STATUS,
            decided_by_role: actorRole,
            disposition: CLIENT_FOLLOWUP_COMPLETION_DISPOSITION,
            replayed: false,
            validator_key: CLIENT_FOLLOWUP_COMPLETION_VALIDATOR_KEY,
          };

          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, {
            attempted_operation: CLIENT_FOLLOWUP_COMPLETION_AUDIT_OPERATION,
            actor_type: "human",
            actor_user_id: actorUserId,
            contract: CLIENT_FOLLOWUP_COMPLETION_AUDIT_CONTRACT,
            object_type: "claim",
            claim_id: claimId,
            client_followup_item_id: clientFollowupItemId,
            dimension_key: followupRow.dimension_key,
            validator_key: CLIENT_FOLLOWUP_COMPLETION_VALIDATOR_KEY,
          }, tx);

          await tx.query(
            `INSERT INTO kai.upload_lifecycle_audit (
               organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
             )
             VALUES ($1::uuid, $2::uuid, $3, $4, $4, 'success', $5::jsonb, $6::timestamptz)`,
            [organizationId, intakeFileId, CLIENT_FOLLOWUP_COMPLETION_AUDIT_OPERATION, uploadState, JSON.stringify(auditMetadata), now],
          );

          await preparedAudit.publish();

          return success(toClientFollowupCompletionResult(queueRow, {
            clientFollowupItemId,
            gapLogItemId: followupRow.gap_log_item_id,
            dimensionKey: followupRow.dimension_key,
          }, false));
        });
      } catch (error) {
        return shapeError(error);
      }
    },
  });
}

export const __clientFollowupCompletionRepositoryContract = Object.freeze({
  CLIENT_FOLLOWUP_QUEUE_TYPE,
  CLIENT_FOLLOWUP_TARGET_TYPE,
  FRESH_QUEUE_STATUS,
  FRESH_REVIEW_STATUS,
  RESOLVED_QUEUE_STATUS,
  RESOLVED_REVIEW_STATUS,
  CLIENT_FOLLOWUP_COMPLETION_DISPOSITION,
  CLIENT_FOLLOWUP_COMPLETION_AUDIT_OPERATION,
});

export const __clientFollowupCompletionRepositoryTestables = Object.freeze({
  MalformedResultRowError,
  RequiredAuditRejectedError,
  isCompleteClientFollowupInput,
});
