import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canStartReview,
  decideStartResult,
  startPath,
  startReviewRequest,
  toRenderModel,
} from "../frontend/gkExportReviewDetailLogic.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const generatedContentDraftId = "00000000-0000-4000-8000-000000000702";
const exportReviewQueueItemId = "00000000-0000-4000-8000-000000000710";
const expectedUpdatedAt = "2026-08-06T09:00:00.000Z";

const jsxSource = readFileSync("frontend/gkExportReviewDetail.jsx", "utf8");
const logicSource = readFileSync("frontend/gkExportReviewDetailLogic.js", "utf8");

test("P3-12 startPath builds the exact P3-10 start route from the three route parameters", () => {
  assert.equal(
    startPath(organizationId, generatedContentDraftId, exportReviewQueueItemId),
    "/api/kai/sprint2/intake/admin/organizations/00000000-0000-4000-8000-000000000001"
      + "/generated-content-drafts/00000000-0000-4000-8000-000000000702"
      + "/export-review-queue/00000000-0000-4000-8000-000000000710/start",
  );
});

test("P3-12 startReviewRequest sends exactly { expected_updated_at } and no other field, via the existing authenticated POST convention", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: 200, json: async () => ({ ok: true, data: {}, warnings: [] }) };
  };
  try {
    const path = startPath(organizationId, generatedContentDraftId, exportReviewQueueItemId);
    await startReviewRequest(path, expectedUpdatedAt);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, path);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.credentials, "same-origin");
    assert.equal(calls[0].init.headers.Accept, "application/json");
    assert.equal(calls[0].init.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(calls[0].init.body), { expected_updated_at: expectedUpdatedAt });
  } finally {
    global.fetch = originalFetch;
  }
});

test("P3-12 canStartReview shows the control only for exportReviewQueueStatus=open with exportReviewStatus=needs_gk_review", () => {
  assert.equal(canStartReview({ exportReviewQueueStatus: "open", exportReviewStatus: "needs_gk_review" }), true);
  assert.equal(canStartReview({ exportReviewQueueStatus: "in_progress", exportReviewStatus: "needs_gk_review" }), false);
  assert.equal(canStartReview({ exportReviewQueueStatus: "open", exportReviewStatus: "in_progress" }), false);
  assert.equal(canStartReview({ exportReviewQueueStatus: "blocked", exportReviewStatus: "needs_gk_review" }), false);
  assert.equal(canStartReview({ exportReviewQueueStatus: "resolved", exportReviewStatus: "resolved" }), false);
  assert.equal(canStartReview(null), false);
  assert.equal(canStartReview(undefined), false);
});

test("P3-12 toRenderModel retains exportReviewQueueStatus and exportReviewUpdatedAt as plain internal fields", () => {
  const model = toRenderModel({
    requestedExportAudience: "funder",
    draftStatus: "draft",
    generatedContentReviewStatus: "resolved",
    exportReviewStatus: "needs_gk_review",
    currentUseEligible: true,
    exportEligible: false,
    exportReviewQueueStatus: "open",
    exportReviewUpdatedAt: expectedUpdatedAt,
    blocks: [],
  });
  assert.equal(model.exportReviewQueueStatus, "open");
  assert.equal(model.exportReviewUpdatedAt, expectedUpdatedAt);
});

test("P3-12 decideStartResult: success", () => {
  assert.deepEqual(
    decideStartResult({ statusCode: 200, body: { ok: true, data: { queueStatus: "in_progress" }, warnings: [] } }),
    { kind: "success" },
  );
});

test("P3-12 decideStartResult: conflict_current_state_changed never becomes a success and never retries", () => {
  assert.deepEqual(
    decideStartResult({
      statusCode: 409,
      body: { ok: false, error: { code: "conflict_current_state_changed", message: "The packet changed." }, data: null },
    }),
    { kind: "conflict" },
  );
});

test("P3-12 decideStartResult: other safe failures render the existing generic error convention", () => {
  const result = decideStartResult({
    statusCode: 403,
    body: { ok: false, error: { code: "authorization_denied", message: "Not authorized." }, data: null },
  });
  assert.deepEqual(result, { kind: "error", message: "Not authorized." });
});

