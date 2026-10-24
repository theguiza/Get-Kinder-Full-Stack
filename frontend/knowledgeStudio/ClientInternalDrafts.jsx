import React, { useEffect, useRef, useState } from "react";

import {
  clientInternalDraftFactualReviewPath,
  clientInternalDraftPath,
  clientInternalDraftReleasePath,
  clientInternalDraftsPath,
  clientReleasedReportMarkdownPath,
  errorText,
  getJson,
  postJson,
  projectClientInternalDraft,
  projectClientInternalDraftList,
} from "../impactEvidenceLibraryLogic.js";
import {
  INTERNAL_DRAFT_FACTUAL_REVIEW_REASON_MESSAGES,
  INTERNAL_DRAFT_LIMITATION_MESSAGES,
  INTERNAL_DRAFT_RELEASE_REASON_MESSAGES,
  INTERNAL_DRAFT_RELEASED_BY_LABELS,
  INTERNAL_DRAFT_RELEASE_STATE_LABELS,
  INTERNAL_DRAFT_RELEASE_STATE_MESSAGES,
  INTERNAL_DRAFT_REVIEW_STATE_LABELS,
  internalDraftFactualReviewHeading,
  internalDraftFactualReviewNextActions,
} from "./clientEvidenceWorkflowLogic.js";

const DRAFT_LABELS = Object.freeze({
  evidence_summary: "Internal evidence summary",
  impact_narrative: "Internal impact narrative",
});

/**
 * The organization administrator's own internal drafts for the selected
 * Project (owner decision 2026-10-19), read from the persisted drafts through
 * the client-internal-drafts routes, which authorize every read. Shows each
 * draft's true Get Kinder review state, its text, the claims each block cites
 * (statement and review status from the organization's Claim Library read),
 * and its limitations. Reading a draft approves, releases, or exports nothing.
 * `focusDraftId` opens that draft once it is listed (after generation).
 *
 * Release (Plan A Prompt 8): the detail carries the server's release state.
 * Only when Get Kinder has released the report and it is still valid, and
 * the actor holds readReleasedInternalReports, can it be opened or downloaded
 * through the client-released-reports route, which re-checks the release on
 * every request. Opening it grants no review or release authority.
 *
 * Factual review (owner amendment 2026-10-23): for an ordinary internal
 * evidence summary the server marks actorMayApprove, and an actor holding
 * reviewInternalDraftFactualContent may record the factual approval after
 * confirming they read the text, citations and limitations. Otherwise the
 * server's reasons say why Get Kinder reviews it or why it is blocked.
 * Approval releases nothing.
 *
 * Release (owner amendment 2026-10-23): final release is a separate decision.
 * For a reviewed ordinary internal evidence summary the server marks
 * organizationRelease.actorMayRelease, and an actor holding
 * releaseInternalReports may release it for internal use after confirming the
 * limitations; the server then runs the existing release chain under that
 * human's identity. Otherwise the server's reasons say why Get Kinder
 * releases it or why nobody may release it now.
 */
