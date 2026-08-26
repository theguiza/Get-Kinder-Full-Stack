export const LIBRARY_AUDIENCES = Object.freeze(["internal", "funder", "public"]);
export const BASE_PATH = "/api/kai/sprint2/intake";
const ROUTE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isRouteUuid(value) {
  return typeof value === "string" && ROUTE_UUID_PATTERN.test(value);
}

export function eligibleClaimsPath(organizationId, audience) {
  const params = new URLSearchParams({ requested_audience: audience, limit: "25" });
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/eligible-claims?${params.toString()}`;
}

export function claimLibraryCandidatesPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/claim-library/candidates?limit=25`;
}

export function claimTraceabilityPath(organizationId, claimId, audience) {
  const params = new URLSearchParams({ requested_audience: audience });
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/claims/${encodeURIComponent(claimId)}/traceability?${params.toString()}`;
}

export function createEvidenceSummaryPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/generated-content-drafts/evidence-summary`;
}

export function createImpactNarrativePath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/generated-content-drafts/impact-narrative`;
}

export function generatedDraftLibraryIndexPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/generated-content-drafts?limit=25`;
}

export function generatedDraftReviewPacketPath(organizationId, generatedContentDraftId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/generated-content-drafts/${encodeURIComponent(generatedContentDraftId)}/review-packet`;
}

export function evidenceExtractionPath(organizationId, sourceVersionId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/source-versions/${encodeURIComponent(sourceVersionId)}/evidence-extraction`;
}

export function evidenceCoverageAssessmentPath(organizationId, sourceVersionId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/source-versions/${encodeURIComponent(sourceVersionId)}/evidence-coverage-assessment`;
}

export function claimProposalPath(organizationId, evidenceItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/evidence-items/${encodeURIComponent(evidenceItemId)}/claim-proposal`;
}

export function claimGapFollowupsPath(organizationId, claimId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/claims/${encodeURIComponent(claimId)}/claim-gap-followups`;
}

export function potentialConflictsPath(organizationId, firstClaimId, secondClaimId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/claims/${encodeURIComponent(firstClaimId)}/potential-conflicts/${encodeURIComponent(secondClaimId)}`;
}

export function coverageInternalAcceptancePath(organizationId, claimId, dimensionKey) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/claims/${encodeURIComponent(claimId)}/coverage-dimensions/${encodeURIComponent(dimensionKey)}/internal-acceptance`;
}

export function evidenceReviewCompletePath(organizationId, evidenceItemId, reviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/evidence-items/${encodeURIComponent(evidenceItemId)}/evidence-review/${encodeURIComponent(reviewQueueItemId)}/complete`;
}

export function claimReviewCompletePath(organizationId, claimId, reviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/claims/${encodeURIComponent(claimId)}/claim-review/${encodeURIComponent(reviewQueueItemId)}/complete`;
}

export function canCompleteEvidenceReview(evidence) {
  return Boolean(evidence) && evidence.review_queue_status === "open" && evidence.review_status === "needs_gk_review";
}

export function canCompleteClaimReview(evidence, claimReview) {
  return (
    Boolean(claimReview)
    && evidence?.review_status === "resolved"
    && claimReview.queue_status === "open"
    && claimReview.review_status === "needs_gk_review"
  );
}

export const COVERAGE_DIMENSION_KEYS = Object.freeze([
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

export function generatedContentReviewStartPath(organizationId, generatedContentDraftId, reviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/generated-content-drafts/${encodeURIComponent(generatedContentDraftId)}`
    + `/generated-content-review-queue/${encodeURIComponent(reviewQueueItemId)}/start`;
}

