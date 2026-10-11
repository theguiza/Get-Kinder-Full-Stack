import React, { useCallback, useEffect, useRef, useState } from "react";

import SensitivityReviewCardBody from "../SensitivityReviewCardBody.jsx";
import {
  buildSensitivityDecisionRequestBody,
  defaultSensitivityReviewFormState,
  errorText,
  getJson,
  isRouteUuid,
  postJson,
  projectSensitivityDecisionResult,
  projectSensitivityDetail,
  sensitivityDecisionPath,
  sensitivityProfilePath,
  sensitivityReviewFormStateFromDecision,
  sensitivityReviewWorkPath,
} from "../impactEvidenceLibraryLogic.js";
import { intakeFileSensitivityProfilePath } from "../kaiWebIntakeLogic.js";

const STALE_DECISION_MESSAGE = "Sensitivity review state changed since this was loaded - showing the refreshed state.";

function DecisionResult({ result }) {
  if (!result) return null;
  if (result.status === "work_started") return <div className="alert alert-info py-2 small">Sensitivity review work started.</div>;
  if (result.status === "conflict") return <div className="alert alert-warning py-2 small">{STALE_DECISION_MESSAGE}</div>;
  if (result.status === "error") return <div className="alert alert-warning py-2 small">{result.message}</div>;
  if (result.outcome !== "reviewed") {
    return (
      <div className="alert alert-info py-2 small">
        Marked as needing more information. The sensitivity review stays open; no source candidate is created.
      </div>
    );
  }
  const handoff = result.handoff;
  return (
    <div className="alert alert-info py-2 small" data-sensitivity-decision-result="">
      <div className="fw-semibold">Sensitivity decision recorded.</div>
      {handoff && (handoff.status === "created" || handoff.status === "replayed") ? (
        <div>
          Source-candidate handoff completed: this file is now a source candidate waiting for Get Kinder source review
          ({handoff.candidateStatus || "needs_gk_review"}). No source has been approved or promoted.
        </div>
      ) : null}
      {handoff && handoff.status === "not_created" ? (
        <div>
          Source candidate not created (error: {handoff.errorCode || "unknown"}). The sensitivity decision above remains
          recorded, and no source review item exists for this file. Submitting this form again records a new, superseding
          decision; it does not retry this handoff.
        </div>
      ) : null}
      {!handoff || handoff.status === "not_applicable" ? <div>The source-candidate handoff status is not available.</div> : null}
    </div>
  );
}

/**
 * The client Knowledge Studio's focused sensitivity & allowed-use review for
 * one pipeline file, opened only by an explicit reviewer action and only when
 * the shell's review-cockpit capabilities answer for this organization is
 * "allowed". The parent keys it by organization + Project + file, so any
 * context change mounts a fresh panel with no previous state.
 *
 * Every request is an existing review-cockpit route, authorized by its
 * service for the actual actor, organization, and target: the file ->
 * sensitivity-profile lookup and the profile detail (reads, on open); the
 * P1-06 review-work POST (only on "Start review work"); and the B1A-2
 * decision POST (only on a decision button), whose own P1-07 handoff is the
 * only way this panel reaches source candidates. Nothing is written on open,
 * nothing is retried, and every POST is followed by an authoritative re-read.
 * A response for a request this panel has since superseded, or that arrives
 * after it unmounted, is discarded.
 */
