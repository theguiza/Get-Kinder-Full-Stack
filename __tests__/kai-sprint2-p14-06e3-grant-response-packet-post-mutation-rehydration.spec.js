// P14-06E3 frontend post-mutation rehydration: packet candidate / export-
// review mutations use POST only for immediate success/error, then converge
// on the authoritative Grant Response Packet GET + E1 hydration path for
// durable browser state.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES,
  grantResponsePacketExportCandidatesPath,
  grantResponsePacketExportReviewCompletePath,
  grantResponsePacketExportReviewLifecycleState,
  grantResponsePacketExportReviewRequestPath,
  grantResponsePacketExportReviewStartPath,
  grantResponsePacketPath,
  hydrateGrantResponsePacketExportReviewReadModel,
  projectGrantResponsePacket,
  reviewTransitionBody,
  shouldApplyGrantResponsePacketResponse,
} from "../frontend/impactEvidenceLibraryLogic.js";

const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

const organizationId = "00000000-0000-4000-8000-000000000001";
const engagementIdA = "00000000-0000-4000-8000-000000000401";
const engagementIdB = "00000000-0000-4000-8000-000000000402";
const candidateFromPost = "00000000-0000-4000-8000-000000000b99";
const candidateFromGet = "00000000-0000-4000-8000-000000000b01";
const candidateFromGetB = "00000000-0000-4000-8000-000000000b02";
const queueFromPost = "00000000-0000-4000-8000-000000000999";
const queueFromGet = "00000000-0000-4000-8000-000000000901";
const queueFromGetB = "00000000-0000-4000-8000-000000000902";
const reviewUpdatedAt = "2026-09-09T12:00:00.000Z";
const nextReviewUpdatedAt = "2026-09-09T13:00:00.000Z";

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
    drafts: [],
    ...overrides,
  };
}

function successfulPost(overrides = {}) {
  return {
    statusCode: 201,
    body: {
      ok: true,
      data: {
        organizationId,
        engagementId: engagementIdA,
        grantResponsePacketExportCandidateId: candidateFromPost,
        reviewQueueItemId: queueFromPost,
        queueStatus: "resolved",
        reviewStatus: "resolved",
        reviewUpdatedAt: "2026-09-09T00:00:00.000Z",
        ...overrides,
      },
    },
  };
}

function extractUseCallbackSource(name, endMarker) {
  const start = uiSource.indexOf(`const ${name} = useCallback(`);
  assert.notEqual(start, -1, `could not locate ${name}`);
  const end = uiSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, `could not locate end of ${name}`);
  const section = uiSource.slice(start, end);
  const bodyStart = section.indexOf("useCallback(") + "useCallback(".length;
  const bodyEnd = section.lastIndexOf("\n  }, [");
  assert.notEqual(bodyEnd, -1, `could not locate callback dependency start for ${name}`);
  return section.slice(bodyStart, bodyEnd + "\n  }".length);
}

function extractRefetchSource() {
  return extractUseCallbackSource(
    "refetchGrantResponsePacketAfterMemberExportReviewRequest",
    "const requestGrantResponsePacketMemberExportReview = useCallback",
  );
}

function callbackSource(name) {
  if (name === "create") {
    return extractUseCallbackSource(
      "createGrantResponsePacketExportCandidate",
      "const requestGrantResponsePacketExportReview = useCallback",
    );
  }
  if (name === "request") {
    return extractUseCallbackSource(
      "requestGrantResponsePacketExportReview",
      "const startGrantResponsePacketExportReview = useCallback",
    );
  }
  if (name === "start") {
    return extractUseCallbackSource(
      "startGrantResponsePacketExportReview",
      "const completeGrantResponsePacketExportReview = useCallback",
    );
  }
  if (name === "complete") {
    return extractUseCallbackSource(
      "completeGrantResponsePacketExportReview",
      "const runAssessRequirement = useCallback",
    );
  }
  throw new Error(`unknown callback ${name}`);
}

