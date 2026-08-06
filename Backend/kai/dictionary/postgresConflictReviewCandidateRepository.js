import { randomUUID } from "node:crypto";
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
import { __evidenceCoverageAssessmentRepositoryTestables } from "./postgresEvidenceCoverageAssessmentRepository.js";
import { validateClaimGapLineage } from "../validators/kaiClaimGapFollowupValidators.js";
import {
  CONFLICT_GROUP_BASIS_CODE,
  CONFLICT_GROUP_SAFE_SUMMARY,
  CONFLICT_GROUP_VALIDATOR_KEY,
  CONFLICT_RESOLUTION_PRIORITY,
  CONFLICT_RESOLUTION_QUEUE_STATUS,
  CONFLICT_RESOLUTION_QUEUE_TYPE,
  CONFLICT_RESOLUTION_REQUIRED_ACTION,
  CONFLICT_RESOLUTION_REVIEW_STATUS,
  CONFLICT_RESOLUTION_TARGET_OBJECT_TYPE,
  validateConflictGroupCompleteness,
} from "../validators/kaiConflictGroupValidators.js";

const CONFLICT_REVIEW_CANDIDATE_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const CONFLICT_REVIEW_CANDIDATE_AUDIT_CONTRACT = "p2_conflict_review_candidate_v1";
const CONFLICT_REVIEW_CANDIDATE_AUDIT_OPERATION = "conflict_review_candidate_created";

const { readSensitivityProfileForAssessment } = __evidenceCoverageAssessmentRepositoryTestables;

function failure(code, blockers) {
  return {
    ok: false,
    data: null,
    error: { code, status: CONFLICT_REVIEW_CANDIDATE_RESULT_STATUS[code] },
    ...(blockers ? { blockers } : {}),
  };
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

function validateRepositoryInput(input) {
  const allowedKeys = new Set([
    "organizationId",
    "firstClaimId",
    "secondClaimId",
    "actorUserId",
    "now",
    "metadataOnlyAudit",
  ]);
  if (!isPlainObject(input) || !hasOnlyKeys(input, allowedKeys)) return false;
  return (
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.firstClaimId) &&
    isNonEmptyString(input.secondClaimId) &&
    isNonEmptyString(input.actorUserId) &&
    isNormalizedNow(input.now) &&
    isMetadataOnlyAuditDependency(input.metadataOnlyAudit)
  );
}

function normalizeClaimPair(firstClaimId, secondClaimId) {
  return firstClaimId < secondClaimId
    ? { lowerClaimId: firstClaimId, higherClaimId: secondClaimId }
    : { lowerClaimId: secondClaimId, higherClaimId: firstClaimId };
}

function asIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

async function readClaimReviewQueueItem(tx, { organizationId, claimId }) {
  const { rows } = await tx.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, priority, queue_status, review_status, assigned_to,
            due_at, summary, required_action, queue_metadata, created_at, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = 'claim_review'
        AND target_object_type = 'claim'
        AND target_object_id = $2::uuid
      LIMIT 1`,
    [organizationId, claimId],
  );
  return rows[0] ?? null;
}

async function readConflictIndicatorGap(tx, { organizationId, claimId }) {
  const { rows } = await tx.query(
    `SELECT gap_log_item_id, organization_id, claim_id, evidence_item_id, source_version_id,
            dimension_key, assessment_status, validator_key, safe_summary, created_by_type, created_at
       FROM kai.gap_log_items
      WHERE organization_id = $1::uuid
        AND claim_id = $2::uuid
        AND dimension_key = 'conflicting_source_indicators'
      LIMIT 1`,
    [organizationId, claimId],
  );
  return rows[0] ?? null;
}

async function readExistingConflictGroup(tx, { organizationId, lowerClaimId, higherClaimId }) {
  const { rows } = await tx.query(
    `SELECT conflict_group_id, organization_id, lower_claim_id, higher_claim_id,
            lower_claim_conflict_gap_id, higher_claim_conflict_gap_id, basis_code,
            safe_summary, created_by_type, created_at
       FROM kai.conflict_groups
      WHERE organization_id = $1::uuid
        AND lower_claim_id = $2::uuid
        AND higher_claim_id = $3::uuid
      LIMIT 1`,
    [organizationId, lowerClaimId, higherClaimId],
  );
  return rows[0] ?? null;
}

async function readConflictResolutionQueueItem(tx, { organizationId, conflictGroupId }) {
  const { rows } = await tx.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, queue_status, review_status, priority, summary,
            required_action, assigned_to, due_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = 'conflict_resolution'
        AND target_object_type = 'conflict_group'
        AND target_object_id = $2::uuid
      LIMIT 1`,
    [organizationId, conflictGroupId],
  );
  return rows[0] ?? null;
}

