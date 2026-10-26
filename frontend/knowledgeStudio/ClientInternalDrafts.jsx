import React, { useEffect, useRef, useState } from "react";

import {
  clientInternalDraftPath,
  clientInternalDraftsPath,
  clientInternalReportMarkdownPath,
  clientReleasedReportMarkdownPath,
  errorText,
  getJson,
  projectClientInternalDraft,
  projectClientInternalDraftList,
} from "../impactEvidenceLibraryLogic.js";
import {
  INTERNAL_DRAFT_LIMITATION_MESSAGES,
  INTERNAL_DRAFT_RELEASED_BY_LABELS,
  INTERNAL_DRAFT_RELEASE_STATE_LABELS,
  INTERNAL_DRAFT_RELEASE_STATE_MESSAGES,
  INTERNAL_DRAFT_REVIEW_STATE_LABELS,
  INTERNAL_REPORT_REASON_MESSAGES,
  STRUCTURAL_ONLY_DRAFT_MESSAGE,
  internalDraftFactualReviewNextActions,
  isStructuralOnlyDraft,
} from "./clientEvidenceWorkflowLogic.js";

const READY_FOR_INTERNAL_USE = "Ready for internal use";
// Release states that named the organization's own factual review or release
// decision as the next step; neither is required for internal use any more
// (owner decision 2026-10-25), so they are not shown.
const ORGANIZATION_RELEASE_STEPS = new Set(["awaiting_organization_review", "awaiting_organization_release"]);

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
 * `focusDraftId` opens that draft once it is listed (after generation). The
 * newest draft is listed first. A draft citing only structural facts (which
 * columns a source has) is shown as such: it is kept as generated, and the
 * next step is a new draft from a measured finding, not a review request.
 *
 * Internal report (owner decision 2026-10-25): when the server reports
 * internalReport.available - every cited claim usable for internal use, every
 * cited source cleared for internal use, every automated check passed - the
 * draft is the organization's internal report. It is opened or downloaded
 * as Markdown through the client-internal-drafts .../markdown route, which
 * re-checks all of it on every request. No factual approval, limitation
 * confirmation or release decision is asked for. Otherwise the server's
 * reasons say why Get Kinder reviews it or why it is not usable now.
 *
 * Release (Plan A Prompt 8): a report Get Kinder released (for a draft that
 * is not available as an internal report, for example from a high-risk
 * source) can still be opened through the client-released-reports route
 * while that release is valid.
 */
