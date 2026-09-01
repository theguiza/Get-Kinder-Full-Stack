import {
  validateClaimGapLineage,
  dimensionResultRequiresGap,
} from "../validators/kaiClaimGapFollowupValidators.js";
import { validateConflictGroupCompleteness } from "../validators/kaiConflictGroupValidators.js";
import { __claimGapFollowupRepositoryTestables } from "./postgresClaimGapFollowupRepository.js";
import {
  __claimTraceabilityRepositoryTestables,
  __claimTraceabilityRepositoryContract,
} from "./postgresClaimTraceabilityRepository.js";

/**
 * KAI Package 4 semantic-parity repair.
 *
 * get_claim_traceability_summary (evaluateClaimTraceabilityInTransaction,
 * Backend/kai/dictionary/postgresClaimTraceabilityRepository.js) never
 * discloses a claim's gap_log_items unless every one of its fail-closed
 * current-state gates passes for that claim, in this transaction, right now:
 * full evidence/source/candidate/decision/review-queue lineage exists and is
 * mutually consistent (validateClaimGapLineage, which itself delegates to the
 * already-accepted validateClaimHasLoadBearingEvidence and
 * validateEvidenceCoverageAssessmentIsPermitted), the source_version is still
 * current, the persisted gap/follow-up/follow-up-queue rows still match the
 * complete P2-02-dimension-plan freshly recomputed from current
 * data_quality_findings/data_dictionary_fields/sensitivity-profile/
 * evidence-coverage state (gapRowsMatchExpectation/
 * followupRowsMatchExpectation/queueRowsMatchExpectation, or - when nothing is
 * persisted yet - every dimension is independently resolved_clear), and every
 * potential_conflict_groups row for the claim has a matching, complete
 * conflict-resolution queue counterpart (validateConflictGroupCompleteness).
 * When ANY of those gates fails, evaluateClaimTraceabilityInTransaction
 * returns a hard failure() and gap_items are never returned at all for that
 * claim - eligibility blockers (claim_review_unresolved,
 * coverage_dimension_unresolved, etc.) never do this; only these gates do.
 *
 * This module reaches the identical current/stale judgment for a *set* of
 * candidate claims (the claims referenced by one bounded
 * kai.gap_log_items candidate page) without ever calling
 * getClaimTraceabilitySummary/evaluateClaimTraceabilityInTransaction
 * per claim. It batch-reads, in one read-only snapshot, exactly the same
 * authoritative inputs evaluateClaimTraceabilityInTransaction reads per claim
 * - using organization_id = ... AND <key> = ANY($n::uuid[]) in place of the
 * single-row getScoped* lookups - then, in memory over that already-loaded
 * bounded data (no further repository/DB call), replays the *exact same pure
 * comparison helpers* evaluateClaimTraceabilityInTransaction itself uses
 * (validateClaimGapLineage, dimensionResultRequiresGap, computeDimensions,
 * buildExpectedGapPlans, buildExpectedFollowupDimensionKeys,
 * gapRowsMatchExpectation, followupRowsMatchExpectation,
 * queueRowsMatchExpectation, validateConflictGroupCompleteness) per candidate
 * claim to decide whether that claim currently reaches
 * evaluateClaimTraceabilityInTransaction's own success() return. No new
 * semantic rule is introduced anywhere in this file; every judgment is made by
 * the same functions traceability itself calls.
 *
 * Because evaluateClaimTraceabilityInTransaction returns either its complete
 * safeGapRows(gapRows) set for a claim (all of that claim's persisted gaps)
 * or a hard failure (none of them), the unit of classification here is the
 * CLAIM, not the individual gap row: every persisted gap for a claim that
 * reaches success() is current; every persisted gap for a claim that fails any
 * gate is stale and is omitted.
 *
 * Row-volume bounds for every batch read below, relative to a candidate page
 * of N distinct claim ids:
 *   - kai.claims, kai.claim_evidence_links: PRIMARY KEY / UNIQUE
 *     (organization_id, claim_id) -> at most N rows each.
 *   - kai.evidence_items, kai.source_locators, kai.sources,
 *     kai.source_versions, kai.intake_source_candidates,
 *     kai.intake_sensitivity_profiles, kai.data_dictionaries: PRIMARY KEY on
 *     the id batched against -> at most N rows each (the id set itself is
 *     derived from, and therefore bounded by, the N claims already loaded).
 *   - kai.intake_promotion_decisions: UNIQUE (organization_id,
 *     intake_source_candidate_id) -> at most N rows.
 *   - kai.review_queue_items for queue_type IN
 *     ('evidence_review','claim_review'): UNIQUE partial indexes
 *     (ux_review_queue_items_p2_01_evidence_review_identity,
 *     ux_review_queue_items_p2_03_claim_review_identity) on
 *     (organization_id, target_object_id) within each queue_type -> at most N
 *     rows each.
 *   - kai.gap_log_items: UNIQUE (organization_id, claim_id, dimension_key)
 *     with a 10-value dimension_key CHECK constraint -> at most 10*N rows.
 *   - kai.client_followup_items: UNIQUE (organization_id, claim_id,
 *     dimension_key) with a 4-value client-answerable dimension_key CHECK
 *     constraint -> at most 4*N rows.
 *   - kai.review_queue_items for queue_type = 'client_followup': UNIQUE
 *     partial index (ux_review_queue_items_p2_04_client_followup_identity) on
 *     (organization_id, target_object_id) -> at most 4*N rows (bounded by the
 *     follow-up id set already bounded above).
 *   - kai.data_dictionary_fields, kai.data_quality_findings: batched by the
 *     <=N distinct data_dictionary_id values already loaded - the same
 *     per-dictionary row volume evaluateClaimTraceabilityInTransaction itself
 *     already reads unbounded for a *single* claim; batching only bounds the
 *     number of dictionaries scanned (<=N) to the candidate page, it never
 *     truncates the per-dictionary rows a correct judgment requires.
 *   - evidence-coverage field keys (kai.evidence_items JOIN
 *     kai.source_locators): batched by the <=N distinct source_version_id
 *     values already loaded, same reasoning as above.
 *   - kai.conflict_groups: UNIQUE (organization_id, lower_claim_id,
 *     higher_claim_id) does not bound matches for one claim id on its own, so
 *     this read reuses the exact cap (101, "more than 100 exists" ==
 *     truncated) evaluateClaimTraceabilityInTransaction's own
 *     readPotentialConflictGroups already applies per claim (LIMIT 101),
 *     expressed here as a ROW_NUMBER() PARTITION BY candidate claim id so the
 *     same top-101-per-claim slice is produced for the whole candidate set in
 *     one query -> at most 101*N rows. Conflict-group truncation beyond 100
 *     never affects gap-exposure in the real function either (`truncated`
 *     only adds the non-blocking traceability_incomplete blocker to a
 *     success() payload) so this cap never discards data the gap-exposure
 *     gates below require.
 *   - kai.review_queue_items for queue_type = 'conflict_resolution': UNIQUE
 *     partial index (ux_review_queue_items_p2_05_conflict_resolution_identity)
 *     on (organization_id, target_object_id) -> at most 101*N rows (bounded by
 *     the conflict-group id set already bounded above).
 *
 * Query count is fixed at up to 20 batched reads (claims,
 * claim_evidence_links, evidence_items, source_locators, sources,
 * source_versions, intake_source_candidates, intake_promotion_decisions,
 * evidence_review queue, claim_review queue, sensitivity profiles,
 * dictionaries, dictionary fields, quality findings, evidence-coverage field
 * keys, gap_log_items, client_followup_items, client_followup queue,
 * conflict_groups, conflict_resolution queue) regardless of how many distinct
 * claims the candidate page references - the count never grows with the
 * number of claims, only (down, never up) when a derived id set for one of
 * the later reads is empty (e.g. no candidate claim has any client_followup
 * rows, or none has any conflict_groups row, skip that one read entirely).
 * There is no repository/DB call inside any per-claim loop anywhere in this
 * file.
 */

