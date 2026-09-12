import crypto from "node:crypto";

import { withTransaction } from "../db/kaiDb.js";
import {
  loadBoardReportingCandidateForReview,
  loadBoardReportingCandidateReviewQueueRowById,
  isValidBoardReportingCandidateReviewQueueRowForProfiles,
} from "./postgresBoardReportingCandidateRepository.js";
import { BOARD_REPORTING_CANDIDATE_AUDIENCE } from "./boardReportingCandidateContract.js";
import {
  BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_TYPES,
  roleRequiredForBoardReportingCandidateHumanAuthorityDecisionType,
} from "./boardReportingCandidateHumanAuthorityDecisionContract.js";

// ---------------------------------------------------------------------------
// BR-04: Board Reporting candidate human final-release authority decision
// persistence. Same semantic decision family as the existing P3-17
// kai.human_authority_decisions ledger and the existing P14-07B1
// kai.grant_response_packet_human_authority_decisions ledger
// (export_authority_granted / grant / revoke / append-only supersession
// lineage / gk_admin-only), bound instead to an exact, existing, immutable
// BR-02 Board Reporting candidate in its own sibling table
// (kai.board_reporting_candidate_human_authority_decisions) - neither
// existing table or its hard FOREIGN KEY is ever touched, weakened, or made
// polymorphic. This file creates no final-eligibility evaluation, no Board
// manifest, and no Board file/artifact.
//
// The BR-04 migration deliberately left "is the bound
// board_reporting_candidate_review queue item resolved" as a RUNTIME
// precondition rather than a schema constraint - this repository is where
// that precondition is enforced, reusing the existing BR-02/BR-03B
// loadBoardReportingCandidateForReview / loadBoardReportingCandidateReviewQueueRowById /
// isValidBoardReportingCandidateReviewQueueRowForProfiles helpers verbatim
// rather than re-implementing candidate/queue-row binding or profile logic.
//
// NEVER writes to kai.board_reporting_candidates,
// kai.board_reporting_candidate_members, or kai.review_queue_items - this
// repository only ever SELECTs from those tables; it INSERTs only into
// kai.board_reporting_candidate_human_authority_decisions (via this file)
// and kai.audit_events (via the injected metadataOnlyAudit dependency).
// ---------------------------------------------------------------------------

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The single allowed-profile pair a bound review queue row must be in before
// a grant/revoke decision may be recorded: BR-03B's own COMPLETE profile
// (resolved/resolved). START (in_progress/needs_gk_review) and REQUEST
// (open/needs_gk_review) are both refused, as is a missing queue row.
const RESOLVED_REVIEW_PROFILE = Object.freeze({ queueStatus: "resolved", reviewStatus: "resolved" });

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
}

function success(data) {
  return { ok: true, data, error: null };
}

export class BoardReportingCandidateHumanAuthorityDecisionRollbackResultError extends Error {
  constructor(result) {
    super("rollback board-reporting-candidate-human-authority-decision transaction");
    this.name = "BoardReportingCandidateHumanAuthorityDecisionRollbackResultError";
    this.result = result;
  }
}

function rollbackFailure(code) {
  throw new BoardReportingCandidateHumanAuthorityDecisionRollbackResultError(failure(code));
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

// Exact-keys input contract: organizationId + engagementId +
// boardReportingCandidateId + reviewQueueItemId + decisionType +
// decisionAction + actorContext + now, and NOTHING else. In particular, no
// requestedAudience (a Board Reporting candidate's audience is always
// exactly "internal"), no fingerprint, no member list, and no manifest
// identity is ever accepted from a caller.
function isRecordBoardReportingCandidateHumanAuthorityDecisionInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "boardReportingCandidateId",
    "reviewQueueItemId",
    "decisionType",
    "decisionAction",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.boardReportingCandidateId)
    && UUID_PATTERN.test(input.reviewQueueItemId)
    && BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_TYPES.includes(input.decisionType)
    && ["grant", "revoke"].includes(input.decisionAction)
    && isMappedHumanActor(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

function isEvaluateEffectivenessInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "boardReportingCandidateId", "decisionType"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.boardReportingCandidateId)
    && BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_TYPES.includes(input.decisionType);
}

// Only a mapped human actor with an active gk_admin membership in this exact
// organization may decide export_authority_granted - mirrors the existing
// P3-17/P14-07B1 deriveDecidedByRole exactly.
function deriveDecidedByRole(actorContext, organizationId, decisionType) {
  const requiredRole = roleRequiredForBoardReportingCandidateHumanAuthorityDecisionType(decisionType);
  if (!requiredRole) return null;
  const membership = (actorContext?.organizationMemberships || []).find((entry) =>
    String(entry.organization_id) === String(organizationId)
    && entry.membership_status === "active"
    && entry.role_name === requiredRole);
  return membership ? requiredRole : null;
}

