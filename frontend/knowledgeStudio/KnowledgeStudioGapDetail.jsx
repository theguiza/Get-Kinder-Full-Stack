import React from "react";

/**
 * Knowledge Studio Gap Detail (Package D). Built over the SAME authoritative
 * gap/coverage/follow-up state the Gaps tab already computed
 * (projectOrganizationGapsAndRisks, from the existing Review Queue rollup) -
 * no new fetch, no second data source. Per owner instruction, this does NOT
 * wire or simulate "Add to Plan" - Improvement Plan persistence is Package
 * G/G2's responsibility; omitting that action here is intentional, not an
 * oversight.
 *
 * `gap` is one normalized item from the Gaps tab's four categories
 * (gap item / coverage finding / conflict / client follow-up), already
 * carrying only server-authoritative fields - nothing here is inferred or
 * fabricated. `onGoToTraceability` re-selects the associated claim and
 * scrolls to the existing Traceability panel, reusing that real evidence/
 * source/review-state view rather than duplicating it.
 */
export default function KnowledgeStudioGapDetail({ gap, onBack, onGoToTraceability }) {
  if (!gap) return null;

  const title = gap.dimensionKey || gap.basisCode || "Evidence gap";
  const category = gap.category;

  const whyItMatters = {
    gap: "This dimension has an open, currently-unresolved gap record for this claim - it is not yet backed by an accepted assessment.",
    coverageFinding: "This coverage dimension currently blocks the requested audience for this claim until it is resolved.",
    conflict: "A potential conflict between two claims has not yet been reviewed - it may affect what can be safely reported.",
    followup: "A client follow-up is outstanding for this dimension - the organization has not yet supplied the requested information.",
  }[category] || "This item is part of the organization's current evidence-health state and has not yet been resolved.";

  const requiredAction = {
    gap: gap.assessmentStatus ? `Assessment status: ${gap.assessmentStatus}` : "Requires an assessment decision.",
    coverageFinding: gap.assessmentStatus ? `Assessment status: ${gap.assessmentStatus}` : "Requires a coverage assessment decision.",
    conflict: gap.reviewStatus ? `Review status: ${gap.reviewStatus}` : "Requires a conflict review decision.",
    followup: gap.workflowStatus ? `Workflow status: ${gap.workflowStatus}` : "Requires client follow-up completion.",
  }[category] || null;

  return (
    <div className="admin-card mb-3">
      <button type="button" className="btn btn-link btn-sm px-0 mb-2" onClick={onBack}>
        &larr; Back to Gaps
      </button>
      <h5 className="mb-1">{title}</h5>
      <div className="small text-muted mb-3">Claim {typeof gap.claimId === "string" ? gap.claimId.slice(0, 8) : "unknown"}</div>

      <div className="mb-3">
        <div className="fw-semibold small mb-1">Why this matters</div>
        <div className="small">{whyItMatters}</div>
      </div>

      {requiredAction ? (
        <div className="mb-3">
          <div className="fw-semibold small mb-1">Current status</div>
          <div className="small">{requiredAction}</div>
        </div>
      ) : null}

      {gap.validatorKey ? (
        <div className="mb-3">
          <div className="fw-semibold small mb-1">Governed by</div>
          <div className="small text-muted">{gap.validatorKey}</div>
        </div>
      ) : null}

      <button type="button" className="btn btn-sm btn-outline-primary" onClick={onGoToTraceability}>
        View evidence &amp; source context
      </button>
    </div>
  );
}