export default function ClientInternalDrafts({
  organizationId, engagementId, claims, refreshToken, focusDraftId, canReadReleasedReports = false, canReadInternalReports = false,
}) {
  const [list, setList] = useState({ status: "idle", items: [], error: "" });
  const [detail, setDetail] = useState({ status: "idle", draft: null, error: "" });
  const [report, setReport] = useState({ status: "idle", draftId: "", markdown: "", error: "" });
  const keyRef = useRef("");
  const detailSeqRef = useRef(0);
  // The generated draft opened once after generation; a later list reload
  // (for example after an approval) must not switch the open draft back.
  const focusedRef = useRef("");

  const openMarkdown = async (draftId, path) => {
    setReport({ status: "loading", draftId, markdown: "", error: "" });
    const response = await fetch(path, {
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
    const reasons = Array.isArray(body?.blockers)
      ? body.blockers.map((blocker) => INTERNAL_REPORT_REASON_MESSAGES[blocker?.blocking_reason]).filter(Boolean)
      : [];
    setReport({ status: "error", draftId, markdown: "", error: [errorText({ statusCode: response.status, body }), ...reasons].join(" ") });
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
      // Newest first (the server lists in id order).
      const items = projected ? [...projected.items].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))) : [];
      setList(projected ? { status: "success", items, error: "" } : { status: "error", items: [], error: errorText(result) });
    });
    return () => { keyRef.current = ""; };
  }, [organizationId, engagementId, refreshToken]);

  useEffect(() => {
    setDetail({ status: "idle", draft: null, error: "" });
    setReport({ status: "idle", draftId: "", markdown: "", error: "" });
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
  const structuralOnly = Boolean(draft) && !draft.internalReport.available && isStructuralOnlyDraft(draft, claimById);

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
              <span className="badge text-bg-light" data-client-internal-draft-review-state={item.reviewState}
                data-client-internal-draft-report-available={item.internalReportAvailable ? "true" : "false"}>
                {item.internalReportAvailable ? READY_FOR_INTERNAL_USE : INTERNAL_DRAFT_REVIEW_STATE_LABELS[item.reviewState]}
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
            <span className={`badge ${draft.internalReport.available ? "text-bg-success" : "text-bg-warning"}`}
              data-client-internal-draft-detail-review-state={draft.reviewState}>
              {draft.internalReport.available ? READY_FOR_INTERNAL_USE : INTERNAL_DRAFT_REVIEW_STATE_LABELS[draft.reviewState] || "Review state unavailable"}
            </span>
          </div>
          {structuralOnly ? (
            <div className="alert alert-secondary py-2 small mb-2" data-client-internal-draft-metadata-only="">{STRUCTURAL_ONLY_DRAFT_MESSAGE}</div>
          ) : null}
          <InternalReport draft={draft} canRead={canReadInternalReports} report={report} structuralOnly={structuralOnly}
            onOpen={() => openMarkdown(draft.generatedContentDraftId, clientInternalReportMarkdownPath(organizationId, engagementId, draft.generatedContentDraftId))}
            downloadPath={clientInternalReportMarkdownPath(organizationId, engagementId, draft.generatedContentDraftId)} />
          {!draft.internalReport.available && draft.release && !ORGANIZATION_RELEASE_STEPS.has(draft.release.state) ? (
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
                    onClick={() => openMarkdown(draft.generatedContentDraftId,
                      clientReleasedReportMarkdownPath(organizationId, engagementId, draft.release.releasedReportId))}>
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
            <div className="alert alert-warning py-2 small" data-client-released-report-error="">The report could not be opened. {report.error}</div>
          ) : null}
          {report.draftId === draft.generatedContentDraftId && report.status === "success" ? (
            <pre className="small border rounded p-2 mb-2" style={{ whiteSpace: "pre-wrap" }} data-client-released-report-markdown=""
              data-client-internal-report-markdown="">{report.markdown}</pre>
          ) : null}
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

// The organization's internal report: open or download it when the server
// reports it available; otherwise the server's reasons and next steps.
function InternalReport({ draft, canRead, report, onOpen, downloadPath, structuralOnly = false }) {
  const view = draft.internalReport;
  if (view.available) {
    return (
      <div className="small mb-2" data-client-internal-report="available">
        <div className="mb-1">
          This is your organization&apos;s internal report. Every cited claim is usable for internal use and every automated check
          passed, so no further review or release step is needed. Internal use only: it is not approved for funders or the public.
        </div>
        {canRead ? (
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-primary" data-client-open-internal-report={draft.generatedContentDraftId}
              disabled={report.status === "loading"} onClick={onOpen}>
              {report.status === "loading" ? "Opening..." : "Open report"}
            </button>
            <a className="btn btn-sm btn-outline-primary" data-client-download-internal-report={draft.generatedContentDraftId}
              href={downloadPath} download={draft.contentType === "impact_narrative" ? "kai-internal-impact-narrative.md" : "kai-internal-evidence-summary.md"}>
              Download Markdown
            </a>
          </div>
        ) : null}
      </div>
    );
  }
  // A structural-only draft's next step is a new draft from a measured finding
  // (shown above), not a review of the structural claims it cites.
  const nextActions = structuralOnly ? [] : internalDraftFactualReviewNextActions(view.blockedReasons);
  return (
    <div className="small mb-2" data-client-internal-report="unavailable">
      {view.getKinderReviewReasons.length > 0 ? (
        <div data-client-internal-report-get-kinder-required="">
          Get Kinder reviews this draft:
          <ul className="mb-1">
            {view.getKinderReviewReasons.map((code) => <li key={code}>{INTERNAL_REPORT_REASON_MESSAGES[code]}</li>)}
          </ul>
        </div>
      ) : null}
      {view.blockedReasons.length > 0 ? (
        <div data-client-internal-report-blocked="">
          This draft is not usable as an internal report now:
          <ul className="mb-1">
            {view.blockedReasons.map((code) => <li key={code}>{INTERNAL_REPORT_REASON_MESSAGES[code]}</li>)}
          </ul>
          {nextActions.map((message) => <p key={message} className="mb-1" data-client-internal-report-next-action="">{message}</p>)}
        </div>
      ) : null}
    </div>
  );
}
