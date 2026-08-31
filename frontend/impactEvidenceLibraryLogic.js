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

// The server (postgresHumanReviewRepository.js, updateReviewQueueCompareAndSet)
// targets open/needs_gk_review for any non-terminal decision outcome
// (needs_more_information) -- this is how a previously-resolved review is
// "reopened": it lands back in exactly this same open/needs_gk_review state,
// not a distinct one. So a review that is outstanding for the first time and
// a review that is outstanding again after being reopened are already the
// same, single observable state here; no separate reopened state exists to
// gate on.
function isReviewOutstanding(queueStatus, reviewStatus) {
  return queueStatus === "open" && reviewStatus === "needs_gk_review";
}

export function canCompleteEvidenceReview(evidence) {
  return Boolean(evidence) && isReviewOutstanding(evidence.review_queue_status, evidence.review_status);
}

export function canCompleteClaimReview(evidence, claimReview) {
  return (
    Boolean(claimReview)
    && evidence?.review_status === "resolved"
    && isReviewOutstanding(claimReview.queue_status, claimReview.review_status)
  );
}

export const EVIDENCE_REVIEW_DECISIONS = Object.freeze([
  "supported",
  "supported_with_limitation",
  "not_supported",
  "needs_more_information",
]);

export const CLAIM_REVIEW_DECISIONS = Object.freeze([
  "approved",
  "approved_with_limitation",
  "rejected",
  "needs_more_information",
]);

export const APPROVED_AUDIENCE_VALUES = Object.freeze(["internal", "funder", "public"]);

export function decisionRequiresLimitationNotes(decision) {
  return decision === "supported_with_limitation" || decision === "approved_with_limitation";
}

export function decisionRequiresApprovedAudiences(decision) {
  return decision === "approved" || decision === "approved_with_limitation";
}

