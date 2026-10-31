import { getScopedEvidenceMeasurementByEvidenceItemId, getScopedSourceVersionById } from "../db/kaiIntakeQueries.js";
import { findCurrentClaimReviewDecision, findCurrentEvidenceReviewDecision } from "./postgresHumanReviewDecisionRepository.js";
import {
  AmbiguousSensitivityDecisionLineageError,
  findCurrentSensitivityAllowedUseDecision,
} from "./postgresSensitivityAllowedUseDecisionRepository.js";
import { COUNT_ONLY_LIMITATION_CODE } from "../validators/kaiGeneratedContentValidators.js";
import {
  MEASUREMENT_DEFINITION_STATUS,
  MEASUREMENT_EVIDENCE_TYPE,
  MEASUREMENT_TYPE_RECORD_COUNT,
  composeMeasurementClaimStatement,
  validateMeasurementClaimBasis,
} from "../validators/kaiSourceMeasurementValidators.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Ordinary internal factual authority (owner decision 2026-10-25): ordinary,
 * adequately supported impact information that is already authorized for
 * internal use is reusable in evidence, claims, generation and internal
 * report downloads without further human approval.
 *
 * A measured claim is ordinary when, re-read now:
 * - its evidence is P2-01M source-record-count measurement evidence whose
 *   measurement still matches its basis (validateMeasurementClaimBasis) under
 *   a human-confirmed definition of the same source version;
 * - the claim is the 'finding' that restates exactly that measurement
 *   (composeMeasurementClaimStatement), so it adds no interpretation;
 * - the source version is current, and its current Phase-5 sensitivity
 *   decision is complete, permits the use and AI processing, and records each
 *   Operating Model section 7.2 category as 'absent'.
 *
 * The authority is the human sensitivity decision and the human measurement
 * definition already recorded for the source, plus the deterministic count.
 * It writes nothing and invents no reviewer: a recorded evidence or claim
 * review decision still governs its own lineage, and P2-06 applies this only
 * to the internal audience.
 */
export const HIGH_RISK_SENSITIVITY_FIELDS = Object.freeze({
  reviewed_personal_data_status: "personal_information_not_cleared",
  reviewed_minor_data_status: "minor_information_not_cleared",
  reviewed_health_housing_justice_immigration_status: "sensitive_information_not_cleared",
  reviewed_indigenous_governance_status: "indigenous_governance_not_cleared",
  reviewed_story_testimonial_status: "story_testimonial_not_cleared",
  reviewed_small_cell_risk_status: "small_cell_risk_not_cleared",
});

// The source-level coverage dimensions a human sensitivity review answers for
// an ordinary source. They stay limitations of the count (never resolved
// facts) and are carried into every internal report automatically.
export const ORDINARY_SOURCE_LIMITATION_DIMENSION_KEYS = Object.freeze([
  "small_cell_risk",
  "conflicting_source_indicators",
  "requirement_alignment",
]);

/**
 * Count-only internal authority for a story-present source (owner prompt
 * 2026-10-30, "Implement Safe Internal Count-Only Authority for
 * Story-Present Sources"). Operating Model section 7.2 keeps Get Kinder's
 * release review for public story/testimonial use; a deterministic record
 * count restated exactly from its measurement uses no story or testimonial
 * content. So a source whose current decision records stories/testimonials
 * 'present' - never 'unknown' - with every other category 'absent', the use
 * allowed and AI processing permitted, gives an otherwise ordinary measured
 * claim internal authority as a count only, while no current evidence or
 * claim decision on its lineage is negative. The recorded category is not
 * changed and story_testimonial_not_cleared still governs every other
 * operation; the operations that accept this basis are the internal
 * Evidence Summary's generation (story-free model input and VAL-GEN-010
 * output) and its internal Markdown, re-checked when it is read.
 */
