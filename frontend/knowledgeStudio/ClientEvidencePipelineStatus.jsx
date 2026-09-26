import React from "react";

import { CLIENT_FOLLOWUP_REVIEW_HREF } from "../impactEvidenceLibraryLogic.js";
import {
  PIPELINE_FAILURE_MESSAGES,
  PIPELINE_REQUEST_STATUS,
  PIPELINE_STAGE_LABELS,
  nextActionText,
  stageStatusLabel,
} from "./clientEvidencePipelineLogic.js";

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
 * useClientEvidencePipeline) and issues no request of its own.
 */
export default function ClientEvidencePipelineStatus({ request, canReviewFollowups = false, canContribute = false, onRefresh }) {
  const { status, data } = request;
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
        Where each file uploaded to this project is in the review process. Evidence can be used only after Get Kinder
        has reviewed it.
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
              <div className="fw-semibold small mb-1">{file.safeFilename}</div>
              <table className="table table-sm small mb-2">
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
              {file.currentStatus === "failed" && file.failureCategory ? (
                <div className="alert alert-danger py-1 small mb-1">
                  {PIPELINE_STAGE_LABELS[file.currentStage]} failed: {PIPELINE_FAILURE_MESSAGES[file.failureCategory]}
                </div>
              ) : null}
              <div className="small">
                <span className="fw-semibold">Next action: </span>
                {nextActionText(file, { canReviewFollowups, canContribute })}
              </div>
              {file.nextAction === "answer_client_followups" && canReviewFollowups ? (
                <a className="btn btn-sm btn-outline-primary mt-1" href={CLIENT_FOLLOWUP_REVIEW_HREF}>
                  Answer follow-up questions
                </a>
              ) : null}
              {file.reviewedImpactFactCount > 0 ? (
                <div className="small text-muted mt-1">
                  Reviewed evidence from this file: {file.reviewedImpactFactCount}
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
