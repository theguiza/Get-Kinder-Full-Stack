import {
  findCurrentSensitivityAllowedUseDecision,
  insertSensitivityAllowedUseDecision,
  AmbiguousSensitivityDecisionLineageError,
} from "./postgresSensitivityAllowedUseDecisionRepository.js";
import {
  isSensitivityAllowedUseTerminalOutcome,
  sensitivityReviewedSnapshotRequired,
  sensitivityQueueStatusForOutcome,
  sensitivityQueueReviewStatusForOutcome,
  validateSensitivityReviewedSnapshot,
} from "./sensitivityAllowedUseDecisionContract.js";

/**
 * KAI B1A-2 Phase-5 sensitivity/allowed-use human-review repository.
 *
 * Records the first real human authority record for the Phase-5 sensitivity and
 * allowed-use review: one immutable, append-only row in
 * kai.intake_sensitivity_review_decisions
 * (Backend/kai/dictionary/postgresSensitivityAllowedUseDecisionRepository.js and
 * migrations/kai_sprint2_b1a_02_phase5_allowed_use_decision_ledger.sql), written
 * in the same transaction as the P1-06 'sensitivity_review' queue compare-and-set
 * and the required metadata-only audit.
 *
 * What this module deliberately never does:
 *
 *  - it never writes ANY column of kai.intake_sensitivity_profiles. Every P1-05
 *    pinned value (llm_processing_allowed / product_learning_allowed /
 *    public_use_allowed / funder_use_allowed = false, human_review_required =
 *    true, retention_posture = 'restricted_pending_review') is left exactly as
 *    the machine wrote it, so the P1-07 creation-trigger predicate
 *    (postgresSourceCandidateRepository.js satisfiesCreationTriggerPredicate) and
 *    the P1-08 permission predicate (postgresSourcePromotionRepository.js
 *    satisfiesPermissionPredicate) are unaffected by anything recorded here.
 *    Propagating a reviewed permission onto the profile row is explicitly out of
 *    scope for this package;
 *  - it never writes a claim, evidence item, generated draft, export candidate,
 *    release/export authority row, or any audience-gate boolean anywhere;
 *  - it never executes retention, deletion, or a storage-lifecycle change;
 *  - it never creates a queue item, and it never uses the generic
 *    POST /admin/review-queue/:id/status path or changes its open -> in_progress
 *    semantics. It transitions ONLY the one 'sensitivity_review' queue item that
 *    already targets this exact profile, via its own compare-and-set below.
 */

const SENSITIVITY_REVIEW_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const SENSITIVITY_REVIEW_QUEUE_TYPE = "sensitivity_review";
const SENSITIVITY_REVIEW_TARGET_OBJECT_TYPE = "intake_sensitivity_profile";

const QUEUE_STATUS_OPEN = "open";
const QUEUE_STATUS_IN_PROGRESS = "in_progress";
const QUEUE_STATUS_RESOLVED = "resolved";
const REVIEW_STATUS_NEEDS_GK_REVIEW = "needs_gk_review";
const REVIEW_STATUS_RESOLVED = "resolved";

const SENSITIVITY_DECISION_AUDIT_CONTRACT = "b1a_02_sensitivity_allowed_use_decision_v1";
const SENSITIVITY_DECISION_AUDIT_OPERATION = "sensitivity_review_decision_recorded";
const SENSITIVITY_DECISION_VALIDATOR_KEY = "VAL-KAI-B1A-02-001";

function failure(code) {
  return { ok: false, data: null, error: { code, status: SENSITIVITY_REVIEW_RESULT_STATUS[code] || 500 } };
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

function asIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
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

/**
 * Preserves the exact own-boolean-data-property audit predicate established by
 * P1-04/P1-05/P2-12: an own-property descriptor read (never a getter) whose
 * `value` is exactly `true`, alongside a callable `publish`. A rejected audit is
 * raised, not returned, so the decision insert and the queue transition in this
 * same transaction both roll back.
 */
function prepareRequiredAudit(metadataOnlyAudit, payload, tx) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({ payload, db: tx });
  const okDescriptor =
    prepared !== null && typeof prepared === "object" && !Array.isArray(prepared)
      ? Object.getOwnPropertyDescriptor(prepared, "ok")
      : undefined;
  const auditConfirmed =
    okDescriptor !== undefined
    && Object.hasOwn(okDescriptor, "value")
    && okDescriptor.value === true
    && typeof prepared.publish === "function";
  if (!auditConfirmed) throw new RequiredAuditRejectedError();
  return prepared;
}