export const ORDINARY_AUTHORITY_BASIS = Object.freeze({
  ALL_CATEGORIES_ABSENT: "all_sensitive_categories_absent",
  COUNT_ONLY_STORY_TESTIMONIAL_PRESENT: "count_only_story_testimonial_present",
});
export const COUNT_ONLY_CONTENT_TYPE = "evidence_summary";
// Carried in the governed generator input beside the measurement codes
// (defined with VAL-GEN-010, which keys on it).
export { COUNT_ONLY_LIMITATION_CODE };
export const COUNT_ONLY_OPERATION_REASON = "story_testimonial_count_only_operation_not_permitted";
// P2-06 attaches its ordinary basis to its result data under this key: not
// enumerable, so every exact-key DTO contract, projection and JSON body is
// unchanged. { basis, reliedOn } or absent (not the internal audience).
export const ORDINARY_INTERNAL_AUTHORITY = Symbol("kai.ordinaryInternalAuthority");

const POSITIVE_EVIDENCE_OUTCOMES = new Set(["supported", "supported_with_limitation"]);
const POSITIVE_CLAIM_OUTCOMES = new Set(["approved", "approved_with_limitation"]);

export function attachOrdinaryInternalAuthority(data, authority) {
  Object.defineProperty(data, ORDINARY_INTERNAL_AUTHORITY, { value: Object.freeze({ ...authority }), enumerable: false });
  return data;
}

export function ordinaryInternalAuthorityOf(data) {
  return data?.[ORDINARY_INTERNAL_AUTHORITY] ?? null;
}

// Whether the source reasons leave only the recorded 'present' story
// category: the one condition the count-only basis answers. Pure.
export function isCountOnlyStoryTestimonialSource(source) {
  return source?.getKinderReviewReasons?.length === 1
    && source.getKinderReviewReasons[0] === HIGH_RISK_SENSITIVITY_FIELDS.reviewed_story_testimonial_status
    && source.blockedReasons?.length === 0
    && source.recorded?.categories?.reviewed_story_testimonial_status === "present";
}

export const ORDINARY_AUTHORITY_REASONS = Object.freeze([
  "evidence_type_not_measurement",
  "measurement_definition_not_confirmed",
  "claim_not_measurement_restatement",
  "sensitivity_review_not_complete",
  ...Object.values(HIGH_RISK_SENSITIVITY_FIELDS),
  "source_version_not_current",
  "processing_permission_not_established",
]);

// One source version's current decision (or null when it has none) ->
// reasons. Pure; exported for the unit contract.
export function classifySourceDecision(decision) {
  if (!decision || decision.decision_outcome !== "reviewed") {
    return { getKinderReviewReasons: ["sensitivity_review_not_complete"], blockedReasons: [] };
  }
  const blockedReasons = decision.reviewed_allowed_use_status === "allowed" && decision.reviewed_llm_processing_allowed === true
    ? []
    : ["processing_permission_not_established"];
  const getKinderReviewReasons = Object.entries(HIGH_RISK_SENSITIVITY_FIELDS)
    .filter(([field]) => decision[field] !== "absent")
    .map(([, reason]) => reason);
  return { getKinderReviewReasons, blockedReasons };
}

// The recorded values classifySourceDecision reads, for display only: an
// unanswered ('unknown') category stays distinguishable from one recorded
// 'present'. null when no complete (reviewed) decision is recorded. Pure.
export function recordedSourcePermissions(decision) {
  if (!decision || decision.decision_outcome !== "reviewed") return null;
  return {
    allowed_use_status: decision.reviewed_allowed_use_status ?? null,
    ai_processing_allowed: decision.reviewed_llm_processing_allowed === true,
    categories: Object.fromEntries(Object.keys(HIGH_RISK_SENSITIVITY_FIELDS).map((field) => [field, decision[field] ?? null])),
  };
}

// One source version -> reasons: its currentness and its current Phase-5
// sensitivity decision (classifySourceDecision), with the recorded values.
export async function classifySourceVersionInTransaction(tx, { organizationId, sourceVersionId }) {
  const version = await getScopedSourceVersionById({ organizationId, sourceVersionId }, tx);
  if (!version) return { getKinderReviewReasons: ["sensitivity_review_not_complete"], blockedReasons: [], recorded: null, isCurrent: false };
  let decision = null;
  try {
    decision = UUID_PATTERN.test(version.intake_sensitivity_profile_id ?? "")
      ? await findCurrentSensitivityAllowedUseDecision(tx, {
        organizationId,
        intakeSensitivityProfileId: version.intake_sensitivity_profile_id,
      })
      : null;
  } catch (error) {
    if (!(error instanceof AmbiguousSensitivityDecisionLineageError)) throw error;
    decision = null;
  }
  if (decision && decision.organization_id !== organizationId) decision = null;
  const source = classifySourceDecision(decision);
  return {
    getKinderReviewReasons: source.getKinderReviewReasons,
    blockedReasons: version.is_current === true ? source.blockedReasons : ["source_version_not_current", ...source.blockedReasons],
    recorded: recordedSourcePermissions(decision),
    isCurrent: version.is_current === true,
  };
}

