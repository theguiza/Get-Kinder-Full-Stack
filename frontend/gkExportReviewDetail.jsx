import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  canStartReview,
  decideOutcome,
  decideStartResult,
  getJson,
  packetPath,
  startPath,
  startReviewRequest,
} from "./gkExportReviewDetailLogic.js";

/**
 * KAI P3-08/P3-12 GK export-review detail page (GK-internal only).
 *
 * This component performs a single GET against the accepted P3-07 packet route
 * and renders only the allowlisted P3-06 DTO fields (see gkExportReviewDetailLogic.js).
 * The only write request it can issue is the single P3-12 "Start Review"
 * transition against the accepted P3-10 route, sent with exactly
 * { expected_updated_at } and no other client-supplied authority data. It
 * holds no other queue-transition or final-gate control. gk_admin
 * authorization, tenant membership, feature-flag state, packet validation,
 * citation authority, export eligibility, and the start transition itself are
 * all decided by the backend; this component never re-derives or overrides
 * those decisions and never trusts the mutation response as the new packet.
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
  const [startPending, setStartPending] = useState(false);
  const [startErrorMessage, setStartErrorMessage] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const identifiersMissing = !organizationId || !generatedContentDraftId || !exportReviewQueueItemId;

  const loadPacket = useCallback(async () => {
    setLoading(true);
    setOutcome(null);
    try {
      const result = await getJson(packetPath(organizationId, generatedContentDraftId, exportReviewQueueItemId));
      if (!mountedRef.current) return;
      setLoading(false);
      setOutcome(decideOutcome(result));
    } catch {
      if (!mountedRef.current) return;
      setLoading(false);
      setOutcome({ kind: "error", message: "Request failed (network error)." });
    }
  }, [organizationId, generatedContentDraftId, exportReviewQueueItemId]);

  useEffect(() => {
    if (identifiersMissing) {
      setOutcome({ kind: "error", message: "An organization id, generated-content draft id, and export-review queue item id are required." });
      return;
    }
    loadPacket();
    // loadPacket depends only on the identifiers already covered below.
  }, [identifiersMissing, loadPacket]);

  const handleStartReview = useCallback(async () => {
    if (startPending || outcome?.kind !== "success" || !outcome.model) return;
    setStartPending(true);
    setStartErrorMessage(null);
    try {
      const result = await startReviewRequest(
        startPath(organizationId, generatedContentDraftId, exportReviewQueueItemId),
        outcome.model.exportReviewUpdatedAt,
      );
      const decided = decideStartResult(result);
      if (decided.kind === "success" || decided.kind === "conflict") {
        await loadPacket();
      } else {
        setStartErrorMessage(decided.message);
      }
    } catch {
      if (mountedRef.current) setStartErrorMessage("Request failed (network error).");
    } finally {
      if (mountedRef.current) setStartPending(false);
    }
  }, [startPending, outcome, organizationId, generatedContentDraftId, exportReviewQueueItemId, loadPacket]);

  const model = outcome?.kind === "success" ? outcome.model : null;
  const showStartControl = canStartReview(model);

  return (
    <div className="gk-export-review-page">
      <h2>GK export review</h2>
      {loading ? <p className="gk-export-review-note">Loading&hellip;</p> : null}
      {!loading && outcome?.kind === "error" ? <p className="gk-export-review-note">{outcome.message}</p> : null}
      {!loading && outcome?.kind === "success" && !model ? (
        <p className="gk-export-review-note">No export-review packet loaded.</p>
      ) : null}
      {!loading && model ? (
        <>
          {showStartControl ? (
            <button
              type="button"
              className="gk-export-review-start-button"
              onClick={handleStartReview}
              disabled={startPending}
            >
              Start Review
            </button>
          ) : null}
          {startErrorMessage ? <p className="gk-export-review-note">{startErrorMessage}</p> : null}
          <PacketDetail model={model} />
        </>
      ) : null}
    </div>
  );
}
