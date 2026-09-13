import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LIBRARY_AUDIENCES,
  COVERAGE_DIMENSION_KEYS,
  APPROVED_AUDIENCE_VALUES,
  CLAIM_REVIEW_DECISIONS,
  EVIDENCE_REVIEW_DECISIONS,
  annotateGovernedAvailability,
  canSelectClaimForInternalGeneration,
  canSelectClaimForFunderGeneration,
  canCompleteClaimReview,
  canCompleteEvidenceReview,
  canCompleteGeneratedContentReview,
  canStartGeneratedContentReview,
  claimGapFollowupsPath,
  claimLibraryCandidatesPath,
  claimProposalPath,
  claimReviewCompletePath,
  claimReviewDecisionBody,
  claimReviewDecisionValidationError,
  claimTraceabilityPath,
  coverageInternalAcceptancePath,
  coverageFunderAcceptancePath,
  createEvidenceSummaryPath,
  createFunderEvidenceSummaryPath,
  createImpactNarrativePath,
  decisionRequiresApprovedAudiences,
  decisionRequiresLimitationNotes,
  eligibleClaimsPath,
  errorText,
  evidenceCoverageAssessmentPath,
  evidenceExtractionPath,
  evidenceReviewCompletePath,
  evidenceReviewDecisionBody,
  evidenceReviewDecisionValidationError,
  canRequestGeneratedDraftExportReview,
  EXPORT_REVIEW_DISPLAY_STATES,
  exportReviewRequestBody,
  exportReviewRequestPath,
  generatedDraftExportReviewDisplayState,
  gkExportReviewDetailPagePath,
  projectExportReviewRequestResult,
  generatedContentReviewCompletePath,
  generatedContentReviewStartPath,
  generatedDraftLibraryIndexPath,
  generatedDraftReviewLabel,
  generatedDraftReviewPacketPath,
  getJson,
  isRouteUuid,
  mergeClaims,
  nextLibraryStateForAudienceChange,
  nextLibraryStateForOrganizationChange,
  organizationRequirementAssessmentPath,
  organizationRequirementsReadinessPath,
  organizationReviewQueuePath,
  organizationSourcesPath,
  projectOrganizationSources,
  engagementFunderRequirementsPath,
  projectEngagementFunderRequirements,
  ENGAGEMENT_FUNDER_REQUIREMENTS_STATES,
  grantResponsePacketPath,
  grantResponsePacketMarkdownPath,
  grantResponsePacketExportCandidatesPath,
  grantResponsePacketExportReviewRequestPath,
  grantResponsePacketExportReviewStartPath,
  grantResponsePacketExportReviewCompletePath,
  grantResponsePacketExportReviewLifecycleState,
  GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES,
  grantResponsePacketHumanFinalReleaseAuthorityPath,
  grantResponsePacketHumanFinalReleaseAuthorityBody,
  grantResponsePacketFinalReleaseAuthorityControlState,
  GRANT_RESPONSE_PACKET_FINAL_RELEASE_AUTHORITY_CONTROL_STATES,
  grantResponsePacketExportManifestsPath,
  grantResponsePacketExportManifestMarkdownPath,
  hydrateGrantResponsePacketExportReviewReadModel,
  projectGrantResponsePacket,
  shouldApplyGrantResponsePacketResponse,
  boardReportingPacketPath,
  boardReportingCandidatesPath,
  boardReportingCreateCandidateIdempotencyKey,
  boardReportingCreateCandidateBody,
  boardReportingCandidatePath,
  boardReportingWorkflowStatePath,
  boardReportingReviewRequestPath,
  boardReportingReviewStartPath,
  boardReportingReviewCompletePath,
  boardReportingFinalReleaseAuthorityPath,
  boardReportingFinalReleaseAuthorityBody,
  boardReportingExportManifestsPath,
  boardReportingExportManifestMarkdownPath,
  shouldApplyBoardReportingResponse,
  projectBoardReportingPacket,
  projectBoardReportingCandidateResult,
  projectBoardReportingCandidateSnapshot,
  projectBoardReportingWorkflowState,
  boardReportingReviewLifecycleState,
  BOARD_REPORTING_REVIEW_LIFECYCLE_STATES,
  boardReportingFinalReleaseAuthorityControlState,
  BOARD_REPORTING_FINAL_RELEASE_AUTHORITY_CONTROL_STATES,
  boardReportingFinalSummaryFetchable,
  postJson,
  potentialConflictsPath,
  projectCandidateClaims,
  projectCoverageAssessment,
  projectEligibleClaims,
  projectGeneratedDraftLibraryItems,
  projectGeneratedDraftPacket,
  projectRequirementsReadiness,
  projectReviewQueue,
  projectReviewQueueCompleteness,
  projectOrganizationGapsAndRisks,
  organizationGapsAndRisksIsConclusivelyEmpty,
  reviewQueueIsComplete,
  reviewQueueIsConclusivelyEmpty,
  projectTraceability,
  reviewQueueBlockerActionability,
  seedClaimApprovedAudiencesFromDecision,
  sensitivityReviewQueueAttention,
  reviewTransitionBody,
  shouldApplyCandidateResponse,
  shouldApplyEligibilityResponse,
  sensitivityCapabilitiesPath,
  sensitivityProfilePath,
  sensitivityReviewWorkPath,
  sensitivityReviewQueuePath,
  sensitivityDecisionPath,
  projectSensitivityReviewQueueItems,
  SENSITIVITY_PRESENCE_FIELDS,
  SENSITIVITY_ALLOWED_USE_FIELD,
  SENSITIVITY_PERMISSION_FIELDS,
  SENSITIVITY_PRESENCE_VALUES,
  SENSITIVITY_ALLOWED_USE_VALUES,
  defaultSensitivityReviewFormState,
  restrictedPermissionEligible,
  publicUseAllowedEligible,
  buildSensitivityDecisionRequestBody,
  blockerDisplayText,
  projectSensitivityDetail,
} from "./impactEvidenceLibraryLogic.js";
import {
  exportManifestCsvPath,
  exportManifestDocxPath,
  exportManifestMarkdownPath,
  exportManifestPdfPath,
} from "./gkExportReviewDetailLogic.js";
import { organizationsPath } from "./kaiWebIntakeLogic.js";
import { engagementsPath } from "./kaiWebIntakeLogic.js";
import KaiWebIntake from "./KaiWebIntake.jsx";
import ImpactLibraryKai from "./ImpactLibraryKai.jsx";

