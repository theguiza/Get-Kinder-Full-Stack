import React, { useCallback, useRef, useState } from "react";
import {
  CLIENT_FOLLOWUP_DISPOSITION_LABEL,
  canCompleteClientFollowup,
  clientFollowupCompletePath,
  clientFollowupsPath,
  completionBody,
  errorText,
  getJson,
  postJson,
  projectClientFollowupWorkflows,
} from "./kaiClientFollowupReviewLogic.js";
import useRevalidateOnReturn from "./useRevalidateOnReturn.js";

export default function KaiClientFollowupReview({ organizationId: initialOrganizationId = "" } = {}) {
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pendingItemId, setPendingItemId] = useState("");
  const [message, setMessage] = useState("");
  // The organization whose follow-ups are on screen ("" before a load); only
  // the latest load may replace them, so a late response for an earlier
  // organization id or an earlier load is discarded.
  const [loadedOrganizationId, setLoadedOrganizationId] = useState("");
  const loadSeqRef = useRef(0);

  const loadWorkflows = useCallback(async (targetOrganizationId = organizationId) => {
    if (!targetOrganizationId) {
      setMessage("An organization id is required.");
      return;
    }
    const loadSeq = ++loadSeqRef.current;
    setLoading(true);
    setMessage("");
    const result = await getJson(clientFollowupsPath(targetOrganizationId));
    if (loadSeqRef.current !== loadSeq) return;
    setLoading(false);
    setLoadedOrganizationId(targetOrganizationId);
    if (result.statusCode !== 200 || !result.body?.ok) {
      // Includes a 403 after this reviewer's access was removed: no
      // follow-up, and so no completion action, stays on screen.
      setWorkflows([]);
      setMessage(errorText(result));
      return;
    }
    setWorkflows(projectClientFollowupWorkflows(result.body.data));
  }, [organizationId]);

  // Returning to the page re-reads the follow-ups already shown, so a
  // completion action is offered only while the server still permits it.
  useRevalidateOnReturn(() => {
    if (loadedOrganizationId) loadWorkflows(loadedOrganizationId);
  }, Boolean(loadedOrganizationId));

  // Editing the organization id discards the follow-ups shown for the
  // previous one and invalidates any load still in flight for it.
  const changeOrganization = useCallback((nextOrganizationId) => {
    loadSeqRef.current += 1;
    setOrganizationId(nextOrganizationId);
    setWorkflows([]);
    setLoadedOrganizationId("");
    setLoading(false);
    setMessage("");
  }, []);

  const completeWorkflow = useCallback(async (item) => {
    // A follow-up is completed only for the organization it was loaded for.
    const workflowOrganizationId = loadedOrganizationId;
    if (!workflowOrganizationId || !canCompleteClientFollowup(item) || pendingItemId) return;
    setPendingItemId(item.clientFollowupItemId);
    setMessage("");
    const result = await postJson(
      clientFollowupCompletePath(workflowOrganizationId, item.claimId, item.clientFollowupItemId),
      completionBody(item.updatedAt),
    );
    setPendingItemId("");
    if (result.statusCode !== 200 || !result.body?.ok) {
      // A refused or stale completion re-reads the list, so actions the
      // server no longer permits are removed; the refusal stays visible.
      const refusal = errorText(result);
      await loadWorkflows(workflowOrganizationId);
      setMessage(refusal);
      return;
    }
    await loadWorkflows(workflowOrganizationId);
  }, [loadedOrganizationId, pendingItemId, loadWorkflows]);

  return (
    <section>
      <h1 className="admin-title mb-3">Client Follow-ups</h1>
      <p className="text-muted small">
        Fixed follow-up questions raised for your organization&rsquo;s claims. Reviewing a follow-up
        records a workflow disposition only &mdash; it does not supply an answer or resolve the
        underlying data gap.
      </p>
      <div className="admin-card mb-3">
        <div className="row g-2 align-items-end">
          <div className="col-12 col-lg-8">
            <label className="form-label small fw-semibold">Organization id</label>
            <input
              className="form-control form-control-sm"
              value={organizationId}
              onChange={(event) => changeOrganization(event.target.value.trim())}
            />
          </div>
          <div className="col-12 col-lg-4">
            <button type="button" className="btn btn-sm btn-primary w-100" onClick={() => loadWorkflows(organizationId)} disabled={loading}>
              {loading ? "Loading..." : "Load follow-ups"}
            </button>
          </div>
        </div>
      </div>

      {message ? <div className="alert alert-warning py-2">{message}</div> : null}

      <div className="admin-card">
        {workflows.length === 0 ? <div className="text-muted small">No follow-ups loaded yet.</div> : null}
        <div className="list-group">
          {workflows.map((item) => (
            <div key={item.clientFollowupItemId} className="list-group-item">
              <div className="d-flex justify-content-between gap-2">
                <span className="small text-break">{item.questionText}</span>
                <span className="badge text-bg-secondary">{item.queueStatus} / {item.reviewStatus}</span>
              </div>
              <div className="small text-muted mt-1">Claim {item.claimId}</div>
              {canCompleteClientFollowup(item) ? (
                <>
                  <div className="small text-muted mt-2">{CLIENT_FOLLOWUP_DISPOSITION_LABEL}</div>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary mt-2"
                    onClick={() => completeWorkflow(item)}
                    disabled={Boolean(pendingItemId)}
                  >
                    Mark reviewed
                  </button>
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
