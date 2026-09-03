import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LIBRARY_AUDIENCES,
  COVERAGE_DIMENSION_KEYS,
  APPROVED_AUDIENCE_VALUES,
  CLAIM_REVIEW_DECISIONS,
  EVIDENCE_REVIEW_DECISIONS,
  annotateGovernedAvailability,
  canSelectClaimForInternalGeneration,
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
  createEvidenceSummaryPath,
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
  reviewQueueIsComplete,
  reviewQueueIsConclusivelyEmpty,
  projectTraceability,
  reviewQueueBlockerActionability,
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
  projectSensitivityDetail,
} from "./impactEvidenceLibraryLogic.js";
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
  const organizationIdRef = useRef(organizationId);
  const audienceRef = useRef(audience);
  organizationIdRef.current = organizationId;
  audienceRef.current = audience;
  const [selectedClaimId, setSelectedClaimId] = useState("");
  const [selectedGenerationClaimIds, setSelectedGenerationClaimIds] = useState([]);
  const [generatedDraftPacket, setGeneratedDraftPacket] = useState(null);
  const [generatedDrafts, setGeneratedDrafts] = useState([]);
  const [selectedGeneratedDraftId, setSelectedGeneratedDraftId] = useState("");
  const [loadingGeneratedDrafts, setLoadingGeneratedDrafts] = useState(false);
  const [traceability, setTraceability] = useState(null);
  const [loadingTraceability, setLoadingTraceability] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [reviewTransitionPending, setReviewTransitionPending] = useState(false);
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
    setTraceability(next.traceability);
    setGeneratedDraftPacket(next.generatedDraftPacket);
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
  }, [selectedClaimId]);

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
    if (audience !== "internal" || selectedGenerationClaimIds.length === 0) return;
    setGeneratingDraft(true);
    setMessage("");
    setGeneratedDraftPacket(null);
    const createResult = await postJson(pathBuilder(organizationId), {
      claim_ids: selectedGenerationClaimIds,
      idempotency_key: `${idempotencyPrefix}-${selectedGenerationClaimIds.join("-")}`,
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
  }, [audience, organizationId, selectedGenerationClaimIds, loadGeneratedDrafts]);

  const generateEvidenceSummary = useCallback(
    () => generateDraft(createEvidenceSummaryPath, "evidence-summary"),
    [generateDraft],
  );

  const generateImpactNarrative = useCallback(
    () => generateDraft(createImpactNarrativePath, "impact-narrative"),
    [generateDraft],
  );

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
                      <span>{blockerCode}</span>
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
                disabled={generatingDraft || selectedGenerationClaimIds.length === 0}
              >
                {generatingDraft ? "Generating..." : "Generate evidence summary"}
              </button>
            ) : null}
            {audience === "internal" ? (
              <button
                type="button"
                className="btn btn-sm btn-outline-primary mt-2 w-100"
                onClick={generateImpactNarrative}
                disabled={generatingDraft || selectedGenerationClaimIds.length === 0}
              >
                {generatingDraft ? "Generating..." : "Generate Impact Narrative"}
              </button>
            ) : null}
          </div>

          <div className="admin-card mt-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h5 className="mb-0">Funder Requirements</h5>
              <span className="text-muted small">{requirementsReadiness.length} shown</span>
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
                    <span className="small fw-semibold">{requirement.requirementLabel || requirement.requirementKey}</span>
                    <span className={`badge ${requirement.assessed && requirement.assessmentState === "met" ? "text-bg-success" : requirement.assessed ? "text-bg-warning" : "text-bg-secondary"}`}>
                      {requirement.assessed ? requirement.assessmentState || "assessed" : "needs assessment"}
                    </span>
                  </div>
                  {requirement.assessed ? (
                    <div className="small text-muted mt-1">{requirement.assessmentExplanation || "No explanation returned."}</div>
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
              <h5 className="mb-0">Generated Drafts</h5>
              <span className="text-muted small">{generatedDrafts.length} shown</span>
            </div>
            {loadingGeneratedDrafts ? <div className="text-muted">Loading generated drafts...</div> : null}
            {!loadingGeneratedDrafts && generatedDrafts.length === 0 ? (
              <div className="text-muted">No persisted generated drafts for this organization yet.</div>
            ) : null}
            <div className="list-group">
              {generatedDrafts.map((draft) => (
                <button
                  type="button"
                  key={draft.generatedContentDraftId}
                  className={`list-group-item list-group-item-action ${draft.generatedContentDraftId === selectedGeneratedDraftId ? "active" : ""}`}
                  onClick={() => selectGeneratedDraft(draft.generatedContentDraftId)}
                >
                  <div className="d-flex justify-content-between gap-2">
                    <span>Evidence Summary · Internal</span>
                    <span className="badge text-bg-secondary">{generatedDraftReviewLabel(draft.queueStatus, draft.reviewStatus)}</span>
                  </div>
                  <div className="small mt-1">Created {draft.createdAt}</div>
                </button>
              ))}
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
                <ValueRow label="Blockers / limitations" value={traceability.blockerCodes.length ? traceability.blockerCodes.join(", ") : "none"} />

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
                <button type="button" className="btn btn-sm btn-outline-primary w-100" onClick={runCoverageInternalAcceptance} disabled={workflowPending || !selectedClaimId}>
                  Accept internal limitation for selected dimension
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
