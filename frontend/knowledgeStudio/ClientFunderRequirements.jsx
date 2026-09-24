import React, { useEffect, useState } from "react";

import {
  CLIENT_FOLLOWUP_REVIEW_HREF,
  clientFunderRequirementsPath,
  getJson,
  projectClientFunderRequirements,
} from "../impactEvidenceLibraryLogic.js";

const READINESS_DISPLAY = Object.freeze({
  met: { label: "Supported", badge: "text-bg-success" },
  partially_met: { label: "Partly supported", badge: "text-bg-warning" },
  not_met: { label: "Not yet supported", badge: "text-bg-danger" },
  in_review: { label: "Being reviewed", badge: "text-bg-info" },
  not_yet_assessed: { label: "Not yet assessed", badge: "text-bg-secondary" },
});

const STATUS_MESSAGES = Object.freeze({
  no_target: "No funder or framework is selected for this project yet.",
  no_requirement_set: "KAI does not yet have a requirement set for this project's funder and framework.",
  not_applicable: "The requirement set for this project's funder and framework has been reviewed as not applicable to this project.",
  applicability_pending: "Get Kinder is still confirming which funder requirements apply to this project.",
});

function targetSummary(target) {
  const parts = [target.funderId, target.framework, target.grantProgram, target.report].filter(Boolean);
  const period = target.reportingPeriodStart || target.reportingPeriodEnd
    ? `${target.reportingPeriodStart || "…"} to ${target.reportingPeriodEnd || "…"}`
    : null;
  return [parts.join(" · "), period].filter(Boolean).join(" · ");
}

/**
 * Client Funder Requirements, a Knowledge Studio tab for the selected
 * project. Its one request is the client-safe funder-requirements read; it
 * never requests the GK funder-requirements composition, applicability, or
 * assessment routes and offers no assessment or target control. The
 * follow-up link appears only with the server's clientFollowupReview
 * capability.
 */
export default function ClientFunderRequirements({ organizationId, engagementId, canReviewFollowups = false }) {
  const [state, setState] = useState({ key: "", status: "idle", data: null });
  const key = organizationId && engagementId ? `${organizationId}:${engagementId}` : "";

  useEffect(() => {
    if (!key) {
      setState({ key: "", status: "idle", data: null });
      return undefined;
    }
    let cancelled = false;
    setState({ key, status: "loading", data: null });
    (async () => {
      const result = await getJson(clientFunderRequirementsPath(organizationId, engagementId));
      if (cancelled) return;
      const data = result.statusCode === 200 && result.body?.ok ? projectClientFunderRequirements(result.body.data) : null;
      setState({ key, status: data ? "success" : "error", data });
    })();
    return () => {
      cancelled = true;
    };
  }, [key, organizationId, engagementId]);

  const current = state.key === key ? state : { status: key ? "loading" : "idle", data: null };
  const data = current.data;
  const summary = data ? targetSummary(data.target) : "";

  return (
    <div className="admin-card">
      <h5 className="mb-2">Funder Requirements</h5>
      <div className="small text-muted mb-2">
        What this project&rsquo;s funder requires, and how well your organization&rsquo;s reviewed information currently
        supports each requirement.
      </div>
      {!key ? <div className="text-muted small">Select a project to see its funder requirements.</div> : null}
      {current.status === "loading" ? <div className="text-muted small">Loading funder requirements...</div> : null}
      {current.status === "error" ? (
        <div className="alert alert-warning py-2 small">Funder requirements could not be loaded.</div>
      ) : null}
      {data && summary ? <div className="small mb-2">Target: {summary}</div> : null}
      {data && data.status !== "applicable" ? <div className="text-muted small">{STATUS_MESSAGES[data.status]}</div> : null}
      {data && data.status === "applicable"
        ? data.requirementSets.map((set) => (
            <div key={set.requirementSetId} className="mb-3">
              <div className="small fw-semibold mb-1">
                {[set.funderName, set.frameworkName, set.versionLabel].filter(Boolean).join(" · ") || set.name || "Requirement set"}
              </div>
              {set.requirements.length === 0 ? (
                <div className="text-muted small">This requirement set has no requirements listed.</div>
              ) : (
                <ul className="list-group">
                  {set.requirements.map((requirement) => {
                    const display = READINESS_DISPLAY[requirement.readiness];
                    return (
                      <li key={requirement.requirementId} className="list-group-item">
                        <div className="d-flex justify-content-between align-items-start gap-2">
                          <div>
                            <div className="small fw-semibold">{requirement.label || "Requirement"}</div>
                            {requirement.description ? <div className="small text-muted">{requirement.description}</div> : null}
                          </div>
                          <span className={`badge ${display.badge}`}>{display.label}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))
        : null}
      {data && canReviewFollowups ? (
        <a className="btn btn-sm btn-outline-primary mt-2" href={CLIENT_FOLLOWUP_REVIEW_HREF}>
          Answer follow-up questions
        </a>
      ) : null}
    </div>
  );
}
