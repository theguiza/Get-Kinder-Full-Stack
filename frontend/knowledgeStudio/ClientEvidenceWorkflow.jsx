import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  claimGapFollowupsPath,
  claimLibraryCandidatesPath,
  claimProposalPath,
  claimTraceabilityPath,
  clientImpactFactsPath,
  createEvidenceSummaryPath,
  createFreeImpactAssessmentPath,
  createImpactNarrativePath,
  errorText,
  canOfferEvidenceExtraction,
  EXTRACTION_UNAVAILABLE_MESSAGES,
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
  claimDraftAdmission,
  claimInternalUse,
  claimKind,
  claimNotUsableMessage,
  claimUseDiagnosis,
  claimUsePresentation,
  claimsToDiagnose,
  claimNeedsGapPreparation,
  claimProposalResultMessage,
  claimProposalRunMessage,
  claimProposalTargets,
  claimSelectabilityMessage,
  claimSourceVersionUnavailable,
  currentRecordCountRecoveryVersion,
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
import { CategoryHeading, Disclosure, FindingMeta, FindingText, ImpactView, ViewPane } from "./KnowledgeStudioViews.jsx";
import {
  FINDING_CATEGORIES, buildFindings, claimRestatesFinding, findingCount, findingDisplay, projectFindingsState, projectIsConfirmedEmpty, shortStatement,
} from "./knowledgeStudioViewsLogic.js";

