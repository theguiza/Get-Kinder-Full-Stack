// BR-05: Board Reporting product UI on the existing Impact Evidence Library.
//
// Closed and reused as-is, never reopened or reimplemented here: BR-02
// (candidate create/reuse/read), BR-03A/B (review request/start/complete),
// BR-04 (human final-release authority), the real Board final-eligibility
// gate, the Board Reporting candidate export-manifest create/reuse route,
// and the governed FINAL Board Summary Markdown delivery route. This file
// proves the FRONTEND wiring added to impactEvidenceLibraryLogic.js and
// ImpactEvidenceLibrary.jsx mirrors the existing, accepted Grant Response
// Packet frontend patterns (see kai-sprint2-p14-06e1/e2/e3,
// kai-sprint2-p14-06-grant-response-packet-export-review-lifecycle-frontend,
// kai-sprint2-p14-08-d-impact-evidence-library-final-markdown-export-ux) -
// same test harness (node:test, no DOM), same "extract the exact committed
// source and execute it" discipline for callbacks/effects that cannot be
// unit-tested through the pure logic module alone.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  boardReportingPacketPath,
  boardReportingCandidatesPath,
  boardReportingCreateCandidateIdempotencyKey,
  boardReportingCreateCandidateBody,
  boardReportingCandidatePath,
  boardReportingWorkflowStatePath,
  boardReportingReviewRequestPath,
  boardReportingReviewStartPath,
  boardReportingReviewCompletePath,
  boardReportingFinalReleaseAuthorityPath,
  boardReportingFinalReleaseAuthorityBody,
  boardReportingExportManifestsPath,
  boardReportingExportManifestMarkdownPath,
  shouldApplyBoardReportingResponse,
  projectBoardReportingPacket,
  projectBoardReportingCandidateResult,
  projectBoardReportingCandidateSnapshot,
  projectBoardReportingWorkflowState,
  BOARD_REPORTING_REVIEW_LIFECYCLE_STATES,
  boardReportingReviewLifecycleState,
  BOARD_REPORTING_FINAL_RELEASE_AUTHORITY_CONTROL_STATES,
  boardReportingFinalReleaseAuthorityControlState,
  boardReportingFinalSummaryFetchable,
  reviewTransitionBody,
  errorText,
} from "../frontend/impactEvidenceLibraryLogic.js";

const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

const organizationId = "00000000-0000-4000-8000-000000000001";
const organizationIdOther = "00000000-0000-4000-8000-000000000002";
const engagementIdA = "00000000-0000-4000-8000-000000000401";
const engagementIdB = "00000000-0000-4000-8000-000000000402";
const candidateIdA = "00000000-0000-4000-8000-000000000b01";
const candidateIdB = "00000000-0000-4000-8000-000000000b02";
const queueItemId = "00000000-0000-4000-8000-000000000901";
const manifestIdOne = "00000000-0000-4000-8000-000000000fa1";
const manifestIdTwo = "00000000-0000-4000-8000-000000000fa2";

// -----------------------------------------------------------------------
// Property 1: presented on the existing Impact Evidence Library (no new
// page/component - this is the file the whole rest of the suite exercises).
// -----------------------------------------------------------------------
test("Board Reporting is rendered inside ImpactEvidenceLibrary.jsx, not a new page", () => {
  assert.match(uiSource, /Board Reporting/);
  assert.match(uiSource, /board-reporting-card/);
  assert.doesNotMatch(uiSource, /BoardReporting\.jsx/);
});

