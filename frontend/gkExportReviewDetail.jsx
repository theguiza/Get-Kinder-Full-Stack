import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  canCompleteReview,
  canPrepareExportCandidate,
  canStartReview,
  completePath,
  completeReviewRequest,
  createExportCandidateRequest,
  createExportManifestRequest,
  decideCompleteResult,
  decideCreateExportCandidateResult,
  decideCreateExportManifestResult,
  decideGrantFinalReleaseAuthorityResult,
  decideOutcome,
  decideStartResult,
  exportCandidatePath,
  exportManifestCsvPath,
  exportManifestMarkdownPath,
  exportManifestPdfPath,
  exportManifestsPath,
  finalReleaseAuthorityPath,
  getJson,
  grantFinalReleaseAuthorityRequest,
  packetPath,
  startPath,
  startReviewRequest,
} from "./gkExportReviewDetailLogic.js";

/**
 * KAI P3-08/P3-12/P3-15 GK export-review detail page (GK-internal only).
 *
 * This component performs a single GET against the accepted P3-07 packet route
 * and renders only the allowlisted P3-06 DTO fields (see gkExportReviewDetailLogic.js).
 * The only write requests it can issue are the P3-12 "Start Review" transition
 * against the accepted P3-10 route and the P3-15 "Complete Review" transition
 * against the accepted P3-14 route, each sent with exactly
 * { expected_updated_at } and no other client-supplied authority data, plus
 * the governed export-finalization chain: P3-16 candidate preparation, the
 * explicit human P3-17 final-release-authority grant, and the P3-19
 * manifest finalization, each its own existing, separately-authorized
 * backend operation invoked one at a time by explicit GK-admin action. It
 * holds no other queue-transition or final-gate control. gk_admin
 * authorization, tenant membership, feature-flag state, packet validation,
 * citation authority, export eligibility, candidate currentness, final-release
 * authority, VAL-EXP-001/finalGate, and manifest identity are all decided by
 * the backend; this component never re-derives or overrides those decisions,
 * never grants authority itself, never selects a historical manifest, and
 * never trusts a mutation response as the new packet. Download Markdown for
 * the active current-session finalization uses only the exact
 * exportManifestId returned by that finalization call - the packet's
 * compatibility exportManifestId field is never restored into that
 * current-session state. Every entry in the packet's own
 * exportManifestHistory is rendered separately, each with its own exact
 * Download Markdown link; persisted history is never used to suppress
 * Prepare/Grant/Finalize, and no history entry is ever labeled
 * latest/current/preferred/active.
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

// Renders every persisted history entry exactly as returned - no entry is
// ever selected, hidden, or labeled latest/current/preferred/active.
// createdAt is shown as history metadata only.
function HistoricalManifests({ organizationId, exportManifestHistory }) {
  if (!exportManifestHistory || exportManifestHistory.length === 0) return null;
  return (
    <section className="gk-export-review-manifest-history">
      <h3>Export manifest history</h3>
      <ul>
        {exportManifestHistory.map((entry) => (
          <li key={entry.exportManifestId} className="gk-export-review-manifest-history-entry">
            <FieldRow label="Created at" value={entry.createdAt} />
            <a
              className="gk-export-review-download-markdown-link"
              href={exportManifestMarkdownPath(organizationId, entry.exportManifestId)}
            >
              Download Markdown
            </a>
            <a
              className="gk-export-review-download-csv-link"
              href={exportManifestCsvPath(organizationId, entry.exportManifestId)}
            >
              Download CSV Evidence Appendix
            </a>
            <a
              className="gk-export-review-download-pdf-link"
              href={exportManifestPdfPath(organizationId, entry.exportManifestId)}
            >
              Download PDF
            </a>
          </li>
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
  const [completePending, setCompletePending] = useState(false);
  const [completeErrorMessage, setCompleteErrorMessage] = useState(null);
  const [exportCandidateId, setExportCandidateId] = useState(null);
  const [candidatePending, setCandidatePending] = useState(false);
  const [candidateErrorMessage, setCandidateErrorMessage] = useState(null);
  const [authorityEffective, setAuthorityEffective] = useState(false);
  const [authorityPending, setAuthorityPending] = useState(false);
  const [authorityErrorMessage, setAuthorityErrorMessage] = useState(null);
  const [exportManifestId, setExportManifestId] = useState(null);
  const [manifestPending, setManifestPending] = useState(false);
  const [manifestErrorMessage, setManifestErrorMessage] = useState(null);
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

  const handleCompleteReview = useCallback(async () => {
    if (completePending || outcome?.kind !== "success" || !outcome.model) return;
    setCompletePending(true);
    setCompleteErrorMessage(null);
    try {
      const result = await completeReviewRequest(
        completePath(organizationId, generatedContentDraftId, exportReviewQueueItemId),
        outcome.model.exportReviewUpdatedAt,
      );
      const decided = decideCompleteResult(result);
      if (decided.kind === "success" || decided.kind === "conflict") {
        await loadPacket();
      } else {
        setCompleteErrorMessage(decided.message);
      }
    } catch {
      if (mountedRef.current) setCompleteErrorMessage("Request failed (network error).");
    } finally {
      if (mountedRef.current) setCompletePending(false);
    }
  }, [completePending, outcome, organizationId, generatedContentDraftId, exportReviewQueueItemId, loadPacket]);

  const handlePrepareExportCandidate = useCallback(async () => {
    if (candidatePending || outcome?.kind !== "success" || !outcome.model) return;
    setCandidatePending(true);
    setCandidateErrorMessage(null);
    try {
      const result = await createExportCandidateRequest(
        exportCandidatePath(organizationId, generatedContentDraftId),
      );
      const decided = decideCreateExportCandidateResult(result);
      if (decided.kind === "success") {
        if (mountedRef.current) setExportCandidateId(decided.exportCandidateId);
      } else {
        setCandidateErrorMessage(decided.message);
      }
    } catch {
      if (mountedRef.current) setCandidateErrorMessage("Request failed (network error).");
    } finally {
      if (mountedRef.current) setCandidatePending(false);
    }
  }, [candidatePending, outcome, organizationId, generatedContentDraftId]);

  const handleGrantFinalReleaseAuthority = useCallback(async () => {
    if (authorityPending || !exportCandidateId || outcome?.kind !== "success" || !outcome.model) return;
    setAuthorityPending(true);
    setAuthorityErrorMessage(null);
    try {
      const result = await grantFinalReleaseAuthorityRequest(
        finalReleaseAuthorityPath(organizationId, exportCandidateId),
        outcome.model.requestedExportAudience,
      );
      const decided = decideGrantFinalReleaseAuthorityResult(result);
      if (decided.kind === "success") {
        if (mountedRef.current) setAuthorityEffective(decided.effective);
      } else {
        setAuthorityErrorMessage(decided.message);
      }
    } catch {
      if (mountedRef.current) setAuthorityErrorMessage("Request failed (network error).");
    } finally {
      if (mountedRef.current) setAuthorityPending(false);
    }
  }, [authorityPending, exportCandidateId, outcome, organizationId]);

  const handleFinalizeExport = useCallback(async () => {
    if (manifestPending || !exportCandidateId || !authorityEffective) return;
    setManifestPending(true);
    setManifestErrorMessage(null);
    try {
      const result = await createExportManifestRequest(
        exportManifestsPath(organizationId, exportCandidateId),
        exportReviewQueueItemId,
      );
      const decided = decideCreateExportManifestResult(result);
      if (decided.kind === "success") {
        // Retain the exact returned manifest id for immediate same-session
        // Download Markdown, then reload the authoritative packet so the
        // new manifest appears in exportManifestHistory. This id is never
        // fabricated into a history entry client-side.
        if (mountedRef.current) setExportManifestId(decided.exportManifestId);
        await loadPacket();
      } else {
        setManifestErrorMessage(decided.message);
      }
    } catch {
      if (mountedRef.current) setManifestErrorMessage("Request failed (network error).");
    } finally {
      if (mountedRef.current) setManifestPending(false);
    }
  }, [manifestPending, exportCandidateId, authorityEffective, organizationId, exportReviewQueueItemId, loadPacket]);

  const model = outcome?.kind === "success" ? outcome.model : null;
  const showStartControl = canStartReview(model);
  const showCompleteControl = canCompleteReview(model);
  const showPrepareCandidateControl = canPrepareExportCandidate(model) && !exportCandidateId && !exportManifestId;
  const showGrantAuthorityControl = !!exportCandidateId && !authorityEffective && !exportManifestId;
  const showFinalizeExportControl = !!exportCandidateId && authorityEffective && !exportManifestId;

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
          {showCompleteControl ? (
            <button
              type="button"
              className="gk-export-review-complete-button"
              onClick={handleCompleteReview}
              disabled={completePending}
            >
              Complete Review
            </button>
          ) : null}
          {completeErrorMessage ? <p className="gk-export-review-note">{completeErrorMessage}</p> : null}

          <section className="gk-export-review-finalization">
            <h3>Governed export finalization</h3>
            {showPrepareCandidateControl ? (
              <button
                type="button"
                className="gk-export-review-prepare-candidate-button"
                onClick={handlePrepareExportCandidate}
                disabled={candidatePending}
              >
                Prepare Export Candidate
              </button>
            ) : null}
            {candidateErrorMessage ? <p className="gk-export-review-note">{candidateErrorMessage}</p> : null}

            {showGrantAuthorityControl ? (
              <button
                type="button"
                className="gk-export-review-grant-authority-button"
                onClick={handleGrantFinalReleaseAuthority}
                disabled={authorityPending}
              >
                Grant Final Release Authority
              </button>
            ) : null}
            {authorityErrorMessage ? <p className="gk-export-review-note">{authorityErrorMessage}</p> : null}

            {showFinalizeExportControl ? (
              <button
                type="button"
                className="gk-export-review-finalize-export-button"
                onClick={handleFinalizeExport}
                disabled={manifestPending}
              >
                Finalize Export
              </button>
            ) : null}
            {manifestErrorMessage ? <p className="gk-export-review-note">{manifestErrorMessage}</p> : null}

            {exportManifestId ? (
              <a
                className="gk-export-review-download-markdown-link"
                href={exportManifestMarkdownPath(organizationId, exportManifestId)}
              >
                Download Markdown
              </a>
            ) : null}
            {exportManifestId ? (
              <a
                className="gk-export-review-download-csv-link"
                href={exportManifestCsvPath(organizationId, exportManifestId)}
              >
                Download CSV Evidence Appendix
              </a>
            ) : null}
            {exportManifestId ? (
              <a
                className="gk-export-review-download-pdf-link"
                href={exportManifestPdfPath(organizationId, exportManifestId)}
              >
                Download PDF
              </a>
            ) : null}
          </section>

          <HistoricalManifests organizationId={organizationId} exportManifestHistory={model.exportManifestHistory} />

          <PacketDetail model={model} />
        </>
      ) : null}
    </div>
  );
}
