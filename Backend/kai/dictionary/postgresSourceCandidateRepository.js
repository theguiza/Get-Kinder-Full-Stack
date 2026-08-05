import { withTransaction } from "../db/kaiDb.js";
import { getScopedSourceCandidateReviewQueueItemByIdentity } from "../db/kaiIntakeQueries.js";

/**
 * KAI P1-07 source-candidate repository adapter: idempotent creation of one
 * metadata-only `kai.intake_source_candidates` stub for an existing, tenant-scoped,
 * committed P1-05 `kai.intake_sensitivity_profiles` row, plus its corresponding
 * `source_candidate_review` item on the existing canonical `kai.review_queue_items`
 * table, in one transaction.
 *
 * This module is the only authorized location for P1-07's own SQL and row locking.
 * It never writes a queue_type other than 'source_candidate_review', never a
 * candidate_status other than 'needs_gk_review', never a proposed_source_type other
 * than 'unknown', and never creates a source, source_version, evidence, claim, or
 * promotion/approval record of any kind.
 *
 * `kai.review_queue_items.target_object_id` is shared by many queue_types that each
 * point at a different target table, so this repository keeps its own
 * INSERT ... ON CONFLICT DO NOTHING SQL local (matching the P1-06 precedent) rather
 * than adding an ON CONFLICT/unique-violation pattern to the shared
 * Backend/kai/db/kaiIntakeQueries.js query module.
 */

const SOURCE_CANDIDATE_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const SOURCE_CANDIDATE_PROPOSED_SOURCE_TYPE = "unknown";
const SOURCE_CANDIDATE_STATUS = "needs_gk_review";

const SOURCE_CANDIDATE_REVIEW_QUEUE_TYPE = "source_candidate_review";
const SOURCE_CANDIDATE_REVIEW_TARGET_OBJECT_TYPE = "intake_source_candidate";
const SOURCE_CANDIDATE_REVIEW_PRIORITY = "normal";
const SOURCE_CANDIDATE_REVIEW_QUEUE_STATUS = "open";
const SOURCE_CANDIDATE_REVIEW_SUMMARY =
  "Review intake source-candidate stub for human classification.";
const SOURCE_CANDIDATE_REVIEW_REQUIRED_ACTION =
  "Human review is required. This is a review-only source-candidate stub: source " +
  "promotion is not authorized, and no source or source_version has been created.";
const SOURCE_CANDIDATE_REVIEW_QUEUE_METADATA = Object.freeze({ p0_stub: true });

const SOURCE_CANDIDATE_AUDIT_CONTRACT = "p1_intake_source_candidate_v1";
/**
 * VAL-KAI-P1-07-001 is a P1-07 implementation decision, chosen as the smallest
 * convention-consistent validator key for this package's creation-trigger
 * predicate and required audit. It is not quoted from, and is not claimed to be
 * mandated by, any owner-authorized governing source.
 */
const SOURCE_CANDIDATE_VALIDATOR_KEY = "VAL-KAI-P1-07-001";
const SOURCE_CANDIDATE_AUDIT_OPERATION = "intake_source_candidate_persisted";

function sourceCandidateFailure(code) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      status: SOURCE_CANDIDATE_RESULT_STATUS[code],
    },
  };
}