function logValidationBlockerClassification(reason, error) {
  console.error(JSON.stringify({
    event: "KAI_B1A_02_SENSITIVITY_REVIEW_VALIDATION_BLOCKER_CLASSIFICATION",
    reason,
    pg_code: error?.code || null,
    pg_constraint: error?.constraint || null,
  }));
}

function shapeError(error) {
  if (error instanceof MalformedResultRowError) return failure("system_error");
  if (error instanceof AmbiguousSensitivityDecisionLineageError) return failure("system_error");
  if (error instanceof RequiredAuditRejectedError) {
    logValidationBlockerClassification("required_audit_rejected", error);
    return failure("validation_blocker");
  }
  if (error?.code === "23514" || error?.code === "22P02") {
    logValidationBlockerClassification(
      error.code === "23514" ? "check_constraint_violation" : "invalid_input_syntax",
      error,
    );
    return failure("validation_blocker");
  }
  if (error?.code === "23505") return failure("conflict_current_state_changed");
  if (error?.code === "23503") return failure("not_found");
  if (error?.code === "25001") return failure("conflict_current_state_changed");
  return failure("system_error");
}

/**
 * Tenant-scoped read-and-lock of the P1-05 profile row. Only the identity and the
 * pinned predicate columns this package is authorized to depend on are selected -
 * never the raw dictionary or profile content. FOR UPDATE, so a concurrent
 * decision on the same profile serializes here.
 */
async function lockScopedSensitivityProfile(tx, organizationId, intakeSensitivityProfileId) {
  const { rows } = await tx.query(
    `SELECT organization_id::text AS organization_id,
            intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id,
            intake_file_id::text AS intake_file_id,
            human_review_required,
            public_use_allowed,
            funder_use_allowed,
            llm_processing_allowed,
            product_learning_allowed,
            retention_posture
       FROM kai.intake_sensitivity_profiles
      WHERE organization_id = $1::uuid
        AND intake_sensitivity_profile_id = $2::uuid
      FOR UPDATE`,
    [organizationId, intakeSensitivityProfileId],
  );
  return rows[0] ?? null;
}

/**
 * Tenant-scoped read of the ONE 'sensitivity_review' queue item that targets this
 * exact profile. The (organization_id, queue_type, target_object_type,
 * target_object_id) filter is the same identity the P1-06 partial unique index
 * (ux_review_queue_items_p1_06_sensitivity_review_identity) enforces, so at most
 * one row can match. Mirrors P2-12's readReviewQueueItemById scoping exactly.
 */
async function readScopedSensitivityReviewQueueItem(tx, { organizationId, reviewQueueItemId, targetObjectId }) {
  const { rows } = await tx.query(
    `SELECT review_queue_item_id::text AS review_queue_item_id,
            organization_id::text AS organization_id,
            queue_type,
            target_object_type,
            target_object_id::text AS target_object_id,
            queue_status,
            review_status,
            updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND review_queue_item_id = $2::uuid
        AND queue_type = $3
        AND target_object_type = $4
        AND target_object_id = $5::uuid`,
    [
      organizationId,
      reviewQueueItemId,
      SENSITIVITY_REVIEW_QUEUE_TYPE,
      SENSITIVITY_REVIEW_TARGET_OBJECT_TYPE,
      targetObjectId,
    ],
  );
  return rows[0] ?? null;
}

/**
 * Compare-and-set the linked 'sensitivity_review' queue item from any of its
 * three coherent active/terminal starting states - "fresh"
 * (open/needs_gk_review), "picked up" (in_progress/needs_gk_review, the only
 * transition the generic POST /admin/review-queue/:id/status endpoint can
 * produce), or "already reviewed" (resolved/resolved, a legitimate re-review) -
 * to the state this decisionOutcome projects: resolved/resolved for the terminal
 * 'reviewed' outcome, open/needs_gk_review for 'needs_more_information' (which
 * correctly returns a previously-resolved item to active review and is a no-op
 * transition for an already-fresh one).
 *
 * Any other queue_status/review_status combination (blocked, cancelled,
 * waiting_on_client, waiting_on_gk, ...) matches no branch and yields 0 rows,
 * exactly like a genuine optimistic-concurrency conflict. The
 * date_trunc('milliseconds', updated_at) comparison is this package's OCC check,
 * bound to the caller-supplied expectedUpdatedAt.
 */
