import { withTransaction } from "../db/kaiDb.js";
import {
  getScopedClaimById,
  getScopedEvidenceItemById,
  getScopedEvidenceMeasurementByEvidenceItemId,
  getScopedSourceLocatorById,
  getScopedSourceVersionById,
} from "../db/kaiIntakeQueries.js";
import { evaluateClaimTraceabilityInTransaction } from "./postgresClaimTraceabilityRepository.js";
import { findCurrentClaimReviewDecision, findCurrentEvidenceReviewDecision } from "./postgresHumanReviewDecisionRepository.js";
import {
  HIGH_RISK_SENSITIVITY_FIELDS,
  ORDINARY_SOURCE_LIMITATION_DIMENSION_KEYS,
  classifySourceVersionInTransaction,
  evaluateOrdinaryMeasurementAuthorityInTransaction,
  isConfirmedMeasurement,
} from "./postgresOrdinaryInternalFactAuthority.js";
import {
  MEASUREMENT_EVIDENCE_TYPE,
  describeMeasurementLimitationCode,
  measurementLimitationCodes,
} from "../validators/kaiSourceMeasurementValidators.js";

export { isConfirmedMeasurement };

/**
 * Organization-owned factual review of an ordinary internal measurement
 * (owner authorization 2026-10-24, Operating Model v0.2 section 11
 * exception): an active client_admin may record the evidence factual
 * review, the internal claim review, and the internal acceptance of a
 * supportable coverage limitation for their own organization's
 * source-record-count measurement. Everything else keeps Get Kinder's review.
 *
 * The evidence is ordinary only when it is P2-01M measurement evidence with
 * a human-confirmed record-count definition on its own source version, that
 * source version is current, and its current Phase-5 sensitivity decision is
 * complete, permits the use and AI processing, and records each Operating
 * Model section 7.2 category as 'absent' (classifySourceVersionInTransaction,
 * shared with the organization's draft review). An organization decision
 * never supersedes a Get Kinder decision on the same lineage. A coverage
 * limitation is supportable only for the three source-level dimensions a
 * human sensitivity review answers (small-cell risk, conflicting sources,
 * requirement alignment), and only once both factual reviews found the
 * measurement supported.
 *
 * Evaluated inside the decision's own transaction, before any write; the
 * database pins the same structural scope (migration
 * kai_sprint2_plan_a_organization_internal_factual_review_authority), and
 * P2-06 never counts an organization evidence decision for funder or public
 * use.
 */
export const ORGANIZATION_FACTUAL_REVIEW_VALIDATOR_KEY = "VAL-KAI-ORG-FACTUAL-REVIEW-001";
export const ORGANIZATION_DECISION_ROLE = "client_admin";
export const ORGANIZATION_ACCEPTABLE_LIMITATION_DIMENSION_KEYS = ORDINARY_SOURCE_LIMITATION_DIMENSION_KEYS;

export const GET_KINDER_REVIEW_REASONS = Object.freeze([
  "evidence_type_requires_get_kinder_review",
  "measurement_definition_not_confirmed",
  "sensitivity_review_not_complete",
  ...Object.values(HIGH_RISK_SENSITIVITY_FIELDS),
  "get_kinder_decision_recorded",
  "limitation_requires_get_kinder_review",
]);

export const BLOCKED_REASONS = Object.freeze([
  "source_version_not_current",
  "processing_permission_not_established",
  "factual_review_not_supported",
]);

const REVIEWED_SUPPORTED = "reviewed_supported";
const GET_KINDER_REVIEWER_ROLE = "gk_reviewer";

// The human step each P2-06 internal blocker waits on.
const OUTSTANDING_REVIEW_STEP = Object.freeze({
  evidence_review_unresolved: "evidence_review",
  claim_review_unresolved: "claim_review",
  claim_not_approved_for_requested_audience: "claim_review",
  coverage_dimension_unresolved: "coverage_acceptance",
  client_followup_unresolved: "client_followup",
  potential_conflict_review_unresolved: "conflict_review",
});

