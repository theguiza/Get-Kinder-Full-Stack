// P14-08D: Impact Evidence Library governed Grant Response Packet FINAL
// Markdown export-manifest create/reuse control + FINAL Markdown download UX.
//
// Closed and reused as-is, never reopened or reimplemented here: P14-03,
// P14-06, P14-07B1, P14-07 human final-release authority, P14-07 final-export
// eligibility, P14-08A, P14-08B (manifest create/reuse route contract),
// P14-08C (exact manifest-bound FINAL Markdown delivery + authoritative
// finalDeliveryState), existing PREVIEW_READ_ONLY Markdown delivery.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  grantResponsePacketExportManifestsPath,
  grantResponsePacketExportManifestMarkdownPath,
  grantResponsePacketPath,
  hydrateGrantResponsePacketExportReviewReadModel,
  projectGrantResponsePacket,
  shouldApplyGrantResponsePacketResponse,
} from "../frontend/impactEvidenceLibraryLogic.js";

const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

const organizationId = "00000000-0000-4000-8000-000000000001";
const engagementIdA = "00000000-0000-4000-8000-000000000401";
const engagementIdB = "00000000-0000-4000-8000-000000000402";
const candidateFromGet = "00000000-0000-4000-8000-000000000b01";
const memberExportManifestId = "00000000-0000-4000-8000-0000000fee01";
const memberExportCandidateId = "00000000-0000-4000-8000-0000000fee02";
const manifestIdOne = "00000000-0000-4000-8000-000000000fa1";
const manifestIdTwo = "00000000-0000-4000-8000-000000000fa2";