// -----------------------------------------------------------------------
// Path builders: exact backend route shapes.
// -----------------------------------------------------------------------
test("path builders match the exact accepted Board Reporting backend routes", () => {
  assert.equal(
    boardReportingPacketPath(organizationId, engagementIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/engagements/${engagementIdA}/board-reporting`,
  );
  assert.equal(
    boardReportingCandidatesPath(organizationId, engagementIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/engagements/${engagementIdA}/board-reporting/candidates`,
  );
  assert.equal(
    boardReportingCandidatePath(organizationId, engagementIdA, candidateIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/engagements/${engagementIdA}/board-reporting/candidates/${candidateIdA}`,
  );
  assert.equal(
    boardReportingWorkflowStatePath(organizationId, engagementIdA, candidateIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/engagements/${engagementIdA}/board-reporting/candidates/${candidateIdA}/workflow-state`,
  );
  assert.equal(
    boardReportingReviewRequestPath(organizationId, engagementIdA, candidateIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/engagements/${engagementIdA}/board-reporting/candidates/${candidateIdA}/review-request`,
  );
  assert.equal(
    boardReportingReviewStartPath(organizationId, engagementIdA, candidateIdA, queueItemId),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/engagements/${engagementIdA}/board-reporting/candidates/${candidateIdA}/review-queue/${queueItemId}/start`,
  );
  assert.equal(
    boardReportingReviewCompletePath(organizationId, engagementIdA, candidateIdA, queueItemId),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/engagements/${engagementIdA}/board-reporting/candidates/${candidateIdA}/review-queue/${queueItemId}/complete`,
  );
  assert.equal(
    boardReportingFinalReleaseAuthorityPath(organizationId, engagementIdA, candidateIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/engagements/${engagementIdA}/board-reporting/candidates/${candidateIdA}/final-release-authority`,
  );
  assert.equal(
    boardReportingExportManifestsPath(organizationId, engagementIdA, candidateIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/engagements/${engagementIdA}/board-reporting/candidates/${candidateIdA}/export-manifests`,
  );
  assert.equal(
    boardReportingExportManifestMarkdownPath(organizationId, manifestIdOne),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/board-reporting/export-manifests/${manifestIdOne}/markdown`,
  );
  // The FINAL markdown route is org-scoped only - never engagement-scoped.
  assert.doesNotMatch(boardReportingExportManifestMarkdownPath(organizationId, manifestIdOne), /engagements/);
});

test("boardReportingFinalReleaseAuthorityBody sends only review_queue_item_id and decision_action", () => {
  assert.deepEqual(
    boardReportingFinalReleaseAuthorityBody(queueItemId, "grant"),
    { review_queue_item_id: queueItemId, decision_action: "grant" },
  );
});

// -----------------------------------------------------------------------
// Property 3: create/reuse sends only permitted input.
// -----------------------------------------------------------------------
test("boardReportingCreateCandidateBody sends only idempotency_key, matching the accepted contract pattern", () => {
  const key = boardReportingCreateCandidateIdempotencyKey(organizationId, engagementIdA);
  assert.match(key, /^[A-Za-z0-9._:-]{8,128}$/);
  assert.deepEqual(boardReportingCreateCandidateBody(key), { idempotency_key: key });
});

test("create-candidate callback source in ImpactEvidenceLibrary.jsx never sends membership/fingerprint/review/authority/eligibility/manifest fields", () => {
  const start = uiSource.indexOf("const createBoardReportingCandidate = useCallback(");
  assert.notEqual(start, -1);
  const end = uiSource.indexOf("const requestBoardReportingReview = useCallback(", start);
  assert.notEqual(end, -1);
  const source = uiSource.slice(start, end);
  assert.match(source, /boardReportingCreateCandidateBody\(/);
  assert.doesNotMatch(source, /fingerprint|memberCount|members:|reviewStatus:|queueStatus:|effectiveAuthority|finalEligibility|manifestId/);
});

// -----------------------------------------------------------------------
// Property 2/5/6: projectors are defensive allowlists of server fields only.
// -----------------------------------------------------------------------
test("projectBoardReportingPacket allowlists exactly the server DTO fields", () => {
  const projected = projectBoardReportingPacket({
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "internal",
    supportedContentTypes: ["evidence_summary", "impact_narrative"],
    members: [{
      generationRunId: "run-1",
      generatedContentDraftId: "draft-1",
      contentType: "evidence_summary",
      draftStatus: "final",
      requestedAudience: "internal",
      reviewQueueItemId: "q-1",
      queueStatus: "resolved",
      reviewStatus: "resolved",
      reviewUpdatedAt: "2026-09-09T00:00:00.000Z",
      currentUseEligible: true,
      blocks: [],
    }],
  });
  assert.equal(projected.organizationId, organizationId);
  assert.equal(projected.members.length, 1);
  assert.equal(projected.members[0].generatedContentDraftId, "draft-1");
});

test("projectBoardReportingCandidateResult and projectBoardReportingCandidateSnapshot are defensive allowlists", () => {
  const created = projectBoardReportingCandidateResult({
    organizationId,
    engagementId: engagementIdA,
    boardReportingCandidateId: candidateIdA,
    packetAudience: "internal",
    fingerprintContractVersion: 1,
    canonicalFingerprint: "abc",
    memberCount: 2,
    replayed: false,
    unexpectedField: "must not survive projection intentionally, but projector allowlists explicitly",
  });
  assert.equal(created.boardReportingCandidateId, candidateIdA);
  assert.equal(created.unexpectedField, undefined);

  const snapshot = projectBoardReportingCandidateSnapshot({
    boardReportingCandidateId: candidateIdA,
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "internal",
    fingerprintContractVersion: 1,
    canonicalFingerprint: "abc",
    candidateStatus: "active",
    createdAt: "2026-09-09T00:00:00.000Z",
    members: [{ boardReportingCandidateMemberId: "m1", generatedContentDraftId: "d1", ordinal: 0, createdAt: "2026-09-09T00:00:00.000Z" }],
  });
  assert.equal(snapshot.members.length, 1);
  assert.equal(snapshot.candidateStatus, "active");
});

// -----------------------------------------------------------------------
// Property 14/18: workflow-state projector never sorts/dedupes/picks latest.
// -----------------------------------------------------------------------
test("projectBoardReportingWorkflowState preserves exportManifests in exact server order and never fabricates fields", () => {
  const dto = {
    organizationId,
    engagementId: engagementIdA,
    boardReportingCandidateId: candidateIdA,
    reviewState: { reviewQueueItemId: queueItemId, queueStatus: "resolved", reviewStatus: "resolved", reviewUpdatedAt: "2026-09-09T00:00:00.000Z" },
    effectiveAuthority: { decisionType: "board_reporting_candidate_final_release", effective: true, reason: "granted", headDecisionId: "d1" },
    finalEligibility: { finalEligibility: true, failedGates: [], blockers: [], currentnessGate: true },
    exportManifests: [
      { boardReportingCandidateExportManifestId: manifestIdTwo, boardReportingCandidateId: candidateIdA, effectiveAuthorityDecisionId: "d1", effectiveAuthorityDecisionType: "t", fingerprintContractVersion: 1, canonicalFingerprint: "f2", createdAt: "2026-09-09T02:00:00.000Z" },
      { boardReportingCandidateExportManifestId: manifestIdOne, boardReportingCandidateId: candidateIdA, effectiveAuthorityDecisionId: "d1", effectiveAuthorityDecisionType: "t", fingerprintContractVersion: 1, canonicalFingerprint: "f1", createdAt: "2026-09-09T01:00:00.000Z" },
    ],
  };
  const projected = projectBoardReportingWorkflowState(dto);
  // The server put manifestIdTwo first (created later) - the projector must
  // preserve that exact order, never re-sort by createdAt or id.
  assert.deepEqual(
    projected.exportManifests.map((m) => m.boardReportingCandidateExportManifestId),
    [manifestIdTwo, manifestIdOne],
  );
  assert.equal(projected.finalEligibility.finalEligibility, true);
  assert.deepEqual(projected.finalEligibility.failedGates, []);
  assert.deepEqual(projected.finalEligibility.blockers, []);
  assert.equal(projected.effectiveAuthority.effective, true);
});

test("projectBoardReportingWorkflowState never invents a manifest id and filters non-uuid entries", () => {
  const projected = projectBoardReportingWorkflowState({
    organizationId,
    engagementId: engagementIdA,
    boardReportingCandidateId: candidateIdA,
    reviewState: {},
    effectiveAuthority: {},
    finalEligibility: {},
    exportManifests: [{ boardReportingCandidateExportManifestId: "not-a-uuid" }],
  });
  assert.deepEqual(projected.exportManifests, []);
});

// -----------------------------------------------------------------------
// Lifecycle/control state machines mirror Grant's one-state-one-control
// discipline exactly.
// -----------------------------------------------------------------------
test("boardReportingReviewLifecycleState: one state, one control", () => {
  assert.equal(boardReportingReviewLifecycleState(null), BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.requestable);
  assert.equal(
    boardReportingReviewLifecycleState({ reviewQueueItemId: queueItemId, queueStatus: "open", reviewStatus: "needs_gk_review" }),
    BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.startable,
  );
  assert.equal(
    boardReportingReviewLifecycleState({ reviewQueueItemId: queueItemId, queueStatus: "in_progress", reviewStatus: "needs_gk_review" }),
    BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.completable,
  );
  assert.equal(
    boardReportingReviewLifecycleState({ reviewQueueItemId: queueItemId, queueStatus: "resolved", reviewStatus: "resolved" }),
    BOARD_REPORTING_REVIEW_LIFECYCLE_STATES.resolved,
  );
});

test("boardReportingFinalReleaseAuthorityControlState: none until review resolved, then grantable/revocable", () => {
  assert.equal(
    boardReportingFinalReleaseAuthorityControlState({ reviewState: { queueStatus: "open", reviewStatus: "needs_gk_review" } }),
    BOARD_REPORTING_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.none,
  );
  assert.equal(
    boardReportingFinalReleaseAuthorityControlState({
      reviewState: { queueStatus: "resolved", reviewStatus: "resolved" },
      effectiveAuthority: { effective: false },
    }),
    BOARD_REPORTING_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.grantable,
  );
  assert.equal(
    boardReportingFinalReleaseAuthorityControlState({
      reviewState: { queueStatus: "resolved", reviewStatus: "resolved" },
      effectiveAuthority: { effective: true },
    }),
    BOARD_REPORTING_FINAL_RELEASE_AUTHORITY_CONTROL_STATES.revocable,
  );
});

// -----------------------------------------------------------------------
// Property 15/19: blocked/stale state disables FINAL fetch; requires an
// EXPLICIT manifest selection.
// -----------------------------------------------------------------------
test("boardReportingFinalSummaryFetchable requires an explicit, existing manifest id AND eligible/effective state", () => {
  const workflowState = {
    finalEligibility: { finalEligibility: true },
    effectiveAuthority: { effective: true },
    exportManifests: [{ boardReportingCandidateExportManifestId: manifestIdOne }],
  };
  assert.equal(boardReportingFinalSummaryFetchable(workflowState, manifestIdOne), true);
  // No selection at all.
  assert.equal(boardReportingFinalSummaryFetchable(workflowState, ""), false);
  // A manifest id not present in the current workflow-state's own list.
  assert.equal(boardReportingFinalSummaryFetchable(workflowState, manifestIdTwo), false);
  // Blocked eligibility.
  assert.equal(
    boardReportingFinalSummaryFetchable({ ...workflowState, finalEligibility: { finalEligibility: false } }, manifestIdOne),
    false,
  );
  // Revoked/ineffective authority.
  assert.equal(
    boardReportingFinalSummaryFetchable({ ...workflowState, effectiveAuthority: { effective: false } }, manifestIdOne),
    false,
  );
});

// -----------------------------------------------------------------------
// Property 21: stale org/engagement guard.
// -----------------------------------------------------------------------
test("shouldApplyBoardReportingResponse rejects a stale generation/organization/engagement combination", () => {
  assert.equal(shouldApplyBoardReportingResponse({
    requestGeneration: 1,
    currentGeneration: 1,
    requestOrganizationId: organizationId,
    currentOrganizationId: organizationId,
    requestEngagementId: engagementIdA,
    currentEngagementId: engagementIdA,
  }), true);
  assert.equal(shouldApplyBoardReportingResponse({
    requestGeneration: 1,
    currentGeneration: 2,
    requestOrganizationId: organizationId,
    currentOrganizationId: organizationId,
    requestEngagementId: engagementIdA,
    currentEngagementId: engagementIdA,
  }), false);
  assert.equal(shouldApplyBoardReportingResponse({
    requestGeneration: 1,
    currentGeneration: 1,
    requestOrganizationId: organizationId,
    currentOrganizationId: organizationIdOther,
    requestEngagementId: engagementIdA,
    currentEngagementId: engagementIdA,
  }), false);
  assert.equal(shouldApplyBoardReportingResponse({
    requestGeneration: 1,
    currentGeneration: 1,
    requestOrganizationId: organizationId,
    currentOrganizationId: organizationId,
    requestEngagementId: engagementIdA,
    currentEngagementId: engagementIdB,
  }), false);
});

// -----------------------------------------------------------------------
// Source-extraction harness for the committed callbacks, mirroring the
// existing Grant Response Packet frontend test convention exactly (see
// kai-sprint2-p14-08-d-impact-evidence-library-final-markdown-export-ux.spec.js).
// -----------------------------------------------------------------------
function extractUseCallbackSource(name, endMarker) {
  const start = uiSource.indexOf(`const ${name} = useCallback(`);
  assert.notEqual(start, -1, `could not locate ${name}`);
  const end = uiSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, `could not locate end marker for ${name}`);
  const section = uiSource.slice(start, end);
  const bodyStart = section.indexOf("useCallback(") + "useCallback(".length;
  const bodyEnd = section.lastIndexOf("\n  }, [");
  assert.notEqual(bodyEnd, -1, `could not locate callback dependency start for ${name}`);
  return section.slice(bodyStart, bodyEnd + "\n  }".length);
}

function extractRefetchSource() {
  const start = uiSource.indexOf("const refetchBoardReportingWorkflowState = useCallback(");
  assert.notEqual(start, -1);
  const end = uiSource.indexOf("const createBoardReportingCandidate = useCallback(", start);
  assert.notEqual(end, -1);
  const section = uiSource.slice(start, end);
  const bodyStart = section.indexOf("useCallback(") + "useCallback(".length;
  const bodyEnd = section.lastIndexOf("\n  }, [");
  assert.notEqual(bodyEnd, -1);
  return section.slice(bodyStart, bodyEnd + "\n  }".length);
}

function buildRefetch({ getJsonImpl, stateLog, refs, generationRef = { current: 0 }, timeoutMs = 15000 }) {
  const factory = new Function(
    "boardReportingWorkflowStateRequestGenerationRef",
    "setLoadingBoardReportingWorkflowState",
    "setBoardReportingWorkflowStateRequestState",
    "getJson",
    "boardReportingWorkflowStatePath",
    "shouldApplyBoardReportingResponse",
    "organizationIdRef",
    "engagementIdRef",
    "setBoardReportingWorkflowState",
    "setBoardReportingWorkflowStateError",
    "errorText",
    "projectBoardReportingWorkflowState",
    "setSelectedBoardReportingExportManifestId",
    "setBoardReportingFinalSummaryMarkdown",
    "setBoardReportingFinalSummaryError",
    "GRANT_RESPONSE_PACKET_REFETCH_TIMEOUT_MS",
    `return (${extractRefetchSource()});`,
  );
  const getJson = async (path) => getJsonImpl(path);
  return factory(
    generationRef,
    (value) => stateLog.push(["loading", value]),
    (value) => stateLog.push(["requestState", value]),
    getJson,
    boardReportingWorkflowStatePath,
    shouldApplyBoardReportingResponse,
    refs.organizationIdRef,
    refs.engagementIdRef,
    (value) => stateLog.push(["workflowState", value]),
    (value) => stateLog.push(["workflowStateError", value]),
    errorText,
    projectBoardReportingWorkflowState,
    (updater) => stateLog.push(["selectedManifestId", typeof updater === "function" ? updater("") : updater]),
    (value) => stateLog.push(["finalSummaryMarkdown", value]),
    (value) => stateLog.push(["finalSummaryError", value]),
    timeoutMs,
  );
}

function lastState(stateLog, key) {
  return stateLog.filter((entry) => entry[0] === key).at(-1)?.[1];
}

function workflowStateDto(overrides = {}) {
  return {
    organizationId,
    engagementId: engagementIdA,
    boardReportingCandidateId: candidateIdA,
    reviewState: { reviewQueueItemId: null, queueStatus: null, reviewStatus: null, reviewUpdatedAt: null },
    effectiveAuthority: { decisionType: null, effective: false, reason: null, headDecisionId: null },
    finalEligibility: { finalEligibility: false, failedGates: [], blockers: [], currentnessGate: null },
    exportManifests: [],
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// Property 2 (packet hydration is exercised via the effect wiring test
// below) and property 10/12/17: every mutation triggers a workflow-state
// refetch, verified by asserting each mutation callback's source calls
// refetchBoardReportingWorkflowState and, independently, that the shared
// refetch itself is stale-response-guarded (property 21 continued).
// -----------------------------------------------------------------------
test("refetchBoardReportingWorkflowState applies a successful, current response and clears a now-nonexistent manifest selection", async () => {
  const stateLog = [];
  const refs = { organizationIdRef: { current: organizationId }, engagementIdRef: { current: engagementIdA } };
  const refetch = buildRefetch({
    stateLog,
    refs,
    getJsonImpl: async () => ({
      statusCode: 200,
      body: { ok: true, data: workflowStateDto({ exportManifests: [{ boardReportingCandidateExportManifestId: manifestIdOne, boardReportingCandidateId: candidateIdA, createdAt: "2026-09-09T00:00:00.000Z" }] }) },
    }),
  });
  const applied = await refetch(organizationId, engagementIdA, candidateIdA);
  assert.equal(applied, true);
  const workflowState = lastState(stateLog, "workflowState");
  assert.equal(workflowState.exportManifests.length, 1);
  assert.equal(lastState(stateLog, "requestState"), "success");
});

test("refetchBoardReportingWorkflowState discards a stale (superseded) response", async () => {
  const stateLog = [];
  const refs = { organizationIdRef: { current: organizationId }, engagementIdRef: { current: engagementIdA } };
  const generationRef = { current: 0 };
  let resolveGet;
  const pendingGet = new Promise((resolve) => { resolveGet = resolve; });
  const refetch = buildRefetch({
    stateLog,
    refs,
    generationRef,
    getJsonImpl: async () => pendingGet,
  });
  const promise = refetch(organizationId, engagementIdA, candidateIdA);
  // A second, superseding refetch bumps the generation counter before the
  // first one's GET resolves - the first response must never be applied.
  generationRef.current += 1;
  resolveGet({ statusCode: 200, body: { ok: true, data: workflowStateDto() } });
  const applied = await promise;
  assert.equal(applied, false);
  assert.equal(stateLog.some((entry) => entry[0] === "workflowState"), false);
});

test("refetchBoardReportingWorkflowState discards a response for a previously selected engagement", async () => {
  const stateLog = [];
  const refs = { organizationIdRef: { current: organizationId }, engagementIdRef: { current: engagementIdA } };
  const refetch = buildRefetch({
    stateLog,
    refs,
    getJsonImpl: async () => {
      // Simulate the user switching engagements while this GET is in flight.
      refs.engagementIdRef.current = engagementIdB;
      return { statusCode: 200, body: { ok: true, data: workflowStateDto() } };
    },
  });
  const applied = await refetch(organizationId, engagementIdA, candidateIdA);
  assert.equal(applied, false);
  assert.equal(stateLog.some((entry) => entry[0] === "workflowState"), false);
});

// -----------------------------------------------------------------------
// Property 7/8/9: review request/start/complete use the exact authoritative
// candidate id + review-queue-item id (+ CAS token for start/complete).
// -----------------------------------------------------------------------
// Executes an extracted useCallback body against an explicit bindings map
// (identifier name -> value). Unlike a positionally-derived parameter list,
// this makes every free variable the extracted source can reference
// explicit and traceable to the exact committed identifier names.
function runExtractedCallback(source, bindings) {
  const names = Object.keys(bindings);
  const values = names.map((name) => bindings[name]);
  const factory = new Function(...names, `return (${source});`);
  return factory(...values);
}

function commonBoardReportingBindings({
  boardReportingCandidateResult,
  boardReportingWorkflowState,
  refetch,
  refs,
}) {
  return {
    organizationId,
    engagementId: engagementIdA,
    boardReportingCandidateResult,
    boardReportingWorkflowState,
    organizationIdRef: refs.organizationIdRef,
    engagementIdRef: refs.engagementIdRef,
    postJson: undefined, // overridden per-test below
    errorText,
    refetchBoardReportingWorkflowState: refetch,
    boardReportingReviewLifecycleState,
    BOARD_REPORTING_REVIEW_LIFECYCLE_STATES,
    boardReportingFinalReleaseAuthorityControlState,
    BOARD_REPORTING_FINAL_RELEASE_AUTHORITY_CONTROL_STATES,
    reviewTransitionBody,
    boardReportingReviewRequestPath,
    boardReportingReviewStartPath,
    boardReportingReviewCompletePath,
    boardReportingFinalReleaseAuthorityPath,
    boardReportingFinalReleaseAuthorityBody,
  };
}

test("requestBoardReportingReview POSTs to the exact candidate id and refetches workflow-state", async () => {
  const stateLog = [];
  const postCalls = [];
  const getCalls = [];
  const refs = { organizationIdRef: { current: organizationId }, engagementIdRef: { current: engagementIdA } };
  const refetch = buildRefetch({ stateLog, refs, getJsonImpl: async (path) => { getCalls.push(path); return { statusCode: 200, body: { ok: true, data: workflowStateDto() } }; } });
  const source = extractUseCallbackSource("requestBoardReportingReview", "const startBoardReportingReview = useCallback(");
  const callback = runExtractedCallback(source, {
    ...commonBoardReportingBindings({ boardReportingCandidateResult: { boardReportingCandidateId: candidateIdA }, refetch, refs }),
    boardReportingReviewRequestPending: false,
    setBoardReportingReviewRequestPending: (v) => stateLog.push(["pending", v]),
    setBoardReportingReviewRequestError: (v) => stateLog.push(["error", v]),
    postJson: async (path, body) => { postCalls.push({ path, body }); return { statusCode: 201, body: { ok: true, data: {} } }; },
    boardReportingReviewRequestPath,
  });
  await callback();
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].path, boardReportingReviewRequestPath(organizationId, engagementIdA, candidateIdA));
  assert.deepEqual(postCalls[0].body, {});
  assert.deepEqual(getCalls, [boardReportingWorkflowStatePath(organizationId, engagementIdA, candidateIdA)]);
});

test("startBoardReportingReview POSTs with the exact candidate + queue item id + CAS token, only when startable", async () => {
  const workflowState = { reviewState: { reviewQueueItemId: queueItemId, queueStatus: "open", reviewStatus: "needs_gk_review", reviewUpdatedAt: "2026-09-09T00:00:00.000Z" } };
  const stateLog = [];
  const postCalls = [];
  const getCalls = [];
  const refs = { organizationIdRef: { current: organizationId }, engagementIdRef: { current: engagementIdA } };
  const refetch = buildRefetch({ stateLog, refs, getJsonImpl: async (path) => { getCalls.push(path); return { statusCode: 200, body: { ok: true, data: workflowStateDto() } }; } });
  const source = extractUseCallbackSource("startBoardReportingReview", "const completeBoardReportingReview = useCallback(");
  const callback = runExtractedCallback(source, {
    ...commonBoardReportingBindings({ boardReportingCandidateResult: { boardReportingCandidateId: candidateIdA }, boardReportingWorkflowState: workflowState, refetch, refs }),
    boardReportingReviewStartPending: false,
    setBoardReportingReviewStartPending: (v) => stateLog.push(["pending", v]),
    setBoardReportingReviewStartError: (v) => stateLog.push(["error", v]),
    postJson: async (path, body) => { postCalls.push({ path, body }); return { statusCode: 200, body: { ok: true, data: {} } }; },
  });
  await callback();
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].path, boardReportingReviewStartPath(organizationId, engagementIdA, candidateIdA, queueItemId));
  assert.deepEqual(postCalls[0].body, { expected_updated_at: "2026-09-09T00:00:00.000Z" });
});

test("startBoardReportingReview does nothing when the lifecycle state is not startable", async () => {
  const workflowState = { reviewState: { reviewQueueItemId: queueItemId, queueStatus: "resolved", reviewStatus: "resolved", reviewUpdatedAt: "2026-09-09T00:00:00.000Z" } };
  const refs = { organizationIdRef: { current: organizationId }, engagementIdRef: { current: engagementIdA } };
  const refetch = buildRefetch({ stateLog: [], refs, getJsonImpl: async () => { throw new Error("must not GET"); } });
  const source = extractUseCallbackSource("startBoardReportingReview", "const completeBoardReportingReview = useCallback(");
  const callback = runExtractedCallback(source, {
    ...commonBoardReportingBindings({ boardReportingCandidateResult: { boardReportingCandidateId: candidateIdA }, boardReportingWorkflowState: workflowState, refetch, refs }),
    boardReportingReviewStartPending: false,
    setBoardReportingReviewStartPending: () => {},
    setBoardReportingReviewStartError: () => {},
    postJson: async () => { throw new Error("must not POST"); },
  });
  await callback();
});

test("completeBoardReportingReview POSTs with the exact candidate + queue item id + CAS token, only when completable", async () => {
  const workflowState = { reviewState: { reviewQueueItemId: queueItemId, queueStatus: "in_progress", reviewStatus: "needs_gk_review", reviewUpdatedAt: "2026-09-09T01:00:00.000Z" } };
  const stateLog = [];
  const postCalls = [];
  const getCalls = [];
  const refs = { organizationIdRef: { current: organizationId }, engagementIdRef: { current: engagementIdA } };
  const refetch = buildRefetch({ stateLog, refs, getJsonImpl: async (path) => { getCalls.push(path); return { statusCode: 200, body: { ok: true, data: workflowStateDto() } }; } });
  const source = extractUseCallbackSource("completeBoardReportingReview", "const recordBoardReportingFinalReleaseAuthority = useCallback(");
  const callback = runExtractedCallback(source, {
    ...commonBoardReportingBindings({ boardReportingCandidateResult: { boardReportingCandidateId: candidateIdA }, boardReportingWorkflowState: workflowState, refetch, refs }),
    boardReportingReviewCompletePending: false,
    setBoardReportingReviewCompletePending: (v) => stateLog.push(["pending", v]),
    setBoardReportingReviewCompleteError: (v) => stateLog.push(["error", v]),
    postJson: async (path, body) => { postCalls.push({ path, body }); return { statusCode: 200, body: { ok: true, data: {} } }; },
  });
  await callback();
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].path, boardReportingReviewCompletePath(organizationId, engagementIdA, candidateIdA, queueItemId));
  assert.deepEqual(postCalls[0].body, { expected_updated_at: "2026-09-09T01:00:00.000Z" });
});