async function loadCurrentDecisionHead(tx, { organizationId, boardReportingCandidateId, decisionType, forUpdate }) {
  const { rows } = await tx.query(
    `SELECT d.decision_id::text AS decision_id, d.decision_action
       FROM kai.board_reporting_candidate_human_authority_decisions d
      WHERE d.organization_id = $1::uuid
        AND d.board_reporting_candidate_id = $2::uuid
        AND d.decision_type = $3
        AND NOT EXISTS (
              SELECT 1 FROM kai.board_reporting_candidate_human_authority_decisions s
               WHERE s.supersedes_decision_id = d.decision_id
            )${forUpdate ? "\n      FOR UPDATE OF d" : ""}`,
    [organizationId, boardReportingCandidateId, decisionType],
  );
  return rows;
}

// Pure, transaction-scoped effectiveness read. Board Reporting candidates
// are immutable (BR-02 never mutates board_reporting_candidates or
// board_reporting_candidate_members after creation, and no
// currentness/fingerprint-drift evaluator exists for this object type -
// unlike the P3-16 export-candidate evaluator P3-17 reuses, or the
// packet-render-model fingerprint P14-07B1 recomposes), so effectiveness
// here reduces to exactly: current head exists AND current head action =
// grant. Fails closed on no decision, a revoke head, or ambiguous lineage.
export async function evaluateBoardReportingCandidateHumanAuthorityEffectivenessInTransaction(
  tx,
  { organizationId, boardReportingCandidateId, decisionType },
) {
  const headRows = await loadCurrentDecisionHead(tx, {
    organizationId,
    boardReportingCandidateId,
    decisionType,
    forUpdate: false,
  });
  if (headRows.length === 0) return { effective: false, reason: "no_decision", headDecisionId: null };
  if (headRows.length > 1) return { effective: false, reason: "lineage_ambiguous", headDecisionId: null };

  const head = headRows[0];
  if (head.decision_action !== "grant") {
    return { effective: false, reason: "head_is_revoke", headDecisionId: head.decision_id };
  }
  return { effective: true, reason: null, headDecisionId: head.decision_id };
}

function buildDecisionAuditPayload({ input, decisionId, supersedesDecisionId, decidedByRole, effectiveness }) {
  return {
    board_reporting_candidate_id: input.boardReportingCandidateId,
    engagement_id: input.engagementId,
    attempted_operation: "board_reporting_candidate_human_authority_decision_recorded",
    review_queue_item_id: input.reviewQueueItemId,
    decision_id: decisionId,
    decision_type: input.decisionType,
    decision_action: input.decisionAction,
    decided_by_role: decidedByRole,
    supersedes_decision_id: supersedesDecisionId,
    effective: effectiveness.effective,
    effectiveness_reason: effectiveness.reason,
    head_decision_id: effectiveness.headDecisionId,
  };
}

