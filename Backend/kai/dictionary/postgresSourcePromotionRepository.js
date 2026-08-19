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
 * KAI P1-08 source-promotion repository adapter: human-authorized creation (or
 * permitted follow-up transition) of one `kai.intake_promotion_decisions` row for
 * a complete, immutable P1-07 candidate/review pair, atomically compounded with
 * whatever side effects its requested outcome requires.
 *
 * P1-08 CORRECTION (this file): the original single-outcome ('promoted'-only)
 * model is replaced with three owner-authorized outcomes -
 * 'needs_more_information', 'rejected', and 'promoted' - reachable via exactly
 * these transitions:
 *   null -> needs_more_information
 *   null -> rejected
 *   null -> promoted
 *   needs_more_information -> rejected
 *   needs_more_information -> promoted
 * Every other requested transition (rejected/promoted -> anything, or a
 * needs_more_information -> X racing an incompatible needs_more_information -> Y)
 * returns `conflict_current_state_changed` with zero mutation, resolved via an
 * authoritative reread-and-compare-and-set - never a raced blind UPDATE.
 * Identical replay (same identity, same requested outcome, same recorded facts)
 * performs zero writes and zero audit, returning the current row's data - the
 * same idiom the original promoted-only replay path already established.
 *
 * This module is the only authorized location for P1-08's own SQL and row
 * locking, other than the reused P1-08 `getScoped*` lookups added to
 * Backend/kai/db/kaiIntakeQueries.js. A resolved review item is never itself
 * treated as promotion authority: promotion additionally requires an eligible
 * decision by an authorized mapped human actor (enforced by the service layer)
 * with every validator below satisfied.
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
 * field name, sample value, AI output, or external lookup. Only required for the
 * 'promoted' outcome.
 */
const ALLOWED_REVIEWED_SOURCE_TYPES = new Set([
  "organization_primary_record",
  "organization_secondary_record",
  "third_party_provided_record",
  "public_record",
]);

const CANDIDATE_STATUS_NEEDS_REVIEW = "needs_gk_review";
const CANDIDATE_STATUS_PROMOTED = "promoted";
const CANDIDATE_STATUS_REJECTED = "rejected";

const REVIEW_QUEUE_TYPE = "source_candidate_review";
const REVIEW_TARGET_OBJECT_TYPE = "intake_source_candidate";
const REVIEW_QUEUE_STATUS_OPEN = "open";
const REVIEW_QUEUE_STATUS_WAITING_ON_CLIENT = "waiting_on_client";
const REVIEW_QUEUE_STATUS_RESOLVED = "resolved";
const REVIEW_STATUS_RESOLVED = "resolved";

/**
 * P1-08 CORRECTION: the decision outcome vocabulary. These are also the exact
 * values stored in `decision_status` - there is no longer a transient 'decided'
 * value. `outcome` is the public input field name used consistently across the
 * service, this repository, and their tests.
 */
const DECISION_STATUS_NEEDS_MORE_INFORMATION = "needs_more_information";
const DECISION_STATUS_REJECTED = "rejected";
const DECISION_STATUS_PROMOTED = "promoted";
const ALLOWED_DECISION_OUTCOMES = new Set([
  DECISION_STATUS_NEEDS_MORE_INFORMATION,
  DECISION_STATUS_REJECTED,
  DECISION_STATUS_PROMOTED,
]);

/**
 * P1-08 owner decision: the fixed literal required_action set on the review item
 * when a decision reaches 'needs_more_information'. Never templated from caller
 * input - the caller does not, and cannot, supply required_action.
 */
const REQUIRED_ACTION_NEEDS_MORE_INFORMATION =
  "Obtain the missing client information before reconsidering source promotion.";

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

/**
 * Diagnostic-only exact_verification_phase tokens: non-sensitive, stable labels
 * identifying which materially distinct validation_blocker branch produced a
 * given failure result. These carry no SQL, row data, or infrastructure detail -
 * only which fail-closed predicate or error-shaping branch was hit. They ride
 * the existing `data` propagation convention already used by GCS upload
 * verification (see sprint2IntakeApi.js's EXACT_VERIFICATION_PHASE_PATTERN) and
 * do not change `error.code`, `blockers`, or HTTP status for any branch.
 */
const SOURCE_PROMOTION_EXACT_VERIFICATION_PHASE = Object.freeze({
  REPOSITORY_INPUT_SHAPE: "source_promotion_repository_input_shape",
  REQUIRED_AUDIT_REJECTED: "source_promotion_required_audit_rejected",
  DB_CONSTRAINT_VIOLATION: "source_promotion_db_constraint_violation",
  REVIEWED_SOURCE_TYPE_INVALID: "source_promotion_reviewed_source_type_invalid",
  PERMISSION_PREDICATE_FAILED: "source_promotion_permission_predicate_failed",
  CANDIDATE_REVIEW_INCOMPLETE: "source_promotion_candidate_review_incomplete",
});

/**
 * Query-level granularity for this module's own single-query helpers (the
 * repository's own SQL, per the module doc comment - never the reused P1-08
 * `getScoped*` lookups in kaiIntakeQueries.js, which remain shared read
 * helpers outside this package's own SQL surface). Each stage identifies
 * exactly one tx.query() call site reachable during the promoted transaction,
 * used only to tag a thrown PostgreSQL error with which single-query stage
 * raised it - never SQL text, parameters, row contents, or constraint names.
 */