// -----------------------------------------------------------------------
// Property 11/12/13/22: GRANT/REVOKE call the existing final-release-
// authority endpoint, refetch afterward, and a server rejection is never
// swallowed.
// -----------------------------------------------------------------------
test("recordBoardReportingFinalReleaseAuthority(grant) POSTs review_queue_item_id + decision_action and refetches", async () => {
  const workflowState = {
    reviewState: { reviewQueueItemId: queueItemId, queueStatus: "resolved", reviewStatus: "resolved", reviewUpdatedAt: "2026-09-09T00:00:00.000Z" },
    effectiveAuthority: { effective: false },
  };
  const stateLog = [];
  const postCalls = [];
  const getCalls = [];
  const refs = { organizationIdRef: { current: organizationId }, engagementIdRef: { current: engagementIdA } };
  const refetch = buildRefetch({
    stateLog,
    refs,
    getJsonImpl: async (path) => {
      getCalls.push(path);
      return { statusCode: 200, body: { ok: true, data: workflowStateDto({ effectiveAuthority: { effective: true, decisionType: "t", reason: null, headDecisionId: "d1" } }) } };
    },
  });
  const source = extractUseCallbackSource("recordBoardReportingFinalReleaseAuthority", "const createBoardReportingExportManifest = useCallback(");
  const callback = runExtractedCallback(source, {
    ...commonBoardReportingBindings({ boardReportingCandidateResult: { boardReportingCandidateId: candidateIdA }, boardReportingWorkflowState: workflowState, refetch, refs }),
    boardReportingFinalReleaseAuthorityPending: false,
    setBoardReportingFinalReleaseAuthorityPending: (v) => stateLog.push(["pending", v]),
    setBoardReportingFinalReleaseAuthorityError: (v) => stateLog.push(["error", v]),
    postJson: async (path, body) => { postCalls.push({ path, body }); return { statusCode: 201, body: { ok: true, data: {} } }; },
  });
  await callback("grant");
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].path, boardReportingFinalReleaseAuthorityPath(organizationId, engagementIdA, candidateIdA));
  assert.deepEqual(postCalls[0].body, { review_queue_item_id: queueItemId, decision_action: "grant" });
  assert.deepEqual(getCalls, [boardReportingWorkflowStatePath(organizationId, engagementIdA, candidateIdA)]);
});

