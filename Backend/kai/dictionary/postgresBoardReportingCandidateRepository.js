import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";
import { composeBoardReportingRenderModel } from "../services/kaiBoardReportingPacketRenderModelService.js";
import { composeBoardReportingPacketFingerprint } from "../services/kaiBoardReportingPacketFingerprintService.js";
import {
  BOARD_REPORTING_CANDIDATE_AUDIENCE,
  BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION,
  BOARD_REPORTING_CANDIDATE_CREATED_OPERATION,
  BOARD_REPORTING_CANDIDATE_AUDIT_CONTRACT,
  BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT,
  BOARD_REPORTING_CANDIDATE_REVIEW_REQUESTED_OPERATION,
  BOARD_REPORTING_CANDIDATE_REVIEW_LIFECYCLE_PROFILES,
  BOARD_REPORTING_CANDIDATE_REVIEW_STARTED_OPERATION,
  BOARD_REPORTING_CANDIDATE_REVIEW_COMPLETED_OPERATION,
} from "./boardReportingCandidateContract.js";

const BOARD_REPORTING_CANDIDATE_REVIEW_REQUEST_PROFILE = BOARD_REPORTING_CANDIDATE_REVIEW_LIFECYCLE_PROFILES[0];
const BOARD_REPORTING_CANDIDATE_REVIEW_START_PROFILE = BOARD_REPORTING_CANDIDATE_REVIEW_LIFECYCLE_PROFILES[1];
const BOARD_REPORTING_CANDIDATE_REVIEW_COMPLETE_PROFILE = BOARD_REPORTING_CANDIDATE_REVIEW_LIFECYCLE_PROFILES[2];

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  not_found: 404,
  conflict_current_state_changed: 409,
  system_error: 500,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
}

function success(data) {
  return { ok: true, data, error: null };
}

export class BoardReportingCandidateRollbackResultError extends Error {
  constructor(result) {
    super("rollback board-reporting-candidate transaction");
    this.name = "BoardReportingCandidateRollbackResultError";
    this.result = result;
  }
}

function rollbackFailure(code) {
  throw new BoardReportingCandidateRollbackResultError(failure(code));
}

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isCreateBoardReportingCandidateInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "engagementId", "idempotencyKey", "actorContext", "now"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)
    && isMappedHumanActor(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

function isReadBoardReportingCandidateInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "engagementId", "boardReportingCandidateId"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.boardReportingCandidateId);
}

function isRequestBoardReportingCandidateReviewInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "boardReportingCandidateId",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.boardReportingCandidateId)
    && isMappedHumanActor(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

function isStartBoardReportingCandidateReviewInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "boardReportingCandidateId",
    "reviewQueueItemId",
    "expectedUpdatedAt",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.boardReportingCandidateId)
    && UUID_PATTERN.test(input.reviewQueueItemId)
    && isCanonicalUtcTimestamp(input.expectedUpdatedAt)
    && isMappedHumanActor(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

// COMPLETE input contract: identical shape to START (organizationId +
// engagementId + boardReportingCandidateId + reviewQueueItemId +
// expectedUpdatedAt + actorContext + now), and nothing else - no
// membership, fingerprint, release authority, final eligibility, manifest,
// or delivery field is ever accepted from a caller.
function isCompleteBoardReportingCandidateReviewInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "boardReportingCandidateId",
    "reviewQueueItemId",
    "expectedUpdatedAt",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.boardReportingCandidateId)
    && UUID_PATTERN.test(input.reviewQueueItemId)
    && isCanonicalUtcTimestamp(input.expectedUpdatedAt)
    && isMappedHumanActor(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

async function defaultComposeRenderModel(input, dependencies) {
  return composeBoardReportingRenderModel(
    { organizationId: input.organizationId, engagementId: input.engagementId, actorContext: input.actorContext },
    dependencies,
  );
}

async function ensureEngagementBelongsToTenant(tx, { organizationId, engagementId }) {
  const { rows } = await tx.query(
    `SELECT 1
       FROM kai.engagements
      WHERE organization_id = $1::uuid AND engagement_id = $2::uuid`,
    [organizationId, engagementId],
  );
  return Boolean(rows[0]);
}

async function insertCandidate(tx, { candidateId, organizationId, engagementId, idempotencyKey, fingerprint, actorContext, now }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.board_reporting_candidates (
       board_reporting_candidate_id, organization_id, engagement_id, packet_audience,
       idempotency_key, fingerprint_contract_version, canonical_fingerprint,
       candidate_status, created_by, created_by_type, created_at
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,'created',$8::uuid,'human',$9::timestamptz)
     ON CONFLICT (organization_id, engagement_id, idempotency_key) DO NOTHING
     RETURNING board_reporting_candidate_id::text AS board_reporting_candidate_id`,
    [
      candidateId,
      organizationId,
      engagementId,
      BOARD_REPORTING_CANDIDATE_AUDIENCE,
      idempotencyKey,
      BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION,
      fingerprint,
      actorContext.actorUserId,
      now,
    ],
  );
  return rows[0] || null;
}

async function loadCandidateByIdempotencyKey(tx, { organizationId, engagementId, idempotencyKey }) {
  const { rows } = await tx.query(
    `SELECT board_reporting_candidate_id::text AS board_reporting_candidate_id,
            canonical_fingerprint,
            fingerprint_contract_version,
            packet_audience,
            candidate_status
       FROM kai.board_reporting_candidates
      WHERE organization_id = $1::uuid
        AND engagement_id = $2::uuid
        AND idempotency_key = $3`,
    [organizationId, engagementId, idempotencyKey],
  );
  return rows[0] || null;
}

async function insertCandidateMembers(tx, { organizationId, candidateId, orderedGeneratedContentDraftIds, now }) {
  for (let ordinal = 0; ordinal < orderedGeneratedContentDraftIds.length; ordinal += 1) {
    await tx.query(
      `INSERT INTO kai.board_reporting_candidate_members (
         board_reporting_candidate_id, organization_id, generated_content_draft_id, ordinal, created_at
       )
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::timestamptz)`,
      [candidateId, organizationId, orderedGeneratedContentDraftIds[ordinal], ordinal, now],
    );
  }
}

async function loadCandidateMembers(tx, { organizationId, candidateId }) {
  const { rows } = await tx.query(
    `SELECT board_reporting_candidate_member_id::text AS board_reporting_candidate_member_id,
            generated_content_draft_id::text AS generated_content_draft_id,
            ordinal,
            created_at
       FROM kai.board_reporting_candidate_members
      WHERE organization_id = $1::uuid AND board_reporting_candidate_id = $2::uuid
      ORDER BY ordinal ASC`,
    [organizationId, candidateId],
  );
  return rows;
}

async function loadCandidateForRead(tx, { organizationId, engagementId, boardReportingCandidateId }) {
  const { rows } = await tx.query(
    `SELECT board_reporting_candidate_id::text AS board_reporting_candidate_id,
            organization_id::text AS organization_id,
            engagement_id::text AS engagement_id,
            packet_audience,
            idempotency_key,
            fingerprint_contract_version,
            canonical_fingerprint,
            candidate_status,
            created_by::text AS created_by,
            created_by_type,
            created_at
       FROM kai.board_reporting_candidates
      WHERE organization_id = $1::uuid
        AND engagement_id = $2::uuid
        AND board_reporting_candidate_id = $3::uuid`,
    [organizationId, engagementId, boardReportingCandidateId],
  );
  return rows[0] || null;
}

// Exported for reuse by BR-04's postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js
// (and any other same-package caller) - the BR-04 human authority ledger
// binds to this exact, existing, immutable BR-02 candidate row and must
// never duplicate this SELECT.
export async function loadBoardReportingCandidateForReview(tx, { organizationId, engagementId, boardReportingCandidateId }) {
  const { rows } = await tx.query(
    `SELECT board_reporting_candidate_id::text AS board_reporting_candidate_id,
            organization_id::text AS organization_id,
            engagement_id::text AS engagement_id,
            canonical_fingerprint,
            fingerprint_contract_version,
            packet_audience,
            candidate_status
       FROM kai.board_reporting_candidates
      WHERE organization_id = $1::uuid
        AND engagement_id = $2::uuid
        AND board_reporting_candidate_id = $3::uuid`,
    [organizationId, engagementId, boardReportingCandidateId],
  );
  return rows[0] || null;
}

async function insertBoardReportingCandidateReviewQueueRow(tx, {
  reviewQueueItemId,
  organizationId,
  engagementId,
  boardReportingCandidateId,
}) {
  const contract = BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT;
  const { rows } = await tx.query(
    `INSERT INTO kai.review_queue_items (
       review_queue_item_id, organization_id, engagement_id, queue_type, target_object_type, target_object_id,
       priority, queue_status, review_status, summary, required_action, queue_metadata, created_by, created_by_type
     )
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7,'open','needs_gk_review',$8,$9,'{}'::jsonb,NULL,$10)
     ON CONFLICT (organization_id, queue_type, target_object_type, target_object_id)
       WHERE queue_type = 'board_reporting_candidate_review'
     DO NOTHING
     RETURNING review_queue_item_id::text AS review_queue_item_id, queue_status, review_status, updated_at`,
    [
      reviewQueueItemId,
      organizationId,
      engagementId,
      contract.queueType,
      contract.targetObjectType,
      boardReportingCandidateId,
      contract.priority,
      contract.summary,
      contract.requiredAction,
      contract.createdByType,
    ],
  );
  return rows[0] || null;
}

async function loadBoardReportingCandidateReviewQueueRow(tx, { organizationId, boardReportingCandidateId }) {
  const contract = BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT;
  const { rows } = await tx.query(
    `SELECT review_queue_item_id::text AS review_queue_item_id,
            organization_id::text AS organization_id,
            engagement_id::text AS engagement_id,
            queue_type,
            target_object_type,
            target_object_id::text AS target_object_id,
            priority,
            queue_status,
            review_status,
            summary,
            required_action,
            blocked_reason,
            assigned_to::text AS assigned_to,
            due_at,
            queue_metadata,
            created_by::text AS created_by,
            created_by_type,
            updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = $2
        AND target_object_type = $3
        AND target_object_id = $4::uuid`,
    [organizationId, contract.queueType, contract.targetObjectType, boardReportingCandidateId],
  );
  return rows[0] || null;
}

// Exported for reuse by BR-04's postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js -
// the same binding/profile check the BR-03B lifecycle transitions already
// use, reused unchanged so BR-04 never re-implements its own notion of
// which (queue_status, review_status) pairs are valid for this queue_type.
export function isValidBoardReportingCandidateReviewQueueRowForProfiles(row, {
  organizationId,
  engagementId,
  boardReportingCandidateId,
  allowedProfiles,
}) {
  const contract = BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT;
  if (!row) return false;
  if (row.organization_id !== organizationId) return false;
  if (row.engagement_id !== engagementId) return false;
  if (row.target_object_id !== boardReportingCandidateId) return false;
  if (row.queue_type !== contract.queueType) return false;
  if (row.target_object_type !== contract.targetObjectType) return false;
  if (row.priority !== contract.priority) return false;
  if (!allowedProfiles.some(
    (profile) => row.queue_status === profile.queueStatus && row.review_status === profile.reviewStatus,
  )) return false;
  if (row.summary !== contract.summary) return false;
  if (row.required_action !== contract.requiredAction) return false;
  if (row.blocked_reason !== null) return false;
  if (row.assigned_to !== null) return false;
  if (row.due_at !== null) return false;
  if (row.created_by !== null) return false;
  if (row.created_by_type !== contract.createdByType) return false;
  if (!row.queue_metadata || typeof row.queue_metadata !== "object" || Array.isArray(row.queue_metadata)) return false;
  return Object.keys(row.queue_metadata).length === 0;
}

function isValidBoardReportingCandidateReviewQueueRow(row, { organizationId, engagementId, boardReportingCandidateId }) {
  return isValidBoardReportingCandidateReviewQueueRowForProfiles(row, {
    organizationId,
    engagementId,
    boardReportingCandidateId,
    allowedProfiles: [BOARD_REPORTING_CANDIDATE_REVIEW_REQUEST_PROFILE],
  });
}

// Exported for reuse by BR-04's postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js -
// loads the review_queue_items row by its own id (rather than by
// target_object_id) so BR-04 can bind and verify the exact reviewQueueItemId
// the caller supplied.
export async function loadBoardReportingCandidateReviewQueueRowById(tx, { organizationId, reviewQueueItemId }) {
  const { rows } = await tx.query(
    `SELECT review_queue_item_id::text AS review_queue_item_id,
            organization_id::text AS organization_id,
            engagement_id::text AS engagement_id,
            queue_type,
            target_object_type,
            target_object_id::text AS target_object_id,
            priority,
            queue_status,
            review_status,
            summary,
            required_action,
            blocked_reason,
            assigned_to::text AS assigned_to,
            due_at,
            queue_metadata,
            created_by::text AS created_by,
            created_by_type,
            updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND review_queue_item_id = $2::uuid`,
    [organizationId, reviewQueueItemId],
  );
  return rows[0] || null;
}

async function findMatchingBoardReportingCandidateReviewStartAudit(tx, {
  organizationId,
  boardReportingCandidateId,
  reviewQueueItemId,
  expectedUpdatedAt,
}) {
  const { rows } = await tx.query(
    `SELECT metadata
       FROM kai.audit_events
      WHERE organization_id = $1::uuid
        AND action = $2
        AND metadata->>'board_reporting_candidate_id' = $3
        AND metadata->>'review_queue_item_id' = $4`,
    [organizationId, BOARD_REPORTING_CANDIDATE_REVIEW_STARTED_OPERATION, boardReportingCandidateId, reviewQueueItemId],
  );
  const matches = rows.filter((row) => {
    const metadata = row.metadata;
    return metadata
      && metadata.previous_queue_status === BOARD_REPORTING_CANDIDATE_REVIEW_REQUEST_PROFILE.queueStatus
      && metadata.resulting_queue_status === BOARD_REPORTING_CANDIDATE_REVIEW_START_PROFILE.queueStatus
      && metadata.previous_review_status === BOARD_REPORTING_CANDIDATE_REVIEW_REQUEST_PROFILE.reviewStatus
      && metadata.resulting_review_status === BOARD_REPORTING_CANDIDATE_REVIEW_START_PROFILE.reviewStatus
      && metadata.expected_updated_at === expectedUpdatedAt;
  });
  return matches.length === 1;
}

async function findMatchingBoardReportingCandidateReviewCompleteAudit(tx, {
  organizationId,
  boardReportingCandidateId,
  reviewQueueItemId,
  expectedUpdatedAt,
}) {
  const { rows } = await tx.query(
    `SELECT metadata
       FROM kai.audit_events
      WHERE organization_id = $1::uuid
        AND action = $2
        AND metadata->>'board_reporting_candidate_id' = $3
        AND metadata->>'review_queue_item_id' = $4`,
    [organizationId, BOARD_REPORTING_CANDIDATE_REVIEW_COMPLETED_OPERATION, boardReportingCandidateId, reviewQueueItemId],
  );
  const matches = rows.filter((row) => {
    const metadata = row.metadata;
    return metadata
      && metadata.previous_queue_status === BOARD_REPORTING_CANDIDATE_REVIEW_START_PROFILE.queueStatus
      && metadata.resulting_queue_status === BOARD_REPORTING_CANDIDATE_REVIEW_COMPLETE_PROFILE.queueStatus
      && metadata.previous_review_status === BOARD_REPORTING_CANDIDATE_REVIEW_START_PROFILE.reviewStatus
      && metadata.resulting_review_status === BOARD_REPORTING_CANDIDATE_REVIEW_COMPLETE_PROFILE.reviewStatus
      && metadata.expected_updated_at === expectedUpdatedAt;
  });
  return matches.length === 1;
}

function asCanonicalUtcTimestamp(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function fingerprintRenderModel(renderModel) {
  const { fingerprint, orderedGeneratedContentDraftIds, error } =
    composeBoardReportingPacketFingerprint(renderModel);
  if (!fingerprint) {
    const isExpectedBlocker = error === "not_internal_audience" || error === "no_eligible_members";
    return { ok: false, code: isExpectedBlocker ? "validation_blocker" : "system_error" };
  }
  return { ok: true, fingerprint, orderedGeneratedContentDraftIds };
}

export function createPostgresBoardReportingCandidateRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    async createBoardReportingCandidate(input, dependencies = {}) {
      if (!isCreateBoardReportingCandidateInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      const composeRenderModel = dependencies.composeRenderModel || defaultComposeRenderModel;
      const preflightRenderModel = await composeRenderModel(input, dependencies.renderModelDependencies || dependencies);
      if (!preflightRenderModel?.ok) {
        return { ok: false, data: null, error: preflightRenderModel?.error || { code: "system_error", status: 500 } };
      }
      const preflightFingerprint = fingerprintRenderModel(preflightRenderModel.data);
      if (!preflightFingerprint.ok) return failure(preflightFingerprint.code);

      try {
        return await runInTransaction(async (tx) => {
          if (!(await ensureEngagementBelongsToTenant(tx, input))) rollbackFailure("not_found");

          const currentRenderModel = await composeRenderModel(input, dependencies.renderModelDependencies || dependencies);
          if (!currentRenderModel?.ok) rollbackFailure(currentRenderModel?.error?.code || "system_error");
          const currentFingerprint = fingerprintRenderModel(currentRenderModel.data);
          if (!currentFingerprint.ok) rollbackFailure(currentFingerprint.code);
          if (currentFingerprint.fingerprint !== preflightFingerprint.fingerprint) {
            rollbackFailure("conflict_current_state_changed");
          }

          const candidateId = crypto.randomUUID();
          const inserted = await insertCandidate(tx, {
            candidateId,
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            idempotencyKey: input.idempotencyKey,
            fingerprint: currentFingerprint.fingerprint,
            actorContext: input.actorContext,
            now: input.now,
          });

          let boardReportingCandidateId;
          let members;
          let replayed;
          if (inserted) {
            boardReportingCandidateId = inserted.board_reporting_candidate_id;
            await insertCandidateMembers(tx, {
              organizationId: input.organizationId,
              candidateId: boardReportingCandidateId,
              orderedGeneratedContentDraftIds: currentFingerprint.orderedGeneratedContentDraftIds,
              now: input.now,
            });
            members = currentFingerprint.orderedGeneratedContentDraftIds;
            replayed = false;
          } else {
            const existing = await loadCandidateByIdempotencyKey(tx, input);
            if (!existing) rollbackFailure("system_error");
            if (
              existing.canonical_fingerprint !== currentFingerprint.fingerprint
              || existing.packet_audience !== BOARD_REPORTING_CANDIDATE_AUDIENCE
              || existing.fingerprint_contract_version !== BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION
              || existing.candidate_status !== "created"
            ) {
              rollbackFailure("conflict_current_state_changed");
            }
            boardReportingCandidateId = existing.board_reporting_candidate_id;
            const existingMembers = await loadCandidateMembers(tx, {
              organizationId: input.organizationId,
              candidateId: boardReportingCandidateId,
            });
            members = existingMembers.map((row) => row.generated_content_draft_id);
            if (members.length !== currentFingerprint.orderedGeneratedContentDraftIds.length
              || members.some((member, index) => member !== currentFingerprint.orderedGeneratedContentDraftIds[index])) {
              rollbackFailure("conflict_current_state_changed");
            }
            replayed = true;
          }

          if (!replayed) {
            const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
              payload: {
                attempted_operation: BOARD_REPORTING_CANDIDATE_CREATED_OPERATION,
                actor_type: "human",
                object_type: "board_reporting_candidate",
                contract: BOARD_REPORTING_CANDIDATE_AUDIT_CONTRACT,
                board_reporting_candidate_id: boardReportingCandidateId,
                engagement_id: input.engagementId,
                canonical_fingerprint: currentFingerprint.fingerprint,
                member_count: members.length,
              },
              db: tx,
            });
            if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
              rollbackFailure("system_error");
            }
            await preparedAudit.publish();
          }

          return success({
            boardReportingCandidateId,
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            packetAudience: BOARD_REPORTING_CANDIDATE_AUDIENCE,
            fingerprintContractVersion: BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION,
            canonicalFingerprint: currentFingerprint.fingerprint,
            memberGeneratedContentDraftIds: members,
            replayed,
          });
        });
      } catch (error) {
        if (error instanceof BoardReportingCandidateRollbackResultError) return error.result;
        if (error?.code === "23505") return failure("conflict_current_state_changed");
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") return failure("validation_blocker");
        return failure("system_error");
      }
    },

    async readBoardReportingCandidate(input) {
      if (!isReadBoardReportingCandidateInput(input)) return failure("validation_blocker");
      try {
        return await runInTransaction(async (tx) => {
          await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
          const candidate = await loadCandidateForRead(tx, input);
          if (!candidate) return failure("not_found");
          const members = await loadCandidateMembers(tx, {
            organizationId: input.organizationId,
            candidateId: input.boardReportingCandidateId,
          });
          return success({
            boardReportingCandidateId: candidate.board_reporting_candidate_id,
            organizationId: candidate.organization_id,
            engagementId: candidate.engagement_id,
            packetAudience: candidate.packet_audience,
            idempotencyKey: candidate.idempotency_key,
            fingerprintContractVersion: candidate.fingerprint_contract_version,
            canonicalFingerprint: candidate.canonical_fingerprint,
            candidateStatus: candidate.candidate_status,
            createdBy: candidate.created_by,
            createdByType: candidate.created_by_type,
            createdAt: candidate.created_at instanceof Date ? candidate.created_at.toISOString() : new Date(candidate.created_at).toISOString(),
            members: members.map((member) => ({
              boardReportingCandidateMemberId: member.board_reporting_candidate_member_id,
              generatedContentDraftId: member.generated_content_draft_id,
              ordinal: member.ordinal,
              createdAt: member.created_at instanceof Date ? member.created_at.toISOString() : new Date(member.created_at).toISOString(),
            })),
          });
        });
      } catch (error) {
        if (error instanceof BoardReportingCandidateRollbackResultError) return error.result;
        if (error?.code === "22P02") return failure("validation_blocker");
        return failure("system_error");
      }
    },

    async requestBoardReportingCandidateReview(input, dependencies = {}) {
      if (!isRequestBoardReportingCandidateReviewInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const candidate = await loadBoardReportingCandidateForReview(tx, input);
          if (!candidate) rollbackFailure("not_found");
          if (
            candidate.packet_audience !== BOARD_REPORTING_CANDIDATE_AUDIENCE
            || candidate.fingerprint_contract_version !== BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION
            || candidate.candidate_status !== "created"
          ) {
            rollbackFailure("conflict_current_state_changed");
          }

          const reviewQueueItemId = crypto.randomUUID();
          const inserted = await insertBoardReportingCandidateReviewQueueRow(tx, {
            reviewQueueItemId,
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            boardReportingCandidateId: input.boardReportingCandidateId,
          });

          let queueRow;
          let replayed;
          if (inserted) {
            queueRow = inserted;
            replayed = false;
          } else {
            const existing = await loadBoardReportingCandidateReviewQueueRow(tx, {
              organizationId: input.organizationId,
              boardReportingCandidateId: input.boardReportingCandidateId,
            });
            if (!isValidBoardReportingCandidateReviewQueueRow(existing, input)) {
              rollbackFailure("conflict_current_state_changed");
            }
            queueRow = existing;
            replayed = true;
          }

          if (!replayed) {
            const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
              payload: {
                attempted_operation: BOARD_REPORTING_CANDIDATE_REVIEW_REQUESTED_OPERATION,
                actor_type: "human",
                object_type: "board_reporting_candidate",
                board_reporting_candidate_id: input.boardReportingCandidateId,
                engagement_id: input.engagementId,
                review_queue_item_id: queueRow.review_queue_item_id,
                canonical_fingerprint: candidate.canonical_fingerprint,
                previous_queue_status: null,
                resulting_queue_status: "open",
                previous_review_status: null,
                resulting_review_status: "needs_gk_review",
              },
              db: tx,
            });
            if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
              rollbackFailure("system_error");
            }
            await preparedAudit.publish();
          }

          return success({
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            boardReportingCandidateId: input.boardReportingCandidateId,
            canonicalFingerprint: candidate.canonical_fingerprint,
            reviewQueueItemId: queueRow.review_queue_item_id,
            queueStatus: queueRow.queue_status,
            reviewStatus: queueRow.review_status,
            reviewUpdatedAt: asCanonicalUtcTimestamp(queueRow.updated_at),
            replayed,
          });
        });
      } catch (error) {
        if (error instanceof BoardReportingCandidateRollbackResultError) return error.result;
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
          return failure("validation_blocker");
        }
        return failure("system_error");
      }
    },

    async startBoardReportingCandidateReview(input, dependencies = {}) {
      if (!isStartBoardReportingCandidateReviewInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const candidate = await loadBoardReportingCandidateForReview(tx, input);
          if (!candidate) rollbackFailure("not_found");
          if (
            candidate.packet_audience !== BOARD_REPORTING_CANDIDATE_AUDIENCE
            || candidate.fingerprint_contract_version !== BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION
            || candidate.candidate_status !== "created"
          ) {
            rollbackFailure("conflict_current_state_changed");
          }

          const queueRow = await loadBoardReportingCandidateReviewQueueRowById(tx, {
            organizationId: input.organizationId,
            reviewQueueItemId: input.reviewQueueItemId,
          });
          if (!queueRow) rollbackFailure("not_found");
          if (
            queueRow.engagement_id !== input.engagementId
            || queueRow.target_object_type !== BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT.targetObjectType
            || queueRow.target_object_id !== input.boardReportingCandidateId
            || queueRow.queue_type !== BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT.queueType
          ) {
            rollbackFailure("conflict_current_state_changed");
          }

          const updateResult = await tx.query(
            `UPDATE kai.review_queue_items
                SET queue_status = $1,
                    updated_at = $2::timestamptz
              WHERE organization_id = $3::uuid
                AND review_queue_item_id = $4::uuid
                AND engagement_id = $5::uuid
                AND queue_type = $6
                AND target_object_type = $7
                AND target_object_id = $8::uuid
                AND queue_status = $9
                AND review_status = $10
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $11::timestamptz)
              RETURNING review_queue_item_id::text AS review_queue_item_id, queue_status, review_status, updated_at`,
            [
              BOARD_REPORTING_CANDIDATE_REVIEW_START_PROFILE.queueStatus,
              input.now,
              input.organizationId,
              input.reviewQueueItemId,
              input.engagementId,
              BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT.queueType,
              BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT.targetObjectType,
              input.boardReportingCandidateId,
              BOARD_REPORTING_CANDIDATE_REVIEW_REQUEST_PROFILE.queueStatus,
              BOARD_REPORTING_CANDIDATE_REVIEW_REQUEST_PROFILE.reviewStatus,
              input.expectedUpdatedAt,
            ],
          );

          let resultRow;
          let replayed;
          if (updateResult.rowCount === 1) {
            resultRow = updateResult.rows[0];
            replayed = false;
          } else {
            const postWriteRow = await loadBoardReportingCandidateReviewQueueRowById(tx, {
              organizationId: input.organizationId,
              reviewQueueItemId: input.reviewQueueItemId,
            });
            if (!isValidBoardReportingCandidateReviewQueueRowForProfiles(postWriteRow, {
              organizationId: input.organizationId,
              engagementId: input.engagementId,
              boardReportingCandidateId: input.boardReportingCandidateId,
              allowedProfiles: [BOARD_REPORTING_CANDIDATE_REVIEW_START_PROFILE],
            })) {
              rollbackFailure("conflict_current_state_changed");
            }
            const hasMatchingAudit = await findMatchingBoardReportingCandidateReviewStartAudit(tx, {
              organizationId: input.organizationId,
              boardReportingCandidateId: input.boardReportingCandidateId,
              reviewQueueItemId: input.reviewQueueItemId,
              expectedUpdatedAt: input.expectedUpdatedAt,
            });
            if (!hasMatchingAudit) rollbackFailure("conflict_current_state_changed");
            resultRow = postWriteRow;
            replayed = true;
          }

          if (!replayed) {
            const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
              payload: {
                attempted_operation: BOARD_REPORTING_CANDIDATE_REVIEW_STARTED_OPERATION,
                actor_type: "human",
                object_type: "board_reporting_candidate",
                board_reporting_candidate_id: input.boardReportingCandidateId,
                engagement_id: input.engagementId,
                review_queue_item_id: input.reviewQueueItemId,
                canonical_fingerprint: candidate.canonical_fingerprint,
                previous_queue_status: BOARD_REPORTING_CANDIDATE_REVIEW_REQUEST_PROFILE.queueStatus,
                resulting_queue_status: BOARD_REPORTING_CANDIDATE_REVIEW_START_PROFILE.queueStatus,
                previous_review_status: BOARD_REPORTING_CANDIDATE_REVIEW_REQUEST_PROFILE.reviewStatus,
                resulting_review_status: BOARD_REPORTING_CANDIDATE_REVIEW_START_PROFILE.reviewStatus,
                expected_updated_at: input.expectedUpdatedAt,
              },
              db: tx,
            });
            if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
              rollbackFailure("system_error");
            }
            await preparedAudit.publish();
          }

          return success({
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            boardReportingCandidateId: input.boardReportingCandidateId,
            canonicalFingerprint: candidate.canonical_fingerprint,
            reviewQueueItemId: input.reviewQueueItemId,
            queueStatus: resultRow.queue_status,
            reviewStatus: resultRow.review_status,
            reviewUpdatedAt: asCanonicalUtcTimestamp(resultRow.updated_at),
            replayed,
          });
        });
      } catch (error) {
        if (error instanceof BoardReportingCandidateRollbackResultError) return error.result;
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
          return failure("validation_blocker");
        }
        return failure("system_error");
      }
    },

    async completeBoardReportingCandidateReview(input, dependencies = {}) {
      if (!isCompleteBoardReportingCandidateReviewInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const candidate = await loadBoardReportingCandidateForReview(tx, input);
          if (!candidate) rollbackFailure("not_found");
          if (
            candidate.packet_audience !== BOARD_REPORTING_CANDIDATE_AUDIENCE
            || candidate.fingerprint_contract_version !== BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION
            || candidate.candidate_status !== "created"
          ) {
            rollbackFailure("conflict_current_state_changed");
          }

          const queueRow = await loadBoardReportingCandidateReviewQueueRowById(tx, {
            organizationId: input.organizationId,
            reviewQueueItemId: input.reviewQueueItemId,
          });
          if (!queueRow) rollbackFailure("not_found");
          if (
            queueRow.engagement_id !== input.engagementId
            || queueRow.target_object_type !== BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT.targetObjectType
            || queueRow.target_object_id !== input.boardReportingCandidateId
            || queueRow.queue_type !== BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT.queueType
          ) {
            rollbackFailure("conflict_current_state_changed");
          }

          const updateResult = await tx.query(
            `UPDATE kai.review_queue_items
                SET queue_status = $1,
                    review_status = $2,
                    updated_at = $3::timestamptz
              WHERE organization_id = $4::uuid
                AND review_queue_item_id = $5::uuid
                AND engagement_id = $6::uuid
                AND queue_type = $7
                AND target_object_type = $8
                AND target_object_id = $9::uuid
                AND queue_status = $10
                AND review_status = $11
                AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $12::timestamptz)
              RETURNING review_queue_item_id::text AS review_queue_item_id, queue_status, review_status, updated_at`,
            [
              BOARD_REPORTING_CANDIDATE_REVIEW_COMPLETE_PROFILE.queueStatus,
              BOARD_REPORTING_CANDIDATE_REVIEW_COMPLETE_PROFILE.reviewStatus,
              input.now,
              input.organizationId,
              input.reviewQueueItemId,
              input.engagementId,
              BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT.queueType,
              BOARD_REPORTING_CANDIDATE_REVIEW_QUEUE_STATIC_CONTRACT.targetObjectType,
              input.boardReportingCandidateId,
              BOARD_REPORTING_CANDIDATE_REVIEW_START_PROFILE.queueStatus,
              BOARD_REPORTING_CANDIDATE_REVIEW_START_PROFILE.reviewStatus,
              input.expectedUpdatedAt,
            ],
          );

          let resultRow;
          let replayed;
          if (updateResult.rowCount === 1) {
            resultRow = updateResult.rows[0];
            replayed = false;
          } else {
            const postWriteRow = await loadBoardReportingCandidateReviewQueueRowById(tx, {
              organizationId: input.organizationId,
              reviewQueueItemId: input.reviewQueueItemId,
            });
            if (!isValidBoardReportingCandidateReviewQueueRowForProfiles(postWriteRow, {
              organizationId: input.organizationId,
              engagementId: input.engagementId,
              boardReportingCandidateId: input.boardReportingCandidateId,
              allowedProfiles: [BOARD_REPORTING_CANDIDATE_REVIEW_COMPLETE_PROFILE],
            })) {
              rollbackFailure("conflict_current_state_changed");
            }
            const hasMatchingAudit = await findMatchingBoardReportingCandidateReviewCompleteAudit(tx, {
              organizationId: input.organizationId,
              boardReportingCandidateId: input.boardReportingCandidateId,
              reviewQueueItemId: input.reviewQueueItemId,
              expectedUpdatedAt: input.expectedUpdatedAt,
            });
            if (!hasMatchingAudit) rollbackFailure("conflict_current_state_changed");
            resultRow = postWriteRow;
            replayed = true;
          }

          if (!replayed) {
            const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
              payload: {
                attempted_operation: BOARD_REPORTING_CANDIDATE_REVIEW_COMPLETED_OPERATION,
                actor_type: "human",
                object_type: "board_reporting_candidate",
                board_reporting_candidate_id: input.boardReportingCandidateId,
                engagement_id: input.engagementId,
                review_queue_item_id: input.reviewQueueItemId,
                canonical_fingerprint: candidate.canonical_fingerprint,
                previous_queue_status: BOARD_REPORTING_CANDIDATE_REVIEW_START_PROFILE.queueStatus,
                resulting_queue_status: BOARD_REPORTING_CANDIDATE_REVIEW_COMPLETE_PROFILE.queueStatus,
                previous_review_status: BOARD_REPORTING_CANDIDATE_REVIEW_START_PROFILE.reviewStatus,
                resulting_review_status: BOARD_REPORTING_CANDIDATE_REVIEW_COMPLETE_PROFILE.reviewStatus,
                expected_updated_at: input.expectedUpdatedAt,
              },
              db: tx,
            });
            if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
              rollbackFailure("system_error");
            }
            await preparedAudit.publish();
          }

          return success({
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            boardReportingCandidateId: input.boardReportingCandidateId,
            canonicalFingerprint: candidate.canonical_fingerprint,
            reviewQueueItemId: input.reviewQueueItemId,
            queueStatus: resultRow.queue_status,
            reviewStatus: resultRow.review_status,
            reviewUpdatedAt: asCanonicalUtcTimestamp(resultRow.updated_at),
            replayed,
          });
        });
      } catch (error) {
        if (error instanceof BoardReportingCandidateRollbackResultError) return error.result;
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") {
          return failure("validation_blocker");
        }
        return failure("system_error");
      }
    },
  });
}

export const __boardReportingCandidateRepositoryTestables = Object.freeze({
  isCreateBoardReportingCandidateInput,
  isReadBoardReportingCandidateInput,
  isRequestBoardReportingCandidateReviewInput,
  isStartBoardReportingCandidateReviewInput,
  isCompleteBoardReportingCandidateReviewInput,
  fingerprintRenderModel,
});