function buildRefetch({
  getJsonImpl,
  stateLog,
  refs,
  generationRef = { current: 0 },
  // Real production value is 15000ms (GRANT_RESPONSE_PACKET_REFETCH_TIMEOUT_MS
  // in ImpactEvidenceLibrary.jsx) - tests that need to observe the bounded
  // timeout firing pass a short override so the test itself stays fast.
  timeoutMs = 15000,
}) {
  const factory = new Function(
    "grantPacketRequestGenerationRef",
    "setLoadingGrantResponsePacket",
    "setGrantResponsePacketRequestState",
    "getJson",
    "grantResponsePacketPath",
    "shouldApplyGrantResponsePacketResponse",
    "organizationIdRef",
    "engagementIdRef",
    "setGrantResponsePacket",
    "setGrantResponsePacketExportCandidateResult",
    "setGrantResponsePacketExportReviewResult",
    "setGrantResponsePacketError",
    "errorText",
    "projectGrantResponsePacket",
    "hydrateGrantResponsePacketExportReviewReadModel",
    "GRANT_RESPONSE_PACKET_REFETCH_TIMEOUT_MS",
    `return (${extractRefetchSource()});`,
  );
  const getJson = async (path) => getJsonImpl(path);
  return factory(
    generationRef,
    (value) => stateLog.push(["loading", value]),
    (value) => stateLog.push(["requestState", value]),
    getJson,
    grantResponsePacketPath,
    shouldApplyGrantResponsePacketResponse,
    refs.organizationIdRef,
    refs.engagementIdRef,
    (value) => stateLog.push(["packet", value]),
    (value) => stateLog.push(["candidateResult", value]),
    (value) => stateLog.push(["reviewResult", value]),
    (value) => stateLog.push(["packetError", value]),
    (result) => result?.body?.error?.message || `Request failed (${result?.statusCode ?? "unknown"}).`,
    projectGrantResponsePacket,
    hydrateGrantResponsePacketExportReviewReadModel,
    timeoutMs,
  );
}

function buildAction({
  action,
  postJsonImpl,
  getJsonImpl,
  candidateResult = {
    organizationId,
    engagementId: engagementIdA,
    grantResponsePacketExportCandidateId: candidateFromGet,
  },
  reviewResult = {
    organizationId,
    engagementId: engagementIdA,
    grantResponsePacketExportCandidateId: candidateFromGet,
    reviewQueueItemId: queueFromGet,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt,
  },
  refs = {
    organizationIdRef: { current: organizationId },
    engagementIdRef: { current: engagementIdA },
  },
  timeoutMs = 15000,
} = {}) {
  const stateLog = [];
  const postCalls = [];
  const getCalls = [];
  refs.organizationIdRef.current = organizationId;
  refs.engagementIdRef.current = engagementIdA;
  const refetch = buildRefetch({
    stateLog,
    refs,
    timeoutMs,
    getJsonImpl: async (path) => {
      getCalls.push(path);
      return getJsonImpl(path);
    },
  });
  const factory = new Function(
    "organizationId",
    "engagementId",
    "grantResponsePacketExportCandidatePending",
    "grantResponsePacketExportReviewPending",
    "grantResponsePacketExportReviewStartPending",
    "grantResponsePacketExportReviewCompletePending",
    "grantResponsePacketExportCandidateResult",
    "grantResponsePacketExportReviewResult",
    "setGrantResponsePacketExportCandidatePending",
    "setGrantResponsePacketExportCandidateError",
    "setGrantResponsePacketExportReviewPending",
    "setGrantResponsePacketExportReviewResult",
    "setGrantResponsePacketExportReviewError",
    "setGrantResponsePacketExportReviewStartPending",
    "setGrantResponsePacketExportReviewStartError",
    "setGrantResponsePacketExportReviewCompletePending",
    "setGrantResponsePacketExportReviewCompleteError",
    "postJson",
    "grantResponsePacketExportCandidatesPath",
    "grantResponsePacketExportReviewRequestPath",
    "grantResponsePacketExportReviewStartPath",
    "grantResponsePacketExportReviewCompletePath",
    "reviewTransitionBody",
    "grantResponsePacketExportReviewLifecycleState",
    "GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES",
    "organizationIdRef",
    "engagementIdRef",
    "errorText",
    "refetchGrantResponsePacketAfterMemberExportReviewRequest",
    `return (${callbackSource(action)});`,
  );
  const callback = factory(
    organizationId,
    engagementIdA,
    false,
    false,
    false,
    false,
    candidateResult,
    reviewResult,
    (value) => stateLog.push(["candidatePending", value]),
    (value) => stateLog.push(["candidateError", value]),
    (value) => stateLog.push(["reviewPending", value]),
    (value) => stateLog.push(["reviewResult", value]),
    (value) => stateLog.push(["reviewError", value]),
    (value) => stateLog.push(["reviewStartPending", value]),
    (value) => stateLog.push(["reviewStartError", value]),
    (value) => stateLog.push(["reviewCompletePending", value]),
    (value) => stateLog.push(["reviewCompleteError", value]),
    async (path, body) => {
      postCalls.push({ path, body });
      return postJsonImpl(path, body);
    },
    grantResponsePacketExportCandidatesPath,
    grantResponsePacketExportReviewRequestPath,
    grantResponsePacketExportReviewStartPath,
    grantResponsePacketExportReviewCompletePath,
    reviewTransitionBody,
    grantResponsePacketExportReviewLifecycleState,
    GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES,
    refs.organizationIdRef,
    refs.engagementIdRef,
    (result) => result?.body?.error?.message || `Request failed (${result?.statusCode ?? "unknown"}).`,
    refetch,
  );
  return { callback, stateLog, postCalls, getCalls, refs };
}