export default function ClientSensitivityReviewPanel({ organizationId, intakeFileId, safeFilename, onClose, onDecisionRecorded }) {
  const [lookup, setLookup] = useState({ status: "loading", profileId: "", error: "" });
  const [detailState, setDetailState] = useState({ status: "idle", detail: null, error: "" });
  const [formState, setFormState] = useState(defaultSensitivityReviewFormState());
  const [actionPending, setActionPending] = useState(false);
  const [result, setResult] = useState(null);
  const mountedRef = useRef(true);
  const detailSeqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadDetail = useCallback(async (profileId) => {
    detailSeqRef.current += 1;
    const requestSeq = detailSeqRef.current;
    setDetailState((current) => ({ ...current, status: "loading", error: "" }));
    const response = await getJson(sensitivityProfilePath(organizationId, profileId));
    if (!mountedRef.current || detailSeqRef.current !== requestSeq) return;
    if (response.statusCode !== 200 || !response.body?.ok) {
      setDetailState({ status: "error", detail: null, error: errorText(response) });
      return;
    }
    const detail = projectSensitivityDetail(response.body.data);
    setDetailState({ status: "success", detail, error: "" });
    setFormState(sensitivityReviewFormStateFromDecision(detail?.currentDecision));
  }, [organizationId]);

  useEffect(() => {
    (async () => {
      const response = await getJson(intakeFileSensitivityProfilePath(organizationId, intakeFileId));
      if (!mountedRef.current) return;
      const data = response.statusCode === 200 && response.body?.ok ? response.body.data : null;
      if (!data || data.intake_file_id !== intakeFileId) {
        setLookup({ status: "error", profileId: "", error: errorText(response) });
        return;
      }
      if (!isRouteUuid(data.intake_sensitivity_profile_id)) {
        setLookup({ status: "not_ready", profileId: "", error: "" });
        return;
      }
      setLookup({ status: "ready", profileId: data.intake_sensitivity_profile_id, error: "" });
      await loadDetail(data.intake_sensitivity_profile_id);
    })();
  }, [organizationId, intakeFileId, loadDetail]);

  const profileId = lookup.profileId;
  const detail = detailState.detail;

  const startReviewWork = useCallback(async () => {
    if (!profileId || actionPending) return;
    setActionPending(true);
    setResult(null);
    const response = await postJson(sensitivityReviewWorkPath(organizationId, profileId), {});
    if (!mountedRef.current) return;
    setActionPending(false);
    setResult(response.statusCode === 200 || response.statusCode === 201
      ? { status: "work_started" }
      : { status: "error", message: errorText(response) });
    await loadDetail(profileId);
  }, [organizationId, profileId, actionPending, loadDetail]);

  const submitDecision = useCallback(async (decision) => {
    const queueItem = detail?.reviewQueueItem;
    if (!profileId || !queueItem || actionPending) return;
    setActionPending(true);
    setResult(null);
    const response = await postJson(
      sensitivityDecisionPath(organizationId, profileId),
      buildSensitivityDecisionRequestBody({
        decision,
        expectedUpdatedAt: queueItem.updated_at,
        reviewQueueItemId: queueItem.review_queue_item_id,
        formState,
      }),
    );
    if (!mountedRef.current) return;
    setActionPending(false);
    const decisionResult = projectSensitivityDecisionResult(response, decision);
    setResult(decisionResult);
    // No retry and no optimistic state: re-read the authoritative review, and
    // refresh the client pipeline once a decision was recorded.
    await loadDetail(profileId);
    if (decisionResult.status === "recorded" && mountedRef.current) onDecisionRecorded?.();
  }, [organizationId, profileId, detail, actionPending, formState, loadDetail, onDecisionRecorded]);

  return (
    <div className="admin-card mt-3" data-client-sensitivity-review-panel={intakeFileId}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="mb-0">Sensitivity &amp; allowed-use review</h5>
        <div className="d-flex align-items-center gap-2">
          {detail?.currentDecision?.decision_outcome === "reviewed" ? (
            <span className="badge text-bg-success">Reviewed</span>
          ) : detail?.reviewQueueItem ? (
            <span className="badge text-bg-warning">Needs review</span>
          ) : null}
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>
            Close review
          </button>
        </div>
      </div>
      <div className="small text-muted mb-2">
        {safeFilename}. This is the Get Kinder sensitivity &amp; allowed-use review of the file, recorded through the same
        review service as in the Get Kinder workspace. It is not an Evidence or Impact Fact review.
      </div>
      {lookup.status === "loading" ? <div className="text-muted small">Loading this file&rsquo;s sensitivity review...</div> : null}
      {lookup.status === "not_ready" ? (
        <div className="small text-muted">
          This file&rsquo;s sensitivity profile is not ready yet, so there is nothing to review. Nothing was changed.
        </div>
      ) : null}
      {lookup.status === "error" ? <div className="alert alert-warning py-2 small">{lookup.error}</div> : null}
      {detailState.status === "loading" && !detail ? <div className="text-muted small">Loading sensitivity &amp; allowed-use review...</div> : null}
      {detailState.status === "error" ? <div className="alert alert-warning py-2 small">{detailState.error}</div> : null}
      <DecisionResult result={result} />
      <SensitivityReviewCardBody
        detail={detail}
        formState={formState}
        onFormStateChange={setFormState}
        actionPending={actionPending}
        onStartReviewWork={startReviewWork}
        onSubmitDecision={submitDecision}
        startReviewWorkLabel="Start review work"
      />
    </div>
  );
}
