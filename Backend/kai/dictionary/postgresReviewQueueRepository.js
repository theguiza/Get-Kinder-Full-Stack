import { withTransaction } from "../db/kaiDb.js";
import {
  getScopedSensitivityReviewQueueItemByIdentity,
  insertReviewQueueItem,
} from "../db/kaiIntakeQueries.js";

/**
 * KAI P1-06 review-queue repository adapter: idempotent creation of one
 * 'sensitivity_review' item for an existing, tenant-scoped, committed P1-05
 * `kai.intake_sensitivity_profiles` row.
 *
 * This module is the only authorized location for P1-06 SQL and row locking. It
 * reuses the EXISTING `kai.review_queue_items` canonical table and the EXISTING
 * `insertReviewQueueItem` seam (Backend/kai/db/kaiIntakeQueries.js) rather than
 * building a second, competing queue abstraction: this is the same table and the
 * same insert path the already-wired production `createReviewQueueItem` route uses
 * for other queue_types. It never writes any queue_type other than
 * 'sensitivity_review', never transitions queue_status beyond null -> 'open', and
 * never performs resolution, approval, escalation, or promotion.
 *
 * The table's `target_object_id` column is shared by many queue_types that each
 * point at a different target table, so a single table-wide FOREIGN KEY on that
 * column cannot express "this row must reference kai.intake_sensitivity_profiles"
 * without breaking every other queue_type. Instead, this repository authoritatively
 * verifies - inside the same transaction as the insert - that the referenced,
 * tenant-matched `kai.intake_sensitivity_profiles` row exists before writing.
 */

const REVIEW_QUEUE_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const SENSITIVITY_REVIEW_QUEUE_TYPE = "sensitivity_review";
const SENSITIVITY_REVIEW_TARGET_OBJECT_TYPE = "intake_sensitivity_profile";
const SENSITIVITY_REVIEW_PRIORITY = "normal";
const SENSITIVITY_REVIEW_QUEUE_STATUS = "open";
const SENSITIVITY_REVIEW_SUMMARY = "Review intake sensitivity and allowed-use profile.";
const SENSITIVITY_REVIEW_REQUIRED_ACTION =
  "Review classifications, consent basis, allowed-use restrictions, and governance requirements before source-candidate work.";

const SENSITIVITY_REVIEW_AUDIT_CONTRACT = "p1_sensitivity_review_queue_item_v1";
const SENSITIVITY_REVIEW_AUDIT_VALIDATOR_KEY = "VAL-KAI-P1-06-001";
const SENSITIVITY_REVIEW_AUDIT_OPERATION = "sensitivity_review_queue_item_created";

function reviewQueueFailure(code) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      status: REVIEW_QUEUE_RESULT_STATUS[code],
    },
  };
}