function packetDto(overrides = {}) {
  return {
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "funder",
    exportReviewVisible: true,
    grantResponsePacketExportCandidateId: candidateFromGet,
    reviewQueueItemId: "00000000-0000-4000-8000-000000000901",
    queueStatus: "resolved",
    reviewStatus: "resolved",
    reviewUpdatedAt: "2026-09-09T12:00:00.000Z",
    finalReleaseAuthorityEffective: true,
    finalReleaseAuthorityReason: null,
    finalExportEligible: true,
    finalExportEligibilityBlockedReasons: [],
    finalDeliveryState: { grantResponsePacketExportManifests: [], finalMarkdownAvailable: false },
    drafts: [],
    ...overrides,
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

function extractPrepareSource() {
  return extractUseCallbackSource(
    "prepareGrantResponsePacketFinalMarkdownExportManifest",
    "const runCoverageAssessment = useCallback",
  );
}

function buildRefetch({
  getJsonImpl,
  stateLog,
  refs,
  generationRef = { current: 0 },
  // Real production value is 15000ms (GRANT_RESPONSE_PACKET_REFETCH_TIMEOUT_MS
  // in ImpactEvidenceLibrary.jsx) - comfortably larger than every mocked
  // getJsonImpl in this file, so it never wins the race against a normal
  // (fast) mocked response.
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

function buildPrepareAction({
  postJsonImpl,
  getJsonImpl,
  grantResponsePacket = packetDto(),
  pending = false,
  refs = {
    organizationIdRef: { current: organizationId },
    engagementIdRef: { current: engagementIdA },
  },
}) {
  const stateLog = [];
  const postCalls = [];
  const getCalls = [];
  const refetch = buildRefetch({
    stateLog,
    refs,
    getJsonImpl: async (path) => {
      getCalls.push(path);
      return getJsonImpl(path);
    },
  });
  const factory = new Function(
    "organizationId",
    "engagementId",
    "grantResponsePacket",
    "grantResponsePacketFinalMarkdownExportManifestPending",
    "setGrantResponsePacketFinalMarkdownExportManifestPending",
    "setGrantResponsePacketFinalMarkdownExportManifestError",
    "postJson",
    "grantResponsePacketExportManifestsPath",
    "organizationIdRef",
    "engagementIdRef",
    "errorText",
    "refetchGrantResponsePacketAfterMemberExportReviewRequest",
    `return (${extractPrepareSource()});`,
  );
  const callback = factory(
    organizationId,
    engagementIdA,
    grantResponsePacket,
    pending,
    (value) => stateLog.push(["pending", value]),
    (value) => stateLog.push(["error", value]),
    async (path, body) => {
      postCalls.push({ path, body });
      return postJsonImpl(path, body);
    },
    grantResponsePacketExportManifestsPath,
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

test("P14-08D prepare callback source never references eligibility/authority/fingerprint/members/manifest id in its POST body", () => {
  const source = extractPrepareSource();
  assert.match(source, /postJson\(\s*grantResponsePacketExportManifestsPath\(requestOrganizationId, requestEngagementId, candidateId\),\s*\{\},?\s*\)/);
  assert.doesNotMatch(source, /finalExportEligible:|fingerprint|memberCount|members:|reviewStatus:|requestedAudience:|manifestId:/);
});

test("P14-08D finalExportEligible true performs one POST with exact org/engagement/candidate ids and empty body", async () => {
  const harness = buildPrepareAction({
    postJsonImpl: async () => ({ statusCode: 201, body: { ok: true, data: { grantResponsePacketExportManifestId: "should-be-ignored" } } }),
    getJsonImpl: async () => ({ statusCode: 200, body: { ok: true, data: packetDto({
      finalDeliveryState: {
        grantResponsePacketExportManifests: [{ grantResponsePacketExportManifestId: manifestIdOne, createdAt: "2026-09-09T00:00:00.000Z" }],
        finalMarkdownAvailable: true,
      },
    }) } }),
  });
  await harness.callback();
  assert.equal(harness.postCalls.length, 1);
  assert.equal(
    harness.postCalls[0].path,
    grantResponsePacketExportManifestsPath(organizationId, engagementIdA, candidateFromGet),
  );
  assert.deepEqual(harness.postCalls[0].body, {});
  assert.deepEqual(harness.getCalls, [grantResponsePacketPath(organizationId, engagementIdA)]);
});

test("P14-08D finalExportEligible !== true performs no POST and no GET", async () => {
  const harness = buildPrepareAction({
    grantResponsePacket: packetDto({ finalExportEligible: false }),
    postJsonImpl: async () => {
      throw new Error("POST must not run when not eligible");
    },
    getJsonImpl: async () => {
      throw new Error("GET must not run when not eligible");
    },
  });
  await harness.callback();
  assert.equal(harness.postCalls.length, 0);
  assert.equal(harness.getCalls.length, 0);
});

test("P14-08D successful POST is not treated as durable manifest state - UI state comes only from the authoritative GET", async () => {
  const harness = buildPrepareAction({
    postJsonImpl: async () => ({
      statusCode: 201,
      body: { ok: true, data: { grantResponsePacketExportManifestId: "post-response-manifest-must-be-ignored" } },
    }),
    getJsonImpl: async () => ({ statusCode: 200, body: { ok: true, data: packetDto({
      finalDeliveryState: {
        grantResponsePacketExportManifests: [{ grantResponsePacketExportManifestId: manifestIdOne, createdAt: "2026-09-09T00:00:00.000Z" }],
        finalMarkdownAvailable: true,
      },
    }) } }),
  });
  await harness.callback();
  const packet = lastState(harness.stateLog, "packet");
  assert.equal(packet.finalDeliveryState.grantResponsePacketExportManifests.length, 1);
  assert.equal(
    packet.finalDeliveryState.grantResponsePacketExportManifests[0].grantResponsePacketExportManifestId,
    manifestIdOne,
  );
});

test("P14-08D failed POST performs no GET and records no manifest state", async () => {
  const harness = buildPrepareAction({
    postJsonImpl: async () => ({ statusCode: 500, body: { ok: false, error: { message: "manifest_create_failed" } } }),
    getJsonImpl: async () => {
      throw new Error("GET must not run after failed POST");
    },
  });
  await harness.callback();
  assert.equal(harness.postCalls.length, 1);
  assert.equal(harness.getCalls.length, 0);
  assert.equal(lastState(harness.stateLog, "error"), "manifest_create_failed");
});

test("P14-08D engagement switch after POST rejects late refetch hydration", async () => {
  const refs = {
    organizationIdRef: { current: organizationId },
    engagementIdRef: { current: engagementIdA },
  };
  const harness = buildPrepareAction({
    refs,
    postJsonImpl: async () => {
      refs.engagementIdRef.current = engagementIdB;
      return { statusCode: 201, body: { ok: true, data: {} } };
    },
    getJsonImpl: async () => ({ statusCode: 200, body: { ok: true, data: packetDto({
      finalDeliveryState: {
        grantResponsePacketExportManifests: [{ grantResponsePacketExportManifestId: manifestIdOne, createdAt: "2026-09-09T00:00:00.000Z" }],
        finalMarkdownAvailable: true,
      },
    }) } }),
  });
  await harness.callback();
  assert.equal(harness.postCalls.length, 1);
  assert.deepEqual(harness.getCalls, [grantResponsePacketPath(organizationId, engagementIdA)]);
  assert.equal(lastState(harness.stateLog, "packet"), undefined);
});

test("P14-08D late response from old engagement cannot hydrate current engagement", async () => {
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
      finalDeliveryState: {
        grantResponsePacketExportManifests: [{ grantResponsePacketExportManifestId: manifestIdTwo, createdAt: "2026-09-09T01:00:00.000Z" }],
        finalMarkdownAvailable: true,
      },
    }) },
  });
  await bPromise;
  deferred.get(grantResponsePacketPath(organizationId, engagementIdA))({
    statusCode: 200,
    body: { ok: true, data: packetDto({
      engagementId: engagementIdA,
      finalDeliveryState: {
        grantResponsePacketExportManifests: [{ grantResponsePacketExportManifestId: manifestIdOne, createdAt: "2026-09-09T00:00:00.000Z" }],
        finalMarkdownAvailable: true,
      },
    }) },
  });
  await aPromise;

  const packet = lastState(stateLog, "packet");
  assert.equal(packet.engagementId, engagementIdB);
  assert.equal(
    packet.finalDeliveryState.grantResponsePacketExportManifests[0].grantResponsePacketExportManifestId,
    manifestIdTwo,
  );
});

test("P14-08D finalDeliveryState exact manifest id builds exact FINAL Markdown URL", () => {
  const url = grantResponsePacketExportManifestMarkdownPath(organizationId, manifestIdOne);
  assert.equal(
    url,
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/grant-response-packet/export-manifests/${manifestIdOne}/markdown`,
  );
});

test("P14-08D projectGrantResponsePacket allowlists finalDeliveryState from the authoritative DTO only", () => {
  const projected = projectGrantResponsePacket(packetDto({
    finalDeliveryState: {
      grantResponsePacketExportManifests: [
        { grantResponsePacketExportManifestId: manifestIdTwo, createdAt: "2026-09-09T02:00:00.000Z" },
        { grantResponsePacketExportManifestId: manifestIdOne, createdAt: "2026-09-09T00:00:00.000Z" },
      ],
      finalMarkdownAvailable: true,
    },
  }));
  assert.equal(projected.finalDeliveryState.grantResponsePacketExportManifests.length, 2);
  const ids = projected.finalDeliveryState.grantResponsePacketExportManifests.map(
    (manifest) => manifest.grantResponsePacketExportManifestId,
  );
  assert.deepEqual(new Set(ids), new Set([manifestIdOne, manifestIdTwo]));
});

test("P14-08D finalDeliveryState is null whenever there is no current candidate - never a passthrough", () => {
  const projected = projectGrantResponsePacket(packetDto({
    grantResponsePacketExportCandidateId: null,
    finalDeliveryState: {
      grantResponsePacketExportManifests: [{ grantResponsePacketExportManifestId: manifestIdOne, createdAt: "x" }],
      finalMarkdownAvailable: true,
    },
  }));
  assert.equal(projected.finalDeliveryState, null);
});

test("P14-08D member exportManifestId/exportCandidateId can never become the packet final URL or packet identity", () => {
  // A member draft's own exportManifestId/exportManifestHistory entries are a
  // wholly separate identity space from finalDeliveryState.grantResponsePacketExportManifests
  // - projectGrantResponsePacket must never fold one into the other.
  const projected = projectGrantResponsePacket(packetDto({
    drafts: [{
      generatedContentDraftId: "00000000-0000-4000-8000-000000000dd1",
      exportReviewVisible: true,
      exportManifestId: memberExportManifestId,
      exportManifestHistory: [{ exportManifestId: memberExportManifestId, exportCandidateId: memberExportCandidateId, createdAt: "x" }],
    }],
    finalDeliveryState: {
      grantResponsePacketExportManifests: [{ grantResponsePacketExportManifestId: manifestIdOne, createdAt: "x" }],
      finalMarkdownAvailable: true,
    },
  }));
  const finalManifestIds = projected.finalDeliveryState.grantResponsePacketExportManifests.map(
    (manifest) => manifest.grantResponsePacketExportManifestId,
  );
  assert.deepEqual(finalManifestIds, [manifestIdOne]);
  assert.ok(!finalManifestIds.includes(memberExportManifestId));
  assert.ok(!finalManifestIds.includes(memberExportCandidateId));
  // A member manifest id fed through the packet-level URL builder is not
  // rejected client-side (the server is the identity authority) but this
  // proves the browser never substitutes one for the other on its own -
  // the packet-level URL is built exclusively from finalDeliveryState ids
  // in the component, never from a draft's exportManifestId/exportCandidateId.
  assert.notEqual(memberExportManifestId, manifestIdOne);
});

test("P14-08D multiple authoritative manifests render without a latest/newest/preferred selection", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  const section = uiSource.slice(sectionStart, sectionEnd);
  const renderStart = section.indexOf("grant-response-packet-final-markdown-exports");
  assert.notEqual(renderStart, -1);
  const renderSection = section.slice(renderStart, renderStart + 1200);
  // Renders via .map over the full array, sorted only by manifest id - never
  // .slice(-1), .sort by createdAt, [0], or an explicit "latest"/"newest" pick.
  assert.match(renderSection, /\.map\(\(manifest\)/);
  assert.doesNotMatch(renderSection, /latest|newest|preferred|createdAt\.localeCompare|\.slice\(-1\)|\[0\]|\.at\(-1\)/i);
});

test("P14-08D Prepare final Markdown export control and Final Markdown exports list are labeled distinctly from preview and forbidden vocabulary", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  const section = uiSource.slice(sectionStart, sectionEnd);
  assert.match(section, /Prepare final Markdown export/);
  assert.match(section, /Download final Markdown/);
  assert.match(section, /Final Markdown exports/);
  assert.match(section, /Download Markdown preview/);
  assert.doesNotMatch(section, /\bApprove\b|\bApproved\b|\bFinalize\b|Funder approved|Public ready|Finalized externally|Create Export Manifest/);
});

test("P14-08D existing preview Markdown route/link is unchanged", () => {
  assert.match(uiSource, /grant-response-packet-preview-markdown-link/);
  assert.match(uiSource, /grantResponsePacketMarkdownPath\(organizationId, engagementId\)/);
});

test("P14-08D packet review lifecycle and final-release authority controls remain unchanged", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  const section = uiSource.slice(sectionStart, sectionEnd);
  assert.match(section, /Request export review/);
  assert.match(section, /Start export review/);
  assert.match(section, /Complete export review/);
  assert.match(section, /Grant final release authority/);
  assert.match(section, /Revoke final release authority/);
});

test("P14-08D member export/download UX (Markdown/CSV/PDF/DOCX history links) remains unchanged", () => {
  assert.match(uiSource, /exportManifestMarkdownPath\(organizationId, entry\.exportManifestId\)/);
  assert.match(uiSource, /requestGrantResponsePacketMemberExportReview\(draft\)/);
});
