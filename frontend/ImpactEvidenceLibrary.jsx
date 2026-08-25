import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LIBRARY_AUDIENCES,
  COVERAGE_DIMENSION_KEYS,
  annotateGovernedAvailability,
  canCompleteClaimReview,
  canCompleteEvidenceReview,
  canCompleteGeneratedContentReview,
  canStartGeneratedContentReview,
  claimGapFollowupsPath,
  claimLibraryCandidatesPath,
  claimProposalPath,
  claimReviewCompletePath,
  claimTraceabilityPath,
  coverageInternalAcceptancePath,
  createEvidenceSummaryPath,
  eligibleClaimsPath,
  errorText,
  evidenceCoverageAssessmentPath,
  evidenceExtractionPath,
  evidenceReviewCompletePath,
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
  postJson,
  potentialConflictsPath,
  projectCandidateClaims,
  projectCoverageAssessment,
  projectEligibleClaims,
  projectGeneratedDraftLibraryItems,
  projectGeneratedDraftPacket,
  projectTraceability,
  reviewTransitionBody,
  shouldApplyCandidateResponse,
  shouldApplyEligibilityResponse,
} from "./impactEvidenceLibraryLogic.js";
import { organizationsPath } from "./kaiWebIntakeLogic.js";

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

export default function ImpactEvidenceLibrary() {
  const [organizations, setOrganizations] = useState([]);
  const [organizationId, setOrganizationId] = useState("");
  const [loadingOrganizations, setLoadingOrganizations] = useState(true);
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false);
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

  // Governed internal availability (the all-state Claim Library) and audience
  // eligibility are independent dimensions: neither request may clear, gate, or
  // invalidate the other's successful result. See annotateGovernedAvailability.
  const claims = useMemo(() => {
    const merged = mergeClaims(eligibleClaims, candidateClaims);
    return annotateGovernedAvailability(merged, candidateClaims, eligibleClaims, eligibleRequestState);
  }, [candidateClaims, eligibleClaims, eligibleRequestState]);

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
    setSelectedGenerationClaimIds((current) => current.filter((claimId) => claims.some((claim) => claim.claimId === claimId && claim.libraryStatus === "usable")));
    setSelectedClaimId((current) => (claims.some((claim) => claim.claimId === current) ? current : claims[0]?.claimId || ""));
  }, [claims]);

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

  const toggleGenerationClaim = useCallback((claim) => {
    if (claim.libraryStatus !== "usable") return;
    setSelectedGenerationClaimIds((current) => (
      current.includes(claim.claimId)
        ? current.filter((claimId) => claimId !== claim.claimId)
        : [...current, claim.claimId].sort()
    ));
  }, []);

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

  const generateEvidenceSummary = useCallback(async () => {
    if (audience !== "internal" || selectedGenerationClaimIds.length === 0) return;
    setGeneratingDraft(true);
    setMessage("");
    setGeneratedDraftPacket(null);
    const createResult = await postJson(createEvidenceSummaryPath(organizationId), {
      claim_ids: selectedGenerationClaimIds,
      idempotency_key: `evidence-summary-${selectedGenerationClaimIds.join("-")}`,
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

  const runCompleteEvidenceReview = useCallback(async () => {
    if (!organizationId || !traceability?.evidence || workflowPending) return;
    if (!canCompleteEvidenceReview(traceability.evidence)) return;
    setWorkflowPending(true);
    setWorkflowResult("");
    const result = await postJson(
      evidenceReviewCompletePath(organizationId, traceability.evidence.evidence_item_id, traceability.evidence.review_queue_item_id),
      reviewTransitionBody(traceability.evidence.updated_at),
    );
    setWorkflowPending(false);
    setWorkflowResult(result.statusCode === 200 ? "Evidence review completed." : errorText(result));
    if (result.statusCode === 200) await loadTraceability(selectedClaimId);
  }, [organizationId, traceability, selectedClaimId, workflowPending, loadTraceability]);

  const runCompleteClaimReview = useCallback(async () => {
    if (!organizationId || !selectedClaimId || !traceability?.claimReview || workflowPending) return;
    if (!canCompleteClaimReview(traceability.evidence, traceability.claimReview)) return;
    setWorkflowPending(true);
    setWorkflowResult("");
    const result = await postJson(
      claimReviewCompletePath(organizationId, selectedClaimId, traceability.claimReview.review_queue_item_id),
      reviewTransitionBody(traceability.claimReview.updated_at),
    );
    setWorkflowPending(false);
    setWorkflowResult(result.statusCode === 200 ? "Claim review completed." : errorText(result));
    if (result.statusCode === 200) await loadTraceability(selectedClaimId);
  }, [organizationId, selectedClaimId, traceability, workflowPending, loadTraceability]);

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

      {message ? <div className="alert alert-warning py-2">{message}</div> : null}

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
                  {audience === "internal" && claim.libraryStatus === "usable" ? (
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
          <div className="admin-card">
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
                {canCompleteEvidenceReview(traceability.evidence) ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary mt-2 me-2"
                    onClick={runCompleteEvidenceReview}
                    disabled={workflowPending}
                  >
                    Complete Evidence Review
                  </button>
                ) : null}
                <ValueRow label="Claim review" value={`${traceability.claimReview?.queue_status || "none"} / ${traceability.claimReview?.review_status || "none"}`} />
                {canCompleteClaimReview(traceability.evidence, traceability.claimReview) ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary mt-2"
                    onClick={runCompleteClaimReview}
                    disabled={workflowPending}
                  >
                    Complete Claim Review
                  </button>
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