async function updateSensitivityReviewQueueCompareAndSet(tx, {
  organizationId,
  reviewQueueItemId,
  targetObjectId,
  expectedUpdatedAt,
  now,
  isTerminal,
}) {
  const { rows } = await tx.query(
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
          OR (queue_status = $11 AND review_status = $10)
          OR (queue_status = $12 AND review_status = $13)
        )
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $14::timestamptz)
      RETURNING review_queue_item_id::text AS review_queue_item_id,
                organization_id::text AS organization_id,
                queue_type,
                target_object_type,
                target_object_id::text AS target_object_id,
                queue_status,
                review_status,
                updated_at`,
    [
      isTerminal ? QUEUE_STATUS_RESOLVED : QUEUE_STATUS_OPEN,
      isTerminal ? REVIEW_STATUS_RESOLVED : REVIEW_STATUS_NEEDS_GK_REVIEW,
      now,
      organizationId,
      reviewQueueItemId,
      SENSITIVITY_REVIEW_QUEUE_TYPE,
      SENSITIVITY_REVIEW_TARGET_OBJECT_TYPE,
      targetObjectId,
      QUEUE_STATUS_OPEN,
      REVIEW_STATUS_NEEDS_GK_REVIEW,
      QUEUE_STATUS_IN_PROGRESS,
      QUEUE_STATUS_RESOLVED,
      REVIEW_STATUS_RESOLVED,
      expectedUpdatedAt,
    ],
  );
  return rows[0] ?? null;
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

async function insertUploadLifecycleAudit(tx, { organizationId, intakeFileId, uploadState, metadata, now }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $4, 'success', $5::jsonb, $6::timestamptz)`,
    [
      organizationId,
      intakeFileId,
      SENSITIVITY_DECISION_AUDIT_OPERATION,
      uploadState,
      JSON.stringify(metadata),
      now,
    ],
  );
}

function isQueueRowInState(row, queueStatus, reviewStatus) {
  return Boolean(row) && row.queue_status === queueStatus && row.review_status === reviewStatus;
}

/**
 * A replay is recognized when: the current decision-lineage head already carries
 * this exact decisionOutcome AND was recorded against this exact
 * expectedUpdatedAt (the optimistic-concurrency stamp this request targeted -
 * proof this is the same request re-sent, not a new or different one) AND the
 * queue row is currently in the state this decisionOutcome projects. Any other
 * post-CAS-miss state is a genuine conflict. Mirrors P2-12's isReplayOfDecision
 * exactly.
 */
function isReplayOfSensitivityDecision({ currentHead, decisionOutcome, expectedUpdatedAt, existingQueueRow, isTerminal }) {
  if (!currentHead) return false;
  if (currentHead.decision_outcome !== decisionOutcome) return false;
  const headTargetMs = Date.parse(new Date(currentHead.target_updated_at).toISOString());
  const expectedMs = Date.parse(expectedUpdatedAt);
  if (!Number.isFinite(headTargetMs) || !Number.isFinite(expectedMs) || headTargetMs !== expectedMs) return false;
  return isQueueRowInState(
    existingQueueRow,
    isTerminal ? QUEUE_STATUS_RESOLVED : QUEUE_STATUS_OPEN,
    isTerminal ? REVIEW_STATUS_RESOLVED : REVIEW_STATUS_NEEDS_GK_REVIEW,
  );
}

async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

const RECORD_DECISION_INPUT_ALLOWED_KEYS = new Set([
  "organizationId",
  "intakeSensitivityProfileId",
  "reviewQueueItemId",
  "expectedUpdatedAt",
  "decisionOutcome",
  "reviewedSnapshot",
  "actorUserId",
  "actorRole",
  "now",
  "metadataOnlyAudit",
]);

function isRecordSensitivityAllowedUseDecisionInput(input) {
  if (!isPlainObject(input) || !hasOnlyKeys(input, RECORD_DECISION_INPUT_ALLOWED_KEYS)) return false;
  if (
    !isNonEmptyString(input.organizationId)
    || !isNonEmptyString(input.intakeSensitivityProfileId)
    || !isNonEmptyString(input.reviewQueueItemId)
    || !isNormalizedNow(input.expectedUpdatedAt)
    || !isNonEmptyString(input.decisionOutcome)
    || !isNonEmptyString(input.actorUserId)
    || !isNonEmptyString(input.actorRole)
    || !isNormalizedNow(input.now)
    || !isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  ) {
    return false;
  }
  // A 'reviewed' decision requires the complete snapshot; a
  // 'needs_more_information' decision must carry none of it, so it can never be
  // read back as granting any permission.
  if (sensitivityReviewedSnapshotRequired(input.decisionOutcome)) {
    return validateSensitivityReviewedSnapshot(input.reviewedSnapshot).ok;
  }
  return input.reviewedSnapshot === null || input.reviewedSnapshot === undefined;
}