function lastState(stateLog, key) {
  return stateLog.filter((entry) => entry[0] === key).at(-1)?.[1];
}

async function runAction(action, getData, options = {}) {
  const harness = buildAction({
    action,
    postJsonImpl: async () => successfulPost(options.postData),
    getJsonImpl: async () => ({ statusCode: 200, body: { ok: true, data: getData } }),
    ...options,
  });
  await harness.callback();
  return harness;
}

test("P14-06E3 refetch helper hydrates packet, candidate, and review from the authoritative GET and never posts", () => {
  const source = extractRefetchSource();
  assert.match(source, /getJson\(grantResponsePacketPath\(requestOrganizationId, requestEngagementId\)\)/);
  assert.match(source, /shouldApplyGrantResponsePacketResponse\(\{/);
  assert.match(source, /hydrateGrantResponsePacketExportReviewReadModel\(projectGrantResponsePacket\(result\.body\.data\)\)/);
  assert.match(source, /setGrantResponsePacket\(hydrated\.packet\);/);
  assert.match(source, /setGrantResponsePacketExportCandidateResult\(hydrated\.candidateResult\);/);
  assert.match(source, /setGrantResponsePacketExportReviewResult\(hydrated\.exportReviewResult\);/);
  assert.doesNotMatch(source, /postJson|projectGrantResponsePacketExportCandidateResult|projectGrantResponsePacketExportReviewResult/);
});

test("P14-06E3 create candidate success performs one POST, then authoritative GET hydrates candidate state", async () => {
  const harness = await runAction("create", packetDto({
    grantResponsePacketExportCandidateId: candidateFromGet,
  }));
  assert.equal(harness.postCalls.length, 1);
  assert.equal(harness.postCalls[0].path, grantResponsePacketExportCandidatesPath(organizationId, engagementIdA));
  assert.deepEqual(harness.postCalls[0].body, {});
  assert.deepEqual(harness.getCalls, [grantResponsePacketPath(organizationId, engagementIdA)]);
  assert.equal(lastState(harness.stateLog, "candidateResult").grantResponsePacketExportCandidateId, candidateFromGet);
});

test("P14-06E3 request success performs one POST, then authoritative GET hydrates open review state", async () => {
  const harness = await runAction("request", packetDto({
    grantResponsePacketExportCandidateId: candidateFromGet,
    reviewQueueItemId: queueFromGet,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt,
  }));
  assert.equal(harness.postCalls.length, 1);
  assert.equal(harness.postCalls[0].path, grantResponsePacketExportReviewRequestPath(organizationId, engagementIdA, candidateFromGet));
  assert.deepEqual(harness.postCalls[0].body, {});
  assert.deepEqual(harness.getCalls, [grantResponsePacketPath(organizationId, engagementIdA)]);
  assert.equal(lastState(harness.stateLog, "reviewResult").queueStatus, "open");
  assert.equal(lastState(harness.stateLog, "reviewResult").reviewStatus, "needs_gk_review");
});

test("P14-06E3 start success performs one POST with exact CAS, then authoritative GET hydrates in_progress", async () => {
  const harness = await runAction("start", packetDto({
    grantResponsePacketExportCandidateId: candidateFromGet,
    reviewQueueItemId: queueFromGet,
    queueStatus: "in_progress",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt: nextReviewUpdatedAt,
  }));
  assert.equal(harness.postCalls.length, 1);
  assert.equal(harness.postCalls[0].path, grantResponsePacketExportReviewStartPath(organizationId, engagementIdA, candidateFromGet, queueFromGet));
  assert.deepEqual(harness.postCalls[0].body, { expected_updated_at: reviewUpdatedAt });
  assert.deepEqual(harness.getCalls, [grantResponsePacketPath(organizationId, engagementIdA)]);
  assert.equal(lastState(harness.stateLog, "reviewResult").queueStatus, "in_progress");
  assert.equal(lastState(harness.stateLog, "reviewResult").reviewUpdatedAt, nextReviewUpdatedAt);
});

test("P14-06E3 complete success performs one POST with exact CAS, then authoritative GET hydrates resolved", async () => {
  const harness = await runAction("complete", packetDto({
    grantResponsePacketExportCandidateId: candidateFromGet,
    reviewQueueItemId: queueFromGet,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    reviewUpdatedAt: nextReviewUpdatedAt,
  }), {
    reviewResult: {
      organizationId,
      engagementId: engagementIdA,
      grantResponsePacketExportCandidateId: candidateFromGet,
      reviewQueueItemId: queueFromGet,
      queueStatus: "in_progress",
      reviewStatus: "needs_gk_review",
      reviewUpdatedAt,
    },
  });
  assert.equal(harness.postCalls.length, 1);
  assert.equal(harness.postCalls[0].path, grantResponsePacketExportReviewCompletePath(organizationId, engagementIdA, candidateFromGet, queueFromGet));
  assert.deepEqual(harness.postCalls[0].body, { expected_updated_at: reviewUpdatedAt });
  assert.deepEqual(harness.getCalls, [grantResponsePacketPath(organizationId, engagementIdA)]);
  assert.equal(lastState(harness.stateLog, "reviewResult").queueStatus, "resolved");
  assert.equal(lastState(harness.stateLog, "reviewResult").reviewStatus, "resolved");
});

test("P14-06E3 contradictory POST result cannot override authoritative GET candidate, queue, or reviewUpdatedAt", async () => {
  const harness = await runAction("request", packetDto({
    grantResponsePacketExportCandidateId: candidateFromGet,
    reviewQueueItemId: queueFromGet,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt,
  }));
  assert.equal(lastState(harness.stateLog, "candidateResult").grantResponsePacketExportCandidateId, candidateFromGet);
  assert.equal(lastState(harness.stateLog, "reviewResult").grantResponsePacketExportCandidateId, candidateFromGet);
  assert.equal(lastState(harness.stateLog, "reviewResult").reviewQueueItemId, queueFromGet);
  assert.equal(lastState(harness.stateLog, "reviewResult").reviewUpdatedAt, reviewUpdatedAt);
});

test("P14-06E3 failed mutation fabricates no candidate or review state and performs no GET", async () => {
  const harness = buildAction({
    action: "request",
    postJsonImpl: async () => ({ statusCode: 500, body: { ok: false, error: { message: "mutation_failed" } } }),
    getJsonImpl: async () => {
      throw new Error("GET must not run after failed mutation");
    },
  });
  await harness.callback();
  assert.equal(harness.postCalls.length, 1);
  assert.equal(harness.getCalls.length, 0);
  assert.equal(lastState(harness.stateLog, "reviewResult"), undefined);
});

test("P14-06E3 successful mutation plus failed authoritative GET does not use POST as durable fallback", async () => {
  const harness = buildAction({
    action: "request",
    postJsonImpl: async () => successfulPost(),
    getJsonImpl: async () => ({ statusCode: 500, body: { ok: false, error: { message: "read_failed" } } }),
  });
  await harness.callback();
  assert.equal(harness.postCalls.length, 1);
  assert.deepEqual(harness.getCalls, [grantResponsePacketPath(organizationId, engagementIdA)]);
  assert.equal(lastState(harness.stateLog, "packet"), null);
  assert.equal(lastState(harness.stateLog, "candidateResult"), null);
  assert.equal(lastState(harness.stateLog, "reviewResult"), null);
});

test("P14-06E3 post-mutation engagement switch rejects late refetch hydration for packet, candidate, and review", async () => {
  const refs = {
    organizationIdRef: { current: organizationId },
    engagementIdRef: { current: engagementIdA },
  };
  const harness = buildAction({
    action: "start",
    refs,
    postJsonImpl: async () => {
      refs.engagementIdRef.current = engagementIdB;
      return successfulPost();
    },
    getJsonImpl: async () => ({ statusCode: 200, body: { ok: true, data: packetDto({
      engagementId: engagementIdA,
      grantResponsePacketExportCandidateId: candidateFromGet,
      reviewQueueItemId: queueFromGet,
      queueStatus: "in_progress",
      reviewStatus: "needs_gk_review",
      reviewUpdatedAt: nextReviewUpdatedAt,
    }) } }),
  });
  await harness.callback();
  assert.equal(harness.postCalls.length, 1);
  assert.deepEqual(harness.getCalls, [grantResponsePacketPath(organizationId, engagementIdA)]);
  assert.equal(lastState(harness.stateLog, "packet"), undefined);
  assert.equal(lastState(harness.stateLog, "candidateResult"), undefined);
  assert.equal(lastState(harness.stateLog, "reviewResult"), undefined);
});

test("P14-06E3 late A refetch cannot overwrite authoritative B state", async () => {
  const stateLog = [];
  const generationRef = { current: 0 };
  const refs = {
    organizationIdRef: { current: organizationId },
    engagementIdRef: { current: engagementIdA },
  };
  const deferred = new Map();
  const refetch = buildRefetch({
    stateLog,
    refs,
    generationRef,
    getJsonImpl: (path) => new Promise((resolve) => deferred.set(path, resolve)),
  });
  const aPromise = refetch(organizationId, engagementIdA);
  refs.engagementIdRef.current = engagementIdB;
  const bPromise = refetch(organizationId, engagementIdB);

  deferred.get(grantResponsePacketPath(organizationId, engagementIdB))({
    statusCode: 200,
    body: { ok: true, data: packetDto({
      engagementId: engagementIdB,
      grantResponsePacketExportCandidateId: candidateFromGetB,
      reviewQueueItemId: queueFromGetB,
      queueStatus: "resolved",
      reviewStatus: "resolved",
      reviewUpdatedAt: nextReviewUpdatedAt,
    }) },
  });
  await bPromise;
  deferred.get(grantResponsePacketPath(organizationId, engagementIdA))({
    statusCode: 200,
    body: { ok: true, data: packetDto({
      engagementId: engagementIdA,
      grantResponsePacketExportCandidateId: candidateFromGet,
      reviewQueueItemId: queueFromGet,
      queueStatus: "open",
      reviewStatus: "needs_gk_review",
      reviewUpdatedAt,
    }) },
  });
  await aPromise;

  assert.equal(lastState(stateLog, "packet").engagementId, engagementIdB);
  assert.equal(lastState(stateLog, "candidateResult").grantResponsePacketExportCandidateId, candidateFromGetB);
  assert.equal(lastState(stateLog, "reviewResult").reviewQueueItemId, queueFromGetB);
  assert.equal(lastState(stateLog, "reviewResult").reviewUpdatedAt, nextReviewUpdatedAt);
});

test("P14-06E3 exact hydrated candidate, queue, and CAS values come from GET", async () => {
  const harness = await runAction("complete", packetDto({
    grantResponsePacketExportCandidateId: candidateFromGetB,
    reviewQueueItemId: queueFromGetB,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    reviewUpdatedAt: nextReviewUpdatedAt,
  }), {
    reviewResult: {
      organizationId,
      engagementId: engagementIdA,
      grantResponsePacketExportCandidateId: candidateFromGet,
      reviewQueueItemId: queueFromGet,
      queueStatus: "in_progress",
      reviewStatus: "needs_gk_review",
      reviewUpdatedAt,
    },
  });
  assert.equal(lastState(harness.stateLog, "candidateResult").grantResponsePacketExportCandidateId, candidateFromGetB);
  assert.equal(lastState(harness.stateLog, "reviewResult").reviewQueueItemId, queueFromGetB);
  assert.equal(lastState(harness.stateLog, "reviewResult").reviewUpdatedAt, nextReviewUpdatedAt);
});

test("P14-06E3 create-candidate: successful POST then rejected authoritative GET settles pending/loading, surfaces error, fabricates no candidate/review state", async () => {
  const harness = buildAction({
    action: "create",
    postJsonImpl: async () => successfulPost(),
    getJsonImpl: async () => {
      throw new Error("Failed to fetch");
    },
  });

  assert.deepEqual(
    harness.stateLog.filter((entry) => entry[0] === "candidatePending"),
    [],
    "precondition: candidatePending has not yet been touched",
  );

  await harness.callback();

  assert.equal(harness.postCalls.length, 1);
  assert.deepEqual(harness.getCalls, [grantResponsePacketPath(organizationId, engagementIdA)]);

  const pendingTransitions = harness.stateLog
    .filter((entry) => entry[0] === "candidatePending")
    .map((entry) => entry[1]);
  assert.deepEqual(pendingTransitions, [true, false], "candidatePending must go true -> false, never stuck");

  const loadingTransitions = harness.stateLog
    .filter((entry) => entry[0] === "loading")
    .map((entry) => entry[1]);
  assert.deepEqual(loadingTransitions, [true, false], "loadingGrantResponsePacket must go true -> false, never stuck");

  assert.equal(lastState(harness.stateLog, "requestState"), "error");
  assert.equal(lastState(harness.stateLog, "packetError"), "Failed to fetch");

  // No candidate/review state may be fabricated from a GET that never
  // returned data - the rejected refetch must reset these to null rather
  // than leaving stale/partial hydration in place.
  assert.equal(lastState(harness.stateLog, "packet"), null);
  assert.equal(lastState(harness.stateLog, "candidateResult"), null);
  assert.equal(lastState(harness.stateLog, "reviewResult"), null);

  // The Create control's own error slot is only ever cleared to "" at the
  // start of this handler (the rejection itself is surfaced through the
  // shared packet error state, not candidateError) - assert it was never
  // set to a non-empty message, to avoid masking a regression that
  // silently swallows the failure instead of surfacing it via packetError.
  const candidateErrorValues = harness.stateLog
    .filter((entry) => entry[0] === "candidateError")
    .map((entry) => entry[1]);
  assert.deepEqual(candidateErrorValues, [""]);
});

test("P14-06E3 create-candidate: non-settling authoritative GET after successful POST does not leave candidatePending/loading stuck true forever", async () => {
  // Test-only bounded timeout override - the real
  // GRANT_RESPONSE_PACKET_REFETCH_TIMEOUT_MS is 15000ms in production; this
  // test uses a short one so it terminates quickly regardless of whether
  // the code under test bounds the hang or not.
  const testTimeoutMs = 50;
  const harness = buildAction({
    action: "create",
    postJsonImpl: async () => successfulPost(),
    timeoutMs: testTimeoutMs,
    // A GET that never settles (e.g. a hung connection) must still be
    // bounded by the refetch itself - this promise deliberately never
    // resolves or rejects on its own.
    getJsonImpl: () => new Promise(() => {}),
  });

  // Fire the callback but do NOT await it directly - it must not hang the
  // test. Race a short, test-only bounded window (well beyond
  // testTimeoutMs) to observe the state once the refetch's own timeout has
  // had a chance to fire.
  const callbackPromise = harness.callback();
  const timedOut = Symbol("test-window-elapsed");
  const raceResult = await Promise.race([
    callbackPromise.then(() => "callback-settled"),
    new Promise((resolve) => setTimeout(() => resolve(timedOut), testTimeoutMs + 500)),
  ]);

  assert.equal(raceResult, "callback-settled",
    "createGrantResponsePacketExportCandidate must itself settle within a bounded window even when the authoritative GET never does");

  const pendingTransitions = harness.stateLog
    .filter((entry) => entry[0] === "candidatePending")
    .map((entry) => entry[1]);
  assert.deepEqual(pendingTransitions, [true, false],
    "candidatePending must be settled back to false, never left stuck true forever");

  const loadingTransitions = harness.stateLog
    .filter((entry) => entry[0] === "loading")
    .map((entry) => entry[1]);
  assert.deepEqual(loadingTransitions, [true, false],
    "loadingGrantResponsePacket must be settled back to false, never left stuck true forever");

  assert.equal(lastState(harness.stateLog, "requestState"), "error");

  // The POST must never be re-issued merely because the GET failed to
  // settle - no silent auto-retry of the mutation.
  assert.equal(harness.postCalls.length, 1);
});

test("P14-06E3 Request/Start/Complete UI state machine and no-finalization surfaces remain unchanged", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  assert.notEqual(sectionStart, -1);
  assert.notEqual(sectionEnd, -1);
  const section = uiSource.slice(sectionStart, sectionEnd);
  assert.match(section, /Request export review/);
  assert.match(section, /Start export review/);
  assert.match(section, /Complete export review/);
  assert.match(section, /Export review complete/);
  assert.match(section, /grant-response-packet-preview-markdown-link/);
  assert.match(section, /requestGrantResponsePacketMemberExportReview\(draft\)/);
  assert.doesNotMatch(section, /\bApprove\b|\bApproved\b|\bFinalize\b|Create Export Manifest/);
});
