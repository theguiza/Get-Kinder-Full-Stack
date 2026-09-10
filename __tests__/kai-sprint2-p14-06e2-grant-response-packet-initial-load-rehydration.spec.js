// P14-06E2 frontend initial-load rehydration: execute the committed Grant
// Response Packet load effect and prove it reconstructs packet candidate /
// export-review lifecycle state from the authoritative P14-06D GET alone.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES,
  grantResponsePacketExportReviewLifecycleState,
  grantResponsePacketMarkdownPath,
  grantResponsePacketPath,
  hydrateGrantResponsePacketExportReviewReadModel,
  projectGrantResponsePacket,
  shouldApplyGrantResponsePacketResponse,
} from "../frontend/impactEvidenceLibraryLogic.js";

const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

const organizationId = "00000000-0000-4000-8000-000000000001";
const engagementIdA = "00000000-0000-4000-8000-000000000401";
const engagementIdB = "00000000-0000-4000-8000-000000000402";
const candidateIdA = "00000000-0000-4000-8000-000000000b01";
const candidateIdB = "00000000-0000-4000-8000-000000000b02";
const queueItemIdA = "00000000-0000-4000-8000-000000000901";
const queueItemIdB = "00000000-0000-4000-8000-000000000902";
const reviewUpdatedAtA = "2026-09-09T12:00:00.000Z";
const reviewUpdatedAtB = "2026-09-09T13:00:00.000Z";

function packetDto(overrides = {}) {
  return {
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "funder",
    exportReviewVisible: true,
    grantResponsePacketExportCandidateId: null,
    reviewQueueItemId: null,
    queueStatus: null,
    reviewStatus: null,
    reviewUpdatedAt: null,
    finalReleaseAuthorityEffective: null,
    finalReleaseAuthorityReason: null,
    finalExportEligible: null,
    finalExportEligibilityBlockedReasons: null,
    drafts: [],
    ...overrides,
  };
}

function extractGrantResponsePacketEffectSource() {
  const anchor = "grantPacketRequestGenerationRef.current += 1;";
  const anchorIdx = uiSource.indexOf(anchor);
  assert.notEqual(anchorIdx, -1, "could not locate the Grant Response Packet effect");
  const openIdx = uiSource.lastIndexOf("useEffect(() => {", anchorIdx);
  assert.notEqual(openIdx, -1, "could not locate the effect opening");
  const tailMarker = "}, [organizationId, engagementId]);";
  const tailIdx = uiSource.indexOf(tailMarker, anchorIdx);
  assert.notEqual(tailIdx, -1, "could not locate the effect dependency close");
  return uiSource.slice(openIdx + "useEffect(".length, tailIdx + 1);
}

