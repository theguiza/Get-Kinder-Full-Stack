import React, { useEffect, useState } from "react";

import KaiWebIntake from "../KaiWebIntake.jsx";
import ImpactLibraryKai from "../ImpactLibraryKai.jsx";
import ClientFunderRequirements from "./ClientFunderRequirements.jsx";
import ClientGeneratedDrafts from "./ClientGeneratedDrafts.jsx";
import ClientEvidencePipelineStatus from "./ClientEvidencePipelineStatus.jsx";
import ClientSensitivityReviewPanel from "./ClientSensitivityReviewPanel.jsx";
import ClientEvidenceWorkflow from "./ClientEvidenceWorkflow.jsx";
import { clientEvidenceWorkflowAccess } from "./clientEvidenceWorkflowLogic.js";
import useClientEvidencePipeline from "./useClientEvidencePipeline.js";
import useRevalidateOnReturn from "../useRevalidateOnReturn.js";
import {
  GET_KINDER_STAGE_DESCRIPTIONS,
  PIPELINE_STAGE_LABELS,
  evidenceTabView,
  getKinderReviewAccessText,
  nextActionText,
  pipelineReasonMessage,
  reviewsTabMessages,
  reviewsTabView,
  sensitivityReviewActionAvailable,
  stageStatusLabel,
} from "./clientEvidencePipelineLogic.js";
import { clientFollowupReviewHref } from "../impactEvidenceLibraryLogic.js";
import { AttentionList, FindingText, KnowledgeStudioNav, ProjectHeading, ViewPane } from "./KnowledgeStudioViews.jsx";
import { DEFAULT_KNOWLEDGE_STUDIO_VIEW, nextVisitedViews } from "./knowledgeStudioViewsLogic.js";

// Four-view Knowledge Studio (owner direction 2026-11-06): Impact | Evidence
// | Sources | Drafts, Impact by default. The former Files, Data Sources and
// Reviews tabs are Sources; Gaps is "What needs attention" on Impact; Funder
// Requirements and Generated Drafts are Drafts.

// Views that render the selected project's evidence pipeline; entering one
// re-reads it so a status never lags behind an upload or a review.
const PIPELINE_TABS = new Set(["impact", "evidence", "sources"]);

function dimensionLabel(dimensionKey) {
  return String(dimensionKey || "").replace(/_/g, " ");
}

