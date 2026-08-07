import React, { useEffect, useState } from "react";

import { decideOutcome, getJson, packetPath } from "./gkExportReviewDetailLogic.js";

/**
 * KAI P3-08 read-only GK export-review detail page (GK-internal only).
 *
 * This component performs a single GET against the accepted P3-07 packet route
 * and renders only the allowlisted P3-06 DTO fields (see gkExportReviewDetailLogic.js).
 * It issues no write request of any kind and holds no queue-transition or
 * final-gate control. gk_admin authorization, tenant membership, feature-flag
 * state, packet validation, citation authority, and export eligibility are all
 * decided by the backend; this component never re-derives or overrides those
 * decisions.
 */

function FieldRow({ label, value }) {
  return (
    <div className="gk-export-review-field">
      <span className="gk-export-review-field-label">{label}</span>
      <span className="gk-export-review-field-value">{String(value)}</span>
    </div>
  );
}

function CitationDetail({ citation }) {
  return (
    <li className="gk-export-review-citation">
      <FieldRow label="Claim" value={citation.claimId} />
      <FieldRow label="Evidence item" value={citation.evidenceItemId} />
      <FieldRow label="Source" value={citation.sourceId} />
      <FieldRow label="Source version" value={citation.sourceVersionId} />
      <FieldRow label="Support strength" value={citation.supportStrength} />
      <FieldRow label="Claim review status" value={citation.claimReviewStatus} />
      <FieldRow label="Evidence review status" value={citation.evidenceReviewStatus} />
      <FieldRow label="Currently eligible" value={citation.currentEligible} />
      <FieldRow label="Blocker codes" value={citation.blockerCodes.join(", ") || "none"} />
      <FieldRow label="Affected dimensions" value={citation.affectedDimensionKeys.join(", ") || "none"} />
      <FieldRow label="Affected object ids" value={citation.affectedObjectIds.join(", ") || "none"} />
    </li>
  );
}

function BlockDetail({ block }) {
  return (
    <section className="gk-export-review-block">
      <FieldRow label="Ordinal" value={block.ordinal} />
      <p className="gk-export-review-block-text">{block.text}</p>
      <h4>Why can KAI say this?</h4>
      <ul>
        {block.citations.map((citation, index) => (
          <CitationDetail key={`${citation.claimId}-${citation.evidenceItemId}-${index}`} citation={citation} />
        ))}
      </ul>
    </section>
  );
}

function PacketDetail({ model }) {
  return (
    <section className="gk-export-review-detail">
      <h3>Export review packet (read-only)</h3>
      <FieldRow label="Requested export audience" value={model.requestedExportAudience} />
      <FieldRow label="Draft status" value={model.draftStatus} />
      <FieldRow label="Generated-content review status" value={model.generatedContentReviewStatus} />
      <FieldRow label="Export-review status" value={model.exportReviewStatus} />
      <FieldRow label="Current-use eligible" value={model.currentUseEligible} />
      <FieldRow label="Export eligible" value={model.exportEligible} />

      <h4>VAL-EXP-001</h4>
      <FieldRow label="Severity" value={model.validatorSeverity} />
      <FieldRow label="Failed gate" value={model.validatorFailedGate ?? "none"} />

      <h4>Generated-content blocks</h4>
      {model.blocks.map((block) => (
        <BlockDetail key={block.ordinal} block={block} />
      ))}
    </section>
  );
}

export default function GkExportReviewDetail({
  organizationId = "",
  generatedContentDraftId = "",
  exportReviewQueueItemId = "",
}) {
  const [outcome, setOutcome] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!organizationId || !generatedContentDraftId || !exportReviewQueueItemId) {
      setOutcome({ kind: "error", message: "An organization id, generated-content draft id, and export-review queue item id are required." });
      return;
    }
    setLoading(true);
    setOutcome(null);
    getJson(packetPath(organizationId, generatedContentDraftId, exportReviewQueueItemId))
      .then((result) => {
        if (cancelled) return;
        setLoading(false);
        setOutcome(decideOutcome(result));
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setOutcome({ kind: "error", message: "Request failed (network error)." });
      });
    return () => { cancelled = true; };
  }, [organizationId, generatedContentDraftId, exportReviewQueueItemId]);

  return (
    <div className="gk-export-review-page">
      <h2>GK export review</h2>
      {loading ? <p className="gk-export-review-note">Loading&hellip;</p> : null}
      {!loading && outcome?.kind === "error" ? <p className="gk-export-review-note">{outcome.message}</p> : null}
      {!loading && outcome?.kind === "success" && !outcome.model ? (
        <p className="gk-export-review-note">No export-review packet loaded.</p>
      ) : null}
      {!loading && outcome?.kind === "success" && outcome.model ? <PacketDetail model={outcome.model} /> : null}
    </div>
  );
}