function buildEffect({
  organizationId: orgId = organizationId,
  engagementId = engagementIdA,
  getJsonImpl,
  grantPacketRequestGenerationRef = { current: 0 },
  organizationIdRef = { current: orgId },
  engagementIdRef = { current: engagementId },
}) {
  const stateLog = [];
  const getJsonCalls = [];
  organizationIdRef.current = orgId;
  engagementIdRef.current = engagementId;

  const setters = {
    setGrantResponsePacket: (value) => stateLog.push(["packet", value]),
    setGrantResponsePacketError: (value) => stateLog.push(["error", value]),
    setGrantResponsePacketRequestState: (value) => stateLog.push(["requestState", value]),
    setGrantResponsePacketExportReviewRequestPendingDraftId: (value) => stateLog.push(["memberRequestPending", value]),
    setGrantResponsePacketExportCandidatePending: (value) => stateLog.push(["candidatePending", value]),
    setGrantResponsePacketExportCandidateResult: (value) => stateLog.push(["candidateResult", value]),
    setGrantResponsePacketExportCandidateError: (value) => stateLog.push(["candidateError", value]),
    setGrantResponsePacketExportReviewPending: (value) => stateLog.push(["reviewPending", value]),
    setGrantResponsePacketExportReviewResult: (value) => stateLog.push(["reviewResult", value]),
    setGrantResponsePacketExportReviewError: (value) => stateLog.push(["reviewError", value]),
    setGrantResponsePacketExportReviewStartPending: (value) => stateLog.push(["reviewStartPending", value]),
    setGrantResponsePacketExportReviewStartError: (value) => stateLog.push(["reviewStartError", value]),
    setGrantResponsePacketExportReviewCompletePending: (value) => stateLog.push(["reviewCompletePending", value]),
    setGrantResponsePacketExportReviewCompleteError: (value) => stateLog.push(["reviewCompleteError", value]),
    setGrantResponsePacketFinalReleaseAuthorityPending: (value) => stateLog.push(["finalReleaseAuthorityPending", value]),
    setGrantResponsePacketFinalReleaseAuthorityError: (value) => stateLog.push(["finalReleaseAuthorityError", value]),
    setGrantResponsePacketFinalMarkdownExportManifestPending: (value) => stateLog.push(["finalMarkdownExportManifestPending", value]),
    setGrantResponsePacketFinalMarkdownExportManifestError: (value) => stateLog.push(["finalMarkdownExportManifestError", value]),
    setLoadingGrantResponsePacket: (value) => stateLog.push(["loading", value]),
  };
  const getJson = async (path) => {
    getJsonCalls.push(path);
    return getJsonImpl(path);
  };
  const buildUseEffect = new Function(
    "React",
    "organizationId",
    "engagementId",
    "grantPacketRequestGenerationRef",
    ...Object.keys(setters),
    "getJson",
    "grantResponsePacketPath",
    "shouldApplyGrantResponsePacketResponse",
    "organizationIdRef",
    "engagementIdRef",
    "errorText",
    "projectGrantResponsePacket",
    "hydrateGrantResponsePacketExportReviewReadModel",
    `return (${extractGrantResponsePacketEffectSource()});`,
  );

  const effect = buildUseEffect(
    { useEffect: (fn) => fn() },
    orgId,
    engagementId,
    grantPacketRequestGenerationRef,
    ...Object.values(setters),
    getJson,
    grantResponsePacketPath,
    shouldApplyGrantResponsePacketResponse,
    organizationIdRef,
    engagementIdRef,
    (result) => result?.body?.error?.message || `Request failed (${result?.statusCode ?? "unknown"}).`,
    projectGrantResponsePacket,
    hydrateGrantResponsePacketExportReviewReadModel,
  );
  return { effect, stateLog, getJsonCalls, organizationIdRef, engagementIdRef };
}

async function runFreshLoad(data) {
  const harness = buildEffect({
    getJsonImpl: async () => ({ statusCode: 200, body: { ok: true, data } }),
  });
  harness.effect();
  await new Promise((resolve) => setImmediate(resolve));
  return harness;
}

function lastState(stateLog, key) {
  return stateLog.filter((entry) => entry[0] === key).at(-1)?.[1];
}

test("P14-06E2 fresh load: no current candidate hydrates null candidate/review and leaves Create export candidate as the available packet action", async () => {
  const { stateLog } = await runFreshLoad(packetDto());
  assert.equal(lastState(stateLog, "candidateResult"), null);
  assert.equal(lastState(stateLog, "reviewResult"), null);
  assert.equal(grantResponsePacketExportReviewLifecycleState(lastState(stateLog, "reviewResult")), GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.requestable);
});

test("P14-06E2 fresh load: current candidate with no review hydrates exact candidate and leaves Request export review available", async () => {
  const { stateLog } = await runFreshLoad(packetDto({
    grantResponsePacketExportCandidateId: candidateIdA,
  }));
  assert.equal(lastState(stateLog, "candidateResult").grantResponsePacketExportCandidateId, candidateIdA);
  assert.equal(lastState(stateLog, "reviewResult"), null);
  assert.equal(grantResponsePacketExportReviewLifecycleState(lastState(stateLog, "reviewResult")), GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.requestable);
});

test("P14-06E2 fresh load: open review hydrates Start export review state", async () => {
  const { stateLog } = await runFreshLoad(packetDto({
    grantResponsePacketExportCandidateId: candidateIdA,
    reviewQueueItemId: queueItemIdA,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt: reviewUpdatedAtA,
  }));
  assert.equal(grantResponsePacketExportReviewLifecycleState(lastState(stateLog, "reviewResult")), GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.startable);
});

