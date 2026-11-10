import {
  getScopedClaimById,
  getScopedDerivedMeasurementByEvidenceItemId,
  getScopedEvidenceItemById,
  getScopedEvidenceMeasurementByEvidenceItemId,
  getScopedSourceLocatorById,
  getScopedSourceVersionById,
} from "../db/kaiIntakeQueries.js";
import {
  DERIVED_MEASUREMENT_EVIDENCE_TYPE,
  composeDerivedClaimStatementFromRow,
  validateDerivedMeasurementClaimBasis,
} from "../validators/kaiDerivedMeasurementValidators.js";
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
 *   (composeMeasurementClaimStatement), so it adds no interpretation
 *   (evaluateMeasuredClaimIntegrityInTransaction, the same rule P2-06 applies
 *   to every audience);
 * - the source version is current, and its current Phase-5 sensitivity
 *   decision is complete, permits the use and AI processing, and clears the
 *   independently governed sensitivity categories. Story presence is metadata.
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

// Owner decision 2026-11-06: story presence is metadata, never authority.
// Keep the established ordinary basis for every story-presence value.
export const ORDINARY_AUTHORITY_BASIS = Object.freeze({
  ALL_CATEGORIES_ABSENT: "all_sensitive_categories_absent",
});
export const SOURCE_DISPLAY_SENSITIVITY_FIELDS = Object.freeze([
  ...Object.keys(HIGH_RISK_SENSITIVITY_FIELDS).filter((key) => key !== "reviewed_small_cell_risk_status"),
  "reviewed_story_testimonial_status",
  "reviewed_small_cell_risk_status",
]);
// P2-06 attaches its ordinary basis to its result data under this key: not
// enumerable, so every exact-key DTO contract, projection and JSON body is
// unchanged. { basis, reliedOn } or absent (not the internal audience).
export const ORDINARY_INTERNAL_AUTHORITY = Symbol("kai.ordinaryInternalAuthority");

export function attachOrdinaryInternalAuthority(data, authority) {
  Object.defineProperty(data, ORDINARY_INTERNAL_AUTHORITY, { value: Object.freeze({ ...authority }), enumerable: false });
  return data;
}

