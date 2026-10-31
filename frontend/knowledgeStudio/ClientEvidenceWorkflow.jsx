import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  claimGapFollowupsPath,
  claimLibraryCandidatesPath,
  claimProposalPath,
  claimTraceabilityPath,
  clientImpactFactsPath,
  createEvidenceSummaryPath,
  createImpactNarrativePath,
  errorText,
  evidenceExtractionPath,
  evidenceLibraryCandidatesPath,
  getJson,
  intakeFileSourceCandidatePath,
  isRouteUuid,
  organizationSourcesPath,
  postJson,
  projectCandidateClaims,
  projectClientImpactFacts,
  projectEvidenceLibraryItems,
  projectOrganizationSources,
  sourceCandidateDetailPath,
} from "../impactEvidenceLibraryLogic.js";
import {
  CLAIM_USE_UNKNOWN_MESSAGE,
  INTERNAL_DRAFT_READINESS_MESSAGES,
  USE_FOR_IMPACT_MAX_STEPS,
  USE_FOR_IMPACT_MESSAGES,
  claimIdsByEvidenceItem,
  claimInternalDraftSelectability,
  claimDraftAdmitted,
  claimInternalUse,
  claimKind,
  claimNotUsableMessage,
  claimUseDiagnosis,
  claimsToDiagnose,
  claimProposalResultMessage,
  claimSelectabilityMessage,
  extractionResultMessage,
  gapFollowupFailureMessage,
  gapFollowupResultMessage,
  internalDraftFailureMessage,
  internalDraftReadiness,
  internalDraftRequestBody,
  internalDraftResultSummary,
  internalDraftTraceabilityDiagnosis,
  isInternalDraftTraceabilityRefusal,
  isUseForImpactCandidate,
  orderClaimsForReports,
  processingPermissionReviewFiles,
  readLibraryPages,
  retainSelectableClaimIds,
  selectionReportUsability,
  selectionReportUsabilityMessage,
  sourcePreparationContinuationFailureMessage,
  sourcePreparationContinuationMessage,
  sourcePreparationFiles,
  sourcePreparationGuidance,
  useForImpactStep,
} from "./clientEvidenceWorkflowLogic.js";
import {
  PIPELINE_STAGE_LABELS,
  clientEvidencePipelinePath,
  isPipelineSuccess,
  projectClientEvidencePipeline,
  stageStatusLabel,
} from "./clientEvidencePipelineLogic.js";
import ClientInternalDrafts from "./ClientInternalDrafts.jsx";
import ClientSensitivityReviewPanel from "./ClientSensitivityReviewPanel.jsx";
import ClientSourcePromotionPanel from "./ClientSourcePromotionPanel.jsx";
import ClientSourceMeasurementPanel from "./ClientSourceMeasurementPanel.jsx";
import ClientMeasuredClaimReviewPanel from "./ClientMeasuredClaimReviewPanel.jsx";

const DRAFT_LABELS = Object.freeze({
  evidence_summary: "Internal evidence summary",
  impact_narrative: "Internal impact narrative",
});

// The organization-wide Evidence and Claim Library reads are paged (25 per
// page, in id order). One load reads up to this many pages; when the server
// still reports more, the read is marked incomplete, its continuation cursor
// is kept, and "Load more" continues from it. A claim not loaded yet is
// unknown, never absent.
const LIBRARY_PAGES_PER_LOAD = 40;
const CLAIM_CURSOR = "nextAfterClaimId";
const EVIDENCE_CURSOR = "nextAfterEvidenceItemId";
// Per-claim P2-06 diagnostics read automatically per refresh; any further
// claim offers its own "Check internal use".
const CLAIM_DIAGNOSES_PER_REFRESH = 25;
const projectInternalUse = (data) => {
  const facts = projectClientImpactFacts(data);
  return facts ? { claimIds: new Set(facts.items.map((item) => item.claimId)), truncated: facts.truncated } : null;
};

function useOrganizationRead(organizationId, path, project, refreshToken, cursorKey = null) {
  const [state, setState] = useState({ organizationId: "", status: "idle", items: [], complete: false, nextCursor: null });
  const keyRef = useRef("");
  // `cursorKey` null: one unpaged read, projected as a whole.
  const pagesFrom = useCallback(async (requestKey, cursor) => {
    if (cursorKey === null) {
      const result = await getJson(path(organizationId, null));
      if (keyRef.current !== requestKey) return { status: "superseded" };
      if (result.statusCode !== 200 || !result.body?.ok) return { status: "error", result };
      return { status: "success", items: project(result.body.data), complete: true, nextCursor: null };
    }
    return readLibraryPages({
      fetchPage: (after) => getJson(path(organizationId, after)),
      project,
      cursorKey,
      cursor,
      maxPages: LIBRARY_PAGES_PER_LOAD,
      isCurrent: () => keyRef.current === requestKey,
    });
  }, [organizationId, path, project, cursorKey]);
  useEffect(() => {
    if (!organizationId) return undefined;
    const requestKey = `${organizationId}:${refreshToken}`;
    keyRef.current = requestKey;
    setState((current) => ({
      organizationId, status: "loading", items: current.organizationId === organizationId ? current.items : [], complete: false, nextCursor: null,
    }));
    (async () => {
      const read = await pagesFrom(requestKey, null);
      if (read.status === "superseded") return;
      if (read.status === "error") {
        setState({ organizationId, status: "error", items: [], complete: false, nextCursor: null, message: errorText(read.result) });
        return;
      }
      setState({ organizationId, status: "success", items: read.items, complete: read.complete, nextCursor: read.nextCursor, requestKey });
    })();
    return () => { keyRef.current = ""; };
  }, [organizationId, refreshToken, pagesFrom]);
  // Continues an incomplete read from its kept cursor, within the same
  // organization and refresh; a newer read discards the result.
  const loadMore = useCallback(async () => {
    const requestKey = keyRef.current;
    if (state.status !== "success" || state.complete || !isRouteUuid(state.nextCursor) || state.requestKey !== requestKey) return;
    setState((current) => ({ ...current, status: "loading_more" }));
    const read = await pagesFrom(requestKey, state.nextCursor);
    if (read.status === "superseded") return;
    if (read.status === "error") {
      setState((current) => ({ ...current, status: "success", message: errorText(read.result) }));
      return;
    }
    setState((current) => ({
      ...current, status: "success", items: current.items.concat(read.items), complete: read.complete, nextCursor: read.nextCursor, message: "",
    }));
  }, [state, pagesFrom]);
  const visible = state.organizationId === organizationId ? state : { organizationId, status: "loading", items: [], complete: false, nextCursor: null };
  // "loading_more" keeps the loaded items on screen.
  return { ...visible, status: visible.status === "loading_more" ? "success" : visible.status, loadingMore: visible.status === "loading_more", loadMore };
}

