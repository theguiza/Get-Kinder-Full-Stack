import { listClaimLibraryCandidates } from "./kaiClaimLibraryService.js";
import { getClaimTraceabilitySummary } from "./kaiClaimTraceabilityService.js";

/**
 * Package 3C — derived, read-only Impact Intelligence over the existing
 * governed claim-library and claim-traceability seams. ImpactEvidenceView is
 * computed per call from their results; it has no table, id, or lifecycle of
 * its own, and every field it carries is passed through verbatim from the
 * governed result it was derived from, never recomputed into a stronger state.
 *
 * This module is the Package 3C derived ImpactEvidenceView reference
 * implementation: derived, read-only, and non-persisted. It is intentionally
 * not wired into the KAI runtime or tool surface — the existing Impact
 * Evidence Library surface already provides discovery/explanation over the
 * same governed underlying reads. Do not treat this module as a second
 * source of truth or as evidence of a live KAI tool path.
 */

function describeGovernedState(label, value) {
  if (value === null || value === undefined) return `${label} is not recorded.`;
  if (typeof value === "boolean") return `${label} is ${value}.`;
  if (Array.isArray(value)) {
    return value.length === 0
      ? `${label} has no recorded entries.`
      : `${label} is recorded as: ${value.join(", ")}.`;
  }
  return `${label} is recorded as "${value}".`;
}

function toImpactEvidenceViewFromCandidate(candidate) {
  return {
    kind: "impact_evidence_view",
    claimId: candidate.claimId,
    evidenceItemId: candidate.evidenceItemId,
    claimType: candidate.claimType,
    claimStatus: candidate.claimStatus,
    claimReviewStatus: candidate.claimReviewStatus,
    claimStrength: candidate.claimStrength,
    reviewQueueItems: candidate.reviewQueueItems,
  };
}

/**
 * Behavior 1 — "What impact evidence do we have?" Derived from
 * listClaimLibraryCandidates, which already enforces the feature gate,
 * mapped-human-actor check, role authorization, and tenant boundary.
 */
export async function listImpactEvidence(input = {}, dependencies = {}) {
  const listCandidates = dependencies.listClaimLibraryCandidates || listClaimLibraryCandidates;
  const result = await listCandidates(
    {
      organizationId: input.organizationId,
      limit: input.limit,
      afterClaimId: input.afterClaimId,
      actorContext: input.actorContext,
    },
    dependencies.claimLibraryServiceDependencies,
  );
  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      items: result.data.items.map(toImpactEvidenceViewFromCandidate),
      limit: result.data.limit,
      afterClaimId: result.data.afterClaimId,
      truncated: result.data.truncated,
      nextAfterClaimId: result.data.nextAfterClaimId,
    },
    error: null,
  };
}

function buildExplanationNarrative(data) {
  const lines = [
    describeGovernedState("Claim status", data.claim?.claim_status),
    describeGovernedState("Claim review status", data.claim?.claim_review_status),
    describeGovernedState("Claim strength", data.claim?.claim_strength),
    describeGovernedState("Evidence review status", data.evidence?.evidence_review_status),
    describeGovernedState("Support strength", data.evidence?.support_strength),
    describeGovernedState("Sensitivity level", data.evidence?.sensitivity_level),
    describeGovernedState(`Eligibility for the ${data.requestedAudience ?? "requested"} audience`, data.eligible),
  ];
  if (Array.isArray(data.blockerCodes) && data.blockerCodes.length > 0) {
    lines.push(describeGovernedState("Blocking reasons", data.blockerCodes));
  }
  return lines;
}

/**
 * Behavior 2 — "What does this evidence support or mean?" Derived from
 * getClaimTraceabilitySummary; every governed field is passed through
 * unchanged, the narrative only restates recorded values in prose.
 */
export async function explainImpactEvidence(input = {}, dependencies = {}) {
  const getSummary = dependencies.getClaimTraceabilitySummary || getClaimTraceabilitySummary;
  const result = await getSummary(
    {
      organizationId: input.organizationId,
      claimId: input.claimId,
      requestedAudience: input.requestedAudience,
      actorContext: input.actorContext,
    },
    dependencies.claimTraceabilityServiceDependencies,
  );
  if (!result.ok) return result;

  const data = result.data;
  return {
    ok: true,
    data: {
      kind: "impact_evidence_view",
      claim: data.claim,
      evidence: data.evidence,
      locator: data.locator,
      source: data.source,
      sourceVersion: data.source_version,
      claimReview: data.claim_review,
      candidate: data.candidate,
      promotionDecision: data.promotion_decision,
      dimensions: data.dimensions,
      gapItems: data.gap_items,
      clientFollowupWorkflows: data.client_followup_workflows,
      potentialConflictGroups: data.potential_conflict_groups,
      requestedAudience: data.requestedAudience,
      eligible: data.eligible,
      blockerCodes: data.blockerCodes,
      affectedDimensionKeys: data.affectedDimensionKeys,
      affectedObjectIds: data.affectedObjectIds,
      truncated: data.truncated,
      narrative: buildExplanationNarrative(data),
    },
    error: null,
  };
}

export const __impactIntelligenceServiceContract = Object.freeze({
  describeGovernedState,
});
