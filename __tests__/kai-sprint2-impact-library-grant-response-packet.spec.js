import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  grantResponsePacketPath,
  projectGrantResponsePacket,
  shouldApplyGrantResponsePacketResponse,
  gkExportReviewDetailPagePath,
} from "../frontend/impactEvidenceLibraryLogic.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const engagementIdA = "00000000-0000-4000-8000-000000000401";
const engagementIdB = "00000000-0000-4000-8000-000000000402";
const draftId = "00000000-0000-4000-8000-000000000777";
const reviewQueueItemId = "00000000-0000-4000-8000-000000000301";
const exportReviewQueueItemId = "00000000-0000-4000-8000-000000000901";
const claimId = "00000000-0000-4000-8000-000000000101";
const evidenceItemId = "00000000-0000-4000-8000-000000000201";
const sourceId = "00000000-0000-4000-8000-000000000501";
const sourceVersionId = "00000000-0000-4000-8000-000000000601";

// ---------------------------------------------------------------------------
// Pure logic: route identity, response projection, late-response protection
// ---------------------------------------------------------------------------

test("grantResponsePacketPath builds the exact accepted route with organizationId + engagementId, nothing else", () => {
  assert.equal(
    grantResponsePacketPath(organizationId, engagementIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}`
      + `/engagements/${engagementIdA}/grant-response-packet`,
  );
});

test("projectGrantResponsePacket surfaces Audience: Funder, draft/block/citation traceability fields exactly as returned, and drops a draft missing an id", () => {
  const dto = {
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "funder",
    drafts: [
      {
        generatedContentDraftId: draftId,
        generationRunId: "00000000-0000-4000-8000-000000000701",
        contentType: "evidence_summary",
        draftStatus: "draft",
        requestedAudience: "funder",
        reviewQueueItemId,
        queueStatus: "resolved",
        reviewStatus: "resolved",
        reviewUpdatedAt: "2026-09-01T00:00:00.000Z",
        currentUseEligible: true,
        exportReviewVisible: true,
        exportReviewQueueItemId,
        exportReviewQueueStatus: "in_progress",
        exportReviewStatus: "needs_export_review",
        blocks: [{
          ordinal: 1,
          text: "Funder-facing block text.",
          citations: [{
            claimId,
            evidenceItemId,
            sourceId,
            sourceVersionId,
            supportStrength: "strong",
            claimReviewStatus: "resolved",
            evidenceReviewStatus: "resolved",
            currentEligible: true,
            blockerCodes: [],
            affectedDimensionKeys: [],
            affectedObjectIds: [],
          }],
        }],
      },
      { contentType: "impact_narrative" }, // no generatedContentDraftId - must be dropped
    ],
  };

  const projected = projectGrantResponsePacket(dto);
  assert.equal(projected.organizationId, organizationId);
  assert.equal(projected.engagementId, engagementIdA);
  assert.equal(projected.packetAudience, "funder");
  assert.equal(projected.drafts.length, 1);

  const [draft] = projected.drafts;
  assert.equal(draft.generatedContentDraftId, draftId);
  assert.equal(draft.requestedAudience, "funder");
  assert.equal(draft.currentUseEligible, true);
  assert.equal(draft.exportReviewVisible, true);
  assert.equal(draft.exportReviewQueueItemId, exportReviewQueueItemId);
  assert.equal(draft.blocks.length, 1);
  const [citation] = draft.blocks[0].citations;
  assert.equal(citation.claimId, claimId);
  assert.equal(citation.evidenceItemId, evidenceItemId);
  assert.equal(citation.sourceId, sourceId);
  assert.equal(citation.sourceVersionId, sourceVersionId);
  assert.equal(citation.claimReviewStatus, "resolved");
  assert.equal(citation.evidenceReviewStatus, "resolved");
  assert.equal(citation.currentEligible, true);
  assert.deepEqual(citation.blockerCodes, []);
});

test("projectGrantResponsePacket preserves the server's own restricted-vs-absent export-review distinction verbatim (same convention as projectGeneratedDraftPacket - the client never re-derives it)", () => {
  const restricted = projectGrantResponsePacket({
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "funder",
    drafts: [{
      generatedContentDraftId: draftId,
      exportReviewVisible: false,
      exportReviewQueueItemId: null,
      exportReviewQueueStatus: null,
      exportReviewStatus: null,
      blocks: [],
    }],
  });
  assert.equal(restricted.drafts[0].exportReviewVisible, false);
  assert.equal(restricted.drafts[0].exportReviewQueueItemId, null);

  const visibleButNoExportReviewYet = projectGrantResponsePacket({
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "funder",
    drafts: [{
      generatedContentDraftId: draftId,
      exportReviewVisible: true,
      exportReviewQueueItemId: null,
      exportReviewQueueStatus: null,
      exportReviewStatus: null,
      blocks: [],
    }],
  });
  assert.equal(visibleButNoExportReviewYet.drafts[0].exportReviewVisible, true);
  assert.equal(visibleButNoExportReviewYet.drafts[0].exportReviewQueueItemId, null);

  const visibleWithExportReview = projectGrantResponsePacket({
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "funder",
    drafts: [{
      generatedContentDraftId: draftId,
      exportReviewVisible: true,
      exportReviewQueueItemId,
      exportReviewQueueStatus: "in_progress",
      exportReviewStatus: "needs_export_review",
      blocks: [],
    }],
  });
  assert.equal(visibleWithExportReview.drafts[0].exportReviewQueueItemId, exportReviewQueueItemId);
});

test("projectGrantResponsePacket on a successful empty membership returns drafts: [] (distinct from any error, which never reaches this projector)", () => {
  const projected = projectGrantResponsePacket({
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "funder",
    drafts: [],
  });
  assert.deepEqual(projected.drafts, []);
});

test("shouldApplyGrantResponsePacketResponse: late-response protection requires generation AND organization AND engagement identity all still current", () => {
  const base = {
    requestGeneration: 1,
    currentGeneration: 1,
    requestOrganizationId: organizationId,
    currentOrganizationId: organizationId,
    requestEngagementId: engagementIdA,
    currentEngagementId: engagementIdA,
  };
  assert.equal(shouldApplyGrantResponsePacketResponse(base), true);
  assert.equal(shouldApplyGrantResponsePacketResponse({ ...base, currentGeneration: 2 }), false);
  assert.equal(shouldApplyGrantResponsePacketResponse({ ...base, currentEngagementId: engagementIdB }), false);
  assert.equal(shouldApplyGrantResponsePacketResponse({ ...base, currentOrganizationId: "00000000-0000-4000-8000-000000000999" }), false);
});

// ---------------------------------------------------------------------------
// Component wiring: exact single request, no per-member fan-out, no new
// approval/finalization authority, exact GK export-review nav reuse.
// ---------------------------------------------------------------------------

const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

test("ImpactEvidenceLibrary.jsx calls grantResponsePacketPath exactly once - one bounded packet request, never a per-member/per-draft fetch", () => {
  const matches = uiSource.match(/grantResponsePacketPath\(/g) || [];
  assert.equal(matches.length, 1);
});

test("ImpactEvidenceLibrary.jsx never issues a POST for the Grant Response Packet section - it is a read-only surface with no approval/finalization control", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  assert.notEqual(sectionStart, -1);
  assert.notEqual(sectionEnd, -1);
  const section = uiSource.slice(sectionStart, sectionEnd);
  assert.doesNotMatch(section, /postJson/);
  assert.doesNotMatch(section, /Approve|Finalize|Start Review|Complete Review|Request Export Review/);
});

test("ImpactEvidenceLibrary.jsx Grant Response Packet section reuses gkExportReviewDetailPagePath with the exact organizationId/generatedContentDraftId/exportReviewQueueItemId identity, and renders it only when exportReviewQueueItemId is present", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  const section = uiSource.slice(sectionStart, sectionEnd);
  assert.match(section, /draft\.exportReviewVisible && draft\.exportReviewQueueItemId/);
  assert.match(
    section,
    /gkExportReviewDetailPagePath\(\s*organizationId,\s*draft\.generatedContentDraftId,\s*draft\.exportReviewQueueItemId,?\s*\)/,
  );
});

test("ImpactEvidenceLibrary.jsx Grant Response Packet section distinguishes the zero-eligible-drafts message from the error message", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  const section = uiSource.slice(sectionStart, sectionEnd);
  assert.match(
    section,
    /No reviewed funder-ready generated content is currently eligible for this Grant Response Packet\./,
  );
  assert.match(section, /grantResponsePacketRequestState === "error"/);
  assert.match(section, /grantResponsePacketRequestState === "success" && grantResponsePacket/);
});

// ---------------------------------------------------------------------------
// Real execution of the exact committed effect: extracted via string slicing
// (this repository has no DOM/component rendering harness - see the
// established convention in kai-sprint2-impact-evidence-library.spec.js) and
// invoked through `new Function` against the precise free identifiers the
// real closure captures, so a passing run is proof the effect behaves
// correctly, not merely that matching text is present.
// ---------------------------------------------------------------------------

function extractGrantResponsePacketEffectSource(source) {
  const anchor = "grantPacketRequestGenerationRef.current += 1;";
  const anchorIdx = source.indexOf(anchor);
  assert.notEqual(anchorIdx, -1, "could not locate the Grant Response Packet effect");
  const openIdx = source.lastIndexOf("useEffect(() => {", anchorIdx);
  assert.notEqual(openIdx, -1, "could not locate the effect's useEffect(...) opening");
  const bodyStart = openIdx + "useEffect(".length;
  const tailMarker = "}, [organizationId, engagementId]);";
  const tailIdx = source.indexOf(tailMarker, anchorIdx);
  assert.notEqual(tailIdx, -1, "could not locate the effect's dependency array close");
  // Stop right after the arrow function's own closing brace - the deps array
  // that follows (", [organizationId, engagementId]") is useEffect's second
  // argument, not part of the callback itself.
  const bodyEnd = tailIdx + 1;
  return source.slice(bodyStart, bodyEnd);
}

function buildEffect({
  organizationId: orgId,
  engagementId: engId,
  getJsonImpl,
  grantPacketRequestGenerationRef = { current: 0 },
  organizationIdRef = { current: orgId },
  engagementIdRef = { current: engId },
}) {
  const effectSource = extractGrantResponsePacketEffectSource(uiSource);
  const setGrantResponsePacketCalls = [];
  const stateLog = [];
  // A real re-render always keeps organizationIdRef.current/engagementIdRef.current
  // synchronized to the latest props (see `organizationIdRef.current = organizationId;`
  // in ImpactEvidenceLibrary.jsx) - shared refs passed in by a caller simulating a
  // second effect run must reflect this run's own engagement selection.
  organizationIdRef.current = orgId;
  engagementIdRef.current = engId;

  const setGrantResponsePacket = (value) => { setGrantResponsePacketCalls.push(value); stateLog.push(["packet", value]); };
  const setGrantResponsePacketError = (value) => stateLog.push(["error", value]);
  const setGrantResponsePacketRequestState = (value) => stateLog.push(["requestState", value]);
  const setLoadingGrantResponsePacket = (value) => stateLog.push(["loading", value]);

  const buildUseEffect = new Function(
    "React",
    "organizationId",
    "engagementId",
    "grantPacketRequestGenerationRef",
    "setGrantResponsePacket",
    "setGrantResponsePacketError",
    "setGrantResponsePacketRequestState",
    "setLoadingGrantResponsePacket",
    "getJson",
    "grantResponsePacketPath",
    "shouldApplyGrantResponsePacketResponse",
    "organizationIdRef",
    "engagementIdRef",
    "errorText",
    "projectGrantResponsePacket",
    `return (${effectSource});`,
  );
  const effect = buildUseEffect(
    { useEffect: (fn) => fn() },
    orgId,
    engId,
    grantPacketRequestGenerationRef,
    setGrantResponsePacket,
    setGrantResponsePacketError,
    setGrantResponsePacketRequestState,
    setLoadingGrantResponsePacket,
    getJsonImpl,
    grantResponsePacketPath,
    shouldApplyGrantResponsePacketResponse,
    organizationIdRef,
    engagementIdRef,
    (result) => result?.body?.error?.message || `Request failed (${result?.statusCode ?? "unknown"}).`,
    projectGrantResponsePacket,
  );
  return { effect, stateLog, setGrantResponsePacketCalls, organizationIdRef, engagementIdRef };
}

test("Grant Response Packet effect (real execution): a successful read issues exactly one request and applies exactly one success projection", async () => {
  const getJsonCalls = [];
  const { effect, stateLog, setGrantResponsePacketCalls } = buildEffect({
    organizationId,
    engagementId: engagementIdA,
    async getJsonImpl(path) {
      getJsonCalls.push(path);
      return {
        statusCode: 200,
        body: { ok: true, data: { organizationId, engagementId: engagementIdA, packetAudience: "funder", drafts: [] } },
      };
    },
  });
  effect();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(getJsonCalls.length, 1);
  assert.equal(getJsonCalls[0], grantResponsePacketPath(organizationId, engagementIdA));
  // Immediate clear (null) happens synchronously before the request resolves,
  // then exactly one further, successful projection is applied.
  assert.equal(setGrantResponsePacketCalls.length, 2);
  assert.equal(setGrantResponsePacketCalls[0], null);
  assert.deepEqual(setGrantResponsePacketCalls[1].drafts, []);
  assert.deepEqual(stateLog.filter((entry) => entry[0] === "requestState").map((entry) => entry[1]), ["idle", "loading", "success"]);
});

test("Grant Response Packet effect (real execution): engagement switch clears the previous engagement's visible state immediately, before the new request resolves", async () => {
  let resolveGetJson;
  const { effect, setGrantResponsePacketCalls } = buildEffect({
    organizationId,
    engagementId: engagementIdB,
    getJsonImpl: () => new Promise((resolve) => { resolveGetJson = resolve; }),
  });
  effect();
  // Clearing (null) is synchronous - it must already have happened even
  // though the request itself has not resolved.
  assert.deepEqual(setGrantResponsePacketCalls, [null]);
  resolveGetJson({ statusCode: 200, body: { ok: true, data: { drafts: [] } } });
  await new Promise((resolve) => setImmediate(resolve));
});

test("Grant Response Packet effect (real execution): a late response for the previously selected engagement never overwrites the newly selected engagement's packet", async () => {
  // Shared across both effect runs, exactly as the real component instance
  // shares grantPacketRequestGenerationRef/organizationIdRef/engagementIdRef
  // between successive effect firings on organizationId/engagementId change.
  const grantPacketRequestGenerationRef = { current: 0 };
  const organizationIdRef = { current: organizationId };
  const engagementIdRef = { current: engagementIdA };

  const deferredByEngagement = new Map();
  const { effect: effectA, setGrantResponsePacketCalls: callsA } = buildEffect({
    organizationId,
    engagementId: engagementIdA,
    grantPacketRequestGenerationRef,
    organizationIdRef,
    engagementIdRef,
    getJsonImpl: () => new Promise((resolve) => deferredByEngagement.set(engagementIdA, resolve)),
  });
  effectA();

  // Engagement selection moves on to B before A's response has resolved -
  // the real component re-fires the effect and updates the shared refs.
  const { effect: effectB, setGrantResponsePacketCalls: callsB } = buildEffect({
    organizationId,
    engagementId: engagementIdB,
    grantPacketRequestGenerationRef,
    organizationIdRef,
    engagementIdRef,
    getJsonImpl: () => new Promise((resolve) => deferredByEngagement.set(engagementIdB, resolve)),
  });
  effectB();

  // B resolves first.
  deferredByEngagement.get(engagementIdB)({
    statusCode: 200,
    body: { ok: true, data: { organizationId, engagementId: engagementIdB, packetAudience: "funder", drafts: [] } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(callsB[callsB.length - 1]?.engagementId, engagementIdB);

  // A's late response resolves afterward - it must be rejected (no further
  // setGrantResponsePacket call beyond the initial synchronous clear).
  deferredByEngagement.get(engagementIdA)({
    statusCode: 200,
    body: { ok: true, data: { organizationId, engagementId: engagementIdA, packetAudience: "funder", drafts: [] } },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(callsA, [null], "engagement A's late response must never apply a second setGrantResponsePacket call");
  assert.equal(callsB.length, 2);
  assert.deepEqual(callsB[1]?.engagementId, engagementIdB);
});

test("Grant Response Packet effect (real execution): a non-200/non-ok response is reported as an error, distinct from a successful empty-drafts result", async () => {
  const { effect, stateLog, setGrantResponsePacketCalls } = buildEffect({
    organizationId,
    engagementId: engagementIdA,
    async getJsonImpl() {
      return { statusCode: 500, body: { ok: false, error: { message: "system_error" } } };
    },
  });
  effect();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(setGrantResponsePacketCalls, [null, null]);
  assert.deepEqual(stateLog.filter((entry) => entry[0] === "requestState").map((entry) => entry[1]), ["idle", "loading", "error"]);
  assert.ok(stateLog.some((entry) => entry[0] === "error" && entry[1] === "system_error"));
});

test("Grant Response Packet effect (real execution): no organization or engagement selected issues no request at all", async () => {
  const getJsonCalls = [];
  const { effect } = buildEffect({
    organizationId: "",
    engagementId: "",
    async getJsonImpl(path) {
      getJsonCalls.push(path);
      return { statusCode: 200, body: { ok: true, data: { drafts: [] } } };
    },
  });
  effect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getJsonCalls.length, 0);
});