export function ordinaryInternalAuthorityOf(data) {
  return data?.[ORDINARY_INTERNAL_AUTHORITY] ?? null;
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
    categories: Object.fromEntries(SOURCE_DISPLAY_SENSITIVITY_FIELDS.map((field) => [field, decision[field] ?? null])),
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

/**
 * Measurement-to-claim factual integrity (owner Package 1, 2026-11-10): the
 * one rule, independent of review, eligibility and audience, that a claim on
 * measurement evidence asserts exactly what its calculation established. The
 * stored measurement must still match its basis (a record count: its
 * human-confirmed definition, arithmetic and bound profile; a derived
 * measurement: its interpretation and arithmetic), and the claim must be the
 * 'finding' that is exactly the current composition of that measurement.
 * A record-count claim composed before the repair asserted the person's unit
 * label and period as the counted entity and an applied period; it is not the
 * current composition, so it fails here however it was reviewed. Nothing is
 * rewritten: the stored claim, evidence and review decisions are unchanged.
 *
 * Returns { applies, reason, measurementRow }: applies is false for evidence
 * that is not a measurement; reason is null, "measurement_definition_not_confirmed"
 * or "claim_not_measurement_restatement". claimRow is optional (evidence only).
 * Read-only.
 */
export async function evaluateMeasuredClaimIntegrityInTransaction(tx, {
  organizationId, evidenceItemRow, locatorRow, sourceVersionRow, claimRow = null,
}) {
  const restates = (statement) => !claimRow || (
    claimRow.claim_type === "finding"
    && claimRow.evidence_item_id === evidenceItemRow.evidence_item_id
    && claimRow.statement === statement
  );
  if (evidenceItemRow?.evidence_type === DERIVED_MEASUREMENT_EVIDENCE_TYPE) {
    const derivedRow = await getScopedDerivedMeasurementByEvidenceItemId({ organizationId, evidenceItemId: evidenceItemRow.evidence_item_id }, tx);
    if (!validateDerivedMeasurementClaimBasis({ evidenceItemRow, locatorRow, sourceVersionRow, measurementRow: derivedRow }).ok) {
      return { applies: true, reason: "measurement_definition_not_confirmed", measurementRow: null };
    }
    return { applies: true, reason: restates(composeDerivedClaimStatementFromRow(derivedRow)) ? null : "claim_not_measurement_restatement", measurementRow: null };
  }
  if (evidenceItemRow?.evidence_type !== MEASUREMENT_EVIDENCE_TYPE) return { applies: false, reason: null, measurementRow: null };
  const measurementRow = await getScopedEvidenceMeasurementByEvidenceItemId({ organizationId, evidenceItemId: evidenceItemRow.evidence_item_id }, tx);
  if (!isConfirmedMeasurement(measurementRow, evidenceItemRow)
    || !validateMeasurementClaimBasis({ evidenceItemRow, locatorRow, sourceVersionRow, measurementRow }).ok) {
    return { applies: true, reason: "measurement_definition_not_confirmed", measurementRow };
  }
  const composed = composeMeasurementClaimStatement({
    measurementRow,
    definitionRow: measurementRow,
    locatorCoordinates: locatorRow?.coordinates ?? null,
  });
  return { applies: true, reason: restates(composed) ? null : "claim_not_measurement_restatement", measurementRow };
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
  if (evidenceItemRow?.evidence_type === DERIVED_MEASUREMENT_EVIDENCE_TYPE) {
    // Measurement MVP: a source-derived measurement is ordinary on the same
    // terms - its arithmetic still matches its basis under its current
    // interpretation, and the claim restates exactly that measurement.
    // Source story presence has no role in this decision.
    const derivedRow = await getScopedDerivedMeasurementByEvidenceItemId({ organizationId, evidenceItemId: evidenceItemRow.evidence_item_id }, tx);
    const integrity = await evaluateMeasuredClaimIntegrityInTransaction(tx, {
      organizationId, evidenceItemRow, locatorRow, sourceVersionRow, claimRow,
    });
    if (integrity.reason) reasons.push(integrity.reason);
    source = await classifySourceVersionInTransaction(tx, { organizationId, sourceVersionId: evidenceItemRow.source_version_id });
    reasons.push(...source.getKinderReviewReasons, ...source.blockedReasons);
    // A cross-source measurement is ordinary only when every version it
    // combines is: the reference version's recorded categories count too.
    for (const linked of (derivedRow?.contributing_sources || []).filter((entry) => entry.source_role === "reference")) {
      const reference = await classifySourceVersionInTransaction(tx, { organizationId, sourceVersionId: linked.source_version_id });
      reasons.push(...reference.getKinderReviewReasons, ...reference.blockedReasons);
    }
    const ordered = orderedReasons(reasons);
    const basis = ordered.length === 0 ? ORDINARY_AUTHORITY_BASIS.ALL_CATEGORIES_ABSENT : null;
    return {
      ordinary: ordered.length === 0,
      reasons: ordered,
      basis,
      measurementRow: null,
      sourcePermissions: { is_current: source.isCurrent, recorded: source.recorded },
    };
  }
  if (!evidenceItemRow || evidenceItemRow.evidence_type !== MEASUREMENT_EVIDENCE_TYPE) {
    reasons.push("evidence_type_not_measurement");
  } else {
    const integrity = await evaluateMeasuredClaimIntegrityInTransaction(tx, {
      organizationId, evidenceItemRow, locatorRow, sourceVersionRow, claimRow,
    });
    measurementRow = integrity.measurementRow;
    if (integrity.reason) reasons.push(integrity.reason);
    source = await classifySourceVersionInTransaction(tx, { organizationId, sourceVersionId: evidenceItemRow.source_version_id });
    reasons.push(...source.getKinderReviewReasons, ...source.blockedReasons);
  }
  const ordered = orderedReasons(reasons);
  const basis = ordered.length === 0 ? ORDINARY_AUTHORITY_BASIS.ALL_CATEGORIES_ABSENT : null;
  return {
    ordinary: ordered.length === 0,
    reasons: ordered,
    basis,
    measurementRow,
    sourcePermissions: source ? { is_current: source.isCurrent, recorded: source.recorded } : null,
  };
}

/**
 * Provisional internal use (owner direction 2026-11-06, draft first): an
 * internal provisional draft or evaluation does not wait for review, coverage
 * acceptance or final-use eligibility. Two facts still exclude a claim from
 * it, and neither is a new review: a recorded human review that found the
 * claim or its evidence unsupported, and a measurement that no longer matches
 * its own basis.
 */
const PROVISIONAL_REJECTED_STRENGTH = "reviewed_not_supported";

// A P2-06 result (data) whose recorded review rejected the claim or its
// evidence. Absent or unresolved review is not a rejection. Pure.
export function traceabilityRecordsReviewRejection(data) {
  return data?.claim?.claim_strength === PROVISIONAL_REJECTED_STRENGTH
    || data?.evidence?.support_strength === PROVISIONAL_REJECTED_STRENGTH
    || data?.claim_review_decision?.decision_outcome === "rejected"
    || data?.evidence_review_decision?.decision_outcome === "not_supported";
}

const MEASUREMENT_INTEGRITY_REASONS = new Set([
  "measurement_definition_not_confirmed",
  "claim_not_measurement_restatement",
]);

// Factual integrity of the claim's measurement, independent of review: the
// stored measurement still matches its basis (definition or interpretation
// and arithmetic) and the claim restates exactly that measurement. Evidence
// that is not a measurement has none to check. Read-only.
export async function measuredFactIntegrityHoldsInTransaction(tx, { organizationId, claimId, evidenceItemId }) {
  const evidenceItemRow = await getScopedEvidenceItemById({ organizationId, evidenceItemId }, tx);
  if (!evidenceItemRow) return false;
  if (evidenceItemRow.evidence_type !== MEASUREMENT_EVIDENCE_TYPE && evidenceItemRow.evidence_type !== DERIVED_MEASUREMENT_EVIDENCE_TYPE) return true;
  const locatorRow = await getScopedSourceLocatorById({ organizationId, sourceLocatorId: evidenceItemRow.source_locator_id }, tx);
  const sourceVersionRow = await getScopedSourceVersionById({ organizationId, sourceVersionId: evidenceItemRow.source_version_id }, tx);
  const claimRow = await getScopedClaimById({ organizationId, claimId }, tx);
  if (!locatorRow || !sourceVersionRow || !claimRow) return false;
  const authority = await evaluateOrdinaryMeasurementAuthorityInTransaction(tx, {
    organizationId, evidenceItemRow, locatorRow, sourceVersionRow, claimRow,
  });
  return !authority.reasons.some((reason) => MEASUREMENT_INTEGRITY_REASONS.has(reason));
}

// Whether a P2-06 result admits its claim to INTERNAL provisional use now:
// eligible, or (internal only) not rejected by a recorded review and with an
// intact measurement. Funder and public use keep requiring eligibility.
export async function admitsProvisionalInternalUseInTransaction(tx, { organizationId, requestedAudience, data }) {
  if (data?.eligible === true) return true;
  if (requestedAudience !== "internal" || traceabilityRecordsReviewRejection(data)) return false;
  return measuredFactIntegrityHoldsInTransaction(tx, {
    organizationId, claimId: data?.claim?.claim_id, evidenceItemId: data?.evidence?.evidence_item_id,
  });
}