const SOURCE_PROMOTION_QUERY_STAGE = Object.freeze({
  SENSITIVITY_PROFILE_READ: "sensitivity_profile_read",
  UPLOAD_STATE_READ: "upload_state_read",
  DECISION_INSERT: "decision_insert",
  DECISION_TRANSITION: "decision_transition",
  SOURCE_INSERT: "source_insert",
  SOURCE_VERSION_INSERT: "source_version_insert",
  CANDIDATE_STATUS_UPDATE: "candidate_status_update",
  REVIEW_QUEUE_RESOLVE: "review_queue_resolve",
  REVIEW_QUEUE_WAITING_ON_CLIENT: "review_queue_waiting_on_client",
  AUDIT_INSERT: "audit_insert",
});

const SOURCE_PROMOTION_SQLSTATE_TOKEN = Object.freeze({
  23514: "23514",
  P0001: "p0001",
  "22P02": "22p02",
});

/**
 * The complete, whitelisted set of operation-specific exact_verification_phase
 * tokens this module can ever emit for a grouped SQLSTATE (23514 / P0001 /
 * 22P02): every known query stage crossed with every grouped SQLSTATE. Built
 * once from the two enumerations above so a reachable stage can never
 * silently fall back to the umbrella DB_CONSTRAINT_VIOLATION phase - the
 * fallback below is reachable only for an error this module's own tagging
 * never touched (e.g. a failure before any tx.query() call, such as
 * `runInTransaction` itself throwing).
 */
const SOURCE_PROMOTION_OPERATION_PHASE_BY_STAGE_AND_SQLSTATE = Object.freeze(
  Object.fromEntries(
    Object.values(SOURCE_PROMOTION_QUERY_STAGE).map((stage) => [
      stage,
      Object.freeze(
        Object.fromEntries(
          Object.entries(SOURCE_PROMOTION_SQLSTATE_TOKEN).map(([sqlstate, token]) => [
            sqlstate,
            `source_promotion_${stage}_${token}`,
          ]),
        ),
      ),
    ]),
  ),
);

const SOURCE_PROMOTION_QUERY_STAGE_TAG = Symbol("kaiSourcePromotionQueryStage");

/**
 * Runs one tx.query() call tagged with its single-query stage. On a thrown
 * PostgreSQL error, attaches a non-enumerable stage marker and rethrows the
 * exact same error unchanged - never converted into a return value, so the
 * surrounding transaction's rollback (see withTransaction in kaiDb.js) is
 * never suppressed or altered by this diagnostic tagging.
 */
async function taggedQuery(tx, stage, sql, params) {
  try {
    return await tx.query(sql, params);
  } catch (error) {
    if (error && typeof error === "object" && !(SOURCE_PROMOTION_QUERY_STAGE_TAG in error)) {
      try {
        Object.defineProperty(error, SOURCE_PROMOTION_QUERY_STAGE_TAG, { value: stage, enumerable: false });
      } catch {
        // Non-extensible error object: fall through and rethrow untagged -
        // shapeSourcePromotionError's fallback still applies.
      }
    }
    throw error;
  }
}