export function createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository({
  runInTransaction = withTransaction,
} = {}) {
  return Object.freeze({
    // Grant/revoke the exact same "human final-release authority" concept as
    // P3-17/P14-07B1, for the exact boardReportingCandidateId given - never a
    // latest/newest/preferred candidate. Requires the exact bound
    // reviewQueueItemId's 'board_reporting_candidate_review' queue row to be
    // in the resolved/resolved profile (BR-03B COMPLETE) before any decision
    // may be recorded - a REQUEST (open/needs_gk_review), START
    // (in_progress/needs_gk_review), missing, or mis-bound queue row all fail
    // closed. Append-only: a repeated call with the same current head action
    // replays the current head unchanged (no new row, no audit); a genuinely
    // new action supersedes the current head. Creates no final-eligibility
    // state, no Board manifest, no Board file/artifact.
    async recordDecision(input, dependencies = {}) {
      if (!isRecordBoardReportingCandidateHumanAuthorityDecisionInput(input)) return failure("validation_blocker");
      if (!dependencies.metadataOnlyAudit) return failure("validation_blocker");
      const decidedByRole = deriveDecidedByRole(input.actorContext, input.organizationId, input.decisionType);
      if (!decidedByRole) return failure("validation_blocker");

      try {
        return await runInTransaction(async (tx) => {
          const candidate = await loadBoardReportingCandidateForReview(tx, {
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            boardReportingCandidateId: input.boardReportingCandidateId,
          });
          if (!candidate) return failure("not_found");
          if (candidate.packet_audience !== BOARD_REPORTING_CANDIDATE_AUDIENCE) {
            return failure("validation_blocker");
          }

          // Binding proof: the exact reviewQueueItemId supplied must resolve
          // to a 'board_reporting_candidate_review' queue row bound to this
          // exact organization/engagement/candidate (never merely "some
          // resolved row for this candidate"), and that row must currently
          // be in the resolved/resolved profile. isValidBoardReportingCandidateReviewQueueRowForProfiles
          // is the existing BR-02/BR-03B helper - reused verbatim, not
          // duplicated. The review queue row carries no canonical_fingerprint
          // of its own to compare against the BR-02 candidate's - candidate
          // identity binding is already fully proven by
          // target_object_id === boardReportingCandidateId, so no separate
          // fingerprint check is meaningful here (unlike P14-07B1, which
          // must recompose a packet render-model fingerprint because a
          // packet candidate has no single immutable review-queue binding).
          const queueRow = await loadBoardReportingCandidateReviewQueueRowById(tx, {
            organizationId: input.organizationId,
            reviewQueueItemId: input.reviewQueueItemId,
          });
          if (!queueRow) return failure("not_found");
          if (!isValidBoardReportingCandidateReviewQueueRowForProfiles(queueRow, {
            organizationId: input.organizationId,
            engagementId: input.engagementId,
            boardReportingCandidateId: input.boardReportingCandidateId,
            allowedProfiles: [RESOLVED_REVIEW_PROFILE],
          })) {
            return failure("conflict_current_state_changed");
          }

          const headRows = await loadCurrentDecisionHead(tx, {
            organizationId: input.organizationId,
            boardReportingCandidateId: input.boardReportingCandidateId,
            decisionType: input.decisionType,
            forUpdate: true,
          });
          if (headRows.length > 1) return failure("conflict_current_state_changed");
          const head = headRows[0] || null;
          if (!head && input.decisionAction === "revoke") return failure("validation_blocker");

          if (head?.decision_action === input.decisionAction) {
            const effectiveness = await evaluateBoardReportingCandidateHumanAuthorityEffectivenessInTransaction(tx, {
              organizationId: input.organizationId,
              boardReportingCandidateId: input.boardReportingCandidateId,
              decisionType: input.decisionType,
            });
            return success({
              decisionId: head.decision_id,
              boardReportingCandidateId: input.boardReportingCandidateId,
              decisionType: input.decisionType,
              decisionAction: input.decisionAction,
              supersedesDecisionId: null,
              decidedByRole,
              effective: effectiveness.effective,
              effectivenessReason: effectiveness.reason,
              headDecisionId: effectiveness.headDecisionId,
              replayed: true,
            });
          }

          const decisionId = crypto.randomUUID();
          const supersedesDecisionId = head?.decision_id || null;
          await tx.query(
            `INSERT INTO kai.board_reporting_candidate_human_authority_decisions (
               decision_id, organization_id, board_reporting_candidate_id, decision_type, decision_action,
               decided_by, decided_by_role, supersedes_decision_id, created_by_type, created_at
             )
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7,$8::uuid,'human',$9::timestamptz)`,
            [
              decisionId,
              input.organizationId,
              input.boardReportingCandidateId,
              input.decisionType,
              input.decisionAction,
              input.actorContext.actorUserId,
              decidedByRole,
              supersedesDecisionId,
              input.now,
            ],
          );

          const effectiveness = await evaluateBoardReportingCandidateHumanAuthorityEffectivenessInTransaction(tx, {
            organizationId: input.organizationId,
            boardReportingCandidateId: input.boardReportingCandidateId,
            decisionType: input.decisionType,
          });

          const preparedAudit = dependencies.metadataOnlyAudit.prepareMetadataOnlyAudit?.({
            payload: buildDecisionAuditPayload({ input, decisionId, supersedesDecisionId, decidedByRole, effectiveness }),
            db: tx,
          });
          if (!preparedAudit || preparedAudit.ok !== true || typeof preparedAudit.publish !== "function") {
            rollbackFailure("system_error");
          }
          await preparedAudit.publish();

          return success({
            decisionId,
            boardReportingCandidateId: input.boardReportingCandidateId,
            decisionType: input.decisionType,
            decisionAction: input.decisionAction,
            supersedesDecisionId,
            decidedByRole,
            effective: effectiveness.effective,
            effectivenessReason: effectiveness.reason,
            headDecisionId: effectiveness.headDecisionId,
            replayed: false,
          });
        });
      } catch (error) {
        if (error instanceof BoardReportingCandidateHumanAuthorityDecisionRollbackResultError) return error.result;
        if (error?.code === "23505" || error?.code === "25001") return failure("conflict_current_state_changed");
        if (error?.code === "23503" || error?.code === "22P02" || error?.code === "23514") return failure("validation_blocker");
        return failure("system_error");
      }
    },

    // Read-only. Not wired into any final-eligibility evaluation, manifest,
    // route, or frontend in this package.
    async evaluateEffectiveness(input) {
      if (!isEvaluateEffectivenessInput(input)) return failure("validation_blocker");
      try {
        return await runInTransaction((tx) => evaluateBoardReportingCandidateHumanAuthorityEffectivenessInTransaction(tx, input)
          .then((data) => success(data)));
      } catch {
        return failure("system_error");
      }
    },
  });
}

export const __boardReportingCandidateHumanAuthorityDecisionRepositoryTestables = Object.freeze({
  isRecordBoardReportingCandidateHumanAuthorityDecisionInput,
  isEvaluateEffectivenessInput,
  deriveDecidedByRole,
  evaluateBoardReportingCandidateHumanAuthorityEffectivenessInTransaction,
});

export const __boardReportingCandidateHumanAuthorityDecisionRepositoryContract = Object.freeze({
  UUID_PATTERN,
  RESOLVED_REVIEW_PROFILE,
});