test("recordBoardReportingFinalReleaseAuthority surfaces a server rejection and never applies a false success", async () => {
  const workflowState = {
    reviewState: { reviewQueueItemId: queueItemId, queueStatus: "resolved", reviewStatus: "resolved", reviewUpdatedAt: "2026-09-09T00:00:00.000Z" },
    effectiveAuthority: { effective: false },
  };
  const stateLog = [];
  const getCalls = [];
  const refs = { organizationIdRef: { current: organizationId }, engagementIdRef: { current: engagementIdA } };
  const refetch = buildRefetch({ stateLog, refs, getJsonImpl: async (path) => { getCalls.push(path); throw new Error("must not refetch after a rejected mutation"); } });
  const source = extractUseCallbackSource("recordBoardReportingFinalReleaseAuthority", "const createBoardReportingExportManifest = useCallback(");
  const callback = runExtractedCallback(source, {
    ...commonBoardReportingBindings({ boardReportingCandidateResult: { boardReportingCandidateId: candidateIdA }, boardReportingWorkflowState: workflowState, refetch, refs }),
    boardReportingFinalReleaseAuthorityPending: false,
    setBoardReportingFinalReleaseAuthorityPending: (v) => stateLog.push(["pending", v]),
    setBoardReportingFinalReleaseAuthorityError: (v) => stateLog.push(["error", v]),
    postJson: async () => ({ statusCode: 403, body: { ok: false, error: { message: "authorization_denied" } } }),
  });
  await callback("grant");
  assert.equal(getCalls.length, 0);
  assert.equal(lastState(stateLog, "error"), "authorization_denied");
  assert.equal(lastState(stateLog, "pending"), false);
});

