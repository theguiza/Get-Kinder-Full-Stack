import {
  getScopedClaimById,
  getScopedClaimEvidenceLinkByClaimId,
  getScopedEvidenceItemById,
  getScopedSourceLocatorById,
  getScopedSourceById,
  getScopedSourceVersionById,
  getScopedSourceCandidateByIdentity,
  getScopedPromotionDecisionBySourceVersionId,
  getScopedEvidenceReviewQueueItemByEvidenceItemId,
  getScopedDataDictionaryById,
} from "../db/kaiIntakeQueries.js";
import {
  assessMissingness,
  assessDuplicates,
  assessDefinitionClarity,
  assessDenominatorClarity,
  assessTimePeriodClarity,
  assessEntityLevelClarity,
  assessSmallCellRisk,
  assessConflictingSourceIndicators,
  assessRequirementAlignment,
  assessCoverageGaps,
} from "../validators/kaiEvidenceCoverageAssessmentValidators.js";
import { __evidenceCoverageAssessmentRepositoryTestables } from "./postgresEvidenceCoverageAssessmentRepository.js";
import {
  validateClaimGapLineage,
  validateClientFollowupRouting,
  dimensionResultRequiresGap,
  CLIENT_ANSWERABLE_DIMENSION_KEYS,
  CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION,
  CLIENT_FOLLOWUP_QUEUE_TYPE,
  CLIENT_FOLLOWUP_TARGET_OBJECT_TYPE,
  CLIENT_FOLLOWUP_QUEUE_STATUS,
  CLIENT_FOLLOWUP_REVIEW_STATUS,
  CLIENT_FOLLOWUP_PRIORITY,
  CLIENT_FOLLOWUP_SUMMARY,
} from "../validators/kaiClaimGapFollowupValidators.js";

/**
 * KAI P2-04 deterministic claim-gap/client-followup repository adapter:
 * transaction-scoped generation, review-gated persistence, and authoritative
 * replay of `kai.gap_log_items`, `kai.client_followup_items`, and their
 * `client_followup` `kai.review_queue_items` rows, derived only from the
 * read-only P2-02 evidence-coverage-assessment dimension functions invoked
 * against this package's own transaction-scoped authoritative reads. This
 * module never copies, forks, renames, or reimplements P2-02's ten dimensions
 * or its assessment-result vocabulary - it imports and calls the exact P2-02
 * dimension functions from `Backend/kai/validators/
 * kaiEvidenceCoverageAssessmentValidators.js`, and reuses (rather than
 * duplicates) three of P2-02's own read helpers via
 * `__evidenceCoverageAssessmentRepositoryTestables`, passing this package's own
 * transaction client so no separate transaction is ever opened by P2-02.
 *
 * This module is the only authorized location for P2-04's own SQL, other than
 * the reused `getScoped*` lookups already committed to
 * Backend/kai/db/kaiIntakeQueries.js.
 *
 * Fresh-write-vs-replay-vs-conflict decision is made from a synchronous
 * precheck read of every already-committed gap/follow-up/queue row for this
 * claim, BEFORE any insert is attempted - partial or mismatched existing state
 * is rejected as `conflict_current_state_changed` with zero mutation, never
 * silently repaired. When the precheck finds a totally empty prior state, every
 * expected row is written via a single multi-row `INSERT ... ON CONFLICT ...
 * DO NOTHING RETURNING` statement per table, so two genuinely concurrent
 * identical calls converge cleanly: whichever transaction commits first wins
 * every row (the loser's bulk INSERT blocks on the first colliding unique key
 * until the winner's transaction commits, then finds every key already taken
 * and returns zero rows), never a partial split.
 */

const CLAIM_GAP_FOLLOWUP_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const CLAIM_GAP_FOLLOWUP_AUDIT_CONTRACT = "p2_claim_gap_followup_v1";
const CLAIM_GAP_FOLLOWUP_VALIDATOR_KEY = "VAL-KAI-P2-04-001";
const CLAIM_GAP_FOLLOWUP_AUDIT_OPERATION = "claim_gap_and_followup_generated";

const DIMENSION_KEYS = Object.freeze([
  "missingness",
  "duplicates",
  "definition_clarity",
  "denominator_clarity",
  "time_period_clarity",
  "entity_level_clarity",
  "small_cell_risk",
  "conflicting_source_indicators",
  "requirement_alignment",
  "coverage_gaps",
]);

const {
  readSensitivityProfileForAssessment,
  readDataDictionaryFieldsForAssessment,
  readDataQualityFindingsForAssessment,
  readEvidenceCoverageFieldKeys,
} = __evidenceCoverageAssessmentRepositoryTestables;

