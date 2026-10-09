import React, { useEffect, useState } from "react";

import KaiWebIntake from "../KaiWebIntake.jsx";
import ImpactLibraryKai from "../ImpactLibraryKai.jsx";
import ClientFunderRequirements from "./ClientFunderRequirements.jsx";
import ClientGeneratedDrafts from "./ClientGeneratedDrafts.jsx";
import ClientEvidencePipelineStatus from "./ClientEvidencePipelineStatus.jsx";
import useClientEvidencePipeline from "./useClientEvidencePipeline.js";
import {
  PIPELINE_STAGE_LABELS,
  evidenceTabView,
  pipelineReasonMessage,
  reviewsTabView,
  stageStatusLabel,
} from "./clientEvidencePipelineLogic.js";
import { CLIENT_FOLLOWUP_REVIEW_HREF } from "../impactEvidenceLibraryLogic.js";

const CLIENT_KNOWLEDGE_STUDIO_TABS = Object.freeze([
  ["files", "Files"],
  ["evidence", "Evidence"],
  ["gaps", "Gaps"],
  ["funderRequirements", "Funder Requirements"],
  ["generatedDrafts", "Generated Drafts"],
  ["reviews", "Reviews"],
]);

// Tabs that render the selected project's evidence pipeline; entering one
// re-reads it so a status never lags behind an upload or a review.
const PIPELINE_TABS = new Set(["files", "evidence", "reviews"]);

function dimensionLabel(dimensionKey) {
  return String(dimensionKey || "").replace(/_/g, " ");
}

function ReviewedFactList({ facts }) {
  return (
    <ul className="list-group">
      {facts.map((fact) => (
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
  );
}

function PipelineReasonList({ reasons }) {
  return (
    <ul className="small mb-0" data-evidence-pipeline-reasons="">
      {reasons.map((entry) => (
        <li key={entry.reason}>{pipelineReasonMessage(entry.reason, entry.fileCount)}</li>
      ))}
    </ul>
  );
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
 * - useClientEvidencePipeline's client-safe evidence-pipeline read for the
 *   selected project (Files, Evidence, and Reviews tabs): per uploaded file
 *   its governed stage, responsible party, and next permitted action, plus
 *   the governed reviewed Impact Facts descending from the project's files;
 * - nothing else: organization-wide reviewed Impact Facts arrive as the
 *   `facts` prop, fetched once per organization by ImpactLibraryApp from the
 *   client-safe impact-facts read, and are shown only when no project is
 *   selected.
 *
 * Gaps and Reviews are GK review workflow. A client reviewer is linked to
 * the existing client follow-up page (clientFollowupReview capability);
 * everyone else sees who the project's files are waiting on, never a GK
 * queue.
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
  const [pipelineRefresh, setPipelineRefresh] = useState(0);
  const pipeline = useClientEvidencePipeline(organizationId, engagementId, pipelineRefresh);
  const refreshPipeline = () => setPipelineRefresh((value) => value + 1);
  const selectTab = (key) => {
    setTab(key);
    if (key !== tab && PIPELINE_TABS.has(key)) refreshPipeline();
  };
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
              onClick={() => selectTab(key)}
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
          processingStatus={pipeline}
          onProcessingStatusRefresh={refreshPipeline}
        />
      ) : null}
      {tab === "files" && organizationId ? (
        <ClientEvidencePipelineStatus
          request={pipeline}
          canReviewFollowups={canReviewFollowups}
          canContribute={canContribute}
          onRefresh={refreshPipeline}
        />
      ) : null}

      {tab === "evidence" && engagementId ? (
        <ProjectEvidence
          view={evidenceTabView(pipeline)}
          canReviewFollowups={canReviewFollowups}
          onViewImpactLibrary={onViewImpactLibrary}
          onOpenTab={selectTab}
        />
      ) : null}

      {tab === "evidence" && !engagementId ? (
        <div className="admin-card">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h5 className="mb-0">Reviewed evidence</h5>
            {factsStatus === "success" ? <span className="text-muted small">{factItems.length} shown</span> : null}
          </div>
          <div className="small text-muted mb-2">
            Evidence appears here once it has been reviewed and supports an Impact Fact your organization can use
            internally. Select a project to see where its uploaded files are in the review process.
          </div>
          {factsStatus === "loading" ? <div className="text-muted small">Loading reviewed evidence...</div> : null}
          {factsStatus === "error" ? <div className="alert alert-warning py-2 small">Reviewed evidence could not be loaded.</div> : null}
          {factsStatus === "success" && factItems.length === 0 ? (
            <div className="text-muted small">No reviewed evidence yet for this organization.</div>
          ) : null}
          {factsStatus === "success" && factItems.length > 0 ? <ReviewedFactList facts={factItems} /> : null}
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
          <div className="small text-muted mb-2">
            Evidence and Impact Fact reviews are completed by Get Kinder reviewers. Reviewed results appear in the
            Impact Library and under Evidence.
          </div>
          <ProjectReviews view={engagementId ? reviewsTabView(pipeline) : null} canReviewFollowups={canReviewFollowups} />
        </div>
      ) : null}
    </section>
  );
}