// -----------------------------------------------------------------------
// Property 16/17: manifest create/reuse calls the existing endpoint and
// refetches workflow-state.
// -----------------------------------------------------------------------
test("createBoardReportingExportManifest POSTs an empty body to the exact candidate's manifest route and refetches", async () => {
  const start = uiSource.indexOf("const createBoardReportingExportManifest = useCallback(");
  assert.notEqual(start, -1);
  const end = uiSource.indexOf("const selectBoardReportingExportManifestId = useCallback(", start);
  assert.notEqual(end, -1);
  const section = uiSource.slice(start, end);
  const bodyStart = section.indexOf("useCallback(") + "useCallback(".length;
  const bodyEnd = section.lastIndexOf("\n  }, [");
  const source = section.slice(bodyStart, bodyEnd + "\n  }".length);

  const stateLog = [];
  const postCalls = [];
  const getCalls = [];
  const refs = { organizationIdRef: { current: organizationId }, engagementIdRef: { current: engagementIdA } };
  const refetch = buildRefetch({ stateLog, refs, getJsonImpl: async (path) => { getCalls.push(path); return { statusCode: 200, body: { ok: true, data: workflowStateDto() } }; } });

  const factory = new Function(
    "organizationId",
    "engagementId",
    "boardReportingCandidateResult",
    "boardReportingExportManifestPending",
    "setBoardReportingExportManifestPending",
    "setBoardReportingExportManifestError",
    "postJson",
    "boardReportingExportManifestsPath",
    "organizationIdRef",
    "engagementIdRef",
    "errorText",
    "refetchBoardReportingWorkflowState",
    `return (${source});`,
  );
  const postJsonCalls = [];
  const callback = factory(
    organizationId,
    engagementIdA,
    { boardReportingCandidateId: candidateIdA },
    false,
    (v) => stateLog.push(["pending", v]),
    (v) => stateLog.push(["error", v]),
    async (path, body) => { postJsonCalls.push({ path, body }); return { statusCode: 201, body: { ok: true, data: {} } }; },
    boardReportingExportManifestsPath,
    refs.organizationIdRef,
    refs.engagementIdRef,
    errorText,
    refetch,
  );
  await callback();
  assert.equal(postJsonCalls.length, 1);
  assert.equal(postJsonCalls[0].path, boardReportingExportManifestsPath(organizationId, engagementIdA, candidateIdA));
  assert.deepEqual(postJsonCalls[0].body, {});
  assert.deepEqual(getCalls, [boardReportingWorkflowStatePath(organizationId, engagementIdA, candidateIdA)]);
});

