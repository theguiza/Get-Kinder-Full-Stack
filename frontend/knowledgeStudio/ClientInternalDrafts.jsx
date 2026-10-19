import React, { useEffect, useRef, useState } from "react";

import {
  clientInternalDraftPath,
  clientInternalDraftsPath,
  errorText,
  getJson,
  projectClientInternalDraft,
  projectClientInternalDraftList,
} from "../impactEvidenceLibraryLogic.js";
import { INTERNAL_DRAFT_LIMITATION_MESSAGES, INTERNAL_DRAFT_REVIEW_STATE_LABELS } from "./clientEvidenceWorkflowLogic.js";

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
 */
export default function ClientInternalDrafts({ organizationId, engagementId, claims, refreshToken, focusDraftId }) {
  const [list, setList] = useState({ status: "idle", items: [], error: "" });
  const [detail, setDetail] = useState({ status: "idle", draft: null, error: "" });
  const keyRef = useRef("");
  const detailSeqRef = useRef(0);

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
  }, [organizationId, engagementId, refreshToken]);

  useEffect(() => {
    setDetail({ status: "idle", draft: null, error: "" });
  }, [organizationId, engagementId]);

  useEffect(() => {
    if (focusDraftId && list.status === "success" && list.items.some((item) => item.generatedContentDraftId === focusDraftId)) {
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
              {INTERNAL_DRAFT_REVIEW_STATE_LABELS[draft.reviewState]}
            </span>
          </div>
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