test("P3-12 decideStartResult: a 200/ok:true paired with an unrelated body is still success (never inspected for packet data)", () => {
  assert.equal(decideStartResult({ statusCode: 200, body: { ok: true, data: null, warnings: [] } }).kind, "success");
});

test("P3-12 exportReviewUpdatedAt is referenced by the component only to build mutation requests, never to render a field", () => {
  const occurrences = jsxSource.match(/exportReviewUpdatedAt/g) || [];
  assert.equal(occurrences.length, 2, "exportReviewUpdatedAt must appear exactly twice: as the startReviewRequest and completeReviewRequest arguments (P3-15)");
  assert.doesNotMatch(jsxSource, /FieldRow[^)]*exportReviewUpdatedAt/);
});

test("P3-12 exactly one Start Review control is wired in the component, gated by canStartReview", () => {
  const buttonMatches = jsxSource.match(/>\s*Start Review\s*</g) || [];
  assert.equal(buttonMatches.length, 1);
  assert.match(jsxSource, /showStartControl\s*=\s*canStartReview\(model\)/);
  assert.match(jsxSource, /showStartControl \? \(/);
});

test("P3-12 the mutation call site sends only expectedUpdatedAt sourced from the current packet, never actorContext/now/roles", () => {
  assert.match(jsxSource, /startReviewRequest\(\s*\n?\s*startPath\(organizationId, generatedContentDraftId, exportReviewQueueItemId\),\s*\n?\s*outcome\.model\.exportReviewUpdatedAt,/);
  assert.doesNotMatch(jsxSource, /actorContext/i);
  assert.doesNotMatch(jsxSource, /\bnow\s*:/);
  assert.doesNotMatch(logicSource, /body:\s*JSON\.stringify\(\{[^}]*actorContext/i);
  assert.doesNotMatch(logicSource, /\bnow\s*:/);
});

test("P3-12 duplicate submissions are prevented: an in-flight start guards re-entry and disables the button", () => {
  assert.match(jsxSource, /if \(startPending \|\| outcome\?\.kind !== "success" \|\| !outcome\.model\) return;/);
  assert.match(jsxSource, /disabled=\{startPending\}/);
});

test("P3-12 success and conflict both resolve by re-fetching the packet once, never by trusting the start response as the new packet", () => {
  assert.match(
    jsxSource,
    /if \(decided\.kind === "success" \|\| decided\.kind === "conflict"\) \{\s*\n\s*await loadPacket\(\);/,
  );
  assert.doesNotMatch(jsxSource, /setOutcome\(decideStartResult/);
  assert.doesNotMatch(jsxSource, /result\.body\.data/);
});

test("P3-12 other safe start failures render an error message without touching packet state", () => {
  assert.match(jsxSource, /setStartErrorMessage\(decided\.message\)/);
});

test("P3-12 frontend source still contains no approve/reject/finalize/download controls after adding Start Review", () => {
  assert.doesNotMatch(jsxSource, /\b(approve|reject|finalize|mark-ready|markReady|download)\b/i);
  assert.doesNotMatch(logicSource, /\b(approve|reject|finalize|mark-ready|markReady|download)\b/i);
  assert.equal((jsxSource.match(/<button/g) || []).length, 2, "Start Review (P3-12) and Complete Review (P3-15) are the only two controls");
});

test("P3-12 P3-08 citation rendering ('Why can KAI say this?') is unchanged", () => {
  assert.match(jsxSource, /Why can KAI say this\?/);
});

test("P3-12 no new page route, navigation entry, or entry.jsx mount point was added", () => {
  const entrySource = readFileSync("frontend/entry.jsx", "utf8");
  const indexSource = readFileSync("index.js", "utf8");
  assert.match(entrySource, /window\.renderGkExportReviewDetail\s*=/);
  const gkExportMatches = entrySource.match(/window\.renderGkExportReviewDetail\s*=/g) || [];
  assert.equal(gkExportMatches.length, 1);
  const routeMatches = indexSource.match(/app\.get\(\s*\n?\s*"\/gk-admin\//g) || [];
  assert.equal(routeMatches.length, 1);
});
