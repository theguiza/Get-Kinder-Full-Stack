import React, { useState } from "react";

import { clientFollowupReviewHref } from "../impactEvidenceLibraryLogic.js";
import {
  PIPELINE_FAILURE_MESSAGES,
  PIPELINE_REQUEST_STATUS,
  PIPELINE_STAGE_LABELS,
  nextActionText,
  securityCheckRetryResultText,
  stageStatusLabel,
} from "./clientEvidencePipelineLogic.js";
import { requestSecurityCheckRetry } from "./securityCheckRetry.js";
import { Disclosure } from "./KnowledgeStudioViews.jsx";

const STATUS_BADGE = Object.freeze({
  complete: "text-bg-success",
  in_progress: "text-bg-info",
  not_started: "text-bg-light border",
  waiting_for_client: "text-bg-warning",
  waiting_for_get_kinder: "text-bg-secondary",
  failed: "text-bg-danger",
  closed: "text-bg-dark",
  not_currently_eligible: "text-bg-dark",
  unknown: "text-bg-light border",
});

/**
 * Files tab: "Processing & evidence status" for the selected project. It
 * renders the server's client-safe pipeline state (see
 * useClientEvidencePipeline). Its one request: for a file whose security
 * check could not run, an actor with intake contribution may re-attempt it
 * through the existing upload confirmation (the server authorizes it again).
 *
 * Each file is one compact row with one primary status - its current stage
 * and that stage's status, or "Processing complete" - and its next action;
 * the per-stage list is "Processing detail", on request (display only; the
 * stages and their statuses are unchanged).
 */
function primaryStage(file) {
  return file.currentStage ? file.stages.find((stage) => stage.key === file.currentStage) || null : null;
}

function primaryStatusText(file) {
  if (!file.currentStage) return "Processing complete";
  const current = primaryStage(file);
  return `${PIPELINE_STAGE_LABELS[file.currentStage]}: ${current ? stageStatusLabel(current) : "Unknown"}`;
}

export default function ClientEvidencePipelineStatus({ organizationId, request, canReviewFollowups = false, canContribute = false, onRefresh }) {
  const { status, data } = request;
  const [retrying, setRetrying] = useState(null);
  const [retryResults, setRetryResults] = useState({});
  const retrySecurityCheck = async (intakeFileId) => {
    setRetrying(intakeFileId);
    const result = await requestSecurityCheckRetry(organizationId, intakeFileId);
    setRetrying(null);
    setRetryResults((previous) => ({ ...previous, [intakeFileId]: securityCheckRetryResultText(result) }));
    if (typeof onRefresh === "function") onRefresh();
  };
  return (
    <div className="admin-card mt-3">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="mb-0">Processing &amp; evidence status</h5>
        {typeof onRefresh === "function" && status !== PIPELINE_REQUEST_STATUS.NOT_STARTED ? (
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={onRefresh} disabled={status === PIPELINE_REQUEST_STATUS.LOADING}>
            Refresh status
          </button>
        ) : null}
      </div>
      <div className="small text-muted mb-2">
        Where each file uploaded to this Project is, and what happens next. Open &ldquo;Processing detail&rdquo; for every step.
      </div>
      {status === PIPELINE_REQUEST_STATUS.NOT_STARTED ? (
        <div className="text-muted small">Select a project to see the status of its files.</div>
      ) : null}
      {status === PIPELINE_REQUEST_STATUS.LOADING ? <div className="text-muted small">Loading processing status...</div> : null}
      {status === PIPELINE_REQUEST_STATUS.ERROR ? (
        <div className="alert alert-warning py-2 small mb-0">Processing status could not be loaded.</div>
      ) : null}
      {data && data.files.length === 0 ? (
        <div className="text-muted small">No files have been uploaded to this project yet.</div>
      ) : null}
      {data && data.files.length > 0 ? (
        <ul className="list-group">
          {data.files.map((file) => (
            <li key={file.intakeFileId} className="list-group-item" data-pipeline-file={file.intakeFileId}>
              <div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
                <span className="fw-semibold small">{file.safeFilename}</span>
                <span className={`badge ${STATUS_BADGE[primaryStage(file)?.status] || "text-bg-success"}`} data-pipeline-file-primary-status="">
                  {primaryStatusText(file)}
                </span>
              </div>
              <Disclosure name="processing-detail" label="Processing detail" openLabel="Hide processing detail">
                <table className="table table-sm small mb-2 mt-1">
                  <tbody>
                    {file.stages.map((stage) => (
                      <tr key={stage.key}>
                        <td>{PIPELINE_STAGE_LABELS[stage.key]}</td>
                        <td className="text-end">
                          <span className={`badge ${STATUS_BADGE[stage.status]}`}>{stageStatusLabel(stage)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Disclosure>
              {file.currentStatus === "failed" && file.failureCategory ? (
                <div className="alert alert-danger py-1 small mb-1">
                  {PIPELINE_STAGE_LABELS[file.currentStage]} failed: {PIPELINE_FAILURE_MESSAGES[file.failureCategory]}
                </div>
              ) : null}
              {file.currentStatus !== "failed" && file.failureCategory ? (
                <div className="alert alert-warning py-1 small mb-1">
                  {PIPELINE_STAGE_LABELS[file.currentStage]}: {PIPELINE_FAILURE_MESSAGES[file.failureCategory]}
                </div>
              ) : null}
              <div className="small">
                <span className="fw-semibold">Next action: </span>
                {nextActionText(file, { canReviewFollowups, canContribute })}
              </div>
              {file.nextAction === "answer_client_followups" && canReviewFollowups ? (
                <a className="btn btn-sm btn-outline-primary mt-1" href={clientFollowupReviewHref(organizationId)}>
                  Answer follow-up questions
                </a>
              ) : null}
              {file.nextAction === "retry_security_check" && canContribute ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary mt-1"
                  data-security-check-retry={file.intakeFileId}
                  onClick={() => retrySecurityCheck(file.intakeFileId)}
                  disabled={retrying !== null}
                >
                  {retrying === file.intakeFileId ? "Checking security..." : "Check security again"}
                </button>
              ) : null}
              {retryResults[file.intakeFileId] ? (
                <div className="small text-muted mt-1" role="status">{retryResults[file.intakeFileId]}</div>
              ) : null}
              {file.reviewedImpactFactCount > 0 ? (
                <div className="small text-muted mt-1">
                  Usable Impact Facts from this file: {file.reviewedImpactFactCount}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {data && data.truncated ? (
        <div className="small text-muted mt-2">Showing the 100 most recently uploaded files for this project.</div>
      ) : null}
    </div>
  );
}
