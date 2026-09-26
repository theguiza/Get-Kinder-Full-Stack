import React, { useEffect, useState } from "react";

import KaiWebIntake from "../KaiWebIntake.jsx";
import ImpactLibraryKai from "../ImpactLibraryKai.jsx";
import ClientFunderRequirements from "./ClientFunderRequirements.jsx";
import ClientGeneratedDrafts from "./ClientGeneratedDrafts.jsx";
import { CLIENT_FOLLOWUP_REVIEW_HREF } from "../impactEvidenceLibraryLogic.js";

const CLIENT_KNOWLEDGE_STUDIO_TABS = Object.freeze([
  ["files", "Files"],
  ["evidence", "Evidence"],
  ["gaps", "Gaps"],
  ["funderRequirements", "Funder Requirements"],
  ["generatedDrafts", "Generated Drafts"],
  ["reviews", "Reviews"],
]);

function dimensionLabel(dimensionKey) {
  return String(dimensionKey || "").replace(/_/g, " ");
}

/**
 * Client Knowledge Studio, mounted by ImpactLibraryApp instead of the GK
 * ImpactEvidenceLibrary cockpit whenever the organization access
 * capabilities read does not report internalKnowledgeWorkspace. The GK
 * cockpit reads the claim-library, evidence-library, review-queue, sources,
 * requirements, generated-draft, grant-response and board-reporting
 * surfaces, all GK-internal, so none of those reads is ever issued here.
 *
 * Requests made here:
 * - KaiWebIntake's intake reads (read_intake, admitted for every client
 *   role) and, only when intakeContribution is true, its batch/upload
 *   writes;
 * - ImpactLibraryKai's message POST (engagement context policy);
 * - ClientFunderRequirements' client-safe funder-requirements read for the
 *   selected project (Funder Requirements tab only);
 * - ClientGeneratedDrafts' client-safe generated-draft, draft-detail, and
 *   Grant Response Packet / Board Reporting preview reads (Generated Drafts
 *   tab only);
 * - nothing else: reviewed Impact Facts arrive as the `facts` prop, fetched
 *   once per organization by ImpactLibraryApp from the client-safe
 *   impact-facts read.
 *
 * Gaps and Reviews are GK review workflow. A client reviewer is linked to
 * the existing client follow-up page (clientFollowupReview capability);
 * everyone else sees an honest explanation, never a GK queue.
 */
export default function ClientKnowledgeStudio({
  organizationId,
  engagementId,
  onEngagementIdChange,
  capabilities,
  facts,
  onViewImpactLibrary,
}) {
  const [tab, setTab] = useState("files");
  // Files persistence/rehydration: the Files tab's selected intake batch is
  // retained outside the tab-gated KaiWebIntake mount (re-validated by
  // KaiWebIntake against a fresh server read) and cleared whenever the
  // organization or Project changes.
  const [filesIntakeBatchId, setFilesIntakeBatchId] = useState("");
  useEffect(() => {
    setFilesIntakeBatchId("");
  }, [organizationId, engagementId]);
  const canContribute = capabilities?.intakeContribution === true;
  const canReviewFollowups = capabilities?.clientFollowupReview === true;
  const factsStatus = facts?.status || "loading";
  const factItems = Array.isArray(facts?.items) ? facts.items : [];

  return (
    <section>
      <h1 className="admin-title mb-3">Knowledge Studio</h1>

      <ul className="nav nav-tabs mb-3">
        {CLIENT_KNOWLEDGE_STUDIO_TABS.map(([key, label]) => (
          <li className="nav-item" key={key}>
            <button
              type="button"
              className={`nav-link${tab === key ? " active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          </li>
        ))}
      </ul>

      <ImpactLibraryKai organizationId={organizationId} engagementId={engagementId} />

      {tab === "files" && organizationId ? (
        <KaiWebIntake
          organizationId={organizationId}
          engagementId={engagementId}
          onEngagementIdChange={onEngagementIdChange}
          intakeBatchId={filesIntakeBatchId}
          onIntakeBatchIdChange={setFilesIntakeBatchId}
          embedded
          canContribute={canContribute}
        />
      ) : null}

      {tab === "evidence" ? (
        <div className="admin-card">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h5 className="mb-0">Reviewed evidence</h5>
            {factsStatus === "success" ? <span className="text-muted small">{factItems.length} shown</span> : null}
          </div>
          <div className="small text-muted mb-2">
            Evidence appears here once it has been reviewed and supports an Impact Fact your organization can use
            internally. Information that is still being processed or reviewed is not shown.
          </div>
          {factsStatus === "loading" ? <div className="text-muted small">Loading reviewed evidence...</div> : null}
          {factsStatus === "error" ? <div className="alert alert-warning py-2 small">Reviewed evidence could not be loaded.</div> : null}
          {factsStatus === "success" && factItems.length === 0 ? (
            <div className="text-muted small">No reviewed evidence yet for this organization.</div>
          ) : null}
          {factsStatus === "success" && factItems.length > 0 ? (
            <ul className="list-group">
              {factItems.map((fact) => (
                <li key={fact.claimId} className="list-group-item">
                  <div className="fw-semibold small">{fact.statement || "Statement not yet available"}</div>
                  <div className="d-flex flex-wrap gap-2 mt-1">
                    {fact.claimType ? <span className="badge text-bg-light border">{fact.claimType}</span> : null}
                    <span className="badge text-bg-success">Reviewed for internal use</span>
                    {fact.limitationDimensionKeys.map((key) => (
                      <span key={key} className="badge text-bg-light border">Known limitation: {dimensionLabel(key)}</span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          {typeof onViewImpactLibrary === "function" && factsStatus === "success" && factItems.length > 0 ? (
            <button type="button" className="btn btn-sm btn-outline-primary mt-2" onClick={onViewImpactLibrary}>
              Open the Impact Library
            </button>
          ) : null}
        </div>
      ) : null}

      {tab === "gaps" ? (
        <div className="admin-card">
          <h5 className="mb-2">Gaps and Risks</h5>
          <div className="small text-muted">
            Get Kinder reviewers identify evidence gaps and risks while reviewing your organization&rsquo;s information.
            Questions that need an answer from your organization are sent to your client reviewers.
          </div>
          {canReviewFollowups ? (
            <a className="btn btn-sm btn-outline-primary mt-2" href={CLIENT_FOLLOWUP_REVIEW_HREF}>
              Answer follow-up questions
            </a>
          ) : null}
        </div>
      ) : null}

      {tab === "funderRequirements" ? (
        <ClientFunderRequirements
          organizationId={organizationId}
          engagementId={engagementId}
          canReviewFollowups={canReviewFollowups}
        />
      ) : null}

      {tab === "generatedDrafts" ? (
        <ClientGeneratedDrafts
          organizationId={organizationId}
          engagementId={engagementId}
          facts={facts}
          canReviewFollowups={canReviewFollowups}
        />
      ) : null}

      {tab === "reviews" ? (
        <div className="admin-card">
          <h5 className="mb-2">Reviews</h5>
          <div className="small text-muted">
            Evidence and Impact Fact reviews are completed by Get Kinder reviewers. Reviewed results appear in the
            Impact Library and under Evidence.
          </div>
        </div>
      ) : null}
    </section>
  );
}