test("P14-06E2 fresh load: in_progress review hydrates Complete export review state", async () => {
  const { stateLog } = await runFreshLoad(packetDto({
    grantResponsePacketExportCandidateId: candidateIdA,
    reviewQueueItemId: queueItemIdA,
    queueStatus: "in_progress",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt: reviewUpdatedAtA,
  }));
  assert.equal(grantResponsePacketExportReviewLifecycleState(lastState(stateLog, "reviewResult")), GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.completable);
});

test("P14-06E2 fresh load: resolved review hydrates Export review complete state", async () => {
  const { stateLog } = await runFreshLoad(packetDto({
    grantResponsePacketExportCandidateId: candidateIdA,
    reviewQueueItemId: queueItemIdA,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    reviewUpdatedAt: reviewUpdatedAtA,
  }));
  assert.equal(grantResponsePacketExportReviewLifecycleState(lastState(stateLog, "reviewResult")), GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.resolved);
});

test("P14-06E2 fresh load preserves exact candidate id, queue id, and reviewUpdatedAt from GET", async () => {
  const { stateLog } = await runFreshLoad(packetDto({
    grantResponsePacketExportCandidateId: candidateIdA,
    reviewQueueItemId: queueItemIdA,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt: reviewUpdatedAtA,
  }));
  assert.equal(lastState(stateLog, "candidateResult").grantResponsePacketExportCandidateId, candidateIdA);
  assert.equal(lastState(stateLog, "reviewResult").grantResponsePacketExportCandidateId, candidateIdA);
  assert.equal(lastState(stateLog, "reviewResult").reviewQueueItemId, queueItemIdA);
  assert.equal(lastState(stateLog, "reviewResult").reviewUpdatedAt, reviewUpdatedAtA);
});

