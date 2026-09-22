import React from "react";

/**
 * Knowledge Studio Gap Detail (Package D, humanized under D-Correction 3).
 * Built over the SAME authoritative gap/coverage/follow-up state the Gaps
 * tab already computed (projectOrganizationGapsAndRisks, from the existing
 * Review Queue rollup) - no new fetch, no second data source. Per owner
 * instruction, this does NOT wire or simulate "Add to Plan" - Improvement
 * Plan persistence is Package G/G2's responsibility; omitting that action
 * here is intentional, not an oversight.
 *
 * D-Correction 3: normal user-facing content never shows a raw claim UUID
 * or a validator key - those were removed. Status enums that have a known
 * human-readable interpretation are translated (STATUS_LABELS below); an
 * enum this component doesn't recognize is shown as-is rather than
 * fabricating a label for it, so nothing here invents meaning the data
 * doesn't support.
 *
 * `gap` is one normalized item from the Gaps tab's four categories (gap
 * item / coverage finding / conflict / client follow-up), already carrying
 * only server-authoritative fields. `onGoToTraceability` re-selects the
 * associated claim and scrolls to the existing Traceability panel, reusing
 * that real evidence/source/review-state view rather than duplicating it.
 *
 * Package G2 correction: "Add to Plan" is now wired, but ONLY for the "gap"
 * category, since only that category carries a real gap_log_item_id -
 * Improvement Practice's one supported origin FK. The other three
 * categories (coverage finding / conflict / client follow-up) have no
 * gap_log_item_id at all, so no button is shown for them - never a
 * simulated success or a fabricated association. `onAddToPlan(gapLogItemId)`
 * is expected to create a real persisted practice through the same
 * authorized service path Improvement Plan itself uses (Package G/G2); a
 * rejected/unauthorized attempt surfaces `addToPlanError` as-is, never a
 * fabricated success.
 */

const STATUS_LABELS = Object.freeze({
  unresolved: "Not yet resolved",
  resolved: "Resolved",
  needs_gk_review: "Waiting on review",
  reviewed: "Reviewed",
  waiting_on_client: "Waiting on the organization",
  open: "Open",
  blocked: "Blocked",
});

function humanizeDimensionKey(dimensionKey) {
  if (typeof dimensionKey !== "string" || !dimensionKey) return null;
  return dimensionKey.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function humanizeStatus(status) {
  if (!status) return null;
  return STATUS_LABELS[status] || status;
}

export default function KnowledgeStudioGapDetail({
  gap,
  onBack,
  onGoToTraceability,
  onAddToPlan,
  addingToPlan,
  addToPlanError,
  addedToPlan,
}) {
  if (!gap) return null;

  const category = gap.category;
  const title = humanizeDimensionKey(gap.dimensionKey) || humanizeDimensionKey(gap.basisCode) || "Evidence gap";
  const canAddToPlan = category === "gap" && Boolean(gap.gapLogItemId) && typeof onAddToPlan === "function";

  const whatIsMissing = {
    gap: "This dimension does not yet have an accepted assessment.",
    coverageFinding: "This coverage dimension currently blocks the requested audience.",
    conflict: "A potential conflict between two related claims has not yet been reviewed.",
    followup: "The organization has not yet supplied information a client follow-up requested.",
  }[category] || "This item is part of the organization's current evidence-health state.";

  const whyItMatters = {
    gap: "Without an accepted assessment, this evidence cannot yet be relied on for reporting.",
    coverageFinding: "Until this is resolved, claims relying on it cannot be shown to the requested audience.",
    conflict: "Unresolved conflicts may affect what can be safely reported until reviewed.",
    followup: "The requested information is needed before this evidence can move forward.",
  }[category] || "This affects how confidently KAI can report on this evidence.";

  const currentStatus = humanizeStatus(gap.assessmentStatus || gap.reviewStatus || gap.workflowStatus);

  return (
    <div className="admin-card mb-3">
      <button type="button" className="btn btn-link btn-sm px-0 mb-2" onClick={onBack}>
        &larr; Back to Gaps
      </button>
      <h5 className="mb-3">{title}</h5>

      <div className="mb-3">
        <div className="fw-semibold small mb-1">What&rsquo;s missing or uncertain</div>
        <div className="small">{whatIsMissing}</div>
      </div>

      <div className="mb-3">
        <div className="fw-semibold small mb-1">Why this matters</div>
        <div className="small">{whyItMatters}</div>
      </div>

      {currentStatus ? (
        <div className="mb-3">
          <div className="fw-semibold small mb-1">Current status</div>
          <div className="small">{currentStatus}</div>
        </div>
      ) : null}

      <button type="button" className="btn btn-sm btn-outline-primary me-2" onClick={onGoToTraceability}>
        View evidence &amp; source context
      </button>

      {canAddToPlan ? (
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          disabled={addingToPlan || addedToPlan}
          onClick={() => onAddToPlan(gap.gapLogItemId)}
        >
          {addedToPlan ? "Added to Plan" : addingToPlan ? "Adding…" : "Add to Plan"}
        </button>
      ) : null}
      {addToPlanError ? <div className="small text-danger mt-2">{addToPlanError}</div> : null}
    </div>
  );
}