/**
 * Data Sources tab of the client Knowledge Studio for an organization
 * administrator (owner decision 2026-10-18). Mounted only while the tab is
 * open and only when the access-capabilities read admits at least one of
 * extractEvidence / proposeClaim / generateClaimGapFollowups /
 * generateDrafts; each action is shown only for its own flag, and the server
 * re-authorizes every request.
 *
 * Requests: the organization-scoped Sources, Evidence Library, and Claim
 * Library reads; the P2-01 extraction, P2-03 claim-proposal, and P2-04 claim
 * gap follow-up writes; and the internal evidence-summary and
 * impact-narrative generation writes. Never the funder or any other
 * generator, an evidence or claim review decision, a follow-up answer, the
 * full GK traceability DTO, or a GK review packet. After a draft refused for
 * traceability (VAL-GEN-TRACE-P0-001), and only with
 * readClaimTraceabilityDiagnostics, it reads each selected claim's client-safe
 * internal traceability diagnostic (owner authorization 2026-10-24) to say
 * which claim failed and why; it generates, approves, and retries nothing.
 *
 * Source preparation (owner decision 2026-10-18): for the selected Project,
 * the files the client evidence pipeline (`pipeline`, the parent's read) puts
 * at sensitivity review, source review, or extraction. Each offers only the
 * step the server reports this actor may take: the existing sensitivity
 * review panel (reviewSensitivity), the source review panel
 * (promote_source, decided by the candidate detail's own
 * decision_controls_enabled), the source-preparation continuation
 * (continue_source_preparation, owner decision 2026-10-19: one empty-body
 * POST that creates a reviewed file's missing source candidate), or the
 * server's reason the file waits. Panels open only from an explicit action;
 * a recorded decision or continuation refreshes the pipeline and the
 * Sources / Evidence / Claim reads.
 *
 * "Use for impact" (owner decision 2026-10-19) is each eligible file's
 * primary action: from the file's persisted pipeline state it runs the
 * already-authorized automated steps (the P1-07 continuation, P2-01
 * extraction from the file's current source version), re-reading the
 * pipeline after each, and stops at a human decision - the sensitivity
 * review or the source authorization and P1-08 decision - by opening that
 * existing panel; once the person records it, the flow resumes from the
 * re-read state. Every step is the existing route, which re-authorizes and
 * replays idempotently, so a repeat or an interrupted flow continues from
 * whatever is persisted.
 *
 * "Processing permissions" (reviewSensitivity; exception recovery): every file
 * of the Project whose sensitivity review is complete, at whatever later
 * stage, with "Review processing permissions", which opens the same
 * sensitivity review panel on that pipeline intake file to record a
 * corrective, superseding decision through the existing decision route. A
 * recorded correction refreshes the pipeline and the reads only; it runs no
 * step and resumes no "Use for impact" flow.
 *
 * "Your internal drafts" (readInternalDrafts) reads the administrator's own
 * persisted internal drafts with their true review state; a draft just
 * generated is opened from that read.
 */