function ValueRow({ label, value }) {
  return (
    <div className="d-flex justify-content-between gap-3 border-bottom py-2">
      <span className="text-muted small">{label}</span>
      <span className="small text-break text-end">{value ?? "none"}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const label = status === "usable" ? "usable" : status === "blocked" ? "blocked" : "needs review";
  const cls = status === "usable" ? "text-bg-success" : status === "blocked" ? "text-bg-danger" : "text-bg-warning";
  return <span className={`badge ${cls}`}>{label}</span>;
}

// Bounds the authoritative Grant Response Packet GET issued right after a
// successful post-mutation (create/request/start/complete) so a hung
// connection (a getJson call that never settles at all) cannot leave
// loading/pending state stuck true forever, matching the existing rejected-
// fetch handling for that same request.
const GRANT_RESPONSE_PACKET_REFETCH_TIMEOUT_MS = 15000;

const SENSITIVITY_FIELD_LABELS = Object.freeze({
  reviewed_personal_data_status: "Personal data",
  reviewed_minor_data_status: "Minor data",
  reviewed_health_housing_justice_immigration_status: "Health / housing / justice / immigration",
  reviewed_indigenous_governance_status: "Indigenous / governance-sensitive",
  reviewed_staff_notes_status: "Staff notes",
  reviewed_story_testimonial_status: "Story / testimonial",
  reviewed_small_cell_risk_status: "Small-cell risk",
  reviewed_financial_records_status: "Financial records",
  reviewed_consent_basis_status: "Consent basis",
});

export default function ImpactEvidenceLibrary() {
  const [organizations, setOrganizations] = useState([]);
  const [organizationId, setOrganizationId] = useState("");
  const [loadingOrganizations, setLoadingOrganizations] = useState(true);
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false);
  // Engagement selection for the governed Impact Library KAI surface: KAI
  // must never have to be told which organization/engagement it is
  // operating in, so this is lifted to page state (distinct from the
  // engagement selection embedded inside KaiWebIntake below) and passed to
  // ImpactLibraryKai as requested context re-authorized server-side.
  const [engagements, setEngagements] = useState([]);
  const [engagementId, setEngagementId] = useState("");
  const [loadingEngagements, setLoadingEngagements] = useState(false);
  const [engagementsLoaded, setEngagementsLoaded] = useState(false);
  const [audience, setAudience] = useState("internal");
  // The all-state governed Claim Library and the audience-scoped eligible-claims
  // result are independent requests with independent loading/data/error state:
  // a failure or empty result on one must never clear or gate the other.
  const [candidateClaims, setCandidateClaims] = useState([]);
  const [eligibleClaims, setEligibleClaims] = useState([]);
  const [loadingCandidateClaims, setLoadingCandidateClaims] = useState(false);
  const [loadingEligibleClaims, setLoadingEligibleClaims] = useState(false);
  const [candidateClaimsError, setCandidateClaimsError] = useState("");
  const [eligibleClaimsError, setEligibleClaimsError] = useState("");
  const [eligibleRequestState, setEligibleRequestState] = useState("idle");
  // Candidate (governed Claim Library) and eligibility (audience-scoped)
  // requests are invalidated independently: organization change invalidates
  // both, audience change invalidates eligibility only. See
  // nextLibraryStateForOrganizationChange / nextLibraryStateForAudienceChange.
  const candidateRequestGenerationRef = useRef(0);
  const eligibleRequestGenerationRef = useRef(0);
  const traceabilityPanelRef = useRef(null);
  const claimAudienceSeedIdentityRef = useRef("");
  const organizationIdRef = useRef(organizationId);
  const audienceRef = useRef(audience);
  organizationIdRef.current = organizationId;
  audienceRef.current = audience;
  const [selectedClaimId, setSelectedClaimId] = useState("");
  const [selectedGenerationClaimIds, setSelectedGenerationClaimIds] = useState([]);
  // P14-09: the funder Evidence Summary generation selection is a distinct
  // piece of state from the internal generation selection above - it is
  // gated by the stricter canSelectClaimForFunderGeneration admission rule
  // (governed AND currently funder-eligible), never by
  // canSelectClaimForInternalGeneration's "governed but not currently
  // eligible" internal semantics.
  const [selectedFunderGenerationClaimIds, setSelectedFunderGenerationClaimIds] = useState([]);
  const [generatedDraftPacket, setGeneratedDraftPacket] = useState(null);
  const [generatedDrafts, setGeneratedDrafts] = useState([]);
  const [selectedGeneratedDraftId, setSelectedGeneratedDraftId] = useState("");
  const [loadingGeneratedDrafts, setLoadingGeneratedDrafts] = useState(false);
  const [traceability, setTraceability] = useState(null);
  const [loadingTraceability, setLoadingTraceability] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [reviewTransitionPending, setReviewTransitionPending] = useState(false);
  // Website export/review UX successor: this is a client-side memo of the
  // gk_admin-only export-review-request result for the currently selected
  // draft only - never persisted, never treated as durable state, and
  // always reset whenever the selected draft (or organization) changes so
  // a stale link/blocker can never survive a draft switch.
  const [exportReviewRequestPending, setExportReviewRequestPending] = useState(false);
  const [exportReviewRequestResult, setExportReviewRequestResult] = useState(null);
  const [message, setMessage] = useState("");
  const [sourceVersionId, setSourceVersionId] = useState("");
  const [coverageAssessment, setCoverageAssessment] = useState(null);
  const [secondClaimId, setSecondClaimId] = useState("");
  const [coverageDimensionKey, setCoverageDimensionKey] = useState(COVERAGE_DIMENSION_KEYS[0]);
  const [workflowPending, setWorkflowPending] = useState(false);
  const [workflowResult, setWorkflowResult] = useState("");
  // Evidence-review and claim-review decision form state. Each review type
  // has its own independent decision/limitation-notes/audience selection so
  // switching claims never leaks one review's in-progress form into another.
  const [evidenceDecision, setEvidenceDecision] = useState("");
  const [evidenceLimitationNotesText, setEvidenceLimitationNotesText] = useState("");
  const [claimDecision, setClaimDecision] = useState("");
  const [claimLimitationNotesText, setClaimLimitationNotesText] = useState("");
  const [claimApprovedAudiences, setClaimApprovedAudiences] = useState([]);

  // KAI B1A-3B: Phase-5 sensitivity/consent/allowed-use review state,
  // independent of every other loading/error dimension on this page.
  // `sensitivityCapability` is `null` while unknown, otherwise the
  // server-grounded boolean answer to "can this actor manage sensitivity
  // review for this organization" - it is the ONLY thing that gates
  // fetching/showing the GK-only Phase-5 section below, never a hardcoded
  // role list and never an attempt-and-catch-403 probe.
  const [sensitivityCapability, setSensitivityCapability] = useState(null);
  // Request lifecycle for the capability fetch above, kept separate from
  // `sensitivityCapability` itself so a request failure (unknown answer) is
  // never conflated with a successful "false" answer (actor confirmed not
  // permitted) - both previously collapsed to sensitivityCapability===false.
  const [sensitivityCapabilityRequestState, setSensitivityCapabilityRequestState] = useState("idle");
  const [sensitivityDetail, setSensitivityDetail] = useState(null);
  const [sensitivityLoading, setSensitivityLoading] = useState(false);
  const [sensitivityError, setSensitivityError] = useState("");
  const [sensitivityActionPending, setSensitivityActionPending] = useState(false);
  const [sensitivityActionResult, setSensitivityActionResult] = useState("");
  const [sensitivityFormState, setSensitivityFormState] = useState(defaultSensitivityReviewFormState());

  // KAI B1A-3B-R1: pre-claim Phase-5 reachability. `selectedSensitivityProfileId`
  // is the ONE canonical selection feeding the single "Sensitivity & allowed-use
  // review" card below - it can be set either by picking a pre-claim item off
  // this organization-scoped review-queue list (no claim, no evidence, no
  // promoted source required) or, unchanged from before, by loading a claim's
  // traceability. Neither path fabricates the id: both come straight from a
  // server-grounded response.
  const [sensitivityReviewQueueItems, setSensitivityReviewQueueItems] = useState([]);
  const [loadingSensitivityReviewQueue, setLoadingSensitivityReviewQueue] = useState(false);
  const [sensitivityReviewQueueError, setSensitivityReviewQueueError] = useState("");
  const [selectedSensitivityProfileId, setSelectedSensitivityProfileId] = useState("");

  // Funder-requirement readiness rollup: one server-authoritative, read-only
  // snapshot of every requirement this organization is governed against.
  // `assessingRequirementId` names the one requirement currently mid-POST (if
  // any), so only that requirement's button shows a pending state - never the
  // whole list.
  const [requirementsReadiness, setRequirementsReadiness] = useState([]);
  const [loadingRequirementsReadiness, setLoadingRequirementsReadiness] = useState(false);
  const [requirementsReadinessError, setRequirementsReadinessError] = useState("");
  const [assessingRequirementId, setAssessingRequirementId] = useState("");

  // KAI Package 4: the engagement-aware Funder Requirements card. Entirely
  // separate from the generic KAI Baseline Readiness rollup above - this is
  // keyed by the selected engagement (engagementId), never by organization
  // alone, and is never populated from organizationRequirementsReadinessPath.
  // `funderRequirements` defaults to the empty/no-target shape so nothing is
  // shown before a fresh, engagement-scoped read completes.
  const [funderRequirements, setFunderRequirements] = useState({ state: null, target: {}, requirements: [] });
  const [loadingFunderRequirements, setLoadingFunderRequirements] = useState(false);
  const [funderRequirementsError, setFunderRequirementsError] = useState("");

  // Grant Response Packet: engagement-scoped, read-only regrouping of
  // already-governed funder-audience generated drafts (see
  // Backend/kai/services/kaiGrantResponsePacketService.js). Keyed by
  // organizationId + engagementId exactly like Funder Requirements above -
  // never populated from any per-draft/per-member fetch. `grantResponsePacketRequestState`
  // keeps "not yet requested"/"loading"/"error" distinct from a genuine,
  // successful zero-eligible-draft result, matching the review-queue/
  // eligibility request-state convention used elsewhere on this page.
  const [grantResponsePacket, setGrantResponsePacket] = useState(null);
  const [loadingGrantResponsePacket, setLoadingGrantResponsePacket] = useState(false);
  const [grantResponsePacketError, setGrantResponsePacketError] = useState("");
  const [grantResponsePacketRequestState, setGrantResponsePacketRequestState] = useState("idle");
  const [grantResponsePacketExportReviewRequestPendingDraftId, setGrantResponsePacketExportReviewRequestPendingDraftId] = useState("");
  // P14-04: the export-candidate workflow-wiring action on this same card.
  // Creating/reusing a candidate grants no approval, export authority, final
  // release, or manifest - this is a client-side memo of the last create/reuse
  // result for the currently selected engagement only, never persisted, and
  // always reset whenever the selected engagement (or organization) changes,
  // matching exportReviewRequestResult's discipline above.
  const [grantResponsePacketExportCandidatePending, setGrantResponsePacketExportCandidatePending] = useState(false);
  const [grantResponsePacketExportCandidateResult, setGrantResponsePacketExportCandidateResult] = useState(null);
  const [grantResponsePacketExportCandidateError, setGrantResponsePacketExportCandidateError] = useState("");
  // P14-05: the packet export-review-request action on this same card, acting
  // on the exact grantResponsePacketExportCandidateResult candidate id above
  // (never a latest/newest/preferred guess). Requesting review grants no
  // approval, export authority, final release, or manifest - same reset
  // discipline as the candidate state above.
  const [grantResponsePacketExportReviewPending, setGrantResponsePacketExportReviewPending] = useState(false);
  const [grantResponsePacketExportReviewResult, setGrantResponsePacketExportReviewResult] = useState(null);
  const [grantResponsePacketExportReviewError, setGrantResponsePacketExportReviewError] = useState("");
  // P14-06 closure: START/COMPLETE act on the exact
  // grantResponsePacketExportReviewResult identity above (candidate id,
  // review-queue-item id, current reviewUpdatedAt CAS token) - never a
  // latest/newest/preferred guess. Both write their success result back into
  // the SAME grantResponsePacketExportReviewResult slot (it is one review
  // resource progressing through its lifecycle, not three independent
  // results), so the lifecycle-state helper always sees the current
  // authoritative queueStatus/reviewStatus pair. Same reset discipline as
  // every other action on this card.
  const [grantResponsePacketExportReviewStartPending, setGrantResponsePacketExportReviewStartPending] = useState(false);
  const [grantResponsePacketExportReviewStartError, setGrantResponsePacketExportReviewStartError] = useState("");
  const [grantResponsePacketExportReviewCompletePending, setGrantResponsePacketExportReviewCompletePending] = useState(false);
  const [grantResponsePacketExportReviewCompleteError, setGrantResponsePacketExportReviewCompleteError] = useState("");
  // P14-07: governed human final-release authority grant/revoke for the
  // exact current grantResponsePacket candidate. Neither control ever trusts
  // its own POST response body as durable truth - both always refetch the
  // authoritative packet GET afterward (see
  // refetchGrantResponsePacketAfterMemberExportReviewRequest below) and
  // hydrate every displayed authority/eligibility field from that response.
  const [grantResponsePacketFinalReleaseAuthorityPending, setGrantResponsePacketFinalReleaseAuthorityPending] = useState(false);
  const [grantResponsePacketFinalReleaseAuthorityError, setGrantResponsePacketFinalReleaseAuthorityError] = useState("");
  // P14-08D: the governed FINAL Markdown export-manifest create/reuse control
  // for the exact current grantResponsePacket candidate. This never trusts
  // its own POST response body as durable truth - on success it always
  // refetches the authoritative packet GET (see
  // refetchGrantResponsePacketAfterMemberExportReviewRequest below) and every
  // rendered final manifest comes only from that GET's
  // finalDeliveryState.grantResponsePacketExportManifests.
  const [grantResponsePacketFinalMarkdownExportManifestPending, setGrantResponsePacketFinalMarkdownExportManifestPending] = useState(false);
  const [grantResponsePacketFinalMarkdownExportManifestError, setGrantResponsePacketFinalMarkdownExportManifestError] = useState("");
  const grantPacketRequestGenerationRef = useRef(0);
  const engagementIdRef = useRef(engagementId);
  engagementIdRef.current = engagementId;

  // Board Reporting: engagement-scoped, read-only regrouping of already-
  // governed internal-audience generated drafts (see
  // Backend/kai/services/kaiBoardReportingPacketService.js). Keyed by
  // organizationId + engagementId exactly like Grant Response Packet above.
  // Unlike Grant Response Packet, the packet GET carries NO prior candidate
  // id (see the module-header comment in impactEvidenceLibraryLogic.js) -
  // `boardReportingCandidateResult` below is the SOLE retained identity of
  // the exact candidate this browser has created/reused for the current
  // organization+engagement, set only from the create/reuse POST response
  // and cleared whenever the selected organization or engagement changes
  // (including a true fresh mount/hard reload). The auto-recovery effect
  // below createBoardReportingCandidate replays the existing, deterministic
  // create/reuse idempotency key exactly once per organization+engagement
  // selection to recover this exact identity after such a reset.
  const [boardReportingPacket, setBoardReportingPacket] = useState(null);
  const [loadingBoardReportingPacket, setLoadingBoardReportingPacket] = useState(false);
  const [boardReportingPacketError, setBoardReportingPacketError] = useState("");
  const [boardReportingPacketRequestState, setBoardReportingPacketRequestState] = useState("idle");
  // BR-02 candidate create/reuse - the SOLE source of the exact
  // boardReportingCandidateId every subsequent Board action below is scoped
  // to. Never persisted server-side as UI truth beyond this create/reuse
  // response; always reset whenever the selected engagement (or
  // organization) changes.
  const [boardReportingCandidatePending, setBoardReportingCandidatePending] = useState(false);
  const [boardReportingCandidateResult, setBoardReportingCandidateResult] = useState(null);
  const [boardReportingCandidateError, setBoardReportingCandidateError] = useState("");
  // The immutable member snapshot for the exact candidate above (BR-02 exact
  // candidate read) - read-only, never editable, never a recomputation of
  // current packet membership.
  const [boardReportingCandidateSnapshot, setBoardReportingCandidateSnapshot] = useState(null);
  const [loadingBoardReportingCandidateSnapshot, setLoadingBoardReportingCandidateSnapshot] = useState(false);
  const [boardReportingCandidateSnapshotError, setBoardReportingCandidateSnapshotError] = useState("");
  // The single authoritative workflow-state read for the exact candidate
  // above - review state, effective final-release authority, final
  // eligibility (with structured failedGates/blockers/currentnessGate), and
  // export-manifest history. Every review/authority/eligibility/manifest
  // control below renders ONLY from this state, never from a mutation's own
  // POST response body.
  const [boardReportingWorkflowState, setBoardReportingWorkflowState] = useState(null);
  const [loadingBoardReportingWorkflowState, setLoadingBoardReportingWorkflowState] = useState(false);
  const [boardReportingWorkflowStateError, setBoardReportingWorkflowStateError] = useState("");
  const [boardReportingWorkflowStateRequestState, setBoardReportingWorkflowStateRequestState] = useState("idle");
  const [boardReportingReviewRequestPending, setBoardReportingReviewRequestPending] = useState(false);
  const [boardReportingReviewRequestError, setBoardReportingReviewRequestError] = useState("");
  const [boardReportingReviewStartPending, setBoardReportingReviewStartPending] = useState(false);
  const [boardReportingReviewStartError, setBoardReportingReviewStartError] = useState("");
  const [boardReportingReviewCompletePending, setBoardReportingReviewCompletePending] = useState(false);
  const [boardReportingReviewCompleteError, setBoardReportingReviewCompleteError] = useState("");
  const [boardReportingFinalReleaseAuthorityPending, setBoardReportingFinalReleaseAuthorityPending] = useState(false);
  const [boardReportingFinalReleaseAuthorityError, setBoardReportingFinalReleaseAuthorityError] = useState("");
  const [boardReportingExportManifestPending, setBoardReportingExportManifestPending] = useState(false);
  const [boardReportingExportManifestError, setBoardReportingExportManifestError] = useState("");
  // The user's explicit pick among the current workflow-state's own
  // exportManifests list - never auto-selected first/last, always cleared on
  // engagement/organization change and whenever a fresh workflow-state read
  // no longer carries this exact manifest id.
  const [selectedBoardReportingExportManifestId, setSelectedBoardReportingExportManifestId] = useState("");
  // The FINAL Board Summary Markdown fetch/display state - visually and
  // structurally distinct from the live/preview workflow-state panel above
  // it. Fetched only once a manifest id has been explicitly selected.
  const [boardReportingFinalSummaryLoading, setBoardReportingFinalSummaryLoading] = useState(false);
  const [boardReportingFinalSummaryMarkdown, setBoardReportingFinalSummaryMarkdown] = useState(null);
  const [boardReportingFinalSummaryError, setBoardReportingFinalSummaryError] = useState("");
  const boardReportingPacketRequestGenerationRef = useRef(0);
  const boardReportingWorkflowStateRequestGenerationRef = useRef(0);
  // Guards the fresh-mount candidate auto-recovery effect below to exactly
  // one attempt per organizationId+engagementId selection - reset alongside
  // every other Board Reporting reset below, never re-armed by a pending/
  // error state change alone (which would otherwise retry on every render).
  const boardReportingCandidateAutoAttemptedRef = useRef(false);

  // Review Queue: organization-scope current-attention rollup. This is a
  // product PROJECTION of already-governed state (see
  // projectReviewQueue/reviewQueueBlockerActionability) - it never persists
  // anything of its own.
  const [reviewQueueItems, setReviewQueueItems] = useState([]);
  const [loadingReviewQueue, setLoadingReviewQueue] = useState(false);
  const [reviewQueueError, setReviewQueueError] = useState("");
  // Completeness of the rollup that produced reviewQueueItems above - see
  // projectReviewQueueCompleteness/reviewQueueIsComplete. Preserved
  // separately so an empty reviewQueueItems list is never displayed as a
  // conclusive "nothing needs attention" when the server-side scan was
  // truncated or some claims failed evaluation.
  const [reviewQueueCompleteness, setReviewQueueCompleteness] = useState({
    truncated: false,
    evaluationErrorCount: 0,
  });
  // Request lifecycle for the rollup fetch, independent of loadingReviewQueue/
  // reviewQueueError: this is what reviewQueueIsConclusivelyEmpty gates on so
  // that "idle" (never fetched) and "error" states can never be read as a
  // successful complete result just because reviewQueueCompleteness still
  // holds its default {truncated:false, evaluationErrorCount:0} value.
  const [reviewQueueRequestState, setReviewQueueRequestState] = useState("idle");

  // Data Sources: organization-scope browse/select of governed kai.sources +
  // kai.source_versions rows (never raw intake files or unpromoted
  // candidates - see projectOrganizationSources). Request lifecycle is
  // tracked the same way as Review Queue above, so loading/error/empty are
  // all explicit and distinct.
  const [organizationSources, setOrganizationSources] = useState([]);
  const [loadingOrganizationSources, setLoadingOrganizationSources] = useState(false);
  const [organizationSourcesError, setOrganizationSourcesError] = useState("");
  const [organizationSourcesRequestState, setOrganizationSourcesRequestState] = useState("idle");

  // Governed internal availability (the all-state Claim Library) and audience
  // eligibility are independent dimensions: neither request may clear, gate, or
  // invalidate the other's successful result. See annotateGovernedAvailability.
  const claims = useMemo(() => {
    const merged = mergeClaims(eligibleClaims, candidateClaims);
    return annotateGovernedAvailability(merged, candidateClaims, eligibleClaims, eligibleRequestState);
  }, [candidateClaims, eligibleClaims, eligibleRequestState]);

  // Review Queue composition: the sensitivity/allowed-use category reuses the
  // EXISTING Phase-5 capability/queue state already fetched above (see the
  // sensitivityCapabilitiesPath/sensitivityReviewQueuePath effects) - no
  // second fetch, no new authority, no duplicated mutation controls.
  const sensitivityAttention = useMemo(
    () =>
      sensitivityReviewQueueAttention({
        sensitivityCapability,
        loadingSensitivityReviewQueue,
        sensitivityReviewQueueError,
        sensitivityReviewQueueItems,
      }),
    [sensitivityCapability, loadingSensitivityReviewQueue, sensitivityReviewQueueError, sensitivityReviewQueueItems],
  );

  // Review Queue closure: the single pure authority for the organization-wide
  // "Nothing currently needs attention" assertion - true only when BOTH the
  // claim-attention rollup and the sensitivity/allowed-use rollup are
  // conclusively, successfully empty. See reviewQueueIsConclusivelyEmpty.
  const reviewQueueConclusivelyEmpty = useMemo(
    () =>
      reviewQueueIsConclusivelyEmpty({
        reviewQueueRequestState,
        reviewQueueCompleteness,
        reviewQueueItemsLength: reviewQueueItems.length,
        sensitivityCapabilityRequestState,
        sensitivityCapability,
        sensitivityAttentionStatus: sensitivityAttention.status,
        sensitivityAttentionItemsLength: sensitivityAttention.items.length,
      }),
    [
      reviewQueueRequestState,
      reviewQueueCompleteness,
      reviewQueueItems,
      sensitivityCapabilityRequestState,
      sensitivityCapability,
      sensitivityAttention,
    ],
  );

  // Capability B: organization-level Gaps and Risks. Derived entirely from
  // reviewQueueItems (already fetched by loadReviewQueue below) - no
  // additional request, no per-claim fan-out.
  const organizationGapsAndRisks = useMemo(
    () => projectOrganizationGapsAndRisks(reviewQueueItems),
    [reviewQueueItems],
  );

  const gapsAndRisksConclusivelyEmpty = useMemo(
    () =>
      organizationGapsAndRisksIsConclusivelyEmpty({
        reviewQueueRequestState,
        reviewQueueCompleteness,
        gapsAndRisks: organizationGapsAndRisks,
      }),
    [reviewQueueRequestState, reviewQueueCompleteness, organizationGapsAndRisks],
  );

  const selectedClaim = useMemo(
    () => claims.find((claim) => claim.claimId === selectedClaimId) || null,
    [claims, selectedClaimId],
  );

  // The browser never types or fabricates an organization id: it always
  // bootstraps from the same server-authoritative organizations list already
  // used by the KAI Web Intake and Review Cockpit panels.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingOrganizations(true);
      const result = await getJson(organizationsPath());
      if (cancelled) return;
      setLoadingOrganizations(false);
      setOrganizationsLoaded(true);
      if (result.statusCode !== 200 || !result.body?.ok) {
        setOrganizations([]);
        setMessage(errorText(result));
        return;
      }
      const items = result.body.data?.items || [];
      setOrganizations(items);
      if (items.length === 1) {
        setOrganizationId(items[0].organization_id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Changing organization must discard the previous organization's governed
  // Claim Library / eligibility state immediately, and must invalidate any
  // in-flight requests for the previous organization so a late response
  // cannot populate the newly selected organization's view.
  useEffect(() => {
    candidateRequestGenerationRef.current += 1;
    eligibleRequestGenerationRef.current += 1;
    const next = nextLibraryStateForOrganizationChange();
    setCandidateClaims(next.candidateClaims);
    setEligibleClaims(next.eligibleClaims);
    setCandidateClaimsError(next.candidateClaimsError);
    setEligibleClaimsError(next.eligibleClaimsError);
    setEligibleRequestState(next.eligibleRequestState);
    setLoadingCandidateClaims(next.loadingCandidateClaims);
    setLoadingEligibleClaims(next.loadingEligibleClaims);
    setSelectedClaimId(next.selectedClaimId);
    setSelectedGenerationClaimIds(next.selectedGenerationClaimIds);
    setSelectedFunderGenerationClaimIds([]);
    setTraceability(next.traceability);
    setGeneratedDraftPacket(next.generatedDraftPacket);
    setExportReviewRequestPending(false);
    setExportReviewRequestResult(null);
    setSensitivityCapability(null);
    setSensitivityCapabilityRequestState("idle");
    setSensitivityDetail(null);
    setSensitivityError("");
    setSensitivityActionResult("");
    setSensitivityReviewQueueItems([]);
    setSensitivityReviewQueueError("");
    setSelectedSensitivityProfileId("");
    setRequirementsReadiness([]);
    setRequirementsReadinessError("");
    setAssessingRequirementId("");
    setReviewQueueItems([]);
    setReviewQueueError("");
    setLoadingReviewQueue(false);
    setReviewQueueCompleteness({ truncated: false, evaluationErrorCount: 0 });
    setReviewQueueRequestState("idle");
  }, [organizationId]);

  // KAI B1A-3B authorization gate: fetch the server-grounded capability once
  // per organization selection, before anything else Phase-5-related can
  // happen. This is bootstrapped alongside organizations/engagements, not
  // derived from decision_controls_enabled (a feature flag, not an
  // authorization signal) and not inferred from any client-side role list.
  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    (async () => {
      setSensitivityCapabilityRequestState("loading");
      const result = await getJson(sensitivityCapabilitiesPath(organizationId));
      if (cancelled) return;
      if (result.statusCode !== 200 || !result.body?.ok) {
        setSensitivityCapability(false);
        setSensitivityCapabilityRequestState("error");
        return;
      }
      setSensitivityCapability(result.body.data?.can_manage_sensitivity_review === true);
      setSensitivityCapabilityRequestState("success");
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  // KAI B1A-3B-R1: the pre-claim entry point. Fetched only once the same
  // server-grounded capability check above has positively confirmed this actor
  // may manage sensitivity review (never `!== false`, so "still loading" never
  // fetches) - and independent of any claim selection, traceability, evidence
  // item, or source promotion. This is the organization-scoped review-cockpit
  // queue the admin cockpit already exposes, filtered to sensitivity_review
  // work, so a source's Phase-5 posture is discoverable without first having to
  // understand claim traceability.
  useEffect(() => {
    setSensitivityReviewQueueItems([]);
    setSensitivityReviewQueueError("");
    if (!organizationId || sensitivityCapability !== true) return;
    let cancelled = false;
    (async () => {
      setLoadingSensitivityReviewQueue(true);
      const result = await getJson(sensitivityReviewQueuePath(organizationId));
      if (cancelled) return;
      setLoadingSensitivityReviewQueue(false);
      if (result.statusCode !== 200 || !result.body?.ok) {
        setSensitivityReviewQueueItems([]);
        setSensitivityReviewQueueError(errorText(result));
        return;
      }
      setSensitivityReviewQueueItems(projectSensitivityReviewQueueItems(result.body.data));
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, sensitivityCapability]);

  // KAI B1A-3B-R2: the zero-queue pre-claim entry point. KaiWebIntake (the
  // same ordinary product intake/file workflow already embedded below)
  // reports the server-grounded P1-05 intake_sensitivity_profile_id for
  // whichever file its own file-detail GET last resolved, through the
  // explicit opt-in `onSensitivityProfileDiscovered` seam - never derived,
  // never fabricated here. This feeds the SAME canonical
  // `selectedSensitivityProfileId` as the R1 queue list and claim
  // traceability above/below: still exactly one Phase-5 review card. An
  // incidental null report (e.g. the reviewer changed which file is
  // selected inside KaiWebIntake, or its own file-detail read failed) is
  // never treated as "clear the current review selection" - only a
  // positively server-grounded id ever changes it, exactly like every other
  // path into this same piece of state.
  const handleSensitivityProfileDiscoveredFromIntake = useCallback((intakeSensitivityProfileId) => {
    if (isRouteUuid(intakeSensitivityProfileId)) {
      setSelectedSensitivityProfileId(intakeSensitivityProfileId);
    }
  }, []);

  // Engagement selection is scoped to the selected organization: changing
  // organization must discard the previous organization's engagement
  // selection before a new engagement list is requested.
  useEffect(() => {
    setEngagements([]);
    setEngagementId("");
    setEngagementsLoaded(false);
    if (!organizationId) return;
    let cancelled = false;
    (async () => {
      setLoadingEngagements(true);
      const result = await getJson(engagementsPath(organizationId));
      if (cancelled) return;
      setLoadingEngagements(false);
      setEngagementsLoaded(true);
      if (result.statusCode !== 200 || !result.body?.ok) {
        setEngagements([]);
        setMessage(errorText(result));
        return;
      }
      const items = result.body.data?.items || [];
      setEngagements(items);
      if (items.length === 1) {
        setEngagementId(items[0].engagement_id);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  // Audience change invalidates the eligibility dimension only: the governed
  // Claim Library (candidateClaims) is left untouched so the old audience's
  // eligibility result can never be shown under the new audience's label.
  useEffect(() => {
    eligibleRequestGenerationRef.current += 1;
    const next = nextLibraryStateForAudienceChange();
    setEligibleClaims(next.eligibleClaims);
    setEligibleClaimsError(next.eligibleClaimsError);
    setEligibleRequestState(next.eligibleRequestState);
    setLoadingEligibleClaims(next.loadingEligibleClaims);
  }, [audience]);

  const loadCandidateClaims = useCallback(async () => {
    if (!organizationId) return;
    const requestGeneration = ++candidateRequestGenerationRef.current;
    const requestOrganizationId = organizationId;
    setLoadingCandidateClaims(true);
    setCandidateClaimsError("");
    const result = await getJson(claimLibraryCandidatesPath(organizationId));
    if (!shouldApplyCandidateResponse({
      requestGeneration,
      currentGeneration: candidateRequestGenerationRef.current,
      requestOrganizationId,
      currentOrganizationId: organizationIdRef.current,
    })) return;
    setLoadingCandidateClaims(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setCandidateClaimsError(errorText(result));
      return;
    }
    setCandidateClaims(projectCandidateClaims(result.body.data));
  }, [organizationId]);

  const loadEligibleClaims = useCallback(async () => {
    if (!organizationId) return;
    const requestGeneration = ++eligibleRequestGenerationRef.current;
    const requestOrganizationId = organizationId;
    const requestAudience = audience;
    setLoadingEligibleClaims(true);
    setEligibleClaimsError("");
    setEligibleRequestState("loading");
    const result = await getJson(eligibleClaimsPath(organizationId, audience));
    if (!shouldApplyEligibilityResponse({
      requestGeneration,
      currentGeneration: eligibleRequestGenerationRef.current,
      requestOrganizationId,
      currentOrganizationId: organizationIdRef.current,
      requestAudience,
      currentAudience: audienceRef.current,
    })) return;
    setLoadingEligibleClaims(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      // Scoped to audience eligibility only: the all-state Claim Library
      // (candidateClaims) is never touched by this failure.
      setEligibleRequestState("error");
      setEligibleClaimsError(errorText(result));
      return;
    }
    setEligibleRequestState("success");
    setEligibleClaims(projectEligibleClaims(result.body.data));
  }, [audience, organizationId]);

  const loadClaims = useCallback(() => {
    if (!organizationId) {
      setMessage("An organization id is required.");
      return;
    }
    setMessage("");
    setTraceability(null);
    setGeneratedDraftPacket(null);
    loadCandidateClaims();
    loadEligibleClaims();
  }, [organizationId, loadCandidateClaims, loadEligibleClaims]);

  useEffect(() => {
    setSelectedGenerationClaimIds((current) => current.filter((claimId) => claims.some((claim) => claim.claimId === claimId && canSelectClaimForInternalGeneration(claim, audience))));
    // P14-09: prune the funder generation selection using the distinct,
    // stricter canSelectClaimForFunderGeneration admission rule - never the
    // internal helper above.
    setSelectedFunderGenerationClaimIds((current) => current.filter((claimId) => claims.some((claim) => claim.claimId === claimId && canSelectClaimForFunderGeneration(claim, audience))));
    setSelectedClaimId((current) => (claims.some((claim) => claim.claimId === current) ? current : claims[0]?.claimId || ""));
  }, [claims, audience]);

  const loadTraceability = useCallback(async (claimId = selectedClaimId) => {
    if (!organizationId || !claimId) return;
    setLoadingTraceability(true);
    setMessage("");
    const result = await getJson(claimTraceabilityPath(organizationId, claimId, audience));
    setLoadingTraceability(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setTraceability(null);
      setMessage(errorText(result));
      return;
    }
    setTraceability(projectTraceability(result.body.data));
  }, [audience, organizationId, selectedClaimId]);

  useEffect(() => {
    if (selectedClaimId) loadTraceability(selectedClaimId);
  }, [audience, selectedClaimId, loadTraceability]);

  // A selected claim change must never carry over another claim's
  // in-progress evidence/claim review decision form state.
  useEffect(() => {
    setEvidenceDecision("");
    setEvidenceLimitationNotesText("");
    setClaimDecision("");
    setClaimLimitationNotesText("");
    setClaimApprovedAudiences([]);
    claimAudienceSeedIdentityRef.current = "";
  }, [selectedClaimId]);

  useEffect(() => {
    if (!selectedClaimId || traceability?.claim?.claim_id !== selectedClaimId) return;
    const decisionId = traceability?.claimReviewDecision?.decisionId || "no-current-claim-review-decision";
    const seedIdentity = `${selectedClaimId}:${decisionId}`;
    if (claimAudienceSeedIdentityRef.current === seedIdentity) return;
    claimAudienceSeedIdentityRef.current = seedIdentity;
    setClaimApprovedAudiences(seedClaimApprovedAudiencesFromDecision(traceability?.claimReviewDecision));
  }, [selectedClaimId, traceability?.claim?.claim_id, traceability?.claimReviewDecision?.decisionId]);

  const toggleClaimApprovedAudience = useCallback((value) => {
    setClaimApprovedAudiences((current) => (
      current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]
    ));
  }, []);

  const toggleGenerationClaim = useCallback((claim) => {
    if (!canSelectClaimForInternalGeneration(claim, audience)) return;
    setSelectedGenerationClaimIds((current) => (
      current.includes(claim.claimId)
        ? current.filter((claimId) => claimId !== claim.claimId)
        : [...current, claim.claimId].sort()
    ));
  }, [audience]);

  // P14-09: the funder Evidence Summary generation selection toggle - admits
  // exactly the claims canSelectClaimForFunderGeneration admits (governed
  // AND currently funder-eligible), never the internal admission rule above.
  const toggleFunderGenerationClaim = useCallback((claim) => {
    if (!canSelectClaimForFunderGeneration(claim, audience)) return;
    setSelectedFunderGenerationClaimIds((current) => (
      current.includes(claim.claimId)
        ? current.filter((claimId) => claimId !== claim.claimId)
        : [...current, claim.claimId].sort()
    ));
  }, [audience]);

  const loadGeneratedDrafts = useCallback(async () => {
    if (!organizationId) return;
    setLoadingGeneratedDrafts(true);
    const result = await getJson(generatedDraftLibraryIndexPath(organizationId));
    setLoadingGeneratedDrafts(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setGeneratedDrafts([]);
      setMessage(errorText(result));
      return;
    }
    setGeneratedDrafts(projectGeneratedDraftLibraryItems(result.body.data));
  }, [organizationId]);

  // Rediscover persisted drafts on every fresh Library load, independent of
  // any transient in-browser generation state.
  useEffect(() => {
    setGeneratedDrafts([]);
    setSelectedGeneratedDraftId("");
    if (organizationId) loadGeneratedDrafts();
  }, [organizationId, loadGeneratedDrafts]);

  // A different selected draft must never carry over a previous draft's
  // export-review-request outcome (link or blockers) - same convention as
  // the claim-review form reset on selectedClaimId above.
  useEffect(() => {
    setExportReviewRequestPending(false);
    setExportReviewRequestResult(null);
  }, [selectedGeneratedDraftId]);

  const loadRequirementsReadiness = useCallback(async () => {
    if (!organizationId) return;
    setLoadingRequirementsReadiness(true);
    setRequirementsReadinessError("");
    const result = await getJson(organizationRequirementsReadinessPath(organizationId));
    setLoadingRequirementsReadiness(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setRequirementsReadiness([]);
      setRequirementsReadinessError(errorText(result));
      return;
    }
    setRequirementsReadiness(projectRequirementsReadiness(result.body.data));
  }, [organizationId]);

  // Rediscover readiness on every fresh Library load, exactly like Generated
  // Drafts above - this is a read-only rollup, so there is nothing to
  // invalidate besides the previous organization's list.
  useEffect(() => {
    setRequirementsReadiness([]);
    if (organizationId) loadRequirementsReadiness();
  }, [organizationId, loadRequirementsReadiness]);

  const loadFunderRequirements = useCallback(async () => {
    if (!organizationId || !engagementId) return;
    setLoadingFunderRequirements(true);
    setFunderRequirementsError("");
    const result = await getJson(engagementFunderRequirementsPath(organizationId, engagementId));
    setLoadingFunderRequirements(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setFunderRequirements({ state: null, target: {}, requirements: [] });
      setFunderRequirementsError(errorText(result));
      return;
    }
    setFunderRequirements(projectEngagementFunderRequirements(result.body.data));
  }, [organizationId, engagementId]);

  // Changing the selected engagement (or organization) must discard the
  // previous engagement's Funder Requirements projection completely before
  // the new engagement's read completes - never show a stale engagement's
  // applicability state, requirements, or assessments while a different
  // engagement is selected or between selections.
  useEffect(() => {
    setFunderRequirements({ state: null, target: {}, requirements: [] });
    setFunderRequirementsError("");
    if (organizationId && engagementId) loadFunderRequirements();
  }, [organizationId, engagementId, loadFunderRequirements]);

  // Grant Response Packet: changing the selected engagement (or organization)
  // must discard the previous engagement's visible packet state immediately
  // - before the new request is even issued - and a late response for a
  // previously selected engagement must never overwrite the newly selected
  // engagement's packet (see shouldApplyGrantResponsePacketResponse). Exactly
  // one request per engagement selection; membership itself is never
  // reconstructed client-side or fetched per member draft.
  useEffect(() => {
    grantPacketRequestGenerationRef.current += 1;
    setGrantResponsePacket(null);
    setGrantResponsePacketError("");
    setGrantResponsePacketRequestState("idle");
    setGrantResponsePacketExportReviewRequestPendingDraftId("");
    setGrantResponsePacketExportCandidatePending(false);
    setGrantResponsePacketExportCandidateResult(null);
    setGrantResponsePacketExportCandidateError("");
    setGrantResponsePacketExportReviewPending(false);
    setGrantResponsePacketExportReviewResult(null);
    setGrantResponsePacketExportReviewError("");
    setGrantResponsePacketExportReviewStartPending(false);
    setGrantResponsePacketExportReviewStartError("");
    setGrantResponsePacketExportReviewCompletePending(false);
    setGrantResponsePacketExportReviewCompleteError("");
    setGrantResponsePacketFinalReleaseAuthorityPending(false);
    setGrantResponsePacketFinalReleaseAuthorityError("");
    setGrantResponsePacketFinalMarkdownExportManifestPending(false);
    setGrantResponsePacketFinalMarkdownExportManifestError("");
    setLoadingGrantResponsePacket(false);
    if (!organizationId || !engagementId) return;
    let cancelled = false;
    (async () => {
      const requestGeneration = ++grantPacketRequestGenerationRef.current;
      const requestOrganizationId = organizationId;
      const requestEngagementId = engagementId;
      setLoadingGrantResponsePacket(true);
      setGrantResponsePacketRequestState("loading");
      const result = await getJson(grantResponsePacketPath(organizationId, engagementId));
      if (cancelled) return;
      if (!shouldApplyGrantResponsePacketResponse({
        requestGeneration,
        currentGeneration: grantPacketRequestGenerationRef.current,
        requestOrganizationId,
        currentOrganizationId: organizationIdRef.current,
        requestEngagementId,
        currentEngagementId: engagementIdRef.current,
      })) return;
      setLoadingGrantResponsePacket(false);
      if (result.statusCode !== 200 || !result.body?.ok) {
        setGrantResponsePacket(null);
        setGrantResponsePacketError(errorText(result));
        setGrantResponsePacketRequestState("error");
        return;
      }
      const hydrated = hydrateGrantResponsePacketExportReviewReadModel(projectGrantResponsePacket(result.body.data));
      setGrantResponsePacket(hydrated.packet);
      setGrantResponsePacketExportCandidateResult(hydrated.candidateResult);
      setGrantResponsePacketExportReviewResult(hydrated.exportReviewResult);
      setGrantResponsePacketError("");
      setGrantResponsePacketRequestState("success");
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, engagementId]);

  // Board Reporting: changing the selected engagement (or organization) must
  // discard the previous engagement's visible Board state immediately -
  // before the new request is even issued - including the retained exact
  // candidate identity (see the module-header comment above), so a late
  // response for a previously selected engagement can never overwrite the
  // newly selected engagement's Board Reporting state (see
  // shouldApplyBoardReportingResponse).
  useEffect(() => {
    boardReportingPacketRequestGenerationRef.current += 1;
    boardReportingWorkflowStateRequestGenerationRef.current += 1;
    boardReportingCandidateAutoAttemptedRef.current = false;
    setBoardReportingPacket(null);
    setBoardReportingPacketError("");
    setBoardReportingPacketRequestState("idle");
    setLoadingBoardReportingPacket(false);
    setBoardReportingCandidatePending(false);
    setBoardReportingCandidateResult(null);
    setBoardReportingCandidateError("");
    setBoardReportingCandidateSnapshot(null);
    setLoadingBoardReportingCandidateSnapshot(false);
    setBoardReportingCandidateSnapshotError("");
    setBoardReportingWorkflowState(null);
    setLoadingBoardReportingWorkflowState(false);
    setBoardReportingWorkflowStateError("");
    setBoardReportingWorkflowStateRequestState("idle");
    setBoardReportingReviewRequestPending(false);
    setBoardReportingReviewRequestError("");
    setBoardReportingReviewStartPending(false);
    setBoardReportingReviewStartError("");
    setBoardReportingReviewCompletePending(false);
    setBoardReportingReviewCompleteError("");
    setBoardReportingFinalReleaseAuthorityPending(false);
    setBoardReportingFinalReleaseAuthorityError("");
    setBoardReportingExportManifestPending(false);
    setBoardReportingExportManifestError("");
    setSelectedBoardReportingExportManifestId("");
    setBoardReportingFinalSummaryLoading(false);
    setBoardReportingFinalSummaryMarkdown(null);
    setBoardReportingFinalSummaryError("");
    if (!organizationId || !engagementId) return;
    let cancelled = false;
    (async () => {
      const requestGeneration = ++boardReportingPacketRequestGenerationRef.current;
      const requestOrganizationId = organizationId;
      const requestEngagementId = engagementId;
      setLoadingBoardReportingPacket(true);
      setBoardReportingPacketRequestState("loading");
      const result = await getJson(boardReportingPacketPath(organizationId, engagementId));
      if (cancelled) return;
      if (!shouldApplyBoardReportingResponse({
        requestGeneration,
        currentGeneration: boardReportingPacketRequestGenerationRef.current,
        requestOrganizationId,
        currentOrganizationId: organizationIdRef.current,
        requestEngagementId,
        currentEngagementId: engagementIdRef.current,
      })) return;
      setLoadingBoardReportingPacket(false);
      if (result.statusCode !== 200 || !result.body?.ok) {
        setBoardReportingPacket(null);
        setBoardReportingPacketError(errorText(result));
        setBoardReportingPacketRequestState("error");
        return;
      }
      setBoardReportingPacket(projectBoardReportingPacket(result.body.data));
      setBoardReportingPacketError("");
      setBoardReportingPacketRequestState("success");
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, engagementId]);

  // Shared post-mutation refetch of the authoritative Board Reporting
  // workflow-state for the EXACT candidate id passed in - used after every
  // Board mutation (review request/start/complete, authority grant/revoke,
  // manifest create/reuse), mirroring
  // refetchGrantResponsePacketAfterMemberExportReviewRequest's stale-
  // response/timeout discipline exactly.
  const refetchBoardReportingWorkflowState = useCallback(async (requestOrganizationId, requestEngagementId, requestCandidateId) => {
    const requestGeneration = ++boardReportingWorkflowStateRequestGenerationRef.current;
    setLoadingBoardReportingWorkflowState(true);
    setBoardReportingWorkflowStateRequestState("loading");
    let result;
    try {
      result = await Promise.race([
        getJson(boardReportingWorkflowStatePath(requestOrganizationId, requestEngagementId, requestCandidateId)),
        new Promise((_resolve, reject) => {
          setTimeout(
            () => reject(new Error("Request timed out.")),
            GRANT_RESPONSE_PACKET_REFETCH_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      if (!shouldApplyBoardReportingResponse({
        requestGeneration,
        currentGeneration: boardReportingWorkflowStateRequestGenerationRef.current,
        requestOrganizationId,
        currentOrganizationId: organizationIdRef.current,
        requestEngagementId,
        currentEngagementId: engagementIdRef.current,
      })) return false;
      setLoadingBoardReportingWorkflowState(false);
      setBoardReportingWorkflowState(null);
      setBoardReportingWorkflowStateError(error?.message || "Request failed (network error).");
      setBoardReportingWorkflowStateRequestState("error");
      return true;
    }
    if (!shouldApplyBoardReportingResponse({
      requestGeneration,
      currentGeneration: boardReportingWorkflowStateRequestGenerationRef.current,
      requestOrganizationId,
      currentOrganizationId: organizationIdRef.current,
      requestEngagementId,
      currentEngagementId: engagementIdRef.current,
    })) return false;
    setLoadingBoardReportingWorkflowState(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setBoardReportingWorkflowState(null);
      setBoardReportingWorkflowStateError(errorText(result));
      setBoardReportingWorkflowStateRequestState("error");
      return true;
    }
    const projected = projectBoardReportingWorkflowState(result.body.data);
    setBoardReportingWorkflowState(projected);
    setBoardReportingWorkflowStateError("");
    setBoardReportingWorkflowStateRequestState("success");
    // A fresh workflow-state read that no longer carries the currently
    // selected manifest id (e.g. a different candidate, or a manifest that
    // never existed) must never leave a stale, now-unrecoverable selection
    // in place - this only ever clears, it never auto-selects a replacement.
    setSelectedBoardReportingExportManifestId((current) => (
      current && projected?.exportManifests?.some((manifest) => manifest.boardReportingCandidateExportManifestId === current)
        ? current
        : ""
    ));
    setBoardReportingFinalSummaryMarkdown(null);
    setBoardReportingFinalSummaryError("");
    return true;
  }, []);

  // BR-02 candidate create/reuse for exactly the selected engagement. Sends
  // only its own deterministic idempotency_key - every piece of candidate
  // state (membership, ordering, fingerprint, candidate identity) is
  // resolved server-side. On success this retains the EXACT candidate id the
  // server returned (never a client-manufactured one) and reads both the
  // immutable candidate snapshot and the authoritative workflow-state for
  // that exact id.
  const createBoardReportingCandidate = useCallback(async () => {
    if (!organizationId || !engagementId || boardReportingCandidatePending) return;
    // The idempotency key is derived from the packet's own current
    // server-derived canonicalFingerprint (see module-header comment in
    // impactEvidenceLibraryLogic.js) - never organizationId/engagementId
    // alone. Without a current fingerprint (no eligible members yet) there is
    // no authoritative composition to key a candidate against.
    const canonicalFingerprint = boardReportingPacket?.canonicalFingerprint;
    if (typeof canonicalFingerprint !== "string" || canonicalFingerprint.length === 0) {
      setBoardReportingCandidateError("Board Reporting composition identity is not yet available.");
      return;
    }
    const requestOrganizationId = organizationId;
    const requestEngagementId = engagementId;
    setBoardReportingCandidatePending(true);
    setBoardReportingCandidateError("");
    try {
      const result = await postJson(
        boardReportingCandidatesPath(requestOrganizationId, requestEngagementId),
        boardReportingCreateCandidateBody(
          boardReportingCreateCandidateIdempotencyKey(canonicalFingerprint),
        ),
      );
      const stillCurrent = requestOrganizationId === organizationIdRef.current
        && requestEngagementId === engagementIdRef.current;
      if (result.statusCode !== 200 && result.statusCode !== 201) {
        if (stillCurrent) {
          setBoardReportingCandidateError(errorText(result));
        }
        return;
      }
      const projected = projectBoardReportingCandidateResult(result.body?.data);
      if (stillCurrent) {
        setBoardReportingCandidateResult(projected);
      }
      const candidateId = projected?.boardReportingCandidateId;
      if (!candidateId) return;
      setLoadingBoardReportingCandidateSnapshot(true);
      setBoardReportingCandidateSnapshotError("");
      const snapshotResult = await getJson(
        boardReportingCandidatePath(requestOrganizationId, requestEngagementId, candidateId),
      );
      if (requestOrganizationId === organizationIdRef.current && requestEngagementId === engagementIdRef.current) {
        setLoadingBoardReportingCandidateSnapshot(false);
        if (snapshotResult.statusCode === 200 && snapshotResult.body?.ok) {
          setBoardReportingCandidateSnapshot(projectBoardReportingCandidateSnapshot(snapshotResult.body.data));
          setBoardReportingCandidateSnapshotError("");
        } else {
          setBoardReportingCandidateSnapshot(null);
          setBoardReportingCandidateSnapshotError(errorText(snapshotResult));
        }
      }
      await refetchBoardReportingWorkflowState(requestOrganizationId, requestEngagementId, candidateId);
    } catch (error) {
      if (
        requestOrganizationId === organizationIdRef.current
        && requestEngagementId === engagementIdRef.current
      ) {
        setBoardReportingCandidateError(error?.message || "Request failed (network error).");
      }
    } finally {
      if (
        requestOrganizationId === organizationIdRef.current
        && requestEngagementId === engagementIdRef.current
      ) {
        setBoardReportingCandidatePending(false);
      }
    }
  }, [
    organizationId,
    engagementId,
    boardReportingCandidatePending,
    boardReportingPacket,
    refetchBoardReportingWorkflowState,
  ]);

  // Fresh-mount/reload exact candidate identity recovery: a true fresh mount
  // (or a hard reload) always loses the React state that retains
  // boardReportingCandidateResult (see the module-header comment above), but
  // the BR-02 create/reuse route is keyed by a deterministic idempotency key
  // derived from the packet's own current server-derived canonicalFingerprint
  // (see boardReportingCreateCandidateIdempotencyKey). Replaying that exact
  // same create/reuse call therefore always resolves back to the SAME
  // existing candidate (replayed: true) whenever the authoritative
  // composition is unchanged, and to a NEW candidate whenever it has changed
  // since the prior mount - so once the current engagement's packet has
  // loaded (carrying its current fingerprint), this effect replays it exactly
  // once to recover the exact CURRENT candidate id, then reads that exact
  // candidate and its exact workflow-state, all through the existing
  // createBoardReportingCandidate callback unchanged. Never a latest/newest/
  // first/last/array-order guess, and never a second persistence mechanism.
  // While the component stays mounted, a later composition change is picked
  // up only by the existing manual "Create/reuse" action (never
  // automatically): boardReportingCandidateResult already holds a candidate,
  // so this effect does not re-fire on its own, and the previously-held
  // candidate is left exactly as the authoritative eligibility/currentness
  // read (workflow-state) already reports it - stale under the new
  // composition, never silently treated as current.
  useEffect(() => {
    if (!organizationId || !engagementId) return;
    if (boardReportingPacketRequestState !== "success") return;
    if (boardReportingCandidateResult) return;
    if (boardReportingCandidatePending) return;
    if (boardReportingCandidateAutoAttemptedRef.current) return;
    boardReportingCandidateAutoAttemptedRef.current = true;
    createBoardReportingCandidate();
  }, [
    organizationId,
    engagementId,
    boardReportingPacketRequestState,
    boardReportingCandidateResult,
    boardReportingCandidatePending,
    createBoardReportingCandidate,
  ]);

  // Requests governed review for the EXACT candidate id the server already
  // returned above (boardReportingCandidateResult) - never a latest/newest/
  // preferred guess. Sends an empty body; every piece of review-queue state
  // is resolved server-side.
  const requestBoardReportingReview = useCallback(async () => {
    const candidateId = boardReportingCandidateResult?.boardReportingCandidateId;
    if (!organizationId || !engagementId || !candidateId || boardReportingReviewRequestPending) return;
    const requestOrganizationId = organizationId;
    const requestEngagementId = engagementId;
    setBoardReportingReviewRequestPending(true);
    setBoardReportingReviewRequestError("");
    const result = await postJson(
      boardReportingReviewRequestPath(requestOrganizationId, requestEngagementId, candidateId),
      {},
    );
    const stillCurrent = requestOrganizationId === organizationIdRef.current
      && requestEngagementId === engagementIdRef.current;
    if (result.statusCode !== 200 && result.statusCode !== 201) {
      if (stillCurrent) {
        setBoardReportingReviewRequestError(errorText(result));
        setBoardReportingReviewRequestPending(false);
      }
      return;
    }
    await refetchBoardReportingWorkflowState(requestOrganizationId, requestEngagementId, candidateId);
    if (stillCurrent) {
      setBoardReportingReviewRequestPending(false);
    }
  }, [
    organizationId,
    engagementId,
    boardReportingCandidateResult,
    boardReportingReviewRequestPending,
    refetchBoardReportingWorkflowState,
  ]);

  // Starts governed review for the EXACT candidate id + EXACT review-queue-
  // item id + EXACT reviewUpdatedAt CAS token the workflow-state GET already
  // returned above - never a latest/newest/preferred guess of any of the
  // three.
  const startBoardReportingReview = useCallback(async () => {
    const candidateId = boardReportingCandidateResult?.boardReportingCandidateId;
    const queueItemId = boardReportingWorkflowState?.reviewState?.reviewQueueItemId;
    const expectedUpdatedAt = boardReportingWorkflowState?.reviewState?.reviewUpdatedAt;
    if (
      !organizationId || !engagementId || !candidateId || !queueItemId || !expectedUpdatedAt
      || boardReportingReviewStartPending
    ) return;
    if (
      boardReportingReviewLifecycleState(boardReportingWorkflowState?.reviewState)
      !== BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.startable
    ) return;
    const requestOrganizationId = organizationId;
    const requestEngagementId = engagementId;
    setBoardReportingReviewStartPending(true);
    setBoardReportingReviewStartError("");
    const result = await postJson(
      boardReportingReviewStartPath(requestOrganizationId, requestEngagementId, candidateId, queueItemId),
      reviewTransitionBody(expectedUpdatedAt),
    );
    const stillCurrent = requestOrganizationId === organizationIdRef.current
      && requestEngagementId === engagementIdRef.current;
    if (result.statusCode !== 200 && result.statusCode !== 201) {
      if (stillCurrent) {
        setBoardReportingReviewStartError(errorText(result));
        setBoardReportingReviewStartPending(false);
      }
      return;
    }
    await refetchBoardReportingWorkflowState(requestOrganizationId, requestEngagementId, candidateId);
    if (stillCurrent) {
      setBoardReportingReviewStartPending(false);
    }
  }, [
    organizationId,
    engagementId,
    boardReportingCandidateResult,
    boardReportingWorkflowState,
    boardReportingReviewStartPending,
    refetchBoardReportingWorkflowState,
  ]);

  // Completes governed review for the EXACT candidate id + EXACT review-
  // queue-item id + EXACT reviewUpdatedAt CAS token the workflow-state GET
  // already returned above - never a latest/newest/preferred guess of any of
  // the three.
  const completeBoardReportingReview = useCallback(async () => {
    const candidateId = boardReportingCandidateResult?.boardReportingCandidateId;
    const queueItemId = boardReportingWorkflowState?.reviewState?.reviewQueueItemId;
    const expectedUpdatedAt = boardReportingWorkflowState?.reviewState?.reviewUpdatedAt;
    if (
      !organizationId || !engagementId || !candidateId || !queueItemId || !expectedUpdatedAt
      || boardReportingReviewCompletePending
    ) return;
    if (
      boardReportingReviewLifecycleState(boardReportingWorkflowState?.reviewState)
      !== BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.completable
    ) return;
    const requestOrganizationId = organizationId;
    const requestEngagementId = engagementId;
    setBoardReportingReviewCompletePending(true);
    setBoardReportingReviewCompleteError("");
    const result = await postJson(
      boardReportingReviewCompletePath(requestOrganizationId, requestEngagementId, candidateId, queueItemId),
      reviewTransitionBody(expectedUpdatedAt),
    );
    const stillCurrent = requestOrganizationId === organizationIdRef.current
      && requestEngagementId === engagementIdRef.current;
    if (result.statusCode !== 200 && result.statusCode !== 201) {
      if (stillCurrent) {
        setBoardReportingReviewCompleteError(errorText(result));
        setBoardReportingReviewCompletePending(false);
      }
      return;
    }
    await refetchBoardReportingWorkflowState(requestOrganizationId, requestEngagementId, candidateId);
    if (stillCurrent) {
      setBoardReportingReviewCompletePending(false);
    }
  }, [
    organizationId,
    engagementId,
    boardReportingCandidateResult,
    boardReportingWorkflowState,
    boardReportingReviewCompletePending,
    refetchBoardReportingWorkflowState,
  ]);

  // BR-04: governed human final-release authority grant/revoke for the EXACT
  // current candidate id + EXACT current review_queue_item_id - never a
  // latest/newest/preferred guess of either. Only reachable once review is
  // resolved/resolved (see boardReportingFinalReleaseAuthorityControlState),
  // mirroring the one-state-one-control discipline every other action on
  // this card already follows. On success or failure alike, this never
  // trusts its own POST response body as durable truth: it always refetches
  // the authoritative workflow-state afterward.
  const recordBoardReportingFinalReleaseAuthority = useCallback(async (decisionAction) => {
    const candidateId = boardReportingCandidateResult?.boardReportingCandidateId;
    const queueItemId = boardReportingWorkflowState?.reviewState?.reviewQueueItemId;
    if (!organizationId || !engagementId || !candidateId || !queueItemId || boardReportingFinalReleaseAuthorityPending) return;
    if (
      boardReportingFinalReleaseAuthorityControlState(boardReportingWorkflowState)
      === BOARD_REPORTING_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.none
    ) return;
    const requestOrganizationId = organizationId;
    const requestEngagementId = engagementId;
    setBoardReportingFinalReleaseAuthorityPending(true);
    setBoardReportingFinalReleaseAuthorityError("");
    const result = await postJson(
      boardReportingFinalReleaseAuthorityPath(requestOrganizationId, requestEngagementId, candidateId),
      boardReportingFinalReleaseAuthorityBody(queueItemId, decisionAction),
    );
    const stillCurrent = requestOrganizationId === organizationIdRef.current
      && requestEngagementId === engagementIdRef.current;
    if (result.statusCode !== 200 && result.statusCode !== 201) {
      if (stillCurrent) {
        setBoardReportingFinalReleaseAuthorityError(errorText(result));
        setBoardReportingFinalReleaseAuthorityPending(false);
      }
      return;
    }
    await refetchBoardReportingWorkflowState(requestOrganizationId, requestEngagementId, candidateId);
    if (stillCurrent) {
      setBoardReportingFinalReleaseAuthorityPending(false);
    }
  }, [
    organizationId,
    engagementId,
    boardReportingCandidateResult,
    boardReportingWorkflowState,
    boardReportingFinalReleaseAuthorityPending,
    refetchBoardReportingWorkflowState,
  ]);

  // Governed FINAL Board Summary export-manifest create/reuse for the EXACT
  // current candidate id - never a latest/newest/preferred guess. Sends the
  // existing required EMPTY body only ({}) - the backend's own create/reuse
  // convergence decides whether a manifest needs creating, never this
  // browser. On success or failure alike, this never trusts its own POST
  // response body as durable truth: it always refetches the authoritative
  // workflow-state afterward, and every rendered manifest comes only from
  // that response's own exportManifests list.
  const createBoardReportingExportManifest = useCallback(async () => {
    const candidateId = boardReportingCandidateResult?.boardReportingCandidateId;
    if (!organizationId || !engagementId || !candidateId || boardReportingExportManifestPending) return;
    const requestOrganizationId = organizationId;
    const requestEngagementId = engagementId;
    setBoardReportingExportManifestPending(true);
    setBoardReportingExportManifestError("");
    const result = await postJson(
      boardReportingExportManifestsPath(requestOrganizationId, requestEngagementId, candidateId),
      {},
    );
    const stillCurrent = requestOrganizationId === organizationIdRef.current
      && requestEngagementId === engagementIdRef.current;
    if (result.statusCode !== 200 && result.statusCode !== 201) {
      if (stillCurrent) {
        setBoardReportingExportManifestError(errorText(result));
        setBoardReportingExportManifestPending(false);
      }
      return;
    }
    await refetchBoardReportingWorkflowState(requestOrganizationId, requestEngagementId, candidateId);
    if (stillCurrent) {
      setBoardReportingExportManifestPending(false);
    }
  }, [
    organizationId,
    engagementId,
    boardReportingCandidateResult,
    boardReportingExportManifestPending,
    refetchBoardReportingWorkflowState,
  ]);

  // Explicit user selection of exactly one existing manifest id from the
  // current workflow-state's own exportManifests list - never inferred, and
  // never auto-selected as a side effect of a fresh workflow-state read (see
  // refetchBoardReportingWorkflowState above, which only ever clears a
  // selection that no longer exists). Selecting a different manifest always
  // clears any previously fetched FINAL Markdown - it is never shown against
  // the wrong manifest id.
  const selectBoardReportingExportManifestId = useCallback((manifestId) => {
    setSelectedBoardReportingExportManifestId(manifestId);
    setBoardReportingFinalSummaryMarkdown(null);
    setBoardReportingFinalSummaryError("");
  }, []);

  // Fetches the governed FINAL Board Summary Markdown for exactly the
  // explicitly-selected boardReportingCandidateExportManifestId - never an
  // inferred/first/last manifest. boardReportingFinalSummaryFetchable is a UX
  // nicety only; the server remains the sole enforcement authority
  // regardless. The response is raw Markdown text (an attachment), not a
  // {ok,data} JSON envelope, so this fetches and reads text directly rather
  // than reusing getJson.
  const fetchBoardReportingFinalSummary = useCallback(async () => {
    if (
      !organizationId
      || !selectedBoardReportingExportManifestId
      || boardReportingFinalSummaryLoading
      || !boardReportingFinalSummaryFetchable(boardReportingWorkflowState, selectedBoardReportingExportManifestId)
    ) return;
    const requestOrganizationId = organizationId;
    const requestManifestId = selectedBoardReportingExportManifestId;
    setBoardReportingFinalSummaryLoading(true);
    setBoardReportingFinalSummaryError("");
    try {
      const response = await fetch(
        boardReportingExportManifestMarkdownPath(requestOrganizationId, requestManifestId),
      );
      if (
        requestOrganizationId !== organizationIdRef.current
        || requestManifestId !== selectedBoardReportingExportManifestId
      ) return;
      if (!response.ok) {
        setBoardReportingFinalSummaryMarkdown(null);
        setBoardReportingFinalSummaryError(`Request failed (${response.status}).`);
        return;
      }
      const markdown = await response.text();
      if (
        requestOrganizationId !== organizationIdRef.current
        || requestManifestId !== selectedBoardReportingExportManifestId
      ) return;
      setBoardReportingFinalSummaryMarkdown(markdown);
      setBoardReportingFinalSummaryError("");
    } catch (error) {
      if (
        requestOrganizationId === organizationIdRef.current
        && requestManifestId === selectedBoardReportingExportManifestId
      ) {
        setBoardReportingFinalSummaryMarkdown(null);
        setBoardReportingFinalSummaryError(error?.message || "Request failed (network error).");
      }
    } finally {
      if (
        requestOrganizationId === organizationIdRef.current
        && requestManifestId === selectedBoardReportingExportManifestId
      ) {
        setBoardReportingFinalSummaryLoading(false);
      }
    }
  }, [
    organizationId,
    selectedBoardReportingExportManifestId,
    boardReportingFinalSummaryLoading,
    boardReportingWorkflowState,
  ]);

  const refetchGrantResponsePacketAfterMemberExportReviewRequest = useCallback(async (requestOrganizationId, requestEngagementId) => {
    const requestGeneration = ++grantPacketRequestGenerationRef.current;
    setLoadingGrantResponsePacket(true);
    setGrantResponsePacketRequestState("loading");
    // A rejected getJson (a thrown network/fetch failure, as opposed to a
    // settled non-2xx response) must never leave this request's loading
    // state stuck forever - it is applied exactly like a failed response so
    // every caller of this shared post-mutation refetch (create/request/
    // start/complete) always reaches its own pending-flag reset below.
    //
    // A getJson call that never settles at all (e.g. a hung connection,
    // rather than a thrown rejection) is just as dangerous - nothing would
    // ever resume this async function, so loading/pending flags would be
    // stuck true forever with no error surfaced and no way to retry. This
    // is bounded with the same timeout treated identically to a thrown
    // rejection below: it never auto-retries the mutation, it only settles
    // this refetch's own loading/error state.
    let result;
    try {
      result = await Promise.race([
        getJson(grantResponsePacketPath(requestOrganizationId, requestEngagementId)),
        new Promise((_resolve, reject) => {
          setTimeout(
            () => reject(new Error("Request timed out.")),
            GRANT_RESPONSE_PACKET_REFETCH_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      if (!shouldApplyGrantResponsePacketResponse({
        requestGeneration,
        currentGeneration: grantPacketRequestGenerationRef.current,
        requestOrganizationId,
        currentOrganizationId: organizationIdRef.current,
        requestEngagementId,
        currentEngagementId: engagementIdRef.current,
      })) return false;
      setLoadingGrantResponsePacket(false);
      setGrantResponsePacket(null);
      setGrantResponsePacketExportCandidateResult(null);
      setGrantResponsePacketExportReviewResult(null);
      setGrantResponsePacketError(error?.message || "Request failed (network error).");
      setGrantResponsePacketRequestState("error");
      return true;
    }
    if (!shouldApplyGrantResponsePacketResponse({
      requestGeneration,
      currentGeneration: grantPacketRequestGenerationRef.current,
      requestOrganizationId,
      currentOrganizationId: organizationIdRef.current,
      requestEngagementId,
      currentEngagementId: engagementIdRef.current,
    })) return false;
    setLoadingGrantResponsePacket(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setGrantResponsePacket(null);
      setGrantResponsePacketExportCandidateResult(null);
      setGrantResponsePacketExportReviewResult(null);
      setGrantResponsePacketError(errorText(result));
      setGrantResponsePacketRequestState("error");
      return true;
    }
    const hydrated = hydrateGrantResponsePacketExportReviewReadModel(projectGrantResponsePacket(result.body.data));
    setGrantResponsePacket(hydrated.packet);
    setGrantResponsePacketExportCandidateResult(hydrated.candidateResult);
    setGrantResponsePacketExportReviewResult(hydrated.exportReviewResult);
    setGrantResponsePacketError("");
    setGrantResponsePacketRequestState("success");
    return true;
  }, []);

  const requestGrantResponsePacketMemberExportReview = useCallback(async (draft) => {
    if (!organizationId || !engagementId || grantResponsePacketExportReviewRequestPendingDraftId) return;
    if (generatedDraftExportReviewDisplayState(draft) !== EXPORT_REVIEW_DISPLAY_STATES.requestable) return;
    const requestOrganizationId = organizationId;
    const requestEngagementId = engagementId;
    setGrantResponsePacketExportReviewRequestPendingDraftId(draft.generatedContentDraftId);
    setMessage("");
    const result = await postJson(
      exportReviewRequestPath(requestOrganizationId, draft.generatedContentDraftId),
      exportReviewRequestBody(draft.requestedAudience),
    );
    if (result.statusCode !== 200 && result.statusCode !== 201) {
      if (
        requestOrganizationId === organizationIdRef.current
        && requestEngagementId === engagementIdRef.current
      ) {
        setMessage(errorText(result));
        setGrantResponsePacketExportReviewRequestPendingDraftId("");
      }
      return;
    }
    const projected = projectExportReviewRequestResult(result.body?.data);
    if (projected?.accepted) {
      await refetchGrantResponsePacketAfterMemberExportReviewRequest(requestOrganizationId, requestEngagementId);
    } else if (
      requestOrganizationId === organizationIdRef.current
      && requestEngagementId === engagementIdRef.current
    ) {
      setMessage(JSON.stringify(projected?.validatorResult ?? null));
    }
    if (
      requestOrganizationId === organizationIdRef.current
      && requestEngagementId === engagementIdRef.current
    ) {
      setGrantResponsePacketExportReviewRequestPendingDraftId("");
    }
  }, [
    organizationId,
    engagementId,
    grantResponsePacketExportReviewRequestPendingDraftId,
    refetchGrantResponsePacketAfterMemberExportReviewRequest,
  ]);

  // Runs (or replays) the server-governed assessment for exactly one
  // requirement, then refetches the whole readiness rollup - the POST
  // response itself is never treated as durable state, matching every other
  // mutation on this page.
  const loadReviewQueue = useCallback(async () => {
    if (!organizationId) return;
    setLoadingReviewQueue(true);
    setReviewQueueError("");
    setReviewQueueRequestState("loading");
    const result = await getJson(organizationReviewQueuePath(organizationId));
    setLoadingReviewQueue(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setReviewQueueItems([]);
      setReviewQueueCompleteness({ truncated: false, evaluationErrorCount: 0 });
      setReviewQueueError(errorText(result));
      setReviewQueueRequestState("error");
      return;
    }
    setReviewQueueItems(projectReviewQueue(result.body.data));
    setReviewQueueCompleteness(projectReviewQueueCompleteness(result.body.data));
    setReviewQueueRequestState("success");
  }, [organizationId]);

  // Rediscover current attention on every fresh Library load, exactly like
  // the requirements-readiness rollup above - this is a read-only rollup, so
  // there is nothing to invalidate besides the previous organization's list.
  useEffect(() => {
    setReviewQueueItems([]);
    if (organizationId) loadReviewQueue();
  }, [organizationId, loadReviewQueue]);

  // Data Sources: fetches the governed kai.sources + kai.source_versions
  // browse list for the selected organization. Read-only rollup, same
  // request-lifecycle convention as loadReviewQueue above.
  const loadOrganizationSources = useCallback(async () => {
    if (!organizationId) return;
    setLoadingOrganizationSources(true);
    setOrganizationSourcesError("");
    setOrganizationSourcesRequestState("loading");
    const result = await getJson(organizationSourcesPath(organizationId));
    setLoadingOrganizationSources(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setOrganizationSources([]);
      setOrganizationSourcesError(errorText(result));
      setOrganizationSourcesRequestState("error");
      return;
    }
    setOrganizationSources(projectOrganizationSources(result.body.data));
    setOrganizationSourcesRequestState("success");
  }, [organizationId]);

  useEffect(() => {
    setOrganizationSources([]);
    if (organizationId) loadOrganizationSources();
  }, [organizationId, loadOrganizationSources]);

  // P14-04: creates (or reuses, on replay) the export-candidate for exactly
  // the selected engagement. Sends no candidate composition of its own - the
  // POST body is empty and every piece of candidate state (membership,
  // ordering, fingerprint, candidate identity) is resolved server-side. On
  // success this never manufactures durable candidate state client-side - it
  // refetches the authoritative Grant Response Packet via the same
  // engagement-switch-isolated/stale-response-protected refetch already used
  // after a member export-review request.
  const createGrantResponsePacketExportCandidate = useCallback(async () => {
    if (!organizationId || !engagementId || grantResponsePacketExportCandidatePending) return;
    const requestOrganizationId = organizationId;
    const requestEngagementId = engagementId;
    setGrantResponsePacketExportCandidatePending(true);
    setGrantResponsePacketExportCandidateError("");
    setGrantResponsePacketExportReviewPending(false);
    setGrantResponsePacketExportReviewResult(null);
    setGrantResponsePacketExportReviewError("");
    setGrantResponsePacketExportReviewStartPending(false);
    setGrantResponsePacketExportReviewStartError("");
    setGrantResponsePacketExportReviewCompletePending(false);
    setGrantResponsePacketExportReviewCompleteError("");
    // A thrown postJson/refetch (network failure, as opposed to a settled
    // non-2xx response) must never leave grantResponsePacketExportCandidatePending
    // stuck true forever - that would permanently disable the Create control
    // with no way to retry. The pending flag is always cleared in finally,
    // for exactly the same still-current engagement/organization the rest of
    // this handler already checks.
    try {
      const result = await postJson(
        grantResponsePacketExportCandidatesPath(requestOrganizationId, requestEngagementId),
        {},
      );
      const stillCurrent = requestOrganizationId === organizationIdRef.current
        && requestEngagementId === engagementIdRef.current;
      if (result.statusCode !== 200 && result.statusCode !== 201) {
        if (stillCurrent) {
          setGrantResponsePacketExportCandidateError(errorText(result));
        }
        return;
      }
      await refetchGrantResponsePacketAfterMemberExportReviewRequest(requestOrganizationId, requestEngagementId);
    } catch (error) {
      if (
        requestOrganizationId === organizationIdRef.current
        && requestEngagementId === engagementIdRef.current
      ) {
        setGrantResponsePacketExportCandidateError(error?.message || "Request failed (network error).");
      }
    } finally {
      if (
        requestOrganizationId === organizationIdRef.current
        && requestEngagementId === engagementIdRef.current
      ) {
        setGrantResponsePacketExportCandidatePending(false);
      }
    }
  }, [
    organizationId,
    engagementId,
    grantResponsePacketExportCandidatePending,
    refetchGrantResponsePacketAfterMemberExportReviewRequest,
  ]);

  // P14-05: requests governed export review for the EXACT candidate id the
  // server already returned above (grantResponsePacketExportCandidateResult)
  // - never a latest/newest/preferred candidate guess, and never
  // reconstructed from membership/fingerprint. Sends an empty body; every
  // piece of review-queue state is resolved server-side. Requesting review
  // grants no approval, no funder/public readiness, no export authority, and
  // no manifest of its own - this only ever displays the authoritative
  // open/in_progress/resolved review status the server returns.
  const requestGrantResponsePacketExportReview = useCallback(async () => {
    const candidateId = grantResponsePacketExportCandidateResult?.grantResponsePacketExportCandidateId;
    if (!organizationId || !engagementId || !candidateId || grantResponsePacketExportReviewPending) return;
    const requestOrganizationId = organizationId;
    const requestEngagementId = engagementId;
    setGrantResponsePacketExportReviewPending(true);
    setGrantResponsePacketExportReviewError("");
    const result = await postJson(
      grantResponsePacketExportReviewRequestPath(requestOrganizationId, requestEngagementId, candidateId),
      {},
    );
    const stillCurrent = requestOrganizationId === organizationIdRef.current
      && requestEngagementId === engagementIdRef.current;
    if (result.statusCode !== 200 && result.statusCode !== 201) {
      if (stillCurrent) {
        setGrantResponsePacketExportReviewError(errorText(result));
        setGrantResponsePacketExportReviewPending(false);
      }
      return;
    }
    await refetchGrantResponsePacketAfterMemberExportReviewRequest(requestOrganizationId, requestEngagementId);
    if (stillCurrent) {
      setGrantResponsePacketExportReviewPending(false);
    }
  }, [
    organizationId,
    engagementId,
    grantResponsePacketExportCandidateResult,
    grantResponsePacketExportReviewPending,
    refetchGrantResponsePacketAfterMemberExportReviewRequest,
  ]);

  // P14-06A: starts governed export review for the EXACT candidate id +
  // EXACT review-queue-item id + EXACT reviewUpdatedAt CAS token the server
  // already returned above (grantResponsePacketExportReviewResult) - never a
  // latest/newest/preferred guess of any of the three. Sends only
  // {expected_updated_at}; every other piece of transition state is
  // resolved server-side. On a failed or conflicting POST, no queue state is
  // manufactured - grantResponsePacketExportReviewResult is left exactly as
  // it was until a genuinely successful transition (or a fresh reload)
  // replaces it. Starting review does not determine export eligibility and
  // grants no approval, no funder/public readiness signal, no export
  // authority, and no manifest.
  const startGrantResponsePacketExportReview = useCallback(async () => {
    const candidateId = grantResponsePacketExportReviewResult?.grantResponsePacketExportCandidateId;
    const queueItemId = grantResponsePacketExportReviewResult?.reviewQueueItemId;
    const expectedUpdatedAt = grantResponsePacketExportReviewResult?.reviewUpdatedAt;
    if (
      !organizationId || !engagementId || !candidateId || !queueItemId || !expectedUpdatedAt
      || grantResponsePacketExportReviewStartPending
    ) return;
    if (
      grantResponsePacketExportReviewLifecycleState(grantResponsePacketExportReviewResult)
      !== GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.startable
    ) return;
    const requestOrganizationId = organizationId;
    const requestEngagementId = engagementId;
    setGrantResponsePacketExportReviewStartPending(true);
    setGrantResponsePacketExportReviewStartError("");
    const result = await postJson(
      grantResponsePacketExportReviewStartPath(requestOrganizationId, requestEngagementId, candidateId, queueItemId),
      reviewTransitionBody(expectedUpdatedAt),
    );
    const stillCurrent = requestOrganizationId === organizationIdRef.current
      && requestEngagementId === engagementIdRef.current;
    if (result.statusCode !== 200 && result.statusCode !== 201) {
      if (stillCurrent) {
        setGrantResponsePacketExportReviewStartError(errorText(result));
        setGrantResponsePacketExportReviewStartPending(false);
      }
      return;
    }
    await refetchGrantResponsePacketAfterMemberExportReviewRequest(requestOrganizationId, requestEngagementId);
    if (stillCurrent) {
      setGrantResponsePacketExportReviewStartPending(false);
    }
  }, [
    organizationId,
    engagementId,
    grantResponsePacketExportReviewResult,
    grantResponsePacketExportReviewStartPending,
    refetchGrantResponsePacketAfterMemberExportReviewRequest,
  ]);

  // P14-06B: completes governed export review for the EXACT candidate id +
  // EXACT review-queue-item id + EXACT reviewUpdatedAt CAS token the server
  // already returned above (grantResponsePacketExportReviewResult, refreshed
  // by the START transition immediately above) - never a latest/newest/
  // preferred guess of any of the three. Sends only {expected_updated_at}.
  // On a failed or conflicting POST, no queue state is manufactured - same
  // discipline as startGrantResponsePacketExportReview above. Completing
  // review means only that a gk_admin completed the governed human export
  // review of this exact immutable packet candidate: it does not determine
  // export eligibility, does not clear it for external use, does not signal
  // funder-readiness or export authorization, and does not create a
  // manifest.
  const completeGrantResponsePacketExportReview = useCallback(async () => {
    const candidateId = grantResponsePacketExportReviewResult?.grantResponsePacketExportCandidateId;
    const queueItemId = grantResponsePacketExportReviewResult?.reviewQueueItemId;
    const expectedUpdatedAt = grantResponsePacketExportReviewResult?.reviewUpdatedAt;
    if (
      !organizationId || !engagementId || !candidateId || !queueItemId || !expectedUpdatedAt
      || grantResponsePacketExportReviewCompletePending
    ) return;
    if (
      grantResponsePacketExportReviewLifecycleState(grantResponsePacketExportReviewResult)
      !== GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.completable
    ) return;
    const requestOrganizationId = organizationId;
    const requestEngagementId = engagementId;
    setGrantResponsePacketExportReviewCompletePending(true);
    setGrantResponsePacketExportReviewCompleteError("");
    const result = await postJson(
      grantResponsePacketExportReviewCompletePath(requestOrganizationId, requestEngagementId, candidateId, queueItemId),
      reviewTransitionBody(expectedUpdatedAt),
    );
    const stillCurrent = requestOrganizationId === organizationIdRef.current
      && requestEngagementId === engagementIdRef.current;
    if (result.statusCode !== 200 && result.statusCode !== 201) {
      if (stillCurrent) {
        setGrantResponsePacketExportReviewCompleteError(errorText(result));
        setGrantResponsePacketExportReviewCompletePending(false);
      }
      return;
    }
    await refetchGrantResponsePacketAfterMemberExportReviewRequest(requestOrganizationId, requestEngagementId);
    if (stillCurrent) {
      setGrantResponsePacketExportReviewCompletePending(false);
    }
  }, [
    organizationId,
    engagementId,
    grantResponsePacketExportReviewResult,
    grantResponsePacketExportReviewCompletePending,
    refetchGrantResponsePacketAfterMemberExportReviewRequest,
  ]);

  const runAssessRequirement = useCallback(async (requirementId) => {
    if (!organizationId || assessingRequirementId) return;
    setAssessingRequirementId(requirementId);
    setRequirementsReadinessError("");
    const result = await postJson(organizationRequirementAssessmentPath(organizationId, requirementId), {});
    setAssessingRequirementId("");
    if (result.statusCode !== 201 && result.statusCode !== 200) {
      setRequirementsReadinessError(errorText(result));
      return;
    }
    await loadRequirementsReadiness();
  }, [organizationId, assessingRequirementId, loadRequirementsReadiness]);

  const selectGeneratedDraft = useCallback(async (generatedContentDraftId) => {
    setSelectedGeneratedDraftId(generatedContentDraftId);
    setMessage("");
    const packetResult = await getJson(generatedDraftReviewPacketPath(organizationId, generatedContentDraftId));
    if (packetResult.statusCode !== 200 || !packetResult.body?.ok) {
      setGeneratedDraftPacket(null);
      setMessage(errorText(packetResult));
      return;
    }
    setGeneratedDraftPacket(projectGeneratedDraftPacket(packetResult.body.data));
  }, [organizationId]);

  const generateDraft = useCallback(async (pathBuilder, idempotencyPrefix) => {
    if (audience !== "internal" || selectedGenerationClaimIds.length === 0 || !engagementId) return;
    setGeneratingDraft(true);
    setMessage("");
    setGeneratedDraftPacket(null);
    const createResult = await postJson(pathBuilder(organizationId), {
      claim_ids: selectedGenerationClaimIds,
      idempotency_key: `${idempotencyPrefix}-${selectedGenerationClaimIds.join("-")}`,
      engagement_id: engagementId,
    });
    if (createResult.statusCode !== 201 && createResult.statusCode !== 200) {
      setGeneratingDraft(false);
      setMessage(errorText(createResult));
      return;
    }
    const draftId = createResult.body?.data?.generatedContentDraftId;
    if (!draftId) {
      setGeneratingDraft(false);
      setMessage("Generated draft response did not include a draft id.");
      return;
    }
    await loadGeneratedDrafts();
    setSelectedGeneratedDraftId(draftId);
    const packetResult = await getJson(generatedDraftReviewPacketPath(organizationId, draftId));
    setGeneratingDraft(false);
    if (packetResult.statusCode !== 200 || !packetResult.body?.ok) {
      setMessage(errorText(packetResult));
      return;
    }
    setGeneratedDraftPacket(projectGeneratedDraftPacket(packetResult.body.data));
  }, [audience, organizationId, engagementId, selectedGenerationClaimIds, loadGeneratedDrafts]);

  const generateEvidenceSummary = useCallback(
    () => generateDraft(createEvidenceSummaryPath, "evidence-summary"),
    [generateDraft],
  );

  const generateImpactNarrative = useCallback(
    () => generateDraft(createImpactNarrativePath, "impact-narrative"),
    [generateDraft],
  );

  // P14-09: governed FUNDER Evidence Summary generation for an explicit
  // engagement. Mirrors generateDraft above exactly in shape (requires an
  // explicit selected engagement, sends claim_ids/idempotency_key/
  // engagement_id only) but acts on the distinct
  // selectedFunderGenerationClaimIds selection and the distinct funder
  // route - it never reuses generateDraft's audience==="internal" gate or
  // selectedGenerationClaimIds, and there is deliberately no funder Impact
  // Narrative generation control anywhere on this page.
  const generateFunderEvidenceSummary = useCallback(async () => {
    if (audience !== "funder" || selectedFunderGenerationClaimIds.length === 0 || !engagementId) return;
    setGeneratingDraft(true);
    setMessage("");
    setGeneratedDraftPacket(null);
    const createResult = await postJson(createFunderEvidenceSummaryPath(organizationId), {
      claim_ids: selectedFunderGenerationClaimIds,
      idempotency_key: `funder-evidence-summary-${selectedFunderGenerationClaimIds.join("-")}`,
      engagement_id: engagementId,
    });
    if (createResult.statusCode !== 201 && createResult.statusCode !== 200) {
      setGeneratingDraft(false);
      setMessage(errorText(createResult));
      return;
    }
    const draftId = createResult.body?.data?.generatedContentDraftId;
    if (!draftId) {
      setGeneratingDraft(false);
      setMessage("Generated draft response did not include a draft id.");
      return;
    }
    await loadGeneratedDrafts();
    setSelectedGeneratedDraftId(draftId);
    const packetResult = await getJson(generatedDraftReviewPacketPath(organizationId, draftId));
    setGeneratingDraft(false);
    if (packetResult.statusCode !== 200 || !packetResult.body?.ok) {
      setMessage(errorText(packetResult));
      return;
    }
    setGeneratedDraftPacket(projectGeneratedDraftPacket(packetResult.body.data));
  }, [audience, organizationId, engagementId, selectedFunderGenerationClaimIds, loadGeneratedDrafts]);

  const refetchGeneratedDraftPacket = useCallback(async (draftId) => {
    const packetResult = await getJson(generatedDraftReviewPacketPath(organizationId, draftId));
    if (packetResult.statusCode !== 200 || !packetResult.body?.ok) {
      setMessage(errorText(packetResult));
      return null;
    }
    const packet = projectGeneratedDraftPacket(packetResult.body.data);
    setGeneratedDraftPacket(packet);
    return packet;
  }, [organizationId]);

  const transitionGeneratedContentReview = useCallback(async (transition) => {
    if (!generatedDraftPacket || reviewTransitionPending) return;
    setReviewTransitionPending(true);
    setMessage("");
    const path = transition === "start"
      ? generatedContentReviewStartPath(organizationId, generatedDraftPacket.generatedContentDraftId, generatedDraftPacket.reviewQueueItemId)
      : generatedContentReviewCompletePath(organizationId, generatedDraftPacket.generatedContentDraftId, generatedDraftPacket.reviewQueueItemId);
    const result = await postJson(path, reviewTransitionBody(generatedDraftPacket.reviewUpdatedAt));
    if (result.statusCode !== 200 || !result.body?.ok) {
      setReviewTransitionPending(false);
      setMessage(errorText(result));
      return;
    }
    await refetchGeneratedDraftPacket(generatedDraftPacket.generatedContentDraftId);
    await loadGeneratedDrafts();
    setReviewTransitionPending(false);
  }, [generatedDraftPacket, organizationId, refetchGeneratedDraftPacket, loadGeneratedDrafts, reviewTransitionPending]);

  // Requests (or replays) the existing gk_admin-only export-review queue
  // item for the currently selected, fully-reviewed draft. This never
  // recomputes P3-16/P3-17/P3-18/P3-19 eligibility itself - it only calls
  // the accepted requestGeneratedDraftExportReview route and renders exactly
  // what it returns: either the identifier needed to reach the existing
  // gk-export-review-detail page, or the server's own blocker payload.
  const requestExportReview = useCallback(async () => {
    if (!generatedDraftPacket || exportReviewRequestPending) return;
    if (!canRequestGeneratedDraftExportReview(generatedDraftPacket)) return;
    setExportReviewRequestPending(true);
    setMessage("");
    const result = await postJson(
      exportReviewRequestPath(organizationId, generatedDraftPacket.generatedContentDraftId),
      exportReviewRequestBody(generatedDraftPacket.requestedAudience),
    );
    if (result.statusCode !== 200 && result.statusCode !== 201) {
      setExportReviewRequestPending(false);
      setMessage(errorText(result));
      return;
    }
    const projected = projectExportReviewRequestResult(result.body?.data);
    if (projected?.accepted) {
      // The durable identity now comes from the authoritative Generated
      // Draft read path (refetched below), never retained from this POST
      // response as UI truth.
      setExportReviewRequestResult(null);
      await refetchGeneratedDraftPacket(generatedDraftPacket.generatedContentDraftId);
      await loadGeneratedDrafts();
    } else {
      setExportReviewRequestResult(projected);
    }
    setExportReviewRequestPending(false);
  }, [generatedDraftPacket, organizationId, exportReviewRequestPending, refetchGeneratedDraftPacket, loadGeneratedDrafts]);

  const runExtractEvidence = useCallback(async () => {
    if (!organizationId || !sourceVersionId || workflowPending) return;
    setWorkflowPending(true);
    setWorkflowResult("");
    const result = await postJson(evidenceExtractionPath(organizationId, sourceVersionId), {});
    setWorkflowPending(false);
    setWorkflowResult(result.statusCode === 200 || result.statusCode === 201
      ? `Evidence extracted: ${(result.body?.data?.evidenceItems || []).length} evidence item(s).`
      : errorText(result));
  }, [organizationId, sourceVersionId, workflowPending]);

  // P14-07: governed human final-release authority grant/revoke for the
  // EXACT current grantResponsePacket candidate id - never a latest/newest/
  // preferred guess. Only reachable once export review is resolved/resolved
  // (see grantResponsePacketFinalReleaseAuthorityControlState), mirroring
  // the one-state-one-control discipline every other action on this card
  // already follows. Sends only {decision_action} - never a fingerprint,
  // members, memberCount, review state, eligibility, authority state,
  // requestedAudience, or manifest identity. On success or failure alike,
  // this never trusts its own POST response body as durable truth: it
  // always refetches the authoritative packet GET afterward and hydrates
  // every displayed authority/eligibility field from that response only.
  const recordGrantResponsePacketHumanFinalReleaseAuthority = useCallback(async (decisionAction) => {
    const candidateId = grantResponsePacket?.grantResponsePacketExportCandidateId;
    if (!organizationId || !engagementId || !candidateId || grantResponsePacketFinalReleaseAuthorityPending) return;
    if (grantResponsePacketFinalReleaseAuthorityControlState(grantResponsePacket) === GRANT_RESPONSE_PACKET_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.none) return;
    const requestOrganizationId = organizationId;
    const requestEngagementId = engagementId;
    setGrantResponsePacketFinalReleaseAuthorityPending(true);
    setGrantResponsePacketFinalReleaseAuthorityError("");
    const result = await postJson(
      grantResponsePacketHumanFinalReleaseAuthorityPath(requestOrganizationId, requestEngagementId, candidateId),
      grantResponsePacketHumanFinalReleaseAuthorityBody(decisionAction),
    );
    const stillCurrent = requestOrganizationId === organizationIdRef.current
      && requestEngagementId === engagementIdRef.current;
    if (result.statusCode !== 200 && result.statusCode !== 201) {
      if (stillCurrent) {
        setGrantResponsePacketFinalReleaseAuthorityError(errorText(result));
        setGrantResponsePacketFinalReleaseAuthorityPending(false);
      }
      return;
    }
    await refetchGrantResponsePacketAfterMemberExportReviewRequest(requestOrganizationId, requestEngagementId);
    if (stillCurrent) {
      setGrantResponsePacketFinalReleaseAuthorityPending(false);
    }
  }, [
    organizationId,
    engagementId,
    grantResponsePacket,
    grantResponsePacketFinalReleaseAuthorityPending,
    refetchGrantResponsePacketAfterMemberExportReviewRequest,
  ]);

  // P14-08D: governed FINAL Markdown export-manifest create/reuse for the
  // EXACT current grantResponsePacket candidate id - never a latest/newest/
  // preferred guess, and only reachable once the authoritative packet GET
  // already reports finalExportEligible === true. Sends the existing
  // required EMPTY body only ({}) - never eligibility, authority,
  // fingerprint, members, memberCount, review state, requested audience, or
  // a manifest id of its own; the backend's own P14-08B create/reuse
  // convergence decides whether a manifest needs creating, never this
  // browser. On success or failure alike, this never trusts its own POST
  // response body as durable truth: it always refetches the authoritative
  // packet GET afterward and every rendered final manifest comes only from
  // that response's finalDeliveryState.
  const prepareGrantResponsePacketFinalMarkdownExportManifest = useCallback(async () => {
    const candidateId = grantResponsePacket?.grantResponsePacketExportCandidateId;
    if (!organizationId || !engagementId || !candidateId || grantResponsePacketFinalMarkdownExportManifestPending) return;
    if (grantResponsePacket?.finalExportEligible !== true) return;
    const requestOrganizationId = organizationId;
    const requestEngagementId = engagementId;
    setGrantResponsePacketFinalMarkdownExportManifestPending(true);
    setGrantResponsePacketFinalMarkdownExportManifestError("");
    const result = await postJson(
      grantResponsePacketExportManifestsPath(requestOrganizationId, requestEngagementId, candidateId),
      {},
    );
    const stillCurrent = requestOrganizationId === organizationIdRef.current
      && requestEngagementId === engagementIdRef.current;
    if (result.statusCode !== 200 && result.statusCode !== 201) {
      if (stillCurrent) {
        setGrantResponsePacketFinalMarkdownExportManifestError(errorText(result));
        setGrantResponsePacketFinalMarkdownExportManifestPending(false);
      }
      return;
    }
    await refetchGrantResponsePacketAfterMemberExportReviewRequest(requestOrganizationId, requestEngagementId);
    if (stillCurrent) {
      setGrantResponsePacketFinalMarkdownExportManifestPending(false);
    }
  }, [
    organizationId,
    engagementId,
    grantResponsePacket,
    grantResponsePacketFinalMarkdownExportManifestPending,
    refetchGrantResponsePacketAfterMemberExportReviewRequest,
  ]);

  const runCoverageAssessment = useCallback(async () => {
    if (!organizationId || !sourceVersionId || workflowPending) return;
    setWorkflowPending(true);
    setWorkflowResult("");
    setCoverageAssessment(null);
    const result = await getJson(evidenceCoverageAssessmentPath(organizationId, sourceVersionId));
    setWorkflowPending(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setWorkflowResult(errorText(result));
      return;
    }
    setCoverageAssessment(projectCoverageAssessment(result.body.data));
  }, [organizationId, sourceVersionId, workflowPending]);

  const runClaimProposal = useCallback(async () => {
    if (!organizationId || workflowPending) return;
    if (!isRouteUuid(selectedClaim?.evidenceItemId)) {
      setWorkflowResult("Select a claim with a server-issued evidence item id before proposing a claim.");
      return;
    }
    setWorkflowPending(true);
    setWorkflowResult("");
    const result = await postJson(claimProposalPath(organizationId, selectedClaim.evidenceItemId), {});
    setWorkflowPending(false);
    setWorkflowResult(result.statusCode === 200 || result.statusCode === 201
      ? `Claim proposal recorded (claim ${result.body?.data?.claim?.claim_id || "unknown"}).`
      : errorText(result));
    if (result.statusCode === 200 || result.statusCode === 201) await loadClaims();
  }, [organizationId, selectedClaim, workflowPending, loadClaims]);

  const runClaimGapFollowups = useCallback(async () => {
    if (!organizationId || !selectedClaimId || workflowPending) return;
    setWorkflowPending(true);
    setWorkflowResult("");
    const result = await postJson(claimGapFollowupsPath(organizationId, selectedClaimId), {});
    setWorkflowPending(false);
    setWorkflowResult(result.statusCode === 200 || result.statusCode === 201
      ? "Claim-gap client-followups generated."
      : errorText(result));
  }, [organizationId, selectedClaimId, workflowPending]);

  const runPotentialConflictCheck = useCallback(async () => {
    if (!organizationId || !selectedClaimId || !secondClaimId || workflowPending) return;
    setWorkflowPending(true);
    setWorkflowResult("");
    const result = await postJson(potentialConflictsPath(organizationId, selectedClaimId, secondClaimId), {});
    setWorkflowPending(false);
    setWorkflowResult(result.statusCode === 200 || result.statusCode === 201
      ? "Potential-conflict review candidate recorded."
      : errorText(result));
  }, [organizationId, selectedClaimId, secondClaimId, workflowPending]);

  const runCoverageInternalAcceptance = useCallback(async () => {
    if (!organizationId || !selectedClaimId || !coverageDimensionKey || workflowPending) return;
    setWorkflowPending(true);
    setWorkflowResult("");
    const result = await postJson(coverageInternalAcceptancePath(organizationId, selectedClaimId, coverageDimensionKey), {});
    setWorkflowPending(false);
    setWorkflowResult(result.statusCode === 200 || result.statusCode === 201
      ? `Internal limitation accepted for ${coverageDimensionKey}.`
      : errorText(result));
    if (result.statusCode === 200 || result.statusCode === 201) await loadTraceability(selectedClaimId);
  }, [organizationId, selectedClaimId, coverageDimensionKey, workflowPending, loadTraceability]);

  const runCoverageFunderAcceptance = useCallback(async () => {
    if (!organizationId || !selectedClaimId || !coverageDimensionKey || workflowPending) return;
    setWorkflowPending(true);
    setWorkflowResult("");
    const result = await postJson(coverageFunderAcceptancePath(organizationId, selectedClaimId, coverageDimensionKey), {});
    setWorkflowPending(false);
    setWorkflowResult(result.statusCode === 200 || result.statusCode === 201
      ? `Funder limitation accepted for ${coverageDimensionKey}.`
      : errorText(result));
    if (result.statusCode === 200 || result.statusCode === 201) await loadTraceability(selectedClaimId);
  }, [organizationId, selectedClaimId, coverageDimensionKey, workflowPending, loadTraceability]);

  const selectedDimensionAcceptance = useMemo(() => {
    const dimension = traceability?.dimensions?.find((entry) => entry.dimensionKey === coverageDimensionKey);
    if (!dimension) return "unknown";
    return `internal: ${dimension.internalLimitationAccepted ? "accepted" : "not accepted"}`
      + ` · funder: ${dimension.funderLimitationAccepted ? "accepted" : "not accepted"}`;
  }, [traceability, coverageDimensionKey]);

  const evidenceDecisionValidationError = useMemo(
    () => evidenceReviewDecisionValidationError({ decision: evidenceDecision, limitationNotes: evidenceLimitationNotesText }),
    [evidenceDecision, evidenceLimitationNotesText],
  );

  const claimDecisionValidationError = useMemo(
    () => claimReviewDecisionValidationError({
      decision: claimDecision,
      limitationNotes: claimLimitationNotesText,
      approvedAudiences: claimApprovedAudiences,
    }),
    [claimDecision, claimLimitationNotesText, claimApprovedAudiences],
  );

  const runCompleteEvidenceReview = useCallback(async () => {
    if (!organizationId || !traceability?.evidence || workflowPending) return;
    if (!canCompleteEvidenceReview(traceability.evidence, traceability.evidenceReviewDecision)) return;
    if (evidenceDecisionValidationError) return;
    setWorkflowPending(true);
    setWorkflowResult("");
    const result = await postJson(
      evidenceReviewCompletePath(organizationId, traceability.evidence.evidence_item_id, traceability.evidence.review_queue_item_id),
      evidenceReviewDecisionBody({
        expectedUpdatedAt: traceability.evidence.updated_at,
        decision: evidenceDecision,
        limitationNotes: evidenceLimitationNotesText,
      }),
    );
    setWorkflowPending(false);
    setWorkflowResult(result.statusCode === 200
      ? `Evidence review decision recorded: ${evidenceDecision}.`
      : errorText(result));
    if (result.statusCode === 200) {
      setEvidenceDecision("");
      setEvidenceLimitationNotesText("");
      await loadTraceability(selectedClaimId);
    }
  }, [
    organizationId,
    traceability,
    selectedClaimId,
    workflowPending,
    loadTraceability,
    evidenceDecision,
    evidenceLimitationNotesText,
    evidenceDecisionValidationError,
  ]);

  const runCompleteClaimReview = useCallback(async () => {
    if (!organizationId || !selectedClaimId || !traceability?.claimReview || workflowPending) return;
    if (!canCompleteClaimReview(traceability.evidence, traceability.claimReview, traceability.evidenceReviewDecision, traceability.claimReviewDecision)) return;
    if (claimDecisionValidationError) return;
    setWorkflowPending(true);
    setWorkflowResult("");
    const result = await postJson(
      claimReviewCompletePath(organizationId, selectedClaimId, traceability.claimReview.review_queue_item_id),
      claimReviewDecisionBody({
        expectedUpdatedAt: traceability.claimReview.updated_at,
        decision: claimDecision,
        limitationNotes: claimLimitationNotesText,
        approvedAudiences: claimApprovedAudiences,
      }),
    );
    setWorkflowPending(false);
    setWorkflowResult(result.statusCode === 200
      ? `Claim review decision recorded: ${claimDecision}.`
      : errorText(result));
    if (result.statusCode === 200) {
      setClaimDecision("");
      setClaimLimitationNotesText("");
      setClaimApprovedAudiences([]);
      await loadTraceability(selectedClaimId);
    }
  }, [
    organizationId,
    selectedClaimId,
    traceability,
    workflowPending,
    loadTraceability,
    claimDecision,
    claimLimitationNotesText,
    claimApprovedAudiences,
    claimDecisionValidationError,
  ]);

  // Claim traceability still surfaces the profile id (kept exactly as before,
  // for traceability metadata / readback), and still feeds the one canonical
  // review card when a claim is what led the reviewer here - but it is no
  // longer the only way to populate `selectedSensitivityProfileId`: see the
  // pre-claim review-queue selection above/below.
  useEffect(() => {
    const candidateProfileId = traceability?.candidate?.intake_sensitivity_profile_id || "";
    if (candidateProfileId) setSelectedSensitivityProfileId(candidateProfileId);
  }, [traceability]);

  const intakeSensitivityProfileId = selectedSensitivityProfileId;

  const loadSensitivityDetail = useCallback(async () => {
    if (!organizationId || !intakeSensitivityProfileId) return;
    setSensitivityLoading(true);
    setSensitivityError("");
    const result = await getJson(sensitivityProfilePath(organizationId, intakeSensitivityProfileId));
    setSensitivityLoading(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setSensitivityDetail(null);
      setSensitivityError(errorText(result));
      return;
    }
    setSensitivityDetail(projectSensitivityDetail(result.body.data));
  }, [organizationId, intakeSensitivityProfileId]);

  // The GK-only detail route is fetched ONLY once the server-grounded
  // capability check has positively confirmed this actor may manage
  // sensitivity review. `sensitivityCapability === true` guards this
  // deliberately (never `!== false`, so "still loading" never fetches).
  useEffect(() => {
    setSensitivityDetail(null);
    setSensitivityError("");
    setSensitivityActionResult("");
    if (sensitivityCapability === true && intakeSensitivityProfileId) {
      loadSensitivityDetail();
    }
  }, [sensitivityCapability, intakeSensitivityProfileId, loadSensitivityDetail]);

  // A re-review starts from the current decision's own reviewed facts rather
  // than a blank form; a first-ever review starts from the all-"unknown"/
  // all-false default. Either way this only ever seeds the form - it is
  // never treated as itself being the current decision.
  useEffect(() => {
    const current = sensitivityDetail?.currentDecision;
    if (!current) {
      setSensitivityFormState(defaultSensitivityReviewFormState());
      return;
    }
    const seeded = defaultSensitivityReviewFormState();
    for (const field of SENSITIVITY_PRESENCE_FIELDS) seeded[field] = current[field] ?? "unknown";
    seeded[SENSITIVITY_ALLOWED_USE_FIELD] = current[SENSITIVITY_ALLOWED_USE_FIELD] ?? "unknown";
    for (const field of SENSITIVITY_PERMISSION_FIELDS) seeded[field] = current[field] === true;
    setSensitivityFormState(seeded);
  }, [sensitivityDetail]);

  const startSensitivityReviewWork = useCallback(async () => {
    if (!organizationId || !intakeSensitivityProfileId || sensitivityActionPending) return;
    setSensitivityActionPending(true);
    setSensitivityActionResult("");
    const result = await postJson(sensitivityReviewWorkPath(organizationId, intakeSensitivityProfileId), {});
    setSensitivityActionPending(false);
    setSensitivityActionResult(result.statusCode === 200 || result.statusCode === 201
      ? "Sensitivity review work started."
      : errorText(result));
    // Never treat the POST response as the durable state - always refetch
    // and render only what the server returns on read.
    await loadSensitivityDetail();
  }, [organizationId, intakeSensitivityProfileId, sensitivityActionPending, loadSensitivityDetail]);

  const submitSensitivityDecision = useCallback(async (decision) => {
    const queueItem = sensitivityDetail?.reviewQueueItem;
    if (!organizationId || !intakeSensitivityProfileId || !queueItem || sensitivityActionPending) return;
    setSensitivityActionPending(true);
    setSensitivityActionResult("");
    const result = await postJson(
      sensitivityDecisionPath(organizationId, intakeSensitivityProfileId),
      buildSensitivityDecisionRequestBody({
        decision,
        expectedUpdatedAt: queueItem.updated_at,
        reviewQueueItemId: queueItem.review_queue_item_id,
        formState: sensitivityFormState,
      }),
    );
    setSensitivityActionPending(false);
    if (result.statusCode === 200) {
      setSensitivityActionResult(decision === "reviewed" ? "Review recorded." : "Marked as needing more information.");
    } else if (result.statusCode === 409) {
      setSensitivityActionResult("Sensitivity review state changed since this was loaded - showing the refreshed state.");
    } else {
      setSensitivityActionResult(errorText(result));
    }
    // No auto-retry on conflict, no optimistic UI on success: always refetch
    // and render only the server's authoritative current state.
    await loadSensitivityDetail();
  }, [organizationId, intakeSensitivityProfileId, sensitivityDetail, sensitivityActionPending, sensitivityFormState, loadSensitivityDetail]);

  return (
    <section>
      <h1 className="admin-title mb-3">Impact Evidence Library</h1>
      <div className="admin-card mb-3">
        <div className="row g-3 align-items-end">
          <div className="col-12 col-lg-5">
            <label className="form-label small fw-semibold">Organization</label>
            {loadingOrganizations ? (
              <div className="small text-muted">Loading your organizations...</div>
            ) : organizationsLoaded && organizations.length === 0 ? (
              <div className="small text-muted">No KAI organization is available for this account.</div>
            ) : (
              <select
                className="form-select form-select-sm"
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
                disabled={organizations.length <= 1}
              >
                {organizations.length > 1 ? <option value="">Select an organization</option> : null}
                {organizations.map((item) => (
                  <option key={item.organization_id} value={item.organization_id}>{item.organization_id}</option>
                ))}
              </select>
            )}
          </div>
          <div className="col-12 col-lg-4">
            <label className="form-label small fw-semibold">Engagement</label>
            {!organizationId ? (
              <div className="small text-muted">Select an organization first.</div>
            ) : loadingEngagements ? (
              <div className="small text-muted">Loading engagements...</div>
            ) : engagementsLoaded && engagements.length === 0 ? (
              <div className="small text-muted">No engagement is available for this organization.</div>
            ) : (
              <select
                className="form-select form-select-sm"
                value={engagementId}
                onChange={(event) => setEngagementId(event.target.value)}
                disabled={engagements.length <= 1}
              >
                {engagements.length > 1 ? <option value="">Select an engagement</option> : null}
                {engagements.map((item) => (
                  <option key={item.engagement_id} value={item.engagement_id}>{item.engagement_id}</option>
                ))}
              </select>
            )}
          </div>
          <div className="col-12 col-lg-4">
            <label className="form-label small fw-semibold">Audience</label>
            <select className="form-select form-select-sm" value={audience} onChange={(event) => setAudience(event.target.value)}>
              {LIBRARY_AUDIENCES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="col-12 col-lg-3">
            <button
              type="button"
              className="btn btn-sm btn-primary w-100"
              onClick={loadClaims}
              disabled={loadingCandidateClaims || loadingEligibleClaims}
            >
              {loadingCandidateClaims || loadingEligibleClaims ? "Loading..." : "Load claims"}
            </button>
          </div>
        </div>
      </div>

      <ImpactLibraryKai organizationId={organizationId} engagementId={engagementId} />

      {organizationId ? (
        <KaiWebIntake
          organizationId={organizationId}
          embedded
          onSensitivityProfileDiscovered={handleSensitivityProfileDiscoveredFromIntake}
        />
      ) : null}

      {message ? <div className="alert alert-warning py-2">{message}</div> : null}

      <div className="admin-card mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h5 className="mb-0">Gaps and Risks</h5>
          <span className="text-muted small">
            {organizationGapsAndRisks.gapItems.length
              + organizationGapsAndRisks.coverageFindings.length
              + organizationGapsAndRisks.conflicts.length
              + organizationGapsAndRisks.followups.length} shown
          </span>
        </div>
        <div className="small text-muted mb-2">
          This organization's current governed evidence-health problems - gaps, coverage findings, potential
          conflicts, and client follow-ups still outstanding - discoverable without selecting a claim first. Every
          item below is server-determined as current directly from the same governed, freshly-recomputed
          claim-traceability state as the Review Queue below; this page never decides for itself whether a gap,
          conflict, or follow-up is current.
        </div>
        {reviewQueueError ? <div className="alert alert-warning py-2 small">{reviewQueueError}</div> : null}
        {loadingReviewQueue ? <div className="text-muted small">Loading organization evidence health...</div> : null}
        {!loadingReviewQueue && !reviewQueueError && !reviewQueueIsComplete(reviewQueueCompleteness) ? (
          <div className="alert alert-warning py-2 small">
            This result is incomplete
            {reviewQueueCompleteness.truncated ? " - the organization has more claims than this rollup scanned" : ""}
            {reviewQueueCompleteness.evaluationErrorCount > 0
              ? `${reviewQueueCompleteness.truncated ? ";" : " -"} ${reviewQueueCompleteness.evaluationErrorCount} claim(s) could not be evaluated`
              : ""}
            . The gaps and risks shown below are not confirmed to be the organization's complete current set.
          </div>
        ) : null}
        {!loadingReviewQueue && !reviewQueueError && gapsAndRisksConclusivelyEmpty ? (
          <div className="text-muted small">No current evidence-health gaps, conflicts, or follow-up items for this organization.</div>
        ) : null}
        {!loadingReviewQueue && !reviewQueueError ? (
          <div className="row g-2">
            <div className="col-12 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="d-flex justify-content-between align-items-center">
                  <span className="small fw-semibold">Gaps</span>
                  <span className="badge text-bg-secondary">{organizationGapsAndRisks.gapItems.length}</span>
                </div>
                <ul className="list-unstyled mt-1 mb-0">
                  {organizationGapsAndRisks.gapItems.map((gap) => (
                    <li key={gap.gapLogItemId} className="small d-flex justify-content-between align-items-center gap-2 mt-1">
                      <span className="text-break">{gap.dimensionKey}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary flex-shrink-0"
                        onClick={() => {
                          setSelectedClaimId(gap.claimId);
                          traceabilityPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          traceabilityPanelRef.current?.focus();
                        }}
                      >
                        Review claim
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="col-12 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="d-flex justify-content-between align-items-center">
                  <span className="small fw-semibold">Coverage findings</span>
                  <span className="badge text-bg-secondary">{organizationGapsAndRisks.coverageFindings.length}</span>
                </div>
                <ul className="list-unstyled mt-1 mb-0">
                  {organizationGapsAndRisks.coverageFindings.map((finding) => (
                    <li key={`${finding.claimId}-${finding.dimensionKey}`} className="small d-flex justify-content-between align-items-center gap-2 mt-1">
                      <span className="text-break">{finding.dimensionKey}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary flex-shrink-0"
                        onClick={() => {
                          setSelectedClaimId(finding.claimId);
                          traceabilityPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          traceabilityPanelRef.current?.focus();
                        }}
                      >
                        Review claim
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="col-12 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="d-flex justify-content-between align-items-center">
                  <span className="small fw-semibold">Potential conflicts</span>
                  <span className="badge text-bg-secondary">{organizationGapsAndRisks.conflicts.length}</span>
                </div>
                <ul className="list-unstyled mt-1 mb-0">
                  {organizationGapsAndRisks.conflicts.map((conflict) => (
                    <li key={conflict.conflictGroupId} className="small d-flex justify-content-between align-items-center gap-2 mt-1">
                      <span className="text-break">{conflict.basisCode}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary flex-shrink-0"
                        onClick={() => {
                          setSelectedClaimId(conflict.claimId);
                          traceabilityPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          traceabilityPanelRef.current?.focus();
                        }}
                      >
                        Review claim
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="col-12 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="d-flex justify-content-between align-items-center">
                  <span className="small fw-semibold">Client follow-ups</span>
                  <span className="badge text-bg-secondary">{organizationGapsAndRisks.followups.length}</span>
                </div>
                <ul className="list-unstyled mt-1 mb-0">
                  {organizationGapsAndRisks.followups.map((followup) => (
                    <li key={followup.clientFollowupItemId} className="small d-flex justify-content-between align-items-center gap-2 mt-1">
                      <span className="text-break">{followup.dimensionKey}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary flex-shrink-0"
                        onClick={() => {
                          setSelectedClaimId(followup.claimId);
                          traceabilityPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          traceabilityPanelRef.current?.focus();
                        }}
                      >
                        Review claim
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="admin-card mb-3">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h5 className="mb-0">Review Queue</h5>
          <span className="text-muted small">{reviewQueueItems.length} shown</span>
        </div>
        <div className="small text-muted mb-2">
          What currently needs attention for this organization, recomputed from the claim's current governed
          state - not merely which review-queue rows are still open. A resolved review or work-queue row does
          not remove a claim from this list while a substantive human review decision, coverage acceptance, or
          client follow-up is still outstanding.
        </div>
        {reviewQueueError ? <div className="alert alert-warning py-2 small">{reviewQueueError}</div> : null}
        {loadingReviewQueue ? <div className="text-muted small">Loading review queue...</div> : null}
        {!loadingReviewQueue && !reviewQueueError && !reviewQueueIsComplete(reviewQueueCompleteness) ? (
          <div className="alert alert-warning py-2 small">
            This result is incomplete
            {reviewQueueCompleteness.truncated ? " - the organization has more claims than this rollup scanned" : ""}
            {reviewQueueCompleteness.evaluationErrorCount > 0
              ? `${reviewQueueCompleteness.truncated ? ";" : " -"} ${reviewQueueCompleteness.evaluationErrorCount} claim(s) could not be evaluated`
              : ""}
            . The claims shown below are not confirmed to be the organization's complete current-attention set.
          </div>
        ) : null}

        {sensitivityAttention.status !== "unavailable" ? (
          <div className="border rounded p-2 mb-2">
            <div className="d-flex justify-content-between align-items-center">
              <span className="small fw-semibold">Sensitivity / allowed-use</span>
              {sensitivityAttention.status === "ready" ? (
                <span className="badge text-bg-secondary">{sensitivityAttention.items.length}</span>
              ) : null}
            </div>
            {sensitivityAttention.status === "loading" ? (
              <div className="text-muted small">Loading sensitivity &amp; allowed-use review...</div>
            ) : null}
            {sensitivityAttention.status === "error" ? (
              <div className="alert alert-warning py-2 small mb-0 mt-1">{sensitivityAttention.error}</div>
            ) : null}
            {sensitivityAttention.status === "ready" && sensitivityAttention.items.length === 0 ? (
              <div className="text-muted small">No current sensitivity / allowed-use work.</div>
            ) : null}
            {sensitivityAttention.status === "ready" && sensitivityAttention.items.length > 0 ? (
              <ul className="list-unstyled mt-1 mb-0">
                {sensitivityAttention.items.map((item) => (
                  <li
                    key={item.reviewQueueItemId}
                    className="d-flex justify-content-between align-items-center gap-2 mt-1"
                  >
                    <span className="small text-break">{item.summary || item.intakeSensitivityProfileId}</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary flex-shrink-0"
                      onClick={() => setSelectedSensitivityProfileId(item.intakeSensitivityProfileId)}
                    >
                      Review sensitivity &amp; allowed use
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {reviewQueueConclusivelyEmpty ? (
          <div className="text-muted small">Nothing currently needs attention for this organization.</div>
        ) : null}
        <ul className="list-group">
          {reviewQueueItems.map((item) => (
            <li key={item.claimId} className="list-group-item">
              <div className="d-flex justify-content-between align-items-start gap-2">
                <span className="small text-break fw-semibold">Claim {item.claimId}</span>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary flex-shrink-0"
                  onClick={() => {
                    setSelectedClaimId(item.claimId);
                    traceabilityPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    traceabilityPanelRef.current?.focus();
                  }}
                >
                  Review this claim
                </button>
              </div>
              <ul className="list-unstyled mt-2 mb-0">
                {item.blockerCodes.map((blockerCode) => {
                  const actionability = reviewQueueBlockerActionability(blockerCode, item);
                  const badgeClass =
                    actionability === "ACTION_REQUIRED"
                      ? "text-bg-warning"
                      : actionability === "WAITING"
                        ? "text-bg-info"
                        : "text-bg-secondary";
                  return (
                    <li key={blockerCode} className="small d-flex align-items-center gap-2 mt-1">
                      <span className={`badge ${badgeClass}`}>{actionability}</span>
                      <span>{blockerDisplayText(blockerCode, item.requestedAudience || audience)}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <div className="row g-3">
        <div className="col-12 col-xl-5">
          <div className="admin-card">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Claims</h5>
              <span className="text-muted small">{claims.length} shown</span>
            </div>
            {candidateClaimsError ? (
              <div className="alert alert-warning py-2 small">Claim Library: {candidateClaimsError}</div>
            ) : null}
            {eligibleClaimsError ? (
              <div className="alert alert-warning py-2 small">
                {audience} audience eligibility is currently unavailable: {eligibleClaimsError}
              </div>
            ) : null}
            {loadingCandidateClaims ? <div className="text-muted">Loading governed Claim Library...</div> : null}
            {loadingEligibleClaims ? <div className="text-muted">Checking {audience} audience eligibility...</div> : null}
            {!loadingCandidateClaims && !loadingEligibleClaims && claims.length === 0 ? (
              <div className="text-muted">No governed or review-candidate claims returned.</div>
            ) : null}
            <div className="list-group">
              {claims.map((claim) => (
                <button
                  type="button"
                  key={claim.claimId}
                  className={`list-group-item list-group-item-action ${claim.claimId === selectedClaimId ? "active" : ""}`}
                  onClick={() => setSelectedClaimId(claim.claimId)}
                >
                  <div className="d-flex justify-content-between gap-2">
                    <span className="text-break">{claim.claimId}</span>
                    <StatusBadge status={claim.libraryStatus} />
                  </div>
                  {canSelectClaimForInternalGeneration(claim, audience) ? (
                    <div className="form-check small mt-2" onClick={(event) => event.stopPropagation()}>
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={selectedGenerationClaimIds.includes(claim.claimId)}
                        onChange={() => toggleGenerationClaim(claim)}
                      />
                      <span className="form-check-label">Include in evidence summary</span>
                    </div>
                  ) : null}
                  {canSelectClaimForFunderGeneration(claim, audience) ? (
                    <div className="form-check small mt-2" onClick={(event) => event.stopPropagation()}>
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={selectedFunderGenerationClaimIds.includes(claim.claimId)}
                        onChange={() => toggleFunderGenerationClaim(claim)}
                      />
                      <span className="form-check-label">Include in funder evidence summary</span>
                    </div>
                  ) : null}
                  <div className="small mt-1">
                    {claim.claimType || "claim"} · {claim.claimReviewStatus || claim.claimStatus || "status unknown"}
                  </div>
                  <div className="small mt-1">
                    Governed internal availability: {claim.governedAvailable ? "internally available (governed)" : "not in current governed result"}
                  </div>
                  <div className="small mt-1">
                    {audience} audience eligibility:{" "}
                    {claim.audienceEligibility === "eligible"
                      ? "eligible"
                      : claim.audienceEligibility === "not_eligible"
                        ? "not currently eligible"
                        : "eligibility unavailable"}
                  </div>
                  {claim.reviewQueueItems?.length ? (
                    <div className="small mt-1">
                      Review queues: {claim.reviewQueueItems.map((item) => `${item.queueType}/${item.queueStatus}`).join(", ")}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
            {audience === "internal" ? (
              <button
                type="button"
                className="btn btn-sm btn-primary mt-3 w-100"
                onClick={generateEvidenceSummary}
                disabled={generatingDraft || selectedGenerationClaimIds.length === 0 || !engagementId}
              >
                {generatingDraft ? "Generating..." : "Generate evidence summary"}
              </button>
            ) : null}
            {audience === "internal" ? (
              <button
                type="button"
                className="btn btn-sm btn-outline-primary mt-2 w-100"
                onClick={generateImpactNarrative}
                disabled={generatingDraft || selectedGenerationClaimIds.length === 0 || !engagementId}
              >
                {generatingDraft ? "Generating..." : "Generate Impact Narrative"}
              </button>
            ) : null}
            {audience === "funder" ? (
              <button
                type="button"
                className="btn btn-sm btn-primary mt-3 w-100"
                onClick={generateFunderEvidenceSummary}
                disabled={generatingDraft || selectedFunderGenerationClaimIds.length === 0 || !engagementId}
              >
                {generatingDraft ? "Generating..." : "Generate funder evidence summary"}
              </button>
            ) : null}
          </div>

          <div className="admin-card mt-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">KAI Baseline Readiness</h5>
              <span className="text-muted small">{requirementsReadiness.length} shown</span>
            </div>
            <div className="text-muted small mb-2">
              Generic KAI baseline requirements, organization-wide - independent of the selected engagement and never a
              specific funder/framework/report's requirements.
            </div>
            {requirementsReadinessError ? (
              <div className="alert alert-warning py-2 small">{requirementsReadinessError}</div>
            ) : null}
            {loadingRequirementsReadiness ? <div className="text-muted small">Loading requirements readiness...</div> : null}
            {!loadingRequirementsReadiness && requirementsReadiness.length === 0 ? (
              <div className="text-muted small">No baseline requirements are currently governed for this organization.</div>
            ) : null}
            <ul className="list-group">
              {requirementsReadiness.map((requirement) => (
                <li key={requirement.requirementId} className="list-group-item">
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <div>
                      <div className="small fw-semibold">{requirement.requirementLabel || requirement.requirementKey}</div>
                      <div className="text-muted small">{requirement.requirementKey}</div>
                    </div>
                    <span className={`badge ${requirement.assessed && requirement.assessmentState === "satisfied" ? "text-bg-success" : requirement.assessed ? "text-bg-warning" : "text-bg-secondary"}`}>
                      {requirement.assessed ? requirement.assessmentState || "assessed" : "needs assessment"}
                    </span>
                  </div>
                  {requirement.requirementDescription ? (
                    <div className="small mt-2">{requirement.requirementDescription}</div>
                  ) : null}
                  <div className="small text-muted mt-2">
                    Source: {requirement.requirementSource.sourceName || requirement.requirementSource.sourceCode || "none"}
                    {requirement.requirementSource.sourceType ? ` (${requirement.requirementSource.sourceType})` : ""}
                  </div>
                  <div className="small text-muted">
                    Framework: {requirement.requirementFrameworkVersion.frameworkName || requirement.requirementFrameworkVersion.frameworkCode || "none"}
                    {requirement.requirementFrameworkVersion.versionLabel ? ` ${requirement.requirementFrameworkVersion.versionLabel}` : ""}
                    {requirement.requirementFrameworkVersion.frameworkStatus ? ` · ${requirement.requirementFrameworkVersion.frameworkStatus}` : ""}
                  </div>
                  <div className="small text-muted">
                    Set: {requirement.requirementSet.setName || requirement.requirementSet.setKey || "none"}
                  </div>
                  {requirement.assessed ? (
                    <>
                      <div className="small text-muted mt-2">{requirement.assessmentExplanation || "No explanation returned."}</div>
                      <div className="small text-muted mt-1">
                        Provenance: {requirement.assessmentProvenance?.evidenceItemIds.length || 0} evidence
                        {" · "}{requirement.assessmentProvenance?.claimIds.length || 0} claims
                        {" · "}{requirement.assessmentProvenance?.currentGapLogItemIds.length || 0} current gaps
                        {" · "}{(requirement.assessmentProvenance?.evidenceReviewDecisionIds.length || 0) + (requirement.assessmentProvenance?.claimReviewDecisionIds.length || 0)} review decisions
                      </div>
                      <div className="small text-muted">
                        Assessment: {requirement.assessmentId || "none"}
                        {requirement.assessedAt ? ` · ${requirement.assessedAt}` : ""}
                      </div>
                    </>
                  ) : (
                    <div className="small text-muted mt-1">
                      Not yet assessed against the organization's current governed evidence and claims, or a prior
                      assessment is now stale.
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary mt-2"
                    onClick={() => runAssessRequirement(requirement.requirementId)}
                    disabled={Boolean(assessingRequirementId)}
                  >
                    {assessingRequirementId === requirement.requirementId ? "Assessing..." : "Assess now"}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="admin-card mt-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Funder Requirements</h5>
              {funderRequirements.state === ENGAGEMENT_FUNDER_REQUIREMENTS_STATES.applicableRequirementSetAssessmentNotAvailable ? (
                <span className="text-muted small">{funderRequirements.requirements.length} shown</span>
              ) : null}
            </div>
            <div className="text-muted small mb-2">
              The selected engagement's own applicable external funder/framework/reporting requirements - never the
              generic KAI baseline requirements shown above.
            </div>
            {!engagementId ? (
              <div className="text-muted small">Select an engagement to see its Funder Requirements.</div>
            ) : (
              <>
                {funderRequirementsError ? (
                  <div className="alert alert-warning py-2 small">{funderRequirementsError}</div>
                ) : null}
                {loadingFunderRequirements ? <div className="text-muted small">Loading Funder Requirements...</div> : null}
                {!loadingFunderRequirements && !funderRequirementsError && funderRequirements.state === ENGAGEMENT_FUNDER_REQUIREMENTS_STATES.noTargetSelected ? (
                  <div className="text-muted small">
                    No funder/framework/report target is selected for this engagement yet.
                  </div>
                ) : null}
                {!loadingFunderRequirements && !funderRequirementsError && funderRequirements.state === ENGAGEMENT_FUNDER_REQUIREMENTS_STATES.targetSelectedNoAuthoritativeRequirementSet ? (
                  <div className="text-muted small">
                    The selected target has no current governed external requirement set.
                  </div>
                ) : null}
                {!loadingFunderRequirements && !funderRequirementsError && funderRequirements.state === ENGAGEMENT_FUNDER_REQUIREMENTS_STATES.authoritativeRequirementSetNotApplicable ? (
                  <div className="text-muted small">
                    A governed external requirement set exists for this target, but it is not currently confirmed
                    applicable for this engagement.
                  </div>
                ) : null}
                {!loadingFunderRequirements && !funderRequirementsError && funderRequirements.state === ENGAGEMENT_FUNDER_REQUIREMENTS_STATES.applicableRequirementSetAssessmentNotAvailable ? (
                  <ul className="list-group">
                    {funderRequirements.requirements.map((requirement) => (
                      <li key={requirement.requirementId} className="list-group-item">
                        <div className="d-flex justify-content-between align-items-start gap-2">
                          <div>
                            <div className="small fw-semibold">{requirement.requirementKey}</div>
                            <div className="text-muted small">
                              {requirement.requirementSource.sourceCode || "none"}
                              {requirement.requirementSource.sourceType ? ` (${requirement.requirementSource.sourceType})` : ""}
                              {" · "}{requirement.requirementFrameworkVersion.frameworkCode || "none"}
                              {requirement.requirementFrameworkVersion.versionLabel ? ` ${requirement.requirementFrameworkVersion.versionLabel}` : ""}
                            </div>
                          </div>
                          <span className={`badge ${requirement.currentAssessment?.assessmentState === "satisfied" ? "text-bg-success" : requirement.currentAssessment ? "text-bg-warning" : "text-bg-secondary"}`}>
                            {requirement.currentAssessment ? requirement.currentAssessment.assessmentState || "assessed" : "no current assessment"}
                          </span>
                        </div>
                        {requirement.currentAssessment ? (
                          <>
                            <div className="small text-muted mt-2">{requirement.currentAssessment.assessmentExplanation || "No explanation returned."}</div>
                            <div className="small text-muted">
                              Assessment: {requirement.currentAssessment.requirementAssessmentId || "none"}
                              {requirement.currentAssessment.assessedAt ? ` · ${requirement.currentAssessment.assessedAt}` : ""}
                            </div>
                          </>
                        ) : (
                          <div className="small text-muted mt-1">
                            No current engagement-specific assessment for this requirement.
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          <div className="admin-card mt-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Grant Response Packet</h5>
              <span className="badge text-bg-secondary">Audience: Funder</span>
            </div>
            <div className="text-muted small mb-2">
              A read-only, engagement-scoped regrouping of already-governed, funder-audience
              generated drafts for the selected engagement - membership, review state, and
              eligibility are all resolved server-side; this section grants no approval or
              export/finalization authority of its own.
            </div>
            {engagementId ? (
              <div className="small mb-2">
                <a
                  className="btn btn-sm btn-outline-secondary grant-response-packet-preview-markdown-link"
                  href={grantResponsePacketMarkdownPath(organizationId, engagementId)}
                >
                  Download Markdown preview
                </a>
                <div className="text-muted mt-1">
                  Preview only - a read-only draft representation. Downloading it grants no
                  export or release authority.
                </div>
              </div>
            ) : null}
            {engagementId ? (
              <div className="small mb-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary grant-response-packet-export-candidate-button"
                  disabled={grantResponsePacketExportCandidatePending}
                  onClick={createGrantResponsePacketExportCandidate}
                >
                  {grantResponsePacketExportCandidatePending ? "Creating export candidate..." : "Create export candidate"}
                </button>
                <div className="text-muted mt-1">
                  Creates (or reuses, if nothing has changed) a packet export candidate.
                  Grants no approval, funder/public readiness, export authority, final
                  release, or manifest.
                </div>
                {grantResponsePacketExportCandidateError ? (
                  <div className="alert alert-warning py-2 small mt-1">{grantResponsePacketExportCandidateError}</div>
                ) : null}
                {grantResponsePacketExportCandidateResult ? (
                  <div className="small mt-1">
                    <ValueRow
                      label="Export candidate id"
                      value={grantResponsePacketExportCandidateResult.grantResponsePacketExportCandidateId}
                    />
                    <ValueRow
                      label="Member count"
                      value={grantResponsePacketExportCandidateResult.memberCount}
                    />
                    <ValueRow
                      label="Reused existing candidate"
                      value={String(grantResponsePacketExportCandidateResult.replayed)}
                    />
                  </div>
                ) : null}
                {grantResponsePacketExportCandidateResult ? (
                  <div className="mt-2">
                    {grantResponsePacketExportReviewLifecycleState(grantResponsePacketExportReviewResult)
                      === GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.requestable ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary grant-response-packet-export-review-request-button"
                          disabled={grantResponsePacketExportReviewPending}
                          onClick={requestGrantResponsePacketExportReview}
                        >
                          {grantResponsePacketExportReviewPending
                            ? "Requesting export review..."
                            : "Request export review"}
                        </button>
                        <div className="text-muted mt-1">
                          Requests governed export review for this exact export candidate.
                          Grants no approval, export authority, final release, or manifest.
                        </div>
                        {grantResponsePacketExportReviewError ? (
                          <div className="alert alert-warning py-2 small mt-1">{grantResponsePacketExportReviewError}</div>
                        ) : null}
                      </>
                    ) : null}
                    {grantResponsePacketExportReviewResult ? (
                      <div className="small mt-1">
                        <ValueRow
                          label="Review queue item id"
                          value={grantResponsePacketExportReviewResult.reviewQueueItemId}
                        />
                        <ValueRow
                          label="Queue status"
                          value={grantResponsePacketExportReviewResult.queueStatus}
                        />
                        <ValueRow
                          label="Review status"
                          value={grantResponsePacketExportReviewResult.reviewStatus}
                        />
                        <ValueRow
                          label="Reused existing review request"
                          value={String(grantResponsePacketExportReviewResult.replayed)}
                        />
                      </div>
                    ) : null}
                    {grantResponsePacketExportReviewLifecycleState(grantResponsePacketExportReviewResult)
                      === GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.startable ? (
                      <div className="mt-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary grant-response-packet-export-review-start-button"
                          disabled={grantResponsePacketExportReviewStartPending}
                          onClick={startGrantResponsePacketExportReview}
                        >
                          {grantResponsePacketExportReviewStartPending
                            ? "Starting export review..."
                            : "Start export review"}
                        </button>
                        <div className="text-muted mt-1">
                          Starts the governed human export review of this exact packet export
                          candidate. Grants no final eligibility evaluation, approval, export
                          authority, final release, or manifest.
                        </div>
                        {grantResponsePacketExportReviewStartError ? (
                          <div className="alert alert-warning py-2 small mt-1">{grantResponsePacketExportReviewStartError}</div>
                        ) : null}
                      </div>
                    ) : null}
                    {grantResponsePacketExportReviewLifecycleState(grantResponsePacketExportReviewResult)
                      === GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.completable ? (
                      <div className="mt-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary grant-response-packet-export-review-complete-button"
                          disabled={grantResponsePacketExportReviewCompletePending}
                          onClick={completeGrantResponsePacketExportReview}
                        >
                          {grantResponsePacketExportReviewCompletePending
                            ? "Completing export review..."
                            : "Complete export review"}
                        </button>
                        <div className="text-muted mt-1">
                          Completes the governed human export review of this exact packet
                          export candidate - review complete only. Not final export
                          eligibility, approval for external use, funder-readiness,
                          final-release authorization, or a manifest.
                        </div>
                        {grantResponsePacketExportReviewCompleteError ? (
                          <div className="alert alert-warning py-2 small mt-1">{grantResponsePacketExportReviewCompleteError}</div>
                        ) : null}
                      </div>
                    ) : null}
                    {grantResponsePacketExportReviewLifecycleState(grantResponsePacketExportReviewResult)
                      === GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.resolved ? (
                      <div className="mt-2">
                        <span className="badge text-bg-success grant-response-packet-export-review-resolved-badge">
                          Export review complete
                        </span>
                        <div className="text-muted mt-1">
                          Review complete only - not final export eligibility, approval for
                          external use, funder-readiness, final-release authorization, or a
                          manifest.
                        </div>
                      </div>
                    ) : null}
                    {grantResponsePacketExportReviewLifecycleState(grantResponsePacketExportReviewResult)
                      === GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.resolved ? (
                      <div className="mt-2">
                        {grantResponsePacketFinalReleaseAuthorityControlState(grantResponsePacket)
                          === GRANT_RESPONSE_PACKET_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.grantable ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary grant-response-packet-final-release-authority-grant-button"
                              disabled={grantResponsePacketFinalReleaseAuthorityPending}
                              onClick={() => recordGrantResponsePacketHumanFinalReleaseAuthority("grant")}
                            >
                              {grantResponsePacketFinalReleaseAuthorityPending
                                ? "Granting final release authority..."
                                : "Grant final release authority"}
                            </button>
                            <div className="text-muted mt-1">
                              Records governed gk_admin final-release authority for this exact
                              packet export candidate. Grants no manifest or final packet bytes.
                            </div>
                          </>
                        ) : null}
                        {grantResponsePacketFinalReleaseAuthorityControlState(grantResponsePacket)
                          === GRANT_RESPONSE_PACKET_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.revocable ? (
                          <>
                            <span className="badge text-bg-success grant-response-packet-final-release-authority-granted-badge">
                              Final release authority granted
                            </span>
                            <div className="mt-2">
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary grant-response-packet-final-release-authority-revoke-button"
                                disabled={grantResponsePacketFinalReleaseAuthorityPending}
                                onClick={() => recordGrantResponsePacketHumanFinalReleaseAuthority("revoke")}
                              >
                                {grantResponsePacketFinalReleaseAuthorityPending
                                  ? "Revoking final release authority..."
                                  : "Revoke final release authority"}
                              </button>
                            </div>
                            <div className="text-muted mt-1">
                              Revoking supersedes this exact grant through the same governed
                              workflow - the prior grant row itself is never rewritten or
                              removed.
                            </div>
                          </>
                        ) : null}
                        {grantResponsePacketFinalReleaseAuthorityError ? (
                          <div className="alert alert-warning py-2 small mt-1">{grantResponsePacketFinalReleaseAuthorityError}</div>
                        ) : null}
                        {grantResponsePacket?.finalExportEligible === true ? (
                          <div className="mt-2">
                            <span className="badge text-bg-success grant-response-packet-final-export-eligible-badge">
                              Eligible for final export
                            </span>
                          </div>
                        ) : null}
                        {grantResponsePacket?.finalExportEligible === false ? (
                          <div className="mt-2">
                            <span className="badge text-bg-warning grant-response-packet-final-export-blocked-badge">
                              Not yet eligible for final export
                            </span>
                            {grantResponsePacket.finalExportEligibilityBlockedReasons?.length ? (
                              <ul className="small text-muted mb-0 mt-1">
                                {grantResponsePacket.finalExportEligibilityBlockedReasons.map((reason) => (
                                  <li key={reason}>{reason}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ) : null}
                        {grantResponsePacket?.finalExportEligible === true ? (
                          <div className="mt-2">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary grant-response-packet-prepare-final-markdown-export-button"
                              disabled={grantResponsePacketFinalMarkdownExportManifestPending}
                              onClick={prepareGrantResponsePacketFinalMarkdownExportManifest}
                            >
                              {grantResponsePacketFinalMarkdownExportManifestPending
                                ? "Preparing final Markdown export..."
                                : "Prepare final Markdown export"}
                            </button>
                            <div className="text-muted mt-1">
                              Creates (or reuses, if nothing has changed) the governed FINAL
                              Markdown export manifest for this exact packet export candidate.
                              This is not external publication and grants no external readiness
                              or release status of its own.
                            </div>
                            {grantResponsePacketFinalMarkdownExportManifestError ? (
                              <div className="alert alert-warning py-2 small mt-1">
                                {grantResponsePacketFinalMarkdownExportManifestError}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {grantResponsePacket?.finalDeliveryState?.grantResponsePacketExportManifests?.length ? (
                          <div className="mt-2 grant-response-packet-final-markdown-exports">
                            <div className="fw-semibold small">Final Markdown exports</div>
                            <ul className="small mb-0 ps-3">
                              {[...grantResponsePacket.finalDeliveryState.grantResponsePacketExportManifests]
                                .sort((a, b) => a.grantResponsePacketExportManifestId.localeCompare(
                                  b.grantResponsePacketExportManifestId,
                                ))
                                .map((manifest) => (
                                  <li key={manifest.grantResponsePacketExportManifestId}>
                                    <a
                                      className="grant-response-packet-final-markdown-download-link"
                                      href={grantResponsePacketExportManifestMarkdownPath(
                                        organizationId,
                                        manifest.grantResponsePacketExportManifestId,
                                      )}
                                    >
                                      Download final Markdown
                                    </a>{" "}
                                    <span className="text-muted">
                                      ({manifest.grantResponsePacketExportManifestId})
                                    </span>
                                  </li>
                                ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {!engagementId ? (
              <div className="text-muted small">Select an engagement to see its Grant Response Packet.</div>
            ) : (
              <>
                {loadingGrantResponsePacket ? <div className="text-muted small">Loading Grant Response Packet...</div> : null}
                {!loadingGrantResponsePacket && grantResponsePacketRequestState === "error" ? (
                  <div className="alert alert-warning py-2 small">{grantResponsePacketError}</div>
                ) : null}
                {!loadingGrantResponsePacket && grantResponsePacketRequestState === "success" && grantResponsePacket ? (
                  <>
                    <ValueRow label="Eligible generated drafts" value={grantResponsePacket.drafts.length} />
                    {grantResponsePacket.drafts.length === 0 ? (
                      <div className="text-muted small">
                        No reviewed funder-ready generated content is currently eligible for this Grant Response Packet.
                      </div>
                    ) : (
                      <div className="list-group mt-2">
                        {grantResponsePacket.drafts.map((draft) => (
                          <div key={draft.generatedContentDraftId} className="list-group-item">
                            <div className="d-flex justify-content-between gap-2">
                              <span className="small fw-semibold">{draft.contentType}</span>
                              <span className="badge text-bg-secondary">
                                {generatedDraftReviewLabel(draft.queueStatus, draft.reviewStatus)}
                              </span>
                            </div>
                            <ValueRow label="Draft id" value={draft.generatedContentDraftId} />
                            <ValueRow label="Requested audience" value={draft.requestedAudience} />
                            <ValueRow label="Draft status" value={draft.draftStatus} />
                            <ValueRow label="Current-use eligible" value={String(draft.currentUseEligible)} />
                            {draft.exportReviewVisible && draft.exportReviewQueueItemId ? (
                              <div className="d-flex justify-content-between align-items-center gap-2 mt-1">
                                <span className="badge text-bg-info">
                                  Export review: {draft.exportReviewQueueStatus} / {draft.exportReviewStatus}
                                </span>
                                <a
                                  className="btn btn-sm btn-outline-secondary"
                                  href={gkExportReviewDetailPagePath(
                                    organizationId,
                                    draft.generatedContentDraftId,
                                    draft.exportReviewQueueItemId,
                                  )}
                                >
                                  Open GK Export Review
                                </a>
                              </div>
                            ) : null}
                            {!draft.exportReviewVisible ? (
                              <div className="small text-muted mt-1">Export review unavailable for your role</div>
                            ) : null}
                            {draft.exportReviewVisible && !draft.exportReviewQueueItemId ? (
                              <div className="small text-muted mt-1">No export review</div>
                            ) : null}
                            {generatedDraftExportReviewDisplayState(draft) === EXPORT_REVIEW_DISPLAY_STATES.requestable ? (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-primary mt-2"
                                onClick={() => requestGrantResponsePacketMemberExportReview(draft)}
                                disabled={grantResponsePacketExportReviewRequestPendingDraftId === draft.generatedContentDraftId}
                              >
                                Request Export Review
                              </button>
                            ) : null}
                            <div className="mt-2">
                              <h6 className="mb-1">Existing exports</h6>
                              {!draft.exportReviewVisible ? (
                                <div className="small text-muted">Export history unavailable for your role</div>
                              ) : null}
                              {draft.exportReviewVisible && draft.exportManifestHistory.length === 0 ? (
                                <div className="small text-muted">
                                  No finalized export manifests for this packet member
                                </div>
                              ) : null}
                              {draft.exportReviewVisible && draft.exportManifestHistory.length > 0 ? (
                                <ul className="list-unstyled small mb-0">
                                  {draft.exportManifestHistory.map((entry) => (
                                    <li key={`${draft.generatedContentDraftId}-${entry.exportManifestId}`} className="mb-1">
                                      <div className="text-muted">Created {entry.createdAt}</div>
                                      <div className="d-flex flex-wrap gap-2">
                                        <a
                                          className="grant-response-packet-download-markdown-link"
                                          href={exportManifestMarkdownPath(organizationId, entry.exportManifestId)}
                                        >
                                          Markdown
                                        </a>
                                        <a
                                          className="grant-response-packet-download-csv-link"
                                          href={exportManifestCsvPath(organizationId, entry.exportManifestId)}
                                        >
                                          CSV evidence appendix
                                        </a>
                                        <a
                                          className="grant-response-packet-download-pdf-link"
                                          href={exportManifestPdfPath(organizationId, entry.exportManifestId)}
                                        >
                                          PDF
                                        </a>
                                        <a
                                          className="grant-response-packet-download-docx-link"
                                          href={exportManifestDocxPath(organizationId, entry.exportManifestId)}
                                        >
                                          DOCX
                                        </a>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                            <h6 className="mt-2 mb-1">Blocks</h6>
                            {draft.blocks.map((block) => (
                              <div key={block.ordinal} className="border rounded p-2 mb-2">
                                <div className="small fw-semibold">Block {block.ordinal}</div>
                                <p className="small mb-2">{block.text}</p>
                                <div className="small fw-semibold">Why can KAI say this?</div>
                                {block.citations.map((citation, index) => (
                                  <div
                                    key={`${citation.claimId}-${citation.evidenceItemId}-${index}`}
                                    className="border rounded p-2 mb-1"
                                  >
                                    <ValueRow label="Claim" value={citation.claimId} />
                                    <ValueRow label="Evidence item" value={citation.evidenceItemId} />
                                    <ValueRow label="Source" value={citation.sourceId} />
                                    <ValueRow label="Source version" value={citation.sourceVersionId} />
                                    <ValueRow label="Support strength" value={citation.supportStrength} />
                                    <ValueRow label="Claim review status" value={citation.claimReviewStatus} />
                                    <ValueRow label="Evidence review status" value={citation.evidenceReviewStatus} />
                                    <ValueRow label="Currently eligible" value={String(citation.currentEligible)} />
                                    <ValueRow label="Blocker codes" value={citation.blockerCodes.join(", ") || "none"} />
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : null}
              </>
            )}
          </div>

          <div className="admin-card mt-3 board-reporting-card">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Board Reporting</h5>
              <span className="badge text-bg-secondary">Audience: Internal</span>
            </div>
            <div className="text-muted small mb-2">
              A read-only, engagement-scoped regrouping of already-governed, internal-audience
              generated drafts for the selected engagement - membership, review state, and
              eligibility are all resolved server-side; this section grants no approval or
              export/finalization authority of its own.
            </div>
            {!organizationId || !engagementId ? (
              <div className="text-muted small">Select an organization and engagement to see Board Reporting.</div>
            ) : (
              <>
                {loadingBoardReportingPacket ? <div className="text-muted small">Loading Board Reporting packet...</div> : null}
                {!loadingBoardReportingPacket && boardReportingPacketRequestState === "error" ? (
                  <div className="alert alert-warning py-2 small">{boardReportingPacketError}</div>
                ) : null}
                {!loadingBoardReportingPacket && boardReportingPacketRequestState === "success" && boardReportingPacket ? (
                  <>
                    <ValueRow label="Eligible generated drafts" value={boardReportingPacket.members.length} />
                    {boardReportingPacket.members.length === 0 ? (
                      <div className="text-muted small">
                        No reviewed internal-ready generated content is currently eligible for Board Reporting.
                      </div>
                    ) : (
                      <div className="list-group mt-2">
                        {boardReportingPacket.members.map((member) => (
                          <div key={member.generatedContentDraftId} className="list-group-item">
                            <div className="d-flex justify-content-between gap-2">
                              <span className="small fw-semibold">{member.contentType}</span>
                              <span className="badge text-bg-secondary">
                                {generatedDraftReviewLabel(member.queueStatus, member.reviewStatus)}
                              </span>
                            </div>
                            <ValueRow label="Draft id" value={member.generatedContentDraftId} />
                            <ValueRow label="Requested audience" value={member.requestedAudience} />
                            <ValueRow label="Draft status" value={member.draftStatus} />
                            <ValueRow label="Current-use eligible" value={String(member.currentUseEligible)} />
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : null}

                <div className="small mt-3">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary board-reporting-create-candidate-button"
                    disabled={boardReportingCandidatePending}
                    onClick={createBoardReportingCandidate}
                  >
                    {boardReportingCandidatePending ? "Creating Board Reporting candidate..." : "Create/reuse Board Reporting candidate"}
                  </button>
                  <div className="text-muted mt-1">
                    Creates (or reuses, if nothing has changed) a Board Reporting candidate.
                    Grants no approval, review, authority, eligibility, or manifest state of its
                    own.
                  </div>
                  {boardReportingCandidateError ? (
                    <div className="alert alert-warning py-2 small mt-1">{boardReportingCandidateError}</div>
                  ) : null}
                  {boardReportingCandidateResult ? (
                    <div className="small mt-1">
                      <ValueRow label="Board Reporting candidate id" value={boardReportingCandidateResult.boardReportingCandidateId} />
                      <ValueRow label="Member count" value={boardReportingCandidateResult.memberCount} />
                      <ValueRow label="Reused existing candidate" value={String(boardReportingCandidateResult.replayed)} />
                    </div>
                  ) : null}
                </div>

                {loadingBoardReportingCandidateSnapshot ? (
                  <div className="text-muted small mt-2">Loading Board Reporting candidate snapshot...</div>
                ) : null}
                {boardReportingCandidateSnapshotError ? (
                  <div className="alert alert-warning py-2 small mt-2">{boardReportingCandidateSnapshotError}</div>
                ) : null}
                {boardReportingCandidateSnapshot ? (
                  <div className="mt-2 board-reporting-candidate-snapshot">
                    <div className="fw-semibold small">Candidate snapshot (immutable)</div>
                    <ValueRow label="Candidate status" value={boardReportingCandidateSnapshot.candidateStatus} />
                    <ValueRow label="Created at" value={boardReportingCandidateSnapshot.createdAt} />
                    <ValueRow label="Canonical fingerprint" value={boardReportingCandidateSnapshot.canonicalFingerprint} />
                    <ValueRow label="Member count" value={boardReportingCandidateSnapshot.members.length} />
                  </div>
                ) : null}

                {boardReportingCandidateResult ? (
                  <div className="mt-3 board-reporting-workflow-state">
                    <h6 className="mb-2">Workflow state</h6>
                    {loadingBoardReportingWorkflowState ? (
                      <div className="text-muted small">Loading Board Reporting workflow state...</div>
                    ) : null}
                    {!loadingBoardReportingWorkflowState && boardReportingWorkflowStateRequestState === "error" ? (
                      <div className="alert alert-warning py-2 small">{boardReportingWorkflowStateError}</div>
                    ) : null}
                    {!loadingBoardReportingWorkflowState && boardReportingWorkflowState ? (
                      <>
                        <div className="small">
                          <div className="fw-semibold">Review</div>
                          <ValueRow label="Review queue item id" value={boardReportingWorkflowState.reviewState.reviewQueueItemId} />
                          <ValueRow label="Queue status" value={boardReportingWorkflowState.reviewState.queueStatus} />
                          <ValueRow label="Review status" value={boardReportingWorkflowState.reviewState.reviewStatus} />
                        </div>

                        {boardReportingReviewLifecycleState(boardReportingWorkflowState.reviewState)
                          === BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.requestable ? (
                          <div className="mt-2">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary board-reporting-review-request-button"
                              disabled={boardReportingReviewRequestPending}
                              onClick={requestBoardReportingReview}
                            >
                              {boardReportingReviewRequestPending ? "Requesting review..." : "Request review"}
                            </button>
                            {boardReportingReviewRequestError ? (
                              <div className="alert alert-warning py-2 small mt-1">{boardReportingReviewRequestError}</div>
                            ) : null}
                          </div>
                        ) : null}
                        {boardReportingReviewLifecycleState(boardReportingWorkflowState.reviewState)
                          === BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.startable ? (
                          <div className="mt-2">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary board-reporting-review-start-button"
                              disabled={boardReportingReviewStartPending}
                              onClick={startBoardReportingReview}
                            >
                              {boardReportingReviewStartPending ? "Starting review..." : "Start review"}
                            </button>
                            {boardReportingReviewStartError ? (
                              <div className="alert alert-warning py-2 small mt-1">{boardReportingReviewStartError}</div>
                            ) : null}
                          </div>
                        ) : null}
                        {boardReportingReviewLifecycleState(boardReportingWorkflowState.reviewState)
                          === BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.completable ? (
                          <div className="mt-2">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary board-reporting-review-complete-button"
                              disabled={boardReportingReviewCompletePending}
                              onClick={completeBoardReportingReview}
                            >
                              {boardReportingReviewCompletePending ? "Completing review..." : "Complete review"}
                            </button>
                            {boardReportingReviewCompleteError ? (
                              <div className="alert alert-warning py-2 small mt-1">{boardReportingReviewCompleteError}</div>
                            ) : null}
                          </div>
                        ) : null}
                        {boardReportingReviewLifecycleState(boardReportingWorkflowState.reviewState)
                          === BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.resolved ? (
                          <div className="mt-2">
                            <span className="badge text-bg-success board-reporting-review-resolved-badge">
                              Review complete
                            </span>
                          </div>
                        ) : null}

                        <div className="small mt-3">
                          <div className="fw-semibold">Effective final-release authority</div>
                          <ValueRow label="Decision type" value={boardReportingWorkflowState.effectiveAuthority.decisionType} />
                          <ValueRow label="Effective" value={String(boardReportingWorkflowState.effectiveAuthority.effective)} />
                          <ValueRow label="Reason" value={boardReportingWorkflowState.effectiveAuthority.reason} />
                        </div>
                        {boardReportingFinalReleaseAuthorityControlState(boardReportingWorkflowState)
                          === BOARD_REPORTING_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.grantable ? (
                          <div className="mt-2">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary board-reporting-final-release-authority-grant-button"
                              disabled={boardReportingFinalReleaseAuthorityPending}
                              onClick={() => recordBoardReportingFinalReleaseAuthority("grant")}
                            >
                              {boardReportingFinalReleaseAuthorityPending ? "Granting final release authority..." : "Grant final release authority"}
                            </button>
                          </div>
                        ) : null}
                        {boardReportingFinalReleaseAuthorityControlState(boardReportingWorkflowState)
                          === BOARD_REPORTING_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.revocable ? (
                          <div className="mt-2">
                            <span className="badge text-bg-success board-reporting-final-release-authority-granted-badge">
                              Final release authority granted
                            </span>
                            <div className="mt-2">
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary board-reporting-final-release-authority-revoke-button"
                                disabled={boardReportingFinalReleaseAuthorityPending}
                                onClick={() => recordBoardReportingFinalReleaseAuthority("revoke")}
                              >
                                {boardReportingFinalReleaseAuthorityPending ? "Revoking final release authority..." : "Revoke final release authority"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {boardReportingFinalReleaseAuthorityError ? (
                          <div className="alert alert-warning py-2 small mt-1">{boardReportingFinalReleaseAuthorityError}</div>
                        ) : null}

                        <div className="small mt-3">
                          <div className="fw-semibold">Final eligibility</div>
                          <ValueRow label="Final eligibility" value={String(boardReportingWorkflowState.finalEligibility.finalEligibility)} />
                          <ValueRow label="Currentness gate" value={String(boardReportingWorkflowState.finalEligibility.currentnessGate)} />
                          {boardReportingWorkflowState.finalEligibility.failedGates.length ? (
                            <div className="mt-1">
                              <div className="text-muted">Failed gates</div>
                              <ul className="mb-0 ps-3">
                                {boardReportingWorkflowState.finalEligibility.failedGates.map((gate, index) => (
                                  <li key={`failed-gate-${index}`}>{typeof gate === "string" ? gate : JSON.stringify(gate)}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {boardReportingWorkflowState.finalEligibility.blockers.length ? (
                            <div className="mt-1">
                              <div className="text-muted">Blockers</div>
                              <ul className="mb-0 ps-3">
                                {boardReportingWorkflowState.finalEligibility.blockers.map((blocker, index) => (
                                  <li key={`blocker-${index}`}>{typeof blocker === "string" ? blocker : JSON.stringify(blocker)}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>

                        <div className="small mt-3">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary board-reporting-create-export-manifest-button"
                            disabled={boardReportingExportManifestPending}
                            onClick={createBoardReportingExportManifest}
                          >
                            {boardReportingExportManifestPending ? "Preparing export manifest..." : "Create/reuse export manifest"}
                          </button>
                          <div className="text-muted mt-1">
                            Creates (or reuses, if nothing has changed) a governed export manifest
                            for this exact candidate. This is not external publication and grants
                            no external readiness or release status of its own.
                          </div>
                          {boardReportingExportManifestError ? (
                            <div className="alert alert-warning py-2 small mt-1">{boardReportingExportManifestError}</div>
                          ) : null}
                        </div>

                        {boardReportingWorkflowState.exportManifests.length ? (
                          <div className="small mt-2 board-reporting-export-manifests">
                            <div className="fw-semibold">Export manifests</div>
                            <div className="text-muted mb-1">
                              Select exactly one manifest before fetching the FINAL Board Summary
                              below - none is ever auto-selected.
                            </div>
                            <ul className="list-unstyled mb-0">
                              {boardReportingWorkflowState.exportManifests.map((manifest) => (
                                <li key={manifest.boardReportingCandidateExportManifestId} className="mb-1">
                                  <label className="d-flex align-items-center gap-2">
                                    <input
                                      type="radio"
                                      name="board-reporting-export-manifest-selection"
                                      className="board-reporting-export-manifest-radio"
                                      checked={selectedBoardReportingExportManifestId === manifest.boardReportingCandidateExportManifestId}
                                      onChange={() => selectBoardReportingExportManifestId(manifest.boardReportingCandidateExportManifestId)}
                                    />
                                    <span>
                                      {manifest.boardReportingCandidateExportManifestId}
                                      {" "}
                                      <span className="text-muted">({manifest.createdAt})</span>
                                    </span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="mt-3 p-2 border rounded board-reporting-final-summary-section">
                          <h6 className="mb-1">FINAL Board Summary</h6>
                          <div className="text-muted small mb-2">
                            Distinct from the live workflow-state preview above - this is the
                            governed FINAL_MANIFEST_BOUND Markdown for exactly the selected
                            manifest id, never an inferred one.
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary board-reporting-fetch-final-summary-button"
                            disabled={
                              boardReportingFinalSummaryLoading
                              || !boardReportingFinalSummaryFetchable(boardReportingWorkflowState, selectedBoardReportingExportManifestId)
                            }
                            onClick={fetchBoardReportingFinalSummary}
                          >
                            {boardReportingFinalSummaryLoading ? "Loading FINAL Board Summary..." : "Fetch FINAL Board Summary"}
                          </button>
                          {boardReportingFinalSummaryError ? (
                            <div className="alert alert-warning py-2 small mt-2">{boardReportingFinalSummaryError}</div>
                          ) : null}
                          {!boardReportingFinalSummaryLoading && boardReportingFinalSummaryMarkdown != null ? (
                            <pre className="small border rounded p-2 mt-2 board-reporting-final-summary-markdown">
                              {boardReportingFinalSummaryMarkdown}
                            </pre>
                          ) : null}
                          {!boardReportingFinalSummaryLoading && boardReportingFinalSummaryMarkdown == null && !boardReportingFinalSummaryError ? (
                            <div className="text-muted small mt-2">
                              Select a manifest and fetch to view the FINAL Board Summary.
                            </div>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="admin-card mt-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Generated Drafts</h5>
              <span className="text-muted small">{generatedDrafts.length} shown</span>
            </div>
            {loadingGeneratedDrafts ? <div className="text-muted">Loading generated drafts...</div> : null}
            {!loadingGeneratedDrafts && generatedDrafts.length === 0 ? (
              <div className="text-muted">No persisted generated drafts for this organization yet.</div>
            ) : null}
            <div className="list-group">
              {generatedDrafts.map((draft) => {
                const draftExportReviewState = generatedDraftExportReviewDisplayState(draft);
                return (
                  <div
                    key={draft.generatedContentDraftId}
                    className={`list-group-item ${draft.generatedContentDraftId === selectedGeneratedDraftId ? "active" : ""}`}
                  >
                    <button
                      type="button"
                      className="btn btn-link p-0 border-0 text-start w-100"
                      onClick={() => selectGeneratedDraft(draft.generatedContentDraftId)}
                    >
                      <div className="d-flex justify-content-between gap-2">
                        <span>Evidence Summary · Internal</span>
                        <span className="badge text-bg-secondary">{generatedDraftReviewLabel(draft.queueStatus, draft.reviewStatus)}</span>
                      </div>
                      <div className="small mt-1">Created {draft.createdAt}</div>
                    </button>
                    {draftExportReviewState === EXPORT_REVIEW_DISPLAY_STATES.existing ? (
                      <div className="d-flex justify-content-between align-items-center gap-2 mt-1">
                        <span className="badge text-bg-info">
                          Export review: {draft.exportReviewQueueStatus} / {draft.exportReviewStatus}
                        </span>
                        <a
                          className="btn btn-sm btn-outline-secondary"
                          href={gkExportReviewDetailPagePath(
                            organizationId,
                            draft.generatedContentDraftId,
                            draft.exportReviewQueueItemId,
                          )}
                        >
                          Open GK Export Review
                        </a>
                      </div>
                    ) : null}
                    {draftExportReviewState === EXPORT_REVIEW_DISPLAY_STATES.restricted ? (
                      <div className="small text-muted mt-1">Export review unavailable for your role</div>
                    ) : null}
                    {draftExportReviewState !== EXPORT_REVIEW_DISPLAY_STATES.existing
                      && draftExportReviewState !== EXPORT_REVIEW_DISPLAY_STATES.restricted ? (
                      <div className="small text-muted mt-1">No export review</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="col-12 col-xl-7">
          <div className="admin-card" ref={traceabilityPanelRef} tabIndex={-1}>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Traceability</h5>
              {traceability ? <StatusBadge status={traceability.libraryStatus} /> : null}
            </div>
            {!selectedClaim ? <div className="text-muted">Select a claim to inspect traceability.</div> : null}
            {loadingTraceability ? <div className="text-muted">Loading traceability...</div> : null}
            {traceability ? (
              <>
                <ValueRow label="Governed internal availability" value="internally available (governed)" />
                <ValueRow
                  label={`${traceability.requestedAudience || audience} audience eligibility`}
                  value={traceability.eligible ? "eligible" : "not currently eligible"}
                />
                <ValueRow label="Allowed audience" value={JSON.stringify(traceability.audienceGates)} />
                <ValueRow label="Evidence item" value={traceability.evidence?.evidence_item_id} />
                <ValueRow label="Evidence sensitivity" value={traceability.evidence?.sensitivity_level || "unknown"} />
                <ValueRow label="Source" value={traceability.source?.source_id} />
                <ValueRow label="Source version" value={traceability.sourceVersion?.source_version_id} />
                <ValueRow
                  label="Blockers / limitations"
                  value={traceability.blockerCodes.length
                    ? traceability.blockerCodes.map((blockerCode) => blockerDisplayText(
                      blockerCode,
                      traceability.requestedAudience || audience,
                    )).join(", ")
                    : "none"}
                />

                <h6 className="mt-3">Limitations</h6>
                {traceability.dimensions.filter((dimension) => dimension.displayStatus === "known_limitation").length === 0 ? (
                  <div className="text-muted small">No accepted internal limitations returned.</div>
                ) : traceability.dimensions.filter((dimension) => dimension.displayStatus === "known_limitation").map((dimension) => (
                  <ValueRow
                    key={dimension.dimensionKey}
                    label={dimension.dimensionKey}
                    value={`known limitation (${dimension.assessmentStatus})`}
                  />
                ))}

                <h6 className="mt-3">Reviews, followups, conflicts</h6>
                <ValueRow label="Evidence review" value={`${traceability.evidence?.review_queue_status || "none"} / ${traceability.evidence?.review_status || "none"}`} />
                <ValueRow label="Evidence review decision" value={traceability.evidenceReviewDecision?.decisionOutcome} />
                {canCompleteEvidenceReview(traceability.evidence, traceability.evidenceReviewDecision) ? (
                  <div className="border rounded p-2 mt-2 mb-3">
                    <div className="small fw-semibold mb-2">Record evidence review decision</div>
                    <div className="d-flex flex-wrap gap-3 mb-2">
                      {EVIDENCE_REVIEW_DECISIONS.map((value) => (
                        <div className="form-check" key={value}>
                          <input
                            className="form-check-input"
                            type="radio"
                            name="evidence-review-decision"
                            id={`evidence-review-decision-${value}`}
                            value={value}
                            checked={evidenceDecision === value}
                            onChange={() => setEvidenceDecision(value)}
                          />
                          <label className="form-check-label small" htmlFor={`evidence-review-decision-${value}`}>
                            {value}
                          </label>
                        </div>
                      ))}
                    </div>
                    {decisionRequiresLimitationNotes(evidenceDecision) ? (
                      <div className="mb-2">
                        <label className="form-label small fw-semibold">Limitation notes (one per line)</label>
                        <textarea
                          className="form-control form-control-sm"
                          rows={3}
                          value={evidenceLimitationNotesText}
                          onChange={(event) => setEvidenceLimitationNotesText(event.target.value)}
                        />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      onClick={runCompleteEvidenceReview}
                      disabled={workflowPending || Boolean(evidenceDecisionValidationError)}
                    >
                      Record Evidence Review Decision
                    </button>
                  </div>
                ) : null}
                <ValueRow label="Claim review" value={`${traceability.claimReview?.queue_status || "none"} / ${traceability.claimReview?.review_status || "none"}`} />
                <ValueRow label="Claim review decision" value={traceability.claimReviewDecision?.decisionOutcome} />
                <ValueRow
                  label="Human-approved scope"
                  value={traceability.claimReviewDecision?.approvedAudiences?.length ? traceability.claimReviewDecision.approvedAudiences.join(", ") : undefined}
                />
                {canCompleteClaimReview(traceability.evidence, traceability.claimReview, traceability.evidenceReviewDecision, traceability.claimReviewDecision) ? (
                  <div className="border rounded p-2 mt-2 mb-3">
                    <div className="small fw-semibold mb-2">Record claim review decision</div>
                    <div className="d-flex flex-wrap gap-3 mb-2">
                      {CLAIM_REVIEW_DECISIONS.map((value) => (
                        <div className="form-check" key={value}>
                          <input
                            className="form-check-input"
                            type="radio"
                            name="claim-review-decision"
                            id={`claim-review-decision-${value}`}
                            value={value}
                            checked={claimDecision === value}
                            onChange={() => setClaimDecision(value)}
                          />
                          <label className="form-check-label small" htmlFor={`claim-review-decision-${value}`}>
                            {value}
                          </label>
                        </div>
                      ))}
                    </div>
                    {decisionRequiresLimitationNotes(claimDecision) ? (
                      <div className="mb-2">
                        <label className="form-label small fw-semibold">Limitation notes (one per line)</label>
                        <textarea
                          className="form-control form-control-sm"
                          rows={3}
                          value={claimLimitationNotesText}
                          onChange={(event) => setClaimLimitationNotesText(event.target.value)}
                        />
                      </div>
                    ) : null}
                    {decisionRequiresApprovedAudiences(claimDecision) ? (
                      <div className="mb-2">
                        <div className="small fw-semibold">Human-approved scope</div>
                        <div className="d-flex flex-wrap gap-3 mb-1">
                          {APPROVED_AUDIENCE_VALUES.map((value) => (
                            <div className="form-check" key={value}>
                              <input
                                className="form-check-input"
                                type="checkbox"
                                id={`claim-approved-audience-${value}`}
                                checked={claimApprovedAudiences.includes(value)}
                                onChange={() => toggleClaimApprovedAudience(value)}
                              />
                              <label className="form-check-label small" htmlFor={`claim-approved-audience-${value}`}>
                                {value}
                              </label>
                            </div>
                          ))}
                        </div>
                        <div className="small text-muted">
                          This records the reviewer's approved scope. It is not final effective eligibility or output release authority.
                        </div>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      onClick={runCompleteClaimReview}
                      disabled={workflowPending || Boolean(claimDecisionValidationError)}
                    >
                      Record Claim Review Decision
                    </button>
                  </div>
                ) : null}
                {traceability.clientFollowupWorkflows.map((item) => (
                  <ValueRow
                    key={item.clientFollowupItemId}
                    label={`Followup ${item.dimensionKey}`}
                    value={`${item.workflowDisposition || "none"} / ${item.workflowStatus || "none"}`}
                  />
                ))}
                {traceability.potentialConflictGroups.map((item) => (
                  <ValueRow
                    key={item.conflict_group_id}
                    label="Conflict review"
                    value={`${item.workflow_status || "none"} / ${item.review_status || "none"}`}
                  />
                ))}
              </>
            ) : null}
          </div>

          {sensitivityCapability === true ? (
            <div className="admin-card mt-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h5 className="mb-0">Sources needing sensitivity &amp; allowed-use review</h5>
                <span className="text-muted small">{sensitivityReviewQueueItems.length} shown</span>
              </div>
              <div className="small text-muted mb-2">
                Pre-claim: no claim, evidence item, or source promotion is required to reach these. This list shows
                only sources with EXISTING open review work - not every P1-05 sensitivity profile for this
                organization. To start a first review for a file that has none yet, select the file above in KAI
                Web Intake once its sensitivity profile is complete.
              </div>
              {loadingSensitivityReviewQueue ? <div className="text-muted small">Loading review queue...</div> : null}
              {sensitivityReviewQueueError ? <div className="alert alert-warning py-2 small">{sensitivityReviewQueueError}</div> : null}
              {!loadingSensitivityReviewQueue && sensitivityReviewQueueItems.length === 0 ? (
                <div className="text-muted small">No existing sensitivity review work is currently outstanding for this organization.</div>
              ) : null}
              <ul className="list-group">
                {sensitivityReviewQueueItems.map((item) => (
                  <li
                    key={item.reviewQueueItemId}
                    className={`list-group-item d-flex justify-content-between align-items-center gap-2 ${item.intakeSensitivityProfileId === selectedSensitivityProfileId ? "active" : ""}`}
                  >
                    <span className="small text-break">{item.summary || item.intakeSensitivityProfileId}</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary flex-shrink-0"
                      onClick={() => setSelectedSensitivityProfileId(item.intakeSensitivityProfileId)}
                    >
                      Review sensitivity &amp; allowed use
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {intakeSensitivityProfileId && sensitivityCapability === true ? (
            <div className="admin-card mt-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h5 className="mb-0">Sensitivity &amp; allowed-use review</h5>
                {sensitivityDetail?.currentDecision?.decision_outcome === "reviewed" ? (
                  <span className="badge text-bg-success">Reviewed</span>
                ) : sensitivityDetail?.reviewQueueItem ? (
                  <span className="badge text-bg-warning">Needs review</span>
                ) : null}
              </div>
              {sensitivityLoading ? <div className="text-muted">Loading sensitivity &amp; allowed-use review...</div> : null}
              {sensitivityError ? <div className="alert alert-warning py-2 small">{sensitivityError}</div> : null}
              {sensitivityActionResult ? <div className="alert alert-info py-2 small">{sensitivityActionResult}</div> : null}

              {sensitivityDetail ? (
                <>
                  <h6 className="mt-2">What KAI detected</h6>
                  <ValueRow label="Sensitivity posture" value={JSON.stringify(sensitivityDetail.sensitivityPosture || {})} />
                  <ValueRow label="Allowed-use restrictions" value={JSON.stringify(sensitivityDetail.allowedUseRestrictions || {})} />

                  <h6 className="mt-3">Review work</h6>
                  {sensitivityDetail.reviewQueueItem ? (
                    <ValueRow
                      label="Review work status"
                      value={`${sensitivityDetail.reviewQueueItem.queue_status || "none"} / ${sensitivityDetail.reviewQueueItem.review_status || "none"}`}
                    />
                  ) : (
                    <>
                      <div className="small text-muted mb-2">No sensitivity review work has been started for this source yet.</div>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary"
                        onClick={startSensitivityReviewWork}
                        disabled={sensitivityActionPending}
                      >
                        Review sensitivity &amp; allowed use
                      </button>
                    </>
                  )}

                  <h6 className="mt-3">Sensitivity &amp; allowed-use decision</h6>
                  {sensitivityDetail.currentDecision ? (
                    <>
                      <ValueRow label="Outcome" value={sensitivityDetail.currentDecision.decision_outcome} />
                      <ValueRow label="Ordinary KAI processing (allowed use)" value={sensitivityDetail.currentDecision[SENSITIVITY_ALLOWED_USE_FIELD]} />
                      <ValueRow
                        label="AI processing (approved LLM provider)"
                        value={sensitivityDetail.currentDecision.reviewed_llm_processing_allowed ? "allowed" : "not allowed"}
                      />
                      <ValueRow
                        label="Funder/reporting drafts (source-use only, not release approval)"
                        value={sensitivityDetail.currentDecision.reviewed_funder_use_allowed ? "allowed" : "not allowed"}
                      />
                      <ValueRow
                        label="Product/service improvement (this org's own data only)"
                        value={sensitivityDetail.currentDecision.reviewed_product_learning_allowed ? "allowed" : "not allowed"}
                      />
                      <ValueRow
                        label="Public-use participation (not final release authority)"
                        value={sensitivityDetail.currentDecision.reviewed_public_use_allowed ? "allowed" : "not allowed"}
                      />
                      <div className="small text-muted mt-1">
                        Source-use permission does not by itself approve final external release.
                      </div>
                    </>
                  ) : (
                    <div className="small text-muted">No sensitivity &amp; allowed-use decision recorded yet.</div>
                  )}

                  {sensitivityDetail.reviewQueueItem ? (
                    <div className="border rounded p-2 mt-3">
                      <div className="small fw-semibold mb-2">
                        {sensitivityDetail.currentDecision ? "Record a new review (re-review)" : "Record review"}
                      </div>
                      {SENSITIVITY_PRESENCE_FIELDS.map((field) => (
                        <div className="row g-2 align-items-center mb-1" key={field}>
                          <div className="col-7 small text-muted">{SENSITIVITY_FIELD_LABELS[field] || field}</div>
                          <div className="col-5">
                            <select
                              className="form-select form-select-sm"
                              value={sensitivityFormState[field]}
                              onChange={(event) => setSensitivityFormState((current) => ({ ...current, [field]: event.target.value }))}
                            >
                              {SENSITIVITY_PRESENCE_VALUES.map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                          </div>
                        </div>
                      ))}
                      <div className="row g-2 align-items-center mb-2 mt-1">
                        <div className="col-7 small text-muted">Ordinary KAI processing (allowed use)</div>
                        <div className="col-5">
                          <select
                            className="form-select form-select-sm"
                            value={sensitivityFormState[SENSITIVITY_ALLOWED_USE_FIELD]}
                            onChange={(event) => setSensitivityFormState((current) => ({ ...current, [SENSITIVITY_ALLOWED_USE_FIELD]: event.target.value }))}
                          >
                            {SENSITIVITY_ALLOWED_USE_VALUES.map((value) => <option key={value} value={value}>{value}</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="form-check small">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="sensitivity-llm-processing-allowed"
                          checked={sensitivityFormState.reviewed_llm_processing_allowed === true}
                          disabled={!restrictedPermissionEligible(sensitivityFormState)}
                          onChange={(event) => setSensitivityFormState((current) => ({ ...current, reviewed_llm_processing_allowed: event.target.checked }))}
                        />
                        <label className="form-check-label" htmlFor="sensitivity-llm-processing-allowed">
                          AI processing: may be processed by an approved AI provider for ordinary KAI service delivery
                        </label>
                      </div>
                      <div className="form-check small">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="sensitivity-product-learning-allowed"
                          checked={sensitivityFormState.reviewed_product_learning_allowed === true}
                          disabled={!restrictedPermissionEligible(sensitivityFormState)}
                          onChange={(event) => setSensitivityFormState((current) => ({ ...current, reviewed_product_learning_allowed: event.target.checked }))}
                        />
                        <label className="form-check-label" htmlFor="sensitivity-product-learning-allowed">
                          Product/service improvement: this organization's own KAI/program improvement only
                        </label>
                      </div>
                      <div className="form-check small">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="sensitivity-funder-use-allowed"
                          checked={sensitivityFormState.reviewed_funder_use_allowed === true}
                          disabled={!restrictedPermissionEligible(sensitivityFormState)}
                          onChange={(event) => setSensitivityFormState((current) => ({ ...current, reviewed_funder_use_allowed: event.target.checked }))}
                        />
                        <label className="form-check-label" htmlFor="sensitivity-funder-use-allowed">
                          Funder/reporting drafts: may participate in drafting (not final funder release approval)
                        </label>
                      </div>
                      <div className="form-check small mb-2">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="sensitivity-public-use-allowed"
                          checked={sensitivityFormState.reviewed_public_use_allowed === true}
                          disabled={!publicUseAllowedEligible(sensitivityFormState)}
                          onChange={(event) => setSensitivityFormState((current) => ({ ...current, reviewed_public_use_allowed: event.target.checked }))}
                        />
                        <label className="form-check-label" htmlFor="sensitivity-public-use-allowed">
                          Public-use participation: requires allowed use, consent present, and governance status absent (not final release authority)
                        </label>
                      </div>

                      <button
                        type="button"
                        className="btn btn-sm btn-primary me-2"
                        onClick={() => submitSensitivityDecision("reviewed")}
                        disabled={sensitivityActionPending}
                      >
                        Submit review
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => submitSensitivityDecision("needs_more_information")}
                        disabled={sensitivityActionPending}
                      >
                        Needs more information
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          <div className="admin-card mt-3">
            <h5 className="mb-2">Data Sources</h5>
            <div className="small text-muted mb-2">
              Governed sources and source versions already promoted for this organization. Select one to use it below - historical (non-current) versions remain visible, not hidden.
            </div>
            {organizationSourcesError ? <div className="alert alert-warning py-2 small">{organizationSourcesError}</div> : null}
            {loadingOrganizationSources ? <div className="text-muted small">Loading data sources...</div> : null}
            {!loadingOrganizationSources && !organizationSourcesError && organizationSourcesRequestState === "success" && organizationSources.length === 0 ? (
              <div className="text-muted small">No governed sources found for this organization yet.</div>
            ) : null}
            {!loadingOrganizationSources && organizationSources.length > 0 ? (
              <div className="table-responsive mb-2">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Reviewed type</th>
                      <th>Source version</th>
                      <th>Current</th>
                      <th>Created</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {organizationSources.flatMap((source) => (
                      (source.sourceVersions.length > 0 ? source.sourceVersions : [null]).map((version, index) => (
                        <tr key={version ? version.sourceVersionId : `${source.sourceId}-no-version`}>
                          {index === 0 ? (
                            <td rowSpan={source.sourceVersions.length || 1} className="small font-monospace">{source.sourceCode}</td>
                          ) : null}
                          {index === 0 ? (
                            <td rowSpan={source.sourceVersions.length || 1} className="small">{source.reviewedSourceType}</td>
                          ) : null}
                          <td className="small font-monospace">{version ? version.sourceVersionId : "none"}</td>
                          <td className="small">{version ? (version.isCurrent ? "current" : "historical") : ""}</td>
                          <td className="small">{version ? version.createdAt : ""}</td>
                          <td>
                            {version ? (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                onClick={() => setSourceVersionId(version.sourceVersionId)}
                              >
                                Select
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          <div className="admin-card mt-3">
            <h5 className="mb-2">Claim &amp; evidence workflow</h5>
            {workflowResult ? <div className="alert alert-info py-2">{workflowResult}</div> : null}

            <div className="row g-2 align-items-end mb-3">
              <div className="col-12 col-lg-6">
                <label className="form-label small fw-semibold">Source version id</label>
                <input
                  className="form-control form-control-sm"
                  value={sourceVersionId}
                  onChange={(event) => setSourceVersionId(event.target.value.trim())}
                />
              </div>
              <div className="col-6 col-lg-3">
                <button type="button" className="btn btn-sm btn-outline-primary w-100" onClick={runExtractEvidence} disabled={workflowPending}>
                  Extract evidence
                </button>
              </div>
              <div className="col-6 col-lg-3">
                <button type="button" className="btn btn-sm btn-outline-primary w-100" onClick={runCoverageAssessment} disabled={workflowPending}>
                  View coverage assessment
                </button>
              </div>
            </div>

            {coverageAssessment ? (
              <div className="mb-3">
                <h6>Coverage assessment</h6>
                {coverageAssessment.dimensions.map((dimension) => (
                  <ValueRow key={dimension.dimensionKey} label={dimension.dimensionKey} value={`${dimension.assessmentStatus} · ${dimension.summary}`} />
                ))}
              </div>
            ) : null}

            <div className="row g-2 align-items-end mb-3">
              <div className="col-12">
                <div className="small text-muted">Selected claim: {selectedClaimId || "none"} · evidence item: {selectedClaim?.evidenceItemId || "none"}</div>
              </div>
              <div className="col-6 col-lg-4">
                <button type="button" className="btn btn-sm btn-outline-primary w-100" onClick={runClaimProposal} disabled={workflowPending || !isRouteUuid(selectedClaim?.evidenceItemId)}>
                  Propose claim
                </button>
              </div>
              <div className="col-6 col-lg-4">
                <button type="button" className="btn btn-sm btn-outline-primary w-100" onClick={runClaimGapFollowups} disabled={workflowPending || !selectedClaimId}>
                  Generate gap followups
                </button>
              </div>
              <div className="col-12 col-lg-4">
                <select className="form-select form-select-sm" value={coverageDimensionKey} onChange={(event) => setCoverageDimensionKey(event.target.value)}>
                  {COVERAGE_DIMENSION_KEYS.map((key) => <option key={key} value={key}>{key}</option>)}
                </select>
              </div>
              <div className="col-12">
                <ValueRow label="Selected dimension acceptance" value={selectedDimensionAcceptance} />
              </div>
              <div className="col-12 col-lg-6">
                <button type="button" className="btn btn-sm btn-outline-primary w-100" onClick={runCoverageInternalAcceptance} disabled={workflowPending || !selectedClaimId}>
                  Accept internal limitation for selected dimension
                </button>
              </div>
              <div className="col-12 col-lg-6">
                <button type="button" className="btn btn-sm btn-outline-primary w-100" onClick={runCoverageFunderAcceptance} disabled={workflowPending || !selectedClaimId}>
                  Accept funder limitation for selected dimension
                </button>
              </div>
            </div>

            <div className="row g-2 align-items-end">
              <div className="col-12 col-lg-8">
                <label className="form-label small fw-semibold">Second claim id (conflict check against selected claim)</label>
                <input
                  className="form-control form-control-sm"
                  value={secondClaimId}
                  onChange={(event) => setSecondClaimId(event.target.value.trim())}
                />
              </div>
              <div className="col-12 col-lg-4">
                <button type="button" className="btn btn-sm btn-outline-primary w-100" onClick={runPotentialConflictCheck} disabled={workflowPending || !selectedClaimId || !secondClaimId}>
                  Record potential conflict
                </button>
              </div>
            </div>
          </div>

          {generatedDraftPacket ? (
            <div className="admin-card mt-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h5 className="mb-0">Generated draft</h5>
                <StatusBadge status={generatedDraftPacket.queueStatus === "open" ? "needs_review" : "usable"} />
              </div>
              <ValueRow label="Content type" value={generatedDraftPacket.contentType} />
              <ValueRow label="Requested audience" value={generatedDraftPacket.requestedAudience} />
              <ValueRow label="Draft status" value={generatedDraftPacket.draftStatus} />
              <ValueRow label="Review state" value={`${generatedDraftPacket.queueStatus} / ${generatedDraftPacket.reviewStatus}`} />
              {canStartGeneratedContentReview(generatedDraftPacket) ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary me-2 mt-2"
                  onClick={() => transitionGeneratedContentReview("start")}
                  disabled={reviewTransitionPending}
                >
                  Start Review
                </button>
              ) : null}
              {canCompleteGeneratedContentReview(generatedDraftPacket) ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary mt-2"
                  onClick={() => transitionGeneratedContentReview("complete")}
                  disabled={reviewTransitionPending}
                >
                  Complete Review
                </button>
              ) : null}
              {generatedDraftExportReviewDisplayState(generatedDraftPacket) === EXPORT_REVIEW_DISPLAY_STATES.existing ? (
                <>
                  <ValueRow
                    label="Export review state"
                    value={`${generatedDraftPacket.exportReviewQueueStatus} / ${generatedDraftPacket.exportReviewStatus}`}
                  />
                  <a
                    className="btn btn-sm btn-outline-secondary mt-2"
                    href={gkExportReviewDetailPagePath(
                      organizationId,
                      generatedDraftPacket.generatedContentDraftId,
                      generatedDraftPacket.exportReviewQueueItemId,
                    )}
                  >
                    Open GK Export Review
                  </a>
                </>
              ) : null}
              {generatedDraftExportReviewDisplayState(generatedDraftPacket) === EXPORT_REVIEW_DISPLAY_STATES.requestable ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary mt-2"
                  onClick={requestExportReview}
                  disabled={exportReviewRequestPending}
                >
                  Request Export Review
                </button>
              ) : null}
              {generatedDraftExportReviewDisplayState(generatedDraftPacket) === EXPORT_REVIEW_DISPLAY_STATES.restricted ? (
                <ValueRow label="Export review" value="Unavailable for your role" />
              ) : null}
              {exportReviewRequestResult && !exportReviewRequestResult.accepted ? (
                <ValueRow
                  label="Export review blocked"
                  value={JSON.stringify(exportReviewRequestResult.validatorResult)}
                />
              ) : null}
              <h6 className="mt-3">Blocks</h6>
              {generatedDraftPacket.blocks.map((block) => (
                <div key={block.ordinal} className="border rounded p-2 mb-2">
                  <div className="small fw-semibold">Block {block.ordinal}</div>
                  <p className="small mb-2">{block.text}</p>
                  {block.citations.map((citation, index) => (
                    <ValueRow
                      key={`${citation.claimId}-${citation.evidenceItemId}-${index}`}
                      label="Citation"
                      value={`${citation.claimId} / ${citation.evidenceItemId}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
