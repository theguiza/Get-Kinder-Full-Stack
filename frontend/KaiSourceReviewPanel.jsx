import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  errorText,
  getJson,
  postJson,
  sourceCandidateDecisionPath,
  sourceCandidateDetailPath,
} from "./impactEvidenceLibraryLogic.js";
import { SourceCandidateDetail, sourceDecisionResultText } from "./kaiReviewCockpit.jsx";

/**
 * P1-08 source review inside the GK Knowledge Studio Reviews tab. The parent
 * renders this only after the capability probe reports
 * can_review_source_candidates and supplies the open source_candidate_review
 * items it fetched. This panel opens one candidate through the existing
 * review-cockpit detail route and submits through the existing decision route;
 * whether a decision form appears is the server's decision_controls_enabled
 * (the P1-08 write authorization and the candidate's decidable state), never a
 * role list in the browser. Mount it with key={organizationId} so a tenant
 * change discards every candidate, detail, and result.
 */
export default function KaiSourceReviewPanel({ organizationId, items, onDecisionRecorded }) {
  const [selectedCandidateId, setSelectedCandidateId] = useState("");
  const [detail, setDetail] = useState(null);
  const [message, setMessage] = useState("");
  const [decisionResult, setDecisionResult] = useState("");
  const [retryPayload, setRetryPayload] = useState(null);
  const [busy, setBusy] = useState(false);
  const selectedRef = useRef("");

  const loadDetail = useCallback(async (candidateId) => {
    const result = await getJson(sourceCandidateDetailPath(organizationId, candidateId));
    if (selectedRef.current !== candidateId) return null;
    if (result.statusCode !== 200 || !result.body?.ok) {
      setDetail(null);
      setMessage(errorText(result));
      return null;
    }
    setMessage("");
    setDetail(result.body.data);
    return result.body.data;
  }, [organizationId]);

  const openCandidate = useCallback(async (candidateId) => {
    selectedRef.current = candidateId;
    setSelectedCandidateId(candidateId);
    setDetail(null);
    setDecisionResult("");
    setRetryPayload(null);
    setBusy(true);
    await loadDetail(candidateId);
    if (selectedRef.current === candidateId) setBusy(false);
  }, [loadDetail]);

  const submitDecision = useCallback(async (payload) => {
    const candidateId = detail?.source_candidate?.intake_source_candidate_id;
    if (!candidateId || candidateId !== selectedRef.current) return;
    setBusy(true);
    const result = await postJson(sourceCandidateDecisionPath(organizationId, candidateId), payload);
    if (selectedRef.current !== candidateId) return;
    setBusy(false);
    setRetryPayload(null);
    if (result.statusCode !== 200 || !result.body?.ok) {
      // A refusal or stale-state conflict is shown as the server returned it;
      // it is never retried or re-sent with a different outcome from here.
      setDecisionResult(errorText(result));
      return;
    }
    const handoff = result.body.data.evidence_extraction_handoff;
    setDecisionResult(sourceDecisionResultText(result.body.data));
    if (handoff?.status === "not_created" && payload.outcome === "promoted") setRetryPayload(payload);
    await loadDetail(candidateId);
    onDecisionRecorded?.();
  }, [detail, loadDetail, onDecisionRecorded, organizationId]);

  useEffect(() => () => { selectedRef.current = ""; }, []);

  return (
    <div className="border rounded p-2 mb-2">
      <div className="d-flex justify-content-between align-items-center">
        <span className="small fw-semibold">Source review</span>
        <span className="badge text-bg-secondary">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="text-muted small">No source candidates are waiting for review.</div>
      ) : (
        <ul className="list-unstyled mt-1 mb-0">
          {items.map((item) => (
            <li
              key={item.reviewQueueItemId}
              className="d-flex justify-content-between align-items-center gap-2 mt-1"
              data-source-candidate-id={item.intakeSourceCandidateId}
            >
              <span className="small text-break">
                {item.summary || "Source candidate"}
                <span className="text-muted"> ({item.intakeSourceCandidateId})</span>
              </span>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary flex-shrink-0"
                onClick={() => openCandidate(item.intakeSourceCandidateId)}
                disabled={busy}
              >
                Review source candidate
              </button>
            </li>
          ))}
        </ul>
      )}
      {message ? <div className="alert alert-warning py-2 small mb-0 mt-2">{message}</div> : null}
      {selectedCandidateId && detail ? (
        <SourceCandidateDetail
          detail={detail}
          onSubmitDecision={submitDecision}
          busy={busy}
          decisionResult={decisionResult}
          retryPayload={retryPayload}
        />
      ) : null}
    </div>
  );
}
