import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  CLIENT_FOLLOWUP_REVIEW_HREF,
  clientBoardReportingPreviewPath,
  clientGeneratedDraftPath,
  clientGeneratedDraftsPath,
  clientGrantResponsePacketPath,
  getJson,
  projectClientGeneratedDraft,
  projectClientGeneratedDraftList,
  projectClientPacketPreview,
} from "../impactEvidenceLibraryLogic.js";

const CONTENT_TYPE_LABELS = Object.freeze({
  evidence_summary: "Evidence summary",
  impact_narrative: "Impact narrative",
  readiness_assessment: "Readiness assessment",
  data_gap_memo: "Data gap memo",
  case_for_support: "Case for support",
  board_update: "Board update",
  annual_report_section: "Annual report section",
  funder_outcome_table: "Funder outcome table",
  grant_response_paragraph: "Grant response paragraph",
});

const AUDIENCE_LABELS = Object.freeze({
  internal: "For your organization's internal use",
  funder: "Written for funders",
  public: "Written for the public",
});

function dimensionLabel(dimensionKey) {
  return String(dimensionKey || "").replace(/_/g, " ");
}

// Loads one client-safe read and projects it; stale responses for a
// previous key never replace the current one.
function useClientRead(key, path, project) {
  const [state, setState] = useState({ key: "", status: "idle", data: null });
  useEffect(() => {
    if (!key) {
      setState({ key: "", status: "idle", data: null });
      return undefined;
    }
    let cancelled = false;
    setState({ key, status: "loading", data: null });
    (async () => {
      const result = await getJson(path);
      if (cancelled) return;
      const data = result.statusCode === 200 && result.body?.ok ? project(result.body.data) : null;
      setState({ key, status: data ? "success" : "error", data });
    })();
    return () => {
      cancelled = true;
    };
    // path and project are derived from key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { status: key ? "loading" : "idle", data: null };
}

function DraftBody({ draft, factsById }) {
  return (
    <div>
      {draft.blocks.map((block) => (
        <div key={block.ordinal} className="mb-3">
          <p className="small mb-1" style={{ whiteSpace: "pre-wrap" }}>{block.text}</p>
          <div className="small text-muted">What supports this:</div>
          <ul className="small mb-0">
            {block.supportingClaimIds.map((claimId) => {
              const fact = factsById.get(claimId);
              return (
                <li key={claimId}>
                  {fact ? (
                    <>
                      {fact.statement || "Reviewed Impact Fact"}
                      {fact.limitationDimensionKeys.map((key) => (
                        <span key={key} className="badge text-bg-light border ms-1">Known limitation: {dimensionLabel(key)}</span>
                      ))}
                    </>
                  ) : (
                    "A reviewed Impact Fact approved for this audience"
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PacketPreview({ title, description, preview, factsById }) {
  return (
    <div className="admin-card mb-3">
      <h5 className="mb-1">{title}</h5>
      <div className="small text-muted mb-2">{description}</div>
      {preview.status === "loading" ? <div className="text-muted small">Loading...</div> : null}
      {preview.status === "error" ? <div className="alert alert-warning py-2 small">This preview could not be loaded.</div> : null}
      {preview.data?.status === "no_reviewed_drafts" ? (
        <div className="text-muted small">No reviewed drafts are ready for this project yet.</div>
      ) : null}
      {preview.data?.status === "available"
        ? preview.data.drafts.map((draft) => (
            <div key={draft.generatedContentDraftId} className="border-top pt-2 mt-2">
              <div className="small fw-semibold mb-1">{CONTENT_TYPE_LABELS[draft.contentType]}</div>
              <DraftBody draft={draft} factsById={factsById} />
            </div>
          ))
        : null}
      <div className="small text-muted">Preview only. Release to a funder or board still requires Get Kinder&rsquo;s final review.</div>
    </div>
  );
}

// The selected project's draft list, one bounded page at a time. Pages
// append (never duplicating a draft); a new organization/project key resets
// everything, and a late response for a previous key is ignored.
function useClientDraftPages(organizationId, engagementId) {
  const key = organizationId && engagementId ? `${organizationId}:${engagementId}` : "";
  const [state, setState] = useState({ key: "", status: "idle", items: [], awaitingClientInputCount: 0, nextCursor: null, loadingMore: false, moreError: false });
  const keyRef = useRef("");

  const loadPage = useCallback(async (requestKey, cursor) => {
    const result = await getJson(clientGeneratedDraftsPath(organizationId, engagementId, cursor));
    if (keyRef.current !== requestKey) return;
    const page = result.statusCode === 200 && result.body?.ok ? projectClientGeneratedDraftList(result.body.data) : null;
    setState((current) => {
      if (current.key !== requestKey) return current;
      if (!page) {
        return cursor ? { ...current, loadingMore: false, moreError: true } : { ...current, status: "error", loadingMore: false };
      }
      const seen = new Set(current.items.map((item) => item.generatedContentDraftId));
      return {
        ...current,
        status: "success",
        items: [...current.items, ...page.items.filter((item) => !seen.has(item.generatedContentDraftId))],
        awaitingClientInputCount: current.awaitingClientInputCount + page.awaitingClientInputCount,
        nextCursor: page.nextCursor,
        loadingMore: false,
        moreError: false,
      };
    });
  }, [organizationId, engagementId]);

  useEffect(() => {
    keyRef.current = key;
    setState({ key, status: key ? "loading" : "idle", items: [], awaitingClientInputCount: 0, nextCursor: null, loadingMore: false, moreError: false });
    if (key) loadPage(key, null);
  }, [key, loadPage]);

  const loadMore = useCallback(() => {
    if (state.key !== key || !state.nextCursor || state.loadingMore) return;
    setState((current) => ({ ...current, loadingMore: true, moreError: false }));
    loadPage(key, state.nextCursor);
  }, [key, state.key, state.nextCursor, state.loadingMore, loadPage]);

  const current = state.key === key ? state : { status: key ? "loading" : "idle", items: [], awaitingClientInputCount: 0, nextCursor: null, loadingMore: false, moreError: false };
  return { ...current, loadMore };
}

/**
 * Client Generated Drafts, a Knowledge Studio tab for the selected
 * engagement/project. Requests only the client-safe reads: the project's
 * reviewed drafts (bounded pages, "Load more"), one draft's detail, and the
 * project's Grant Response Packet and Board Reporting previews. Everything
 * resets when the project changes. It never requests a GK generated-content,
 * review, export, or final-release route, and offers no generation, review,
 * export, or release control. "What supports this" resolves cited claim ids
 * against the client-safe Impact Facts the page already loaded. The
 * follow-up link appears only with the server's clientFollowupReview
 * capability and when a reviewed draft is waiting on a client answer.
 */
export default function ClientGeneratedDrafts({ organizationId, engagementId, facts, canReviewFollowups = false }) {
  const projectKey = organizationId && engagementId ? `${organizationId}:${engagementId}` : "";
  const [selected, setSelected] = useState({ projectKey: "", draftId: null });
  const selectedDraftId = selected.projectKey === projectKey ? selected.draftId : null;

  const list = useClientDraftPages(organizationId, engagementId);
  const detail = useClientRead(
    projectKey && selectedDraftId ? `${projectKey}:${selectedDraftId}` : "",
    projectKey && selectedDraftId ? clientGeneratedDraftPath(organizationId, engagementId, selectedDraftId) : "",
    projectClientGeneratedDraft,
  );
  const grantPacket = useClientRead(
    projectKey,
    projectKey ? clientGrantResponsePacketPath(organizationId, engagementId) : "",
    (dto) => projectClientPacketPreview(dto, "funder"),
  );
  const boardPreview = useClientRead(
    projectKey,
    projectKey ? clientBoardReportingPreviewPath(organizationId, engagementId) : "",
    (dto) => projectClientPacketPreview(dto, "internal"),
  );

  const factsById = new Map((Array.isArray(facts?.items) ? facts.items : []).map((fact) => [fact.claimId, fact]));

  if (!projectKey) {
    return (
      <div className="admin-card">
        <h5 className="mb-1">Generated Drafts</h5>
        <div className="text-muted small">Select a project to see its Generated Drafts, Grant Response Packet, and Board Reporting.</div>
      </div>
    );
  }

  if (selectedDraftId) {
    return (
      <div className="admin-card">
        <button type="button" className="btn btn-sm btn-link px-0 mb-2" onClick={() => setSelected({ projectKey, draftId: null })}>
          &larr; Back to Generated Drafts
        </button>
        {detail.status === "loading" ? <div className="text-muted small">Loading draft...</div> : null}
        {detail.status === "error" ? <div className="alert alert-warning py-2 small">This draft is not available.</div> : null}
        {detail.data ? (
          <>
            <h5 className="mb-1">{CONTENT_TYPE_LABELS[detail.data.contentType]}</h5>
            <div className="d-flex flex-wrap gap-2 mb-3">
              <span className="badge text-bg-light border">{AUDIENCE_LABELS[detail.data.audience]}</span>
              <span className="badge text-bg-success">Reviewed by Get Kinder</span>
            </div>
            <DraftBody draft={detail.data} factsById={factsById} />
            <div className="small text-muted">
              This is a reviewed draft, not a final document. Using it with a funder or the public still requires Get
              Kinder&rsquo;s final review.
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <section>
      <div className="admin-card mb-3">
        <h5 className="mb-1">Generated Drafts</h5>
        <div className="small text-muted mb-2">
          Drafts KAI wrote for this project from your organization&rsquo;s reviewed information. Only drafts Get Kinder
          has reviewed, and whose supporting facts are still current, are shown.
        </div>
        {list.status === "loading" ? <div className="text-muted small">Loading drafts...</div> : null}
        {list.status === "error" ? <div className="alert alert-warning py-2 small">Generated drafts could not be loaded.</div> : null}
        {list.status === "success" && list.items.length === 0 && !list.nextCursor ? (
          <div className="text-muted small">No reviewed drafts yet for this project.</div>
        ) : null}
        {list.status === "success" && list.items.length === 0 && list.nextCursor ? (
          <div className="text-muted small">No reviewed drafts found in the drafts checked so far.</div>
        ) : null}
        {list.items.length > 0 ? (
          <ul className="list-group">
            {list.items.map((item) => (
              <li key={item.generatedContentDraftId} className="list-group-item d-flex justify-content-between align-items-center gap-2">
                <div>
                  <div className="small fw-semibold">{CONTENT_TYPE_LABELS[item.contentType]}</div>
                  <div className="small text-muted">
                    {AUDIENCE_LABELS[item.audience]}
                    {item.createdAt ? ` · ${item.createdAt.slice(0, 10)}` : ""}
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setSelected({ projectKey, draftId: item.generatedContentDraftId })}>
                  View
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {list.status === "success" && list.nextCursor ? (
          <div className="mt-2">
            <div className="small text-muted">More drafts for this project have not been checked yet.</div>
            <button type="button" className="btn btn-sm btn-outline-secondary mt-1" onClick={list.loadMore} disabled={list.loadingMore}>
              {list.loadingMore ? "Loading..." : "Load more"}
            </button>
            {list.moreError ? <div className="alert alert-warning py-2 small mt-1">More drafts could not be loaded.</div> : null}
          </div>
        ) : null}
        {list.status === "success" && list.awaitingClientInputCount > 0 && canReviewFollowups ? (
          <div className="mt-2">
            <div className="small">
              {list.awaitingClientInputCount} reviewed draft(s) are waiting on answers from your organization.
            </div>
            <a className="btn btn-sm btn-outline-primary mt-1" href={CLIENT_FOLLOWUP_REVIEW_HREF}>
              Answer follow-up questions
            </a>
          </div>
        ) : null}
      </div>

      <PacketPreview
        title="Grant Response Packet"
        description="Reviewed funder-facing drafts for this project, in packet order."
        preview={grantPacket}
        factsById={factsById}
      />
      <PacketPreview
        title="Board Reporting"
        description="Reviewed internal drafts for this project's board reporting."
        preview={boardPreview}
        factsById={factsById}
      />
    </section>
  );
}