function toDecisionRecord(row) {
  if (!row) return null;
  return {
    decision_id: row.decision_id,
    organization_id: row.organization_id,
    intake_sensitivity_profile_id: row.intake_sensitivity_profile_id,
    review_queue_item_id: row.review_queue_item_id,
    decision_outcome: row.decision_outcome,
    reviewed_personal_data_status: row.reviewed_personal_data_status ?? null,
    reviewed_minor_data_status: row.reviewed_minor_data_status ?? null,
    reviewed_health_housing_justice_immigration_status: row.reviewed_health_housing_justice_immigration_status ?? null,
    reviewed_indigenous_governance_status: row.reviewed_indigenous_governance_status ?? null,
    reviewed_staff_notes_status: row.reviewed_staff_notes_status ?? null,
    reviewed_story_testimonial_status: row.reviewed_story_testimonial_status ?? null,
    reviewed_small_cell_risk_status: row.reviewed_small_cell_risk_status ?? null,
    reviewed_financial_records_status: row.reviewed_financial_records_status ?? null,
    reviewed_consent_basis_status: row.reviewed_consent_basis_status ?? null,
    reviewed_allowed_use_status: row.reviewed_allowed_use_status ?? null,
    reviewed_llm_processing_allowed: row.reviewed_llm_processing_allowed ?? null,
    reviewed_product_learning_allowed: row.reviewed_product_learning_allowed ?? null,
    reviewed_public_use_allowed: row.reviewed_public_use_allowed ?? null,
    reviewed_funder_use_allowed: row.reviewed_funder_use_allowed ?? null,
    decided_by: row.decided_by,
    decided_by_role: row.decided_by_role,
    supersedes_decision_id: row.supersedes_decision_id ?? null,
    created_by_type: row.created_by_type,
    target_updated_at: asIso(row.target_updated_at),
    created_at: asIso(row.created_at),
  };
}

function toQueueStateRecord(row) {
  return {
    review_queue_item_id: row.review_queue_item_id,
    organization_id: row.organization_id,
    queue_type: row.queue_type,
    target_object_type: row.target_object_type,
    target_object_id: row.target_object_id,
    queue_status: row.queue_status,
    review_status: row.review_status,
    updated_at: asIso(row.updated_at),
  };
}