function sourceCandidateSuccess(data) {
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

function isSourceCandidateIdentity(value) {
  const allowedKeys = new Set(["organizationId", "intakeSensitivityProfileId"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return isNonEmptyString(value.organizationId) && isNonEmptyString(value.intakeSensitivityProfileId);
}

function validateCreateInput(input) {
  const allowedKeys = new Set(["identity", "actorUserId", "now", "metadataOnlyAudit"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isSourceCandidateIdentity(input.identity) &&
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
 * is authorized to depend on: full lineage (intake_file_id, file_profile_id,
 * data_dictionary_id, profile_canonical_sha256) plus the same VAL-FUP-001-P0
 * fail-closed predicate columns P1-06 already reads. Never the raw dictionary or
 * profile content.
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

/**
 * Same fail-closed creation-trigger predicate P1-06 already enforces against the
 * same P1-05 row: human review required, and public/funder/LLM/product-learning use
 * all still denied, with retention still restricted pending review. Never relaxed
 * or partially satisfied.
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

async function readScopedCandidateByIdentity(tx, organizationId, intakeSensitivityProfileId) {
  const result = await tx.query(
    `SELECT intake_source_candidate_id::text AS intake_source_candidate_id,
            organization_id::text AS organization_id,
            intake_file_id::text AS intake_file_id,
            file_profile_id::text AS file_profile_id,
            data_dictionary_id::text AS data_dictionary_id,
            intake_sensitivity_profile_id::text AS intake_sensitivity_profile_id,
            profile_canonical_sha256,
            proposed_source_type,
            candidate_status,
            created_at
       FROM kai.intake_source_candidates
      WHERE organization_id = $1::uuid
        AND intake_sensitivity_profile_id = $2::uuid
      FOR UPDATE`,
    [organizationId, intakeSensitivityProfileId],
  );
  return result.rows[0] ?? null;
}

async function insertCandidateIfAbsent(tx, candidate) {
  const result = await tx.query(
    `INSERT INTO kai.intake_source_candidates (
       organization_id,
       intake_file_id,
       file_profile_id,
       data_dictionary_id,
       intake_sensitivity_profile_id,
       profile_canonical_sha256,
       proposed_source_type,
       candidate_status,
       created_by,
       created_by_type
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (organization_id, intake_sensitivity_profile_id)
       DO NOTHING
     RETURNING intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
               data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256,
               proposed_source_type, candidate_status, created_at`,
    [
      candidate.organizationId,
      candidate.intakeFileId,
      candidate.fileProfileId,
      candidate.dataDictionaryId,
      candidate.intakeSensitivityProfileId,
      candidate.profileCanonicalSha256,
      SOURCE_CANDIDATE_PROPOSED_SOURCE_TYPE,
      SOURCE_CANDIDATE_STATUS,
      candidate.createdBy || null,
      candidate.createdByType || "system",
    ],
  );
  return result.rows[0] ?? null;
}

async function insertSourceCandidateReviewQueueItemIfAbsent(tx, item) {
  const result = await tx.query(
    `INSERT INTO kai.review_queue_items (
       organization_id,
       queue_type,
       target_object_type,
       target_object_id,
       priority,
       queue_status,
       review_status,
       summary,
       required_action,
       queue_metadata,
       created_by,
       created_by_type
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
     ON CONFLICT (organization_id, queue_type, target_object_type, target_object_id)
       WHERE queue_type = 'source_candidate_review'
       DO NOTHING
     RETURNING review_queue_item_id, organization_id, queue_type, queue_status, target_object_type,
               target_object_id, queue_metadata`,
    [
      item.organizationId,
      SOURCE_CANDIDATE_REVIEW_QUEUE_TYPE,
      SOURCE_CANDIDATE_REVIEW_TARGET_OBJECT_TYPE,
      item.targetObjectId,
      SOURCE_CANDIDATE_REVIEW_PRIORITY,
      SOURCE_CANDIDATE_REVIEW_QUEUE_STATUS,
      "needs_gk_review",
      SOURCE_CANDIDATE_REVIEW_SUMMARY,
      SOURCE_CANDIDATE_REVIEW_REQUIRED_ACTION,
      JSON.stringify(SOURCE_CANDIDATE_REVIEW_QUEUE_METADATA),
      item.createdBy || null,
      item.createdByType || "system",
    ],
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

function rowToCandidateRecord(row) {
  return {
    intake_source_candidate_id: row.intake_source_candidate_id,
    organization_id: row.organization_id,
    intake_file_id: row.intake_file_id,
    file_profile_id: row.file_profile_id,
    data_dictionary_id: row.data_dictionary_id,
    intake_sensitivity_profile_id: row.intake_sensitivity_profile_id,
    profile_canonical_sha256: row.profile_canonical_sha256,
    proposed_source_type: row.proposed_source_type,
    candidate_status: row.candidate_status,
    created_at: asIso(row.created_at),
  };
}

function rowToReviewQueueRecord(row) {
  return {
    review_queue_item_id: row.review_queue_item_id,
    organization_id: row.organization_id,
    queue_type: row.queue_type,
    target_object_type: row.target_object_type,
    target_object_id: row.target_object_id,
    queue_status: row.queue_status,
    queue_metadata: row.queue_metadata,
  };
}

function isSafeCandidateRecordShape(record) {
  return (
    isNonEmptyString(record.intake_source_candidate_id) &&
    isNonEmptyString(record.organization_id) &&
    isNonEmptyString(record.intake_file_id) &&
    isNonEmptyString(record.file_profile_id) &&
    isNonEmptyString(record.data_dictionary_id) &&
    isNonEmptyString(record.intake_sensitivity_profile_id) &&
    isNonEmptyString(record.profile_canonical_sha256) &&
    isNonEmptyString(record.proposed_source_type) &&
    isNonEmptyString(record.candidate_status)
  );
}

function isSafeReviewQueueRecordShape(record) {
  return (
    isNonEmptyString(record.review_queue_item_id) &&
    isNonEmptyString(record.organization_id) &&
    isNonEmptyString(record.queue_type) &&
    isNonEmptyString(record.target_object_type) &&
    isNonEmptyString(record.target_object_id) &&
    isNonEmptyString(record.queue_status)
  );
}

/**
 * Replay validates only tenant scope and the immutable creation identity (never any
 * later-authorized mutable field this package does not implement a workflow for).
 */
function validateReplayedCandidateRow(row, profileRow) {
  if (!row) return { ok: false, code: "system_error" };
  const record = rowToCandidateRecord(row);
  if (!isSafeCandidateRecordShape(record)) return { ok: false, code: "system_error" };
  if (
    record.organization_id !== profileRow.organization_id ||
    record.intake_sensitivity_profile_id !== profileRow.intake_sensitivity_profile_id ||
    record.intake_file_id !== profileRow.intake_file_id ||
    record.file_profile_id !== profileRow.file_profile_id ||
    record.data_dictionary_id !== profileRow.data_dictionary_id ||
    record.profile_canonical_sha256 !== profileRow.profile_canonical_sha256
  ) {
    return { ok: false, code: "conflict_current_state_changed" };
  }
  return { ok: true, record };
}

function validateReplayedReviewQueueRow(row, candidateRecord) {
  if (!row) return { ok: false, code: "system_error" };
  const record = rowToReviewQueueRecord(row);
  if (!isSafeReviewQueueRecordShape(record)) return { ok: false, code: "system_error" };
  if (
    record.organization_id !== candidateRecord.organization_id ||
    record.queue_type !== SOURCE_CANDIDATE_REVIEW_QUEUE_TYPE ||
    record.target_object_type !== SOURCE_CANDIDATE_REVIEW_TARGET_OBJECT_TYPE ||
    record.target_object_id !== candidateRecord.intake_source_candidate_id
  ) {
    return { ok: false, code: "conflict_current_state_changed" };
  }
  return { ok: true, record };
}

/**
 * A newly inserted candidate row is validated in full against every server-pinned
 * field before its review item or required audit is prepared.
 */
function isValidInsertedCandidateRecord(record, profileRow) {
  return (
    record.organization_id === profileRow.organization_id &&
    record.intake_file_id === profileRow.intake_file_id &&
    record.file_profile_id === profileRow.file_profile_id &&
    record.data_dictionary_id === profileRow.data_dictionary_id &&
    record.intake_sensitivity_profile_id === profileRow.intake_sensitivity_profile_id &&
    record.profile_canonical_sha256 === profileRow.profile_canonical_sha256 &&
    record.proposed_source_type === SOURCE_CANDIDATE_PROPOSED_SOURCE_TYPE &&
    record.candidate_status === SOURCE_CANDIDATE_STATUS
  );
}

function isValidInsertedReviewQueueRecord(record, candidateRecord) {
  return (
    record.organization_id === candidateRecord.organization_id &&
    record.queue_type === SOURCE_CANDIDATE_REVIEW_QUEUE_TYPE &&
    record.target_object_type === SOURCE_CANDIDATE_REVIEW_TARGET_OBJECT_TYPE &&
    record.target_object_id === candidateRecord.intake_source_candidate_id &&
    record.queue_status === SOURCE_CANDIDATE_REVIEW_QUEUE_STATUS &&
    isPlainObject(record.queue_metadata) &&
    record.queue_metadata.p0_stub === true
  );
}

class MalformedInsertedRowError extends Error {
  constructor(what) {
    super(`inserted ${what} row failed validation`);
    this.name = "MalformedInsertedRowError";
  }
}

/**
 * Rejection of the required metadata-only audit must roll back both the candidate
 * insert and the review-item insert in the same transaction, so it is raised as an
 * error rather than returned.
 */
class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

function buildSourceCandidateAuditMetadata(candidateRecord, queueRecord) {
  return {
    metadata_only: true,
    contract: SOURCE_CANDIDATE_AUDIT_CONTRACT,
    intake_sensitivity_profile_id: candidateRecord.intake_sensitivity_profile_id,
    profile_canonical_sha256: candidateRecord.profile_canonical_sha256,
    proposed_source_type: candidateRecord.proposed_source_type,
    candidate_status: candidateRecord.candidate_status,
    queue_type: queueRecord.queue_type,
    target_object_type: queueRecord.target_object_type,
    target_object_id: queueRecord.target_object_id,
    queue_status: queueRecord.queue_status,
    validator_key: SOURCE_CANDIDATE_VALIDATOR_KEY,
  };
}

function buildSourceCandidateAuditPayload(candidateRecord, queueRecord) {
  return {
    attempted_operation: SOURCE_CANDIDATE_AUDIT_OPERATION,
    actor_type: "human",
    contract: SOURCE_CANDIDATE_AUDIT_CONTRACT,
    object_type: "intake_source_candidate",
    request_scope: "organization_intake_sensitivity_profile",
    route_contract: "unwired_synthetic_intake_source_candidate",
    sprint_phase: "kai_sprint2_p1_07",
    validator_key: SOURCE_CANDIDATE_VALIDATOR_KEY,
    candidate_status: candidateRecord.candidate_status,
    queue_status: queueRecord.queue_status,
  };
}

/**
 * Preserves the exact own-boolean-data-property audit predicate established by
 * P1-05's/P1-06's `prepareRequiredAudit`: an own-property descriptor read (never a
 * getter) whose `value` is exactly `true`, alongside a callable `publish`.
 */
function prepareRequiredAudit(metadataOnlyAudit, candidateRecord, queueRecord) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: buildSourceCandidateAuditPayload(candidateRecord, queueRecord),
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

async function insertAudit(tx, { organizationId, intakeFileId, uploadState, metadata, now }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'success', $6::jsonb, $7::timestamptz)`,
    [organizationId, intakeFileId, SOURCE_CANDIDATE_AUDIT_OPERATION, uploadState, uploadState, JSON.stringify(metadata), now],
  );
}

function shapeSourceCandidateError(error) {
  if (error instanceof MalformedInsertedRowError) return sourceCandidateFailure("system_error");
  if (error instanceof RequiredAuditRejectedError) return sourceCandidateFailure("validation_blocker");
  if (error?.code === "23503") return sourceCandidateFailure("not_found");
  if (error?.code === "23514" || error?.code === "P0001" || error?.code === "22P02") {
    return sourceCandidateFailure("validation_blocker");
  }
  return sourceCandidateFailure("system_error");
}

export function createPostgresSourceCandidateRepository({
  runInTransaction = withTransaction,
  beforeInsert = async () => {},
} = {}) {
  return Object.freeze({
    /**
     * Organization-scoped idempotent create/replay of one metadata-only source
     * candidate plus its 'source_candidate_review' item, keyed by the accepted
     * P1-07 identity (organizationId + intakeSensitivityProfileId). Every lineage
     * and VAL-KAI-P1-07-001 predicate fact is always re-read from the authoritative
     * committed `kai.intake_sensitivity_profiles` row; the caller cannot provide or
     * override lineage, classification, review status, or queue identity.
     *
     * Same identity that already has a matching candidate row: replays it, ensuring
     * (but never duplicating) its review item, and never writing a duplicate audit.
     * Genuinely concurrent identical creation is resolved entirely by PostgreSQL's
     * unique constraints via `INSERT ... ON CONFLICT ... DO NOTHING RETURNING`: the
     * losing transaction observes zero returned rows - never a raised 23505 that
     * would abort its transaction before it could re-read - then re-reads and
     * replays the authoritative committed row. No application-level synchronization
     * primitive is used to coordinate this.
     *
     * `beforeInsert` is a test-only synchronization seam (defaults to a no-op) used
     * to prove genuine cross-transaction convergence; it is never overridden in
     * production wiring.
     */
    async createSourceCandidateStub(input) {
      if (!validateCreateInput(input)) return sourceCandidateFailure("validation_blocker");
      const { identity, actorUserId, now, metadataOnlyAudit } = input;
      try {
        return await runInTransaction(async (tx) => {
          const profileRow = await readScopedSensitivityProfile(
            tx,
            identity.organizationId,
            identity.intakeSensitivityProfileId,
          );
          if (!profileRow) return sourceCandidateFailure("not_found");

          if (!satisfiesCreationTriggerPredicate(profileRow)) {
            return sourceCandidateFailure("validation_blocker");
          }

          const uploadState = await readScopedUploadState(tx, profileRow.organization_id, profileRow.intake_file_id);
          if (!uploadState) return sourceCandidateFailure("not_found");

          let candidateRecord;
          let candidateIsFreshlyCreated = false;

          const existingCandidate = await readScopedCandidateByIdentity(
            tx,
            profileRow.organization_id,
            profileRow.intake_sensitivity_profile_id,
          );

          if (existingCandidate) {
            const replayValidation = validateReplayedCandidateRow(existingCandidate, profileRow);
            if (!replayValidation.ok) return sourceCandidateFailure(replayValidation.code);
            candidateRecord = replayValidation.record;
          } else {
            await beforeInsert();

            const insertedCandidateRow = await insertCandidateIfAbsent(tx, {
              organizationId: profileRow.organization_id,
              intakeFileId: profileRow.intake_file_id,
              fileProfileId: profileRow.file_profile_id,
              dataDictionaryId: profileRow.data_dictionary_id,
              intakeSensitivityProfileId: profileRow.intake_sensitivity_profile_id,
              profileCanonicalSha256: profileRow.profile_canonical_sha256,
              createdBy: actorUserId,
              createdByType: "human",
            });

            if (!insertedCandidateRow) {
              // ON CONFLICT ... DO NOTHING returned zero rows: a concurrent
              // transaction won the unique identity constraint and committed first.
              // Re-read the committed authoritative row inside this same
              // transaction and replay it.
              const concurrentCandidate = await readScopedCandidateByIdentity(
                tx,
                profileRow.organization_id,
                profileRow.intake_sensitivity_profile_id,
              );
              const replayValidation = validateReplayedCandidateRow(concurrentCandidate, profileRow);
              if (!replayValidation.ok) return sourceCandidateFailure(replayValidation.code);
              candidateRecord = replayValidation.record;
            } else {
              const record = rowToCandidateRecord(insertedCandidateRow);
              if (!isValidInsertedCandidateRecord(record, profileRow)) {
                throw new MalformedInsertedRowError("intake_source_candidate");
              }
              candidateRecord = record;
              candidateIsFreshlyCreated = true;
            }
          }

          let queueRecord;
          let reviewItemIsFreshlyCreated = false;

          const existingQueueItem = await getScopedSourceCandidateReviewQueueItemByIdentity(
            { organizationId: candidateRecord.organization_id, targetObjectId: candidateRecord.intake_source_candidate_id },
            tx,
          );

          if (existingQueueItem) {
            const replayValidation = validateReplayedReviewQueueRow(existingQueueItem, candidateRecord);
            if (!replayValidation.ok) return sourceCandidateFailure(replayValidation.code);
            queueRecord = replayValidation.record;
          } else {
            const insertedQueueRow = await insertSourceCandidateReviewQueueItemIfAbsent(tx, {
              organizationId: candidateRecord.organization_id,
              targetObjectId: candidateRecord.intake_source_candidate_id,
              createdBy: actorUserId,
              createdByType: "human",
            });

            if (!insertedQueueRow) {
              const concurrentQueueItem = await getScopedSourceCandidateReviewQueueItemByIdentity(
                { organizationId: candidateRecord.organization_id, targetObjectId: candidateRecord.intake_source_candidate_id },
                tx,
              );
              const replayValidation = validateReplayedReviewQueueRow(concurrentQueueItem, candidateRecord);
              if (!replayValidation.ok) return sourceCandidateFailure(replayValidation.code);
              queueRecord = replayValidation.record;
            } else {
              const record = rowToReviewQueueRecord(insertedQueueRow);
              if (!isValidInsertedReviewQueueRecord(record, candidateRecord)) {
                throw new MalformedInsertedRowError("source_candidate_review");
              }
              queueRecord = record;
              reviewItemIsFreshlyCreated = true;
            }
          }

          const replayed = !(candidateIsFreshlyCreated && reviewItemIsFreshlyCreated);

          if (!replayed) {
            const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, candidateRecord, queueRecord);
            await insertAudit(tx, {
              organizationId: profileRow.organization_id,
              intakeFileId: profileRow.intake_file_id,
              uploadState,
              metadata: buildSourceCandidateAuditMetadata(candidateRecord, queueRecord),
              now,
            });
            await preparedAudit.publish();
          }

          return sourceCandidateSuccess({
            sourceCandidate: candidateRecord,
            reviewQueueItem: queueRecord,
            replayed,
          });
        });
      } catch (error) {
        return shapeSourceCandidateError(error);
      }
    },
  });
}

export const __sourceCandidateRepositoryContract = Object.freeze({
  SOURCE_CANDIDATE_PROPOSED_SOURCE_TYPE,
  SOURCE_CANDIDATE_STATUS,
  SOURCE_CANDIDATE_REVIEW_QUEUE_TYPE,
  SOURCE_CANDIDATE_REVIEW_TARGET_OBJECT_TYPE,
  SOURCE_CANDIDATE_REVIEW_PRIORITY,
  SOURCE_CANDIDATE_REVIEW_QUEUE_STATUS,
  SOURCE_CANDIDATE_REVIEW_SUMMARY,
  SOURCE_CANDIDATE_REVIEW_REQUIRED_ACTION,
  SOURCE_CANDIDATE_REVIEW_QUEUE_METADATA,
  SOURCE_CANDIDATE_AUDIT_CONTRACT,
  SOURCE_CANDIDATE_VALIDATOR_KEY,
  SOURCE_CANDIDATE_AUDIT_OPERATION,
});

export const __sourceCandidateRepositoryTestables = Object.freeze({
  prepareRequiredAudit,
  RequiredAuditRejectedError,
  satisfiesCreationTriggerPredicate,
});
