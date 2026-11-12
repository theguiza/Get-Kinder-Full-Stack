import {
  BASE_PATH,
  claimReviewCompletePath,
  claimReviewDecisionBody,
  coverageInternalAcceptancePath,
  errorText,
  evidenceReviewCompletePath,
  evidenceReviewDecisionBody,
} from "../impactEvidenceLibraryLogic.js";

/**
 * The organization administrator's factual review of an ordinary measured
 * claim (owner authorization 2026-10-24): the evidence factual review, the
 * internal claim review, and the internal acceptance of its supportable
 * coverage limitations. One judgment may record several decisions, each
 * through its own existing route, under the administrator's own identity;
 * the server admits every one separately. Nothing here approves anything by
 * itself, and every action comes from the server's own per-claim answer.
 */

export function organizationFactualReviewPath(organizationId, claimId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/claims/${encodeURIComponent(claimId)}/organization-factual-review`;
}

const POSITIVE_EVIDENCE = new Set(["supported", "supported_with_limitation"]);
const POSITIVE_CLAIM = new Set(["approved", "approved_with_limitation"]);
const NEGATIVE_EVIDENCE = "not_supported";
const NEGATIVE_CLAIM = "rejected";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function projectDecision(dto) {
  return {
    reviewQueueItemId: dto?.review_queue_item_id ?? null,
    expectedUpdatedAt: dto?.expected_updated_at ?? null,
    queueStatus: dto?.queue_status ?? null,
    reviewStatus: dto?.review_status ?? null,
    decisionOutcome: dto?.decision_outcome ?? null,
    decidedBy: dto?.decided_by ?? null,
    organizationMayDecide: dto?.organization_may_decide === true,
    getKinderReviewReasons: asArray(dto?.get_kinder_review_reasons),
    blockedReasons: asArray(dto?.blocked_reasons),
  };
}

// The paired baseline/follow-up outcome the server persisted and returned as
// derived_measurement (record-count measurements stay in `measurement`).
// Exactly the served fields; nothing is recalculated here.
function projectDerivedMeasurement(derived) {
  if (!derived || typeof derived !== "object") return null;
  const interpretation = derived.interpretation && typeof derived.interpretation === "object"
    ? {
      interpretationId: derived.interpretation.interpretation_id ?? null,
      indicatorLabel: derived.interpretation.indicator_label ?? null,
      meaningText: derived.interpretation.meaning_text ?? null,
      scoreDirection: derived.interpretation.score_direction ?? "not_established",
      evidenceBasis: derived.interpretation.evidence_basis ?? "not_established",
    }
    : null;
  return {
    measurementType: derived.measurement_type ?? null,
    sourceDerivedMeasurementId: derived.source_derived_measurement_id ?? null,
    evidenceItemId: derived.evidence_item_id ?? null,
    sourceVersionId: derived.source_version_id ?? null,
    isCurrent: derived.is_current === true,
    worksheetKey: derived.worksheet_key ?? null,
    outcomeFieldKey: derived.outcome_field_key ?? null,
    calculationMethod: derived.calculation_method ?? null,
    numerator: derived.numerator ?? null,
    denominator: derived.denominator ?? null,
    percentage: derived.percentage ?? null,
    increasedCount: derived.increased_count ?? null,
    unchangedCount: derived.unchanged_count ?? null,
    decreasedCount: derived.decreased_count ?? null,
    participantCount: derived.participant_count ?? null,
    comparablePairCount: derived.comparable_pair_count ?? null,
    excludedParticipantCount: derived.excluded_participant_count ?? null,
    exclusions: {
      participants: asArray(derived.exclusions?.participants).map((row) => ({ reason: row.reason, participantCount: row.participant_count })),
      rows: asArray(derived.exclusions?.rows).map((row) => ({ reason: row.reason, rowCount: row.row_count })),
    },
    interpretation,
    // The server's own value: "not_established" unless a current interpretation states one.
    scoreDirection: derived.score_direction ?? interpretation?.scoreDirection ?? "not_established",
    reportingPeriod: derived.reporting_period ?? null,
  };
}

export function projectOrganizationFactualReview(dto) {
  return {
    claimId: dto?.claim_id ?? null,
    evidenceItemId: dto?.evidence_item_id ?? null,
    claimStatement: dto?.claim_statement ?? "",
    evidenceStatement: dto?.evidence_statement ?? "",
    source: {
      sourceCode: dto?.source?.source_code ?? null,
      isCurrent: dto?.source?.is_current === true,
    },
    measurement: dto?.measurement
      ? {
        calculationMethod: dto.measurement.calculation_method ?? null,
        worksheetKey: dto.measurement.worksheet_key ?? null,
        worksheetName: dto.measurement.worksheet_name ?? null,
        measuredValue: dto.measurement.measured_value,
        unitLabel: dto.measurement.unit_label,
        countedUnit: dto.measurement.counted_unit,
        totalRecordCount: dto.measurement.total_record_count,
        blankRecordCount: dto.measurement.blank_record_count,
        duplicateRecordCount: dto.measurement.duplicate_record_count,
        periodStart: dto.measurement.period_start,
        periodEnd: dto.measurement.period_end,
        definitionText: dto.measurement.definition_text,
        inclusionRule: dto.measurement.inclusion_rule,
        exclusionRule: dto.measurement.exclusion_rule,
      }
      : null,
    derivedMeasurement: projectDerivedMeasurement(dto?.derived_measurement),
    limitations: asArray(dto?.limitations).map((row) => ({ code: row.code, description: row.description || row.code })),
    evidenceReview: projectDecision(dto?.evidence_review),
    claimReview: projectDecision(dto?.claim_review),
    coverageLimitations: asArray(dto?.coverage_limitations).map((row) => ({
      dimensionKey: row.dimension_key,
      assessmentStatus: row.assessment_status,
      internalLimitationAccepted: row.internal_limitation_accepted === true,
      organizationAcceptable: row.organization_acceptable === true,
      organizationMayAccept: row.organization_may_accept === true,
    })),
    internalEligibility: {
      eligible: dto?.internal_eligibility?.eligible === true,
      blockerCodes: asArray(dto?.internal_eligibility?.blocker_codes),
    },
    ordinaryRule: {
      applies: dto?.ordinary_internal_rule?.applies === true,
      reasons: asArray(dto?.ordinary_internal_rule?.reasons),
      countOnly: false,
      numericalOnly: false,
    },
    sourcePermissions: {
      isCurrent: dto?.source_permissions?.is_current === true,
      sensitivityReviewComplete: dto?.source_permissions?.sensitivity_review_complete === true,
      allowedUseStatus: dto?.source_permissions?.allowed_use_status ?? null,
      aiProcessingAllowed: dto?.source_permissions?.ai_processing_allowed === true,
      categories: dto?.source_permissions?.categories && typeof dto.source_permissions.categories === "object"
        ? { ...dto.source_permissions.categories }
        : null,
    },
    reviewRequirement: dto?.review_requirement
      ? { responsibleRole: dto.review_requirement.responsible_role ?? null, outstanding: asArray(dto.review_requirement.outstanding) }
      : null,
    viewer: dto?.viewer ?? null,
  };
}

// The counted worksheet as the organization knows it: its safe name and
// stable key, or null for a CSV or single-worksheet count without one.
export function measurementWorksheetText(measurement) {
  if (!measurement?.worksheetKey) return null;
  return measurement.worksheetName ? `${measurement.worksheetName} (${measurement.worksheetKey})` : measurement.worksheetKey;
}

const CALCULATION_METHOD_TEXT = Object.freeze({
  p1_csv_profile_data_records_excluding_blank_v1: "CSV data records after the header row, blank records excluded",
  p1_xlsx_single_worksheet_data_rows_excluding_blank_v1: "data rows after the header row of the only worksheet, blank rows excluded",
  p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1: "data rows after the header row of the one selected worksheet, blank rows excluded; worksheets are never combined",
  p1_xlsx_paired_baseline_followup_numeric_change_v1: "each participant's baseline value compared with the same participant's follow-up value in one worksheet; participants without a comparable pair are excluded and counted",
});

export function calculationMethodText(calculationMethod) {
  return CALCULATION_METHOD_TEXT[calculationMethod] || calculationMethod || "not recorded";
}

// Each Operating Model section 7.2 category, with what its recorded value
// means. 'unknown' (not answered) is never presented as 'present'.
export const SENSITIVITY_CATEGORY_LABELS = Object.freeze({
  reviewed_personal_data_status: "Personal information",
  reviewed_minor_data_status: "Information about minors",
  reviewed_health_housing_justice_immigration_status: "Health, housing, justice or immigration information",
  reviewed_indigenous_governance_status: "Indigenous or governance-sensitive information",
  reviewed_story_testimonial_status: "Stories or testimonials",
  reviewed_small_cell_risk_status: "Small-number (small-cell) re-identification risk",
});

const RECORDED_CATEGORY_VALUE_TEXT = Object.freeze({
  present: "recorded as present",
  unknown: "not determined (recorded as unknown)",
  absent: "recorded as absent",
});

export function recordedCategoryText(field, value) {
  return `${SENSITIVITY_CATEGORY_LABELS[field] || field}: ${RECORDED_CATEGORY_VALUE_TEXT[value] || "no value recorded"}`;
}

// The recorded source values that take the claim outside the ordinary rule,
// as recorded - never inferred from a warning.
export function ordinaryRuleConditions(review) {
  const permissions = review.sourcePermissions;
  const conditions = [];
  if (!permissions.isCurrent) conditions.push("The source version is not current.");
  if (!permissions.sensitivityReviewComplete) {
    conditions.push("The source has no completed sensitivity & allowed-use review.");
    return conditions;
  }
  if (permissions.allowedUseStatus !== "allowed") conditions.push(`Allowed use is recorded as ${permissions.allowedUseStatus || "not set"}.`);
  if (!permissions.aiProcessingAllowed) conditions.push("AI processing is recorded as not permitted.");
  for (const [field, value] of Object.entries(permissions.categories || {})) {
    if (field !== "reviewed_story_testimonial_status" && value !== "absent") conditions.push(`${recordedCategoryText(field, value)}.`);
  }
  return conditions;
}

const OUTSTANDING_STEP_TEXT = Object.freeze({
  evidence_review: "evidence review",
  claim_review: "claim review",
  coverage_acceptance: "acceptance of unresolved coverage limitations",
  client_followup: "a client follow-up answer",
  conflict_review: "a conflict review",
});

const RESPONSIBLE_ROLE_TEXT = Object.freeze({ gk_reviewer: "a Get Kinder reviewer (gk_reviewer)" });

// Who must act next, and on what, from the server's review requirement.
export function reviewRequirementText(requirement) {
  if (!requirement) return null;
  const steps = requirement.outstanding.map((step) => OUTSTANDING_STEP_TEXT[step] || step.replace(/_/g, " "));
  const who = RESPONSIBLE_ROLE_TEXT[requirement.responsibleRole] || null;
  if (who) return `Get Kinder review required. Responsible: ${who}.${steps.length ? ` Outstanding: ${steps.join("; ")}.` : ""}`;
  return steps.length ? `Outstanding before internal use: ${steps.join("; ")}.` : null;
}

// The review queue state of one lineage, as recorded.
export function reviewQueueStateText(decision) {
  if (!decision.queueStatus && !decision.reviewStatus) return "no review item";
  return `${(decision.queueStatus || "unknown").replace(/_/g, " ")} / ${(decision.reviewStatus || "unknown").replace(/_/g, " ")}`;
}

/**
 * The decisions one judgment records, in order: the evidence review, then
 * the claim review (which requires a terminal evidence review), then each
 * coverage acceptance (which requires both). A decision already recorded
 * with the same meaning is not repeated. "supported" accepts only the
 * limitations the server reports the organization may accept once the
 * measurement is supported; "not_supported" records the negative evidence
 * and claim decisions; "needs_more_information" records only the evidence
 * decision, so the claim cannot be reviewed until it is answered.
 */
export function measuredClaimReviewPlan(review, judgment) {
  const steps = [];
  const evidence = review.evidenceReview;
  const claim = review.claimReview;
  // Owner decision 2026-10-25: an ordinary measurement that is already
  // eligible for internal use needs no confirmation, so none is offered.
  // Reporting a problem (not supported, needs more information) still is.
  if (judgment === "supported" && review.internalEligibility?.eligible === true) return steps;
  if (judgment === "supported") {
    if (evidence.organizationMayDecide && !POSITIVE_EVIDENCE.has(evidence.decisionOutcome)) {
      steps.push({ kind: "evidence", decision: "supported" });
    }
    const evidenceSupported = POSITIVE_EVIDENCE.has(evidence.decisionOutcome) || steps.length === 1;
    if (evidenceSupported && claim.organizationMayDecide && !POSITIVE_CLAIM.has(claim.decisionOutcome)) {
      steps.push({ kind: "claim", decision: "approved", approvedAudiences: ["internal"] });
    }
    const claimSupported = POSITIVE_CLAIM.has(claim.decisionOutcome) || steps.some((step) => step.kind === "claim");
    if (evidenceSupported && claimSupported) {
      for (const limitation of review.coverageLimitations) {
        if (limitation.organizationAcceptable) steps.push({ kind: "coverage", dimensionKey: limitation.dimensionKey });
      }
    }
    return steps;
  }
  if (judgment === "not_supported") {
    if (evidence.organizationMayDecide && evidence.decisionOutcome !== NEGATIVE_EVIDENCE) {
      steps.push({ kind: "evidence", decision: NEGATIVE_EVIDENCE });
    }
    const evidenceDecided = evidence.decisionOutcome === NEGATIVE_EVIDENCE || POSITIVE_EVIDENCE.has(evidence.decisionOutcome) || steps.length === 1;
    if (evidenceDecided && claim.organizationMayDecide && claim.decisionOutcome !== NEGATIVE_CLAIM) {
      steps.push({ kind: "claim", decision: NEGATIVE_CLAIM });
    }
    return steps;
  }
  if (judgment === "needs_more_information") {
    if (evidence.organizationMayDecide && evidence.decisionOutcome !== "needs_more_information") {
      steps.push({ kind: "evidence", decision: "needs_more_information" });
    }
    return steps;
  }
  return steps;
}

// The request one plan step sends. Pure.
export function measuredClaimReviewRequest(organizationId, review, step) {
  if (step.kind === "evidence") {
    return {
      path: evidenceReviewCompletePath(organizationId, review.evidenceItemId, review.evidenceReview.reviewQueueItemId),
      body: evidenceReviewDecisionBody({ expectedUpdatedAt: review.evidenceReview.expectedUpdatedAt, decision: step.decision }),
    };
  }
  if (step.kind === "claim") {
    return {
      path: claimReviewCompletePath(organizationId, review.claimId, review.claimReview.reviewQueueItemId),
      body: claimReviewDecisionBody({
        expectedUpdatedAt: review.claimReview.expectedUpdatedAt,
        decision: step.decision,
        approvedAudiences: step.approvedAudiences,
      }),
    };
  }
  return { path: coverageInternalAcceptancePath(organizationId, review.claimId, step.dimensionKey), body: {} };
}

export const COVERAGE_DIMENSION_LABELS = Object.freeze({
  missingness: "Missing values",
  duplicates: "Duplicate records",
  definition_clarity: "Record definition",
  denominator_clarity: "Denominator",
  time_period_clarity: "Reporting period",
  entity_level_clarity: "What is counted",
  small_cell_risk: "Small-number (small-cell) risk",
  conflicting_source_indicators: "Conflicting sources",
  requirement_alignment: "Alignment with funder requirements",
  coverage_gaps: "Field coverage",
});

// What the review is about, in the panel's wording: a record count, or the
// result of a derived (paired baseline/follow-up) measurement.
export function measurementReviewNoun(review) {
  return review?.derivedMeasurement ? "result" : "count";
}

export function measuredClaimReviewStepLabel(step, noun = "count") {
  if (step.kind === "evidence") {
    return {
      supported: `Evidence review: the ${noun} is supported by the source`,
      not_supported: `Evidence review: the ${noun} is not supported by the source`,
      needs_more_information: "Evidence review: more information is needed",
    }[step.decision];
  }
  if (step.kind === "claim") {
    return step.decision === "approved"
      ? "Claim review: approved for internal use only"
      : "Claim review: rejected";
  }
  return `Limitation accepted for internal use only (not resolved): ${COVERAGE_DIMENSION_LABELS[step.dimensionKey] || step.dimensionKey}`;
}

const DECIDED_BY_TEXT = Object.freeze({ organization: "your organization", get_kinder: "Get Kinder" });

export function decisionStateText(decision) {
  if (!decision.decisionOutcome) return "Not yet reviewed";
  return `${decision.decisionOutcome.replace(/_/g, " ")} (recorded by ${DECIDED_BY_TEXT[decision.decidedBy] || "a reviewer"})`;
}

const REASON_TEXT = Object.freeze({
  evidence_type_requires_get_kinder_review: "Only a record-count measurement can be reviewed here; Get Kinder reviews other evidence.",
  measurement_definition_not_confirmed: "The measurement has no confirmed definition for this source version; Get Kinder reviews it.",
  sensitivity_review_not_complete: "The source's sensitivity review is not complete; Get Kinder reviews it.",
  personal_information_not_cleared: "The source may contain personal information; Get Kinder reviews it.",
  minor_information_not_cleared: "The source may contain information about minors; Get Kinder reviews it.",
  sensitive_information_not_cleared: "The source may contain health, housing, justice or immigration information; Get Kinder reviews it.",
  indigenous_governance_not_cleared: "The source may contain Indigenous or governance-sensitive information; Get Kinder reviews it.",
  small_cell_risk_not_cleared: "The source may carry small-number re-identification risk; Get Kinder reviews it.",
  get_kinder_decision_recorded: "Get Kinder has already recorded this decision; only Get Kinder can change it.",
  limitation_requires_get_kinder_review: "Get Kinder reviews this limitation.",
  source_version_not_current: "The source version is no longer current, so it cannot be reviewed now.",
  processing_permission_not_established: "The source's allowed use or AI processing is not permitted, so it cannot be reviewed now.",
  factual_review_not_supported: "Limitations can be accepted only after the measurement and claim are reviewed as supported.",
});

// The same reason, worded for a derived (paired baseline/follow-up) result:
// viewing it, recording its meaning and recording its review are different
// things, and only the review decisions are Get Kinder's. Codes and server
// authorization are unchanged.
const DERIVED_REASON_TEXT = Object.freeze({
  evidence_type_requires_get_kinder_review: "You can view this result here, and your organization's administrator can record what it measures; "
    + "recording a meaning is not a review. The evidence and claim review decisions for this kind of measurement are recorded by Get Kinder, "
    + "not by your organization.",
});

export function reviewReasonText(reason, { derived = false } = {}) {
  return (derived && DERIVED_REASON_TEXT[reason]) || REASON_TEXT[reason] || reason;
}

const BLOCKER_TEXT = Object.freeze({
  evidence_review_unresolved: "The evidence review is not complete.",
  claim_review_unresolved: "The claim review is not complete.",
  support_strength_unassessed: "The measurement or claim is not reviewed as supported.",
  coverage_dimension_unresolved: "A coverage limitation is unresolved and not accepted.",
  client_followup_unresolved: "A client follow-up is unresolved.",
  potential_conflict_review_unresolved: "A potential conflict is unresolved.",
  traceability_incomplete: "Traceability is incomplete.",
  measured_claim_integrity_not_established: "The claim states more than its measurement established, so no review makes it usable.",
});

export function eligibilityBlockerText(code) {
  return BLOCKER_TEXT[code] || code.replace(/_/g, " ");
}

export function measuredClaimReviewFailureMessage(step, result, noun = "count") {
  const reasons = asArray(result?.body?.blockers).map((blocker) => blocker?.blocking_reason).filter(Boolean);
  const detail = reasons.length > 0 ? reasons.map((reason) => reviewReasonText(reason)).join(" ") : errorText(result);
  return `${measuredClaimReviewStepLabel(step, noun)} was not recorded. ${detail}`;
}

const PAIRED_EXCLUSION_TEXT = Object.freeze({
  no_baseline_observation: "with no baseline observation",
  no_followup_observation: "with no follow-up observation",
  instrument_version_mismatch: "whose baseline and follow-up used different instrument versions",
  missing_baseline_value: "with a missing baseline value",
  missing_followup_value: "with a missing follow-up value",
});
const PAIRED_ROW_EXCLUSION_TEXT = Object.freeze({
  blank_participant_identifier: "without a participant identifier",
});

function exclusionReasonText(table, reason) {
  return table[reason] || `excluded as ${String(reason || "not comparable").replace(/_/g, " ")}`;
}

const DIRECTION_TEXT = Object.freeze({
  higher_is_better: (who) => `${who} states that a higher value is better.`,
  lower_is_better: (who) => `${who} states that a lower value is better.`,
});
const BASIS_TEXT = Object.freeze({
  self_reported: "The values are self-reported by the people recorded and were not independently verified.",
  organization_record: "The values are the organization's own records and were not independently verified.",
});

/**
 * The customer-facing reading of one paired baseline/follow-up outcome, from
 * the persisted values only (never recalculated). "Higher" is never called
 * improved and "lower" never worsened unless a current recorded
 * interpretation states the direction, and then only as the organization's
 * statement. The internal worksheet and column keys are source details, not
 * the heading. `audience` "organization" addresses the administrator as
 * "your organization"; any other value (Get Kinder) says "the organization".
 */
export function pairedOutcomeReviewText(derived, { audience = "organization" } = {}) {
  const own = audience === "organization";
  const who = own ? "Your organization" : "The organization";
  const whose = own ? "your organization" : "the organization";
  const interpretation = derived.interpretation;
  const label = typeof interpretation?.indicatorLabel === "string" && interpretation.indicatorLabel.trim() ? interpretation.indicatorLabel.trim() : null;
  const known = (value) => Number.isInteger(value);
  const result = [derived.comparablePairCount, derived.increasedCount, derived.unchangedCount, derived.decreasedCount].every(known)
    ? `Among ${derived.comparablePairCount} participants with comparable baseline and follow-up values, ${derived.increasedCount}`
      + `${derived.percentage ? ` (${derived.percentage}%)` : ""} had a higher follow-up value, ${derived.unchangedCount} were unchanged`
      + ` and ${derived.decreasedCount} had a lower follow-up value.`
    : "The paired result is not available.";
  const breakdown = [
    ...derived.exclusions.participants.filter((row) => known(row.participantCount) && row.participantCount > 0)
      .map((row) => `${row.participantCount} ${exclusionReasonText(PAIRED_EXCLUSION_TEXT, row.reason)}`),
    ...derived.exclusions.rows.filter((row) => known(row.rowCount) && row.rowCount > 0)
      .map((row) => `${row.rowCount} ${row.rowCount === 1 ? "record" : "records"} ${exclusionReasonText(PAIRED_ROW_EXCLUSION_TEXT, row.reason)}`),
  ];
  const population = known(derived.excludedParticipantCount) && known(derived.participantCount)
    ? `${derived.excludedParticipantCount} of ${derived.participantCount} participants were excluded because they had no comparable baseline and follow-up pair`
      + `${breakdown.length ? `: ${breakdown.join("; ")}` : ""}. The result covers the ${derived.comparablePairCount ?? "comparable"} comparable participants only, not everyone served.`
    : "The result covers only participants with a comparable baseline and follow-up value, not everyone served.";
  const meaning = [];
  if (!interpretation) {
    meaning.push(`What this measures has not been recorded: ${whose} has not stated what these values represent or whether a higher value is better.`);
    meaning.push("Whether these changes indicate improvement depends on that statement, so a higher value is not presented as an improvement and a lower value is not presented as a decline.");
  } else {
    meaning.push(`What this measures, as stated by ${whose} (not verified by KAI): ${interpretation.meaningText || "no description recorded."}`);
    meaning.push(DIRECTION_TEXT[derived.scoreDirection]?.(who)
      || "Whether a higher value is better has not been stated, so a higher follow-up value is not presented as a better result.");
    meaning.push(BASIS_TEXT[interpretation.evidenceBasis] || "Where the values come from has not been stated.");
  }
  return {
    heading: label || "Paired baseline/follow-up outcome",
    subheading: label ? "Paired baseline/follow-up outcome" : null,
    meaningRecorded: Boolean(interpretation),
    result,
    population,
    meaning,
    // Only the "no period" state is served today; a period is never assumed from the Project.
    period: derived.reportingPeriod
      ? "A reporting period is recorded for this measurement."
      : "No reporting period was applied to this measurement; the Project's reporting period is not assumed.",
    method: `Method: ${calculationMethodText(derived.calculationMethod)}.`,
    currentness: derived.isCurrent ? "Calculated from the current source version." : "Not calculated from the current source version.",
    sourceDetails: [
      derived.worksheetKey ? `Worksheet key: ${derived.worksheetKey}` : null,
      derived.outcomeFieldKey ? `Outcome column key: ${derived.outcomeFieldKey}` : null,
      derived.sourceVersionId ? `Source version: ${derived.sourceVersionId}` : null,
      derived.evidenceItemId ? `Evidence item: ${derived.evidenceItemId}` : null,
    ].filter(Boolean),
  };
}