export function createPostgresSensitivityAllowedUseReviewRepository({ runInTransaction } = {}) {
  return Object.freeze({
    /**
     * Record one Phase-5 sensitivity/allowed-use human decision, atomically:
     *
     *   validate input shape and decision content
     *   -> lock the tenant-scoped P1-05 profile row (FOR UPDATE)
     *   -> read the ONE 'sensitivity_review' queue item that targets it
     *   -> read the current decision-lineage head
     *   -> compare-and-set the queue item on the caller's expectedUpdatedAt (OCC)
     *   -> append the new decision row, superseding the prior head if any
     *   -> write the required same-transaction metadata-only audit
     *   -> re-read and confirm exactly one current head, and that it is this row
     *   -> commit.
     *
     * A failure at any step rolls the whole thing back: no decision row, no queue
     * transition, no audit row. A terminal 'reviewed' decision resolves the queue
     * item; 'needs_more_information' leaves the review active and grants nothing.
     */
    async recordSensitivityAllowedUseDecision(input) {
      if (!isRecordSensitivityAllowedUseDecisionInput(input)) return failure("validation_blocker");
      const {
        organizationId,
        intakeSensitivityProfileId,
        reviewQueueItemId,
        expectedUpdatedAt,
        decisionOutcome,
        reviewedSnapshot,
        actorUserId,
        actorRole,
        now,
        metadataOnlyAudit,
      } = input;
      const isTerminal = isSensitivityAllowedUseTerminalOutcome(decisionOutcome);
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      try {
        return await run(async (tx) => {
          const profileRow = await lockScopedSensitivityProfile(tx, organizationId, intakeSensitivityProfileId);
          if (!profileRow) return failure("not_found");

          const preImageQueueRow = await readScopedSensitivityReviewQueueItem(tx, {
            organizationId,
            reviewQueueItemId,
            targetObjectId: intakeSensitivityProfileId,
          });
          if (!preImageQueueRow) return failure("not_found");

          const currentHead = await findCurrentSensitivityAllowedUseDecision(tx, {
            organizationId,
            intakeSensitivityProfileId,
          });

          const queueRow = await updateSensitivityReviewQueueCompareAndSet(tx, {
            organizationId,
            reviewQueueItemId,
            targetObjectId: intakeSensitivityProfileId,
            expectedUpdatedAt,
            now,
            isTerminal,
          });

          if (!queueRow) {
            const existingQueueRow = await readScopedSensitivityReviewQueueItem(tx, {
              organizationId,
              reviewQueueItemId,
              targetObjectId: intakeSensitivityProfileId,
            });
            if (!existingQueueRow) return failure("not_found");
            if (isReplayOfSensitivityDecision({
              currentHead,
              decisionOutcome,
              expectedUpdatedAt,
              existingQueueRow,
              isTerminal,
            })) {
              return success({
                decision: toDecisionRecord(currentHead),
                reviewQueueItem: toQueueStateRecord(existingQueueRow),
                replayed: true,
              });
            }
            return failure("conflict_current_state_changed");
          }

          const decisionRow = await insertSensitivityAllowedUseDecision(tx, {
            organizationId,
            intakeSensitivityProfileId,
            reviewQueueItemId,
            decisionOutcome,
            reviewedSnapshot: isTerminal ? reviewedSnapshot : null,
            decidedBy: actorUserId,
            decidedByRole: actorRole,
            targetUpdatedAt: expectedUpdatedAt,
            supersedesDecisionId: currentHead ? currentHead.decision_id : null,
          });
          if (!decisionRow) throw new MalformedResultRowError("intake_sensitivity_review_decisions");

          const uploadState = await readScopedUploadState(tx, organizationId, profileRow.intake_file_id);
          if (!uploadState) throw new MalformedResultRowError("intake_files");

          const auditMetadata = {
            metadata_only: true,
            contract: SENSITIVITY_DECISION_AUDIT_CONTRACT,
            intake_sensitivity_profile_id: intakeSensitivityProfileId,
            review_queue_item_id: reviewQueueItemId,
            decision_id: decisionRow.decision_id,
            decision_outcome: decisionOutcome,
            supersedes_decision_id: currentHead ? currentHead.decision_id : null,
            previous_queue_status: preImageQueueRow.queue_status,
            resulting_queue_status: queueRow.queue_status,
            previous_review_status: preImageQueueRow.review_status,
            resulting_review_status: queueRow.review_status,
            validator_key: SENSITIVITY_DECISION_VALIDATOR_KEY,
          };

          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, {
            attempted_operation: SENSITIVITY_DECISION_AUDIT_OPERATION,
            actor_type: "human",
            actor_user_id: actorUserId,
            contract: SENSITIVITY_DECISION_AUDIT_CONTRACT,
            object_type: SENSITIVITY_REVIEW_TARGET_OBJECT_TYPE,
            intake_sensitivity_profile_id: intakeSensitivityProfileId,
            validator_key: SENSITIVITY_DECISION_VALIDATOR_KEY,
          }, tx);
          await insertUploadLifecycleAudit(tx, {
            organizationId,
            intakeFileId: profileRow.intake_file_id,
            uploadState,
            metadata: auditMetadata,
            now,
          });
          await preparedAudit.publish();

          // Post-write coherence: the lineage must now have exactly one head and
          // it must be the row this transaction just appended. A mismatch means
          // the lineage is corrupt, and this transaction rolls back rather than
          // returning a decision that is not actually current.
          const confirmedHead = await findCurrentSensitivityAllowedUseDecision(tx, {
            organizationId,
            intakeSensitivityProfileId,
          });
          if (!confirmedHead || confirmedHead.decision_id !== decisionRow.decision_id) {
            throw new MalformedResultRowError("intake_sensitivity_review_decisions_head");
          }

          return success({
            decision: toDecisionRecord(confirmedHead),
            reviewQueueItem: toQueueStateRecord(queueRow),
            replayed: false,
          });
        });
      } catch (error) {
        return shapeError(error);
      }
    },
  });
}

export const __sensitivityAllowedUseReviewRepositoryContract = Object.freeze({
  SENSITIVITY_REVIEW_QUEUE_TYPE,
  SENSITIVITY_REVIEW_TARGET_OBJECT_TYPE,
  QUEUE_STATUS_OPEN,
  QUEUE_STATUS_IN_PROGRESS,
  QUEUE_STATUS_RESOLVED,
  REVIEW_STATUS_NEEDS_GK_REVIEW,
  REVIEW_STATUS_RESOLVED,
  SENSITIVITY_DECISION_AUDIT_CONTRACT,
  SENSITIVITY_DECISION_AUDIT_OPERATION,
  SENSITIVITY_DECISION_VALIDATOR_KEY,
});

export const __sensitivityAllowedUseReviewRepositoryTestables = Object.freeze({
  MalformedResultRowError,
  RequiredAuditRejectedError,
  prepareRequiredAudit,
  isReplayOfSensitivityDecision,
  isRecordSensitivityAllowedUseDecisionInput,
  sensitivityQueueStatusForOutcome,
  sensitivityQueueReviewStatusForOutcome,
});