function claimGapFollowupFailure(code) {
  return {
    ok: false,
    data: null,
    error: { code, status: CLAIM_GAP_FOLLOWUP_RESULT_STATUS[code] },
  };
}

function claimGapFollowupSuccess(data) {
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

function validateGenerateInput(input) {
  const allowedKeys = new Set(["organizationId", "claimId", "actorUserId", "now", "metadataOnlyAudit"]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.claimId) &&
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

function safeSummaryFor(dimensionKey) {
  return `Claim gap requires review for dimension: ${dimensionKey}.`;
}

/**
 * Extracts only the metadata-safe counts this package is authorized to persist
 * from a P2-02 dimension result's own `evidence` object - never a sample value,
 * an uncovered-field-key list, or any other free-form field.
 */
function extractSafeCounts(evidence) {
  const source = evidence || {};
  return {
    open_finding_count: typeof source.open_finding_count === "number" ? source.open_finding_count : null,
    field_count: typeof source.field_count === "number" ? source.field_count : null,
    undefined_field_count: typeof source.undefined_field_count === "number" ? source.undefined_field_count : null,
    uncovered_field_count: typeof source.uncovered_field_count === "number" ? source.uncovered_field_count : null,
  };
}

/**
 * Invokes the exact P2-02 dimension-assessment functions, in the exact P2-02
 * dimension-key order, over this transaction's own authoritative reads. Never
 * forks or reinterprets any dimension's logic.
 */
function computeDimensions(rows) {
  return {
    missingness: assessMissingness(rows.qualityFindingRows),
    duplicates: assessDuplicates(rows.qualityFindingRows),
    definition_clarity: assessDefinitionClarity(rows.dictionaryFieldRows),
    denominator_clarity: assessDenominatorClarity(),
    time_period_clarity: assessTimePeriodClarity(),
    entity_level_clarity: assessEntityLevelClarity(rows.dictionaryFieldRows),
    small_cell_risk: assessSmallCellRisk(rows.profileRow),
    conflicting_source_indicators: assessConflictingSourceIndicators(),
    requirement_alignment: assessRequirementAlignment(),
    coverage_gaps: assessCoverageGaps(rows.dictionaryFieldRows, rows.evidenceFieldKeys),
  };
}

/**
 * Builds the complete deterministic expected gap-plan set: one entry per
 * dimension whose authoritative assessment_status is not 'resolved_clear', in
 * the fixed DIMENSION_KEYS order.
 */
function buildExpectedGapPlans(dimensions) {
  const plans = [];
  for (const dimensionKey of DIMENSION_KEYS) {
    const result = dimensions[dimensionKey];
    if (!dimensionResultRequiresGap(result)) continue;
    const counts = extractSafeCounts(result.evidence);
    plans.push({
      dimension_key: dimensionKey,
      assessment_status: result.evidence.assessment_status,
      validator_key: result.validator_key,
      safe_summary: safeSummaryFor(dimensionKey),
      ...counts,
    });
  }
  return plans;
}

function buildExpectedFollowupDimensionKeys(expectedGapPlans) {
  const gapDimensionKeys = new Set(expectedGapPlans.map((plan) => plan.dimension_key));
  return CLIENT_ANSWERABLE_DIMENSION_KEYS.filter((dimensionKey) => gapDimensionKeys.has(dimensionKey));
}

async function readExistingGapRows(tx, { organizationId, claimId }) {
  const { rows } = await tx.query(
    `SELECT gap_log_item_id, organization_id, claim_id, evidence_item_id, source_version_id,
            dimension_key, assessment_status, validator_key, safe_summary,
            open_finding_count, field_count, undefined_field_count, uncovered_field_count,
            created_by_type, created_at
       FROM kai.gap_log_items
      WHERE organization_id = $1
        AND claim_id = $2
      ORDER BY dimension_key ASC`,
    [organizationId, claimId],
  );
  return rows;
}

async function readExistingFollowupRows(tx, { organizationId, claimId }) {
  const { rows } = await tx.query(
    `SELECT client_followup_item_id, organization_id, claim_id, gap_log_item_id,
            dimension_key, question_text, created_by_type, created_at
       FROM kai.client_followup_items
      WHERE organization_id = $1
        AND claim_id = $2
      ORDER BY dimension_key ASC`,
    [organizationId, claimId],
  );
  return rows;
}

async function readExistingFollowupQueueRows(tx, { organizationId, followupIds }) {
  if (followupIds.length === 0) return [];
  const { rows } = await tx.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type, target_object_id,
            priority, queue_status, review_status, assigned_to, due_at, summary, required_action,
            created_at, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1
        AND queue_type = 'client_followup'
        AND target_object_id = ANY($2::uuid[])`,
    [organizationId, followupIds],
  );
  return rows;
}

function rowToGapRecord(row) {
  return {
    gap_log_item_id: row.gap_log_item_id,
    organization_id: row.organization_id,
    claim_id: row.claim_id,
    evidence_item_id: row.evidence_item_id,
    source_version_id: row.source_version_id,
    dimension_key: row.dimension_key,
    assessment_status: row.assessment_status,
    validator_key: row.validator_key,
    safe_summary: row.safe_summary,
    open_finding_count: row.open_finding_count,
    field_count: row.field_count,
    undefined_field_count: row.undefined_field_count,
    uncovered_field_count: row.uncovered_field_count,
    created_by_type: row.created_by_type,
    created_at: asIso(row.created_at),
  };
}

function rowToFollowupRecord(row) {
  return {
    client_followup_item_id: row.client_followup_item_id,
    organization_id: row.organization_id,
    claim_id: row.claim_id,
    gap_log_item_id: row.gap_log_item_id,
    dimension_key: row.dimension_key,
    question_text: row.question_text,
    created_by_type: row.created_by_type,
    created_at: asIso(row.created_at),
  };
}

function rowToQueueRecord(row) {
  return {
    review_queue_item_id: row.review_queue_item_id,
    organization_id: row.organization_id,
    queue_type: row.queue_type,
    target_object_type: row.target_object_type,
    target_object_id: row.target_object_id,
    priority: row.priority,
    queue_status: row.queue_status,
    review_status: row.review_status,
    assigned_to: row.assigned_to,
    due_at: row.due_at,
    summary: row.summary,
    required_action: row.required_action,
  };
}

/**
 * Deep-equality check between the existing committed gap rows and the
 * complete deterministic expected gap-plan set: same dimension-key set, same
 * assessment_status/validator_key/safe_summary/counts/lineage identity for
 * every one.
 */
function gapRowsMatchExpectation(existingGapRows, expectedGapPlans, { evidenceItemId, sourceVersionId }) {
  if (existingGapRows.length !== expectedGapPlans.length) return false;
  const existingByDim = new Map(existingGapRows.map((row) => [row.dimension_key, row]));
  return expectedGapPlans.every((plan) => {
    const row = existingByDim.get(plan.dimension_key);
    if (!row) return false;
    return (
      row.evidence_item_id === evidenceItemId &&
      row.source_version_id === sourceVersionId &&
      row.assessment_status === plan.assessment_status &&
      row.validator_key === plan.validator_key &&
      row.safe_summary === plan.safe_summary &&
      row.open_finding_count === plan.open_finding_count &&
      row.field_count === plan.field_count &&
      row.undefined_field_count === plan.undefined_field_count &&
      row.uncovered_field_count === plan.uncovered_field_count
    );
  });
}

function followupRowsMatchExpectation(existingFollowupRows, expectedFollowupDimensionKeys, existingGapRows, { claimId }) {
  if (existingFollowupRows.length !== expectedFollowupDimensionKeys.length) return false;
  const existingGapByDim = new Map(existingGapRows.map((row) => [row.dimension_key, row]));
  const existingFollowupByDim = new Map(existingFollowupRows.map((row) => [row.dimension_key, row]));
  return expectedFollowupDimensionKeys.every((dimensionKey) => {
    const followupRow = existingFollowupByDim.get(dimensionKey);
    const gapRow = existingGapByDim.get(dimensionKey);
    if (!followupRow || !gapRow) return false;
    return (
      followupRow.claim_id === claimId &&
      followupRow.gap_log_item_id === gapRow.gap_log_item_id &&
      followupRow.question_text === CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[dimensionKey]
    );
  });
}

function queueRowsMatchExpectation(existingQueueRows, existingFollowupRows) {
  if (existingQueueRows.length !== existingFollowupRows.length) return false;
  const followupById = new Map(existingFollowupRows.map((row) => [row.client_followup_item_id, row]));
  return existingQueueRows.every((queueRow) => {
    const followupRow = followupById.get(queueRow.target_object_id);
    if (!followupRow) return false;
    const expectedQuestion = CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[followupRow.dimension_key];
    return (
      queueRow.queue_type === CLIENT_FOLLOWUP_QUEUE_TYPE &&
      queueRow.target_object_type === CLIENT_FOLLOWUP_TARGET_OBJECT_TYPE &&
      queueRow.queue_status === CLIENT_FOLLOWUP_QUEUE_STATUS &&
      queueRow.review_status === CLIENT_FOLLOWUP_REVIEW_STATUS &&
      queueRow.priority === CLIENT_FOLLOWUP_PRIORITY &&
      queueRow.summary === CLIENT_FOLLOWUP_SUMMARY &&
      queueRow.required_action === expectedQuestion &&
      queueRow.assigned_to === null &&
      queueRow.due_at === null
    );
  });
}

async function insertGapRowsBulk(tx, { organizationId, claimId, evidenceItemId, sourceVersionId, plans }) {
  if (plans.length === 0) return [];
  const columnsPerRow = 13;
  const values = [];
  const placeholders = plans.map((plan, index) => {
    const base = index * columnsPerRow;
    values.push(
      organizationId,
      claimId,
      evidenceItemId,
      sourceVersionId,
      plan.dimension_key,
      plan.assessment_status,
      plan.validator_key,
      plan.safe_summary,
      plan.open_finding_count,
      plan.field_count,
      plan.undefined_field_count,
      plan.uncovered_field_count,
      "system",
    );
    const placeholderNumbers = Array.from({ length: columnsPerRow }, (_, offset) => `$${base + offset + 1}`);
    return `(${placeholderNumbers.join(", ")})`;
  });
  const insertResult = await tx.query(
    `INSERT INTO kai.gap_log_items (
       organization_id, claim_id, evidence_item_id, source_version_id, dimension_key,
       assessment_status, validator_key, safe_summary,
       open_finding_count, field_count, undefined_field_count, uncovered_field_count, created_by_type
     ) VALUES ${placeholders.join(", ")}
     ON CONFLICT (organization_id, claim_id, dimension_key)
       DO NOTHING
     RETURNING gap_log_item_id, organization_id, claim_id, evidence_item_id, source_version_id,
               dimension_key, assessment_status, validator_key, safe_summary,
               open_finding_count, field_count, undefined_field_count, uncovered_field_count,
               created_by_type, created_at`,
    values,
  );
  return insertResult.rows;
}

async function insertFollowupRowsBulk(tx, { organizationId, claimId, followupPlans }) {
  if (followupPlans.length === 0) return [];
  const columnsPerRow = 5;
  const values = [];
  const placeholders = followupPlans.map((plan, index) => {
    const base = index * columnsPerRow;
    values.push(organizationId, claimId, plan.gap_log_item_id, plan.dimension_key, plan.question_text);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, 'system')`;
  });
  const result = await tx.query(
    `INSERT INTO kai.client_followup_items (
       organization_id, claim_id, gap_log_item_id, dimension_key, question_text, created_by_type
     ) VALUES ${placeholders.join(", ")}
     ON CONFLICT (organization_id, claim_id, dimension_key)
       DO NOTHING
     RETURNING client_followup_item_id, organization_id, claim_id, gap_log_item_id, dimension_key,
               question_text, created_by_type, created_at`,
    values,
  );
  return result.rows;
}

