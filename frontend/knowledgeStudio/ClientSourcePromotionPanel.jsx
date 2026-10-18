import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  errorText,
  getJson,
  intakeFileSourceCandidatePath,
  isRouteUuid,
  postJson,
  sourceCandidateDecisionPath,
  sourceCandidateDetailPath,
} from "../impactEvidenceLibraryLogic.js";
import { SourceCandidateDetail } from "../kaiReviewCockpit.jsx";
import { sourcePromotionFailureMessage, sourcePromotionResultMessage } from "./clientEvidenceWorkflowLogic.js";

/**
 * P1-08 source review of one file of the selected Project in the client
 * Knowledge Studio (owner decision 2026-10-18), opened only by an explicit
 * action. The parent keys it by organization + Project + file.
 *
 * Requests, all existing review-cockpit routes authorized by their service
 * for the actual actor, organization, and target: the file -> source
 * candidate lookup (scoped to the Project) and the candidate detail (reads,
 * on open), and the P1-08 decision POST (only from the decision form). The
 * form, the reviewed-source-type choices, and whether a decision is possible
 * at all are the detail's own decision_controls_enabled /
 * allowed_reviewed_source_types, never a role list here. A refusal is shown
 * as the server returned it and never retried; every POST is followed by an
 * authoritative re-read.
 */
export default function ClientSourcePromotionPanel({ organizationId, engagementId, intakeFileId, safeFilename, onClose, onDecisionRecorded }) {
  const [lookup, setLookup] = useState({ status: "loading", candidateId: "", error: "" });
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadDetail = useCallback(async (candidateId) => {
    const response = await getJson(sourceCandidateDetailPath(organizationId, candidateId));
    if (!mountedRef.current) return;
    if (response.statusCode !== 200 || !response.body?.ok) {
      setDetail(null);
      setDetailError(errorText(response));
      return;
    }
    setDetailError("");
    setDetail(response.body.data);
  }, [organizationId]);

  useEffect(() => {
    (async () => {
      const response = await getJson(intakeFileSourceCandidatePath(organizationId, engagementId, intakeFileId));
      if (!mountedRef.current) return;
      const data = response.statusCode === 200 && response.body?.ok ? response.body.data : null;
      if (!data || data.intake_file_id !== intakeFileId) {
        setLookup({ status: "error", candidateId: "", error: errorText(response) });
        return;
      }
      if (!isRouteUuid(data.intake_source_candidate_id)) {
        setLookup({ status: "none", candidateId: "", error: "" });
        return;
      }
      setLookup({ status: "ready", candidateId: data.intake_source_candidate_id, error: "" });
      await loadDetail(data.intake_source_candidate_id);
    })();
  }, [organizationId, engagementId, intakeFileId, loadDetail]);

  const submitDecision = useCallback(async (payload) => {
    const candidateId = detail?.source_candidate?.intake_source_candidate_id;
    if (!candidateId || candidateId !== lookup.candidateId || busy) return;
    setBusy(true);
    setResult(null);
    const response = await postJson(sourceCandidateDecisionPath(organizationId, candidateId), payload);
    if (!mountedRef.current) return;
    setBusy(false);
    const recorded = response.statusCode === 200 && response.body?.ok;
    setResult(recorded
      ? { kind: "info", text: sourcePromotionResultMessage(response.body.data) }
      : { kind: "warning", text: sourcePromotionFailureMessage(response) });
    await loadDetail(candidateId);
    if (recorded && mountedRef.current) onDecisionRecorded?.();
  }, [organizationId, detail, lookup.candidateId, busy, loadDetail, onDecisionRecorded]);

  return (
    <div className="admin-card mt-3" data-client-source-promotion-panel={intakeFileId}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="mb-0">Source review</h5>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>
          Close source review
        </button>
      </div>
      <div className="small text-muted mb-2">
        {safeFilename}. Decide whether this file becomes a governed source that evidence can be extracted from. Promotion
        keeps the file&rsquo;s recorded sensitivity and allowed-use restrictions; it does not approve any evidence, claim, or
        external use.
      </div>
      {lookup.status === "loading" ? <div className="text-muted small">Loading this file&rsquo;s source candidate...</div> : null}
      {lookup.status === "none" ? (
        <div className="small text-muted">This file has no source candidate yet, so there is nothing to promote. Nothing was changed.</div>
      ) : null}
      {lookup.status === "error" ? <div className="alert alert-warning py-2 small">{lookup.error}</div> : null}
      {detailError ? <div className="alert alert-warning py-2 small">{detailError}</div> : null}
      {result ? (
        <div className={`alert alert-${result.kind} py-2 small`} role="status" data-client-source-promotion-result="">{result.text}</div>
      ) : null}
      {detail ? <SourceCandidateDetail detail={detail} onSubmitDecision={submitDecision} busy={busy} decisionResult="" retryPayload={null} /> : null}
    </div>
  );
}
