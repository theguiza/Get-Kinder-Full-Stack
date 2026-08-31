import {
  getScopedClaimById,
  getScopedClaimEvidenceLinkByClaimId,
  getScopedEvidenceItemById,
  getScopedSourceLocatorById,
  getScopedSourceById,
  getScopedSourceVersionById,
  getScopedPromotionDecisionBySourceVersionId,
  getScopedEvidenceReviewQueueItemByEvidenceItemId,
  getScopedClaimReviewQueueItemByClaimId,
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
import {
  validateClaimGapLineage,
  dimensionResultRequiresGap,
} from "../validators/kaiClaimGapFollowupValidators.js";
import { __claimGapFollowupRepositoryTestables } from "./postgresClaimGapFollowupRepository.js";
import { __evidenceCoverageAssessmentRepositoryTestables } from "./postgresEvidenceCoverageAssessmentRepository.js";
import { validateConflictGroupCompleteness } from "../validators/kaiConflictGroupValidators.js";
import { computeCoverageReviewDecisionFingerprint } from "../validators/kaiCoverageReviewDecisionValidators.js";
import {
  findCurrentEvidenceReviewDecision,
  findCurrentClaimReviewDecision,
} from "./postgresHumanReviewDecisionRepository.js";

const CLAIM_TRACEABILITY_RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

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

const BLOCKER_ORDER = Object.freeze([
  "claim_not_approved_for_requested_audience",
  "audience_gate_closed",
  "claim_review_unresolved",
  "evidence_review_unresolved",
  "support_strength_unassessed",
  "coverage_dimension_unresolved",
  "client_followup_unresolved",
  "potential_conflict_review_unresolved",
  "requirement_authority_absent",
  "traceability_incomplete",
]);

const {
  readSensitivityProfileForAssessment,
  readDataDictionaryFieldsForAssessment,
  readDataQualityFindingsForAssessment,
  readEvidenceCoverageFieldKeys,
} = __evidenceCoverageAssessmentRepositoryTestables;

const {
  buildExpectedGapPlans,
  buildExpectedFollowupDimensionKeys,
  gapRowsMatchExpectation,
  followupRowsMatchExpectation,
  queueRowsMatchExpectation,
} = __claimGapFollowupRepositoryTestables;

function failure(code) {
  return {
    ok: false,
    data: null,
    error: { code, status: CLAIM_TRACEABILITY_RESULT_STATUS[code] || 500 },
  };
}

// TEMPORARY traceability diagnostic. Preserves the exact code/status of
// failure("conflict_current_state_changed") (409) so endpoint behavior is
// unchanged, and adds error.reason to distinguish which branch fired.
function failureWithReason(reason) {
  return {
    ok: false,
    data: null,
    error: {
      code: "conflict_current_state_changed",
      status: CLAIM_TRACEABILITY_RESULT_STATUS.conflict_current_state_changed,
      reason,
    },
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

function validateInput(input) {
  const allowedKeys = new Set(["organizationId", "claimId", "requestedAudience"]);
  return (
    isPlainObject(input) &&
    hasOnlyKeys(input, allowedKeys) &&
    isNonEmptyString(input.organizationId) &&
    isNonEmptyString(input.claimId) &&
    ["internal", "funder", "public"].includes(input.requestedAudience)
  );
}

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

async function readGapRows(tx, { organizationId, claimId }) {
  const { rows } = await tx.query(
    `SELECT gap_log_item_id, organization_id, claim_id, evidence_item_id, source_version_id,
            dimension_key, assessment_status, validator_key, safe_summary,
            open_finding_count, field_count, undefined_field_count, uncovered_field_count,
            created_by_type, created_at
       FROM kai.gap_log_items
      WHERE organization_id = $1::uuid
        AND claim_id = $2::uuid
      ORDER BY dimension_key ASC, gap_log_item_id ASC`,
    [organizationId, claimId],
  );
  return rows;
}

async function readFollowupRows(tx, { organizationId, claimId }) {
  const { rows } = await tx.query(
    `SELECT client_followup_item_id, organization_id, claim_id, gap_log_item_id,
            dimension_key, question_text, created_by_type, created_at
       FROM kai.client_followup_items
      WHERE organization_id = $1::uuid
        AND claim_id = $2::uuid
      ORDER BY dimension_key ASC, client_followup_item_id ASC`,
    [organizationId, claimId],
  );
  return rows;
}

async function readFollowupQueueRows(tx, { organizationId, followupIds }) {
  if (followupIds.length === 0) return [];
  const { rows } = await tx.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, priority, queue_status, review_status, assigned_to,
            due_at, summary, required_action, created_at, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = 'client_followup'
        AND target_object_id = ANY($2::uuid[])
      ORDER BY target_object_id ASC, review_queue_item_id ASC`,
    [organizationId, followupIds],
  );
  return rows;
}

async function readCoverageReviewDecisions(tx, { organizationId, claimId }) {
  const { rows } = await tx.query(
    `SELECT dimension_key, state_fingerprint
       FROM kai.coverage_review_decisions
      WHERE organization_id = $1::uuid
        AND claim_id = $2::uuid`,
    [organizationId, claimId],
  );
  return rows;
}

async function readPotentialConflictGroups(tx, { organizationId, claimId }) {
  const { rows } = await tx.query(
    `SELECT conflict_group_id, organization_id, lower_claim_id, higher_claim_id,
            lower_claim_conflict_gap_id, higher_claim_conflict_gap_id,
            basis_code, safe_summary, created_by_type, created_at
       FROM kai.conflict_groups
      WHERE organization_id = $1::uuid
        AND (lower_claim_id = $2::uuid OR higher_claim_id = $2::uuid)
      ORDER BY lower_claim_id ASC, higher_claim_id ASC, conflict_group_id ASC
      LIMIT 101`,
    [organizationId, claimId],
  );
  return rows;
}

async function readConflictResolutionQueueRows(tx, { organizationId, conflictGroupIds }) {
  if (conflictGroupIds.length === 0) return [];
  const { rows } = await tx.query(
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, queue_status, review_status, priority, summary,
            required_action, assigned_to, due_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = 'conflict_resolution'
        AND target_object_id = ANY($2::uuid[])
      ORDER BY target_object_id ASC, review_queue_item_id ASC`,
    [organizationId, conflictGroupIds],
  );
  return rows;
}

async function readSourceCandidate(tx, { organizationId, intakeSourceCandidateId }) {
  const { rows } = await tx.query(
    `SELECT intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
            data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256,
            proposed_source_type, candidate_status, created_at
       FROM kai.intake_source_candidates
      WHERE organization_id = $1::uuid
        AND intake_source_candidate_id = $2::uuid`,
    [organizationId, intakeSourceCandidateId],
  );
  return rows[0] || null;
}

function rowIso(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function toConflictGroupValidatorRecord(row) {
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
    created_at: rowIso(row.created_at),
  };
}

function toConflictQueueValidatorRecord(row) {
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

function addOrderedBlocker(blockers, code) {
  if (!blockers.has(code)) blockers.add(code);
}

function orderedBlockers(blockers) {
  return BLOCKER_ORDER.filter((code) => blockers.has(code));
}

function safeDimensionStatuses(dimensions, internalLimitationAcceptance) {
  return Object.fromEntries(
    DIMENSION_KEYS.map((dimensionKey) => {
      const acceptance = internalLimitationAcceptance[dimensionKey];
      return [
        dimensionKey,
        {
          assessment_status: dimensions[dimensionKey].evidence.assessment_status,
          validator_key: dimensions[dimensionKey].validator_key,
          internal_limitation_accepted: acceptance.accepted,
          blocks_requested_audience: acceptance.blocksRequestedAudience,
        },
      ];
    }),
  );
}

function safeGapRows(rows) {
  return rows.map((row) => ({
    gap_log_item_id: row.gap_log_item_id,
    dimension_key: row.dimension_key,
    assessment_status: row.assessment_status,
    validator_key: row.validator_key,
  }));
}

function safeFollowupRows(rows, queueRows) {
  const queuesByTarget = new Map(queueRows.map((row) => [row.target_object_id, row]));
  return rows.map((row) => {
    const queue = queuesByTarget.get(row.client_followup_item_id) || null;
    return {
      client_followup_item_id: row.client_followup_item_id,
      gap_log_item_id: row.gap_log_item_id,
      dimension_key: row.dimension_key,
      workflow_status: queue?.queue_status ?? null,
      review_status: queue?.review_status ?? null,
      review_queue_item_id: queue?.review_queue_item_id ?? null,
    };
  });
}

function audienceGateSummary(claimRow) {
  return {
    internal_only: claimRow.internal_only,
    public_use_allowed: claimRow.public_use_allowed,
    funder_use_allowed: claimRow.funder_use_allowed,
    export_ready: claimRow.export_ready,
  };
}

/**
 * KAI P2-10 internal audience authority. For requestedAudience = "internal",
 * these three blockers (claim_not_approved_for_requested_audience,
 * audience_gate_closed, requirement_authority_absent) no longer fire merely
 * because this stub used to unconditionally return false: P2-09 evidence/
 * claim-review completeness is already independently enforced below by the
 * evidence_review_unresolved/claim_review_unresolved blockers, and per-
 * dimension internal coverage-acceptance is independently enforced by the
 * coverage_dimension_unresolved carve-out below - so no additional gate is
 * owned here for internal. For funder/public, this preserves the exact
 * unconditional fail-closed behavior this stub always had: P2-10 grants no
 * funder/public/export authority whatsoever.
 */
function approvalForAudience({ requestedAudience } = {}) {
  if (requestedAudience === "internal") {
    return { approved: true, gateOpen: true, authorityPresent: true };
  }
  return { approved: false, gateOpen: false, authorityPresent: false };
}

function unresolvedReviewStatus(status) {
  return status !== "resolved" && status !== "approved" && status !== "complete";
}

function shapeError(error) {
  if (error?.code === "22P02") return failure("validation_blocker");
  if (error?.code === "25001") return failure("conflict_current_state_changed");
  return failure("system_error");
}

async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

export async function evaluateClaimTraceabilityInTransaction(tx, input) {
  if (!validateInput(input)) return failure("validation_blocker");
  const { organizationId, claimId, requestedAudience } = input;

  const claimRow = await getScopedClaimById({ organizationId, claimId }, tx);
  if (!claimRow) return failure("not_found");
  const claimEvidenceLinkRow = await getScopedClaimEvidenceLinkByClaimId({ organizationId, claimId }, tx);
  if (!claimEvidenceLinkRow) return failure("not_found");
  if (claimEvidenceLinkRow.evidence_item_id !== claimRow.evidence_item_id) {
    return failureWithReason("claim_evidence_link_mismatch");
  }

  const evidenceItemRow = await getScopedEvidenceItemById(
    { organizationId, evidenceItemId: claimEvidenceLinkRow.evidence_item_id },
    tx,
  );
  if (!evidenceItemRow) return failure("not_found");
  const locatorRow = await getScopedSourceLocatorById(
    { organizationId, sourceLocatorId: evidenceItemRow.source_locator_id },
    tx,
  );
  if (!locatorRow) return failure("not_found");
  const sourceRow = await getScopedSourceById({ organizationId, sourceId: evidenceItemRow.source_id }, tx);
  if (!sourceRow) return failure("not_found");
  const sourceVersionRow = await getScopedSourceVersionById(
    { organizationId, sourceVersionId: evidenceItemRow.source_version_id },
    tx,
  );
  if (!sourceVersionRow) return failure("not_found");
  if (sourceVersionRow.is_current !== true) {
    return failureWithReason("source_version_not_current");
  }
  const candidateRow = await readSourceCandidate(
    tx,
    { organizationId, intakeSourceCandidateId: sourceVersionRow.intake_source_candidate_id },
  );
  if (!candidateRow) return failure("not_found");
  const decisionRow = await getScopedPromotionDecisionBySourceVersionId(
    { organizationId, sourceVersionId: evidenceItemRow.source_version_id },
    tx,
  );
  if (!decisionRow) return failure("not_found");
  const evidenceReviewQueueItemRow = await getScopedEvidenceReviewQueueItemByEvidenceItemId(
    { organizationId, evidenceItemId: evidenceItemRow.evidence_item_id },
    tx,
  );
  if (!evidenceReviewQueueItemRow) return failure("not_found");
  const claimReviewQueueItemRow = await getScopedClaimReviewQueueItemByClaimId({ organizationId, claimId }, tx);
  if (!claimReviewQueueItemRow) return failure("not_found");

  const profileRow = await readSensitivityProfileForAssessment(
    { organizationId, intakeSensitivityProfileId: candidateRow.intake_sensitivity_profile_id },
    tx,
  );
  if (!profileRow) return failure("not_found");
  const dictionaryRow = await getScopedDataDictionaryById(
    { organizationId, dataDictionaryId: candidateRow.data_dictionary_id },
    tx,
  );
  if (!dictionaryRow) return failure("not_found");
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
  if (!lineageValidation.ok) return failure(lineageValidation.code);

  const dimensions = computeDimensions({ dictionaryFieldRows, qualityFindingRows, profileRow, evidenceFieldKeys });
  const expectedGapPlans = buildExpectedGapPlans(dimensions);
  const expectedFollowupDimensionKeys = buildExpectedFollowupDimensionKeys(expectedGapPlans);
  const gapRows = await readGapRows(tx, { organizationId, claimId });
  const followupRows = await readFollowupRows(tx, { organizationId, claimId });
  const followupQueueRows = await readFollowupQueueRows(tx, {
    organizationId,
    followupIds: followupRows.map((row) => row.client_followup_item_id),
  });

  const noPersistedP204 = gapRows.length === 0 && followupRows.length === 0 && followupQueueRows.length === 0;
  if (noPersistedP204) {
    const allClear = DIMENSION_KEYS.every((dimensionKey) => !dimensionResultRequiresGap(dimensions[dimensionKey]));
    if (!allClear) {
      return failureWithReason("gap_dimension_requires_missing_p204_state");
    }
  } else {
    const gapsMatch = gapRowsMatchExpectation(gapRows, expectedGapPlans, {
      evidenceItemId: evidenceItemRow.evidence_item_id,
      sourceVersionId: evidenceItemRow.source_version_id,
    });
    const followupsMatch =
      gapsMatch && followupRowsMatchExpectation(followupRows, expectedFollowupDimensionKeys, gapRows, { claimId });
    const queuesMatch = followupsMatch && queueRowsMatchExpectation(followupQueueRows, followupRows);
    if (!gapsMatch || !followupsMatch || !queuesMatch) {
      return failureWithReason("gap_followup_queue_mismatch");
    }
  }

  const conflictGroupRows = await readPotentialConflictGroups(tx, { organizationId, claimId });
  const truncated = conflictGroupRows.length > 100;
  const returnedGroupRows = conflictGroupRows.slice(0, 100);
  const conflictQueueRows = await readConflictResolutionQueueRows(tx, {
    organizationId,
    conflictGroupIds: returnedGroupRows.map((row) => row.conflict_group_id),
  });
  if (conflictQueueRows.length !== returnedGroupRows.length) {
    return failureWithReason("conflict_queue_count_mismatch");
  }
  const conflictQueueByTarget = new Map(conflictQueueRows.map((row) => [row.target_object_id, row]));
  const potentialConflictGroups = [];
  for (const groupRow of returnedGroupRows) {
    const queueRow = conflictQueueByTarget.get(groupRow.conflict_group_id);
    const validation = validateConflictGroupCompleteness({
      conflictGroup: toConflictGroupValidatorRecord(groupRow),
      queueItem: queueRow ? toConflictQueueValidatorRecord(queueRow) : null,
    });
    if (validation?.severity !== "pass") {
      return failureWithReason("conflict_group_validation_failed");
    }
    potentialConflictGroups.push({
      conflict_group_id: groupRow.conflict_group_id,
      lower_claim_id: groupRow.lower_claim_id,
      higher_claim_id: groupRow.higher_claim_id,
      lower_claim_conflict_gap_id: groupRow.lower_claim_conflict_gap_id,
      higher_claim_conflict_gap_id: groupRow.higher_claim_conflict_gap_id,
      basis_code: groupRow.basis_code,
      review_queue_item_id: queueRow.review_queue_item_id,
      review_status: queueRow.review_status,
      workflow_status: queueRow.queue_status,
    });
  }

  // KAI P2-10: read every accepted_internal_with_limitation decision already
  // recorded for this claim, then determine - per dimension, using the exact
  // shared fingerprint function P2-10's own writer used - whether each one
  // still matches the CURRENT authoritative state computed above. A decision
  // recorded against a materially different (now-stale) state simply fails
  // to match here; it is never treated as current. This never mutates
  // dimensions/gapRows/claimRow/evidenceItemRow, and is computed regardless
  // of requestedAudience so the traceability DTO can always disclose it
  // truthfully - only its effect on blocking is audience-gated below.
  const coverageReviewDecisionRows = await readCoverageReviewDecisions(tx, { organizationId, claimId });
  const internalLimitationAcceptance = Object.fromEntries(
    DIMENSION_KEYS.map((dimensionKey) => {
      const dimension = dimensions[dimensionKey];
      const gapItem = gapRows.find((row) => row.dimension_key === dimensionKey) || null;
      let accepted = false;
      if (gapItem) {
        const expectedFingerprint = computeCoverageReviewDecisionFingerprint({
          claimId,
          dimensionKey,
          evidenceItemId: evidenceItemRow.evidence_item_id,
          sourceVersionId: evidenceItemRow.source_version_id,
          dimensionAssessmentStatus: dimension.evidence.assessment_status,
          dimensionValidatorKey: dimension.validator_key,
          gapLogItemId: gapItem.gap_log_item_id,
          gapAssessmentStatus: gapItem.assessment_status,
          claimReviewStatus: claimReviewQueueItemRow.review_status,
          evidenceReviewStatus: evidenceReviewQueueItemRow.review_status,
          claimStrength: claimRow.claim_strength,
          supportStrength: evidenceItemRow.support_strength,
        });
        accepted = coverageReviewDecisionRows.some(
          (row) => row.dimension_key === dimensionKey && row.state_fingerprint === expectedFingerprint,
        );
      }
      const blocksRequestedAudience =
        dimension.evidence.assessment_status === "unresolved" &&
        !(requestedAudience === "internal" && accepted);
      return [dimensionKey, { accepted, blocksRequestedAudience }];
    }),
  );

  // KAI P2-12 (Problem A1): `queue_status/review_status = resolved` alone is
  // no longer sufficient proof of review - a decision-lineage head must also
  // exist and be a TERMINAL outcome (never absent, never
  // needs_more_information). This closes the legacy gap where a queue item
  // resolved by the old pre-P2-12 code path (no decision ever recorded) would
  // otherwise read as resolved/clear here.
  const evidenceReviewHead = await findCurrentEvidenceReviewDecision(tx, {
    organizationId,
    evidenceItemId: evidenceItemRow.evidence_item_id,
  });
  const claimReviewHead = await findCurrentClaimReviewDecision(tx, { organizationId, claimId });

  const blockers = new Set();
  const affectedDimensionKeys = new Set();
  const affectedObjectIds = new Set();
  const audienceApproval = approvalForAudience({ requestedAudience, claimRow });
  if (!audienceApproval.approved) addOrderedBlocker(blockers, "claim_not_approved_for_requested_audience");
  if (!audienceApproval.gateOpen) addOrderedBlocker(blockers, "audience_gate_closed");
  if (!audienceApproval.authorityPresent) addOrderedBlocker(blockers, "requirement_authority_absent");
  if (
    unresolvedReviewStatus(claimReviewQueueItemRow.review_status) ||
    !claimReviewHead ||
    claimReviewHead.decision_outcome === "needs_more_information"
  ) {
    addOrderedBlocker(blockers, "claim_review_unresolved");
    affectedObjectIds.add(claimReviewQueueItemRow.review_queue_item_id);
  }
  if (
    unresolvedReviewStatus(evidenceReviewQueueItemRow.review_status) ||
    !evidenceReviewHead ||
    evidenceReviewHead.decision_outcome === "needs_more_information"
  ) {
    addOrderedBlocker(blockers, "evidence_review_unresolved");
    affectedObjectIds.add(evidenceReviewQueueItemRow.review_queue_item_id);
  }
  // Fires whenever either strength column is anything other than
  // 'reviewed_supported' - an unassessed value AND a negative terminal
  // ('reviewed_not_supported') decision must both remain permanently
  // ineligible here. Same blocker code as before (support_strength_unassessed)
  // - only the triggering condition is broadened.
  if (claimRow.claim_strength !== "reviewed_supported" || evidenceItemRow.support_strength !== "reviewed_supported") {
    addOrderedBlocker(blockers, "support_strength_unassessed");
    affectedObjectIds.add(claimId);
    affectedObjectIds.add(evidenceItemRow.evidence_item_id);
  }
  for (const dimensionKey of DIMENSION_KEYS) {
    if (internalLimitationAcceptance[dimensionKey].blocksRequestedAudience) {
      addOrderedBlocker(blockers, "coverage_dimension_unresolved");
      affectedDimensionKeys.add(dimensionKey);
    }
  }
  for (const row of followupQueueRows) {
    if (unresolvedReviewStatus(row.review_status) || row.queue_status === "waiting_on_client") {
      addOrderedBlocker(blockers, "client_followup_unresolved");
      affectedObjectIds.add(row.review_queue_item_id);
    }
  }
  for (const row of conflictQueueRows) {
    if (unresolvedReviewStatus(row.review_status) || row.queue_status === "open") {
      addOrderedBlocker(blockers, "potential_conflict_review_unresolved");
      affectedObjectIds.add(row.review_queue_item_id);
    }
  }
  if (truncated) addOrderedBlocker(blockers, "traceability_incomplete");

  const blockerCodes = orderedBlockers(blockers);
  return success({
    claim: {
      claim_id: claimRow.claim_id,
      claim_type: claimRow.claim_type,
      claim_status: claimRow.claim_status,
      claim_review_status: claimRow.claim_review_status,
      claim_strength: claimRow.claim_strength,
      audience_gates: audienceGateSummary(claimRow),
    },
    evidence: {
      evidence_item_id: evidenceItemRow.evidence_item_id,
      evidence_review_status: evidenceItemRow.evidence_review_status,
      support_strength: evidenceItemRow.support_strength,
      review_queue_item_id: evidenceReviewQueueItemRow.review_queue_item_id,
      review_queue_status: evidenceReviewQueueItemRow.queue_status,
      review_status: evidenceReviewQueueItemRow.review_status,
      updated_at: rowIso(evidenceReviewQueueItemRow.updated_at),
      sensitivity_level: evidenceItemRow.sensitivity_level,
    },
    locator: { source_locator_id: locatorRow.source_locator_id },
    source: { source_id: sourceRow.source_id, source_code: sourceRow.source_code ?? null },
    source_version: {
      source_version_id: sourceVersionRow.source_version_id,
      is_current: sourceVersionRow.is_current,
    },
    claim_review: {
      review_queue_item_id: claimReviewQueueItemRow.review_queue_item_id,
      queue_status: claimReviewQueueItemRow.queue_status,
      review_status: claimReviewQueueItemRow.review_status,
      updated_at: rowIso(claimReviewQueueItemRow.updated_at),
    },
    // KAI A1C-1: current lineage-head decisions, reusing evidenceReviewHead/
    // claimReviewHead already loaded above for blocker evaluation - no second
    // lookup. null when no decision has ever been recorded; a superseded
    // decision is never the head returned by findCurrent*ReviewDecision, so it
    // is never disclosed here.
    evidence_review_decision: evidenceReviewHead
      ? {
          decision_id: evidenceReviewHead.decision_id,
          decision_outcome: evidenceReviewHead.decision_outcome,
        }
      : null,
    claim_review_decision: claimReviewHead
      ? {
          decision_id: claimReviewHead.decision_id,
          decision_outcome: claimReviewHead.decision_outcome,
          approved_audiences: claimReviewHead.approved_audiences,
        }
      : null,
    candidate: {
      intake_source_candidate_id: candidateRow.intake_source_candidate_id,
      intake_sensitivity_profile_id: candidateRow.intake_sensitivity_profile_id,
    },
    promotion_decision: { intake_promotion_decision_id: decisionRow.intake_promotion_decision_id },
    dimensions: safeDimensionStatuses(dimensions, internalLimitationAcceptance),
    gap_items: safeGapRows(gapRows),
    client_followup_workflows: safeFollowupRows(followupRows, followupQueueRows),
    potential_conflict_groups: potentialConflictGroups,
    requestedAudience,
    eligible: blockerCodes.length === 0,
    blockerCodes,
    affectedDimensionKeys: [...affectedDimensionKeys].sort(),
    affectedObjectIds: [...affectedObjectIds].sort(),
    truncated,
  });
}

export function createPostgresClaimTraceabilityRepository({ runInTransaction } = {}) {
  return Object.freeze({
    async getClaimTraceabilitySummary(input) {
      if (!validateInput(input)) return failure("validation_blocker");
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      try {
        return await run(async (tx) => {
          await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
          return evaluateClaimTraceabilityInTransaction(tx, input);
        });
      } catch (error) {
        return shapeError(error);
      }
    },
  });
}

export const __claimTraceabilityRepositoryContract = Object.freeze({
  BLOCKER_ORDER,
  DIMENSION_KEYS,
});