function ordered(reasons, vocabulary) {
  const present = new Set(reasons);
  return vocabulary.filter((reason) => present.has(reason));
}

function verdict(getKinder, blocked) {
  const getKinderReviewReasons = ordered(getKinder, GET_KINDER_REVIEW_REASONS);
  const blockedReasons = ordered(blocked, BLOCKED_REASONS);
  return {
    getKinderReviewReasons,
    blockedReasons,
    organizationMayReview: getKinderReviewReasons.length === 0 && blockedReasons.length === 0,
  };
}

/**
 * Whether the organization may record an evidence or claim decision on this
 * evidence item's lineage now. currentHead is the current decision of the
 * lineage being decided (evidence or claim), or null.
 */
export async function evaluateOrganizationFactualReviewInTransaction(tx, { organizationId, evidenceItemId, currentHead = null }) {
  const getKinder = [];
  const blocked = [];
  const evidenceItemRow = await getScopedEvidenceItemById({ organizationId, evidenceItemId }, tx);
  if (!evidenceItemRow || evidenceItemRow.evidence_type !== MEASUREMENT_EVIDENCE_TYPE) {
    getKinder.push("evidence_type_requires_get_kinder_review");
  } else {
    const measurementRow = await getScopedEvidenceMeasurementByEvidenceItemId({ organizationId, evidenceItemId }, tx);
    if (!isConfirmedMeasurement(measurementRow, evidenceItemRow)) getKinder.push("measurement_definition_not_confirmed");
    const source = await classifySourceVersionInTransaction(tx, {
      organizationId,
      sourceVersionId: evidenceItemRow.source_version_id,
    });
    getKinder.push(...source.getKinderReviewReasons);
    blocked.push(...source.blockedReasons);
  }
  if (currentHead && currentHead.decided_by_role !== ORGANIZATION_DECISION_ROLE) getKinder.push("get_kinder_decision_recorded");
  return verdict(getKinder, blocked);
}

/**
 * Whether the organization may accept this dimension as an internal
 * limitation, given the claim's current P2-06 internal evaluation (data).
 */
export async function evaluateOrganizationCoverageAcceptanceInTransaction(tx, { organizationId, data, dimensionKey }) {
  const evidence = await evaluateOrganizationFactualReviewInTransaction(tx, {
    organizationId,
    evidenceItemId: data.evidence.evidence_item_id,
  });
  const getKinder = [...evidence.getKinderReviewReasons];
  const blocked = [...evidence.blockedReasons];
  if (!ORGANIZATION_ACCEPTABLE_LIMITATION_DIMENSION_KEYS.includes(dimensionKey)) getKinder.push("limitation_requires_get_kinder_review");
  if (data.claim.claim_strength !== REVIEWED_SUPPORTED || data.evidence.support_strength !== REVIEWED_SUPPORTED) {
    blocked.push("factual_review_not_supported");
  }
  return verdict(getKinder, blocked);
}

export function organizationFactualReviewBlockers({ getKinderReviewReasons, blockedReasons }) {
  return [...getKinderReviewReasons, ...blockedReasons].map((reason) => ({
    validator_key: ORGANIZATION_FACTUAL_REVIEW_VALIDATOR_KEY,
    severity: "blocker",
    blocking_reason: reason,
  }));
}

// The repository failure an organization decision returns when it is not
// admitted: nothing is written.
export function organizationFactualReviewRefusal(evaluation) {
  return {
    ok: false,
    data: null,
    error: { code: "blocked", status: 422 },
    blockers: organizationFactualReviewBlockers(evaluation),
  };
}

async function readMeasurementDefinition(tx, { organizationId, sourceMeasurementDefinitionId }) {
  const { rows } = await tx.query(
    `SELECT definition_text, inclusion_rule, exclusion_rule
       FROM kai.source_measurement_definitions
      WHERE organization_id = $1::uuid
        AND source_measurement_definition_id = $2::uuid`,
    [organizationId, sourceMeasurementDefinitionId],
  );
  return rows[0] || null;
}