export function generatedContentReviewCompletePath(organizationId, generatedContentDraftId, reviewQueueItemId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/generated-content-drafts/${encodeURIComponent(generatedContentDraftId)}`
    + `/generated-content-review-queue/${encodeURIComponent(reviewQueueItemId)}/complete`;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function getJson(path) {
  const response = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return { statusCode: response.status, body: await readJson(response) };
}

export async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { statusCode: response.status, body: await readJson(response) };
}

export function reviewTransitionBody(expectedUpdatedAt) {
  return { expected_updated_at: expectedUpdatedAt };
}

export function errorText(result) {
  return result?.body?.error?.message || `Request failed (${result?.statusCode ?? "unknown"}).`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function projectEligibleClaims(dto) {
  return asArray(dto?.eligibleClaims).map((claim) => ({
    claimId: claim.claimId,
    evidenceItemId: claim.evidenceItemId,
    claimType: claim.claimType,
    claimStatus: claim.claimStatus,
    claimReviewStatus: claim.claimReviewStatus,
    supportStrength: claim.supportStrength,
    sourceId: claim.sourceId,
    sourceVersionId: claim.sourceVersionId,
    requestedAudience: claim.requestedAudience,
    libraryStatus: "usable",
  })).filter((claim) => (
    isRouteUuid(claim.claimId)
    && isRouteUuid(claim.evidenceItemId)
    && claim.requestedAudience === dto?.requestedAudience
  ));
}

export function projectCandidateClaims(dto) {
  return asArray(dto?.items).map((claim) => ({
    claimId: claim.claimId,
    evidenceItemId: claim.evidenceItemId,
    claimType: claim.claimType,
    claimStatus: claim.claimStatus,
    claimReviewStatus: claim.claimReviewStatus,
    claimStrength: claim.claimStrength,
    reviewQueueItems: asArray(claim.reviewQueueItems).map((item) => ({
      reviewQueueItemId: item.review_queue_item_id,
      queueType: item.queue_type,
      targetObjectType: item.target_object_type,
      targetObjectId: item.target_object_id,
      queueStatus: item.queue_status,
      reviewStatus: item.review_status,
    })),
    libraryStatus: "needs_review",
  })).filter((claim) => isRouteUuid(claim.claimId) && isRouteUuid(claim.evidenceItemId));
}

export function mergeClaims(usableClaims, candidateClaims) {
  const byId = new Map();
  for (const claim of candidateClaims) byId.set(claim.claimId, claim);
  for (const claim of usableClaims) byId.set(claim.claimId, { ...byId.get(claim.claimId), ...claim });
  return [...byId.values()].sort((a, b) => a.claimId.localeCompare(b.claimId));
}

// Governed internal availability and audience eligibility are independent
// dimensions: a claim's presence in the all-state Claim Library (candidateClaims,
// from claim-library/candidates) is not derived from, and must not be gated by,
// whether it is also present in the audience-scoped eligible-claims response.
export function annotateGovernedAvailability(mergedClaims, candidateClaims, eligibleClaims, eligibleRequestState) {
  const candidateIds = new Set(candidateClaims.map((claim) => claim.claimId));
  const eligibleIds = new Set(eligibleClaims.map((claim) => claim.claimId));
  return mergedClaims.map((claim) => ({
    ...claim,
    governedAvailable: candidateIds.has(claim.claimId),
    audienceEligibility:
      eligibleRequestState !== "success"
        ? "eligibility_unavailable"
        : eligibleIds.has(claim.claimId) ? "eligible" : "not_eligible",
  }));
}

// Package 14-05: internal evidence-summary draft generation is gated on
// governed internal availability (presence in the all-state Claim Library),
// not on audience/use eligibility. A claim that is governed but currently
// ineligible for its audience may still be selected for INTERNAL generation;
// funder/public audiences may never select for generation regardless of
// governed availability. This function must not infer admission from
// libraryStatus, audienceEligibility, eligible, review status, support
// strength, blocker count, coverage state, or client-followup state.
export function canSelectClaimForInternalGeneration(claim, audience) {
  return audience === "internal" && claim?.governedAvailable === true;
}

// Organization change invalidates both the governed Claim Library and the
// audience-scoped eligibility dimension: every piece of organization-scoped
// state (including both loading flags) is reset here, in the transition
// itself, because no replacement request is automatically dispatched
// (the UX is click-to-load) and a stale response must not be relied on to
// restore a loading flag it no longer owns.
export function nextLibraryStateForOrganizationChange() {
  return {
    candidateClaims: [],
    eligibleClaims: [],
    candidateClaimsError: "",
    eligibleClaimsError: "",
    eligibleRequestState: "idle",
    loadingCandidateClaims: false,
    loadingEligibleClaims: false,
    selectedClaimId: "",
    selectedGenerationClaimIds: [],
    traceability: null,
    generatedDraftPacket: null,
  };
}

// Audience change invalidates only the audience-scoped eligibility
// dimension. The governed Claim Library (candidateClaims) is untouched:
// callers must not include it in the state they apply from this transition.
export function nextLibraryStateForAudienceChange() {
  return {
    eligibleClaims: [],
    eligibleClaimsError: "",
    eligibleRequestState: "idle",
    loadingEligibleClaims: false,
  };
}

// A Claim Library response may be applied only if it belongs to the
// generation and organization still current when it resolves.
export function shouldApplyCandidateResponse({
  requestGeneration,
  currentGeneration,
  requestOrganizationId,
  currentOrganizationId,
}) {
  return (
    requestGeneration === currentGeneration
    && requestOrganizationId === currentOrganizationId
  );
}

// An eligibility response may be applied only if it belongs to the
// generation, organization, AND audience still current when it resolves,
// so a late response from one audience can never be attached to another.
export function shouldApplyEligibilityResponse({
  requestGeneration,
  currentGeneration,
  requestOrganizationId,
  currentOrganizationId,
  requestAudience,
  currentAudience,
}) {
  return (
    requestGeneration === currentGeneration
    && requestOrganizationId === currentOrganizationId
    && requestAudience === currentAudience
  );
}

export function projectTraceability(dto) {
  if (!dto || typeof dto !== "object") return null;
  const dimensions = Object.entries(dto.dimensions || {}).map(([dimensionKey, value]) => ({
    dimensionKey,
    assessmentStatus: value?.assessment_status,
    validatorKey: value?.validator_key,
    internalLimitationAccepted: value?.internal_limitation_accepted === true,
    blocksRequestedAudience: value?.blocks_requested_audience === true,
    displayStatus:
      value?.assessment_status === "unresolved" && value?.internal_limitation_accepted === true
        ? "known_limitation"
        : value?.assessment_status,
  }));
  return {
    requestedAudience: dto.requestedAudience,
    eligible: dto.eligible === true,
    blockerCodes: asArray(dto.blockerCodes),
    affectedDimensionKeys: asArray(dto.affectedDimensionKeys),
    affectedObjectIds: asArray(dto.affectedObjectIds),
    audienceGates: dto.claim?.audience_gates || {},
    claim: dto.claim || null,
    evidence: dto.evidence || null,
    source: dto.source || null,
    sourceVersion: dto.source_version || null,
    locator: dto.locator || null,
    claimReview: dto.claim_review || null,
    dimensions,
    gapItems: asArray(dto.gap_items),
    clientFollowupWorkflows: asArray(dto.client_followup_workflows).map((item) => ({
      clientFollowupItemId: item.client_followup_item_id,
      gapLogItemId: item.gap_log_item_id,
      dimensionKey: item.dimension_key,
      workflowStatus: item.workflow_status,
      reviewStatus: item.review_status,
      reviewQueueItemId: item.review_queue_item_id,
      workflowDisposition: item.review_status === "resolved" ? "completed_workflow_obligation" : item.review_status,
    })),
    potentialConflictGroups: asArray(dto.potential_conflict_groups),
    libraryStatus: dto.eligible === true ? "usable" : (asArray(dto.blockerCodes).length ? "blocked" : "needs_review"),
    truncated: dto.truncated === true,
  };
}

export function projectCoverageAssessment(dto) {
  if (!dto || typeof dto !== "object") return null;
  return {
    sourceVersionId: dto.source_version_id,
    dataDictionaryId: dto.data_dictionary_id,
    profileChecksum: dto.profile_canonical_sha256,
    dimensions: Object.entries(dto.dimensions || {}).map(([dimensionKey, value]) => ({
      dimensionKey,
      assessmentStatus: value?.assessment_status,
      summary: JSON.stringify(value),
    })),
  };
}

export function projectGeneratedDraftPacket(dto) {
  if (!dto || typeof dto !== "object") return null;
  return {
    generatedContentDraftId: dto.generatedContentDraftId,
    contentType: dto.contentType,
    draftStatus: dto.draftStatus,
    requestedAudience: dto.requestedAudience,
    reviewQueueItemId: dto.reviewQueueItemId,
    queueStatus: dto.queueStatus,
    reviewStatus: dto.reviewStatus,
    reviewUpdatedAt: dto.reviewUpdatedAt,
    currentUseEligible: dto.currentUseEligible === true,
    blocks: asArray(dto.blocks).map((block) => ({
      ordinal: block?.ordinal,
      text: block?.text,
      citations: asArray(block?.citations).map((citation) => ({
        claimId: citation?.claimId,
        evidenceItemId: citation?.evidenceItemId,
        sourceId: citation?.sourceId,
        sourceVersionId: citation?.sourceVersionId,
        supportStrength: citation?.supportStrength,
        currentEligible: citation?.currentEligible === true,
      })),
    })),
  };
}

export function projectGeneratedDraftLibraryItems(dto) {
  return asArray(dto?.items).map((item) => ({
    generatedContentDraftId: item.generatedContentDraftId,
    contentType: item.contentType,
    requestedAudience: item.requestedAudience,
    draftStatus: item.draftStatus,
    reviewQueueItemId: item.reviewQueueItemId,
    queueStatus: item.queueStatus,
    reviewStatus: item.reviewStatus,
    createdAt: item.createdAt,
  })).filter((item) => typeof item.generatedContentDraftId === "string");
}

export function generatedDraftReviewLabel(queueStatus, reviewStatus) {
  const key = `${queueStatus}/${reviewStatus}`;
  if (key === "open/needs_gk_review") return "Needs review";
  if (key === "in_progress/needs_gk_review") return "In review";
  if (key === "resolved/resolved") return "Review completed";
  return "Unknown review state";
}

export function canStartGeneratedContentReview(packet) {
  return !!packet && packet.queueStatus === "open" && packet.reviewStatus === "needs_gk_review";
}

export function canCompleteGeneratedContentReview(packet) {
  return !!packet && packet.queueStatus === "in_progress" && packet.reviewStatus === "needs_gk_review";
}
