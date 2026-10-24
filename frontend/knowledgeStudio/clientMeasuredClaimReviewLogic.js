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
    decisionOutcome: dto?.decision_outcome ?? null,
    decidedBy: dto?.decided_by ?? null,
    organizationMayDecide: dto?.organization_may_decide === true,
    getKinderReviewReasons: asArray(dto?.get_kinder_review_reasons),
    blockedReasons: asArray(dto?.blocked_reasons),
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
  };
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

export function measuredClaimReviewStepLabel(step) {
  if (step.kind === "evidence") {
    return {
      supported: "Evidence review: the count is supported by the source",
      not_supported: "Evidence review: the count is not supported by the source",
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
  story_testimonial_not_cleared: "The source may contain stories or testimonials; Get Kinder reviews it.",
  small_cell_risk_not_cleared: "The source may carry small-number re-identification risk; Get Kinder reviews it.",
  get_kinder_decision_recorded: "Get Kinder has already recorded this decision; only Get Kinder can change it.",
  limitation_requires_get_kinder_review: "Get Kinder reviews this limitation.",
  source_version_not_current: "The source version is no longer current, so it cannot be reviewed now.",
  processing_permission_not_established: "The source's allowed use or AI processing is not permitted, so it cannot be reviewed now.",
  factual_review_not_supported: "Limitations can be accepted only after the measurement and claim are reviewed as supported.",
});

export function reviewReasonText(reason) {
  return REASON_TEXT[reason] || reason;
}

const BLOCKER_TEXT = Object.freeze({
  evidence_review_unresolved: "The evidence review is not complete.",
  claim_review_unresolved: "The claim review is not complete.",
  support_strength_unassessed: "The measurement or claim is not reviewed as supported.",
  coverage_dimension_unresolved: "A coverage limitation is unresolved and not accepted.",
  client_followup_unresolved: "A client follow-up is unresolved.",
  potential_conflict_review_unresolved: "A potential conflict is unresolved.",
  traceability_incomplete: "Traceability is incomplete.",
});

export function eligibilityBlockerText(code) {
  return BLOCKER_TEXT[code] || code.replace(/_/g, " ");
}

export function measuredClaimReviewFailureMessage(step, result) {
  const reasons = asArray(result?.body?.blockers).map((blocker) => blocker?.blocking_reason).filter(Boolean);
  const detail = reasons.length > 0 ? reasons.map(reviewReasonText).join(" ") : errorText(result);
  return `${measuredClaimReviewStepLabel(step)} was not recorded. ${detail}`;
}