function ProjectEvidence({ view, canReviewFollowups, onViewImpactLibrary, onOpenTab }) {
  const needsClient = view.upstream?.some((entry) => entry.reason === "waiting_for_client");
  return (
    <div className="admin-card">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="mb-0">Reviewed evidence</h5>
        {view.kind === "facts" ? <span className="text-muted small">{view.facts.length} shown</span> : null}
      </div>
      <div className="small text-muted mb-2">
        Evidence appears here once it has been reviewed and supports an Impact Fact your organization can use
        internally. Information that is still being processed or reviewed is not shown, but its status is.
      </div>
      {view.kind === "loading" ? <div className="text-muted small">Loading this project&rsquo;s evidence status...</div> : null}
      {view.kind === "error" ? (
        <div className="alert alert-warning py-2 small">
          This project&rsquo;s evidence status could not be loaded. This does not mean the project has no evidence.
        </div>
      ) : null}
      {view.kind === "no_files" ? (
        <div className="small">
          <div className="text-muted mb-2">No files have been uploaded to this project yet, so there is no evidence to review.</div>
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => onOpenTab("files")}>
            Upload data in Files
          </button>
        </div>
      ) : null}
      {view.kind === "explained_empty" ? (
        <div className="small">
          <div className="fw-semibold mb-1">No reviewed evidence for this project yet. Here is where its files are:</div>
          <PipelineReasonList reasons={view.upstream} />
        </div>
      ) : null}
      {view.kind === "facts" ? <ReviewedFactList facts={view.facts} /> : null}
      {view.kind === "facts" && view.upstream.length > 0 ? (
        <div className="small mt-2">
          <div className="fw-semibold mb-1">Other files in this project are still in progress:</div>
          <PipelineReasonList reasons={view.upstream} />
        </div>
      ) : null}
      {(view.kind === "explained_empty" || view.kind === "facts") && needsClient ? (
        <button type="button" className="btn btn-sm btn-outline-primary mt-2 me-2" onClick={() => onOpenTab("reviews")}>
          {canReviewFollowups ? "Go to your reviews" : "See what is needed"}
        </button>
      ) : null}
      {(view.kind === "explained_empty" || view.kind === "facts") ? (
        <button type="button" className="btn btn-sm btn-outline-secondary mt-2 me-2" onClick={() => onOpenTab("files")}>
          See file status
        </button>
      ) : null}
      {typeof onViewImpactLibrary === "function" && view.kind === "facts" ? (
        <button type="button" className="btn btn-sm btn-outline-primary mt-2" onClick={onViewImpactLibrary}>
          Open the Impact Library
        </button>
      ) : null}
    </div>
  );
}

function ProjectReviews({ view, canReviewFollowups }) {
  if (!view) {
    return (
      <>
        <div className="small text-muted">Select a project to see whether anything needs your review.</div>
        {canReviewFollowups ? (
          <a className="btn btn-sm btn-outline-primary mt-2" href={CLIENT_FOLLOWUP_REVIEW_HREF}>
            Answer follow-up questions
          </a>
        ) : null}
      </>
    );
  }
  if (view.kind === "loading") return <div className="text-muted small">Loading review status...</div>;
  if (view.kind === "error") return <div className="alert alert-warning py-2 small mb-0">Review status could not be loaded.</div>;
  const clientCount = view.waitingForClient.length;
  return (
    <div className="small">
      {clientCount > 0 && canReviewFollowups ? (
        <div className="mb-2">
          <div className="fw-semibold">Your action is needed</div>
          <div>
            Get Kinder sent follow-up questions about evidence from {clientCount === 1 ? "1 file" : `${clientCount} files`} in this
            project. Evidence cannot be used until they are answered.
          </div>
        </div>
      ) : null}
      {clientCount > 0 && !canReviewFollowups ? (
        <div className="mb-2">
          <div className="fw-semibold">No action is currently required from you.</div>
          <div>
            Follow-up questions about evidence from {clientCount === 1 ? "1 file" : `${clientCount} files`} are waiting for a client
            reviewer in your organization.
          </div>
        </div>
      ) : null}
      {clientCount === 0 ? <div className="fw-semibold mb-2">No action is currently required from you.</div> : null}
      {canReviewFollowups ? (
        <a className="btn btn-sm btn-outline-primary mb-2" href={CLIENT_FOLLOWUP_REVIEW_HREF}>
          Answer follow-up questions
        </a>
      ) : null}
      {view.waitingForGetKinder.length > 0 ? (
        <div>
          <div className="fw-semibold">Waiting for Get Kinder review</div>
          <ul className="mb-0">
            {view.waitingForGetKinder.map((file) => {
              const current = file.stages.find((stage) => stage.key === file.currentStage);
              return (
                <li key={file.intakeFileId}>
                  {file.safeFilename}: {PIPELINE_STAGE_LABELS[file.currentStage]} ({stageStatusLabel(current)})
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