function ReviewedFactList({ facts }) {
  return (
    <ul className="list-group">
      {facts.map((fact) => (
        <li key={fact.claimId} className="list-group-item">
          <div className="small">
            {fact.statement ? <FindingText statement={fact.statement} /> : <div className="fw-semibold">Statement not yet available</div>}
          </div>
          <div className="d-flex flex-wrap gap-2 mt-1">
            {fact.claimType ? <span className="badge text-bg-light border">{fact.claimType}</span> : null}
            {/* The impact-facts read is KAI's internal-use determination (P2-08 /
                P2-06); it does not say a person reviewed the finding. */}
            <span className="badge text-bg-success">Usable internally</span>
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
 *   selected project (Drafts view, read once that view is first opened);
 * - ClientGeneratedDrafts' client-safe generated-draft, draft-detail, and
 *   Grant Response Packet / Board Reporting preview reads (Drafts view, read
 *   once that view is first opened);
 * - useClientEvidencePipeline's client-safe evidence-pipeline read for the
 *   selected project (re-read on entering Impact, Evidence or Sources): per uploaded file
 *   its governed stage, responsible party, and next permitted action, plus
 *   the governed reviewed Impact Facts descending from the project's files;
 * - only for an organization administrator the access-capabilities read
 *   admits (extractEvidence / proposeClaim / generateDrafts):
 *   ClientEvidenceWorkflow, mounted once for the whole studio as the shared
 *   controller of all four views (its Sources, Evidence Library and Claim
 *   Library reads - re-read after each action and on Project change, not on
 *   switching views, so loaded pages survive navigation - extraction,
 *   claim proposal, claim selection, and internal draft generation), so a
 *   selection or an in-progress action survives switching views;
 * - nothing else: organization-wide reviewed Impact Facts arrive as the
 *   `facts` prop, fetched once per organization by ImpactLibraryApp from the
 *   client-safe impact-facts read, and are shown only when no project is
 *   selected.
 *
 * Review status (in Sources) and "What needs attention" (on Impact) replace
 * the former Gaps and Reviews tabs. A client reviewer is linked to
 * the existing client follow-up page (clientFollowupReview capability);
 * everyone else sees who the project's files are waiting on, never a GK
 * queue. Review status also says whether this actor may perform Get Kinder reviews
 * (`getKinderReviewAccess`, the shell's existing review-cockpit capabilities
 * answer, for the organization named by `getKinderReviewAccessOrganizationId`).
 *
 * One Get Kinder review is offered here: when that answer is "allowed" for
 * the selected organization (a global Get Kinder reviewer whose membership in
 * this organization is a client role - owner decision 2026-10-11), a file at
 * the sensitivity review stage gets "Review sensitivity & allowed use", which
 * opens ClientSensitivityReviewPanel. Only that explicit action issues the
 * panel's review-cockpit reads; the review-work and decision writes need a
 * further explicit action in the panel. The selection is keyed to
 * organization + Project and cleared on leaving Sources, so a stale panel is
 * never rendered for another context.
 */
export default function ClientKnowledgeStudio({
  organizationId,
  engagementId,
  onEngagementIdChange,
  capabilities,
  getKinderReviewAccess = "unknown",
  getKinderReviewAccessOrganizationId = "",
  facts,
  onRefreshFacts,
  onViewImpactLibrary,
  projectName = "",
  initialView = DEFAULT_KNOWLEDGE_STUDIO_VIEW,
}) {
  const [tab, setTab] = useState(initialView);
  // Views are mounted on first visit and kept (hidden) afterwards, so an open
  // panel, an upload or an in-progress form survives switching views.
  const [visitedViews, setVisitedViews] = useState([initialView]);
  // Files persistence/rehydration: the selected intake batch is retained here
  // (re-validated by KaiWebIntake against a fresh server read) and cleared
  // whenever the organization or Project changes.
  const [filesIntakeBatchId, setFilesIntakeBatchId] = useState("");
  const [filesContinuation, setFilesContinuation] = useState(null);
  useEffect(() => {
    setFilesIntakeBatchId("");
    setFilesContinuation(null);
  }, [organizationId, engagementId]);
  const [pipelineRefresh, setPipelineRefresh] = useState(0);
  const pipeline = useClientEvidencePipeline(organizationId, engagementId, pipelineRefresh);
  const refreshPipeline = () => setPipelineRefresh((value) => value + 1);
  // The review-cockpit capabilities answer counts only for the organization
  // it was read for.
  const reviewAccess = organizationId && getKinderReviewAccessOrganizationId === organizationId ? getKinderReviewAccess : "unknown";
  const canReviewSensitivity = reviewAccess === "allowed" && Boolean(capabilities);
  const reviewContextKey = organizationId && engagementId ? `${organizationId}:${engagementId}` : "";
  const [sensitivityReviewSelection, setSensitivityReviewSelection] = useState(null);
  useEffect(() => {
    setSensitivityReviewSelection(null);
  }, [organizationId, engagementId]);
  const openSensitivityReview = canReviewSensitivity && reviewContextKey && tab === "sources"
    && sensitivityReviewSelection?.contextKey === reviewContextKey
    ? sensitivityReviewSelection
    : null;
  const selectTab = (key) => {
    setTab(key);
    setVisitedViews((current) => nextVisitedViews(current, key));
    if (key !== "sources") setSensitivityReviewSelection(null);
    if (key !== tab && PIPELINE_TABS.has(key)) refreshPipeline();
    if (key !== tab && key === "evidence") onRefreshFacts?.();
  };
  const continueXlsxInFiles = (source) => {
    setFilesContinuation(source);
    selectTab("sources");
  };
  // Returning to the page re-reads the selected project's pipeline while a
  // view that shows it is open, so a review completed meanwhile is reflected.
  useRevalidateOnReturn(() => {
    if (PIPELINE_TABS.has(tab)) refreshPipeline();
  }, Boolean(organizationId && engagementId));
  const canContribute = capabilities?.intakeContribution === true;
  const workflowAccess = clientEvidenceWorkflowAccess(capabilities);
  const canReviewFollowups = capabilities?.clientFollowupReview === true;
  const factsStatus = facts?.status || "loading";
  const factItems = Array.isArray(facts?.items) ? facts.items : [];
  const pane = (name) => ({ name, active: tab === name, mounted: visitedViews.includes(name) });

  // What needs attention, from the pipeline read every role may make.
  const reviews = engagementId ? reviewsTabView(pipeline) : null;
  const extraAttention = [];
  if (reviews?.kind === "ready" && reviews.waitingForClient.length > 0) {
    extraAttention.push({
      key: "client_followups",
      text: `${reviews.waitingForClient.length} file(s) wait for answers to follow-up questions from your organization.`,
      ...(canReviewFollowups ? { actionLabel: "Answer follow-up questions", href: clientFollowupReviewHref(organizationId) } : {}),
    });
  }
  if (reviews?.kind === "ready" && reviews.waitingForGetKinder.length > 0) {
    extraAttention.push({
      key: "waiting_for_get_kinder",
      text: `${reviews.waitingForGetKinder.length} file(s) are with Get Kinder for review. No action is needed from you.`,
      actionLabel: "See file status", onAction: () => selectTab("sources"),
    });
  }

  const fileStatusSection = organizationId ? (
    <ClientEvidencePipelineStatus
      request={pipeline}
      organizationId={organizationId}
      canReviewFollowups={canReviewFollowups}
      canContribute={canContribute}
      onRefresh={refreshPipeline}
    />
  ) : null;
  const uploadSection = organizationId ? (
    <KaiWebIntake
      organizationId={organizationId}
      engagementId={engagementId}
      onEngagementIdChange={onEngagementIdChange}
      intakeBatchId={filesIntakeBatchId}
      onIntakeBatchIdChange={setFilesIntakeBatchId}
      continuationSource={filesContinuation}
      embedded
      studioLayout
      canContribute={canContribute}
      processingStatus={pipeline}
      onProcessingStatusRefresh={refreshPipeline}
    />
  ) : null;
  const reviewStatusSection = (
    <div className="admin-card mb-3" data-client-review-status="">
      <h5 className="mb-2">Review status</h5>
      <div className="small text-muted mb-2">
        Get Kinder reviewers complete the required reviews of your Project&rsquo;s files: sensitivity review, source
        review, evidence review, and Impact Fact review.
      </div>
      <ProjectReviews
        view={reviews}
        canReviewFollowups={canReviewFollowups}
        getKinderReviewAccessNote={getKinderReviewAccessText(reviewAccess, Boolean(capabilities))}
        canReviewSensitivity={canReviewSensitivity}
        onOpenSensitivityReview={(file) => setSensitivityReviewSelection({
          contextKey: reviewContextKey,
          intakeFileId: file.intakeFileId,
          safeFilename: file.safeFilename,
        })}
        organizationId={organizationId}
        onOpenDataSources={null}
      />
      {openSensitivityReview ? (
        <ClientSensitivityReviewPanel
          key={`${openSensitivityReview.contextKey}:${openSensitivityReview.intakeFileId}`}
          organizationId={organizationId}
          intakeFileId={openSensitivityReview.intakeFileId}
          safeFilename={openSensitivityReview.safeFilename}
          onClose={() => setSensitivityReviewSelection(null)}
          onDecisionRecorded={refreshPipeline}
        />
      ) : null}
    </div>
  );
  // Sources: adding files first, then the files and their status.
  const sourcesBefore = uploadSection;
  const sourcesAfter = (
    <>
      {fileStatusSection}
      {reviewStatusSection}
    </>
  );
  const draftsAfter = (
    <>
      <div data-client-generated-drafts="">
        <ClientGeneratedDrafts
          organizationId={organizationId}
          engagementId={engagementId}
          facts={facts}
          canReviewFollowups={canReviewFollowups}
        />
      </div>
      <ClientFunderRequirements
        organizationId={organizationId}
        engagementId={engagementId}
        canReviewFollowups={canReviewFollowups}
      />
    </>
  );
  // Reviewed Impact Facts and where the Project's files are (the pipeline
  // read every role may make), shown in Evidence for every role.
  const projectEvidenceSection = engagementId ? (
    <ProjectEvidence
      view={evidenceTabView(pipeline)}
      canReviewFollowups={canReviewFollowups}
      onViewImpactLibrary={onViewImpactLibrary}
      onOpenTab={selectTab}
    />
  ) : null;
  const askKai = (
    <details className="mt-3" data-knowledge-studio-ask-kai="">
      <summary className="small fw-semibold mb-2">Ask KAI (answers from your whole organization library)</summary>
      <ImpactLibraryKai organizationId={organizationId} engagementId={engagementId} />
    </details>
  );

  return (
    <section data-knowledge-studio-kind="client">
      <ProjectHeading projectName={projectName} engagementId={engagementId} />
      <KnowledgeStudioNav view={tab} onSelect={selectTab} />

      {workflowAccess.visible && organizationId ? (
        <ClientEvidenceWorkflow
          organizationId={organizationId}
          engagementId={engagementId}
          access={workflowAccess}
          pipeline={pipeline}
          onPipelineRefresh={refreshPipeline}
          canUploadNewIntakeVersion={canContribute}
          onContinueXlsxInFiles={continueXlsxInFiles}
          view={tab}
          visitedViews={visitedViews}
          onSelectView={selectTab}
          projectName={projectName}
          extraAttention={extraAttention}
          evidenceAfter={projectEvidenceSection}
          sourcesBefore={sourcesBefore}
          sourcesAfter={sourcesAfter}
          draftsAfter={draftsAfter}
        />
      ) : (
        <>
          <ViewPane {...pane("impact")}>
            <ReviewedImpact
              engagementId={engagementId}
              view={engagementId ? evidenceTabView(pipeline) : null}
              attention={extraAttention}
              onOpenTab={selectTab}
            />
          </ViewPane>
          <ViewPane {...pane("evidence")}>
            {engagementId ? (
              <ProjectEvidence
                view={evidenceTabView(pipeline)}
                canReviewFollowups={canReviewFollowups}
                onViewImpactLibrary={onViewImpactLibrary}
                onOpenTab={selectTab}
              />
            ) : (
              <div className="admin-card">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <h5 className="mb-0">Usable Impact Facts</h5>
                  {factsStatus === "success" ? <span className="text-muted small">{factItems.length} shown</span> : null}
                </div>
                <div className="small text-muted mb-2">
                  Impact Facts KAI&rsquo;s checks find usable internally, across your whole organization. Select a Project to see its own evidence and file status.
                </div>
                {factsStatus === "loading" ? <div className="text-muted small">Loading Impact Facts...</div> : null}
                {factsStatus === "error" ? <div className="alert alert-warning py-2 small">Impact Facts could not be loaded.</div> : null}
                {factsStatus === "success" && factItems.length === 0 ? (
                  <div className="text-muted small">No usable Impact Facts yet for this organization.</div>
                ) : null}
                {factsStatus === "success" && factItems.length > 0 ? <ReviewedFactList facts={factItems} /> : null}
                {typeof onViewImpactLibrary === "function" && factsStatus === "success" && factItems.length > 0 ? (
                  <button type="button" className="btn btn-sm btn-outline-primary mt-2" onClick={onViewImpactLibrary}>
                    Open the Impact Library
                  </button>
                ) : null}
              </div>
            )}
          </ViewPane>
          <ViewPane {...pane("sources")}>{sourcesBefore}{sourcesAfter}</ViewPane>
          <ViewPane {...pane("drafts")}>{draftsAfter}</ViewPane>
        </>
      )}

      {organizationId ? askKai : null}
    </section>
  );
}

// Impact for an actor without the evidence-to-draft workflow: the Project's
// reviewed Impact Facts from the pipeline read. Their evidence type is not in
// that read, so they are not sorted into outcome or reach sections.
function ReviewedImpact({ engagementId, view, attention, onOpenTab }) {
  return (
    <div data-knowledge-studio-impact="" data-knowledge-studio-impact-project={engagementId || ""}>
      <h2 className="h5 mb-2">What this Project tells us about our impact</h2>
      {!engagementId ? <div className="admin-card" data-impact-state="no_project">Select a Project above to see what its evidence shows.</div> : null}
      {view?.kind === "loading" ? <div className="admin-card text-muted small" data-impact-state="loading">Loading this Project&rsquo;s evidence...</div> : null}
      {view?.kind === "error" ? (
        <div className="alert alert-warning small" data-impact-state="error">
          This Project&rsquo;s evidence could not be loaded. This does not mean the Project has no evidence.
        </div>
      ) : null}
      {view?.kind === "no_files" ? (
        <div className="admin-card small" data-impact-state="empty">
          No files have been added to this Project yet.
          <button type="button" className="btn btn-sm btn-outline-primary ms-2" onClick={() => onOpenTab("sources")}>Add files in Sources</button>
        </div>
      ) : null}
      {view?.kind === "explained_empty" ? (
        <div className="admin-card small" data-impact-state="empty">No usable findings for this Project yet.</div>
      ) : null}
      {view?.kind === "facts" ? (
        <div className="admin-card mb-3" data-impact-section="reviewed">
          <h5 className="mb-1">Usable findings</h5>
          <div className="small text-muted mb-2">Findings from this Project&rsquo;s files that KAI&rsquo;s checks find usable internally, with their known limitations.</div>
          <ReviewedFactList facts={view.facts} />
        </div>
      ) : null}
      {view && view.kind !== "loading" && view.kind !== "error" ? (
        <AttentionList items={[
          ...(view.upstream?.length ? [{
            key: "files_in_progress",
            text: view.upstream.map((entry) => pipelineReasonMessage(entry.reason, entry.fileCount)).join(" "),
            actionLabel: "See file status", onAction: () => onOpenTab("sources"),
          }] : []),
          ...attention,
        ]} />
      ) : null}
    </div>
  );
}

function ProjectEvidence({ view, canReviewFollowups, onViewImpactLibrary, onOpenTab }) {
  const needsClient = view.upstream?.some((entry) => entry.reason === "waiting_for_client");
  return (
    <div className="admin-card">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="mb-0">Usable Impact Facts</h5>
        {view.kind === "facts" ? <span className="text-muted small">{view.facts.length} shown</span> : null}
      </div>
      <div className="small text-muted mb-2">
        Impact Facts from this Project&rsquo;s files that KAI&rsquo;s checks find usable internally. Files still being processed are
        not shown here, but their status is.
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
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => onOpenTab("sources")}>
            Add files in Sources
          </button>
        </div>
      ) : null}
      {view.kind === "explained_empty" ? (
        <div className="small">
          <div className="fw-semibold mb-1">No usable Impact Facts for this Project yet. Here is where its files are:</div>
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
        <button type="button" className="btn btn-sm btn-outline-primary mt-2 me-2" onClick={() => onOpenTab("sources")}>
          {canReviewFollowups ? "Go to your reviews" : "See what is needed"}
        </button>
      ) : null}
      {(view.kind === "explained_empty" || view.kind === "facts") ? (
        <button type="button" className="btn btn-sm btn-outline-secondary mt-2 me-2" onClick={() => onOpenTab("sources")}>
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

function ProjectReviews({ organizationId, view, canReviewFollowups, getKinderReviewAccessNote, canReviewSensitivity, onOpenSensitivityReview, onOpenDataSources }) {
  if (!view) {
    return (
      <>
        <div className="small text-muted">Select a project to see whether anything needs your review.</div>
        {canReviewFollowups ? (
          <a className="btn btn-sm btn-outline-primary mt-2" href={clientFollowupReviewHref(organizationId)}>
            Answer follow-up questions
          </a>
        ) : null}
      </>
    );
  }
  if (view.kind === "loading") return <div className="text-muted small">Loading review status...</div>;
  if (view.kind === "error") return <div className="alert alert-warning py-2 small mb-0">Review status could not be loaded.</div>;
  return (
    <div className="small">
      {reviewsTabMessages(view, { canReviewFollowups, canReviewSensitivity }).map((message) => (
        <div key={message.key} className="mb-2" data-reviews-message={message.key}>
          <div className="fw-semibold">{message.heading}</div>
          {message.detail ? <div>{message.detail}</div> : null}
        </div>
      ))}
      {canReviewFollowups ? (
        <a className="btn btn-sm btn-outline-primary mb-2" href={clientFollowupReviewHref(organizationId)}>
          Answer follow-up questions
        </a>
      ) : null}
      {view.sourceWork.length > 0 ? (
        <div className="mb-2" data-reviews-source-work="">
          <div className="fw-semibold">Ready for you in Data Sources</div>
          <ul className="mb-1">
            {view.sourceWork.map((file) => (
              <li key={file.intakeFileId}>
                {file.safeFilename}: {nextActionText(file)}
                {/* The administrator's own sensitivity review stays reachable here (owner decision 2026-10-19). */}
                {canReviewSensitivity && file.nextAction === "review_sensitivity" ? (
                  <div>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary mt-1"
                      data-sensitivity-review-file={file.intakeFileId}
                      onClick={() => onOpenSensitivityReview(file)}
                    >
                      Review sensitivity &amp; allowed use
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {onOpenDataSources ? (
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={onOpenDataSources}>Open Data Sources</button>
          ) : null}
        </div>
      ) : null}
      {Array.isArray(view.waitingForAdministrator) && view.waitingForAdministrator.length > 0 ? (
        <div className="mb-2" data-reviews-waiting-for-administrator="">
          <div className="fw-semibold">Waiting for your organization&rsquo;s administrator</div>
          <ul className="mb-1">
            {view.waitingForAdministrator.map((file) => {
              const current = file.stages.find((stage) => stage.key === file.currentStage);
              return (
                <li key={file.intakeFileId}>
                  {file.safeFilename}: {PIPELINE_STAGE_LABELS[file.currentStage]} ({stageStatusLabel(current)})
                </li>
              );
            })}
          </ul>
          <div className="text-muted">Your organization&rsquo;s administrator completes these steps in Data Sources. No action is required from you.</div>
        </div>
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
                  {GET_KINDER_STAGE_DESCRIPTIONS[file.currentStage] ? (
                    <div className="text-muted">{GET_KINDER_STAGE_DESCRIPTIONS[file.currentStage]}</div>
                  ) : null}
                  {canReviewSensitivity && sensitivityReviewActionAvailable(file) ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary mt-1"
                      data-sensitivity-review-file={file.intakeFileId}
                      onClick={() => onOpenSensitivityReview(file)}
                    >
                      Review sensitivity &amp; allowed use
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {canReviewSensitivity ? (
            <div className="mt-2">
              Sensitivity reviews can be completed here. Get Kinder reviewers complete the other reviews in Get
              Kinder&rsquo;s own review workspace. This page shows the result once a review is complete.
            </div>
          ) : (
            <div className="mt-2">
              Get Kinder reviewers complete these reviews in Get Kinder&rsquo;s own review workspace. This page shows the
              result once a review is complete.
            </div>
          )}
        </div>
      ) : null}
      {/* Whether this account may act, wherever review work is listed (a
          sensitivity review may wait on the organization's administrator, not
          Get Kinder; owner decision 2026-10-19). */}
      {view.waitingForGetKinder.length > 0
        || (Array.isArray(view.waitingForAdministrator) && view.waitingForAdministrator.length > 0)
        || view.sourceWork.some((file) => file.nextAction === "review_sensitivity") ? (
          <div className="mt-1" data-get-kinder-review-access="">{getKinderReviewAccessNote}</div>
        ) : null}
    </div>
  );
}