// A measurement row backing this evidence item under a human-confirmed
// record-count definition of the same source version. Pure.
export function isConfirmedMeasurement(measurementRow, evidenceItemRow) {
  return Boolean(measurementRow)
    && measurementRow.measurement_type === MEASUREMENT_TYPE_RECORD_COUNT
    && measurementRow.definition_status === MEASUREMENT_DEFINITION_STATUS
    && measurementRow.source_version_id === evidenceItemRow.source_version_id
    && measurementRow.definition_source_version_id === evidenceItemRow.source_version_id;
}

function orderedReasons(reasons) {
  const present = new Set(reasons);
  return ORDINARY_AUTHORITY_REASONS.filter((reason) => present.has(reason));
}

/**
 * Whether this measured claim is ordinary internal factual information now.
 * claimRow is optional: without it only the evidence is classified (the
 * evidence is then reusable; the claim is checked when it is evaluated).
 * locatorRow and sourceVersionRow are the evidence item's own rows.
 */
export async function evaluateOrdinaryMeasurementAuthorityInTransaction(tx, {
  organizationId, evidenceItemRow, locatorRow, sourceVersionRow, claimRow = null,
}) {
  const reasons = [];
  let measurementRow = null;
  let source = null;
  if (!evidenceItemRow || evidenceItemRow.evidence_type !== MEASUREMENT_EVIDENCE_TYPE) {
    reasons.push("evidence_type_not_measurement");
  } else {
    measurementRow = await getScopedEvidenceMeasurementByEvidenceItemId({ organizationId, evidenceItemId: evidenceItemRow.evidence_item_id }, tx);
    if (!isConfirmedMeasurement(measurementRow, evidenceItemRow)
      || !validateMeasurementClaimBasis({ evidenceItemRow, locatorRow, sourceVersionRow, measurementRow }).ok) {
      reasons.push("measurement_definition_not_confirmed");
    } else if (claimRow && (
      claimRow.claim_type !== "finding"
      || claimRow.evidence_item_id !== evidenceItemRow.evidence_item_id
      || claimRow.statement !== composeMeasurementClaimStatement({
        measurementRow,
        definitionRow: measurementRow,
        locatorCoordinates: locatorRow?.coordinates ?? null,
      })
    )) {
      reasons.push("claim_not_measurement_restatement");
    }
    source = await classifySourceVersionInTransaction(tx, { organizationId, sourceVersionId: evidenceItemRow.source_version_id });
    reasons.push(...source.getKinderReviewReasons, ...source.blockedReasons);
  }
  let ordered = orderedReasons(reasons);
  let basis = ordered.length === 0 ? ORDINARY_AUTHORITY_BASIS.ALL_CATEGORIES_ABSENT : null;
  // Only a claim that restates the measurement (checked above) can be a
  // count-only use, and only while no recorded decision on its lineage is
  // negative.
  if (claimRow && ordered.length === 1 && isCountOnlyStoryTestimonialSource(source)) {
    const evidenceHead = await findCurrentEvidenceReviewDecision(tx, { organizationId, evidenceItemId: evidenceItemRow.evidence_item_id });
    const claimHead = await findCurrentClaimReviewDecision(tx, { organizationId, claimId: claimRow.claim_id });
    if ((!evidenceHead || POSITIVE_EVIDENCE_OUTCOMES.has(evidenceHead.decision_outcome))
      && (!claimHead || POSITIVE_CLAIM_OUTCOMES.has(claimHead.decision_outcome))) {
      ordered = [];
      basis = ORDINARY_AUTHORITY_BASIS.COUNT_ONLY_STORY_TESTIMONIAL_PRESENT;
    }
  }
  return {
    ordinary: ordered.length === 0,
    reasons: ordered,
    basis,
    measurementRow,
    sourcePermissions: source ? { is_current: source.isCurrent, recorded: source.recorded } : null,
  };
}