export default function ClientInternalDrafts({
  organizationId, engagementId, claims, refreshToken, focusDraftId, canReadReleasedReports = false, canReviewFactualContent = false,
  canReleaseReports = false,
}) {
  const [list, setList] = useState({ status: "idle", items: [], error: "" });
  const [listRefresh, setListRefresh] = useState(0);
  const [approval, setApproval] = useState({ status: "idle", draftId: "", confirmed: false, error: "" });
  const [releaseDecision, setReleaseDecision] = useState({ status: "idle", draftId: "", confirmed: false, error: "" });
  const [detail, setDetail] = useState({ status: "idle", draft: null, error: "" });
  const [report, setReport] = useState({ status: "idle", draftId: "", markdown: "", error: "" });
  const keyRef = useRef("");
  const detailSeqRef = useRef(0);
  // The generated draft opened once after generation; a later list reload
  // (for example after an approval) must not switch the open draft back.
  const focusedRef = useRef("");

  const openReleasedReport = async (draftId, releasedReportId) => {
    setReport({ status: "loading", draftId, markdown: "", error: "" });
    const response = await fetch(clientReleasedReportMarkdownPath(organizationId, engagementId, releasedReportId), {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "text/markdown" },
    });
    if (response.status === 200) {
      setReport({ status: "success", draftId, markdown: await response.text(), error: "" });
      return;
    }
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    setReport({ status: "error", draftId, markdown: "", error: errorText({ statusCode: response.status, body }) });
  };

  const approveFactualContent = async (generatedContentDraftId) => {
    setApproval({ status: "saving", draftId: generatedContentDraftId, confirmed: true, error: "" });
    const result = await postJson(clientInternalDraftFactualReviewPath(organizationId, engagementId, generatedContentDraftId), { decision: "approved" });
    if (result.statusCode === 200 && result.body?.ok) {
      setApproval({ status: "success", draftId: generatedContentDraftId, confirmed: false, error: "" });
      setListRefresh((value) => value + 1);
      await openDraft(generatedContentDraftId);
      return;
    }
    const reasons = Array.isArray(result.body?.blockers)
      ? result.body.blockers.map((blocker) => INTERNAL_DRAFT_FACTUAL_REVIEW_REASON_MESSAGES[blocker?.blocking_reason]).filter(Boolean)
      : [];
    setApproval({ status: "error", draftId: generatedContentDraftId, confirmed: false, error: [errorText(result), ...reasons].join(" ") });
  };

  const releaseReport = async (generatedContentDraftId) => {
    setReleaseDecision({ status: "saving", draftId: generatedContentDraftId, confirmed: true, error: "" });
    const result = await postJson(clientInternalDraftReleasePath(organizationId, engagementId, generatedContentDraftId),
      { decision: "release_for_internal_use", limitations_confirmed: true });
    if (result.statusCode === 200 && result.body?.ok) {
      setReleaseDecision({ status: "success", draftId: generatedContentDraftId, confirmed: false, error: "" });
      await openDraft(generatedContentDraftId);
      return;
    }
    const reasons = Array.isArray(result.body?.blockers)
      ? result.body.blockers.map((blocker) => INTERNAL_DRAFT_RELEASE_REASON_MESSAGES[blocker?.blocking_reason]).filter(Boolean)
      : [];
    setReleaseDecision({ status: "error", draftId: generatedContentDraftId, confirmed: false, error: [errorText(result), ...reasons].join(" ") });
  };

  const openDraft = async (generatedContentDraftId) => {
    detailSeqRef.current += 1;
    const seq = detailSeqRef.current;
    setDetail({ status: "loading", draft: null, error: "" });
    const result = await getJson(clientInternalDraftPath(organizationId, engagementId, generatedContentDraftId));
    if (detailSeqRef.current !== seq) return;
    const draft = result.statusCode === 200 && result.body?.ok ? projectClientInternalDraft(result.body.data) : null;
    setDetail(draft ? { status: "success", draft, error: "" } : { status: "error", draft: null, error: errorText(result) });
  };

  useEffect(() => {
    if (!organizationId || !engagementId) return undefined;
    const key = `${organizationId}:${engagementId}:${refreshToken}`;
    keyRef.current = key;
    setList((current) => ({ ...current, status: "loading" }));
    getJson(clientInternalDraftsPath(organizationId, engagementId)).then((result) => {
      if (keyRef.current !== key) return;
      const projected = result.statusCode === 200 && result.body?.ok ? projectClientInternalDraftList(result.body.data) : null;
      setList(projected ? { status: "success", items: projected.items, error: "" } : { status: "error", items: [], error: errorText(result) });
    });
    return () => { keyRef.current = ""; };
  }, [organizationId, engagementId, refreshToken, listRefresh]);

  useEffect(() => {
    setDetail({ status: "idle", draft: null, error: "" });
    setReport({ status: "idle", draftId: "", markdown: "", error: "" });
    setApproval({ status: "idle", draftId: "", confirmed: false, error: "" });
    setReleaseDecision({ status: "idle", draftId: "", confirmed: false, error: "" });
  }, [organizationId, engagementId]);

  useEffect(() => {
    if (focusDraftId && focusDraftId !== focusedRef.current && list.status === "success"
      && list.items.some((item) => item.generatedContentDraftId === focusDraftId)) {
      focusedRef.current = focusDraftId;
      openDraft(focusDraftId);
    }
    // openDraft is recreated each render; the focus id and list are the triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDraftId, list.status, list.items]);

  if (!engagementId) return <div className="text-muted small">Select a Project to see its internal drafts.</div>;
  const claimById = new Map((Array.isArray(claims) ? claims : []).map((claim) => [claim.claimId, claim]));
  const draft = detail.draft;

  return (
    <div data-client-internal-draft-list="">
      {list.status === "loading" ? <div className="text-muted small">Loading internal drafts...</div> : null}
      {list.status === "error" ? <div className="alert alert-warning py-2 small">Internal drafts could not be loaded. {list.error}</div> : null}
      {list.status === "success" && list.items.length === 0 ? <div className="text-muted small">No internal drafts for this Project yet.</div> : null}
      {list.status === "success" && list.items.length > 0 ? (
        <ul className="list-group mb-2">
          {list.items.map((item) => (
            <li key={item.generatedContentDraftId} className="list-group-item small d-flex flex-wrap align-items-center gap-2"
              data-client-internal-draft={item.generatedContentDraftId}>
              <span className="fw-semibold">{DRAFT_LABELS[item.contentType]}</span>
              <span className="badge text-bg-light" data-client-internal-draft-review-state={item.reviewState}>
                {INTERNAL_DRAFT_REVIEW_STATE_LABELS[item.reviewState]}
              </span>
              <span className="text-muted">{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ""} · {item.blockCount} block(s)</span>
              <button type="button" className="btn btn-sm btn-outline-primary ms-auto" onClick={() => openDraft(item.generatedContentDraftId)}>
                Read draft
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {detail.status === "loading" ? <div className="text-muted small">Loading draft...</div> : null}
      {detail.status === "error" ? <div className="alert alert-warning py-2 small">This draft could not be read. {detail.error}</div> : null}
      {draft ? (
        <div className="border rounded p-2" data-client-internal-draft-detail={draft.generatedContentDraftId}>
          <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
            <span className="fw-semibold">{DRAFT_LABELS[draft.contentType]}</span>
            <span className="badge text-bg-warning" data-client-internal-draft-detail-review-state={draft.reviewState}>
              {internalDraftFactualReviewHeading(draft.reviewState, draft.factualReview)}
            </span>
          </div>
          {draft.release ? (
            <div className="small mb-2" data-client-internal-draft-release-state={draft.release.state}>
              <span className="badge text-bg-light me-2">{INTERNAL_DRAFT_RELEASE_STATE_LABELS[draft.release.state]}</span>
              {draft.organizationRelease.releasedBy ? (
                <span className="badge text-bg-light me-2" data-client-internal-draft-released-by={draft.organizationRelease.releasedBy}>
                  {INTERNAL_DRAFT_RELEASED_BY_LABELS[draft.organizationRelease.releasedBy]}
                </span>
              ) : null}
              {INTERNAL_DRAFT_RELEASE_STATE_MESSAGES[draft.release.state]}
              {canReadReleasedReports && draft.release.state === "released_for_internal_use" ? (
                <div className="d-flex flex-wrap gap-2 mt-1">
                  <button type="button" className="btn btn-sm btn-primary" data-client-open-released-report={draft.release.releasedReportId}
                    disabled={report.status === "loading"}
                    onClick={() => openReleasedReport(draft.generatedContentDraftId, draft.release.releasedReportId)}>
                    {report.status === "loading" ? "Opening..." : "Open released report"}
                  </button>
                  <a className="btn btn-sm btn-outline-primary" data-client-download-released-report={draft.release.releasedReportId}
                    href={clientReleasedReportMarkdownPath(organizationId, engagementId, draft.release.releasedReportId)} download="kai-released-report.md">
                    Download Markdown
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}
          {report.draftId === draft.generatedContentDraftId && report.status === "error" ? (
            <div className="alert alert-warning py-2 small" data-client-released-report-error="">The released report could not be opened. {report.error}</div>
          ) : null}
          {report.draftId === draft.generatedContentDraftId && report.status === "success" ? (
            <pre className="small border rounded p-2 mb-2" style={{ whiteSpace: "pre-wrap" }} data-client-released-report-markdown="">{report.markdown}</pre>
          ) : null}
          <FactualReview draft={draft} approval={approval} setApproval={setApproval}
            canReview={canReviewFactualContent} onApprove={() => approveFactualContent(draft.generatedContentDraftId)} />
          <OrganizationRelease draft={draft} decision={releaseDecision} setDecision={setReleaseDecision}
            canRelease={canReleaseReports} onRelease={() => releaseReport(draft.generatedContentDraftId)} />
          <ul className="small mb-2" data-client-internal-draft-limitations="">
            {draft.limitations.map((code) => <li key={code}>{INTERNAL_DRAFT_LIMITATION_MESSAGES[code]}</li>)}
          </ul>
          {draft.blocks.map((block) => (
            <div key={block.ordinal} className="mb-2" data-client-internal-draft-block={block.ordinal}>
              <p className="mb-1" style={{ whiteSpace: "pre-wrap" }}>{block.text}</p>
              <div className="small text-muted">
                Cites:
                <ul className="mb-0">
                  {block.supportingClaimIds.map((claimId) => {
                    const claim = claimById.get(claimId);
                    return (
                      <li key={claimId} data-client-internal-draft-citation={claimId}>
                        {claim ? (claim.claimStatement || claim.evidenceStatement || "Claim") : "A claim of this organization"}
                        {claim ? ` (claim review: ${claim.claimReviewStatus || "unknown"})` : ""}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FactualReview({ draft, approval, setApproval, canReview, onApprove }) {
  const view = draft.factualReview;
  const mine = approval.draftId === draft.generatedContentDraftId;
  const held = view.getKinderReviewReasons.length > 0;
  const blocked = view.blockedReasons.length > 0;
  const nextActions = internalDraftFactualReviewNextActions(view.blockedReasons);
  return (
    <div className="small mb-2" data-client-internal-draft-factual-review="">
      {mine && approval.status === "success" ? (
        <div className="alert alert-success py-1 mb-1" data-client-factual-review-recorded="">
          Your factual approval is recorded. Nothing has been released yet.
        </div>
      ) : null}
      {mine && approval.status === "error" ? (
        <div className="alert alert-warning py-1 mb-1" data-client-factual-review-error="">The approval was not recorded. {approval.error}</div>
      ) : null}
      {held ? (
        <div data-client-factual-review-get-kinder-required="">
          Get Kinder reviews this draft:
          <ul className="mb-1">
            {view.getKinderReviewReasons.map((code) => <li key={code}>{INTERNAL_DRAFT_FACTUAL_REVIEW_REASON_MESSAGES[code]}</li>)}
          </ul>
        </div>
      ) : null}
      {blocked ? (
        <div data-client-factual-review-blocked="">
          This draft cannot be approved now:
          <ul className="mb-1">
            {view.blockedReasons.map((code) => <li key={code}>{INTERNAL_DRAFT_FACTUAL_REVIEW_REASON_MESSAGES[code]}</li>)}
          </ul>
          {nextActions.map((message) => <p key={message} className="mb-1" data-client-factual-review-next-action="">{message}</p>)}
        </div>
      ) : null}
      {canReview && view.actorMayApprove ? (
        <div className="border rounded p-2" data-client-factual-review-action="">
          <div className="mb-1">
            Read the draft text below, each cited claim and its review status, and the limitations. Approve only if every statement
            is supported by the cited claims and states their limitations. Approval records your factual review; it does not release the report.
            If something is wrong, do not approve it: generate a corrected draft from the claims instead.
          </div>
          <label className="form-check mb-1">
            <input type="checkbox" className="form-check-input" data-client-factual-review-confirm=""
              checked={mine && approval.confirmed}
              onChange={(event) => setApproval({ status: "idle", draftId: draft.generatedContentDraftId, confirmed: event.target.checked, error: "" })} />
            <span className="form-check-label">I have read the text, the cited claims and the limitations, and the facts are supported.</span>
          </label>
          <button type="button" className="btn btn-sm btn-primary" data-client-factual-review-approve=""
            disabled={!(mine && approval.confirmed) || approval.status === "saving"} onClick={onApprove}>
            {mine && approval.status === "saving" ? "Recording..." : "Approve factual content"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function OrganizationRelease({ draft, decision, setDecision, canRelease, onRelease }) {
  const view = draft.organizationRelease;
  const mine = decision.draftId === draft.generatedContentDraftId;
  const reviewed = draft.reviewState === "reviewed_by_get_kinder" || draft.reviewState === "reviewed_by_your_organization";
  const unreleased = draft.release?.state === "awaiting_get_kinder_release" || draft.release?.state === "awaiting_organization_release";
  const held = reviewed && unreleased && view.getKinderReleaseReasons.length > 0;
  const blocked = reviewed && unreleased && view.blockedReasons.length > 0;
  return (
    <div className="small mb-2" data-client-internal-draft-release-decision="">
      {mine && decision.status === "success" ? (
        <div className="alert alert-success py-1 mb-1" data-client-internal-release-recorded="">
          Your release decision is recorded. The report is released for your organization's internal use only.
        </div>
      ) : null}
      {mine && decision.status === "error" ? (
        <div className="alert alert-warning py-1 mb-1" data-client-internal-release-error="">The report was not released. {decision.error}</div>
      ) : null}
      {held ? (
        <div data-client-internal-release-get-kinder-required="">
          Get Kinder releases this report:
          <ul className="mb-1">
            {view.getKinderReleaseReasons.map((code) => <li key={code}>{INTERNAL_DRAFT_RELEASE_REASON_MESSAGES[code]}</li>)}
          </ul>
        </div>
      ) : null}
      {blocked ? (
        <div data-client-internal-release-blocked="">
          This report cannot be released now:
          <ul className="mb-1">
            {view.blockedReasons.map((code) => <li key={code}>{INTERNAL_DRAFT_RELEASE_REASON_MESSAGES[code]}</li>)}
          </ul>
        </div>
      ) : null}
      {canRelease && view.actorMayRelease ? (
        <div className="border rounded p-2" data-client-internal-release-action="">
          <div className="mb-1">
            Releasing makes this reviewed draft your organization's internal report, recorded under your name, with every limitation
            listed below carried into it. It is for internal use only: it is not approved for funders or the public. Release only if
            the limitations are the ones the report must state.
          </div>
          <label className="form-check mb-1">
            <input type="checkbox" className="form-check-input" data-client-internal-release-confirm=""
              checked={mine && decision.confirmed}
              onChange={(event) => setDecision({ status: "idle", draftId: draft.generatedContentDraftId, confirmed: event.target.checked, error: "" })} />
            <span className="form-check-label">I have read the limitations, and I decide to release this report for internal use.</span>
          </label>
          <button type="button" className="btn btn-sm btn-primary" data-client-internal-release-submit=""
            disabled={!(mine && decision.confirmed) || decision.status === "saving"} onClick={onRelease}>
            {mine && decision.status === "saving" ? "Releasing..." : "Release internal report"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
