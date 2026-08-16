import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  LIBRARY_AUDIENCES,
  canCompleteGeneratedContentReview,
  canStartGeneratedContentReview,
  claimLibraryCandidatesPath,
  claimTraceabilityPath,
  createEvidenceSummaryPath,
  eligibleClaimsPath,
  errorText,
  generatedContentReviewCompletePath,
  generatedContentReviewStartPath,
  generatedDraftLibraryIndexPath,
  generatedDraftReviewLabel,
  generatedDraftReviewPacketPath,
  getJson,
  mergeClaims,
  postJson,
  projectCandidateClaims,
  projectEligibleClaims,
  projectGeneratedDraftLibraryItems,
  projectGeneratedDraftPacket,
  projectTraceability,
  reviewTransitionBody,
} from "./impactEvidenceLibraryLogic.js";

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
  const [organizationId, setOrganizationId] = useState("");
  const [audience, setAudience] = useState("internal");
  const [claims, setClaims] = useState([]);
  const [selectedClaimId, setSelectedClaimId] = useState("");
  const [selectedGenerationClaimIds, setSelectedGenerationClaimIds] = useState([]);
  const [generatedDraftPacket, setGeneratedDraftPacket] = useState(null);
  const [generatedDrafts, setGeneratedDrafts] = useState([]);
  const [selectedGeneratedDraftId, setSelectedGeneratedDraftId] = useState("");
  const [loadingGeneratedDrafts, setLoadingGeneratedDrafts] = useState(false);
  const [traceability, setTraceability] = useState(null);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [loadingTraceability, setLoadingTraceability] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [reviewTransitionPending, setReviewTransitionPending] = useState(false);
  const [message, setMessage] = useState("");

  const selectedClaim = useMemo(
    () => claims.find((claim) => claim.claimId === selectedClaimId) || null,
    [claims, selectedClaimId],
  );

  const loadClaims = useCallback(async () => {
    if (!organizationId) {
      setMessage("An organization id is required.");
      return;
    }
    setLoadingClaims(true);
    setMessage("");
    setTraceability(null);
    const [eligibleResult, candidateResult] = await Promise.all([
      getJson(eligibleClaimsPath(organizationId, audience)),
      getJson(claimLibraryCandidatesPath(organizationId)),
    ]);
    setLoadingClaims(false);
    if (eligibleResult.statusCode !== 200 || !eligibleResult.body?.ok) {
      setClaims([]);
      setMessage(errorText(eligibleResult));
      return;
    }
    if (candidateResult.statusCode !== 200 || !candidateResult.body?.ok) {
      setClaims(projectEligibleClaims(eligibleResult.body.data));
      setMessage(errorText(candidateResult));
      return;
    }
    const merged = mergeClaims(
      projectEligibleClaims(eligibleResult.body.data),
      projectCandidateClaims(candidateResult.body.data),
    );
    setClaims(merged);
    setGeneratedDraftPacket(null);
    setSelectedGenerationClaimIds((current) => current.filter((claimId) => merged.some((claim) => claim.claimId === claimId && claim.libraryStatus === "usable")));
    setSelectedClaimId((current) => (merged.some((claim) => claim.claimId === current) ? current : merged[0]?.claimId || ""));
  }, [audience, organizationId]);

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

  return (
    <section>
      <h1 className="admin-title mb-3">Impact Evidence Library</h1>
      <div className="admin-card mb-3">
        <div className="row g-3 align-items-end">
          <div className="col-12 col-lg-5">
            <label className="form-label small fw-semibold">Organization id</label>
            <input
              className="form-control form-control-sm"
              value={organizationId}
              onChange={(event) => setOrganizationId(event.target.value.trim())}
            />
          </div>
          <div className="col-12 col-lg-4">
            <label className="form-label small fw-semibold">Audience</label>
            <select className="form-select form-select-sm" value={audience} onChange={(event) => setAudience(event.target.value)}>
              {LIBRARY_AUDIENCES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="col-12 col-lg-3">
            <button type="button" className="btn btn-sm btn-primary w-100" onClick={loadClaims} disabled={loadingClaims}>
              {loadingClaims ? "Loading..." : "Load claims"}
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
            {loadingClaims ? <div className="text-muted">Loading claims...</div> : null}
            {!loadingClaims && claims.length === 0 ? <div className="text-muted">No usable or review-candidate claims returned.</div> : null}
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
                <ValueRow label="Requested audience" value={traceability.requestedAudience} />
                <ValueRow label="Can use" value={traceability.eligible ? "yes" : "no"} />
                <ValueRow label="Allowed audience" value={JSON.stringify(traceability.audienceGates)} />
                <ValueRow label="Evidence item" value={traceability.evidence?.evidence_item_id} />
                <ValueRow label="Source" value={traceability.source?.source_id} />
                <ValueRow label="Source version" value={traceability.sourceVersion?.source_version_id} />
                <ValueRow label="Blockers" value={traceability.blockerCodes.length ? traceability.blockerCodes.join(", ") : "none"} />

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
                <ValueRow label="Claim review" value={`${traceability.claimReview?.queue_status || "none"} / ${traceability.claimReview?.review_status || "none"}`} />
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
