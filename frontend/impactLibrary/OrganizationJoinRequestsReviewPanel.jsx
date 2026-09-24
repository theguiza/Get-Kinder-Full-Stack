import React from "react";

/**
 * JOIN-5: the organization client_admin's Join requests review surface
 * inside the Impact Library. Purely presentational - the caller
 * (ImpactLibraryApp.jsx) renders it only after the JOIN-3 pending-queue GET
 * for the selected organization succeeded, and owns the approve/decline
 * calls. Approval is always the server-fixed contributor result, so there is
 * no role selector; the backend remains the authority for every decision.
 */
export default function OrganizationJoinRequestsReviewPanel({
  items = [],
  loading = false,
  error = "",
  actionId = "",
  onDecide,
  onClose,
}) {
  return (
    <section className="gk-organization-join gk-organization-join-review" aria-labelledby="gk-join-review-heading">
      <div className="gk-organization-join-header">
        <h2 id="gk-join-review-heading" className="gk-organization-join-title">Join requests</h2>
        {onClose ? (
          <button type="button" className="gk-organization-join-close" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
      <p className="gk-organization-join-hint">
        Approving adds the person to this organization as a contributor.
      </p>
      <div className="gk-organization-join-status" role="status" aria-live="polite">
        {loading ? "Loading join requests..." : null}
        {error ? <span className="gk-organization-join-error">{error}</span> : null}
        {!loading && !error && items.length === 0 ? "No pending join requests." : null}
      </div>
      {items.length > 0 ? (
        <ul className="gk-organization-join-results">
          {items.map((item) => {
            const requester = item.requester_email || "Unknown requester";
            const submitted = item.submitted_at ? new Date(item.submitted_at).toLocaleString() : "";
            const busy = actionId === item.organization_join_request_id;
            return (
              <li key={item.organization_join_request_id} className="gk-organization-join-result">
                <span className="gk-organization-join-result-name">
                  {requester}
                  {submitted ? <span className="gk-organization-join-result-meta">Requested {submitted}</span> : null}
                </span>
                <span className="gk-organization-join-review-actions">
                  <button
                    type="button"
                    className="gk-organization-join-request-btn"
                    disabled={Boolean(actionId)}
                    aria-label={`Approve ${requester} as contributor`}
                    onClick={() => onDecide?.(item, "approve")}
                  >
                    {busy ? "Saving..." : "Approve as contributor"}
                  </button>
                  <button
                    type="button"
                    className="gk-organization-join-close"
                    disabled={Boolean(actionId)}
                    aria-label={`Decline join request from ${requester}`}
                    onClick={() => onDecide?.(item, "decline")}
                  >
                    Decline
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