const { buildExpectedGapPlans, buildExpectedFollowupDimensionKeys, gapRowsMatchExpectation, followupRowsMatchExpectation, queueRowsMatchExpectation } =
  __claimGapFollowupRepositoryTestables;
const { computeDimensions, toConflictGroupValidatorRecord, toConflictQueueValidatorRecord } = __claimTraceabilityRepositoryTestables;
const { DIMENSION_KEYS } = __claimTraceabilityRepositoryContract;

function toMapByKey(rows, key) {
  return new Map(rows.map((row) => [row[key], row]));
}

function groupByKey(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

function distinctDefined(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

async function batchRead(tx, organizationId, ids, sql) {
  if (ids.length === 0) return [];
  const { rows } = await tx.query(sql, [organizationId, ids]);
  return rows;
}

/**
 * Batch-reads every authoritative input evaluateClaimTraceabilityInTransaction
 * would read per claim, for the full set of candidate claim ids, in exactly
 * the fixed batched-query shape documented above. Must be called inside the same
 * read-only transaction/snapshot the candidate gap page itself was read in.
 */
async function loadCurrentStateBatches(tx, { organizationId, claimIds }) {
  const claims = await batchRead(
    tx, organizationId, claimIds,
    `SELECT claim_id, organization_id, evidence_item_id, claim_type, claim_status,
            claim_review_status, claim_strength, internal_only, public_use_allowed,
            funder_use_allowed, export_ready
       FROM kai.claims
      WHERE organization_id = $1::uuid AND claim_id = ANY($2::uuid[])`,
  );
  const claimsById = toMapByKey(claims, "claim_id");

  const claimEvidenceLinks = await batchRead(
    tx, organizationId, claimIds,
    `SELECT claim_evidence_link_id, organization_id, claim_id, evidence_item_id
       FROM kai.claim_evidence_links
      WHERE organization_id = $1::uuid AND claim_id = ANY($2::uuid[])`,
  );
  const claimEvidenceLinksByClaimId = toMapByKey(claimEvidenceLinks, "claim_id");

  const evidenceItemIds = distinctDefined(claimEvidenceLinks.map((row) => row.evidence_item_id));
  const evidenceItems = await batchRead(
    tx, organizationId, evidenceItemIds,
    `SELECT evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
            evidence_review_status, support_strength, sensitivity_level
       FROM kai.evidence_items
      WHERE organization_id = $1::uuid AND evidence_item_id = ANY($2::uuid[])`,
  );
  const evidenceItemsById = toMapByKey(evidenceItems, "evidence_item_id");

  const locatorIds = distinctDefined(evidenceItems.map((row) => row.source_locator_id));
  const sourceIds = distinctDefined(evidenceItems.map((row) => row.source_id));
  const sourceVersionIds = distinctDefined(evidenceItems.map((row) => row.source_version_id));

  const sourceLocators = await batchRead(
    tx, organizationId, locatorIds,
    `SELECT source_locator_id, organization_id, source_version_id
       FROM kai.source_locators
      WHERE organization_id = $1::uuid AND source_locator_id = ANY($2::uuid[])`,
  );
  const sourceLocatorsById = toMapByKey(sourceLocators, "source_locator_id");

  const sources = await batchRead(
    tx, organizationId, sourceIds,
    `SELECT source_id, organization_id, source_code
       FROM kai.sources
      WHERE organization_id = $1::uuid AND source_id = ANY($2::uuid[])`,
  );
  const sourcesById = toMapByKey(sources, "source_id");

  const sourceVersions = await batchRead(
    tx, organizationId, sourceVersionIds,
    `SELECT source_version_id, organization_id, source_id, intake_source_candidate_id,
            intake_sensitivity_profile_id, profile_canonical_sha256, is_current
       FROM kai.source_versions
      WHERE organization_id = $1::uuid AND source_version_id = ANY($2::uuid[])`,
  );
  const sourceVersionsById = toMapByKey(sourceVersions, "source_version_id");

  const candidateIds = distinctDefined(sourceVersions.map((row) => row.intake_source_candidate_id));
  const profileIds = distinctDefined(sourceVersions.map((row) => row.intake_sensitivity_profile_id));

  const candidates = await batchRead(
    tx, organizationId, candidateIds,
    `SELECT intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
            data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256,
            proposed_source_type, candidate_status
       FROM kai.intake_source_candidates
      WHERE organization_id = $1::uuid AND intake_source_candidate_id = ANY($2::uuid[])`,
  );
  const candidatesById = toMapByKey(candidates, "intake_source_candidate_id");

  const dictionaryIds = distinctDefined(candidates.map((row) => row.data_dictionary_id));

  const decisions = await batchRead(
    tx, organizationId, sourceVersionIds,
    `SELECT intake_promotion_decision_id, organization_id, intake_source_candidate_id,
            source_id, source_version_id, decision_status
       FROM kai.intake_promotion_decisions
      WHERE organization_id = $1::uuid AND source_version_id = ANY($2::uuid[])`,
  );
  const decisionsBySourceVersionId = toMapByKey(decisions, "source_version_id");

  const evidenceReviewQueueRows = await batchRead(
    tx, organizationId, evidenceItemIds,
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, queue_status, review_status, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = 'evidence_review'
        AND target_object_id = ANY($2::uuid[])`,
  );
  const evidenceReviewQueueByEvidenceItemId = toMapByKey(evidenceReviewQueueRows, "target_object_id");

  const claimReviewQueueRows = await batchRead(
    tx, organizationId, claimIds,
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, queue_status, review_status, updated_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = 'claim_review'
        AND target_object_id = ANY($2::uuid[])`,
  );
  const claimReviewQueueByClaimId = toMapByKey(claimReviewQueueRows, "target_object_id");

  const profiles = await batchRead(
    tx, organizationId, profileIds,
    `SELECT organization_id, intake_sensitivity_profile_id, intake_file_id, file_profile_id,
            data_dictionary_id, profile_canonical_sha256, human_review_required,
            public_use_allowed, funder_use_allowed, llm_processing_allowed,
            product_learning_allowed, retention_posture, small_cell_risk_status,
            allowed_use_status
       FROM kai.intake_sensitivity_profiles
      WHERE organization_id = $1::uuid AND intake_sensitivity_profile_id = ANY($2::uuid[])`,
  );
  const profilesById = toMapByKey(profiles, "intake_sensitivity_profile_id");

  const dictionaries = await batchRead(
    tx, organizationId, dictionaryIds,
    `SELECT data_dictionary_id, organization_id, intake_file_id, file_profile_id,
            profile_canonical_sha256, dictionary_status
       FROM kai.data_dictionaries
      WHERE organization_id = $1::uuid AND data_dictionary_id = ANY($2::uuid[])`,
  );
  const dictionariesById = toMapByKey(dictionaries, "data_dictionary_id");

  const dictionaryFieldRows = await batchRead(
    tx, organizationId, dictionaryIds,
    `SELECT data_dictionary_id, data_dictionary_field_id, profile_field_key, data_type,
            business_meaning, entity_level, sensitivity
       FROM kai.data_dictionary_fields
      WHERE organization_id = $1::uuid AND data_dictionary_id = ANY($2::uuid[])`,
  );
  const dictionaryFieldsByDictionaryId = groupByKey(dictionaryFieldRows, "data_dictionary_id");

  const qualityFindingRows = await batchRead(
    tx, organizationId, dictionaryIds,
    `SELECT data_dictionary_id, data_quality_finding_id, profile_field_key, finding_type, finding_status
       FROM kai.data_quality_findings
      WHERE organization_id = $1::uuid AND data_dictionary_id = ANY($2::uuid[])`,
  );
  const qualityFindingsByDictionaryId = groupByKey(qualityFindingRows, "data_dictionary_id");

  const evidenceFieldKeyRows = await batchRead(
    tx, organizationId, sourceVersionIds,
    `SELECT e.source_version_id AS source_version_id,
            sl.coordinates ->> 'column_name' AS profile_field_key
       FROM kai.evidence_items e
       JOIN kai.source_locators sl
         ON sl.source_locator_id = e.source_locator_id
        AND sl.organization_id = e.organization_id
      WHERE e.organization_id = $1::uuid AND e.source_version_id = ANY($2::uuid[])`,
  );
  const evidenceFieldKeysBySourceVersionId = new Map();
  for (const row of evidenceFieldKeyRows) {
    if (!evidenceFieldKeysBySourceVersionId.has(row.source_version_id)) {
      evidenceFieldKeysBySourceVersionId.set(row.source_version_id, []);
    }
    evidenceFieldKeysBySourceVersionId.get(row.source_version_id).push(row.profile_field_key);
  }

  const gapRows = await batchRead(
    tx, organizationId, claimIds,
    `SELECT gap_log_item_id, organization_id, claim_id, evidence_item_id, source_version_id,
            dimension_key, assessment_status, validator_key, safe_summary,
            open_finding_count, field_count, undefined_field_count, uncovered_field_count
       FROM kai.gap_log_items
      WHERE organization_id = $1::uuid AND claim_id = ANY($2::uuid[])
      ORDER BY claim_id ASC, dimension_key ASC, gap_log_item_id ASC`,
  );
  const gapRowsByClaimId = groupByKey(gapRows, "claim_id");

  const followupRows = await batchRead(
    tx, organizationId, claimIds,
    `SELECT client_followup_item_id, organization_id, claim_id, gap_log_item_id, dimension_key, question_text
       FROM kai.client_followup_items
      WHERE organization_id = $1::uuid AND claim_id = ANY($2::uuid[])
      ORDER BY claim_id ASC, dimension_key ASC, client_followup_item_id ASC`,
  );
  const followupRowsByClaimId = groupByKey(followupRows, "claim_id");

  const followupIds = distinctDefined(followupRows.map((row) => row.client_followup_item_id));
  const followupQueueRows = await batchRead(
    tx, organizationId, followupIds,
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, priority, queue_status, review_status, assigned_to,
            due_at, summary, required_action
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = 'client_followup'
        AND target_object_id = ANY($2::uuid[])`,
  );
  const followupQueueByFollowupId = toMapByKey(followupQueueRows, "target_object_id");

  const conflictGroupRows = claimIds.length === 0 ? [] : (
    await tx.query(
      `WITH candidate_claims AS (SELECT unnest($2::uuid[]) AS candidate_claim_id),
            matched AS (
              SELECT g.conflict_group_id, g.organization_id, g.lower_claim_id, g.higher_claim_id,
                     g.lower_claim_conflict_gap_id, g.higher_claim_conflict_gap_id, g.basis_code,
                     g.safe_summary, g.created_by_type, g.created_at, cc.candidate_claim_id,
                     ROW_NUMBER() OVER (
                       PARTITION BY cc.candidate_claim_id
                       ORDER BY g.lower_claim_id ASC, g.higher_claim_id ASC, g.conflict_group_id ASC
                     ) AS rn
                FROM candidate_claims cc
                JOIN kai.conflict_groups g
                  ON g.organization_id = $1::uuid
                 AND (g.lower_claim_id = cc.candidate_claim_id OR g.higher_claim_id = cc.candidate_claim_id)
            )
       SELECT conflict_group_id, organization_id, lower_claim_id, higher_claim_id,
              lower_claim_conflict_gap_id, higher_claim_conflict_gap_id, basis_code,
              safe_summary, created_by_type, created_at, candidate_claim_id
         FROM matched
        WHERE rn <= 101
        ORDER BY candidate_claim_id ASC, lower_claim_id ASC, higher_claim_id ASC, conflict_group_id ASC`,
      [organizationId, claimIds],
    )
  ).rows;
  const conflictGroupsByClaimId = groupByKey(conflictGroupRows, "candidate_claim_id");

  const conflictGroupIds = distinctDefined(conflictGroupRows.map((row) => row.conflict_group_id));
  const conflictQueueRows = await batchRead(
    tx, organizationId, conflictGroupIds,
    `SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
            target_object_id, queue_status, review_status, priority, summary,
            required_action, assigned_to, due_at
       FROM kai.review_queue_items
      WHERE organization_id = $1::uuid
        AND queue_type = 'conflict_resolution'
        AND target_object_id = ANY($2::uuid[])`,
  );
  const conflictQueueByConflictGroupId = toMapByKey(conflictQueueRows, "target_object_id");

  return {
    claimsById,
    claimEvidenceLinksByClaimId,
    evidenceItemsById,
    sourceLocatorsById,
    sourcesById,
    sourceVersionsById,
    candidatesById,
    decisionsBySourceVersionId,
    evidenceReviewQueueByEvidenceItemId,
    claimReviewQueueByClaimId,
    profilesById,
    dictionariesById,
    dictionaryFieldsByDictionaryId,
    qualityFindingsByDictionaryId,
    evidenceFieldKeysBySourceVersionId,
    gapRowsByClaimId,
    followupRowsByClaimId,
    followupQueueByFollowupId,
    conflictGroupsByClaimId,
    conflictQueueByConflictGroupId,
  };
}

/**
 * Replays, in memory over already-batch-loaded rows for one claim, the exact
 * same sequence of fail-closed gates evaluateClaimTraceabilityInTransaction
 * itself applies before it will ever return that claim's gap_items - using
 * the identical pure helpers it uses. Returns true only when that claim would
 * reach evaluateClaimTraceabilityInTransaction's own success() return right
 * now; false the moment any gate fails (fail closed).
 */
function claimIsCurrentForGapExposure(claimId, batches) {
  const claimRow = batches.claimsById.get(claimId);
  if (!claimRow) return false;

  const claimEvidenceLinkRow = batches.claimEvidenceLinksByClaimId.get(claimId);
  if (!claimEvidenceLinkRow) return false;
  if (claimEvidenceLinkRow.evidence_item_id !== claimRow.evidence_item_id) return false;

  const evidenceItemRow = batches.evidenceItemsById.get(claimEvidenceLinkRow.evidence_item_id);
  if (!evidenceItemRow) return false;
  const locatorRow = batches.sourceLocatorsById.get(evidenceItemRow.source_locator_id);
  if (!locatorRow) return false;
  const sourceRow = batches.sourcesById.get(evidenceItemRow.source_id);
  if (!sourceRow) return false;
  const sourceVersionRow = batches.sourceVersionsById.get(evidenceItemRow.source_version_id);
  if (!sourceVersionRow) return false;
  if (sourceVersionRow.is_current !== true) return false;

  const candidateRow = batches.candidatesById.get(sourceVersionRow.intake_source_candidate_id);
  if (!candidateRow) return false;
  const decisionRow = batches.decisionsBySourceVersionId.get(evidenceItemRow.source_version_id);
  if (!decisionRow) return false;
  const evidenceReviewQueueItemRow = batches.evidenceReviewQueueByEvidenceItemId.get(evidenceItemRow.evidence_item_id);
  if (!evidenceReviewQueueItemRow) return false;
  const claimReviewQueueItemRow = batches.claimReviewQueueByClaimId.get(claimId);
  if (!claimReviewQueueItemRow) return false;

  const profileRow = batches.profilesById.get(candidateRow.intake_sensitivity_profile_id);
  if (!profileRow) return false;
  const dictionaryRow = batches.dictionariesById.get(candidateRow.data_dictionary_id);
  if (!dictionaryRow) return false;

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
  if (!lineageValidation.ok) return false;

  const dictionaryFieldRows = batches.dictionaryFieldsByDictionaryId.get(dictionaryRow.data_dictionary_id) || [];
  const qualityFindingRows = batches.qualityFindingsByDictionaryId.get(dictionaryRow.data_dictionary_id) || [];
  const evidenceFieldKeys = batches.evidenceFieldKeysBySourceVersionId.get(evidenceItemRow.source_version_id) || [];

  const dimensions = computeDimensions({ dictionaryFieldRows, qualityFindingRows, profileRow, evidenceFieldKeys });
  const expectedGapPlans = buildExpectedGapPlans(dimensions);
  const expectedFollowupDimensionKeys = buildExpectedFollowupDimensionKeys(expectedGapPlans);

  const gapRows = batches.gapRowsByClaimId.get(claimId) || [];
  const followupRows = batches.followupRowsByClaimId.get(claimId) || [];
  const followupQueueRows = followupRows
    .map((row) => batches.followupQueueByFollowupId.get(row.client_followup_item_id))
    .filter(Boolean);

  const noPersistedP204 = gapRows.length === 0 && followupRows.length === 0 && followupQueueRows.length === 0;
  if (noPersistedP204) {
    const allClear = DIMENSION_KEYS.every((dimensionKey) => !dimensionResultRequiresGap(dimensions[dimensionKey]));
    if (!allClear) return false;
  } else {
    const gapsMatch = gapRowsMatchExpectation(gapRows, expectedGapPlans, {
      evidenceItemId: evidenceItemRow.evidence_item_id,
      sourceVersionId: evidenceItemRow.source_version_id,
    });
    const followupsMatch =
      gapsMatch && followupRowsMatchExpectation(followupRows, expectedFollowupDimensionKeys, gapRows, { claimId });
    const queuesMatch = followupsMatch && queueRowsMatchExpectation(followupQueueRows, followupRows);
    if (!gapsMatch || !followupsMatch || !queuesMatch) return false;
  }

  const conflictGroupRows = (batches.conflictGroupsByClaimId.get(claimId) || []).slice(0, 100);
  const conflictQueueRows = conflictGroupRows
    .map((row) => batches.conflictQueueByConflictGroupId.get(row.conflict_group_id))
    .filter(Boolean);
  if (conflictQueueRows.length !== conflictGroupRows.length) return false;

  for (const groupRow of conflictGroupRows) {
    const queueRow = batches.conflictQueueByConflictGroupId.get(groupRow.conflict_group_id);
    const validation = validateConflictGroupCompleteness({
      conflictGroup: toConflictGroupValidatorRecord(groupRow),
      queueItem: queueRow ? toConflictQueueValidatorRecord(queueRow) : null,
    });
    if (validation?.severity !== "pass") return false;
  }

  return true;
}

/**
 * Given one bounded candidate page of kai.gap_log_items rows (already read in
 * this same transaction/snapshot), returns only the subset whose owning claim
 * currently reaches evaluateClaimTraceabilityInTransaction's own success()
 * return. Must be called with the same `tx` the candidate page was read
 * through, before COMMIT, so every input is read from one consistent
 * snapshot. Performs a fixed, bounded number of batched reads total (see the
 * module-level comment above), regardless of the number of distinct claims
 * referenced by `candidateGapRows` - no call inside any per-claim loop.
 */
export async function filterCurrentOrganizationEvidenceGaps(tx, { organizationId, candidateGapRows }) {
  if (candidateGapRows.length === 0) return [];
  const claimIds = distinctDefined(candidateGapRows.map((row) => row.claim_id));
  const batches = await loadCurrentStateBatches(tx, { organizationId, claimIds });
  return candidateGapRows.filter((row) => claimIsCurrentForGapExposure(row.claim_id, batches));
}

export const __organizationEvidenceGapCurrentStateRepositoryTestables = Object.freeze({
  loadCurrentStateBatches,
  claimIsCurrentForGapExposure,
});