test("P14-06E2 fresh load authoritative no-candidate response clears old candidate and review before request resolves and remains null after success", async () => {
  let resolveGet;
  const { effect, stateLog } = buildEffect({
    getJsonImpl: () => new Promise((resolve) => { resolveGet = resolve; }),
  });
  effect();
  assert.equal(lastState(stateLog, "candidateResult"), null);
  assert.equal(lastState(stateLog, "reviewResult"), null);
  resolveGet({ statusCode: 200, body: { ok: true, data: packetDto() } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lastState(stateLog, "candidateResult"), null);
  assert.equal(lastState(stateLog, "reviewResult"), null);
});

test("P14-06E2 fresh load authoritative no-review response clears old review while preserving exact current candidate", async () => {
  const { stateLog } = await runFreshLoad(packetDto({
    grantResponsePacketExportCandidateId: candidateIdA,
    reviewQueueItemId: null,
    queueStatus: null,
    reviewStatus: null,
    reviewUpdatedAt: null,
  }));
  assert.equal(lastState(stateLog, "candidateResult").grantResponsePacketExportCandidateId, candidateIdA);
  assert.equal(lastState(stateLog, "reviewResult"), null);
});

test("P14-06E2 engagement switch: A state clears immediately, late A cannot overwrite B packet/candidate/review", async () => {
  const grantPacketRequestGenerationRef = { current: 0 };
  const organizationIdRef = { current: organizationId };
  const engagementIdRef = { current: engagementIdA };
  const deferredByEngagement = new Map();
  const effectA = buildEffect({
    engagementId: engagementIdA,
    grantPacketRequestGenerationRef,
    organizationIdRef,
    engagementIdRef,
    getJsonImpl: () => new Promise((resolve) => deferredByEngagement.set(engagementIdA, resolve)),
  });
  effectA.effect();

  const effectB = buildEffect({
    engagementId: engagementIdB,
    grantPacketRequestGenerationRef,
    organizationIdRef,
    engagementIdRef,
    getJsonImpl: () => new Promise((resolve) => deferredByEngagement.set(engagementIdB, resolve)),
  });
  effectB.effect();

  assert.equal(lastState(effectB.stateLog, "candidateResult"), null);
  assert.equal(lastState(effectB.stateLog, "reviewResult"), null);

  deferredByEngagement.get(engagementIdB)({
    statusCode: 200,
    body: { ok: true, data: packetDto({
      engagementId: engagementIdB,
      grantResponsePacketExportCandidateId: candidateIdB,
      reviewQueueItemId: queueItemIdB,
      queueStatus: "in_progress",
      reviewStatus: "needs_gk_review",
      reviewUpdatedAt: reviewUpdatedAtB,
    }) },
  });
  await new Promise((resolve) => setImmediate(resolve));

  deferredByEngagement.get(engagementIdA)({
    statusCode: 200,
    body: { ok: true, data: packetDto({
      engagementId: engagementIdA,
      grantResponsePacketExportCandidateId: candidateIdA,
      reviewQueueItemId: queueItemIdA,
      queueStatus: "open",
      reviewStatus: "needs_gk_review",
      reviewUpdatedAt: reviewUpdatedAtA,
    }) },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(lastState(effectA.stateLog, "packet"), null);
  assert.equal(lastState(effectA.stateLog, "candidateResult"), null);
  assert.equal(lastState(effectA.stateLog, "reviewResult"), null);
  assert.equal(lastState(effectB.stateLog, "packet").engagementId, engagementIdB);
  assert.equal(lastState(effectB.stateLog, "candidateResult").grantResponsePacketExportCandidateId, candidateIdB);
  assert.equal(lastState(effectB.stateLog, "reviewResult").reviewQueueItemId, queueItemIdB);
  assert.equal(lastState(effectB.stateLog, "reviewResult").reviewUpdatedAt, reviewUpdatedAtB);
});

test("P14-06E2 restricted GET identity stays hidden and is not recovered from members, URLs, timestamps, or manifest history", async () => {
  const { stateLog } = await runFreshLoad(packetDto({
    exportReviewVisible: false,
    grantResponsePacketExportCandidateId: candidateIdA,
    reviewQueueItemId: queueItemIdA,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt: reviewUpdatedAtA,
    drafts: [{
      generatedContentDraftId: "00000000-0000-4000-8000-000000000777",
      exportReviewVisible: true,
      exportReviewQueueItemId: queueItemIdA,
      exportManifestHistory: [{ exportCandidateId: candidateIdA, createdAt: reviewUpdatedAtA }],
      blocks: [],
    }],
  }));
  assert.equal(lastState(stateLog, "packet").grantResponsePacketExportCandidateId, null);
  assert.equal(lastState(stateLog, "candidateResult"), null);
  assert.equal(lastState(stateLog, "reviewResult"), null);
});

test("P14-06E2 source wiring uses the E1 hydration helper in the initial-load success path only", () => {
  const effectSource = extractGrantResponsePacketEffectSource();
  assert.match(effectSource, /hydrateGrantResponsePacketExportReviewReadModel\(projectGrantResponsePacket\(result\.body\.data\)\)/);
  assert.match(effectSource, /setGrantResponsePacket\(hydrated\.packet\);/);
  assert.match(effectSource, /setGrantResponsePacketExportCandidateResult\(hydrated\.candidateResult\);/);
  assert.match(effectSource, /setGrantResponsePacketExportReviewResult\(hydrated\.exportReviewResult\);/);
});

test("P14-06E2 packet Markdown, member workflows, and no-finalization controls remain unchanged", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  assert.notEqual(sectionStart, -1);
  assert.notEqual(sectionEnd, -1);
  const section = uiSource.slice(sectionStart, sectionEnd);
  assert.match(section, /href=\{grantResponsePacketMarkdownPath\(organizationId,\s*engagementId\)\}/);
  assert.equal(
    grantResponsePacketMarkdownPath(organizationId, engagementIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/engagements/${engagementIdA}/grant-response-packet/markdown`,
  );
  assert.match(section, /requestGrantResponsePacketMemberExportReview\(draft\)/);
  assert.doesNotMatch(section, /\bApprove\b|\bApproved\b|\bFinalize\b|Create Export Manifest/);
});
