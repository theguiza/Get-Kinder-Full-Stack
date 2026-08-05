import { createHash } from "node:crypto";
import { withTransaction } from "../db/kaiDb.js";
import {
  getScopedSourceCandidateByIdentity,
  getScopedSourceCandidateReviewQueueItemByIdentity,
  getScopedSourcePromotionDecisionByIdentity,
  getScopedSourceByCode,
  getScopedSourceById,
  getScopedSourceVersionByCandidateIdentity,
  getScopedSourceVersionById,
} from "../db/kaiIntakeQueries.js";

/**
 * KAI P1-08 source-promotion repository adapter: human-authorized creation of one
 * `kai.intake_promotion_decisions` row for a complete, immutable P1-07 candidate/
 * review pair, atomically compounded with deterministic `kai.sources` /
 * `kai.source_versions` creation-or-authoritative-replay, the candidate's
 * needs_gk_review -> promoted transition, the review item's open -> resolved
 * transition, and the required metadata-only audit row.
 *
 * This module is the only authorized location for P1-08's own SQL and row
 * locking, other than the reused P1-08 `getScoped*` lookups added to
 * Backend/kai/db/kaiIntakeQueries.js. Decision recording and promotion are not
 * separate operations anywhere in the established P1-06/P1-07 model (there is no
 * prior package that records a decision without also completing its associated
 * write in the same transaction), so this package keeps them compounded in one
 * atomic transaction, exactly like P1-07 compounds its candidate insert and
 * review-item insert. A resolved review item is never itself treated as
 * promotion authority: promotion additionally requires an eligible decision by an
 * authorized mapped human actor (enforced by the service layer) with every
 * validator below satisfied.
 */

const SOURCE_PROMOTION_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

/**
 * P1-08 owner decision: the fixed, non-'unknown' reviewed-source-type vocabulary a
 * human decision may select. No currently authorized producer contract emits an
 * explicit source-type classification (the same absence P1-07 found and disclosed
 * for its own proposed_source_type), so this vocabulary is this package's own
 * disclosed implementation decision, never inferred from a filename, MIME type,
 * field name, sample value, AI output, or external lookup.
 */
const ALLOWED_REVIEWED_SOURCE_TYPES = new Set([
  "organization_primary_record",
  "organization_secondary_record",
  "third_party_provided_record",
  "public_record",
]);

const CANDIDATE_STATUS_NEEDS_REVIEW = "needs_gk_review";
const CANDIDATE_STATUS_PROMOTED = "promoted";

const REVIEW_QUEUE_TYPE = "source_candidate_review";
const REVIEW_TARGET_OBJECT_TYPE = "intake_source_candidate";
const REVIEW_QUEUE_STATUS_OPEN = "open";
const REVIEW_QUEUE_STATUS_RESOLVED = "resolved";
const REVIEW_STATUS_RESOLVED = "resolved";

const DECISION_STATUS_DECIDED = "decided";
const DECISION_STATUS_PROMOTED = "promoted";

const SOURCE_PROMOTION_AUDIT_CONTRACT = "p1_source_promotion_decision_v1";
/**
 * VAL-KAI-P1-08-001 (candidate/review completeness and status predicate),
 * VAL-KAI-P1-08-002 (governance/allowed-use permission predicate, reapplying the
 * exact P1-05/P1-06/P1-07 fail-closed columns rather than inventing a new
 * permission representation), and VAL-KAI-P1-08-003 (explicit reviewed-source-type
 * vocabulary predicate) are P1-08 implementation decisions, chosen as the
 * smallest convention-consistent validator keys for this package. They are not
 * quoted from, and are not claimed to be mandated by, any owner-authorized
 * governing source. The required audit records VAL-KAI-P1-08-001 as the primary
 * disclosed key for this package, matching the P1-07 idiom of citing one
 * validator_key per audit row.
 */
const SOURCE_PROMOTION_VALIDATOR_KEY = "VAL-KAI-P1-08-001";
const SOURCE_PROMOTION_PERMISSION_VALIDATOR_KEY = "VAL-KAI-P1-08-002";
const SOURCE_PROMOTION_TYPE_VALIDATOR_KEY = "VAL-KAI-P1-08-003";
const SOURCE_PROMOTION_AUDIT_OPERATION = "source_promotion_decision_persisted";

