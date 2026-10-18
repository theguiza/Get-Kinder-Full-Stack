import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  claimLibraryCandidatesPath,
  claimProposalPath,
  createEvidenceSummaryPath,
  createImpactNarrativePath,
  errorText,
  evidenceExtractionPath,
  evidenceLibraryCandidatesPath,
  getJson,
  isRouteUuid,
  organizationSourcesPath,
  postJson,
  projectCandidateClaims,
  projectEvidenceLibraryItems,
  projectOrganizationSources,
} from "../impactEvidenceLibraryLogic.js";
import {
  INTERNAL_DRAFT_READINESS_MESSAGES,
  claimIdsByEvidenceItem,
  claimInternalDraftSelectability,
  claimProposalResultMessage,
  claimSelectabilityMessage,
  extractionResultMessage,
  internalDraftFailureMessage,
  internalDraftReadiness,
  internalDraftRequestBody,
  internalDraftResultSummary,
  retainSelectableClaimIds,
} from "./clientEvidenceWorkflowLogic.js";

const DRAFT_LABELS = Object.freeze({
  evidence_summary: "Internal evidence summary",
  impact_narrative: "Internal impact narrative",
});

function useOrganizationRead(organizationId, path, project, refreshToken) {
  const [state, setState] = useState({ organizationId: "", status: "idle", items: [] });
  const keyRef = useRef("");
  useEffect(() => {
    if (!organizationId) return undefined;
    const requestKey = `${organizationId}:${refreshToken}`;
    keyRef.current = requestKey;
    setState((current) => ({ organizationId, status: "loading", items: current.organizationId === organizationId ? current.items : [] }));
    getJson(path(organizationId)).then((result) => {
      if (keyRef.current !== requestKey) return;
      if (result.statusCode !== 200 || !result.body?.ok) {
        setState({ organizationId, status: "error", items: [], message: errorText(result) });
        return;
      }
      setState({ organizationId, status: "success", items: project(result.body.data) });
    });
    return () => { keyRef.current = ""; };
  }, [organizationId, path, project, refreshToken]);
  return state.organizationId === organizationId ? state : { organizationId, status: "loading", items: [] };
}

/**
 * Data Sources tab of the client Knowledge Studio for an organization
 * administrator (owner decision 2026-10-18). Mounted only while the tab is
 * open and only when the access-capabilities read admits at least one of
 * extractEvidence / proposeClaim / generateDrafts; each action is shown only
 * for its own flag, and the server re-authorizes every request.
 *
 * Requests: the organization-scoped Sources, Evidence Library, and Claim
 * Library reads; the P2-01 extraction and P2-03 claim-proposal writes; and the
 * internal evidence-summary and impact-narrative generation writes. Never the
 * funder or any other generator, a review decision, or a GK review packet.
 */