const DRAFT_LABELS = Object.freeze({
  evidence_summary: "Internal evidence summary",
  free_impact_assessment: "Free Impact Assessment",
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
// "Use for impact" claim proposal reads the whole Evidence Library (25 per
// page) before proposing; beyond this it stops and says so.
const CLAIM_PROPOSAL_EVIDENCE_PAGES = 200;
// Per-claim P2-06 diagnostics read automatically per refresh; any further
// claim offers its own "Check internal use".
const CLAIM_DIAGNOSES_PER_REFRESH = 25;
const projectInternalUse = (data) => {
  const facts = projectClientImpactFacts(data);
  return facts ? { claimIds: new Set(facts.items.map((item) => item.claimId)), truncated: facts.truncated } : null;
};

// scopeKey: the Project a read is scoped to ("" for the organization-wide
// read). A different scope is a different read: its items are never shown
// for another Project, and a response for the previous scope is discarded.
function useOrganizationRead(organizationId, path, project, refreshToken, cursorKey = null, scopeKey = "") {
  const [state, setState] = useState({ organizationId: "", scopeKey: "", status: "idle", items: [], complete: false, nextCursor: null });
  const keyRef = useRef("");
  // `cursorKey` null: one unpaged read, projected as a whole.
  const pagesFrom = useCallback(async (requestKey, cursor) => {
    if (cursorKey === null) {
      const result = await getJson(path(organizationId, null));
      if (keyRef.current !== requestKey) return { status: "superseded" };
      if (result.statusCode !== 200 || !result.body?.ok) return { status: "error", result };
      // The Sources projection tolerates a missing array for its normal
      // display. Such a response cannot prove an empty Project.
      const complete = project !== projectOrganizationSources
        || (Array.isArray(result.body.data?.sources) && result.body.data.truncated !== true);
      return { status: "success", items: project(result.body.data), complete, nextCursor: null };
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
    const requestKey = `${organizationId}:${scopeKey}:${refreshToken}`;
    keyRef.current = requestKey;
    setState((current) => ({
      organizationId, scopeKey, status: "loading", items: current.organizationId === organizationId && current.scopeKey === scopeKey ? current.items : [], complete: false, nextCursor: null,
    }));
    (async () => {
      const read = await pagesFrom(requestKey, null);
      if (read.status === "superseded") return;
      if (read.status === "error") {
        setState({ organizationId, scopeKey, status: "error", items: [], complete: false, nextCursor: null, message: errorText(read.result) });
        return;
      }
      setState({ organizationId, scopeKey, status: "success", items: read.items, complete: read.complete, nextCursor: read.nextCursor, requestKey });
    })();
    return () => { keyRef.current = ""; };
  }, [organizationId, scopeKey, refreshToken, pagesFrom]);
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
  const visible = state.organizationId === organizationId && state.scopeKey === scopeKey ? state : { organizationId, scopeKey, status: "loading", items: [], complete: false, nextCursor: null };
  // "loading_more" keeps the loaded items on screen.
  return { ...visible, status: visible.status === "loading_more" ? "success" : visible.status, loadingMore: visible.status === "loading_more", loadMore };
}

/**
 * The organization administrator's evidence-to-draft workflow in the client
 * Knowledge Studio (owner decision 2026-10-18). Since the four-view refactor
 * (owner direction 2026-11-06) it is mounted once for the whole studio as the
 * shared controller of Impact, Evidence, Sources and Drafts, and only when
 * the access-capabilities read admits at least one of
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
 * whatever is persisted. Owner decision 2026-11-05: a file whose evidence has
 * no claim yet (propose_claims) is taken one step further - P2-03 for each
 * claimable evidence item of the file's current source version (structural
 * column facts skipped), each followed by its P2-04 gap preparation - and the
 * flow ends with counts; no evidence or claim review is recorded.
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
export default function ClientEvidenceWorkflow({
  organizationId, engagementId, access, pipeline, onPipelineRefresh, canUploadNewIntakeVersion, onContinueXlsxInFiles,
  // Four-view Knowledge Studio (owner direction 2026-11-06): this one mounted
  // controller presents Impact, Evidence, Sources and Drafts; the parent owns
  // the view selection and passes its own sections for each view.
  view = "sources", visitedViews = ["impact", "evidence", "sources", "drafts"], onSelectView, projectName = "",
  extraAttention = [], impactAfter = null, evidenceAfter = null, sourcesBefore = null, sourcesAfter = null, draftsAfter = null,
}) {
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = () => setRefreshToken((value) => value + 1);
  // Owner direction 2026-11-06: with a Project selected, Sources, Evidence and
  // Claims are that Project's working view (its own files plus evidence
  // explicitly reused in its drafts), filtered on the server before paging.
  // With no Project, they remain the organization-wide library.
  // "Include evidence from other Projects" reads the organization library so
  // a claim can be reused in this Project's draft (a view choice, never an
  // approval); drafting still belongs to the selected Project.
  const [includeOrganizationLibrary, setIncludeOrganizationLibrary] = useState(false);
  useEffect(() => { setIncludeOrganizationLibrary(false); }, [organizationId, engagementId]);
  const scope = isRouteUuid(engagementId) && !includeOrganizationLibrary ? engagementId : "";
  const scopedSourcesPath = useCallback((org) => organizationSourcesPath(org, scope || null), [scope]);
  const scopedEvidencePath = useCallback((org, after) => evidenceLibraryCandidatesPath(org, after, scope || null), [scope]);
  const scopedClaimsPath = useCallback((org, after) => claimLibraryCandidatesPath(org, after, scope || null), [scope]);
  const sources = useOrganizationRead(organizationId, scopedSourcesPath, projectOrganizationSources, refreshToken, null, scope);
  const evidence = useOrganizationRead(organizationId, scopedEvidencePath, projectEvidenceLibraryItems, refreshToken, EVIDENCE_CURSOR, scope);
  const claims = useOrganizationRead(organizationId, scopedClaimsPath, projectCandidateClaims, refreshToken, CLAIM_CURSOR, scope);
  // Authoritative internal usability of each claim (P2-08 / P2-06, internal audience).
  const internalUse = useOrganizationRead(organizationId, clientImpactFactsPath, projectInternalUse, refreshToken);
  const internalUseIndex = internalUse.status === "success" ? internalUse.items : null;

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
    // A write still in flight for the previous Project discards its own
    // result (runWrite's context check); its pending label must not keep this
    // Project's controls disabled.
    setPending("");
  }, [organizationId, engagementId]);

  // Each claim's own P2-06 internal evaluation (the client-safe traceability
  // diagnostic), for the claims the impact-facts read does not establish as
  // usable: a claim it left out of a truncated read, or one it reports as not
  // usable (to say why). Read-only; cleared on every refresh and organization.
  const [diagnostics, setDiagnostics] = useState({ key: "", byClaim: new Map() });
  const diagnosticsKey = `${organizationId}:${refreshToken}`;
  const claimDiagnostics = useMemo(() => diagnostics.key === diagnosticsKey ? diagnostics.byClaim : new Map(), [diagnostics, diagnosticsKey]);
  const diagnoseClaims = useCallback(async (claimIds) => {
    const key = diagnosticsKey;
    const reads = [];
    for (const claimId of claimIds) {
      const result = await getJson(claimTraceabilityPath(organizationId, claimId, "internal"));
      reads.push({ claimId, result });
      const diagnosis = claimUseDiagnosis(result);
      setDiagnostics((current) => {
        if (current.key !== key && current.key !== "") return current;
        const byClaim = new Map(current.key === key ? current.byClaim : []);
        byClaim.set(claimId, diagnosis);
        return { key, byClaim };
      });
    }
    return reads;
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
  const useOfClaim = (claimId) => claimSourceVersionUnavailable(claims.items.find((claim) => claim.claimId === claimId), claimDiagnostics.get(claimId))
    ? "not_usable" : claimInternalUse(claimId, internalUseIndex, claimDiagnostics);
  // Owner Package 3: the server's provisional internal draft admission for
  // each claim ("admitted" | "refused" | "unknown"), never inferred here.
  const draftOfClaim = (claimId) => claimDraftAdmission(claims.items.find((claim) => claim.claimId === claimId), claimDiagnostics.get(claimId));
  useEffect(() => {
    if (claims.status === "success") setSelectedClaimIds((current) => retainSelectableClaimIds(current, claims.items, claimDiagnostics));
  }, [claims.status, claims.items, claimDiagnostics]);

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
    (data) => setNotice({
      kind: Array.isArray(data?.evidenceItems) && data.evidenceItems.length > 0 ? "success" : "warning",
      text: extractionResultMessage(data),
    }));
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
  // Only an explicit server refusal holds the request back; an unconfirmed
  // claim is checked by the server when the draft is generated.
  const unadmittedClaimIds = claims.items
    .filter((claim) => claimDraftAdmission(claim, claimDiagnostics.get(claim.claimId)) === "refused")
    .map((claim) => claim.claimId);
  const unavailableSourceClaimIds = claims.items.filter((claim) => claimSourceVersionUnavailable(claim, claimDiagnostics.get(claim.claimId))).map((claim) => claim.claimId);
  const readiness = internalDraftReadiness({
    canGenerate: access.generateDrafts, engagementId, selectedClaimIds,
    claims: claims.status === "success" ? claims.items : undefined, claimsComplete: claims.complete, unadmittedClaimIds, unavailableSourceClaimIds,
  });
  const assessmentReadiness = internalDraftReadiness({
    canGenerate: access.generateDrafts, engagementId, selectedClaimIds,
    claims: claims.status === "success" ? claims.items : undefined, claimsComplete: claims.complete, unavailableSourceClaimIds,
  });
  const kindOfClaim = (claimId) => claimKind(claims.items.find((claim) => claim.claimId === claimId));
  const selectionUse = selectionReportUsability(selectedClaimIds, useOfClaim, kindOfClaim, draftOfClaim);
  const [draftsRefreshToken, setDraftsRefreshToken] = useState(0);
  // Read-only: one client-safe internal traceability GET per selected claim.
  const explainDraftFailure = async (result, claimIds) => {
    const canGenerateGapFollowups = access.generateClaimGapFollowups;
    const stateConflict = result?.statusCode === 409 && result?.body?.error?.code === "conflict_current_state_changed";
    if ((!isInternalDraftTraceabilityRefusal(result) && !stateConflict) || access.readClaimTraceabilityDiagnostics !== true) {
      return internalDraftFailureMessage(result, { canGenerateGapFollowups });
    }
    const reads = await diagnoseClaims(claimIds);
    const diagnosis = internalDraftTraceabilityDiagnosis(reads);
    const claim = claims.items.find((item) => item.claimId === diagnosis.claimId);
    return internalDraftFailureMessage(result, {
      canGenerateGapFollowups,
      diagnosis,
      claimLabel: claim?.claimStatement || claim?.evidenceStatement || "",
    });
  };
  const generate = (contentType, pathBuilder) => {
    if (!(contentType === "free_impact_assessment" ? assessmentReadiness : readiness).ready) return;
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
        const notices = [];
        if (contentType === "free_impact_assessment" && data.excludedClaims?.length > 0) {
          notices.push(...data.excludedClaims.map((excluded) => {
            const claim = claims.items.find((item) => item.claimId === excluded.claimId);
            return `Selected claim ${claim?.claimStatement || excluded.claimId} was not used as an assertion. ${claimNotUsableMessage({ blockerCodes: excluded.blockerCodes })}`;
          }));
        }
        // Owner direction 2026-11-11: a selected finding whose source does not
        // permit AI processing (or this use) is left out, never silently.
        if (data.permissionExcludedClaims?.length > 0) {
          notices.push(...data.permissionExcludedClaims.map((excluded) => {
            const claim = claims.items.find((item) => item.claimId === excluded.claimId);
            return `Selected finding ${claim?.claimStatement || excluded.claimId} was left out of this draft and was not sent to the AI model: its source's current decision does not permit ${excluded.blockingReason === "allowed_use_not_allowed" ? "this use" : "AI processing"}. The draft was written from the remaining selected evidence.`;
          }));
        }
        if (notices.length > 0) setNotice({ kind: "warning", text: notices.join(" ") });
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
  const measurementPanelRef = useRef(null);
  useEffect(() => {
    if (openMeasurement) measurementPanelRef.current?.scrollIntoView({ block: "center" });
  }, [openMeasurement]);
  // Every governed version by id (display facts only), and the current CSV
  // versions a service-event version may be linked to or a successor may replace.
  const allVersions = sources.items.flatMap((source) => source.sourceVersions.map((version) => ({ ...version, reviewedSourceType: source.reviewedSourceType })));
  const versionsById = new Map(allVersions.map((version) => [version.sourceVersionId, version]));
  const currentVersions = allVersions.filter((version) => version.isCurrent && isRouteUuid(version.sourceVersionId));
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
  const currentVersionForFile = async (intakeFileId) => {
    const lookup = await getJson(intakeFileSourceCandidatePath(organizationId, engagementId, intakeFileId));
    const candidateId = lookup.statusCode === 200 && lookup.body?.ok ? lookup.body.data?.intake_source_candidate_id : null;
    if (!isRouteUuid(candidateId)) return { ok: false, text: errorText(lookup) };
    const detail = await getJson(sourceCandidateDetailPath(organizationId, candidateId));
    const version = detail.statusCode === 200 && detail.body?.ok ? detail.body.data?.source_version : null;
    if (!version || version.is_current !== true || !isRouteUuid(version.source_version_id)) return { ok: false, text: errorText(detail) };
    return { ok: true, sourceVersionId: version.source_version_id };
  };
  const extractForFile = async (intakeFileId) => {
    const version = await currentVersionForFile(intakeFileId);
    if (!version.ok) return version;
    const extracted = await postJson(evidenceExtractionPath(organizationId, version.sourceVersionId), {});
    if (!(extracted.statusCode === 200 && extracted.body?.ok)) return { ok: false, text: errorText(extracted) };
    // An extraction that returns no evidence ends the flow with its reason:
    // running it again would write nothing either.
    const data = extracted.body.data;
    return Array.isArray(data?.evidenceItems) && data.evidenceItems.length > 0
      ? { ok: true }
      : { ok: true, terminal: true, text: extractionResultMessage(data) };
  };
  // Owner decision 2026-11-05: P2-03 for each claimable evidence item of the
  // file's own current source version (the complete Evidence Library read,
  // never a partial one), one at a time, each followed by its P2-04 gap
  // preparation when that is still needed and the actor may run it. Stops at
  // the first refusal without retrying: every request replays idempotently,
  // so using the action again continues from what is persisted.
  const proposeClaimsForFile = async (intakeFileId, isCurrent) => {
    const version = await currentVersionForFile(intakeFileId);
    if (!version.ok) return version;
    const read = await readLibraryPages({
      fetchPage: (after) => getJson(scopedEvidencePath(organizationId, after)),
      project: projectEvidenceLibraryItems,
      cursorKey: EVIDENCE_CURSOR,
      maxPages: CLAIM_PROPOSAL_EVIDENCE_PAGES,
      isCurrent,
    });
    if (read.status === "superseded") return { ok: true, terminal: true, text: "" };
    if (read.status === "error") return { ok: false, text: errorText(read.result) };
    if (!read.complete) {
      return { ok: false, text: "This organization has more evidence than one Use for impact run reads, so claims were not proposed automatically. Propose them from the evidence list below." };
    }
    const targets = claimProposalTargets(read.items, version.sourceVersionId, claimIdsByEvidenceItem(claims.items));
    const run = { targetCount: targets.length, proposed: 0, replayed: 0, prepared: 0, followups: 0, failureText: "" };
    for (const item of targets) {
      const proposal = await postJson(claimProposalPath(organizationId, item.evidenceItemId), {});
      if (!isCurrent()) return { ok: true, terminal: true, text: "" };
      if (!((proposal.statusCode === 200 || proposal.statusCode === 201) && proposal.body?.ok)) {
        run.failureText = errorText(proposal);
        break;
      }
      const data = proposal.body.data;
      if (data?.replayed === true) run.replayed += 1; else run.proposed += 1;
      const claimId = data?.claim?.claim_id;
      if (!claimNeedsGapPreparation(data)) {
        run.prepared += 1;
        run.followups += data.claim_gap_state.client_followup_item_count || 0;
        continue;
      }
      if (!access.generateClaimGapFollowups || !isRouteUuid(claimId)) continue;
      const gaps = await postJson(claimGapFollowupsPath(organizationId, claimId), {});
      if (!isCurrent()) return { ok: true, terminal: true, text: "" };
      if (!(gaps.statusCode === 200 && gaps.body?.ok)) {
        run.failureText = gapFollowupFailureMessage(gaps);
        break;
      }
      run.prepared += 1;
      run.followups += Array.isArray(gaps.body.data?.clientFollowupItems) ? gaps.body.data.clientFollowupItems.length : 0;
    }
    return { ok: true, terminal: true, kind: run.failureText ? "warning" : "success", text: claimProposalRunMessage(run) };
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
        const outcome = next.kind === "continue" ? await continueForFile(file.intakeFileId)
          : next.kind === "propose" ? await proposeClaimsForFile(file.intakeFileId, () => contextRef.current === requestContext)
            : await extractForFile(file.intakeFileId);
        if (contextRef.current !== requestContext) return;
        refresh();
        if (!outcome.ok) {
          setImpactFlow(null);
          setNotice({ kind: "warning", text: `${outcome.text} ${USE_FOR_IMPACT_MESSAGES.interrupted}` });
          return;
        }
        if (outcome.terminal) {
          setImpactFlow(null);
          onPipelineRefresh?.();
          if (outcome.text) setNotice({ kind: outcome.kind || "warning", text: outcome.text });
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

  // --- Four-view presentation (owner direction 2026-11-06) --------------------
  // This one controller owns every read, selection, pending action and
  // idempotency key; the views below only present it, so switching views never
  // resets a selection, repeats a write, or loses an action's feedback.
  const findings = buildFindings({ evidenceItems: evidence.items, claims: claims.items, sources: sources.items });
  const findingsState = projectFindingsState({ engagementId, reads: [evidence, claims], grouped: findings });
  const claimStatusText = (claim) => {
    if (selectedClaimIds.includes(claim.claimId)) return "Selected for a draft";
    if (claimKind(claim) === "structural") return "";
    const draft = draftOfClaim(claim.claimId);
    if (draft === "refused") return "Not usable in new drafts right now";
    if (draft === "admitted") return useOfClaim(claim.claimId) === "usable" ? "Usable in internal drafts" : "Usable in provisional internal drafts";
    return "";
  };
  const findingStatus = (finding) => {
    if (finding.claims.length === 0) return access.proposeClaim ? "Not yet proposed for use in drafts" : "";
    return finding.claims.map(claimStatusText).find(Boolean) || "Proposed for use in drafts";
  };
  const openFinding = (finding) => {
    setFocusFinding({ contextKey, evidenceItemId: finding.evidenceItemId, technical: finding.category === "technical" });
    onSelectView?.("evidence");
  };
  const loadedFindings = FINDING_CATEGORIES.filter((category) => category !== "technical").flatMap((category) => findings[category]);
  const unclaimedCount = loadedFindings.filter((finding) => finding.evidence && finding.claims.length === 0).length;
  const notUsableCount = claims.items.filter((claim) => claimKind(claim) !== "structural" && draftOfClaim(claim.claimId) === "refused").length;
  const attention = [];
  if (engagementId && pipeline?.status === "error") {
    attention.push({ key: "pipeline_error", text: "This Project's file status could not be loaded, so files waiting for a step may not be listed." });
  }
  if (preparationFiles.length > 0) {
    attention.push({
      key: "source_preparation",
      text: `${preparationFiles.length} file(s) in this Project need a step before their evidence can be used.`,
      actionLabel: "Open Sources", onAction: () => onSelectView?.("sources"),
    });
  }
  if (access.proposeClaim && unclaimedCount > 0) {
    attention.push({
      key: "unclaimed_evidence",
      text: `${unclaimedCount} finding(s)${findingsState.complete === false ? " loaded so far" : ""} are not yet proposed for use in drafts.`,
      actionLabel: "Review in Evidence", onAction: () => onSelectView?.("evidence"),
    });
  }
  if (notUsableCount > 0) {
    attention.push({
      key: "claims_not_usable",
      text: `${notUsableCount} proposed finding(s) cannot be used in drafts right now; Evidence says why for each.`,
      actionLabel: "Review in Evidence", onAction: () => onSelectView?.("evidence"),
    });
  }
  if (findingsState.kind === "ready" && findingsState.complete && findings.outcomes.length === 0 && access.recordSourceMeasurement) {
    attention.push({
      key: "no_outcome_measurement",
      text: "No baseline and follow-up outcome measurement is recorded yet. A source with baseline and follow-up values can be measured with Count records in Sources.",
      actionLabel: "Open Sources", onAction: () => onSelectView?.("sources"),
    });
  }
  for (const item of extraAttention) attention.push(item);

  const [showTechnical, setShowTechnical] = useState(false);
  const [focusFinding, setFocusFinding] = useState(null);
  useEffect(() => { setFocusFinding(null); setShowTechnical(false); }, [organizationId, engagementId]);
  const focusedEvidenceItemId = focusFinding && focusFinding.contextKey === contextKey ? focusFinding.evidenceItemId : null;
  useEffect(() => {
    if (!focusedEvidenceItemId || view !== "evidence") return;
    if (focusFinding?.technical) setShowTechnical(true);
    const element = globalThis.document?.querySelector(`[data-client-finding="${focusedEvidenceItemId}"]`);
    element?.scrollIntoView?.({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedEvidenceItemId, view]);

  const renderClaim = (claim, findingStatement) => {
    const selectability = claimInternalDraftSelectability(claim, claimDiagnostics.get(claim.claimId));
    const kind = claimKind(claim);
    const use = useOfClaim(claim.claimId);
    const diagnosis = claimSourceVersionUnavailable(claim, claimDiagnostics.get(claim.claimId))
      ? { status: "not_usable", blockerCodes: [], conflictReason: "source_version_not_current" } : claimDiagnostics.get(claim.claimId);
    const recoveryVersion = currentRecordCountRecoveryVersion(claim, sources.items, diagnosis);
    const claimText = claim.claimStatement || claim.evidenceStatement || "";
    // Owner Package 3: the strict internal answer (final use) and the
    // server's provisional draft admission are shown as what each is, so a
    // claim is never called unusable while it is offered for a draft.
    const presentation = claimUsePresentation({ claim, strictUse: use, diagnosis });
    const line = presentation.lines[0] || null;
    const refused = line?.key === "refused" ? splitNotUsableMessage(line.text) : null;
    return (
      <div key={claim.claimId} className="border-top mt-2 pt-2 small" data-client-claim={claim.claimId}
        data-client-claim-kind={kind} data-client-claim-internal-use={use} data-client-claim-provisional-draft={presentation.draft}>
        {/* Internal use is determined by KAI's existing checks (P2-06), not by a
            person; the wording says so and adds no approval language. */}
        {line?.key === "usable" ? (
          <div className="text-success" data-client-claim-usable="">Usable in internal reports now (determined by KAI&rsquo;s checks)</div>
        ) : null}
        {line?.key === "provisional" ? (
          <>
            <div className="text-success" data-client-claim-provisional-admitted="">{line.text}</div>
            {line.detail ? (
              <Disclosure name="claim-final-use-open" label="Before final use" openLabel="Hide">
                <div className="text-muted" data-client-claim-final-use-open="">{line.detail}</div>
              </Disclosure>
            ) : null}
          </>
        ) : null}
        {refused ? (
          <>
            <div data-client-claim-not-usable="">{refused.head}</div>
            {refused.detail ? (
              <Disclosure name="claim-not-usable-reason" label="Why" openLabel="Hide why">
                <div className="text-muted" data-client-claim-not-usable-reason="">{refused.detail}</div>
              </Disclosure>
            ) : null}
          </>
        ) : null}
        {line?.key === "unknown" ? (
          <div className="text-muted" data-client-claim-use-unknown="">
            {CLAIM_USE_UNKNOWN_MESSAGE}
            {access.readClaimTraceabilityDiagnostics && !diagnosedOnceRef.current.has(claim.claimId) ? (
              <button type="button" className="btn btn-sm btn-link p-0 ms-1 align-baseline" data-client-check-claim-use={claim.claimId}
                onClick={() => { diagnosedOnceRef.current.add(claim.claimId); diagnoseClaims([claim.claimId]); }}>
                Check internal use
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="d-flex flex-wrap align-items-center gap-2 mt-1">
          {access.generateDrafts && selectability.selectable ? (
            <label className="form-check mb-0">
              <input className="form-check-input" type="checkbox" checked={selectedClaimIds.includes(claim.claimId)}
                data-client-select-claim={claim.claimId} onChange={() => toggleClaim(claim.claimId)} />
              <span className="form-check-label">Use in an internal draft</span>
            </label>
          ) : null}
          {access.generateClaimGapFollowups && (selectability.selectable || selectability.reason === "structural_fact") ? (
            <button type="button" className="btn btn-sm btn-outline-secondary" disabled={Boolean(pending)}
              data-client-claim-gap-followups={claim.claimId} onClick={() => generateGapFollowups(claim.claimId)}>
              {pending === `gaps:${claim.claimId}` ? "Generating..." : "Generate gap follow-ups"}
            </button>
          ) : null}
          {access.reviewMeasuredClaimFactualContent && !claimSourceVersionUnavailable(claim, diagnosis) && kind !== "structural" && openReview !== claim.claimId && isRouteUuid(claim.claimId) ? (
            <button type="button" className="btn btn-sm btn-outline-primary" data-client-open-measured-claim-review={claim.claimId}
              onClick={() => setReviewing({ contextKey, claimId: claim.claimId })}>
              {use === "not_usable" ? "View review status" : "View measurement"}
            </button>
          ) : null}
        </div>
        {/* The claim is its own object; its wording is shown again only when it
            says something other than the finding above. */}
        {claimText && !claimRestatesFinding(claimText, findingStatement) ? (
          <Disclosure name="claim-wording" label="Claim wording" openLabel="Hide claim wording">
            <div className="text-break" data-client-claim-wording="">Claim: {claimText}</div>
          </Disclosure>
        ) : null}
        {gapFollowupsByClaim[claim.claimId] ? <div className="mt-1 text-muted">{gapFollowupsByClaim[claim.claimId]}</div> : null}
        {!selectability.selectable ? <div className="mt-1">{claimSelectabilityMessage(selectability.reason)}</div> : null}
        {access.recordSourceMeasurement && recoveryVersion ? (
          <div className="mt-1">
            <button type="button" className="btn btn-sm btn-outline-primary"
              data-client-recover-current-count={claim.claimId}
              onClick={() => {
                setMeasuring({ contextKey, sourceVersionId: recoveryVersion.sourceVersionId });
                onSelectView?.("sources");
              }}>
              Count records on current version
            </button>
            <div className="text-muted">Choose the worksheet in Count records. Use its existing measurement if one is recorded, or define the count there, then propose its claim. Earlier reviews stay with the earlier finding.</div>
          </div>
        ) : null}
      </div>
    );
  };

  const renderFinding = (finding) => (
    <li key={finding.key} className={`list-group-item small${focusedEvidenceItemId === finding.evidenceItemId ? " border-primary" : ""}`}
      data-client-finding={finding.evidenceItemId} {...(finding.evidence ? { "data-client-evidence": finding.evidenceItemId } : {})}>
      <FindingText statement={finding.statement} max={260} />
      <FindingMeta finding={finding} />
      {/* The finding's proposal status, once; each claim's own status follows. */}
      {finding.claims.length > 0 ? <div className="text-muted mt-1" data-client-finding-claimed="">Claim proposed</div> : null}
      {finding.evidence && finding.claims.length === 0 ? (
        access.proposeClaim ? (
          <button type="button" className="btn btn-sm btn-outline-primary mt-1" disabled={Boolean(pending)}
            data-client-propose-claim={finding.evidenceItemId} onClick={() => propose(finding.evidenceItemId)}>
            {pending === `propose:${finding.evidenceItemId}` ? "Proposing..." : "Propose claim"}
          </button>
        ) : <div className="text-muted mt-1">Not yet proposed for use in drafts.</div>
      ) : null}
      {finding.claims.map((claim) => renderClaim(claim, finding.statement))}
      <TechnicalDetails label="Details">
        <div>Evidence item: {finding.evidenceItemId}</div>
        {finding.sourceVersionId ? <div>Source version: {finding.sourceVersionId}</div> : null}
        {finding.evidence?.evidenceReviewStatus ? <div>Recorded review status: {finding.evidence.evidenceReviewStatus}</div> : null}
        {finding.evidence?.sensitivityLevel ? <div>Sensitivity: {finding.evidence.sensitivityLevel}</div> : null}
        {finding.evidence?.supportStrength ? <div>Support strength: {finding.evidence.supportStrength}</div> : null}
        {finding.claims.map((claim) => <div key={claim.claimId}>Claim: {claim.claimId}</div>)}
        {!finding.evidence ? <div>This claim&rsquo;s evidence item is not among the evidence loaded so far.</div> : null}
      </TechnicalDetails>
    </li>
  );

  const evidenceReads = [evidence, claims];
  const evidenceView = (
    <div className="admin-card mb-3" data-client-evidence-view="">
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <h5 className="mb-0">Evidence</h5>
        {access.generateDrafts ? (
          <div className="small d-flex align-items-center gap-2" data-client-selection-summary={selectedClaimIds.length}>
            <span>{selectedClaimIds.length}/20 selected for a draft</span>
            {selectedClaimIds.length > 0 ? (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onSelectView?.("drafts")}>Create a draft</button>
            ) : null}
          </div>
        ) : null}
      </div>
      {isRouteUuid(engagementId) ? (
        <div className="form-check small mb-2">
          <input className="form-check-input" type="checkbox" id="client-include-organization-library" data-client-include-organization-library=""
            checked={includeOrganizationLibrary} onChange={(event) => setIncludeOrganizationLibrary(event.target.checked)} />
          <label className="form-check-label" htmlFor="client-include-organization-library">
            Include evidence from other Projects (organization library). This only widens what you can see and select here; a
            finding you use in this Project&rsquo;s draft then appears in this Project.
          </label>
        </div>
      ) : null}
      {!engagementId ? <div className="text-muted small mb-2">No Project is selected, so this is your organization&rsquo;s whole library.</div> : null}
      {evidence.status === "loading" && evidence.items.length === 0 ? <div className="text-muted small">Loading evidence...</div> : null}
      {evidence.status === "error" ? <div className="alert alert-warning py-2 small">Evidence could not be loaded. This does not mean there is none. {evidence.message}</div> : null}
      {claims.status === "loading" && claims.items.length === 0 ? <div className="text-muted small">Loading claims...</div> : null}
      {claims.status === "error" ? <div className="alert alert-warning py-2 small">Claims could not be loaded. {claims.message}</div> : null}
      {evidenceReads.every((read) => read.status === "success" && read.complete) && findingCount(findings) === 0 ? (
        <div className="text-muted small">No evidence yet. Use a source for impact in Sources to extract its evidence.</div>
      ) : null}
      {FINDING_CATEGORIES.filter((category) => category !== "technical" && findings[category].length > 0).map((category) => (
        <div key={category}>
          <CategoryHeading category={category} count={findings[category].length} complete={evidence.complete && claims.complete} />
          <ul className="list-group">{findings[category].map(renderFinding)}</ul>
        </div>
      ))}
      {findings.technical.length > 0 ? (
        <div className="mt-3" data-client-technical-evidence="">
          <button type="button" className="btn btn-sm btn-outline-secondary" aria-expanded={showTechnical}
            data-knowledge-studio-reveal-toggle="technical-evidence" onClick={() => setShowTechnical((value) => !value)}>
            {showTechnical ? "Hide supporting source detail" : `Show supporting source detail (${findings.technical.length})`}
          </button>
          <div className="small text-muted mt-1">Which columns each source has, and earlier statements of a measurement whose meaning has since been recorded. Kept for checking a source; not offered as impact findings.</div>
          {/* Kept mounted while hidden, so an open action's state survives hiding the list. */}
          <ul className="list-group mt-2" hidden={!showTechnical} data-knowledge-studio-reveal="technical-evidence">{findings.technical.map(renderFinding)}</ul>
        </div>
      ) : null}
      <LibraryCompleteness read={evidence} noun="evidence items" />
      <LibraryCompleteness read={claims} noun="claims" />
      {openReview ? (
        // Outside the list, so the list's own refresh after a decision does not unmount it.
        <ClientMeasuredClaimReviewPanel key={`${contextKey}:${openReview}`} organizationId={organizationId} claimId={openReview}
          onClose={() => setReviewing(null)} onRecorded={refresh} canProposeClaim={access.proposeClaim === true} />
      ) : null}
    </div>
  );

  const sourcesView = (
    <>
      {(access.reviewSensitivity || access.promoteSource)
        && !(engagementId && pipelineReady && preparationFiles.length === 0 && !openPreparation) ? (
        <div className="admin-card mb-3" data-client-source-preparation="">
          <h5 className="mb-1">Files that need a step</h5>
          <div className="small text-muted mb-2">
            Each uploaded file needs its sensitivity &amp; allowed-use review and a source review before its evidence can be used.
          </div>
          {!engagementId ? <div className="text-muted small">Select a Project to see its files.</div> : null}
          {engagementId && pipeline?.status === "error" ? (
            <div className="alert alert-warning py-2 small">This Project&rsquo;s file status could not be loaded.</div>
          ) : null}
          {engagementId && !pipelineReady && pipeline?.status !== "error" ? <div className="text-muted small">Loading this Project&rsquo;s files...</div> : null}
          {engagementId && pipelineReady && preparationFiles.length === 0 ? (
            <div className="text-muted small">No files in this Project are waiting for a step.</div>
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
              replaceableVersions={currentVersions}
            />
          ) : null}
        </div>
      ) : null}

      <div className="admin-card mb-3" data-client-data-sources="">
        <h5 className="mb-1">Data Sources</h5>
        <div className="small text-muted mb-2">
          {scope ? "Sources for this Project." : "Your organization's sources."} Extract evidence to see what a source supports, or
          count its records under your own definition of what one record represents.
        </div>
        {sources.status === "loading" && sources.items.length === 0 ? <div className="text-muted small">Loading sources...</div> : null}
        {sources.status === "error" ? <div className="alert alert-warning py-2 small">Sources could not be loaded. {sources.message}</div> : null}
        {sources.status === "success" && sources.items.length === 0 ? (
          <div className="text-muted small">No promoted sources yet. Upload data below; each file is reviewed before it becomes a source.</div>
        ) : null}
        {/* A refresh after a recorded measurement keeps the loaded list (and an open panel with its confirmation) mounted. */}
        {(sources.status === "success" || sources.status === "loading") && sources.items.length > 0 ? (
          <ul className="list-group">
            {sources.items.map((source) => {
              const currentVersion = source.sourceVersions.find((version) => version.isCurrent);
              const title = currentVersion?.safeFilename || source.sourceVersions.find((version) => version.safeFilename)?.safeFilename || "Source";
              const renderVersion = (version) => (
                    <div key={version.sourceVersionId} className="d-flex flex-wrap align-items-center gap-2 mt-1 small" data-client-source-version={version.sourceVersionId}>
                      <span className={version.isCurrent ? "" : "text-muted"}>
                        {version.isCurrent ? "Current version" : "Earlier version"}
                        {version.safeFilename && version.safeFilename !== title ? `: ${version.safeFilename}` : ""}
                        {version.createdAt ? ` · ${new Date(version.createdAt).toLocaleDateString()}` : ""}
                      </span>
                      {version.profileFormat === "xlsx" ? (
                        <span data-client-xlsx-measurement-readiness={version.hasXlsxRecordCountBasis ? "basis_recorded" : "new_version_required"}>
                          {version.hasXlsxRecordCountBasis
                            ? "Workbook ready: use Count records and choose the worksheet."
                            : "This workbook's earlier profile cannot be counted."}
                        </span>
                      ) : null}
                      {version.profileFormat === "xlsx" && !version.hasXlsxRecordCountBasis && version.safeFilename
                        && version.engagementId === engagementId && canUploadNewIntakeVersion && typeof onContinueXlsxInFiles === "function" ? (
                        <button type="button" className="btn btn-sm btn-outline-primary" data-client-continue-xlsx={version.sourceVersionId}
                          onClick={() => onContinueXlsxInFiles({ sourceVersionId: version.sourceVersionId, safeFilename: version.safeFilename })}>
                          Prepare workbook for counting
                        </button>
                      ) : null}
                      {access.extractEvidence && isRouteUuid(version.sourceVersionId) && canOfferEvidenceExtraction(version) ? (
                        <button type="button" className="btn btn-sm btn-outline-primary" disabled={Boolean(pending)}
                          data-client-extract-evidence={version.sourceVersionId}
                          onClick={() => extract(version.sourceVersionId)}>
                          {pending === `extract:${version.sourceVersionId}` ? "Extracting..." : "Extract evidence"}
                        </button>
                      ) : null}
                      {access.extractEvidence && version.isCurrent && EXTRACTION_UNAVAILABLE_MESSAGES[version.evidenceExtractionCapability] ? (
                        <span className="text-muted" data-client-extraction-unavailable={version.evidenceExtractionCapability}>
                          {EXTRACTION_UNAVAILABLE_MESSAGES[version.evidenceExtractionCapability]}
                        </span>
                      ) : null}
                      {access.recordSourceMeasurement && version.isCurrent && isRouteUuid(version.sourceVersionId) ? (
                        <button type="button" className="btn btn-sm btn-outline-secondary" data-client-open-source-measurement={version.sourceVersionId}
                          onClick={() => setMeasuring({ contextKey, sourceVersionId: version.sourceVersionId })}>
                          Count records
                        </button>
                      ) : null}
                      {openMeasurement === version.sourceVersionId ? (
                        <div className="w-100" ref={measurementPanelRef}>
                          <ClientSourceMeasurementPanel key={`${contextKey}:${version.sourceVersionId}`} organizationId={organizationId}
                            sourceVersionId={version.sourceVersionId} canProposeClaim={access.proposeClaim}
                            initialWorksheetKey={measuring.worksheetKey || ""}
                            onWorksheetChange={(worksheetKey) => setMeasuring((current) => (current ? { ...current, worksheetKey } : current))}
                            onClose={() => setMeasuring(null)} onRecorded={refresh}
                            linkableVersions={currentVersions.filter((candidate) => candidate.sourceVersionId !== version.sourceVersionId && candidate.profileFormat === "csv")}
                            versionsById={versionsById}
                            earlierVersionIds={source.sourceVersions.filter((candidate) => candidate.sourceVersionId !== version.sourceVersionId && !candidate.isCurrent).map((candidate) => candidate.sourceVersionId)} />
                        </div>
                      ) : null}
                    </div>
              );
              return (
                <li key={source.sourceId} className="list-group-item" data-client-source={source.sourceId}>
                  <div className="d-flex flex-wrap align-items-baseline gap-2">
                    <span className="fw-semibold small">{title}</span>
                    <span className="small text-muted">{String(source.reviewedSourceType || "").replace(/_/g, " ")}</span>
                  </div>
                  {/* One row per file: the current version and its actions; earlier
                      versions (each with its own existing actions) under Version history. */}
                  {source.sourceVersions.filter((version) => version.isCurrent).map(renderVersion)}
                  {source.sourceVersions.some((version) => !version.isCurrent) ? (
                    <Disclosure name="source-version-history"
                      label={`Version history (${source.sourceVersions.filter((version) => !version.isCurrent).length} earlier)`}
                      openLabel="Hide version history">
                      {source.sourceVersions.filter((version) => !version.isCurrent).map(renderVersion)}
                    </Disclosure>
                  ) : null}
                  <TechnicalDetails label="Technical details">
                    <div>Source code: {source.sourceCode}</div>
                    {source.sourceVersions.map((version) => (
                      <div key={version.sourceVersionId} className="text-break">
                        Source version: {version.sourceVersionId} ({version.isCurrent ? "current" : "earlier"})
                      </div>
                    ))}
                  </TechnicalDetails>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {access.reviewSensitivity ? (
        <div className="admin-card mb-3" data-client-processing-permissions="">
          <h5 className="mb-1">Processing permissions</h5>
          <div className="small text-muted mb-2">
            Only needed to correct a recorded decision, for example AI processing recorded as not permitted by mistake. A correction
            supersedes the current decision, which stays in the file&rsquo;s history, and runs no processing.
          </div>
          <Disclosure name="processing-permissions" label="Correct processing permissions" openLabel="Hide processing permissions"
            buttonClassName="btn btn-sm btn-outline-secondary" defaultOpen={false}>
          <div className="mt-2">
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
                  <li key={file.intakeFileId} className="list-group-item small d-flex flex-wrap align-items-center gap-2" data-client-reviewed-file={file.intakeFileId}>
                    <span className="fw-semibold">{file.safeFilename}</span>
                    <span className="text-muted">
                      {file.currentStage ? `${PIPELINE_STAGE_LABELS[file.currentStage]}: ${current ? stageStatusLabel(current) : "Unknown"}` : "Sensitivity review: Complete"}
                    </span>
                    <button type="button" className="btn btn-sm btn-outline-secondary ms-auto" data-client-review-processing-permissions={file.intakeFileId}
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
          </Disclosure>
        </div>
      ) : null}
    </>
  );

  const claimById = new Map(claims.items.map((claim) => [claim.claimId, claim]));
  const draftsView = (
    <>
      {access.generateDrafts ? (
        <div className="admin-card mb-3" data-client-draft-generation="">
          <h5 className="mb-2">Internal drafts</h5>
          <div className="small mb-2" data-client-draft-selection-count={selectedClaimIds.length}>
            {selectedClaimIds.length}/20 claims selected in Evidence.{" "}
            <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => onSelectView?.("evidence")}>
              {selectedClaimIds.length > 0 ? "Change selection" : "Choose findings in Evidence"}
            </button>
          </div>
          {selectedClaimIds.length > 0 ? (
            <ul className="small mb-2" data-client-draft-selected-claims="">
              {selectedClaimIds.map((claimId) => {
                const claim = claimById.get(claimId);
                const display = findingDisplay(claim?.claimStatement || claim?.evidenceStatement || "");
                const label = [display.headline, display.summary].filter(Boolean).join(": ") || (display.neutral ? "Recorded measurement" : "Selected finding");
                return <li key={claimId}>{shortStatement(label, 140).text}</li>;
              })}
            </ul>
          ) : null}
          {assessmentReadiness.ready ? <div className="small text-muted mb-2">The assessment checks each selected finding and explains any it cannot use as an assertion.</div> : null}
          {!readiness.ready ? <div className="small mb-2" data-client-draft-readiness={readiness.reason}>{INTERNAL_DRAFT_READINESS_MESSAGES[readiness.reason]}</div> : null}
          {readiness.ready && !selectionUse.immediatelyUsable ? (
            <div className="small mb-2" data-client-draft-selection-usability={selectionUse.refused.length > 0 ? "refused" : selectionUse.provisional.length > 0 ? "provisional" : "unknown"}>
              {selectionReportUsabilityMessage(selectionUse)}
            </div>
          ) : null}
          <div className="d-flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-primary" disabled={!assessmentReadiness.ready || Boolean(pending)}
              onClick={() => generate("free_impact_assessment", createFreeImpactAssessmentPath)}>
              {pending === "generate:free_impact_assessment" ? "Generating..." : "Generate Free Impact Assessment"}
            </button>
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
                  ? "It is open below."
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
            Drafts generated for this Project, for internal use only. A draft whose findings are usable internally can be opened and downloaded
            here; drafts from high-risk sources wait for Get Kinder.
          </div>
          <ClientInternalDrafts organizationId={organizationId} engagementId={engagementId} claims={claims.items}
            refreshToken={draftsRefreshToken} focusDraftId={lastDraft?.generatedContentDraftId || null}
            canReadReleasedReports={access.readReleasedInternalReports === true}
            canReadInternalReports={access.readInternalDrafts === true} />
        </div>
      ) : null}
    </>
  );

  return (
    <div data-client-evidence-workflow="">
      {notice ? (
        <div className={`alert alert-${notice.kind} py-2 small`} role="status" data-client-workflow-notice="">{notice.text}</div>
      ) : null}
      <ViewPane name="impact" active={view === "impact"} mounted={visitedViews.includes("impact")}>
        <ImpactView projectName={projectName} engagementId={engagementId} state={findingsState} grouped={findings}
          projectEmpty={canUploadNewIntakeVersion && projectIsConfirmedEmpty({ engagementId, scope, pipeline, sources, evidence, claims })}
          onOpenSources={() => {
            onSelectView?.("sources");
            globalThis.document?.getElementById("knowledge-studio-tab-sources")?.focus();
          }}
          attention={attention} statusFor={findingStatus} onOpenFinding={openFinding}
          onOpenEvidence={() => onSelectView?.("evidence")}
          onLoadMore={!evidence.complete ? evidence.loadMore : (!claims.complete ? claims.loadMore : null)}
          loadingMore={evidence.loadingMore || claims.loadingMore}
          intro={includeOrganizationLibrary
            ? "Includes evidence from other Projects, because that option is switched on in Evidence."
            : "From this Project's own files and the findings its drafts use."} />
        {impactAfter}
      </ViewPane>
      <ViewPane name="evidence" active={view === "evidence"} mounted={visitedViews.includes("evidence")}>
        {evidenceView}
        {evidenceAfter}
      </ViewPane>
      <ViewPane name="sources" active={view === "sources"} mounted={visitedViews.includes("sources")}>
        {sourcesBefore}
        {sourcesView}
        {sourcesAfter}
      </ViewPane>
      <ViewPane name="drafts" active={view === "drafts"} mounted={visitedViews.includes("drafts")}>
        {draftsView}
        {draftsAfter}
      </ViewPane>
    </div>
  );
}

// Identifiers and stored states, available on request rather than in the list.
function TechnicalDetails({ label, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button type="button" className="btn btn-link btn-sm p-0 text-muted" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? `Hide ${label.toLowerCase()}` : label}
      </button>
      {open ? <div className="small text-muted border rounded p-2 mt-1" data-client-technical-details="">{children}</div> : null}
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

// "Not usable in internal reports now: <reasons>." -> the status, then the
// reasons on request (the message itself is unchanged).
function splitNotUsableMessage(message) {
  const text = String(message || "");
  const index = text.indexOf(": ");
  if (index < 0) return { head: text, detail: "" };
  const detail = text.slice(index + 2);
  return { head: `${text.slice(0, index)}.`, detail: `${detail.charAt(0).toUpperCase()}${detail.slice(1)}` };
}
