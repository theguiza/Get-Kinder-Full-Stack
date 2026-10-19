import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  errorText,
  getJson,
  intakeFileSourceCandidatePath,
  isRouteUuid,
  postJson,
  projectSensitivityDetail,
  sensitivityProfilePath,
  sourceCandidateDecisionPath,
  sourceCandidateDetailPath,
} from "../impactEvidenceLibraryLogic.js";
import { intakeFileSensitivityProfilePath } from "../kaiWebIntakeLogic.js";
import { SourceCandidateDetail } from "../kaiReviewCockpit.jsx";
import {
  SOURCE_AUTHORIZATION_INTENDED_USE,
  sourcePromotionFailureMessage,
  sourcePromotionResultMessage,
  sourceRestrictionLines,
} from "./clientEvidenceWorkflowLogic.js";

const CONFIRMATION_REQUIRED = "Confirm the source authorization above before promoting. Nothing was sent.";

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
 *
 * Source authorization (owner decision 2026-10-19): before a 'promoted'
 * decision is sent, the person confirms, for this exact file, its identity,
 * the proposed source type, the intended internal use, and the restrictions
 * its current sensitivity decision records (read through the existing review
 * reads). A 'promoted' decision is never sent without that confirmation;
 * rejection and needs_more_information are unaffected.
 */
export default function ClientSourcePromotionPanel({ organizationId, engagementId, intakeFileId, safeFilename, onClose, onDecisionRecorded }) {
  const [lookup, setLookup] = useState({ status: "loading", candidateId: "", error: "" });
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [restrictions, setRestrictions] = useState({ status: "loading", lines: [] });
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

  // The restrictions the file's current sensitivity decision records.
  useEffect(() => {
    (async () => {
      const lookup = await getJson(intakeFileSensitivityProfilePath(organizationId, intakeFileId));
      const profileId = lookup.statusCode === 200 && lookup.body?.ok ? lookup.body.data?.intake_sensitivity_profile_id : null;
      if (!mountedRef.current) return;
      if (!isRouteUuid(profileId)) {
        setRestrictions({ status: "error", lines: [] });
        return;
      }
      const profile = await getJson(sensitivityProfilePath(organizationId, profileId));
      if (!mountedRef.current) return;
      const projected = profile.statusCode === 200 && profile.body?.ok ? projectSensitivityDetail(profile.body.data) : null;
      setRestrictions(projected
        ? { status: "ready", lines: sourceRestrictionLines(projected.currentDecision) }
        : { status: "error", lines: [] });
    })();
  }, [organizationId, intakeFileId]);

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
    if (payload?.outcome === "promoted" && !confirmed) {
      setResult({ kind: "warning", text: CONFIRMATION_REQUIRED });
      return;
    }
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
  }, [organizationId, detail, lookup.candidateId, busy, confirmed, loadDetail, onDecisionRecorded]);

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
      {detail?.decision_controls_enabled ? (
        <div className="border rounded p-2 mb-2 small" data-client-source-authorization="">
          <div className="fw-semibold mb-1">Source authorization</div>
          <ul className="mb-1">
            <li>Source: {safeFilename} (this file&rsquo;s source candidate, proposed type &ldquo;{detail.source_candidate.proposed_source_type}&rdquo;; you choose the reviewed source type below).</li>
            <li>Intended use: {SOURCE_AUTHORIZATION_INTENDED_USE}</li>
            <li>
              Restrictions recorded by the sensitivity &amp; allowed-use review:
              {restrictions.status === "loading" ? " loading..." : null}
              {restrictions.status === "error" ? " could not be loaded; the server still applies them." : null}
              {restrictions.status === "ready" ? (
                <ul className="mb-0" data-client-source-restrictions="">
                  {restrictions.lines.map((line) => <li key={line}>{line}</li>)}
                </ul>
              ) : null}
            </li>
          </ul>
          <label className="form-check">
            <input className="form-check-input" type="checkbox" checked={confirmed} data-client-source-authorization-confirm=""
              onChange={(event) => setConfirmed(event.target.checked)} />
            <span className="form-check-label">I confirm this file may become a governed source for the intended use above, under these restrictions.</span>
          </label>
        </div>
      ) : null}
      {detail ? <SourceCandidateDetail detail={detail} onSubmitDecision={submitDecision} busy={busy} decisionResult="" retryPayload={null} /> : null}
    </div>
  );
}
