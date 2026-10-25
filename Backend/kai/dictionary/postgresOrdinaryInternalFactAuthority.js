import { getScopedEvidenceMeasurementByEvidenceItemId, getScopedSourceVersionById } from "../db/kaiIntakeQueries.js";
import {
  AmbiguousSensitivityDecisionLineageError,
  findCurrentSensitivityAllowedUseDecision,
} from "./postgresSensitivityAllowedUseDecisionRepository.js";
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

// One source version -> reasons: its currentness and its current Phase-5
// sensitivity decision (classifySourceDecision).
export async function classifySourceVersionInTransaction(tx, { organizationId, sourceVersionId }) {
  const version = await getScopedSourceVersionById({ organizationId, sourceVersionId }, tx);
  if (!version) return { getKinderReviewReasons: ["sensitivity_review_not_complete"], blockedReasons: [] };
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
      || claimRow.statement !== composeMeasurementClaimStatement({ measurementRow, definitionRow: measurementRow })
    )) {
      reasons.push("claim_not_measurement_restatement");
    }
    const source = await classifySourceVersionInTransaction(tx, { organizationId, sourceVersionId: evidenceItemRow.source_version_id });
    reasons.push(...source.getKinderReviewReasons, ...source.blockedReasons);
  }
  const ordered = orderedReasons(reasons);
  return { ordinary: ordered.length === 0, reasons: ordered, measurementRow };
}