// -----------------------------------------------------------------------
// Property 4/2: exact candidate identity is retained from the create/reuse
// POST response (never a packet-embedded field, never latest/newest/first/
// last/array-order guessing) - proved directly against the module-header
// documented mechanism and the reset effect.
// -----------------------------------------------------------------------
test("the Board Reporting reset effect clears the retained candidate identity on org/engagement change", () => {
  const start = uiSource.indexOf("boardReportingPacketRequestGenerationRef.current += 1;");
  assert.notEqual(start, -1);
  const sliceEnd = uiSource.indexOf("}, [organizationId, engagementId]);", start);
  const section = uiSource.slice(start, sliceEnd);
  assert.match(section, /setBoardReportingCandidateResult\(null\)/);
  assert.match(section, /setBoardReportingWorkflowState\(null\)/);
  assert.match(section, /setSelectedBoardReportingExportManifestId\(""\)/);
});

test("Board Reporting packet DTO carries no prior candidate id field (confirming the retained-in-React-state recovery mechanism is required, not a hydrate-from-packet shortcut)", () => {
  const projected = projectBoardReportingPacket({
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "internal",
    supportedContentTypes: [],
    members: [],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(projected, "boardReportingCandidateId"), false);
});

// -----------------------------------------------------------------------
// Fresh-mount / hard-reload exact candidate identity recovery.
//
// A true fresh mount discards every retained React state, including
// boardReportingCandidateResult - this proves the recovery mechanism the
// committed fix actually uses (replaying the existing, deterministic BR-02
// create/reuse idempotency key through the unchanged createBoardReportingCandidate
// callback) rather than any array-order/latest/newest guess, and rather than
// a second, browser-persisted identity mechanism.
// -----------------------------------------------------------------------
function extractCreateCandidateSource() {
  return extractUseCallbackSource(
    "createBoardReportingCandidate",
    "// Fresh-mount/reload exact candidate identity recovery:",
  );
}

function buildCreateCandidateCallback({ postJsonImpl, getJsonImpl, stateLog, refs, refetch }) {
  const factory = new Function(
    "organizationId",
    "engagementId",
    "boardReportingCandidatePending",
    "setBoardReportingCandidatePending",
    "setBoardReportingCandidateError",
    "postJson",
    "boardReportingCandidatesPath",
    "boardReportingCreateCandidateBody",
    "boardReportingCreateCandidateIdempotencyKey",
    "organizationIdRef",
    "engagementIdRef",
    "errorText",
    "projectBoardReportingCandidateResult",
    "setBoardReportingCandidateResult",
    "getJson",
    "boardReportingCandidatePath",
    "setLoadingBoardReportingCandidateSnapshot",
    "setBoardReportingCandidateSnapshotError",
    "setBoardReportingCandidateSnapshot",
    "projectBoardReportingCandidateSnapshot",
    "refetchBoardReportingWorkflowState",
    `return (${extractCreateCandidateSource()});`,
  );
  return factory(
    organizationId,
    engagementIdA,
    false,
    (v) => stateLog.push(["candidatePending", v]),
    (v) => stateLog.push(["candidateError", v]),
    postJsonImpl,
    boardReportingCandidatesPath,
    boardReportingCreateCandidateBody,
    boardReportingCreateCandidateIdempotencyKey,
    refs.organizationIdRef,
    refs.engagementIdRef,
    errorText,
    projectBoardReportingCandidateResult,
    (v) => stateLog.push(["candidateResult", v]),
    getJsonImpl,
    boardReportingCandidatePath,
    (v) => stateLog.push(["loadingSnapshot", v]),
    (v) => stateLog.push(["snapshotError", v]),
    (v) => stateLog.push(["snapshot", v]),
    projectBoardReportingCandidateSnapshot,
    refetch,
  );
}

test("a true fresh mount recovers the exact existing candidate C via the deterministic idempotency-key replay, and reads that exact candidate + its exact workflow-state", async () => {
  // Candidate C already exists server-side for O + E; this call simulates
  // the freshly-mounted component's React state (boardReportingCandidateResult
  // === null, nothing retained) replaying the SAME deterministic idempotency
  // key the original create used.
  const getCalls = [];
  const postCalls = [];
  const stateLog = [];
  const refs = { organizationIdRef: { current: organizationId }, engagementIdRef: { current: engagementIdA } };
  const workflowStateGetCalls = [];
  const refetch = buildRefetch({
    stateLog,
    refs,
    getJsonImpl: async (path) => { workflowStateGetCalls.push(path); return { statusCode: 200, body: { ok: true, data: workflowStateDto({ boardReportingCandidateId: candidateIdA }) } }; },
  });
  const callback = buildCreateCandidateCallback({
    stateLog,
    refs,
    refetch,
    postJsonImpl: async (path, body) => {
      postCalls.push({ path, body });
      // Idempotent replay of an existing candidate: same candidate id C,
      // replayed: true - never a newly minted id.
      return {
        statusCode: 200,
        body: { ok: true, data: { organizationId, engagementId: engagementIdA, boardReportingCandidateId: candidateIdA, packetAudience: "internal", fingerprintContractVersion: 1, canonicalFingerprint: "abc", memberCount: 2, replayed: true } },
      };
    },
    getJsonImpl: async (path) => { getCalls.push(path); return { statusCode: 200, body: { ok: true, data: { boardReportingCandidateId: candidateIdA, organizationId, engagementId: engagementIdA, packetAudience: "internal", fingerprintContractVersion: 1, canonicalFingerprint: "abc", candidateStatus: "active", createdAt: "2026-09-09T00:00:00.000Z", members: [] } } }; },
  });

  await callback();

  // The create/reuse POST used the exact deterministic idempotency key for
  // this organization+engagement (never a stored/cached candidate id).
  assert.equal(postCalls.length, 1);
  assert.equal(postCalls[0].path, boardReportingCandidatesPath(organizationId, engagementIdA));
  assert.deepEqual(postCalls[0].body, { idempotency_key: boardReportingCreateCandidateIdempotencyKey(organizationId, engagementIdA) });

  // The retained candidate result is exactly candidate C, marked replayed.
  const candidateResult = lastState(stateLog, "candidateResult");
  assert.equal(candidateResult.boardReportingCandidateId, candidateIdA);
  assert.equal(candidateResult.replayed, true);

  // The exact-candidate GET used exactly candidate C's id in the path.
  assert.deepEqual(getCalls, [boardReportingCandidatePath(organizationId, engagementIdA, candidateIdA)]);

  // The exact workflow-state GET used exactly candidate C's id in the path -
  // never a latest/newest/first/last/array-order selection.
  assert.deepEqual(workflowStateGetCalls, [boardReportingWorkflowStatePath(organizationId, engagementIdA, candidateIdA)]);
});

test("a rejected create/reuse replay (e.g. a stale fingerprint) clears/fails safely - no candidate is retained and no candidate/workflow-state GET is ever guessed", async () => {
  const getCalls = [];
  const postCalls = [];
  const stateLog = [];
  const refs = { organizationIdRef: { current: organizationId }, engagementIdRef: { current: engagementIdA } };
  const refetch = buildRefetch({ stateLog, refs, getJsonImpl: async () => { throw new Error("must not refetch workflow-state without a candidate id"); } });
  const callback = buildCreateCandidateCallback({
    stateLog,
    refs,
    refetch,
    postJsonImpl: async (path, body) => {
      postCalls.push({ path, body });
      return { statusCode: 409, body: { ok: false, error: { message: "candidate_state_conflict" } } };
    },
    getJsonImpl: async (path) => { getCalls.push(path); throw new Error("must not GET a candidate that was never established"); },
  });

  await callback();

  assert.equal(postCalls.length, 1);
  assert.equal(getCalls.length, 0);
  assert.equal(lastState(stateLog, "candidateResult"), undefined);
  assert.equal(lastState(stateLog, "candidateError"), "candidate_state_conflict");
  assert.equal(lastState(stateLog, "candidatePending"), false);
});

test("the fresh-mount auto-recovery effect only replays create/reuse once packet load succeeds, only while no candidate is retained, and marks itself attempted so it never retries on every render", () => {
  const start = uiSource.indexOf("// Fresh-mount/reload exact candidate identity recovery:");
  assert.notEqual(start, -1);
  const end = uiSource.indexOf("// Requests governed review for the EXACT candidate id", start);
  assert.notEqual(end, -1);
  const section = uiSource.slice(start, end);
  assert.match(section, /if \(!organizationId \|\| !engagementId\) return;/);
  assert.match(section, /if \(boardReportingPacketRequestState !== "success"\) return;/);
  assert.match(section, /if \(boardReportingCandidateResult\) return;/);
  assert.match(section, /if \(boardReportingCandidatePending\) return;/);
  assert.match(section, /if \(boardReportingCandidateAutoAttemptedRef\.current\) return;/);
  assert.match(section, /boardReportingCandidateAutoAttemptedRef\.current = true;/);
  assert.match(section, /createBoardReportingCandidate\(\);/);
});

test("the auto-attempted guard ref is reset alongside every other Board Reporting reset on organization/engagement change", () => {
  const start = uiSource.indexOf("boardReportingPacketRequestGenerationRef.current += 1;");
  assert.notEqual(start, -1);
  const sliceEnd = uiSource.indexOf("}, [organizationId, engagementId]);", start);
  const section = uiSource.slice(start, sliceEnd);
  assert.match(section, /boardReportingCandidateAutoAttemptedRef\.current = false;/);
});

// -----------------------------------------------------------------------
// Property 20: FINAL section is visually/structurally distinct from the
// live/preview workflow-state panel.
// -----------------------------------------------------------------------
test("the FINAL Board Summary render section is a visually distinct block from the workflow-state preview", () => {
  const finalIdx = uiSource.indexOf("board-reporting-final-summary-section");
  assert.notEqual(finalIdx, -1);
  const workflowIdx = uiSource.indexOf("board-reporting-workflow-state");
  assert.notEqual(workflowIdx, -1);
  assert.ok(finalIdx > workflowIdx);
  assert.match(uiSource, /FINAL Board Summary/);
});

// -----------------------------------------------------------------------
// Property 23: existing Grant Response Packet behavior is unchanged - the
// exact existing Grant symbols/markup are still present verbatim.
// -----------------------------------------------------------------------
test("existing Grant Response Packet render markup and symbols are untouched", () => {
  assert.match(uiSource, /<h5 className="mb-0">Grant Response Packet<\/h5>/);
  assert.match(uiSource, /grant-response-packet-final-markdown-download-link/);
  assert.match(uiSource, /const requestGrantResponsePacketExportReview = useCallback\(/);
});