// Splits a free-text textarea's contents into one array entry per non-blank
// line, trimmed. This is the "clean" limitation-notes array the server
// requires: non-empty array of non-empty strings.
export function cleanLimitationNotes(rawText) {
  return String(rawText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Builds the evidence-review decision POST body. `limitation_notes` is
// included only when the decision requires it - never sent as null/empty
// for any other decision, since the server rejects the key entirely
// (`unexpected_limitation_notes`) when it isn't applicable.
export function evidenceReviewDecisionBody({ expectedUpdatedAt, decision, limitationNotes }) {
  const body = { expected_updated_at: expectedUpdatedAt, decision };
  if (decisionRequiresLimitationNotes(decision)) {
    body.limitation_notes = cleanLimitationNotes(limitationNotes);
  }
  return body;
}

// Builds the claim-review decision POST body. `limitation_notes` and
// `approved_audiences` are each included only when the chosen decision
// requires them, per the same omit-unless-applicable rule as above.
export function claimReviewDecisionBody({ expectedUpdatedAt, decision, limitationNotes, approvedAudiences }) {
  const body = { expected_updated_at: expectedUpdatedAt, decision };
  if (decisionRequiresLimitationNotes(decision)) {
    body.limitation_notes = cleanLimitationNotes(limitationNotes);
  }
  if (decisionRequiresApprovedAudiences(decision)) {
    body.approved_audiences = Array.isArray(approvedAudiences) ? [...approvedAudiences] : [];
  }
  return body;
}

// Client-side defense in depth only - the server independently validates the
// same rules. Returns "" when the decision's required fields are satisfied,
// or a short human-readable reason otherwise.
export function evidenceReviewDecisionValidationError({ decision, limitationNotes }) {
  if (!EVIDENCE_REVIEW_DECISIONS.includes(decision)) return "Select an evidence review decision.";
  if (decisionRequiresLimitationNotes(decision) && cleanLimitationNotes(limitationNotes).length === 0) {
    return "Enter at least one limitation note.";
  }
  return "";
}

export function claimReviewDecisionValidationError({ decision, limitationNotes, approvedAudiences }) {
  if (!CLAIM_REVIEW_DECISIONS.includes(decision)) return "Select a claim review decision.";
  if (decisionRequiresLimitationNotes(decision) && cleanLimitationNotes(limitationNotes).length === 0) {
    return "Enter at least one limitation note.";
  }
  if (decisionRequiresApprovedAudiences(decision) && (!Array.isArray(approvedAudiences) || approvedAudiences.length === 0)) {
    return "Select at least one approved audience.";
  }
  return "";
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

// KAI B1A-3B: Phase-5 sensitivity/consent/allowed-use review, reusing the
// existing B1A-2/B1A-2R review-cockpit backend authority as-is. These three
// routes take `organization_id` as a QUERY STRING parameter (the review-
// cockpit sub-tree's own convention), unlike every other path builder above
// (which embeds organizationId as a path segment) - this is a deliberate
// mismatch inherited from the reused backend, not an inconsistency to "fix".
const REVIEW_COCKPIT_BASE_PATH = `${BASE_PATH}/admin/review-cockpit`;

export function sensitivityCapabilitiesPath(organizationId) {
  const params = new URLSearchParams({ organization_id: organizationId });
  return `${REVIEW_COCKPIT_BASE_PATH}/capabilities?${params.toString()}`;
}

export function sensitivityProfilePath(organizationId, intakeSensitivityProfileId) {
  const params = new URLSearchParams({ organization_id: organizationId });
  return `${REVIEW_COCKPIT_BASE_PATH}/sensitivity-profiles/${encodeURIComponent(intakeSensitivityProfileId)}?${params.toString()}`;
}

export function sensitivityReviewWorkPath(organizationId, intakeSensitivityProfileId) {
  const params = new URLSearchParams({ organization_id: organizationId });
  return `${REVIEW_COCKPIT_BASE_PATH}/sensitivity-profiles/${encodeURIComponent(intakeSensitivityProfileId)}/review-work?${params.toString()}`;
}

export function sensitivityDecisionPath(organizationId, intakeSensitivityProfileId) {
  const params = new URLSearchParams({ organization_id: organizationId });
  return `${REVIEW_COCKPIT_BASE_PATH}/sensitivity-profiles/${encodeURIComponent(intakeSensitivityProfileId)}/decision?${params.toString()}`;
}

// KAI B1A-3B-R1: pre-claim reachability. This is the SAME organization-scoped,
// same-capability-gated review-cockpit queue the admin cockpit already lists
// (queue_type='sensitivity_review'), reused as-is so an authorized reviewer can
// discover a P1-05 sensitivity profile that needs review directly from
// /impact-library - with no claim, no claim traceability, no evidence item, and
// no source promotion required. `target_object_id` on a 'sensitivity_review' /
// 'intake_sensitivity_profile' row IS the server-grounded intake_sensitivity_profile_id;
// the browser never derives or fabricates it.
export function sensitivityReviewQueuePath(organizationId) {
  const params = new URLSearchParams({
    organization_id: organizationId,
    queue_type: "sensitivity_review",
    queue_status: "open",
  });
  return `${REVIEW_COCKPIT_BASE_PATH}/queue?${params.toString()}`;
}

export function projectSensitivityReviewQueueItems(dto) {
  return asArray(dto?.items)
    .filter((item) => item?.queue_type === "sensitivity_review" && item?.target_object_type === "intake_sensitivity_profile")
    .map((item) => ({
      reviewQueueItemId: item.review_queue_item_id,
      intakeSensitivityProfileId: item.target_object_id,
      queueStatus: item.queue_status,
      summary: item.summary,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }))
    .filter((item) => isRouteUuid(item.reviewQueueItemId) && isRouteUuid(item.intakeSensitivityProfileId));
}

// The nine presence dimensions (unknown|present|absent), in the exact backend
// field-name order - used to render the form and to validate a submitted
// snapshot carries exactly these keys, with zero risk of name drift from the
// backend contract (sensitivityAllowedUseDecisionContract.js).
export const SENSITIVITY_PRESENCE_FIELDS = Object.freeze([
  "reviewed_personal_data_status",
  "reviewed_minor_data_status",
  "reviewed_health_housing_justice_immigration_status",
  "reviewed_indigenous_governance_status",
  "reviewed_staff_notes_status",
  "reviewed_story_testimonial_status",
  "reviewed_small_cell_risk_status",
  "reviewed_financial_records_status",
  "reviewed_consent_basis_status",
]);

export const SENSITIVITY_ALLOWED_USE_FIELD = "reviewed_allowed_use_status";

export const SENSITIVITY_PERMISSION_FIELDS = Object.freeze([
  "reviewed_llm_processing_allowed",
  "reviewed_product_learning_allowed",
  "reviewed_public_use_allowed",
  "reviewed_funder_use_allowed",
]);

export const SENSITIVITY_PRESENCE_VALUES = Object.freeze(["unknown", "present", "absent"]);
export const SENSITIVITY_ALLOWED_USE_VALUES = Object.freeze(["unknown", "allowed", "not_allowed"]);

export const SENSITIVITY_DECISION_OUTCOMES = Object.freeze(["reviewed", "needs_more_information"]);

// The internal-only default: every presence dimension and the allowed-use
// status start at "unknown" (never coerced to "absent"/"safe"), and every
// permission starts false. A reviewer must positively choose each value.
export function defaultSensitivityReviewFormState() {
  const state = { [SENSITIVITY_ALLOWED_USE_FIELD]: "unknown" };
  for (const field of SENSITIVITY_PRESENCE_FIELDS) state[field] = "unknown";
  for (const field of SENSITIVITY_PERMISSION_FIELDS) state[field] = false;
  return state;
}

// Client-side defense in depth only, mirroring (never replacing) the
// server's fail-closed VAL-KAI-B1A-02-001 rule: llm/product-learning/funder
// permission may only be enabled once allowed-use is explicitly "allowed".
export function restrictedPermissionEligible(formState) {
  return formState?.[SENSITIVITY_ALLOWED_USE_FIELD] === "allowed";
}

// Client-side defense in depth only, mirroring (never replacing) the
// server's fail-closed VAL-KAI-B1A-02-002 rule: public use additionally
// requires an explicitly present consent basis AND an explicitly absent
// Indigenous/governance-sensitive status. "unknown" never satisfies either.
export function publicUseAllowedEligible(formState) {
  return (
    restrictedPermissionEligible(formState)
    && formState?.reviewed_consent_basis_status === "present"
    && formState?.reviewed_indigenous_governance_status === "absent"
  );
}

// Builds the exact 14-key reviewed_snapshot object a "reviewed" decision
// requires - nothing added, nothing omitted, and every permission the
// client-side gate would disable is force-cleared to false so an invalid
// combination can never be sent even if a disabled control's stale value
// lingers in form state.
export function buildReviewedSnapshotBody(formState) {
  const snapshot = {};
  for (const field of SENSITIVITY_PRESENCE_FIELDS) snapshot[field] = formState?.[field] ?? "unknown";
  snapshot[SENSITIVITY_ALLOWED_USE_FIELD] = formState?.[SENSITIVITY_ALLOWED_USE_FIELD] ?? "unknown";
  const restrictedEligible = restrictedPermissionEligible(snapshot);
  const publicEligible = publicUseAllowedEligible(snapshot);
  snapshot.reviewed_llm_processing_allowed = restrictedEligible && formState?.reviewed_llm_processing_allowed === true;
  snapshot.reviewed_product_learning_allowed = restrictedEligible && formState?.reviewed_product_learning_allowed === true;
  snapshot.reviewed_funder_use_allowed = restrictedEligible && formState?.reviewed_funder_use_allowed === true;
  snapshot.reviewed_public_use_allowed = publicEligible && formState?.reviewed_public_use_allowed === true;
  return snapshot;
}

// Builds the POST decision request body. `reviewed_snapshot` is included only
// for a "reviewed" outcome - the server rejects it outright
// (unexpected_reviewed_snapshot) for needs_more_information.
export function buildSensitivityDecisionRequestBody({ decision, expectedUpdatedAt, reviewQueueItemId, formState }) {
  const body = {
    expected_updated_at: expectedUpdatedAt,
    review_queue_item_id: reviewQueueItemId,
    decision,
  };
  if (decision === "reviewed") {
    body.reviewed_snapshot = buildReviewedSnapshotBody(formState);
  }
  return body;
}

// Light projection of the GET sensitivity-profile detail response. Kept
// deliberately close to the raw shape (unlike projectTraceability's fuller
// reshaping) since every field name here already IS the reviewer-facing
// contract this component renders directly.
export function projectSensitivityDetail(dto) {
  if (!dto || typeof dto !== "object") return null;
  return {
    sensitivityPosture: dto.sensitivity_posture || null,
    allowedUseRestrictions: dto.allowed_use_restrictions || null,
    reviewQueueItem: dto.sensitivity_review_queue_item || null,
    currentDecision: dto.current_decision || null,
    decisionControlsEnabled: dto.decision_controls_enabled === true,
  };
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
    // KAI B1A-3B: intake_sensitivity_profile_id is server-grounded here - the
    // browser never manufactures it. null when the traceability DTO carries
    // no candidate object at all (should not happen for a valid response,
    // but this component must never fabricate an id if it did).
    candidate: dto.candidate || null,
    evidence: dto.evidence || null,
    source: dto.source || null,
    sourceVersion: dto.source_version || null,
    locator: dto.locator || null,
    claimReview: dto.claim_review || null,
    evidenceReviewDecision: dto.evidence_review_decision
      ? {
          decisionId: dto.evidence_review_decision.decision_id,
          decisionOutcome: dto.evidence_review_decision.decision_outcome,
        }
      : null,
    claimReviewDecision: dto.claim_review_decision
      ? {
          decisionId: dto.claim_review_decision.decision_id,
          decisionOutcome: dto.claim_review_decision.decision_outcome,
          approvedAudiences: asArray(dto.claim_review_decision.approved_audiences),
        }
      : null,
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