async function insertConflictGroup(tx, plan) {
  const { rows } = await tx.query(
    `INSERT INTO kai.conflict_groups (
       conflict_group_id, organization_id, lower_claim_id, higher_claim_id,
       lower_claim_conflict_gap_id, higher_claim_conflict_gap_id,
       basis_code, safe_summary, created_by_type, created_at
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10::timestamptz)
     ON CONFLICT (organization_id, lower_claim_id, higher_claim_id)
       DO NOTHING
     RETURNING conflict_group_id, organization_id, lower_claim_id, higher_claim_id,
               lower_claim_conflict_gap_id, higher_claim_conflict_gap_id, basis_code,
               safe_summary, created_by_type, created_at`,
    [
      plan.conflict_group_id,
      plan.organization_id,
      plan.lower_claim_id,
      plan.higher_claim_id,
      plan.lower_claim_conflict_gap_id,
      plan.higher_claim_conflict_gap_id,
      plan.basis_code,
      plan.safe_summary,
      plan.created_by_type,
      plan.created_at,
    ],
  );
  return rows[0] ?? null;
}

async function insertConflictResolutionQueueItem(tx, plan) {
  const { rows } = await tx.query(
    `INSERT INTO kai.review_queue_items (
       organization_id, queue_type, target_object_type, target_object_id,
       queue_status, review_status, priority, summary, required_action,
       assigned_to, due_at, queue_metadata, created_by_type
     ) VALUES ($1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8,$9,NULL,NULL,'{}'::jsonb,'system')
     ON CONFLICT (organization_id, queue_type, target_object_type, target_object_id)
       WHERE queue_type = 'conflict_resolution'
       DO NOTHING
     RETURNING review_queue_item_id, organization_id, queue_type, target_object_type,
               target_object_id, queue_status, review_status, priority, summary,
               required_action, assigned_to, due_at`,
    [
      plan.organization_id,
      plan.queue_type,
      plan.target_object_type,
      plan.target_object_id,
      plan.queue_status,
      plan.review_status,
      plan.priority,
      plan.summary,
      plan.required_action,
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

async function insertAudit(tx, { organizationId, intakeFileId, uploadState, metadata, now }) {
  await tx.query(
    `INSERT INTO kai.upload_lifecycle_audit (
       organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
     )
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'success', $6::jsonb, $7::timestamptz)`,
    [organizationId, intakeFileId, CONFLICT_REVIEW_CANDIDATE_AUDIT_OPERATION, uploadState, uploadState, JSON.stringify(metadata), now],
  );
}

function toConflictGroupRecord(row) {
  return {
    conflict_group_id: row.conflict_group_id,
    organization_id: row.organization_id,
    lower_claim_id: row.lower_claim_id,
    higher_claim_id: row.higher_claim_id,
    lower_claim_conflict_gap_id: row.lower_claim_conflict_gap_id,
    higher_claim_conflict_gap_id: row.higher_claim_conflict_gap_id,
    basis_code: row.basis_code,
    safe_summary: row.safe_summary,
    created_by_type: row.created_by_type,
    created_at: asIso(row.created_at),
  };
}

function toQueueRecord(row) {
  return {
    review_queue_item_id: row.review_queue_item_id,
    organization_id: row.organization_id,
    queue_type: row.queue_type,
    target_object_type: row.target_object_type,
    target_object_id: row.target_object_id,
    queue_status: row.queue_status,
    review_status: row.review_status,
    priority: row.priority,
    summary: row.summary,
    required_action: row.required_action,
    assigned_to: row.assigned_to,
    due_at: row.due_at,
  };
}

function buildGroupPlan({ conflictGroupId, organizationId, lowerClaimId, higherClaimId, lowerGapId, higherGapId, now }) {
  return {
    conflict_group_id: conflictGroupId,
    organization_id: organizationId,
    lower_claim_id: lowerClaimId,
    higher_claim_id: higherClaimId,
    lower_claim_conflict_gap_id: lowerGapId,
    higher_claim_conflict_gap_id: higherGapId,
    basis_code: CONFLICT_GROUP_BASIS_CODE,
    safe_summary: CONFLICT_GROUP_SAFE_SUMMARY,
    created_by_type: "system",
    created_at: now,
  };
}

function buildQueuePlan({ organizationId, conflictGroupId }) {
  return {
    organization_id: organizationId,
    queue_type: CONFLICT_RESOLUTION_QUEUE_TYPE,
    target_object_type: CONFLICT_RESOLUTION_TARGET_OBJECT_TYPE,
    target_object_id: conflictGroupId,
    queue_status: CONFLICT_RESOLUTION_QUEUE_STATUS,
    review_status: CONFLICT_RESOLUTION_REVIEW_STATUS,
    priority: CONFLICT_RESOLUTION_PRIORITY,
    summary: CONFLICT_GROUP_SAFE_SUMMARY,
    required_action: CONFLICT_RESOLUTION_REQUIRED_ACTION,
    assigned_to: null,
    due_at: null,
  };
}

function assertValidatorPass(conflictGroup, queueItem) {
  const result = validateConflictGroupCompleteness({ conflictGroup, queueItem });
  if (result?.severity === "pass") return result;
  throw new ValidationBlockerError(result);
}

function existingMatches({ groupRecord, queueRecord, organizationId, lowerClaimId, higherClaimId, lowerGapId, higherGapId }) {
  if (!groupRecord || !queueRecord) return false;
  const groupOk =
    groupRecord.organization_id === organizationId &&
    groupRecord.lower_claim_id === lowerClaimId &&
    groupRecord.higher_claim_id === higherClaimId &&
    groupRecord.lower_claim_conflict_gap_id === lowerGapId &&
    groupRecord.higher_claim_conflict_gap_id === higherGapId &&
    groupRecord.basis_code === CONFLICT_GROUP_BASIS_CODE &&
    groupRecord.safe_summary === CONFLICT_GROUP_SAFE_SUMMARY &&
    groupRecord.created_by_type === "system";
  if (!groupOk) return false;
  try {
    assertValidatorPass(toConflictGroupRecord(groupRecord), toQueueRecord(queueRecord));
    return true;
  } catch {
    return false;
  }
}

async function readClaimBundle(tx, { organizationId, claimId }) {
  const claimRow = await getScopedClaimById({ organizationId, claimId }, tx);
  if (!claimRow) return { code: "not_found" };

  const claimContractOk =
    claimRow.claim_status === "proposed" &&
    claimRow.claim_review_status === "needs_gk_review" &&
    claimRow.internal_only === true &&
    claimRow.public_use_allowed === false &&
    claimRow.funder_use_allowed === false &&
    claimRow.llm_processing_allowed === false &&
    claimRow.product_learning_allowed === false &&
    claimRow.export_ready === false;
  if (!claimContractOk) return { code: "conflict_current_state_changed" };

  const claimEvidenceLinkRow = await getScopedClaimEvidenceLinkByClaimId({ organizationId, claimId }, tx);
  if (!claimEvidenceLinkRow) return { code: "not_found" };
  if (claimEvidenceLinkRow.evidence_item_id !== claimRow.evidence_item_id) {
    return { code: "conflict_current_state_changed" };
  }

  const evidenceItemRow = await getScopedEvidenceItemById(
    { organizationId, evidenceItemId: claimEvidenceLinkRow.evidence_item_id },
    tx,
  );
  if (!evidenceItemRow) return { code: "not_found" };

  const locatorRow = await getScopedSourceLocatorById(
    { organizationId, sourceLocatorId: evidenceItemRow.source_locator_id },
    tx,
  );
  if (!locatorRow) return { code: "not_found" };

  const sourceRow = await getScopedSourceById({ organizationId, sourceId: evidenceItemRow.source_id }, tx);
  if (!sourceRow) return { code: "not_found" };

  const sourceVersionRow = await getScopedSourceVersionById(
    { organizationId, sourceVersionId: evidenceItemRow.source_version_id },
    tx,
  );
  if (!sourceVersionRow) return { code: "not_found" };

  const candidateRow = await getScopedSourceCandidateByIdentity(
    { organizationId, intakeSourceCandidateId: sourceVersionRow.intake_source_candidate_id },
    tx,
  );
  if (!candidateRow) return { code: "not_found" };

  const decisionRow = await getScopedPromotionDecisionBySourceVersionId(
    { organizationId, sourceVersionId: evidenceItemRow.source_version_id },
    tx,
  );
  if (!decisionRow) return { code: "not_found" };

  const evidenceReviewQueueItemRow = await getScopedEvidenceReviewQueueItemByEvidenceItemId(
    { organizationId, evidenceItemId: evidenceItemRow.evidence_item_id },
    tx,
  );
  if (!evidenceReviewQueueItemRow) return { code: "not_found" };

  const profileRow = await readSensitivityProfileForAssessment(
    { organizationId, intakeSensitivityProfileId: candidateRow.intake_sensitivity_profile_id },
    tx,
  );
  if (!profileRow) return { code: "not_found" };

  const dictionaryRow = await getScopedDataDictionaryById(
    { organizationId, dataDictionaryId: candidateRow.data_dictionary_id },
    tx,
  );
  if (!dictionaryRow) return { code: "not_found" };

  const lineageValidation = validateClaimGapLineage({
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
  });
  if (!lineageValidation.ok) return { code: lineageValidation.code };

  const conflictGapRow = await readConflictIndicatorGap(tx, { organizationId, claimId });
  if (!conflictGapRow) return { code: "not_found" };
  if (conflictGapRow.assessment_status !== "unresolved") {
    return { code: "conflict_current_state_changed" };
  }

  const claimReviewQueueItemRow = await readClaimReviewQueueItem(tx, { organizationId, claimId });
  if (!claimReviewQueueItemRow) return { code: "not_found" };
  const queueOk =
    claimReviewQueueItemRow.organization_id === organizationId &&
    claimReviewQueueItemRow.queue_type === "claim_review" &&
    claimReviewQueueItemRow.target_object_type === "claim" &&
    claimReviewQueueItemRow.target_object_id === claimId &&
    claimReviewQueueItemRow.review_status === "needs_gk_review";
  if (!queueOk) return { code: "conflict_current_state_changed" };

  return {
    code: null,
    claimRow,
    evidenceItemRow,
    sourceVersionRow,
    candidateRow,
    conflictGapRow,
    claimReviewQueueItemRow,
  };
}

class ValidationBlockerError extends Error {
  constructor(result) {
    super(result?.message || "conflict-group validation blocked");
    this.name = "ValidationBlockerError";
    this.result = result;
  }
}

class ConcurrentStateChangedError extends Error {
  constructor(what) {
    super(`${what} changed concurrently during conflict-review candidate creation`);
    this.name = "ConcurrentStateChangedError";
  }
}

class RequiredAuditRejectedError extends Error {
  constructor() {
    super("required metadata-only audit was rejected");
    this.name = "RequiredAuditRejectedError";
  }
}

function prepareRequiredAudit(metadataOnlyAudit, context) {
  const prepared = metadataOnlyAudit.prepareMetadataOnlyAudit({
    payload: {
      attempted_operation: CONFLICT_REVIEW_CANDIDATE_AUDIT_OPERATION,
      actor_type: "human",
      contract: CONFLICT_REVIEW_CANDIDATE_AUDIT_CONTRACT,
      object_type: "conflict_group",
      request_scope: "organization_claim_pair",
      route_contract: "unwired_synthetic_conflict_review_candidate",
      sprint_phase: "kai_sprint2_p2_05",
      validator_key: CONFLICT_GROUP_VALIDATOR_KEY,
      conflict_group_id: context.conflictGroupId,
      lower_claim_id: context.lowerClaimId,
      higher_claim_id: context.higherClaimId,
      review_queue_item_count: 1,
      fresh_write_count: context.freshWriteCount,
    },
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
  if (!auditConfirmed) throw new RequiredAuditRejectedError();
  return prepared;
}

function buildAuditMetadata(context) {
  return {
    metadata_only: true,
    contract: CONFLICT_REVIEW_CANDIDATE_AUDIT_CONTRACT,
    conflict_group_id: context.conflictGroupId,
    lower_claim_id: context.lowerClaimId,
    higher_claim_id: context.higherClaimId,
    lower_claim_conflict_gap_id: context.lowerGapId,
    higher_claim_conflict_gap_id: context.higherGapId,
    basis_code: CONFLICT_GROUP_BASIS_CODE,
    queue_type: CONFLICT_RESOLUTION_QUEUE_TYPE,
    queue_status: CONFLICT_RESOLUTION_QUEUE_STATUS,
    review_status: CONFLICT_RESOLUTION_REVIEW_STATUS,
    review_queue_item_count: 1,
    fresh_write_count: context.freshWriteCount,
    replayed: false,
    validator_key: CONFLICT_GROUP_VALIDATOR_KEY,
  };
}

function shapeError(error) {
  if (error instanceof ValidationBlockerError) return failure("validation_blocker", [error.result].filter(Boolean));
  if (error instanceof ConcurrentStateChangedError) return failure("conflict_current_state_changed");
  if (error instanceof RequiredAuditRejectedError) return failure("validation_blocker");
  if (error?.code === "23503") return failure("not_found");
  if (error?.code === "23514" || error?.code === "P0001" || error?.code === "22P02") return failure("validation_blocker");
  return failure("system_error");
}

async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

export function createPostgresConflictReviewCandidateRepository({
  runInTransaction,
  beforeInsert = async () => {},
  mutateFreshPlanForTesting,
} = {}) {
  return Object.freeze({
    async createConflictReviewCandidate(input) {
      if (!validateRepositoryInput(input)) return failure("validation_blocker");
      const { organizationId, firstClaimId, secondClaimId, now, metadataOnlyAudit } = input;
      const { lowerClaimId, higherClaimId } = normalizeClaimPair(firstClaimId, secondClaimId);
      if (lowerClaimId === higherClaimId) {
        const blocker = validateConflictGroupCompleteness({
          conflictGroup: buildGroupPlan({
            conflictGroupId: randomUUID(),
            organizationId,
            lowerClaimId,
            higherClaimId,
            lowerGapId: randomUUID(),
            higherGapId: randomUUID(),
            now,
          }),
          queueItem: buildQueuePlan({ organizationId, conflictGroupId: randomUUID() }),
        });
        return failure("validation_blocker", blocker?.severity === "blocker" ? [blocker] : undefined);
      }

      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      try {
        return await run(async (tx) => {
          const lowerBundle = await readClaimBundle(tx, { organizationId, claimId: lowerClaimId });
          if (lowerBundle.code) return failure(lowerBundle.code);
          const higherBundle = await readClaimBundle(tx, { organizationId, claimId: higherClaimId });
          if (higherBundle.code) return failure(higherBundle.code);

          await beforeInsert();

          const lowerGapId = lowerBundle.conflictGapRow.gap_log_item_id;
          const higherGapId = higherBundle.conflictGapRow.gap_log_item_id;

          const existingGroup = await readExistingConflictGroup(tx, { organizationId, lowerClaimId, higherClaimId });
          if (existingGroup) {
            const existingQueue = await readConflictResolutionQueueItem(tx, {
              organizationId,
              conflictGroupId: existingGroup.conflict_group_id,
            });
            if (
              existingMatches({
                groupRecord: existingGroup,
                queueRecord: existingQueue,
                organizationId,
                lowerClaimId,
                higherClaimId,
                lowerGapId,
                higherGapId,
              })
            ) {
              assertValidatorPass(toConflictGroupRecord(existingGroup), toQueueRecord(existingQueue));
              return success({
                conflictGroup: toConflictGroupRecord(existingGroup),
                reviewQueueItem: toQueueRecord(existingQueue),
                replayed: true,
              });
            }
            return failure("conflict_current_state_changed");
          }

          const conflictGroupId = randomUUID();
          const baseGroupPlan = buildGroupPlan({
            conflictGroupId,
            organizationId,
            lowerClaimId,
            higherClaimId,
            lowerGapId,
            higherGapId,
            now,
          });
          const baseQueuePlan = buildQueuePlan({ organizationId, conflictGroupId });
          const mutated =
            typeof mutateFreshPlanForTesting === "function"
              ? mutateFreshPlanForTesting({ conflictGroup: baseGroupPlan, queueItem: baseQueuePlan }) || {}
              : {};
          const groupPlan = mutated.conflictGroup || baseGroupPlan;
          const queuePlan = mutated.queueItem || baseQueuePlan;

          assertValidatorPass(groupPlan, queuePlan);

          const insertedGroup = await insertConflictGroup(tx, groupPlan);
          if (!insertedGroup) {
            const rereadGroup = await readExistingConflictGroup(tx, { organizationId, lowerClaimId, higherClaimId });
            const rereadQueue = rereadGroup
              ? await readConflictResolutionQueueItem(tx, {
                  organizationId,
                  conflictGroupId: rereadGroup.conflict_group_id,
                })
              : null;
            if (
              !existingMatches({
                groupRecord: rereadGroup,
                queueRecord: rereadQueue,
                organizationId,
                lowerClaimId,
                higherClaimId,
                lowerGapId,
                higherGapId,
              })
            ) {
              throw new ConcurrentStateChangedError("conflict_group");
            }
            assertValidatorPass(toConflictGroupRecord(rereadGroup), toQueueRecord(rereadQueue));
            return success({
              conflictGroup: toConflictGroupRecord(rereadGroup),
              reviewQueueItem: toQueueRecord(rereadQueue),
              replayed: true,
            });
          }

          const insertedQueue = await insertConflictResolutionQueueItem(tx, queuePlan);
          if (!insertedQueue) throw new ConcurrentStateChangedError("review_queue_items");

          const groupRecord = toConflictGroupRecord(insertedGroup);
          const queueRecord = toQueueRecord(insertedQueue);
          assertValidatorPass(groupRecord, queueRecord);

          const auditClaimBundle = lowerBundle.candidateRow.intake_file_id ? lowerBundle : higherBundle;
          const uploadState = await readScopedUploadState(tx, organizationId, auditClaimBundle.candidateRow.intake_file_id);
          if (!uploadState) return failure("not_found");

          const auditContext = {
            conflictGroupId: groupRecord.conflict_group_id,
            lowerClaimId,
            higherClaimId,
            lowerGapId,
            higherGapId,
            freshWriteCount: 2,
          };
          const preparedAudit = prepareRequiredAudit(metadataOnlyAudit, auditContext);
          await insertAudit(tx, {
            organizationId,
            intakeFileId: auditClaimBundle.candidateRow.intake_file_id,
            uploadState,
            metadata: buildAuditMetadata(auditContext),
            now,
          });
          try {
            await preparedAudit.publish();
          } catch {
            throw new RequiredAuditRejectedError();
          }

          return success({
            conflictGroup: groupRecord,
            reviewQueueItem: queueRecord,
            replayed: false,
          });
        });
      } catch (error) {
        return shapeError(error);
      }
    },
  });
}

export const __conflictReviewCandidateRepositoryContract = Object.freeze({
  CONFLICT_REVIEW_CANDIDATE_AUDIT_CONTRACT,
  CONFLICT_REVIEW_CANDIDATE_AUDIT_OPERATION,
  CONFLICT_GROUP_VALIDATOR_KEY,
});

export const __conflictReviewCandidateRepositoryTestables = Object.freeze({
  normalizeClaimPair,
  buildGroupPlan,
  buildQueuePlan,
  existingMatches,
  RequiredAuditRejectedError,
  ConcurrentStateChangedError,
  ValidationBlockerError,
});