function sourcePromotionFailure(code) {
  return {
    ok: false,
    data: null,
    error: {
      code,
      status: SOURCE_PROMOTION_RESULT_STATUS[code],
    },
  };
}

function sourcePromotionSuccess(data) {
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

function isSourcePromotionIdentity(value) {
  const allowedKeys = new Set(["organizationId", "intakeSourceCandidateId"]);
  if (!isPlainObject(value) || !hasOnlyKeys(value, allowedKeys)) return false;
  return isNonEmptyString(value.organizationId) && isNonEmptyString(value.intakeSourceCandidateId);
}

function validateCreateInput(input) {
  const allowedKeys = new Set(["identity", "reviewedSourceType", "actorUserId", "now", "metadataOnlyAudit"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isSourcePromotionIdentity(input.identity) &&
    isNonEmptyString(input.reviewedSourceType) &&
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
 * Deterministic source-code generation (P1-08 owner decision): a sha256 hex
 * digest computed only from immutable, already-committed lineage facts -
 * organizationId, the candidate's intakeSensitivityProfileId, its
 * profileCanonicalSha256, and the human-established reviewedSourceType. Never a
 * filename, MIME type, sample value, AI output, or external lookup. The same
 * inputs always produce the same source_code, which is what makes replay of an
 * existing `kai.sources` row authoritative rather than a fresh classification.
 */
function computeSourceCode({ organizationId, intakeSensitivityProfileId, profileCanonicalSha256, reviewedSourceType }) {
  return createHash("sha256")
    .update(`${organizationId}|${intakeSensitivityProfileId}|${profileCanonicalSha256}|${reviewedSourceType}`)
    .digest("hex");
}

/**
 * Tenant-scoped read of exactly the P1-05 sensitivity-profile columns this package
 * is authorized to depend on, matching the identical read P1-06/P1-07 already
 * perform against the same table.
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
 * VAL-KAI-P1-08-002: this package reapplies the exact fail-closed predicate
 * P1-05/P1-06/P1-07 already enforce against the same P1-05 row, rather than
 * inventing a new allowed-use/consent/governance permission representation. No
 * currently authorized package changes these columns, so promotion is only ever
 * reachable when this identical predicate already holds.
 */
function satisfiesPermissionPredicate(profileRow) {
  return (
    profileRow.human_review_required === true &&
    profileRow.public_use_allowed === false &&
    profileRow.funder_use_allowed === false &&
    profileRow.llm_processing_allowed === false &&
    profileRow.product_learning_allowed === false &&
    profileRow.retention_posture === "restricted_pending_review"
  );
}

/**
 * VAL-KAI-P1-08-003: the reviewed source type must be an explicit, human-decided,
 * non-'unknown' member of the fixed disclosed vocabulary. Never inferred.
 */
function satisfiesReviewedSourceTypePredicate(reviewedSourceType) {
  return reviewedSourceType !== "unknown" && ALLOWED_REVIEWED_SOURCE_TYPES.has(reviewedSourceType);
}

/**
 * VAL-KAI-P1-08-001: a complete, immutable candidate/review pair - the candidate
 * must still be at its P1-07 pinned pre-promotion status, and its matching
 * 'source_candidate_review' item must still be open. A resolved review item is
 * never itself promotion authority: this predicate requires it to still be open,
 * exactly like it was left by the P1-07 seam that created it.
 */
function satisfiesCandidateReviewCompletenessPredicate(candidateRow, reviewItemRow) {
  return (
    candidateRow.candidate_status === CANDIDATE_STATUS_NEEDS_REVIEW &&
    reviewItemRow.queue_status === REVIEW_QUEUE_STATUS_OPEN &&
    reviewItemRow.organization_id === candidateRow.organization_id &&
    reviewItemRow.queue_type === REVIEW_QUEUE_TYPE &&
    reviewItemRow.target_object_type === REVIEW_TARGET_OBJECT_TYPE &&
    reviewItemRow.target_object_id === candidateRow.intake_source_candidate_id
  );
}

/**
 * Matching file, profile, dictionary and sensitivity lineage, and committed
 * checksum: the candidate row's own lineage columns must still match a fresh
 * re-read of its authoritative P1-05 sensitivity-profile row. This never trusts
 * anything the caller supplies.
 */
function satisfiesLineageMatchPredicate(candidateRow, profileRow) {
  return (
    candidateRow.organization_id === profileRow.organization_id &&
    candidateRow.intake_file_id === profileRow.intake_file_id &&
    candidateRow.file_profile_id === profileRow.file_profile_id &&
    candidateRow.data_dictionary_id === profileRow.data_dictionary_id &&
    candidateRow.intake_sensitivity_profile_id === profileRow.intake_sensitivity_profile_id &&
    candidateRow.profile_canonical_sha256 === profileRow.profile_canonical_sha256
  );
}

async function insertDecisionIfAbsent(tx, decision) {
  const result = await tx.query(
    `INSERT INTO kai.intake_promotion_decisions (
       organization_id,
       intake_source_candidate_id,
       review_queue_item_id,
       reviewed_source_type,
       decision_status,
       created_by,
       created_by_type
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (organization_id, intake_source_candidate_id)
       DO NOTHING
     RETURNING intake_promotion_decision_id, organization_id, intake_source_candidate_id,
               review_queue_item_id, reviewed_source_type, decision_status, source_id,
               source_version_id, created_at, decided_at, promoted_at`,
    [
      decision.organizationId,
      decision.intakeSourceCandidateId,
      decision.reviewQueueItemId,
      decision.reviewedSourceType,
      DECISION_STATUS_DECIDED,
      decision.createdBy || null,
      decision.createdByType || "human",
    ],
  );
  return result.rows[0] ?? null;
}

async function insertSourceIfAbsent(tx, source) {
  const result = await tx.query(
    `INSERT INTO kai.sources (
       organization_id,
       source_code,
       reviewed_source_type,
       created_by,
       created_by_type
     ) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (organization_id, source_code)
       DO NOTHING
     RETURNING source_id, organization_id, source_code, reviewed_source_type, created_at`,
    [source.organizationId, source.sourceCode, source.reviewedSourceType, source.createdBy || null, source.createdByType || "human"],
  );
  return result.rows[0] ?? null;
}

async function insertSourceVersionIfAbsent(tx, version) {
  const result = await tx.query(
    `INSERT INTO kai.source_versions (
       organization_id,
       source_id,
       intake_source_candidate_id,
       intake_sensitivity_profile_id,
       profile_canonical_sha256,
       is_current,
       created_by,
       created_by_type
     ) VALUES ($1,$2,$3,$4,$5,true,$6,$7)
     ON CONFLICT (organization_id, intake_source_candidate_id)
       DO NOTHING
     RETURNING source_version_id, organization_id, source_id, intake_source_candidate_id,
               intake_sensitivity_profile_id, profile_canonical_sha256, is_current, created_at`,
    [
      version.organizationId,
      version.sourceId,
      version.intakeSourceCandidateId,
      version.intakeSensitivityProfileId,
      version.profileCanonicalSha256,
      version.createdBy || null,
      version.createdByType || "human",
    ],
  );
  return result.rows[0] ?? null;
}

async function promoteCandidateIfCurrent(tx, { organizationId, intakeSourceCandidateId }) {
  const result = await tx.query(
    `UPDATE kai.intake_source_candidates
        SET candidate_status = $3
      WHERE organization_id = $1::uuid
        AND intake_source_candidate_id = $2::uuid
        AND candidate_status = $4
      RETURNING intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
                data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256,
                proposed_source_type, candidate_status, created_at`,
    [organizationId, intakeSourceCandidateId, CANDIDATE_STATUS_PROMOTED, CANDIDATE_STATUS_NEEDS_REVIEW],
  );
  return result.rows[0] ?? null;
}

async function resolveReviewQueueItemIfOpen(tx, { organizationId, reviewQueueItemId }) {
  const result = await tx.query(
    `UPDATE kai.review_queue_items
        SET queue_status = $3,
            review_status = $4
      WHERE organization_id = $1::uuid
        AND review_queue_item_id = $2::uuid
        AND queue_status = $5
      RETURNING review_queue_item_id, organization_id, queue_type, target_object_type,
                target_object_id, queue_status, review_status`,
    [organizationId, reviewQueueItemId, REVIEW_QUEUE_STATUS_RESOLVED, REVIEW_STATUS_RESOLVED, REVIEW_QUEUE_STATUS_OPEN],
  );
  return result.rows[0] ?? null;
}

async function promoteDecisionIfDecided(tx, { organizationId, intakePromotionDecisionId, sourceId, sourceVersionId, promotedAt }) {
  const result = await tx.query(
    `UPDATE kai.intake_promotion_decisions
        SET decision_status = $3,
            source_id = $4::uuid,
            source_version_id = $5::uuid,
            promoted_at = $6::timestamptz
      WHERE organization_id = $1::uuid
        AND intake_promotion_decision_id = $2::uuid
        AND decision_status = $7
      RETURNING intake_promotion_decision_id, organization_id, intake_source_candidate_id,
                review_queue_item_id, reviewed_source_type, decision_status, source_id,
                source_version_id, created_at, decided_at, promoted_at`,
    [organizationId, intakePromotionDecisionId, DECISION_STATUS_PROMOTED, sourceId, sourceVersionId, promotedAt, DECISION_STATUS_DECIDED],
  );
  return result.rows[0] ?? null;
}

function rowToDecisionRecord(row) {
  return {
    intake_promotion_decision_id: row.intake_promotion_decision_id,
    organization_id: row.organization_id,
    intake_source_candidate_id: row.intake_source_candidate_id,
    review_queue_item_id: row.review_queue_item_id,
    reviewed_source_type: row.reviewed_source_type,
    decision_status: row.decision_status,
    source_id: row.source_id,
    source_version_id: row.source_version_id,
    created_at: asIso(row.created_at),
    decided_at: asIso(row.decided_at),
    promoted_at: asIso(row.promoted_at),
  };
}

function rowToSourceRecord(row) {
  return {
    source_id: row.source_id,
    organization_id: row.organization_id,
    source_code: row.source_code,
    reviewed_source_type: row.reviewed_source_type,
    created_at: asIso(row.created_at),
  };
}

function rowToSourceVersionRecord(row) {
  return {
    source_version_id: row.source_version_id,
    organization_id: row.organization_id,
    source_id: row.source_id,
    intake_source_candidate_id: row.intake_source_candidate_id,
    intake_sensitivity_profile_id: row.intake_sensitivity_profile_id,
    profile_canonical_sha256: row.profile_canonical_sha256,
    is_current: row.is_current,
    created_at: asIso(row.created_at),
  };
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
    review_status: row.review_status ?? null,
  };
}

class MalformedInsertedRowError extends Error {
  constructor(what) {
    super(`inserted ${what} row failed validation`);
    this.name = "MalformedInsertedRowError";
  }
}

class ConcurrentStateChangedError extends Error {
  constructor(what) {
    super(`${what} changed concurrently during promotion`);
    this.name = "ConcurrentStateChangedError";
  }
}

/**
 * Rejection of the required metadata-only audit must roll back every mutation
 * performed in this operation, so it is raised as an error rather than returned.
 */
class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

function buildSourcePromotionAuditMetadata({ decisionRecord, candidateRecord, reviewQueueRecord }) {
  return {
    metadata_only: true,
    contract: SOURCE_PROMOTION_AUDIT_CONTRACT,
    intake_source_candidate_id: decisionRecord.intake_source_candidate_id,
    intake_sensitivity_profile_id: candidateRecord.intake_sensitivity_profile_id,
    profile_canonical_sha256: candidateRecord.profile_canonical_sha256,
    reviewed_source_type: decisionRecord.reviewed_source_type,
    decision_status: decisionRecord.decision_status,
    candidate_status: candidateRecord.candidate_status,
    queue_status: reviewQueueRecord.queue_status,
    source_id: decisionRecord.source_id,
    source_version_id: decisionRecord.source_version_id,
    validator_key: SOURCE_PROMOTION_VALIDATOR_KEY,
  };
}

function buildSourcePromotionAuditPayload({ decisionRecord, candidateRecord, reviewQueueRecord }) {
  return {
    attempted_operation: SOURCE_PROMOTION_AUDIT_OPERATION,
    actor_type: "human",
    contract: SOURCE_PROMOTION_AUDIT_CONTRACT,
    object_type: "intake_promotion_decision",
    request_scope: "organization_intake_source_candidate",
    route_contract: "unwired_synthetic_source_promotion_decision",
    sprint_phase: "kai_sprint2_p1_08",
    validator_key: SOURCE_PROMOTION_VALIDATOR_KEY,
    decision_status: decisionRecord.decision_status,
    candidate_status: candidateRecord.candidate_status,
    queue_status: reviewQueueRecord.queue_status,
  };
}

/**
 * Preserves the exact own-boolean-data-property audit predicate established by
 * P1-05/P1-06/P1-07's `prepareRequiredAudit`: an own-property descriptor read
 * (never a getter) whose `value` is exactly `true`, alongside a callable `publish`.
 */
function prepareRequiredAudit(metadataOnlyAudit, context) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: buildSourcePromotionAuditPayload(context),
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

async function insertAudit(tx, { organizationId, intakeFileId, uploadState, metadata, now }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'success', $6::jsonb, $7::timestamptz)`,
    [organizationId, intakeFileId, SOURCE_PROMOTION_AUDIT_OPERATION, uploadState, uploadState, JSON.stringify(metadata), now],
  );
}

function shapeSourcePromotionError(error) {
  if (error instanceof MalformedInsertedRowError) return sourcePromotionFailure("system_error");
  if (error instanceof ConcurrentStateChangedError) return sourcePromotionFailure("conflict_current_state_changed");
  if (error instanceof RequiredAuditRejectedError) return sourcePromotionFailure("validation_blocker");
  if (error?.code === "23503") return sourcePromotionFailure("not_found");
  if (error?.code === "23514" || error?.code === "P0001" || error?.code === "22P02") {
    return sourcePromotionFailure("validation_blocker");
  }
  return sourcePromotionFailure("system_error");
}

/**
 * Replay validates only tenant scope and the immutable decision identity/lineage
 * fact recorded at creation (organization_id, intake_source_candidate_id,
 * reviewed_source_type) plus the promoted binding - never any later field this
 * package does not implement a workflow for.
 */
function validateReplayedDecisionRow(row, identity, reviewedSourceType) {
  if (!row) return { ok: false, code: "system_error" };
  const record = rowToDecisionRecord(row);
  if (
    !isNonEmptyString(record.intake_promotion_decision_id) ||
    !isNonEmptyString(record.organization_id) ||
    !isNonEmptyString(record.intake_source_candidate_id) ||
    !isNonEmptyString(record.reviewed_source_type) ||
    !isNonEmptyString(record.decision_status)
  ) {
    return { ok: false, code: "system_error" };
  }
  if (
    record.organization_id !== identity.organizationId ||
    record.intake_source_candidate_id !== identity.intakeSourceCandidateId ||
    record.decision_status !== DECISION_STATUS_PROMOTED ||
    record.reviewed_source_type !== reviewedSourceType ||
    !isNonEmptyString(record.source_id) ||
    !isNonEmptyString(record.source_version_id)
  ) {
    return { ok: false, code: "conflict_current_state_changed" };
  }
  return { ok: true, record };
}

/**
 * Assembles the full replay payload for an already-promoted decision: reads back
 * the candidate, review item, source, and source_version rows the decision itself
 * already binds to, with no mutation and no audit activity.
 */
async function buildReplayPayload(tx, identity, decisionRecord) {
  const candidateRow = await getScopedSourceCandidateByIdentity(identity, tx);
  const reviewItemRow = candidateRow
    ? await getScopedSourceCandidateReviewQueueItemByIdentity(
        { organizationId: identity.organizationId, targetObjectId: candidateRow.intake_source_candidate_id },
        tx,
      )
    : null;
  const sourceRow = await getScopedSourceById({ organizationId: identity.organizationId, sourceId: decisionRecord.source_id }, tx);
  const sourceVersionRow = await getScopedSourceVersionById(
    { organizationId: identity.organizationId, sourceVersionId: decisionRecord.source_version_id },
    tx,
  );
  return {
    promotionDecision: decisionRecord,
    sourceCandidate: candidateRow ? rowToCandidateRecord(candidateRow) : null,
    reviewQueueItem: reviewItemRow ? rowToReviewQueueRecord(reviewItemRow) : null,
    source: sourceRow ? rowToSourceRecord(sourceRow) : null,
    sourceVersion: sourceVersionRow ? rowToSourceVersionRecord(sourceVersionRow) : null,
    replayed: true,
  };
}

export function createPostgresSourcePromotionRepository({
  runInTransaction = withTransaction,
  beforeInsert = async () => {},
} = {}) {
  return Object.freeze({
    /**
     * Organization-scoped, human-authorized, idempotent creation of one
     * `kai.intake_promotion_decisions` row for a complete P1-07 candidate/review
     * pair, compounded atomically with deterministic `kai.sources`/
     * `kai.source_versions` creation-or-authoritative-replay, the candidate's and
     * review item's required transitions, and the required metadata-only audit.
     *
     * Same identity (organizationId + intakeSourceCandidateId) that already has a
     * promoted decision bound to the same reviewedSourceType: replays it with zero
     * writes and zero audit activity. Any other pre-existing decision state, or any
     * mismatch against the freshly re-read candidate/review/sensitivity-profile
     * lineage, returns `conflict_current_state_changed` with zero mutation.
     *
     * Genuinely concurrent identical creation is resolved entirely by PostgreSQL's
     * unique constraints via `INSERT ... ON CONFLICT ... DO NOTHING RETURNING` at
     * every step (decision, source, source_version): a losing transaction observes
     * zero returned rows - never a raised 23505 that would abort it before it could
     * re-read - then re-reads and replays the authoritative committed row. No
     * application-level synchronization primitive is used to coordinate this.
     */
    async createSourcePromotionDecision(input) {
      if (!validateCreateInput(input)) return sourcePromotionFailure("validation_blocker");
      const { identity, reviewedSourceType, actorUserId, now, metadataOnlyAudit } = input;
      try {
        return await runInTransaction(async (tx) => {
          const existingDecisionRow = await getScopedSourcePromotionDecisionByIdentity(identity, tx);
          if (existingDecisionRow) {
            const replayValidation = validateReplayedDecisionRow(existingDecisionRow, identity, reviewedSourceType);
            if (!replayValidation.ok) return sourcePromotionFailure(replayValidation.code);
            return sourcePromotionSuccess(await buildReplayPayload(tx, identity, replayValidation.record));
          }

          // Unlike a P1-07-style row this same call creates fresh, the P1-07
          // candidate this call promotes already exists, so its FOR UPDATE lock
          // just below is the real serialization point for two genuinely
          // concurrent promotion attempts on the same identity - not the
          // decision/source/source_version ON CONFLICT inserts further down,
          // which by the time either transaction reaches them can no longer lose
          // a race for this identity. `beforeInsert` (a test-only synchronization
          // seam, never overridden in production) is called here, before that
          // lock is acquired, so a test can rendezvous both transactions before
          // either one blocks on it.
          await beforeInsert();

          const candidateRow = await getScopedSourceCandidateByIdentity(identity, tx);
          if (!candidateRow) return sourcePromotionFailure("not_found");

          if (candidateRow.candidate_status !== CANDIDATE_STATUS_NEEDS_REVIEW) {
            // The candidate row already existed (unlike a P1-07-style row created
            // fresh by this same call), so its FOR UPDATE lock above is the real
            // serialization point for two genuinely concurrent promotion attempts:
            // a losing transaction blocks there until the winner commits, then
            // observes candidate_status = 'promoted' here - never at the decision
            // ON CONFLICT below, which by then can no longer lose a race for this
            // identity. Re-read the now-committed decision and replay it, rather
            // than misreporting a validation_blocker for a call that already
            // succeeded concurrently.
            if (candidateRow.candidate_status === CANDIDATE_STATUS_PROMOTED) {
              const concurrentDecisionRow = await getScopedSourcePromotionDecisionByIdentity(identity, tx);
              const replayValidation = validateReplayedDecisionRow(concurrentDecisionRow, identity, reviewedSourceType);
              if (!replayValidation.ok) return sourcePromotionFailure(replayValidation.code);
              return sourcePromotionSuccess(await buildReplayPayload(tx, identity, replayValidation.record));
            }
            return sourcePromotionFailure("validation_blocker");
          }

          if (!satisfiesReviewedSourceTypePredicate(reviewedSourceType)) {
            return sourcePromotionFailure("validation_blocker");
          }

          const reviewItemRow = await getScopedSourceCandidateReviewQueueItemByIdentity(
            { organizationId: candidateRow.organization_id, targetObjectId: candidateRow.intake_source_candidate_id },
            tx,
          );
          if (!reviewItemRow) return sourcePromotionFailure("not_found");

          if (!satisfiesCandidateReviewCompletenessPredicate(candidateRow, reviewItemRow)) {
            return sourcePromotionFailure("validation_blocker");
          }

          const profileRow = await readScopedSensitivityProfile(tx, candidateRow.organization_id, candidateRow.intake_sensitivity_profile_id);
          if (!profileRow) return sourcePromotionFailure("not_found");

          if (!satisfiesLineageMatchPredicate(candidateRow, profileRow)) {
            return sourcePromotionFailure("conflict_current_state_changed");
          }

          if (!satisfiesPermissionPredicate(profileRow)) {
            return sourcePromotionFailure("validation_blocker");
          }

          const uploadState = await readScopedUploadState(tx, candidateRow.organization_id, candidateRow.intake_file_id);
          if (!uploadState) return sourcePromotionFailure("not_found");

          const sourceCode = computeSourceCode({
            organizationId: candidateRow.organization_id,
            intakeSensitivityProfileId: candidateRow.intake_sensitivity_profile_id,
            profileCanonicalSha256: candidateRow.profile_canonical_sha256,
            reviewedSourceType,
          });

          const insertedDecisionRow = await insertDecisionIfAbsent(tx, {
            organizationId: candidateRow.organization_id,
            intakeSourceCandidateId: candidateRow.intake_source_candidate_id,
            reviewQueueItemId: reviewItemRow.review_queue_item_id,
            reviewedSourceType,
            createdBy: actorUserId,
            createdByType: "human",
          });

          if (!insertedDecisionRow) {
            // ON CONFLICT ... DO NOTHING returned zero rows: a concurrent
            // transaction won the decision identity constraint. PostgreSQL blocks
            // this re-read behind that winner's row lock until it commits or rolls
            // back, so by the time this re-read returns, the winner's promotion
            // (decided -> promoted, same transaction) is either fully committed or
            // fully rolled back.
            const concurrentDecisionRow = await getScopedSourcePromotionDecisionByIdentity(identity, tx);
            const replayValidation = validateReplayedDecisionRow(concurrentDecisionRow, identity, reviewedSourceType);
            if (!replayValidation.ok) return sourcePromotionFailure(replayValidation.code);
            return sourcePromotionSuccess(await buildReplayPayload(tx, identity, replayValidation.record));
          }

          const decisionRecord = rowToDecisionRecord(insertedDecisionRow);

          let sourceRecord;
          const existingSourceRow = await getScopedSourceByCode({ organizationId: candidateRow.organization_id, sourceCode }, tx);
          if (existingSourceRow) {
            if (existingSourceRow.reviewed_source_type !== reviewedSourceType) {
              throw new ConcurrentStateChangedError("source");
            }
            sourceRecord = rowToSourceRecord(existingSourceRow);
          } else {
            const insertedSourceRow = await insertSourceIfAbsent(tx, {
              organizationId: candidateRow.organization_id,
              sourceCode,
              reviewedSourceType,
              createdBy: actorUserId,
              createdByType: "human",
            });
            if (!insertedSourceRow) {
              const concurrentSourceRow = await getScopedSourceByCode({ organizationId: candidateRow.organization_id, sourceCode }, tx);
              if (!concurrentSourceRow || concurrentSourceRow.reviewed_source_type !== reviewedSourceType) {
                throw new ConcurrentStateChangedError("source");
              }
              sourceRecord = rowToSourceRecord(concurrentSourceRow);
            } else {
              const record = rowToSourceRecord(insertedSourceRow);
              if (record.organization_id !== candidateRow.organization_id || record.source_code !== sourceCode || record.reviewed_source_type !== reviewedSourceType) {
                throw new MalformedInsertedRowError("sources");
              }
              sourceRecord = record;
            }
          }

          let sourceVersionRecord;
          const insertedSourceVersionRow = await insertSourceVersionIfAbsent(tx, {
            organizationId: candidateRow.organization_id,
            sourceId: sourceRecord.source_id,
            intakeSourceCandidateId: candidateRow.intake_source_candidate_id,
            intakeSensitivityProfileId: candidateRow.intake_sensitivity_profile_id,
            profileCanonicalSha256: candidateRow.profile_canonical_sha256,
            createdBy: actorUserId,
            createdByType: "human",
          });
          if (!insertedSourceVersionRow) {
            const concurrentVersionRow = await getScopedSourceVersionByCandidateIdentity(identity, tx);
            if (!concurrentVersionRow || concurrentVersionRow.source_id !== sourceRecord.source_id) {
              throw new ConcurrentStateChangedError("source_version");
            }
            sourceVersionRecord = rowToSourceVersionRecord(concurrentVersionRow);
          } else {
            const record = rowToSourceVersionRecord(insertedSourceVersionRow);
            if (
              record.source_id !== sourceRecord.source_id ||
              record.intake_source_candidate_id !== candidateRow.intake_source_candidate_id ||
              record.intake_sensitivity_profile_id !== candidateRow.intake_sensitivity_profile_id ||
              record.profile_canonical_sha256 !== candidateRow.profile_canonical_sha256 ||
              record.is_current !== true
            ) {
              throw new MalformedInsertedRowError("source_versions");
            }
            sourceVersionRecord = record;
          }

          const promotedCandidateRow = await promoteCandidateIfCurrent(tx, {
            organizationId: candidateRow.organization_id,
            intakeSourceCandidateId: candidateRow.intake_source_candidate_id,
          });
          if (!promotedCandidateRow) throw new ConcurrentStateChangedError("intake_source_candidate");
          const candidateRecord = rowToCandidateRecord(promotedCandidateRow);

          const resolvedReviewItemRow = await resolveReviewQueueItemIfOpen(tx, {
            organizationId: candidateRow.organization_id,
            reviewQueueItemId: reviewItemRow.review_queue_item_id,
          });
          if (!resolvedReviewItemRow) throw new ConcurrentStateChangedError("review_queue_item");
          const reviewQueueRecord = rowToReviewQueueRecord(resolvedReviewItemRow);

          const promotedDecisionRow = await promoteDecisionIfDecided(tx, {
            organizationId: candidateRow.organization_id,
            intakePromotionDecisionId: decisionRecord.intake_promotion_decision_id,
            sourceId: sourceRecord.source_id,
            sourceVersionId: sourceVersionRecord.source_version_id,
            promotedAt: now,
          });
          if (!promotedDecisionRow) throw new MalformedInsertedRowError("intake_promotion_decisions");
          const finalDecisionRecord = rowToDecisionRecord(promotedDecisionRow);

          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, {
            decisionRecord: finalDecisionRecord,
            candidateRecord,
            reviewQueueRecord,
          });
          await insertAudit(tx, {
            organizationId: candidateRow.organization_id,
            intakeFileId: candidateRow.intake_file_id,
            uploadState,
            metadata: buildSourcePromotionAuditMetadata({
              decisionRecord: finalDecisionRecord,
              candidateRecord,
              reviewQueueRecord,
            }),
            now,
          });
          await preparedAudit.publish();

          return sourcePromotionSuccess({
            promotionDecision: finalDecisionRecord,
            sourceCandidate: candidateRecord,
            reviewQueueItem: reviewQueueRecord,
            source: sourceRecord,
            sourceVersion: sourceVersionRecord,
            replayed: false,
          });
        });
      } catch (error) {
        return shapeSourcePromotionError(error);
      }
    },
  });
}

export const __sourcePromotionRepositoryContract = Object.freeze({
  ALLOWED_REVIEWED_SOURCE_TYPES: Object.freeze([...ALLOWED_REVIEWED_SOURCE_TYPES]),
  CANDIDATE_STATUS_NEEDS_REVIEW,
  CANDIDATE_STATUS_PROMOTED,
  REVIEW_QUEUE_TYPE,
  REVIEW_TARGET_OBJECT_TYPE,
  REVIEW_QUEUE_STATUS_OPEN,
  REVIEW_QUEUE_STATUS_RESOLVED,
  DECISION_STATUS_DECIDED,
  DECISION_STATUS_PROMOTED,
  SOURCE_PROMOTION_AUDIT_CONTRACT,
  SOURCE_PROMOTION_VALIDATOR_KEY,
  SOURCE_PROMOTION_PERMISSION_VALIDATOR_KEY,
  SOURCE_PROMOTION_TYPE_VALIDATOR_KEY,
  SOURCE_PROMOTION_AUDIT_OPERATION,
});

export const __sourcePromotionRepositoryTestables = Object.freeze({
  prepareRequiredAudit,
  RequiredAuditRejectedError,
  ConcurrentStateChangedError,
  MalformedInsertedRowError,
  satisfiesPermissionPredicate,
  satisfiesReviewedSourceTypePredicate,
  satisfiesCandidateReviewCompletenessPredicate,
  satisfiesLineageMatchPredicate,
  computeSourceCode,
});
