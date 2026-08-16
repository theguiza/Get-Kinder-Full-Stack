import React, { useCallback, useState } from "react";
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

export default function KaiClientFollowupReview({ organizationId: initialOrganizationId = "" } = {}) {
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pendingItemId, setPendingItemId] = useState("");
  const [message, setMessage] = useState("");

  const loadWorkflows = useCallback(async () => {
    if (!organizationId) {
      setMessage("An organization id is required.");
      return;
    }
    setLoading(true);
    setMessage("");
    const result = await getJson(clientFollowupsPath(organizationId));
    setLoading(false);
    if (result.statusCode !== 200 || !result.body?.ok) {
      setWorkflows([]);
      setMessage(errorText(result));
      return;
    }
    setWorkflows(projectClientFollowupWorkflows(result.body.data));
  }, [organizationId]);

  const completeWorkflow = useCallback(async (item) => {
    if (!organizationId || !canCompleteClientFollowup(item) || pendingItemId) return;
    setPendingItemId(item.clientFollowupItemId);
    setMessage("");
    const result = await postJson(
      clientFollowupCompletePath(organizationId, item.claimId, item.clientFollowupItemId),
      completionBody(item.updatedAt),
    );
    setPendingItemId("");
    if (result.statusCode !== 200 || !result.body?.ok) {
      setMessage(errorText(result));
      return;
    }
    await loadWorkflows();
  }, [organizationId, pendingItemId, loadWorkflows]);

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
              onChange={(event) => setOrganizationId(event.target.value.trim())}
            />
          </div>
          <div className="col-12 col-lg-4">
            <button type="button" className="btn btn-sm btn-primary w-100" onClick={loadWorkflows} disabled={loading}>
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