async function insertFollowupQueueRowsBulk(tx, { organizationId, followupRecords }) {
  if (followupRecords.length === 0) return [];
  const columnsPerRow = 9;
  const values = [];
  const placeholders = followupRecords.map((record, index) => {
    const base = index * columnsPerRow;
    values.push(
      organizationId,
      CLIENT_FOLLOWUP_QUEUE_TYPE,
      CLIENT_FOLLOWUP_TARGET_OBJECT_TYPE,
      record.client_followup_item_id,
      CLIENT_FOLLOWUP_QUEUE_STATUS,
      CLIENT_FOLLOWUP_REVIEW_STATUS,
      CLIENT_FOLLOWUP_PRIORITY,
      CLIENT_FOLLOWUP_SUMMARY,
      CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[record.dimension_key],
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::uuid, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, NULL, NULL, '{}'::jsonb, 'system')`;
  });
  const result = await tx.query(
    `INSERT INTO kai.review_queue_items (
       organization_id, queue_type, target_object_type, target_object_id,
       queue_status, review_status, priority, summary, required_action, assigned_to, due_at,
       queue_metadata, created_by_type
     ) VALUES ${placeholders.join(", ")}
     ON CONFLICT (organization_id, queue_type, target_object_type, target_object_id)
       WHERE queue_type = 'client_followup'
       DO NOTHING
     RETURNING review_queue_item_id, organization_id, queue_type, target_object_type, target_object_id,
               priority, queue_status, review_status, assigned_to, due_at, summary, required_action,
               created_at, updated_at`,
    values,
  );
  return result.rows;
}

class MalformedInsertedRowError extends Error {
  constructor(what) {
    super(`inserted ${what} row failed validation`);
    this.name = "MalformedInsertedRowError";
  }
}

class ConcurrentStateChangedError extends Error {
  constructor(what) {
    super(`${what} changed concurrently during claim-gap/client-followup generation`);
    this.name = "ConcurrentStateChangedError";
  }
}

class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

/**
 * Full post-write contract verification over the freshly inserted (or
 * authoritatively reread) gap/follow-up/queue records, re-asserting every
 * immutable column this package's write plan guarantees.
 */
function verifyPostWriteContract({ gapRecords, followupRecords, queueRecords, organizationId, claimId, evidenceItemId, sourceVersionId, expectedGapPlans, expectedFollowupDimensionKeys }) {
  if (gapRecords.length !== expectedGapPlans.length) throw new MalformedInsertedRowError("gap_log_items");
  const gapByDim = new Map(gapRecords.map((row) => [row.dimension_key, row]));
  for (const plan of expectedGapPlans) {
    const row = gapByDim.get(plan.dimension_key);
    const ok =
      row &&
      row.organization_id === organizationId &&
      row.claim_id === claimId &&
      row.evidence_item_id === evidenceItemId &&
      row.source_version_id === sourceVersionId &&
      row.assessment_status === plan.assessment_status &&
      row.validator_key === plan.validator_key &&
      row.safe_summary === plan.safe_summary;
    if (!ok) throw new MalformedInsertedRowError("gap_log_items");
  }

  if (followupRecords.length !== expectedFollowupDimensionKeys.length) throw new MalformedInsertedRowError("client_followup_items");
  const followupByDim = new Map(followupRecords.map((row) => [row.dimension_key, row]));
  for (const dimensionKey of expectedFollowupDimensionKeys) {
    const followupRow = followupByDim.get(dimensionKey);
    const gapRow = gapByDim.get(dimensionKey);
    const ok =
      followupRow &&
      gapRow &&
      followupRow.organization_id === organizationId &&
      followupRow.claim_id === claimId &&
      followupRow.gap_log_item_id === gapRow.gap_log_item_id &&
      followupRow.question_text === CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[dimensionKey];
    if (!ok) throw new MalformedInsertedRowError("client_followup_items");
  }

  if (queueRecords.length !== expectedFollowupDimensionKeys.length) throw new MalformedInsertedRowError("review_queue_items");
  const queueByTarget = new Map(queueRecords.map((row) => [row.target_object_id, row]));
  for (const dimensionKey of expectedFollowupDimensionKeys) {
    const followupRow = followupByDim.get(dimensionKey);
    const queueRow = followupRow ? queueByTarget.get(followupRow.client_followup_item_id) : null;
    const ok =
      queueRow &&
      queueRow.organization_id === organizationId &&
      queueRow.queue_type === CLIENT_FOLLOWUP_QUEUE_TYPE &&
      queueRow.target_object_type === CLIENT_FOLLOWUP_TARGET_OBJECT_TYPE &&
      queueRow.queue_status === CLIENT_FOLLOWUP_QUEUE_STATUS &&
      queueRow.review_status === CLIENT_FOLLOWUP_REVIEW_STATUS &&
      queueRow.priority === CLIENT_FOLLOWUP_PRIORITY &&
      queueRow.summary === CLIENT_FOLLOWUP_SUMMARY &&
      queueRow.required_action === CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[dimensionKey] &&
      queueRow.assigned_to === null &&
      queueRow.due_at === null;
    if (!ok) throw new MalformedInsertedRowError("review_queue_items");
  }
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
    [organizationId, intakeFileId, CLAIM_GAP_FOLLOWUP_AUDIT_OPERATION, uploadState, uploadState, JSON.stringify(metadata), now],
  );
}

function buildClaimGapFollowupAuditMetadata({ claimId, evidenceItemId, sourceVersionId, gapDimensionKeys, followupDimensionKeys, freshWriteCount }) {
  return {
    metadata_only: true,
    contract: CLAIM_GAP_FOLLOWUP_AUDIT_CONTRACT,
    claim_id: claimId,
    evidence_item_id: evidenceItemId,
    source_version_id: sourceVersionId,
    gap_dimension_keys: gapDimensionKeys,
    client_followup_dimension_keys: followupDimensionKeys,
    gap_count: gapDimensionKeys.length,
    client_followup_count: followupDimensionKeys.length,
    review_queue_item_count: followupDimensionKeys.length,
    fresh_write_count: freshWriteCount,
    validator_key: CLAIM_GAP_FOLLOWUP_VALIDATOR_KEY,
  };
}

function buildClaimGapFollowupAuditPayload(context) {
  return {
    attempted_operation: CLAIM_GAP_FOLLOWUP_AUDIT_OPERATION,
    actor_type: "human",
    contract: CLAIM_GAP_FOLLOWUP_AUDIT_CONTRACT,
    object_type: "claim",
    request_scope: "organization_claim",
    route_contract: "unwired_synthetic_claim_gap_followup",
    sprint_phase: "kai_sprint2_p2_04",
    validator_key: CLAIM_GAP_FOLLOWUP_VALIDATOR_KEY,
    claim_id: context.claimId,
    evidence_item_id: context.evidenceItemId,
    source_version_id: context.sourceVersionId,
    gap_count: context.gapDimensionKeys.length,
    client_followup_count: context.followupDimensionKeys.length,
    fresh_write_count: context.freshWriteCount,
  };
}

function prepareRequiredAudit(metadataOnlyAudit, context) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: buildClaimGapFollowupAuditPayload(context),
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

function shapeClaimGapFollowupError(error) {
  if (error instanceof MalformedInsertedRowError) return claimGapFollowupFailure("system_error");
  if (error instanceof ConcurrentStateChangedError) return claimGapFollowupFailure("conflict_current_state_changed");
  if (error instanceof RequiredAuditRejectedError) return claimGapFollowupFailure("validation_blocker");
  if (error?.code === "23503") return claimGapFollowupFailure("not_found");
  if (error?.code === "23514" || error?.code === "P0001" || error?.code === "22P02") {
    return claimGapFollowupFailure("validation_blocker");
  }
  return claimGapFollowupFailure("system_error");
}

async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

export function createPostgresClaimGapFollowupRepository({
  runInTransaction,
  beforeInsert = async () => {},
  computeDimensions: computeDimensionsForTesting,
} = {}) {
  const computeDimensionsFn = computeDimensionsForTesting || computeDimensions;
  return Object.freeze({
    async generateClaimGapsAndFollowups(input) {
      if (!validateGenerateInput(input)) return claimGapFollowupFailure("validation_blocker");
      const { organizationId, claimId, now, metadataOnlyAudit } = input;
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      try {
        return await run(async (tx) => {
          await beforeInsert();

          const claimRow = await getScopedClaimById({ organizationId, claimId }, tx);
          if (!claimRow) return claimGapFollowupFailure("not_found");

          const claimEvidenceLinkRow = await getScopedClaimEvidenceLinkByClaimId({ organizationId, claimId }, tx);
          if (!claimEvidenceLinkRow) return claimGapFollowupFailure("not_found");

          const evidenceItemRow = await getScopedEvidenceItemById(
            { organizationId, evidenceItemId: claimEvidenceLinkRow.evidence_item_id },
            tx,
          );
          if (!evidenceItemRow) return claimGapFollowupFailure("not_found");

          const locatorRow = await getScopedSourceLocatorById(
            { organizationId, sourceLocatorId: evidenceItemRow.source_locator_id },
            tx,
          );
          if (!locatorRow) return claimGapFollowupFailure("not_found");

          const sourceRow = await getScopedSourceById({ organizationId, sourceId: evidenceItemRow.source_id }, tx);
          if (!sourceRow) return claimGapFollowupFailure("not_found");

          const sourceVersionRow = await getScopedSourceVersionById(
            { organizationId, sourceVersionId: evidenceItemRow.source_version_id },
            tx,
          );
          if (!sourceVersionRow) return claimGapFollowupFailure("not_found");

          const candidateRow = await getScopedSourceCandidateByIdentity(
            { organizationId, intakeSourceCandidateId: sourceVersionRow.intake_source_candidate_id },
            tx,
          );
          if (!candidateRow) return claimGapFollowupFailure("not_found");

          const decisionRow = await getScopedPromotionDecisionBySourceVersionId(
            { organizationId, sourceVersionId: evidenceItemRow.source_version_id },
            tx,
          );
          if (!decisionRow) return claimGapFollowupFailure("not_found");

          const evidenceReviewQueueItemRow = await getScopedEvidenceReviewQueueItemByEvidenceItemId(
            { organizationId, evidenceItemId: evidenceItemRow.evidence_item_id },
            tx,
          );
          if (!evidenceReviewQueueItemRow) return claimGapFollowupFailure("not_found");

          const profileRow = await readSensitivityProfileForAssessment(
            { organizationId, intakeSensitivityProfileId: candidateRow.intake_sensitivity_profile_id },
            tx,
          );
          if (!profileRow) return claimGapFollowupFailure("not_found");

          const dictionaryRow = await getScopedDataDictionaryById(
            { organizationId, dataDictionaryId: candidateRow.data_dictionary_id },
            tx,
          );
          if (!dictionaryRow) return claimGapFollowupFailure("not_found");

          const dictionaryFieldRows = await readDataDictionaryFieldsForAssessment(
            { organizationId, dataDictionaryId: dictionaryRow.data_dictionary_id },
            tx,
          );
          const qualityFindingRows = await readDataQualityFindingsForAssessment(
            { organizationId, dataDictionaryId: dictionaryRow.data_dictionary_id },
            tx,
          );
          const evidenceFieldKeys = await readEvidenceCoverageFieldKeys(
            { organizationId, sourceVersionId: evidenceItemRow.source_version_id },
            tx,
          );

          const rows = {
            claimRow,
            claimEvidenceLinkRow,
            evidenceItemRow,
            locatorRow,
            sourceRow,
            sourceVersionRow,
            candidateRow,
            decisionRow,
            evidenceReviewQueueItemRow,
            profileRow,
            dictionaryRow,
          };

          const lineageValidation = validateClaimGapLineage(rows);
          if (!lineageValidation.ok) return claimGapFollowupFailure(lineageValidation.code);

          const dimensions = computeDimensionsFn({ dictionaryFieldRows, qualityFindingRows, profileRow, evidenceFieldKeys });
          const expectedGapPlans = buildExpectedGapPlans(dimensions);
          const expectedFollowupDimensionKeys = buildExpectedFollowupDimensionKeys(expectedGapPlans);

          const evidenceItemId = evidenceItemRow.evidence_item_id;
          const sourceVersionId = evidenceItemRow.source_version_id;

          const existingGapRows = await readExistingGapRows(tx, { organizationId, claimId });
          const existingFollowupRows = await readExistingFollowupRows(tx, { organizationId, claimId });
          const existingQueueRows = await readExistingFollowupQueueRows(tx, {
            organizationId,
            followupIds: existingFollowupRows.map((row) => row.client_followup_item_id),
          });

          const existingIsTotallyEmpty =
            existingGapRows.length === 0 && existingFollowupRows.length === 0 && existingQueueRows.length === 0;

          if (existingIsTotallyEmpty && expectedGapPlans.length === 0) {
            return claimGapFollowupSuccess({
              gapItems: [],
              clientFollowupItems: [],
              reviewQueueItems: [],
              replayed: true,
            });
          }

          if (!existingIsTotallyEmpty) {
            const gapsMatch = gapRowsMatchExpectation(existingGapRows, expectedGapPlans, { evidenceItemId, sourceVersionId });
            const followupsMatch =
              gapsMatch && followupRowsMatchExpectation(existingFollowupRows, expectedFollowupDimensionKeys, existingGapRows, { claimId });
            const queuesMatch = followupsMatch && queueRowsMatchExpectation(existingQueueRows, existingFollowupRows);

            if (gapsMatch && followupsMatch && queuesMatch) {
              return claimGapFollowupSuccess({
                gapItems: existingGapRows.map(rowToGapRecord),
                clientFollowupItems: existingFollowupRows.map(rowToFollowupRecord),
                reviewQueueItems: existingQueueRows.map(rowToQueueRecord),
                replayed: true,
              });
            }
            return claimGapFollowupFailure("conflict_current_state_changed");
          }

          // Fresh-write path: precheck confirmed a totally empty prior state.
          const insertedGapRows = await insertGapRowsBulk(tx, {
            organizationId,
            claimId,
            evidenceItemId,
            sourceVersionId,
            plans: expectedGapPlans,
          });

          if (insertedGapRows.length === 0) {
            // Lost a genuine concurrent race for the whole set: the winner's
            // transaction has already committed every row by the time our
            // blocked bulk INSERT unblocks and finds every key taken. Reread
            // authoritatively and treat as a replay.
            const rereadGapRows = await readExistingGapRows(tx, { organizationId, claimId });
            const rereadFollowupRows = await readExistingFollowupRows(tx, { organizationId, claimId });
            const rereadQueueRows = await readExistingFollowupQueueRows(tx, {
              organizationId,
              followupIds: rereadFollowupRows.map((row) => row.client_followup_item_id),
            });
            const matches =
              gapRowsMatchExpectation(rereadGapRows, expectedGapPlans, { evidenceItemId, sourceVersionId }) &&
              followupRowsMatchExpectation(rereadFollowupRows, expectedFollowupDimensionKeys, rereadGapRows, { claimId }) &&
              queueRowsMatchExpectation(rereadQueueRows, rereadFollowupRows);
            if (!matches) throw new ConcurrentStateChangedError("gap_log_items");
            return claimGapFollowupSuccess({
              gapItems: rereadGapRows.map(rowToGapRecord),
              clientFollowupItems: rereadFollowupRows.map(rowToFollowupRecord),
              reviewQueueItems: rereadQueueRows.map(rowToQueueRecord),
              replayed: true,
            });
          }

          if (insertedGapRows.length !== expectedGapPlans.length) {
            // A genuine partial split is never expected for two identical
            // concurrent calls (see module doc comment); fail closed rather
            // than repair.
            throw new ConcurrentStateChangedError("gap_log_items");
          }

          const gapRowByDimension = new Map(insertedGapRows.map((row) => [row.dimension_key, row]));
          const followupPlans = [];
          for (const dimensionKey of expectedFollowupDimensionKeys) {
            const gapRow = gapRowByDimension.get(dimensionKey);
            const questionText = CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[dimensionKey];
            const followupWritePlan = {
              organization_id: organizationId,
              claim_id: claimId,
              gap_log_item_id: gapRow.gap_log_item_id,
              dimension_key: dimensionKey,
              question_text: questionText,
            };
            const queueWritePlan = {
              organization_id: organizationId,
              queue_type: CLIENT_FOLLOWUP_QUEUE_TYPE,
              target_object_type: CLIENT_FOLLOWUP_TARGET_OBJECT_TYPE,
              queue_status: CLIENT_FOLLOWUP_QUEUE_STATUS,
              review_status: CLIENT_FOLLOWUP_REVIEW_STATUS,
              priority: CLIENT_FOLLOWUP_PRIORITY,
              summary: CLIENT_FOLLOWUP_SUMMARY,
              required_action: questionText,
              assigned_to: null,
              due_at: null,
            };
            const routingCheck = validateClientFollowupRouting({
              dimensionKey,
              gapRow,
              claimRow: { organization_id: organizationId, claim_id: claimId },
              followupWritePlan,
              queueWritePlan,
            });
            if (!routingCheck.ok) throw new MalformedInsertedRowError("client_followup_items");
            followupPlans.push({ dimension_key: dimensionKey, gap_log_item_id: gapRow.gap_log_item_id, question_text: questionText });
          }

          const insertedFollowupRows = await insertFollowupRowsBulk(tx, { organizationId, claimId, followupPlans });
          if (insertedFollowupRows.length !== followupPlans.length) {
            throw new ConcurrentStateChangedError("client_followup_items");
          }

          const insertedQueueRows = await insertFollowupQueueRowsBulk(tx, { organizationId, followupRecords: insertedFollowupRows });
          if (insertedQueueRows.length !== insertedFollowupRows.length) {
            throw new ConcurrentStateChangedError("review_queue_items");
          }

          verifyPostWriteContract({
            gapRecords: insertedGapRows,
            followupRecords: insertedFollowupRows,
            queueRecords: insertedQueueRows,
            organizationId,
            claimId,
            evidenceItemId,
            sourceVersionId,
            expectedGapPlans,
            expectedFollowupDimensionKeys,
          });

          const uploadState = await readScopedUploadState(tx, organizationId, candidateRow.intake_file_id);
          if (!uploadState) return claimGapFollowupFailure("not_found");

          const auditContext = {
            claimId,
            evidenceItemId,
            sourceVersionId,
            gapDimensionKeys: expectedGapPlans.map((plan) => plan.dimension_key),
            followupDimensionKeys: expectedFollowupDimensionKeys,
            freshWriteCount: insertedGapRows.length + insertedFollowupRows.length + insertedQueueRows.length,
          };
          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, auditContext);
          await insertAudit(tx, {
            organizationId,
            intakeFileId: candidateRow.intake_file_id,
            uploadState,
            metadata: buildClaimGapFollowupAuditMetadata(auditContext),
            now,
          });
          await preparedAudit.publish();

          return claimGapFollowupSuccess({
            gapItems: insertedGapRows.map(rowToGapRecord),
            clientFollowupItems: insertedFollowupRows.map(rowToFollowupRecord),
            reviewQueueItems: insertedQueueRows.map(rowToQueueRecord),
            replayed: false,
          });
        });
      } catch (error) {
        return shapeClaimGapFollowupError(error);
      }
    },
  });
}

export const __claimGapFollowupRepositoryContract = Object.freeze({
  CLAIM_GAP_FOLLOWUP_AUDIT_CONTRACT,
  CLAIM_GAP_FOLLOWUP_VALIDATOR_KEY,
  CLAIM_GAP_FOLLOWUP_AUDIT_OPERATION,
  DIMENSION_KEYS,
});

export const __claimGapFollowupRepositoryTestables = Object.freeze({
  buildExpectedGapPlans,
  buildExpectedFollowupDimensionKeys,
  extractSafeCounts,
  safeSummaryFor,
  gapRowsMatchExpectation,
  followupRowsMatchExpectation,
  queueRowsMatchExpectation,
  RequiredAuditRejectedError,
  ConcurrentStateChangedError,
  MalformedInsertedRowError,
});
