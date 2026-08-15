export const LIBRARY_AUDIENCES = Object.freeze(["internal", "funder", "public"]);
export const BASE_PATH = "/api/kai/sprint2/intake";

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

export function generatedDraftReviewPacketPath(organizationId, generatedContentDraftId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/generated-content-drafts/${encodeURIComponent(generatedContentDraftId)}/review-packet`;
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
  })).filter((claim) => typeof claim.claimId === "string" && claim.requestedAudience === dto?.requestedAudience);
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
  })).filter((claim) => typeof claim.claimId === "string");
}

export function mergeClaims(usableClaims, candidateClaims) {
  const byId = new Map();
  for (const claim of candidateClaims) byId.set(claim.claimId, claim);
  for (const claim of usableClaims) byId.set(claim.claimId, { ...byId.get(claim.claimId), ...claim });
  return [...byId.values()].sort((a, b) => a.claimId.localeCompare(b.claimId));
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