function sourcePromotionFailure(code, data = null) {
  return {
    ok: false,
    data,
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

/**
 * P1-08 CORRECTION: `reviewedSourceType` is now shape-required only when
 * `outcome === 'promoted'`. For the two non-promotion outcomes it must be
 * entirely absent from the input - a present-but-empty or present-but-non-'unknown'
 * value on a non-promotion outcome is rejected here as an ambiguous input shape,
 * never silently ignored.
 */
function isReviewedSourceTypeShapeValidForOutcome(outcome, reviewedSourceType) {
  if (outcome === DECISION_STATUS_PROMOTED) return isNonEmptyString(reviewedSourceType);
  return reviewedSourceType === undefined;
}

function validateCreateInput(input) {
  const allowedKeys = new Set(["identity", "outcome", "reviewedSourceType", "actorUserId", "now", "metadataOnlyAudit"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  if (!ALLOWED_DECISION_OUTCOMES.has(input.outcome)) return false;
  return (
    isSourcePromotionIdentity(input.identity) &&
    isReviewedSourceTypeShapeValidForOutcome(input.outcome, input.reviewedSourceType) &&
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
  const result = await taggedQuery(
    tx,
    SOURCE_PROMOTION_QUERY_STAGE.SENSITIVITY_PROFILE_READ,
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
 * non-'unknown' member of the fixed disclosed vocabulary. Never inferred. Only
 * applies to the 'promoted' outcome.
 */
function satisfiesReviewedSourceTypePredicate(reviewedSourceType) {
  return reviewedSourceType !== "unknown" && ALLOWED_REVIEWED_SOURCE_TYPES.has(reviewedSourceType);
}

/**
 * VAL-KAI-P1-08-001 (initial decision form): a complete, immutable candidate/
 * review pair - the candidate must still be at its P1-07 pinned pre-decision
 * status, and its matching 'source_candidate_review' item must still be open.
 * This applies identically to all three null -> X outcomes: a first decision of
 * any outcome requires the same pre-decision completeness.
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
 * VAL-KAI-P1-08-001 (needs_more_information -> X follow-up form): the candidate
 * must still be at its P1-07 pinned status (unmoved by needs_more_information),
 * and its matching review item must still be at exactly the
 * 'waiting_on_client' status this package itself set when it first recorded
 * needs_more_information - never 'open' (that would mean no needs_more_information
 * decision was ever recorded) and never 'resolved' (that would mean this identity
 * already reached a terminal outcome).
 */
function satisfiesFollowupCompletenessPredicate(candidateRow, reviewItemRow) {
  return (
    candidateRow.candidate_status === CANDIDATE_STATUS_NEEDS_REVIEW &&
    reviewItemRow.queue_status === REVIEW_QUEUE_STATUS_WAITING_ON_CLIENT &&
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

async function insertDecisionRow(tx, decision) {
  const result = await taggedQuery(
    tx,
    SOURCE_PROMOTION_QUERY_STAGE.DECISION_INSERT,
    `INSERT INTO kai.intake_promotion_decisions (
       organization_id,
       intake_source_candidate_id,
       review_queue_item_id,
       reviewed_source_type,
       decision_status,
       source_id,
       source_version_id,
       promoted_at,
       created_by,
       created_by_type
     ) VALUES ($1,$2,$3,$4,$5,$6::uuid,$7::uuid,$8::timestamptz,$9,$10)
     ON CONFLICT (organization_id, intake_source_candidate_id)
       DO NOTHING
     RETURNING intake_promotion_decision_id, organization_id, intake_source_candidate_id,
               review_queue_item_id, reviewed_source_type, decision_status, source_id,
               source_version_id, created_at, decided_at, promoted_at`,
    [
      decision.organizationId,
      decision.intakeSourceCandidateId,
      decision.reviewQueueItemId,
      decision.reviewedSourceType ?? null,
      decision.decisionStatus,
      decision.sourceId ?? null,
      decision.sourceVersionId ?? null,
      decision.promotedAt ?? null,
      decision.createdBy || null,
      decision.createdByType || "human",
    ],
  );
  return result.rows[0] ?? null;
}

async function transitionDecisionRowIfNeedsMoreInformation(tx, decision) {
  const result = await taggedQuery(
    tx,
    SOURCE_PROMOTION_QUERY_STAGE.DECISION_TRANSITION,
    `UPDATE kai.intake_promotion_decisions
        SET decision_status = $3,
            reviewed_source_type = $4,
            source_id = $5::uuid,
            source_version_id = $6::uuid,
            promoted_at = $7::timestamptz
      WHERE organization_id = $1::uuid
        AND intake_promotion_decision_id = $2::uuid
        AND decision_status = $8
      RETURNING intake_promotion_decision_id, organization_id, intake_source_candidate_id,
                review_queue_item_id, reviewed_source_type, decision_status, source_id,
                source_version_id, created_at, decided_at, promoted_at`,
    [
      decision.organizationId,
      decision.intakePromotionDecisionId,
      decision.decisionStatus,
      decision.reviewedSourceType ?? null,
      decision.sourceId ?? null,
      decision.sourceVersionId ?? null,
      decision.promotedAt ?? null,
      DECISION_STATUS_NEEDS_MORE_INFORMATION,
    ],
  );
  return result.rows[0] ?? null;
}

async function insertSourceIfAbsent(tx, source) {
  const result = await taggedQuery(
    tx,
    SOURCE_PROMOTION_QUERY_STAGE.SOURCE_INSERT,
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
  const result = await taggedQuery(
    tx,
    SOURCE_PROMOTION_QUERY_STAGE.SOURCE_VERSION_INSERT,
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

/**
 * Generalizes the original `promoteCandidateIfCurrent`: a compare-and-set
 * candidate_status transition, always from the P1-07 pinned 'needs_gk_review'
 * status (candidate_status never moves for needs_more_information), to either
 * 'promoted' or 'rejected'.
 */
async function setCandidateStatusIfCurrent(tx, { organizationId, intakeSourceCandidateId, toStatus }) {
  const result = await taggedQuery(
    tx,
    SOURCE_PROMOTION_QUERY_STAGE.CANDIDATE_STATUS_UPDATE,
    `UPDATE kai.intake_source_candidates
        SET candidate_status = $3
      WHERE organization_id = $1::uuid
        AND intake_source_candidate_id = $2::uuid
        AND candidate_status = $4
      RETURNING intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
                data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256,
                proposed_source_type, candidate_status, created_at`,
    [organizationId, intakeSourceCandidateId, toStatus, CANDIDATE_STATUS_NEEDS_REVIEW],
  );
  return result.rows[0] ?? null;
}

/**
 * Compare-and-set transition to queue_status = 'resolved' / review_status =
 * 'resolved', from whichever queue_status this identity is expected to still be
 * at ('open' for a direct null -> rejected/promoted decision, 'waiting_on_client'
 * for a needs_more_information -> rejected/promoted follow-up).
 */
async function resolveReviewQueueItemIfCurrent(tx, { organizationId, reviewQueueItemId, fromQueueStatus }) {
  const result = await taggedQuery(
    tx,
    SOURCE_PROMOTION_QUERY_STAGE.REVIEW_QUEUE_RESOLVE,
    `UPDATE kai.review_queue_items
        SET queue_status = $3,
            review_status = $4
      WHERE organization_id = $1::uuid
        AND review_queue_item_id = $2::uuid
        AND queue_status = $5
      RETURNING review_queue_item_id, organization_id, queue_type, target_object_type,
                target_object_id, queue_status, review_status`,
    [organizationId, reviewQueueItemId, REVIEW_QUEUE_STATUS_RESOLVED, REVIEW_STATUS_RESOLVED, fromQueueStatus],
  );
  return result.rows[0] ?? null;
}

/**
 * Compare-and-set transition to queue_status = 'waiting_on_client' with the
 * fixed required_action literal, only reachable from 'open' (the null ->
 * needs_more_information transition - there is no other path into
 * needs_more_information).
 */
async function setReviewQueueItemWaitingOnClientIfOpen(tx, { organizationId, reviewQueueItemId, requiredAction }) {
  const result = await taggedQuery(
    tx,
    SOURCE_PROMOTION_QUERY_STAGE.REVIEW_QUEUE_WAITING_ON_CLIENT,
    `UPDATE kai.review_queue_items
        SET queue_status = $3,
            required_action = $4
      WHERE organization_id = $1::uuid
        AND review_queue_item_id = $2::uuid
        AND queue_status = $5
      RETURNING review_queue_item_id, organization_id, queue_type, target_object_type,
                target_object_id, queue_status, review_status`,
    [organizationId, reviewQueueItemId, REVIEW_QUEUE_STATUS_WAITING_ON_CLIENT, requiredAction, REVIEW_QUEUE_STATUS_OPEN],
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
function prepareRequiredAudit(metadataOnlyAudit, tx, context) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: buildSourcePromotionAuditPayload(context),
    db: tx,
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
  const result = await taggedQuery(
    tx,
    SOURCE_PROMOTION_QUERY_STAGE.UPLOAD_STATE_READ,
    `SELECT upload_state
       FROM kai.intake_files
      WHERE organization_id = $1::uuid
        AND intake_file_id = $2::uuid`,
    [organizationId, intakeFileId],
  );
  return result.rows[0]?.upload_state ?? null;
}

async function insertAudit(tx, { organizationId, intakeFileId, uploadState, metadata, now }) {
  await taggedQuery(
    tx,
    SOURCE_PROMOTION_QUERY_STAGE.AUDIT_INSERT,
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
  if (error instanceof RequiredAuditRejectedError) {
    return sourcePromotionFailure("validation_blocker", {
      exact_verification_phase: SOURCE_PROMOTION_EXACT_VERIFICATION_PHASE.REQUIRED_AUDIT_REJECTED,
    });
  }
  if (error?.code === "23503") return sourcePromotionFailure("not_found");
  if (error?.code === "23514" || error?.code === "P0001" || error?.code === "22P02") {
    const stage = error && typeof error === "object" ? error[SOURCE_PROMOTION_QUERY_STAGE_TAG] : undefined;
    const operationPhase = typeof stage === "string" ? SOURCE_PROMOTION_OPERATION_PHASE_BY_STAGE_AND_SQLSTATE[stage]?.[error.code] : undefined;
    return sourcePromotionFailure("validation_blocker", {
      exact_verification_phase: operationPhase ?? SOURCE_PROMOTION_EXACT_VERIFICATION_PHASE.DB_CONSTRAINT_VIOLATION,
    });
  }
  return sourcePromotionFailure("system_error");
}

/**
 * Whether a committed decision row's recorded facts exactly match a freshly
 * requested outcome - the "identical replay" predicate. Used both for the
 * fast-path replay (an existing row already at a terminal-reachable state) and
 * for reconciling a lost ON CONFLICT / compare-and-set race (did the concurrent
 * winner reach the SAME outcome this call requested, or a different one).
 */
function outcomeMatchesRecordedFacts(record, requestedOutcome, requestedReviewedSourceType) {
  if (record.decision_status !== requestedOutcome) return false;
  if (requestedOutcome === DECISION_STATUS_PROMOTED) {
    return (
      record.reviewed_source_type === requestedReviewedSourceType &&
      isNonEmptyString(record.source_id) &&
      isNonEmptyString(record.source_version_id)
    );
  }
  // needs_more_information and rejected carry no caller-supplied facts beyond
  // the outcome itself (required_action is a fixed literal, never caller
  // input), so decision_status equality alone is the full fact-match.
  return true;
}

/**
 * Validates a freshly re-read decision row against the identity and the
 * requested outcome/facts. Returns `{ ok: true, record }` on an exact identical
 * replay, or `{ ok: false, code }` (`system_error` for a malformed/missing row,
 * `conflict_current_state_changed` for any other mismatch) otherwise. Never
 * validates any field this package does not implement a workflow for.
 */
function validateReplayedDecisionRow(row, identity, requestedOutcome, requestedReviewedSourceType) {
  if (!row) return { ok: false, code: "system_error" };
  const record = rowToDecisionRecord(row);
  if (
    !isNonEmptyString(record.intake_promotion_decision_id) ||
    !isNonEmptyString(record.organization_id) ||
    !isNonEmptyString(record.intake_source_candidate_id) ||
    !isNonEmptyString(record.decision_status)
  ) {
    return { ok: false, code: "system_error" };
  }
  if (record.organization_id !== identity.organizationId || record.intake_source_candidate_id !== identity.intakeSourceCandidateId) {
    return { ok: false, code: "conflict_current_state_changed" };
  }
  if (!outcomeMatchesRecordedFacts(record, requestedOutcome, requestedReviewedSourceType)) {
    return { ok: false, code: "conflict_current_state_changed" };
  }
  return { ok: true, record };
}

/**
 * Assembles the full replay payload for an already-decided identity: reads back
 * the candidate and review item rows always, and the source/source_version rows
 * only when the decision is bound to them (the 'promoted' outcome), with no
 * mutation and no audit activity.
 */
async function buildReplayPayload(tx, identity, decisionRecord) {
  const candidateRow = await getScopedSourceCandidateByIdentity(identity, tx);
  const reviewItemRow = candidateRow
    ? await getScopedSourceCandidateReviewQueueItemByIdentity(
        { organizationId: identity.organizationId, targetObjectId: candidateRow.intake_source_candidate_id },
        tx,
      )
    : null;
  const sourceRow = decisionRecord.source_id
    ? await getScopedSourceById({ organizationId: identity.organizationId, sourceId: decisionRecord.source_id }, tx)
    : null;
  const sourceVersionRow = decisionRecord.source_version_id
    ? await getScopedSourceVersionById(
        { organizationId: identity.organizationId, sourceVersionId: decisionRecord.source_version_id },
        tx,
      )
    : null;
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
  /**
   * Shared 'promoted' work: validates the reviewed-source-type predicate and the
   * permission/lineage predicates against a freshly re-read sensitivity profile,
   * then performs the deterministic source/source_version creation-or-replay.
   * Used identically by both the null -> promoted path and the
   * needs_more_information -> promoted follow-up path. Throws
   * ConcurrentStateChangedError / MalformedInsertedRowError on the same
   * conditions the original single-path implementation did. Returns
   * `{ blocker: code }` for a validator failure, or `{ sourceRecord,
   * sourceVersionRecord }` on success.
   */
  async function performPromotionSourceWork(tx, { candidateRow, reviewedSourceType, actorUserId }) {
    if (!satisfiesReviewedSourceTypePredicate(reviewedSourceType)) {
      return {
        blocker: "validation_blocker",
        exactVerificationPhase: SOURCE_PROMOTION_EXACT_VERIFICATION_PHASE.REVIEWED_SOURCE_TYPE_INVALID,
      };
    }

    const profileRow = await readScopedSensitivityProfile(tx, candidateRow.organization_id, candidateRow.intake_sensitivity_profile_id);
    if (!profileRow) return { blocker: "not_found" };

    if (!satisfiesLineageMatchPredicate(candidateRow, profileRow)) {
      return { blocker: "conflict_current_state_changed" };
    }

    if (!satisfiesPermissionPredicate(profileRow)) {
      return {
        blocker: "validation_blocker",
        exactVerificationPhase: SOURCE_PROMOTION_EXACT_VERIFICATION_PHASE.PERMISSION_PREDICATE_FAILED,
      };
    }

    const sourceCode = computeSourceCode({
      organizationId: candidateRow.organization_id,
      intakeSensitivityProfileId: candidateRow.intake_sensitivity_profile_id,
      profileCanonicalSha256: candidateRow.profile_canonical_sha256,
      reviewedSourceType,
    });

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
      const concurrentVersionRow = await getScopedSourceVersionByCandidateIdentity(
        { organizationId: candidateRow.organization_id, intakeSourceCandidateId: candidateRow.intake_source_candidate_id },
        tx,
      );
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

    return { sourceRecord, sourceVersionRecord };
  }

  async function writeRequiredAuditAndReturn(tx, { metadataOnlyAudit, candidateRow, decisionRecord, candidateRecord, reviewQueueRecord, now, sourceRecord, sourceVersionRecord }) {
    const uploadState = await readScopedUploadState(tx, candidateRow.organization_id, candidateRow.intake_file_id);
    if (!uploadState) return sourcePromotionFailure("not_found");

    const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, tx, {
      decisionRecord,
      candidateRecord,
      reviewQueueRecord,
    });
    await insertAudit(tx, {
      organizationId: candidateRow.organization_id,
      intakeFileId: candidateRow.intake_file_id,
      uploadState,
      metadata: buildSourcePromotionAuditMetadata({ decisionRecord, candidateRecord, reviewQueueRecord }),
      now,
    });
    await preparedAudit.publish();

    return sourcePromotionSuccess({
      promotionDecision: decisionRecord,
      sourceCandidate: candidateRecord,
      reviewQueueItem: reviewQueueRecord,
      source: sourceRecord ?? null,
      sourceVersion: sourceVersionRecord ?? null,
      replayed: false,
    });
  }

  return Object.freeze({
    /**
     * Organization-scoped, human-authorized, idempotent creation-or-transition of
     * one `kai.intake_promotion_decisions` row for a complete P1-07 candidate/
     * review pair. See the module doc comment for the full transition matrix.
     *
     * Genuinely concurrent identical creation/transition is resolved entirely by
     * PostgreSQL's unique constraints and compare-and-set UPDATEs via
     * `INSERT ... ON CONFLICT ... DO NOTHING RETURNING` / `UPDATE ... WHERE
     * decision_status = $expected RETURNING` at every step: a losing transaction
     * observes zero returned rows - never a raised 23505 that would abort it
     * before it could re-read - then re-reads and either replays the
     * authoritative committed row (same outcome) or reports
     * conflict_current_state_changed (different outcome). No application-level
     * synchronization primitive is used to coordinate this.
     */
    async createSourcePromotionDecision(input) {
      if (!validateCreateInput(input)) {
        return sourcePromotionFailure("validation_blocker", {
          exact_verification_phase: SOURCE_PROMOTION_EXACT_VERIFICATION_PHASE.REPOSITORY_INPUT_SHAPE,
        });
      }
      const { identity, outcome, reviewedSourceType, actorUserId, now, metadataOnlyAudit } = input;
      try {
        return await runInTransaction(async (tx) => {
          const existingDecisionRow = await getScopedSourcePromotionDecisionByIdentity(identity, tx);

          if (existingDecisionRow) {
            const existingRecord = rowToDecisionRecord(existingDecisionRow);

            if (existingRecord.decision_status === outcome) {
              // Either an identical replay of a terminal-reachable outcome
              // (rejected/promoted), or a re-request of needs_more_information
              // while still at needs_more_information - both are safe,
              // zero-write, zero-audit no-ops when the recorded facts match.
              const replayValidation = validateReplayedDecisionRow(existingDecisionRow, identity, outcome, reviewedSourceType);
              if (!replayValidation.ok) return sourcePromotionFailure(replayValidation.code);
              return sourcePromotionSuccess(await buildReplayPayload(tx, identity, replayValidation.record));
            }

            if (existingRecord.decision_status !== DECISION_STATUS_NEEDS_MORE_INFORMATION) {
              // rejected/promoted are terminal except identical replay (handled
              // above): any other requested outcome from a terminal state is a
              // prohibited transition.
              return sourcePromotionFailure("conflict_current_state_changed");
            }

            if (outcome !== DECISION_STATUS_REJECTED && outcome !== DECISION_STATUS_PROMOTED) {
              // needs_more_information -> needs_more_information with a
              // DIFFERENT requested outcome is impossible (required_action is
              // fixed), and needs_more_information -> needs_more_information is
              // already handled by the identical-outcome branch above. Nothing
              // else is a legal transition from needs_more_information.
              return sourcePromotionFailure("conflict_current_state_changed");
            }

            // Legal follow-up transition: needs_more_information -> rejected or
            // needs_more_information -> promoted.
            await beforeInsert();

            const candidateRow = await getScopedSourceCandidateByIdentity(identity, tx);
            if (!candidateRow) return sourcePromotionFailure("not_found");

            const reviewItemRow = await getScopedSourceCandidateReviewQueueItemByIdentity(
              { organizationId: candidateRow.organization_id, targetObjectId: candidateRow.intake_source_candidate_id },
              tx,
            );
            if (!reviewItemRow) return sourcePromotionFailure("not_found");

            if (!satisfiesFollowupCompletenessPredicate(candidateRow, reviewItemRow)) {
              // The candidate/review item no longer match the state this
              // needs_more_information decision left them in: re-read the
              // decision row authoritatively rather than assume this call's own
              // stale view.
              const concurrentDecisionRow = await getScopedSourcePromotionDecisionByIdentity(identity, tx);
              const replayValidation = validateReplayedDecisionRow(concurrentDecisionRow, identity, outcome, reviewedSourceType);
              if (!replayValidation.ok) return sourcePromotionFailure(replayValidation.code);
              return sourcePromotionSuccess(await buildReplayPayload(tx, identity, replayValidation.record));
            }

            if (outcome === DECISION_STATUS_REJECTED) {
              const rejectedCandidateRow = await setCandidateStatusIfCurrent(tx, {
                organizationId: candidateRow.organization_id,
                intakeSourceCandidateId: candidateRow.intake_source_candidate_id,
                toStatus: CANDIDATE_STATUS_REJECTED,
              });
              if (!rejectedCandidateRow) throw new ConcurrentStateChangedError("intake_source_candidate");
              const candidateRecord = rowToCandidateRecord(rejectedCandidateRow);

              const resolvedReviewItemRow = await resolveReviewQueueItemIfCurrent(tx, {
                organizationId: candidateRow.organization_id,
                reviewQueueItemId: reviewItemRow.review_queue_item_id,
                fromQueueStatus: REVIEW_QUEUE_STATUS_WAITING_ON_CLIENT,
              });
              if (!resolvedReviewItemRow) throw new ConcurrentStateChangedError("review_queue_item");
              const reviewQueueRecord = rowToReviewQueueRecord(resolvedReviewItemRow);

              const transitionedDecisionRow = await transitionDecisionRowIfNeedsMoreInformation(tx, {
                organizationId: candidateRow.organization_id,
                intakePromotionDecisionId: existingRecord.intake_promotion_decision_id,
                decisionStatus: DECISION_STATUS_REJECTED,
              });
              if (!transitionedDecisionRow) {
                const concurrentDecisionRow = await getScopedSourcePromotionDecisionByIdentity(identity, tx);
                const replayValidation = validateReplayedDecisionRow(concurrentDecisionRow, identity, outcome, reviewedSourceType);
                if (!replayValidation.ok) return sourcePromotionFailure(replayValidation.code);
                return sourcePromotionSuccess(await buildReplayPayload(tx, identity, replayValidation.record));
              }
              const decisionRecord = rowToDecisionRecord(transitionedDecisionRow);

              return writeRequiredAuditAndReturn(tx, {
                metadataOnlyAudit,
                candidateRow,
                decisionRecord,
                candidateRecord,
                reviewQueueRecord,
                now,
              });
            }

            // outcome === DECISION_STATUS_PROMOTED
            const promotionWork = await performPromotionSourceWork(tx, { candidateRow, reviewedSourceType, actorUserId });
            if (promotionWork.blocker) {
              return sourcePromotionFailure(
                promotionWork.blocker,
                promotionWork.exactVerificationPhase ? { exact_verification_phase: promotionWork.exactVerificationPhase } : null,
              );
            }
            const { sourceRecord, sourceVersionRecord } = promotionWork;

            const promotedCandidateRow = await setCandidateStatusIfCurrent(tx, {
              organizationId: candidateRow.organization_id,
              intakeSourceCandidateId: candidateRow.intake_source_candidate_id,
              toStatus: CANDIDATE_STATUS_PROMOTED,
            });
            if (!promotedCandidateRow) throw new ConcurrentStateChangedError("intake_source_candidate");
            const candidateRecord = rowToCandidateRecord(promotedCandidateRow);

            const resolvedReviewItemRow = await resolveReviewQueueItemIfCurrent(tx, {
              organizationId: candidateRow.organization_id,
              reviewQueueItemId: reviewItemRow.review_queue_item_id,
              fromQueueStatus: REVIEW_QUEUE_STATUS_WAITING_ON_CLIENT,
            });
            if (!resolvedReviewItemRow) throw new ConcurrentStateChangedError("review_queue_item");
            const reviewQueueRecord = rowToReviewQueueRecord(resolvedReviewItemRow);

            const transitionedDecisionRow = await transitionDecisionRowIfNeedsMoreInformation(tx, {
              organizationId: candidateRow.organization_id,
              intakePromotionDecisionId: existingRecord.intake_promotion_decision_id,
              decisionStatus: DECISION_STATUS_PROMOTED,
              reviewedSourceType,
              sourceId: sourceRecord.source_id,
              sourceVersionId: sourceVersionRecord.source_version_id,
              promotedAt: now,
            });
            if (!transitionedDecisionRow) throw new MalformedInsertedRowError("intake_promotion_decisions");
            const decisionRecord = rowToDecisionRecord(transitionedDecisionRow);

            return writeRequiredAuditAndReturn(tx, {
              metadataOnlyAudit,
              candidateRow,
              decisionRecord,
              candidateRecord,
              reviewQueueRecord,
              now,
              sourceRecord,
              sourceVersionRecord,
            });
          }

          // No existing decision row: this is a first (null -> outcome) decision.
          //
          // Unlike a P1-07-style row this same call creates fresh, the P1-07
          // candidate this call decides on already exists, so its FOR UPDATE lock
          // just below is the real serialization point for two genuinely
          // concurrent decision attempts on the same identity - not the
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
            // serialization point for two genuinely concurrent decision attempts:
            // a losing transaction blocks there until the winner commits, then
            // observes a non-needs_gk_review candidate_status here - never at the
            // decision ON CONFLICT below, which by then can no longer lose a race
            // for this identity. Re-read the now-committed decision and either
            // replay it or report conflict, rather than misreporting a
            // validation_blocker for a call that already resolved concurrently.
            const concurrentDecisionRow = await getScopedSourcePromotionDecisionByIdentity(identity, tx);
            if (!concurrentDecisionRow) return sourcePromotionFailure("system_error");
            const replayValidation = validateReplayedDecisionRow(concurrentDecisionRow, identity, outcome, reviewedSourceType);
            if (!replayValidation.ok) return sourcePromotionFailure(replayValidation.code);
            return sourcePromotionSuccess(await buildReplayPayload(tx, identity, replayValidation.record));
          }

          const reviewItemRow = await getScopedSourceCandidateReviewQueueItemByIdentity(
            { organizationId: candidateRow.organization_id, targetObjectId: candidateRow.intake_source_candidate_id },
            tx,
          );
          if (!reviewItemRow) return sourcePromotionFailure("not_found");

          if (!satisfiesCandidateReviewCompletenessPredicate(candidateRow, reviewItemRow)) {
            // A resolved (or otherwise non-open) review item is never itself
            // decision authority. If a concurrent winner already reached the
            // same identity's terminal-reachable outcome, replay it instead of
            // misreporting validation_blocker.
            const concurrentDecisionRow = await getScopedSourcePromotionDecisionByIdentity(identity, tx);
            if (concurrentDecisionRow) {
              const replayValidation = validateReplayedDecisionRow(concurrentDecisionRow, identity, outcome, reviewedSourceType);
              if (replayValidation.ok) {
                return sourcePromotionSuccess(await buildReplayPayload(tx, identity, replayValidation.record));
              }
            }
            return sourcePromotionFailure("validation_blocker", {
              exact_verification_phase: SOURCE_PROMOTION_EXACT_VERIFICATION_PHASE.CANDIDATE_REVIEW_INCOMPLETE,
            });
          }

          if (outcome === DECISION_STATUS_NEEDS_MORE_INFORMATION) {
            const waitingReviewItemRow = await setReviewQueueItemWaitingOnClientIfOpen(tx, {
              organizationId: candidateRow.organization_id,
              reviewQueueItemId: reviewItemRow.review_queue_item_id,
              requiredAction: REQUIRED_ACTION_NEEDS_MORE_INFORMATION,
            });
            if (!waitingReviewItemRow) throw new ConcurrentStateChangedError("review_queue_item");
            const reviewQueueRecord = rowToReviewQueueRecord(waitingReviewItemRow);
            const candidateRecord = rowToCandidateRecord(candidateRow);

            const insertedDecisionRow = await insertDecisionRow(tx, {
              organizationId: candidateRow.organization_id,
              intakeSourceCandidateId: candidateRow.intake_source_candidate_id,
              reviewQueueItemId: reviewItemRow.review_queue_item_id,
              decisionStatus: DECISION_STATUS_NEEDS_MORE_INFORMATION,
              createdBy: actorUserId,
              createdByType: "human",
            });
            if (!insertedDecisionRow) {
              const concurrentDecisionRow = await getScopedSourcePromotionDecisionByIdentity(identity, tx);
              const replayValidation = validateReplayedDecisionRow(concurrentDecisionRow, identity, outcome, reviewedSourceType);
              if (!replayValidation.ok) return sourcePromotionFailure(replayValidation.code);
              return sourcePromotionSuccess(await buildReplayPayload(tx, identity, replayValidation.record));
            }
            const decisionRecord = rowToDecisionRecord(insertedDecisionRow);

            return writeRequiredAuditAndReturn(tx, {
              metadataOnlyAudit,
              candidateRow,
              decisionRecord,
              candidateRecord,
              reviewQueueRecord,
              now,
            });
          }

          if (outcome === DECISION_STATUS_REJECTED) {
            const rejectedCandidateRow = await setCandidateStatusIfCurrent(tx, {
              organizationId: candidateRow.organization_id,
              intakeSourceCandidateId: candidateRow.intake_source_candidate_id,
              toStatus: CANDIDATE_STATUS_REJECTED,
            });
            if (!rejectedCandidateRow) throw new ConcurrentStateChangedError("intake_source_candidate");
            const candidateRecord = rowToCandidateRecord(rejectedCandidateRow);

            const resolvedReviewItemRow = await resolveReviewQueueItemIfCurrent(tx, {
              organizationId: candidateRow.organization_id,
              reviewQueueItemId: reviewItemRow.review_queue_item_id,
              fromQueueStatus: REVIEW_QUEUE_STATUS_OPEN,
            });
            if (!resolvedReviewItemRow) throw new ConcurrentStateChangedError("review_queue_item");
            const reviewQueueRecord = rowToReviewQueueRecord(resolvedReviewItemRow);

            const insertedDecisionRow = await insertDecisionRow(tx, {
              organizationId: candidateRow.organization_id,
              intakeSourceCandidateId: candidateRow.intake_source_candidate_id,
              reviewQueueItemId: reviewItemRow.review_queue_item_id,
              decisionStatus: DECISION_STATUS_REJECTED,
              createdBy: actorUserId,
              createdByType: "human",
            });
            if (!insertedDecisionRow) {
              const concurrentDecisionRow = await getScopedSourcePromotionDecisionByIdentity(identity, tx);
              const replayValidation = validateReplayedDecisionRow(concurrentDecisionRow, identity, outcome, reviewedSourceType);
              if (!replayValidation.ok) return sourcePromotionFailure(replayValidation.code);
              return sourcePromotionSuccess(await buildReplayPayload(tx, identity, replayValidation.record));
            }
            const decisionRecord = rowToDecisionRecord(insertedDecisionRow);

            return writeRequiredAuditAndReturn(tx, {
              metadataOnlyAudit,
              candidateRow,
              decisionRecord,
              candidateRecord,
              reviewQueueRecord,
              now,
            });
          }

          // outcome === DECISION_STATUS_PROMOTED
          const promotionWork = await performPromotionSourceWork(tx, { candidateRow, reviewedSourceType, actorUserId });
          if (promotionWork.blocker) {
            return sourcePromotionFailure(
              promotionWork.blocker,
              promotionWork.exactVerificationPhase ? { exact_verification_phase: promotionWork.exactVerificationPhase } : null,
            );
          }
          const { sourceRecord, sourceVersionRecord } = promotionWork;

          const promotedCandidateRow = await setCandidateStatusIfCurrent(tx, {
            organizationId: candidateRow.organization_id,
            intakeSourceCandidateId: candidateRow.intake_source_candidate_id,
            toStatus: CANDIDATE_STATUS_PROMOTED,
          });
          if (!promotedCandidateRow) throw new ConcurrentStateChangedError("intake_source_candidate");
          const candidateRecord = rowToCandidateRecord(promotedCandidateRow);

          const resolvedReviewItemRow = await resolveReviewQueueItemIfCurrent(tx, {
            organizationId: candidateRow.organization_id,
            reviewQueueItemId: reviewItemRow.review_queue_item_id,
            fromQueueStatus: REVIEW_QUEUE_STATUS_OPEN,
          });
          if (!resolvedReviewItemRow) throw new ConcurrentStateChangedError("review_queue_item");
          const reviewQueueRecord = rowToReviewQueueRecord(resolvedReviewItemRow);

          const insertedDecisionRow = await insertDecisionRow(tx, {
            organizationId: candidateRow.organization_id,
            intakeSourceCandidateId: candidateRow.intake_source_candidate_id,
            reviewQueueItemId: reviewItemRow.review_queue_item_id,
            reviewedSourceType,
            decisionStatus: DECISION_STATUS_PROMOTED,
            sourceId: sourceRecord.source_id,
            sourceVersionId: sourceVersionRecord.source_version_id,
            promotedAt: now,
            createdBy: actorUserId,
            createdByType: "human",
          });
          if (!insertedDecisionRow) {
            const concurrentDecisionRow = await getScopedSourcePromotionDecisionByIdentity(identity, tx);
            const replayValidation = validateReplayedDecisionRow(concurrentDecisionRow, identity, outcome, reviewedSourceType);
            if (!replayValidation.ok) return sourcePromotionFailure(replayValidation.code);
            return sourcePromotionSuccess(await buildReplayPayload(tx, identity, replayValidation.record));
          }
          const decisionRecord = rowToDecisionRecord(insertedDecisionRow);

          return writeRequiredAuditAndReturn(tx, {
            metadataOnlyAudit,
            candidateRow,
            decisionRecord,
            candidateRecord,
            reviewQueueRecord,
            now,
            sourceRecord,
            sourceVersionRecord,
          });
        });
      } catch (error) {
        return shapeSourcePromotionError(error);
      }
    },
  });
}

export const __sourcePromotionRepositoryContract = Object.freeze({
  SOURCE_PROMOTION_EXACT_VERIFICATION_PHASE,
  SOURCE_PROMOTION_QUERY_STAGE,
  SOURCE_PROMOTION_OPERATION_PHASE_BY_STAGE_AND_SQLSTATE,
  ALLOWED_REVIEWED_SOURCE_TYPES: Object.freeze([...ALLOWED_REVIEWED_SOURCE_TYPES]),
  ALLOWED_DECISION_OUTCOMES: Object.freeze([...ALLOWED_DECISION_OUTCOMES]),
  CANDIDATE_STATUS_NEEDS_REVIEW,
  CANDIDATE_STATUS_PROMOTED,
  CANDIDATE_STATUS_REJECTED,
  REVIEW_QUEUE_TYPE,
  REVIEW_TARGET_OBJECT_TYPE,
  REVIEW_QUEUE_STATUS_OPEN,
  REVIEW_QUEUE_STATUS_WAITING_ON_CLIENT,
  REVIEW_QUEUE_STATUS_RESOLVED,
  DECISION_STATUS_NEEDS_MORE_INFORMATION,
  DECISION_STATUS_REJECTED,
  DECISION_STATUS_PROMOTED,
  REQUIRED_ACTION_NEEDS_MORE_INFORMATION,
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
  satisfiesFollowupCompletenessPredicate,
  satisfiesLineageMatchPredicate,
  computeSourceCode,
});