function reviewQueueSuccess(data) {
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

function isSensitivityReviewIdentity(value) {
  const allowedKeys = new Set(["organizationId", "intakeSensitivityProfileId"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return isNonEmptyString(value.organizationId) && isNonEmptyString(value.intakeSensitivityProfileId);
}

function validateCreateInput(input) {
  const allowedKeys = new Set(["identity", "actorUserId", "now", "metadataOnlyAudit"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isSensitivityReviewIdentity(input.identity) &&
    isNonEmptyString(input.actorUserId) &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

function asIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

/**
 * Tenant-scoped read of exactly the P1-05 sensitivity-profile columns this package
 * is authorized to depend on: never the raw dictionary/profile content, never a
 * classification value beyond the pinned VAL-FUP-001-P0 predicate columns.
 */
async function readScopedSensitivityProfile(tx, organizationId, intakeSensitivityProfileId) {
  const result = await tx.query(
    `SELECT organization_id::text AS organization_id,
            intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id,
            intake_file_id::text AS intake_file_id,
            file_profile_id::text AS file_profile_id,
            data_dictionary_id::text AS data_dictionary_id,
            profile_canonical_sha256,
            human_review_required,
            public_use_allowed,
            funder_use_allowed,
            llm_processing_allowed,
            product_learning_allowed,
            retention_posture
       FROM kai.intake_sensitivity_profiles
      WHERE organization_id = $1::uuid
        AND intake_sensitivity_profile_id = $2::uuid`,
    [organizationId, intakeSensitivityProfileId],
  );
  return result.rows[0] ?? null;
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

/**
 * VAL-FUP-001-P0: the creation-trigger predicate. A 'sensitivity_review' queue item
 * may only be created for a sensitivity profile that is fully fail-closed: human
 * review required, and public/funder/LLM/product-learning use all still denied, with
 * retention still restricted pending review. This is never relaxed or partially
 * satisfied.
 */
function satisfiesCreationTriggerPredicate(profileRow) {
  return (
    profileRow.human_review_required === true &&
    profileRow.public_use_allowed === false &&
    profileRow.funder_use_allowed === false &&
    profileRow.llm_processing_allowed === false &&
    profileRow.product_learning_allowed === false &&
    profileRow.retention_posture === "restricted_pending_review"
  );
}

function rowToReviewQueueRecord(row) {
  return {
    review_queue_item_id: row.review_queue_item_id,
    organization_id: row.organization_id,
    queue_type: row.queue_type,
    target_object_type: row.target_object_type,
    target_object_id: row.target_object_id,
    priority: row.priority,
    queue_status: row.queue_status,
    assigned_to: row.assigned_to ?? null,
    due_at: asIso(row.due_at),
    summary: row.summary,
    required_action: row.required_action,
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function buildSensitivityReviewAuditMetadata(record) {
  return {
    contract: SENSITIVITY_REVIEW_AUDIT_CONTRACT,
    queue_type: record.queue_type,
    target_object_type: record.target_object_type,
    target_object_id: record.target_object_id,
    queue_status: record.queue_status,
    validator_key: SENSITIVITY_REVIEW_AUDIT_VALIDATOR_KEY,
  };
}

function buildSensitivityReviewAuditPayload(record) {
  return {
    attempted_operation: SENSITIVITY_REVIEW_AUDIT_OPERATION,
    actor_type: "human",
    contract: SENSITIVITY_REVIEW_AUDIT_CONTRACT,
    object_type: "review_queue_item",
    request_scope: "organization_intake_sensitivity_profile",
    route_contract: "unwired_synthetic_sensitivity_review_queue_item",
    sprint_phase: "kai_sprint2_p1_06",
    validator_key: SENSITIVITY_REVIEW_AUDIT_VALIDATOR_KEY,
    queue_status: record.queue_status,
  };
}

async function insertAudit(tx, { organizationId, intakeFileId, uploadState, metadata, now }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'success', $6::jsonb, $7::timestamptz)`,
    [organizationId, intakeFileId, SENSITIVITY_REVIEW_AUDIT_OPERATION, uploadState, uploadState, JSON.stringify(metadata), now],
  );
}

/**
 * Rejection of the required metadata-only audit must roll back the review-queue-item
 * insert in the same transaction, so it is raised as an error rather than returned.
 */
class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

/**
 * Preserves the exact own-boolean-data-property audit predicate established by
 * P1-04's/P1-05's `prepareRequiredAudit`: an own-property descriptor read (never a
 * getter) whose `value` is exactly `true`, alongside a callable `publish`.
 */
function prepareRequiredAudit(metadataOnlyAudit, record) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: buildSensitivityReviewAuditPayload(record),
  });

  const okDescriptor =
    prepared !== null && typeof prepared === "object" && !Array.isArray(prepared)
      ? Object.getOwnPropertyDescriptor(prepared, "ok")
      : undefined;

  const auditConfirmed =
    okDescriptor !== undefined &&
    Object.hasOwn(okDescriptor, "value") &&
    okDescriptor.value === true &&
    typeof prepared.publish === "function";

  if (!auditConfirmed) {
    throw new RequiredAuditRejectedError();
  }

  return prepared;
}

function shapeReviewQueueError(error) {
  if (error instanceof RequiredAuditRejectedError) return reviewQueueFailure("validation_blocker");
  if (error?.code === "23505") return reviewQueueFailure("conflict_current_state_changed");
  if (error?.code === "23503") return reviewQueueFailure("not_found");
  if (error?.code === "23514" || error?.code === "P0001" || error?.code === "22P02") {
    return reviewQueueFailure("validation_blocker");
  }
  return reviewQueueFailure("system_error");
}

export function createPostgresReviewQueueRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    /**
     * Organization-scoped idempotent create/replay of one 'sensitivity_review' queue
     * item keyed by the accepted P1-06 identity (organizationId +
     * intakeSensitivityProfileId). `intakeFileId` and every VAL-FUP-001-P0 predicate
     * fact are always re-read from the authoritative committed
     * `kai.intake_sensitivity_profiles` row; the caller cannot provide or override
     * queue_type, target_object_type, target_object_id, queue_status, priority,
     * summary, required_action, assigned_to, or due_at.
     *
     * Same identity that already has a matching 'sensitivity_review' row: replays it.
     * Concurrent identical creation is resolved by PostgreSQL's partial unique index
     * inside this same transaction (insert + authoritative re-read on conflict),
     * never by an in-process lock.
     */
    async createSensitivityReviewQueueItem(input) {
      if (!validateCreateInput(input)) return reviewQueueFailure("validation_blocker");
      const { identity, actorUserId, now, metadataOnlyAudit } = input;
      try {
        return await runInTransaction(async (tx) => {
          const profileRow = await readScopedSensitivityProfile(
            tx,
            identity.organizationId,
            identity.intakeSensitivityProfileId,
          );
          if (!profileRow) return reviewQueueFailure("not_found");

          if (!satisfiesCreationTriggerPredicate(profileRow)) {
            return reviewQueueFailure("validation_blocker");
          }

          const existing = await getScopedSensitivityReviewQueueItemByIdentity(
            {
              organizationId: profileRow.organization_id,
              targetObjectId: profileRow.intake_sensitivity_profile_id,
            },
            tx,
          );
          if (existing) {
            return reviewQueueSuccess({ reviewQueueItem: rowToReviewQueueRecord(existing), replayed: true });
          }

          const uploadState = await readScopedUploadState(tx, profileRow.organization_id, profileRow.intake_file_id);
          if (!uploadState) return reviewQueueFailure("not_found");

          let insertedRow;
          try {
            insertedRow = await insertReviewQueueItem(
              {
                organizationId: profileRow.organization_id,
                engagementId: null,
                queueType: SENSITIVITY_REVIEW_QUEUE_TYPE,
                targetObjectType: SENSITIVITY_REVIEW_TARGET_OBJECT_TYPE,
                targetObjectId: profileRow.intake_sensitivity_profile_id,
                priority: SENSITIVITY_REVIEW_PRIORITY,
                queueStatus: SENSITIVITY_REVIEW_QUEUE_STATUS,
                blockedReason: null,
                summary: SENSITIVITY_REVIEW_SUMMARY,
                requiredAction: SENSITIVITY_REVIEW_REQUIRED_ACTION,
                queueMetadata: {},
                createdBy: actorUserId,
                createdByType: "human",
              },
              tx,
            );
          } catch (insertError) {
            if (insertError?.code !== "23505") throw insertError;
            // A concurrent transaction won the partial unique index for this exact
            // identity and committed first. PostgreSQL conflict handling - not an
            // in-process lock - resolves the race: re-read the committed authoritative
            // row inside this same transaction and replay it, so no duplicate row or
            // audit row is written and no raw unique violation reaches the caller.
            const concurrent = await getScopedSensitivityReviewQueueItemByIdentity(
              {
                organizationId: profileRow.organization_id,
                targetObjectId: profileRow.intake_sensitivity_profile_id,
              },
              tx,
            );
            if (!concurrent) return reviewQueueFailure("system_error");
            return reviewQueueSuccess({ reviewQueueItem: rowToReviewQueueRecord(concurrent), replayed: true });
          }

          const record = rowToReviewQueueRecord({
            review_queue_item_id: insertedRow.review_queue_item_id,
            organization_id: insertedRow.organization_id,
            queue_type: insertedRow.queue_type,
            target_object_type: insertedRow.target_object_type,
            target_object_id: insertedRow.target_object_id,
            priority: SENSITIVITY_REVIEW_PRIORITY,
            queue_status: insertedRow.queue_status,
            assigned_to: null,
            due_at: null,
            summary: SENSITIVITY_REVIEW_SUMMARY,
            required_action: SENSITIVITY_REVIEW_REQUIRED_ACTION,
            created_at: now,
            updated_at: now,
          });

          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, record);
          await insertAudit(tx, {
            organizationId: profileRow.organization_id,
            intakeFileId: profileRow.intake_file_id,
            uploadState,
            metadata: buildSensitivityReviewAuditMetadata(record),
            now,
          });
          await preparedAudit.publish();

          return reviewQueueSuccess({ reviewQueueItem: record, replayed: false });
        });
      } catch (error) {
        return shapeReviewQueueError(error);
      }
    },
  });
}

export const __reviewQueueRepositoryContract = Object.freeze({
  SENSITIVITY_REVIEW_QUEUE_TYPE,
  SENSITIVITY_REVIEW_TARGET_OBJECT_TYPE,
  SENSITIVITY_REVIEW_PRIORITY,
  SENSITIVITY_REVIEW_QUEUE_STATUS,
  SENSITIVITY_REVIEW_SUMMARY,
  SENSITIVITY_REVIEW_REQUIRED_ACTION,
  SENSITIVITY_REVIEW_AUDIT_CONTRACT,
  SENSITIVITY_REVIEW_AUDIT_VALIDATOR_KEY,
  SENSITIVITY_REVIEW_AUDIT_OPERATION,
});

export const __reviewQueueRepositoryTestables = Object.freeze({
  prepareRequiredAudit,
  RequiredAuditRejectedError,
  satisfiesCreationTriggerPredicate,
});
