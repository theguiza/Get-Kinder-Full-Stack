import React, { useEffect, useState } from "react";

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

/**
 * Client Generated Drafts, a Knowledge Studio tab. Requests only the
 * client-safe reads: the organization's reviewed drafts, one draft's detail,
 * and, for the selected project, the Grant Response Packet and Board
 * Reporting previews. It never requests a GK generated-content, review,
 * export, or final-release route, and offers no generation, review, export,
 * or release control. "What supports this" resolves cited claim ids against
 * the client-safe Impact Facts the page already loaded. The follow-up link
 * appears only with the server's clientFollowupReview capability and when a
 * reviewed draft is waiting on a client answer.
 */
export default function ClientGeneratedDrafts({ organizationId, engagementId, facts, canReviewFollowups = false }) {
  const [selectedDraftId, setSelectedDraftId] = useState(null);
  useEffect(() => {
    setSelectedDraftId(null);
  }, [organizationId]);

  const list = useClientRead(
    organizationId || "",
    organizationId ? clientGeneratedDraftsPath(organizationId) : "",
    projectClientGeneratedDraftList,
  );
  const detail = useClientRead(
    organizationId && selectedDraftId ? `${organizationId}:${selectedDraftId}` : "",
    organizationId && selectedDraftId ? clientGeneratedDraftPath(organizationId, selectedDraftId) : "",
    projectClientGeneratedDraft,
  );
  const projectKey = organizationId && engagementId ? `${organizationId}:${engagementId}` : "";
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

  if (selectedDraftId) {
    return (
      <div className="admin-card">
        <button type="button" className="btn btn-sm btn-link px-0 mb-2" onClick={() => setSelectedDraftId(null)}>
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
          Drafts KAI wrote from your organization&rsquo;s reviewed information. Only drafts Get Kinder has reviewed,
          and whose supporting facts are still current, are shown.
        </div>
        {list.status === "loading" ? <div className="text-muted small">Loading drafts...</div> : null}
        {list.status === "error" ? <div className="alert alert-warning py-2 small">Generated drafts could not be loaded.</div> : null}
        {list.data && list.data.items.length === 0 ? (
          <div className="text-muted small">No reviewed drafts yet for this organization.</div>
        ) : null}
        {list.data && list.data.items.length > 0 ? (
          <ul className="list-group">
            {list.data.items.map((item) => (
              <li key={item.generatedContentDraftId} className="list-group-item d-flex justify-content-between align-items-center gap-2">
                <div>
                  <div className="small fw-semibold">{CONTENT_TYPE_LABELS[item.contentType]}</div>
                  <div className="small text-muted">
                    {AUDIENCE_LABELS[item.audience]}
                    {item.createdAt ? ` · ${item.createdAt.slice(0, 10)}` : ""}
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setSelectedDraftId(item.generatedContentDraftId)}>
                  View
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {list.data?.truncated ? <div className="small text-muted mt-2">Showing the most recent reviewed drafts KAI checked.</div> : null}
        {list.data && list.data.awaitingClientInputCount > 0 && canReviewFollowups ? (
          <div className="mt-2">
            <div className="small">
              {list.data.awaitingClientInputCount} reviewed draft(s) are waiting on answers from your organization.
            </div>
            <a className="btn btn-sm btn-outline-primary mt-1" href={CLIENT_FOLLOWUP_REVIEW_HREF}>
              Answer follow-up questions
            </a>
          </div>
        ) : null}
      </div>

      {!projectKey ? (
        <div className="text-muted small">Select a project to preview its Grant Response Packet and Board Reporting.</div>
      ) : (
        <>
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
        </>
      )}
    </section>
  );
}