export default function ClientEvidenceWorkflow({ organizationId, engagementId, access }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = () => setRefreshToken((value) => value + 1);
  const sources = useOrganizationRead(organizationId, organizationSourcesPath, projectOrganizationSources, refreshToken);
  const evidence = useOrganizationRead(organizationId, evidenceLibraryCandidatesPath, projectEvidenceLibraryItems, refreshToken);
  const claims = useOrganizationRead(organizationId, claimLibraryCandidatesPath, projectCandidateClaims, refreshToken);

  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState(null);
  const [selectedClaimIds, setSelectedClaimIds] = useState([]);
  const [draftKeys, setDraftKeys] = useState({});
  const [lastDraft, setLastDraft] = useState(null);
  const contextRef = useRef("");
  const contextKey = `${organizationId}:${engagementId || ""}`;
  contextRef.current = contextKey;

  useEffect(() => {
    setSelectedClaimIds([]);
    setDraftKeys({});
    setLastDraft(null);
    setNotice(null);
  }, [organizationId, engagementId]);
  useEffect(() => {
    if (claims.status === "success") setSelectedClaimIds((current) => retainSelectableClaimIds(current, claims.items));
  }, [claims.status, claims.items]);

  const runWrite = useCallback(async (label, path, body, onSuccess, failureText = errorText) => {
    const requestContext = contextRef.current;
    setPending(label);
    setNotice(null);
    const result = await postJson(path, body);
    if (contextRef.current !== requestContext) return;
    setPending("");
    if ((result.statusCode !== 200 && result.statusCode !== 201) || !result.body?.ok) {
      setNotice({ kind: "warning", text: failureText(result) });
      return;
    }
    onSuccess(result.body.data);
    refresh();
  }, []);

  const extract = (sourceVersionId) => runWrite(`extract:${sourceVersionId}`, evidenceExtractionPath(organizationId, sourceVersionId), {},
    (data) => setNotice({ kind: "success", text: extractionResultMessage(data) }));
  const propose = (evidenceItemId) => runWrite(`propose:${evidenceItemId}`, claimProposalPath(organizationId, evidenceItemId), {},
    (data) => setNotice({ kind: "success", text: claimProposalResultMessage(data) }));

  const toggleClaim = (claimId) => {
    setDraftKeys({});
    setSelectedClaimIds((current) => (current.includes(claimId) ? current.filter((id) => id !== claimId) : [...current, claimId]));
  };
  const readiness = internalDraftReadiness({ canGenerate: access.generateDrafts, engagementId, selectedClaimIds });
  const generate = (contentType, pathBuilder) => {
    if (!readiness.ready) return;
    // One idempotency key per selection and content type: a repeated click
    // replays the same draft instead of creating another.
    const idempotencyKey = draftKeys[contentType] || `client-${contentType}-${globalThis.crypto.randomUUID()}`;
    setDraftKeys((current) => ({ ...current, [contentType]: idempotencyKey }));
    return runWrite(`generate:${contentType}`, pathBuilder(organizationId),
      internalDraftRequestBody({ claimIds: selectedClaimIds, idempotencyKey, engagementId }),
      (data) => setLastDraft(internalDraftResultSummary(data, contentType)), internalDraftFailureMessage);
  };

  const proposedByEvidence = claimIdsByEvidenceItem(claims.items);

  return (
    <div data-client-evidence-workflow="">
      {notice ? (
        <div className={`alert alert-${notice.kind} py-2 small`} role="status" data-client-workflow-notice="">{notice.text}</div>
      ) : null}

      <div className="admin-card mb-3">
        <h5 className="mb-2">Data Sources</h5>
        <div className="small text-muted mb-2">
          Sources appear here after Get Kinder has reviewed and promoted an uploaded file. Extract evidence from a source
          version to see what it supports.
        </div>
        {sources.status === "loading" ? <div className="text-muted small">Loading sources...</div> : null}
        {sources.status === "error" ? <div className="alert alert-warning py-2 small">Sources could not be loaded. {sources.message}</div> : null}
        {sources.status === "success" && sources.items.length === 0 ? (
          <div className="text-muted small">No promoted sources yet. Upload data in Files; Get Kinder reviews it before it becomes a source.</div>
        ) : null}
        {sources.status === "success" && sources.items.length > 0 ? (
          <ul className="list-group">
            {sources.items.map((source) => (
              <li key={source.sourceId} className="list-group-item" data-client-source={source.sourceId}>
                <div className="fw-semibold small">{source.sourceCode}</div>
                <div className="small text-muted">{String(source.reviewedSourceType || "").replace(/_/g, " ")}</div>
                {source.sourceVersions.map((version) => (
                  <div key={version.sourceVersionId} className="d-flex flex-wrap align-items-center gap-2 mt-1 small" data-client-source-version={version.sourceVersionId}>
                    <span>{version.isCurrent ? "Current version" : "Earlier version"}</span>
                    {access.extractEvidence && isRouteUuid(version.sourceVersionId) ? (
                      <button type="button" className="btn btn-sm btn-outline-primary" disabled={Boolean(pending)}
                        onClick={() => extract(version.sourceVersionId)}>
                        {pending === `extract:${version.sourceVersionId}` ? "Extracting..." : "Extract evidence"}
                      </button>
                    ) : null}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="admin-card mb-3">
        <h5 className="mb-2">Evidence</h5>
        <div className="small text-muted mb-2">
          Evidence extracted from your sources. Every item awaits Get Kinder evidence review; proposing a claim does not approve it.
        </div>
        {evidence.status === "loading" ? <div className="text-muted small">Loading evidence...</div> : null}
        {evidence.status === "error" ? <div className="alert alert-warning py-2 small">Evidence could not be loaded. {evidence.message}</div> : null}
        {evidence.status === "success" && evidence.items.length === 0 ? <div className="text-muted small">No evidence yet.</div> : null}
        {evidence.status === "success" && evidence.items.length > 0 ? (
          <ul className="list-group">
            {evidence.items.map((item) => {
              const proposed = proposedByEvidence.get(item.evidenceItemId) || [];
              return (
                <li key={item.evidenceItemId} className="list-group-item small" data-client-evidence={item.evidenceItemId}>
                  <div className="text-break">{item.statement || "Statement not available"}</div>
                  <div className="text-muted mt-1">
                    Review: {item.evidenceReviewStatus || "unknown"} · Support: {item.supportStrength || "unknown"}
                    {item.sensitivityLevel ? ` · Sensitivity: ${item.sensitivityLevel}` : ""}
                  </div>
                  {proposed.length > 0 ? <div className="mt-1">Claim proposed</div> : null}
                  {access.proposeClaim && proposed.length === 0 ? (
                    <button type="button" className="btn btn-sm btn-outline-primary mt-1" disabled={Boolean(pending)}
                      onClick={() => propose(item.evidenceItemId)}>
                      {pending === `propose:${item.evidenceItemId}` ? "Proposing..." : "Propose claim"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <div className="admin-card mb-3">
        <h5 className="mb-2">Claims for internal drafts</h5>
        <div className="small text-muted mb-2">
          Internal drafts may use claims still awaiting Get Kinder review. Using a claim here does not approve it for funders
          or the public.
        </div>
        {claims.status === "loading" ? <div className="text-muted small">Loading claims...</div> : null}
        {claims.status === "error" ? <div className="alert alert-warning py-2 small">Claims could not be loaded. {claims.message}</div> : null}
        {claims.status === "success" && claims.items.length === 0 ? <div className="text-muted small">No claims yet. Propose one from evidence above.</div> : null}
        {claims.status === "success" && claims.items.length > 0 ? (
          <ul className="list-group">
            {claims.items.map((claim) => {
              const selectability = claimInternalDraftSelectability(claim);
              return (
                <li key={claim.claimId} className="list-group-item small" data-client-claim={claim.claimId}>
                  <div className="text-break">{claim.claimStatement || claim.evidenceStatement || "Statement not available"}</div>
                  <div className="text-muted mt-1">
                    Status: {claim.claimStatus} · Review: {claim.claimReviewStatus} · Strength: {claim.claimStrength}
                  </div>
                  {access.generateDrafts && selectability.selectable ? (
                    <label className="form-check mt-1">
                      <input className="form-check-input" type="checkbox" checked={selectedClaimIds.includes(claim.claimId)}
                        onChange={() => toggleClaim(claim.claimId)} />
                      <span className="form-check-label">Use in an internal draft</span>
                    </label>
                  ) : null}
                  {!selectability.selectable ? <div className="mt-1">{claimSelectabilityMessage(selectability.reason)}</div> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {access.generateDrafts ? (
        <div className="admin-card mb-3">
          <h5 className="mb-2">Internal drafts</h5>
          {!readiness.ready ? <div className="small mb-2" data-client-draft-readiness={readiness.reason}>{INTERNAL_DRAFT_READINESS_MESSAGES[readiness.reason]}</div> : null}
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-primary" disabled={!readiness.ready || Boolean(pending)}
              onClick={() => generate("evidence_summary", createEvidenceSummaryPath)}>
              {pending === "generate:evidence_summary" ? "Generating..." : "Generate internal evidence summary"}
            </button>
            <button type="button" className="btn btn-sm btn-outline-primary" disabled={!readiness.ready || Boolean(pending)}
              onClick={() => generate("impact_narrative", createImpactNarrativePath)}>
              {pending === "generate:impact_narrative" ? "Generating..." : "Generate internal impact narrative"}
            </button>
          </div>
          {lastDraft ? (
            <div className="small mt-2" data-client-generated-draft={lastDraft.generatedContentDraftId}>
              <div className="fw-semibold">
                {DRAFT_LABELS[lastDraft.contentType]} {lastDraft.replayed ? "already created" : "created"}: {lastDraft.blockCount} block(s) citing {lastDraft.citedClaimCount} claim(s).
              </div>
              <div>
                Status: {lastDraft.draftStatus || "unknown"}, {lastDraft.reviewStatus || "review status unknown"}. Internal use only. It
                appears under Generated Drafts once Get Kinder has reviewed it.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