export default function ClientEvidenceWorkflow({ organizationId, engagementId, access, pipeline, onPipelineRefresh, canUploadNewIntakeVersion, onContinueXlsxInFiles }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = () => setRefreshToken((value) => value + 1);
  const sources = useOrganizationRead(organizationId, organizationSourcesPath, projectOrganizationSources, refreshToken);
  const evidence = useOrganizationRead(organizationId, evidenceLibraryCandidatesPath, projectEvidenceLibraryItems, refreshToken, EVIDENCE_CURSOR);
  const claims = useOrganizationRead(organizationId, claimLibraryCandidatesPath, projectCandidateClaims, refreshToken, CLAIM_CURSOR);
  // Authoritative internal usability of each claim (P2-08 / P2-06, internal audience).
  const internalUse = useOrganizationRead(organizationId, clientImpactFactsPath, projectInternalUse, refreshToken);
  const internalUseIndex = internalUse.status === "success" ? internalUse.items : null;
  const orderedClaims = orderClaimsForReports(claims.items);

  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState(null);
  const [selectedClaimIds, setSelectedClaimIds] = useState([]);
  const [draftKeys, setDraftKeys] = useState({});
  const [lastDraft, setLastDraft] = useState(null);
  const [gapFollowupsByClaim, setGapFollowupsByClaim] = useState({});
  const contextRef = useRef("");
  const contextKey = `${organizationId}:${engagementId || ""}`;
  contextRef.current = contextKey;

  useEffect(() => {
    setSelectedClaimIds([]);
    setDraftKeys({});
    setLastDraft(null);
    setGapFollowupsByClaim({});
    setNotice(null);
  }, [organizationId, engagementId]);

  // Each claim's own P2-06 internal evaluation (the client-safe traceability
  // diagnostic), for the claims the impact-facts read does not establish as
  // usable: a claim it left out of a truncated read, or one it reports as not
  // usable (to say why). Read-only; cleared on every refresh and organization.
  const [diagnostics, setDiagnostics] = useState({ key: "", byClaim: new Map() });
  const diagnosticsKey = `${organizationId}:${refreshToken}`;
  const claimDiagnostics = diagnostics.key === diagnosticsKey ? diagnostics.byClaim : new Map();
  const diagnoseClaims = useCallback(async (claimIds) => {
    const key = diagnosticsKey;
    for (const claimId of claimIds) {
      const result = await getJson(claimTraceabilityPath(organizationId, claimId, "internal"));
      const diagnosis = claimUseDiagnosis(result);
      setDiagnostics((current) => {
        if (current.key !== key && current.key !== "") return current;
        const byClaim = new Map(current.key === key ? current.byClaim : []);
        byClaim.set(claimId, diagnosis);
        return { key, byClaim };
      });
    }
  }, [organizationId, diagnosticsKey]);
  const diagnosedOnceRef = useRef(new Set());
  useEffect(() => {
    diagnosedOnceRef.current = new Set();
    setDiagnostics({ key: diagnosticsKey, byClaim: new Map() });
  }, [diagnosticsKey]);
  useEffect(() => {
    if (access.readClaimTraceabilityDiagnostics !== true || claims.status !== "success" || internalUse.status === "loading") return;
    const pending = claimsToDiagnose({
      claims: claims.items, impactFacts: internalUseIndex, diagnostics: claimDiagnostics, selectedClaimIds,
      limit: CLAIM_DIAGNOSES_PER_REFRESH - diagnosedOnceRef.current.size,
    }).filter((claimId) => !diagnosedOnceRef.current.has(claimId));
    if (pending.length === 0) return;
    for (const claimId of pending) diagnosedOnceRef.current.add(claimId);
    diagnoseClaims(pending);
    // claimDiagnostics/internalUseIndex are derived from the listed state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.readClaimTraceabilityDiagnostics, claims.status, claims.items, internalUse.status, selectedClaimIds, diagnoseClaims]);
  const useOfClaim = (claimId) => claimInternalUse(claimId, internalUseIndex, claimDiagnostics);
  useEffect(() => {
    if (claims.status === "success") setSelectedClaimIds((current) => retainSelectableClaimIds(current, claims.items));
  }, [claims.status, claims.items]);

  const runWrite = useCallback(async (label, path, body, onSuccess, failureText = errorText) => {
    const requestContext = contextRef.current;
    setPending(label);
    setNotice(null);
    const result = await postJson(path, body);
    if (contextRef.current !== requestContext) return;
    setPending("");
    if ((result.statusCode !== 200 && result.statusCode !== 201) || !result.body?.ok) {
      const text = await failureText(result);
      if (contextRef.current !== requestContext) return;
      setNotice({ kind: "warning", text });
      return;
    }
    onSuccess(result.body.data);
    refresh();
  }, []);

  const extract = (sourceVersionId) => runWrite(`extract:${sourceVersionId}`, evidenceExtractionPath(organizationId, sourceVersionId), {},
    (data) => setNotice({ kind: "success", text: extractionResultMessage(data) }));
  const propose = (evidenceItemId) => runWrite(`propose:${evidenceItemId}`, claimProposalPath(organizationId, evidenceItemId), {},
    (data) => setNotice({ kind: "success", text: claimProposalResultMessage(data) }));
  // P2-04 is idempotent per claim: a repeat request replays the same rows.
  const generateGapFollowups = (claimId) => runWrite(`gaps:${claimId}`, claimGapFollowupsPath(organizationId, claimId), {},
    (data) => {
      const text = gapFollowupResultMessage(data);
      setGapFollowupsByClaim((current) => ({ ...current, [claimId]: text }));
      setNotice({ kind: "success", text });
    }, gapFollowupFailureMessage);

  const toggleClaim = (claimId) => {
    setDraftKeys({});
    setSelectedClaimIds((current) => (current.includes(claimId) ? current.filter((id) => id !== claimId) : [...current, claimId]));
  };
  const unadmittedClaimIds = claims.items
    .filter((claim) => !claimDraftAdmitted(claim, claimDiagnostics.get(claim.claimId)))
    .map((claim) => claim.claimId);
  const readiness = internalDraftReadiness({
    canGenerate: access.generateDrafts, engagementId, selectedClaimIds,
    claims: claims.status === "success" ? claims.items : undefined, claimsComplete: claims.complete, unadmittedClaimIds,
  });
  const kindOfClaim = (claimId) => claimKind(claims.items.find((claim) => claim.claimId === claimId));
  const selectionUse = selectionReportUsability(selectedClaimIds, useOfClaim, kindOfClaim);
  const [draftsRefreshToken, setDraftsRefreshToken] = useState(0);
  // Read-only: one client-safe internal traceability GET per selected claim.
  const explainDraftFailure = async (result, claimIds) => {
    const canGenerateGapFollowups = access.generateClaimGapFollowups;
    if (!isInternalDraftTraceabilityRefusal(result) || access.readClaimTraceabilityDiagnostics !== true) {
      return internalDraftFailureMessage(result, { canGenerateGapFollowups });
    }
    const reads = [];
    for (const claimId of claimIds) {
      reads.push({ claimId, result: await getJson(claimTraceabilityPath(organizationId, claimId, "internal")) });
    }
    const diagnosis = internalDraftTraceabilityDiagnosis(reads);
    const claim = claims.items.find((item) => item.claimId === diagnosis.claimId);
    return internalDraftFailureMessage(result, {
      canGenerateGapFollowups,
      diagnosis,
      claimLabel: claim?.claimStatement || claim?.evidenceStatement || "",
    });
  };
  const generate = (contentType, pathBuilder) => {
    if (!readiness.ready) return;
    // One idempotency key per request: a retry after a failed or interrupted
    // request replays it, and the key is retired once a draft is returned, so
    // the next click is an intentionally new draft.
    const idempotencyKey = draftKeys[contentType] || `client-${contentType}-${globalThis.crypto.randomUUID()}`;
    setDraftKeys((current) => ({ ...current, [contentType]: idempotencyKey }));
    return runWrite(`generate:${contentType}`, pathBuilder(organizationId),
      internalDraftRequestBody({ claimIds: selectedClaimIds, idempotencyKey, engagementId }),
      (data) => {
        setDraftKeys((current) => {
          const { [contentType]: _retired, ...rest } = current;
          return rest;
        });
        setLastDraft(internalDraftResultSummary(data, contentType));
        // The persisted draft is read back and opened below, never shown from this response.
        setDraftsRefreshToken((value) => value + 1);
      },
      (result) => explainDraftFailure(result, [...selectedClaimIds]));
  };

  const proposedByEvidence = claimIdsByEvidenceItem(claims.items);

  // One open record-count measurement panel (Plan A Prompt 8), for one
  // current source version of this organization.
  const [measuring, setMeasuring] = useState(null);
  useEffect(() => { setMeasuring(null); }, [organizationId, engagementId]);
  const openMeasurement = measuring && measuring.contextKey === contextKey ? measuring.sourceVersionId : null;
  const [reviewing, setReviewing] = useState(null);
  useEffect(() => { setReviewing(null); }, [organizationId, engagementId]);
  const openReview = reviewing && reviewing.contextKey === contextKey ? reviewing.claimId : null;

  // One open source-preparation panel, keyed to organization + Project + file.
  const [preparation, setPreparation] = useState(null);
  useEffect(() => { setPreparation(null); }, [organizationId, engagementId]);
  const openPreparation = preparation && preparation.contextKey === contextKey ? preparation : null;
  const preparationRecorded = () => {
    onPipelineRefresh?.();
    refresh();
    if (activeImpactFlow && openPreparation?.file?.intakeFileId === activeImpactFlow.intakeFileId) {
      resumeUseForImpact(activeImpactFlow.intakeFileId);
    }
  };
  const continuePreparation = (file) => runWrite(`continue:${file.intakeFileId}`,
    intakeFileSourceCandidatePath(organizationId, engagementId, file.intakeFileId), {},
    (data) => {
      setNotice({ kind: "success", text: sourcePreparationContinuationMessage(data) });
      onPipelineRefresh?.();
    }, sourcePreparationContinuationFailureMessage);
  const pipelineReady = isPipelineSuccess(pipeline?.status) && Boolean(pipeline?.data);
  const preparationFiles = pipelineReady ? sourcePreparationFiles(pipeline.data, access) : [];
  const reviewedFiles = pipelineReady ? processingPermissionReviewFiles(pipeline.data, access) : [];
  // A corrected decision refreshes the pipeline and the reads; it never runs
  // a processing step (Use for impact stays the person's separate action).
  const permissionsRecorded = () => {
    onPipelineRefresh?.();
    refresh();
  };

  // --- Use for impact ---------------------------------------------------------
  const [impactFlow, setImpactFlow] = useState(null);
  useEffect(() => { setImpactFlow(null); }, [organizationId, engagementId]);
  const activeImpactFlow = impactFlow && impactFlow.contextKey === contextKey ? impactFlow : null;

  const rereadPipelineFile = async (intakeFileId) => {
    const result = await getJson(clientEvidencePipelinePath(organizationId, engagementId));
    const data = result.statusCode === 200 && result.body?.ok ? projectClientEvidencePipeline(result.body.data, engagementId) : null;
    onPipelineRefresh?.();
    return data ? data.files.find((entry) => entry.intakeFileId === intakeFileId) || null : null;
  };
  // P2-01 for the file's own current source version, resolved through the
  // file -> candidate -> detail reads (never a browser guess).
  const extractForFile = async (intakeFileId) => {
    const lookup = await getJson(intakeFileSourceCandidatePath(organizationId, engagementId, intakeFileId));
    const candidateId = lookup.statusCode === 200 && lookup.body?.ok ? lookup.body.data?.intake_source_candidate_id : null;
    if (!isRouteUuid(candidateId)) return { ok: false, text: errorText(lookup) };
    const detail = await getJson(sourceCandidateDetailPath(organizationId, candidateId));
    const version = detail.statusCode === 200 && detail.body?.ok ? detail.body.data?.source_version : null;
    if (!version || version.is_current !== true || !isRouteUuid(version.source_version_id)) return { ok: false, text: errorText(detail) };
    const extracted = await postJson(evidenceExtractionPath(organizationId, version.source_version_id), {});
    return extracted.statusCode === 200 && extracted.body?.ok ? { ok: true } : { ok: false, text: errorText(extracted) };
  };
  const continueForFile = async (intakeFileId) => {
    const continued = await postJson(intakeFileSourceCandidatePath(organizationId, engagementId, intakeFileId), {});
    return continued.statusCode === 200 && continued.body?.ok
      ? { ok: true }
      : { ok: false, text: sourcePreparationContinuationFailureMessage(continued) };
  };
  const runUseForImpact = async (startFile) => {
    const requestContext = contextRef.current;
    setImpactFlow({ contextKey, intakeFileId: startFile.intakeFileId });
    setPending(`impact:${startFile.intakeFileId}`);
    setNotice(null);
    let file = startFile;
    try {
      for (let step = 0; step < USE_FOR_IMPACT_MAX_STEPS; step += 1) {
        const next = useForImpactStep(file, access);
        if (next.kind === "review_sensitivity" || next.kind === "confirm_promotion") {
          setPreparation({ contextKey, kind: next.kind === "review_sensitivity" ? "sensitivity" : "source", file });
          setNotice({ kind: "info", text: USE_FOR_IMPACT_MESSAGES[next.kind] });
          return;
        }
        if (next.kind === "done" || next.kind === "blocked") {
          setImpactFlow(null);
          setNotice(next.kind === "done" ? { kind: "success", text: USE_FOR_IMPACT_MESSAGES.done } : { kind: "warning", text: next.text });
          refresh();
          return;
        }
        const outcome = next.kind === "continue" ? await continueForFile(file.intakeFileId) : await extractForFile(file.intakeFileId);
        if (contextRef.current !== requestContext) return;
        refresh();
        if (!outcome.ok) {
          setImpactFlow(null);
          setNotice({ kind: "warning", text: `${outcome.text} ${USE_FOR_IMPACT_MESSAGES.interrupted}` });
          return;
        }
        const reread = await rereadPipelineFile(file.intakeFileId);
        if (contextRef.current !== requestContext) return;
        if (!reread) {
          setImpactFlow(null);
          setNotice({ kind: "warning", text: USE_FOR_IMPACT_MESSAGES.interrupted });
          return;
        }
        file = reread;
      }
      setImpactFlow(null);
      setNotice({ kind: "warning", text: USE_FOR_IMPACT_MESSAGES.interrupted });
    } finally {
      if (contextRef.current === requestContext) setPending("");
    }
  };
  // A human step recorded inside the flow resumes it from the re-read state.
  const resumeUseForImpact = async (intakeFileId) => {
    const requestContext = contextRef.current;
    const file = await rereadPipelineFile(intakeFileId);
    if (contextRef.current !== requestContext || !file) return;
    const next = useForImpactStep(file, access);
    if (next.kind === "confirm_promotion" && preparation?.kind === "source") return; // the open panel already shows it
    if (next.kind !== "review_sensitivity") setPreparation(null);
    runUseForImpact(file);
  };

  return (
    <div data-client-evidence-workflow="">
      {notice ? (
        <div className={`alert alert-${notice.kind} py-2 small`} role="status" data-client-workflow-notice="">{notice.text}</div>
      ) : null}

      {access.reviewSensitivity || access.promoteSource ? (
        <div className="admin-card mb-3" data-client-source-preparation="">
          <h5 className="mb-2">Source preparation</h5>
          <div className="small text-muted mb-2">
            Before evidence can be extracted, each uploaded file needs its sensitivity &amp; allowed-use review and then a source
            review that promotes it as a governed source. Promotion keeps the file&rsquo;s recorded restrictions and approves no
            evidence, claim, or external use.
          </div>
          {!engagementId ? <div className="text-muted small">Select a Project to see its files.</div> : null}
          {engagementId && pipeline?.status === "error" ? (
            <div className="alert alert-warning py-2 small">This Project&rsquo;s file status could not be loaded.</div>
          ) : null}
          {engagementId && !pipelineReady && pipeline?.status !== "error" ? <div className="text-muted small">Loading this Project&rsquo;s files...</div> : null}
          {engagementId && pipelineReady && preparationFiles.length === 0 ? (
            <div className="text-muted small">No files in this Project are waiting for sensitivity review or source promotion.</div>
          ) : null}
          {engagementId && preparationFiles.length > 0 ? (
            <ul className="list-group">
              {preparationFiles.map((file) => {
                const current = file.stages.find((entry) => entry.key === file.currentStage);
                return (
                  <li key={file.intakeFileId} className="list-group-item small" data-client-preparation-file={file.intakeFileId}
                    data-client-preparation-next={file.nextAction}>
                    <div className="fw-semibold">{file.safeFilename}</div>
                    <div className="text-muted">
                      {PIPELINE_STAGE_LABELS[file.currentStage]}: {current ? stageStatusLabel(current) : "Unknown"}
                    </div>
                    <div className="mt-1" data-client-preparation-guidance="">{sourcePreparationGuidance(file, access)}</div>
                    {isUseForImpactCandidate(file, access) ? (
                      <button type="button" className="btn btn-sm btn-primary mt-1 me-2" data-client-use-for-impact={file.intakeFileId}
                        disabled={Boolean(pending)} onClick={() => runUseForImpact(file)}>
                        {pending === `impact:${file.intakeFileId}` ? "Working..." : "Use for impact"}
                      </button>
                    ) : null}
                    {file.currentStage === "sensitivity_review" && access.reviewSensitivity ? (
                      <button type="button" className="btn btn-sm btn-outline-primary mt-1" data-client-open-sensitivity-review={file.intakeFileId}
                        onClick={() => setPreparation({ contextKey, kind: "sensitivity", file })}>
                        Review sensitivity &amp; allowed use
                      </button>
                    ) : null}
                    {file.currentStage === "source_review" && file.nextAction === "continue_source_preparation" && access.promoteSource ? (
                      <button type="button" className="btn btn-sm btn-outline-primary mt-1" data-client-continue-source-preparation={file.intakeFileId}
                        disabled={Boolean(pending)} onClick={() => continuePreparation(file)}>
                        {pending === `continue:${file.intakeFileId}` ? "Continuing..." : "Continue source preparation"}
                      </button>
                    ) : null}
                    {file.currentStage === "source_review" && file.nextAction === "promote_source" && access.promoteSource ? (
                      <button type="button" className="btn btn-sm btn-outline-primary mt-1" data-client-open-source-review={file.intakeFileId}
                        onClick={() => setPreparation({ contextKey, kind: "source", file })}>
                        Review &amp; promote source
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {openPreparation?.kind === "sensitivity" ? (
            <ClientSensitivityReviewPanel
              key={`${contextKey}:sensitivity:${openPreparation.file.intakeFileId}`}
              organizationId={organizationId}
              intakeFileId={openPreparation.file.intakeFileId}
              safeFilename={openPreparation.file.safeFilename}
              onClose={() => setPreparation(null)}
              onDecisionRecorded={preparationRecorded}
            />
          ) : null}
          {openPreparation?.kind === "source" ? (
            <ClientSourcePromotionPanel
              key={`${contextKey}:source:${openPreparation.file.intakeFileId}`}
              organizationId={organizationId}
              engagementId={engagementId}
              intakeFileId={openPreparation.file.intakeFileId}
              safeFilename={openPreparation.file.safeFilename}
              onClose={() => setPreparation(null)}
              onDecisionRecorded={preparationRecorded}
            />
          ) : null}
        </div>
      ) : null}

      {access.reviewSensitivity ? (
        <div className="admin-card mb-3" data-client-processing-permissions="">
          <h5 className="mb-2">Processing permissions</h5>
          <div className="small text-muted mb-2">
            Files whose sensitivity &amp; allowed-use review is complete. If a recorded decision is wrong - for example, AI
            processing was recorded as not permitted by mistake - review the file&rsquo;s processing permissions again. A new
            review supersedes the current decision, which stays in the file&rsquo;s history. Ordinary processing does not need
            this, and recording a review runs no processing.
          </div>
          {!engagementId ? <div className="text-muted small">Select a Project to see its files.</div> : null}
          {engagementId && pipeline?.status === "error" ? (
            <div className="alert alert-warning py-2 small">This Project&rsquo;s file status could not be loaded.</div>
          ) : null}
          {engagementId && !pipelineReady && pipeline?.status !== "error" ? <div className="text-muted small">Loading this Project&rsquo;s files...</div> : null}
          {engagementId && pipelineReady && reviewedFiles.length === 0 ? (
            <div className="text-muted small">No file in this Project has a completed sensitivity &amp; allowed-use review yet.</div>
          ) : null}
          {engagementId && reviewedFiles.length > 0 ? (
            <ul className="list-group">
              {reviewedFiles.map((file) => {
                const current = file.stages.find((entry) => entry.key === file.currentStage);
                return (
                  <li key={file.intakeFileId} className="list-group-item small" data-client-reviewed-file={file.intakeFileId}>
                    <div className="fw-semibold">{file.safeFilename}</div>
                    <div className="text-muted">
                      Sensitivity review: Complete
                      {file.currentStage ? ` · ${PIPELINE_STAGE_LABELS[file.currentStage]}: ${current ? stageStatusLabel(current) : "Unknown"}` : ""}
                    </div>
                    <button type="button" className="btn btn-sm btn-outline-secondary mt-1" data-client-review-processing-permissions={file.intakeFileId}
                      onClick={() => setPreparation({ contextKey, kind: "permissions", file })}>
                      Review processing permissions
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {openPreparation?.kind === "permissions" ? (
            <ClientSensitivityReviewPanel
              key={`${contextKey}:permissions:${openPreparation.file.intakeFileId}`}
              organizationId={organizationId}
              intakeFileId={openPreparation.file.intakeFileId}
              safeFilename={openPreparation.file.safeFilename}
              purpose="processing_permissions"
              onClose={() => setPreparation(null)}
              onDecisionRecorded={permissionsRecorded}
            />
          ) : null}
        </div>
      ) : null}

      <div className="admin-card mb-3">
        <h5 className="mb-2">Data Sources</h5>
        <div className="small text-muted mb-2">
          Sources appear here once an uploaded file has been reviewed and promoted. Extract evidence from a source version
          to see what it supports, or count its records under your own definition of what one record represents.
        </div>
        {sources.status === "loading" ? <div className="text-muted small">Loading sources...</div> : null}
        {sources.status === "error" ? <div className="alert alert-warning py-2 small">Sources could not be loaded. {sources.message}</div> : null}
        {sources.status === "success" && sources.items.length === 0 ? (
          <div className="text-muted small">No promoted sources yet. Upload data in Files; each file is reviewed before it becomes a source.</div>
        ) : null}
        {sources.status === "success" && sources.items.length > 0 ? (
          <ul className="list-group">
            {sources.items.map((source) => (
              <li key={source.sourceId} className="list-group-item" data-client-source={source.sourceId}>
                <div className="fw-semibold small">{source.sourceCode}</div>
                <div className="small text-muted">{String(source.reviewedSourceType || "").replace(/_/g, " ")}</div>
                {source.sourceVersions.map((version) => (
                  <div key={version.sourceVersionId} className="d-flex flex-wrap align-items-center gap-2 mt-1 small" data-client-source-version={version.sourceVersionId}>
                    <span className="text-break">Source version: {version.sourceVersionId}</span>
                    {version.safeFilename ? <span className="text-muted">File: {version.safeFilename}</span> : null}
                    <span>{version.isCurrent ? "Current version" : "Earlier version"}</span>
                    {version.profileFormat === "xlsx" ? (
                      <span data-client-xlsx-measurement-readiness={version.hasXlsxRecordCountBasis ? "basis_recorded" : "new_version_required"}>
                        {version.hasXlsxRecordCountBasis
                          ? "XLSX worksheet basis recorded; use Count records and choose the worksheet to count."
                          : "XLSX measurement basis missing; this historical profile cannot be changed."}
                      </span>
                    ) : null}
                    {version.profileFormat === "xlsx" && !version.hasXlsxRecordCountBasis && version.safeFilename
                      && version.engagementId === engagementId && canUploadNewIntakeVersion && typeof onContinueXlsxInFiles === "function" ? (
                      <button type="button" className="btn btn-sm btn-outline-primary" data-client-continue-xlsx={version.sourceVersionId}
                        onClick={() => onContinueXlsxInFiles({ sourceVersionId: version.sourceVersionId, safeFilename: version.safeFilename })}>
                        Prepare workbook for counting
                      </button>
                    ) : null}
                    {access.extractEvidence && isRouteUuid(version.sourceVersionId) ? (
                      <button type="button" className="btn btn-sm btn-outline-primary" disabled={Boolean(pending)}
                        onClick={() => extract(version.sourceVersionId)}>
                        {pending === `extract:${version.sourceVersionId}` ? "Extracting..." : "Extract evidence"}
                      </button>
                    ) : null}
                    {access.recordSourceMeasurement && version.isCurrent && isRouteUuid(version.sourceVersionId) ? (
                      <button type="button" className="btn btn-sm btn-outline-secondary" data-client-open-source-measurement={version.sourceVersionId}
                        onClick={() => setMeasuring({ contextKey, sourceVersionId: version.sourceVersionId })}>
                        Count records
                      </button>
                    ) : null}
                    {openMeasurement === version.sourceVersionId ? (
                      <div className="w-100">
                        <ClientSourceMeasurementPanel key={`${contextKey}:${version.sourceVersionId}`} organizationId={organizationId}
                          sourceVersionId={version.sourceVersionId} canProposeClaim={access.proposeClaim}
                          initialWorksheetKey={measuring.worksheetKey || ""}
                          onWorksheetChange={(worksheetKey) => setMeasuring((current) => (current ? { ...current, worksheetKey } : current))}
                          onClose={() => setMeasuring(null)} onRecorded={refresh} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="admin-card mb-3">
        <h5 className="mb-2">Evidence</h5>
        <div className="small text-muted mb-2">
          Evidence from your sources: record counts you defined with Count records, and structural facts (which columns a source
          has). Whether a claim can be used in internal reports now is shown on each claim below, from its current eligibility.
          Proposing a claim approves nothing for funders or the public.
        </div>
        {evidence.status === "loading" ? <div className="text-muted small">Loading evidence...</div> : null}
        {evidence.status === "error" ? <div className="alert alert-warning py-2 small">Evidence could not be loaded. {evidence.message}</div> : null}
        {evidence.status === "success" && evidence.items.length === 0 && evidence.complete ? <div className="text-muted small">No evidence yet.</div> : null}
        {evidence.status === "success" && evidence.items.length > 0 ? (
          <ul className="list-group">
            {evidence.items.map((item) => {
              const proposed = proposedByEvidence.get(item.evidenceItemId) || [];
              return (
                <li key={item.evidenceItemId} className="list-group-item small" data-client-evidence={item.evidenceItemId}>
                  <div className="text-break">{item.statement || "Statement not available"}</div>
                  <div className="text-muted mt-1" data-client-evidence-kind={claimKind(item)}>
                    {claimKind(item) === "measurement" ? "Record-count measurement" : null}
                    {claimKind(item) === "structural" ? "Structural fact (which columns a source has)" : null}
                    {claimKind(item) === "other" ? `Recorded review status: ${item.evidenceReviewStatus || "unknown"}` : null}
                    {item.sensitivityLevel ? ` · Sensitivity: ${item.sensitivityLevel}` : ""}
                  </div>
                  {proposed.length > 0 ? <div className="mt-1">Claim proposed</div> : null}
                  {access.proposeClaim && proposed.length === 0 ? (
                    <button type="button" className="btn btn-sm btn-outline-primary mt-1" disabled={Boolean(pending)}
                      onClick={() => propose(item.evidenceItemId)}>
                      {pending === `propose:${item.evidenceItemId}` ? "Proposing..." : "Propose claim"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        <LibraryCompleteness read={evidence} noun="evidence items" />
      </div>

      <div className="admin-card mb-3">
        <h5 className="mb-2">Claims for internal drafts</h5>
        <div className="small text-muted mb-2">
          Measured findings come first: a report needs at least one. Structural facts only say which columns a source has and are not
          offered as impact findings. Using a claim here does not approve it for funders or the public.
          {access.generateClaimGapFollowups
            ? " Generate a claim's gap follow-ups before drafting from it; they record open questions and resolve nothing."
            : null}
        </div>
        {claims.status === "loading" ? <div className="text-muted small">Loading claims...</div> : null}
        {claims.status === "error" ? <div className="alert alert-warning py-2 small">Claims could not be loaded. {claims.message}</div> : null}
        {claims.status === "success" && claims.items.length === 0 && claims.complete ? <div className="text-muted small">No claims yet. Propose one from evidence above.</div> : null}
        {claims.status === "success" && claims.items.length > 0 ? (
          <ul className="list-group">
            {orderedClaims.map((claim) => {
              const selectability = claimInternalDraftSelectability(claim);
              const kind = claimKind(claim);
              const use = useOfClaim(claim.claimId);
              const diagnosis = claimDiagnostics.get(claim.claimId);
              return (
                <li key={claim.claimId} className="list-group-item small" data-client-claim={claim.claimId}
                  data-client-claim-kind={kind} data-client-claim-internal-use={use}>
                  <div className="text-break">
                    {kind === "measurement" ? <span className="badge text-bg-primary me-1">Measured finding</span> : null}
                    {kind === "structural" ? <span className="badge text-bg-light me-1">Structural fact</span> : null}
                    {claim.claimStatement || claim.evidenceStatement || "Statement not available"}
                  </div>
                  {/* The server's current internal eligibility; the stored review
                      status is not shown as a pending step it may no longer be. */}
                  {kind !== "structural" && use === "usable" ? (
                    <div className="text-success mt-1" data-client-claim-usable="">Usable in internal reports now. No further review is needed for internal use.</div>
                  ) : null}
                  {kind !== "structural" && use === "not_usable" ? (
                    <div className="mt-1" data-client-claim-not-usable="">{claimNotUsableMessage(diagnosis)}</div>
                  ) : null}
                  {kind !== "structural" && use === "unknown" ? (
                    <div className="text-muted mt-1" data-client-claim-use-unknown="">
                      {CLAIM_USE_UNKNOWN_MESSAGE}
                      {access.readClaimTraceabilityDiagnostics && !diagnosedOnceRef.current.has(claim.claimId) ? (
                        <button type="button" className="btn btn-sm btn-link p-0 ms-1 align-baseline" data-client-check-claim-use={claim.claimId}
                          onClick={() => { diagnosedOnceRef.current.add(claim.claimId); diagnoseClaims([claim.claimId]); }}>
                          Check internal use
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {access.generateDrafts && selectability.selectable ? (
                    <label className="form-check mt-1">
                      <input className="form-check-input" type="checkbox" checked={selectedClaimIds.includes(claim.claimId)}
                        onChange={() => toggleClaim(claim.claimId)} />
                      <span className="form-check-label">Use in an internal draft</span>
                    </label>
                  ) : null}
                  {access.generateClaimGapFollowups && (selectability.selectable || selectability.reason === "structural_fact") ? (
                    <button type="button" className="btn btn-sm btn-outline-secondary mt-1" disabled={Boolean(pending)}
                      data-client-claim-gap-followups={claim.claimId} onClick={() => generateGapFollowups(claim.claimId)}>
                      {pending === `gaps:${claim.claimId}` ? "Generating..." : "Generate gap follow-ups"}
                    </button>
                  ) : null}
                  {gapFollowupsByClaim[claim.claimId] ? <div className="mt-1 text-muted">{gapFollowupsByClaim[claim.claimId]}</div> : null}
                  {access.reviewMeasuredClaimFactualContent && kind !== "structural" && openReview !== claim.claimId && isRouteUuid(claim.claimId) ? (
                    <button type="button" className="btn btn-sm btn-outline-primary mt-1 ms-1" data-client-open-measured-claim-review={claim.claimId}
                      onClick={() => setReviewing({ contextKey, claimId: claim.claimId })}>
                      {use === "not_usable" ? "View review status" : "View measurement"}
                    </button>
                  ) : null}
                  {!selectability.selectable ? <div className="mt-1">{claimSelectabilityMessage(selectability.reason)}</div> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        <LibraryCompleteness read={claims} noun="claims" />
        {openReview ? (
          // Outside the list, so the list's own refresh after a decision does not unmount it.
          <ClientMeasuredClaimReviewPanel key={`${contextKey}:${openReview}`} organizationId={organizationId} claimId={openReview}
            onClose={() => setReviewing(null)} onRecorded={refresh} />
        ) : null}
      </div>

      {access.generateDrafts ? (
        <div className="admin-card mb-3">
          <h5 className="mb-2">Internal drafts</h5>
          {!readiness.ready ? <div className="small mb-2" data-client-draft-readiness={readiness.reason}>{INTERNAL_DRAFT_READINESS_MESSAGES[readiness.reason]}</div> : null}
          {readiness.ready && !selectionUse.immediatelyUsable ? (
            <div className="small mb-2" data-client-draft-selection-usability={selectionUse.notUsable.length > 0 ? "not_usable" : "unknown"}>
              {selectionReportUsabilityMessage(selectionUse)}
            </div>
          ) : null}
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-primary" disabled={!readiness.ready || Boolean(pending)}
              onClick={() => generate("evidence_summary", createEvidenceSummaryPath)}>
              {pending === "generate:evidence_summary" ? "Generating..." : "Generate internal evidence summary"}
            </button>
            <button type="button" className="btn btn-sm btn-outline-primary" disabled={!readiness.ready || Boolean(pending)}
              onClick={() => generate("impact_narrative", createImpactNarrativePath)}>
              {pending === "generate:impact_narrative" ? "Generating..." : "Generate internal impact narrative"}
            </button>
          </div>
          {lastDraft ? (
            <div className="small mt-2" data-client-generated-draft={lastDraft.generatedContentDraftId}>
              <div className="fw-semibold">
                {DRAFT_LABELS[lastDraft.contentType]} {lastDraft.replayed ? "already created" : "created"}: {lastDraft.blockCount} block(s) citing {lastDraft.citedClaimCount} claim(s).
              </div>
              <div>
                Internal use only. {access.readInternalDrafts
                  ? "It is opened from your saved drafts below; when every cited claim is usable for internal use it is ready to read and download there."
                  : "It appears under Generated Drafts once Get Kinder has reviewed it."}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {access.readInternalDrafts ? (
        <div className="admin-card mb-3" data-client-internal-drafts="">
          <h5 className="mb-2">Your internal drafts</h5>
          <div className="small text-muted mb-2">
            Drafts generated for this Project. A draft whose cited claims are usable for internal use, from sources cleared for internal
            use, is your organization&apos;s internal report: open or download it here, with no further review or release step. Drafts
            from high-risk sources wait for Get Kinder. Internal use only: nothing here approves a draft for funders or the public.
          </div>
          <ClientInternalDrafts organizationId={organizationId} engagementId={engagementId} claims={claims.items}
            refreshToken={draftsRefreshToken} focusDraftId={lastDraft?.generatedContentDraftId || null}
            canReadReleasedReports={access.readReleasedInternalReports === true}
            canReadInternalReports={access.readInternalDrafts === true} />
        </div>
      ) : null}
    </div>
  );
}

// Whether an organization library read holds everything the server has; an
// incomplete read keeps its cursor and continues on request.
function LibraryCompleteness({ read, noun }) {
  if (read.status !== "success" || (read.complete && !read.message)) return null;
  return (
    <div className="small mt-2" data-client-library-incomplete={noun}>
      {read.message ? <div className="alert alert-warning py-2 small mb-1">More {noun} could not be loaded. {read.message}</div> : null}
      {!read.complete ? (
        <>
          <span className="me-2">{read.items.length} {noun} loaded; your organization has more.</span>
          <button type="button" className="btn btn-sm btn-outline-secondary" data-client-library-load-more={noun}
            disabled={read.loadingMore} onClick={read.loadMore}>
            {read.loadingMore ? "Loading..." : `Load more ${noun}`}
          </button>
        </>
      ) : null}
    </div>
  );
}