function decidedBy(head) {
  if (!head) return null;
  return head.decided_by_role === ORGANIZATION_DECISION_ROLE ? "organization" : "get_kinder";
}

function decisionState(head, queue, evaluation) {
  return {
    review_queue_item_id: queue.review_queue_item_id,
    expected_updated_at: queue.updated_at,
    queue_status: queue.queue_status,
    review_status: queue.review_status,
    decision_outcome: head?.decision_outcome ?? null,
    decided_by: decidedBy(head),
    organization_may_decide: evaluation.organizationMayReview,
    get_kinder_review_reasons: evaluation.getKinderReviewReasons,
    blocked_reasons: evaluation.blockedReasons,
  };
}

/**
 * The organization administrator's factual-review view of one claim: what is
 * measured and from which source, the current decisions and who made them
 * (the organization or Get Kinder, never an identity), the coverage
 * limitations with whether each may be accepted now, and the authoritative
 * internal eligibility (P2-06) with its remaining blockers. Read-only; it
 * grants nothing, and every decision re-checks its own admission.
 */
export async function readOrganizationFactualReviewInTransaction(tx, { organizationId, claimId }) {
  const traceability = await evaluateClaimTraceabilityInTransaction(tx, { organizationId, claimId, requestedAudience: "internal" });
  if (!traceability.ok) return traceability;
  const data = traceability.data;
  const evidenceItemId = data.evidence.evidence_item_id;
  const evidenceHead = await findCurrentEvidenceReviewDecision(tx, { organizationId, evidenceItemId });
  const claimHead = await findCurrentClaimReviewDecision(tx, { organizationId, claimId });
  const evidenceEvaluation = await evaluateOrganizationFactualReviewInTransaction(tx, { organizationId, evidenceItemId, currentHead: evidenceHead });
  const claimEvaluation = await evaluateOrganizationFactualReviewInTransaction(tx, { organizationId, evidenceItemId, currentHead: claimHead });

  const measurementRow = await getScopedEvidenceMeasurementByEvidenceItemId({ organizationId, evidenceItemId }, tx);
  const definitionRow = measurementRow
    ? await readMeasurementDefinition(tx, { organizationId, sourceMeasurementDefinitionId: measurementRow.source_measurement_definition_id })
    : null;

  const coverageLimitations = [];
  for (const [dimensionKey, dimension] of Object.entries(data.dimensions)) {
    if (dimension.assessment_status === "resolved_clear") continue;
    // organization_acceptable: the organization may accept this limitation
    // once both factual reviews found the measurement supported;
    // organization_may_accept: it may accept it now.
    let organizationAcceptable = false;
    let organizationMayAccept = false;
    if (dimension.assessment_status === "unresolved" && dimension.internal_limitation_accepted !== true) {
      const acceptance = await evaluateOrganizationCoverageAcceptanceInTransaction(tx, { organizationId, data, dimensionKey });
      organizationMayAccept = acceptance.organizationMayReview;
      organizationAcceptable = acceptance.getKinderReviewReasons.length === 0
        && acceptance.blockedReasons.every((reason) => reason === "factual_review_not_supported");
    }
    coverageLimitations.push({
      dimension_key: dimensionKey,
      assessment_status: dimension.assessment_status,
      internal_limitation_accepted: dimension.internal_limitation_accepted === true,
      organization_acceptable: organizationAcceptable,
      organization_may_accept: organizationMayAccept,
    });
  }

  const limitationCodes = measurementRow ? measurementLimitationCodes({ measurementRow, dimensions: data.dimensions }) : [];
  // The ordinary internal rule exactly as P2-06 applies it, with its reasons
  // and the recorded source values it read (never re-derived here).
  const claimRow = await getScopedClaimById({ organizationId, claimId }, tx);
  const evidenceItemRow = await getScopedEvidenceItemById({ organizationId, evidenceItemId }, tx);
  const ordinaryRule = await evaluateOrdinaryMeasurementAuthorityInTransaction(tx, {
    organizationId,
    evidenceItemRow,
    locatorRow: await getScopedSourceLocatorById({ organizationId, sourceLocatorId: data.locator.source_locator_id }, tx),
    sourceVersionRow: await getScopedSourceVersionById({ organizationId, sourceVersionId: data.source_version.source_version_id }, tx),
    claimRow,
  });
  const outstanding = [...new Set(data.blockerCodes.map((code) => OUTSTANDING_REVIEW_STEP[code]).filter(Boolean))];
  return {
    ok: true,
    error: null,
    data: {
      claim_id: claimId,
      evidence_item_id: evidenceItemId,
      claim_statement: data.claim.statement,
      evidence_statement: data.evidence.statement,
      source: {
        source_code: data.source.source_code,
        source_version_id: data.source_version.source_version_id,
        is_current: data.source_version.is_current === true,
      },
      measurement: measurementRow
        ? {
          calculation_method: measurementRow.calculation_method,
          worksheet_key: measurementRow.worksheet_key || null,
          worksheet_name: measurementRow.worksheet_name || null,
          measured_value: measurementRow.measured_value,
          unit_label: measurementRow.unit_label,
          counted_unit: measurementRow.counted_unit,
          total_record_count: measurementRow.total_record_count,
          blank_record_count: measurementRow.blank_record_count,
          duplicate_record_count: measurementRow.duplicate_record_count,
          period_start: measurementRow.period_start,
          period_end: measurementRow.period_end,
          definition_text: definitionRow?.definition_text ?? null,
          inclusion_rule: definitionRow?.inclusion_rule ?? null,
          exclusion_rule: definitionRow?.exclusion_rule ?? null,
        }
        : null,
      limitations: limitationCodes.map((code) => ({ code, description: describeMeasurementLimitationCode(code) })),
      // basis: all_sensitive_categories_absent, or count_only_story_testimonial_present
      // (usable as a count in an internal Evidence Summary only); null when it does not apply.
      ordinary_internal_rule: { applies: ordinaryRule.ordinary, reasons: ordinaryRule.reasons, basis: ordinaryRule.basis },
      source_permissions: {
        is_current: ordinaryRule.sourcePermissions?.is_current === true,
        sensitivity_review_complete: Boolean(ordinaryRule.sourcePermissions?.recorded),
        ...(ordinaryRule.sourcePermissions?.recorded
          ?? { allowed_use_status: null, ai_processing_allowed: false, categories: null }),
      },
      // Which human steps the authoritative internal evaluation still needs,
      // and whose they are: Get Kinder's reviewer outside the ordinary rule.
      review_requirement: data.eligible === true
        ? null
        : { responsible_role: ordinaryRule.ordinary ? null : GET_KINDER_REVIEWER_ROLE, outstanding },
      evidence_review: decisionState(evidenceHead, {
        review_queue_item_id: data.evidence.review_queue_item_id,
        updated_at: data.evidence.updated_at,
        queue_status: data.evidence.review_queue_status,
        review_status: data.evidence.review_status,
      }, evidenceEvaluation),
      claim_review: {
        ...decisionState(claimHead, data.claim_review, claimEvaluation),
        approved_audiences: claimHead?.approved_audiences ?? null,
      },
      coverage_limitations: coverageLimitations,
      internal_eligibility: { eligible: data.eligible === true, blocker_codes: data.blockerCodes },
    },
  };
}

export function createPostgresOrganizationFactualReviewRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    async getOrganizationFactualReview({ organizationId, claimId }) {
      return runInTransaction(async (tx) => {
        await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        return readOrganizationFactualReviewInTransaction(tx, { organizationId, claimId });
      });
    },
  });
}
