import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  canCompleteReview,
  completePath,
  completeReviewRequest,
  decideCompleteResult,
} from "../frontend/gkExportReviewDetailLogic.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const generatedContentDraftId = "00000000-0000-4000-8000-000000000702";
const exportReviewQueueItemId = "00000000-0000-4000-8000-000000000710";
const expectedUpdatedAt = "2026-08-07T09:00:00.000Z";

const jsxSource = readFileSync("frontend/gkExportReviewDetail.jsx", "utf8");
const logicSource = readFileSync("frontend/gkExportReviewDetailLogic.js", "utf8");

test("P3-15 completePath builds the exact P3-14 complete route from the three route parameters", () => {
  assert.equal(
    completePath(organizationId, generatedContentDraftId, exportReviewQueueItemId),
    "/api/kai/sprint2/intake/admin/organizations/00000000-0000-4000-8000-000000000001"
      + "/generated-content-drafts/00000000-0000-4000-8000-000000000702"
      + "/export-review-queue/00000000-0000-4000-8000-000000000710/complete",
  );
});

test("P3-15 completeReviewRequest sends exactly { expected_updated_at } and no other field, via the existing authenticated POST convention", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (path, init) => {
    calls.push({ path, init });
    return { status: 200, json: async () => ({ ok: true, data: {}, warnings: [] }) };
  };
  try {
    const path = completePath(organizationId, generatedContentDraftId, exportReviewQueueItemId);
    await completeReviewRequest(path, expectedUpdatedAt);
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

test("P3-15 canCompleteReview shows the control only for exportReviewQueueStatus=in_progress with exportReviewStatus=needs_gk_review", () => {
  assert.equal(canCompleteReview({ exportReviewQueueStatus: "in_progress", exportReviewStatus: "needs_gk_review" }), true);
  assert.equal(canCompleteReview({ exportReviewQueueStatus: "open", exportReviewStatus: "needs_gk_review" }), false);
  assert.equal(canCompleteReview({ exportReviewQueueStatus: "in_progress", exportReviewStatus: "resolved" }), false);
  assert.equal(canCompleteReview({ exportReviewQueueStatus: "blocked", exportReviewStatus: "needs_gk_review" }), false);
  assert.equal(canCompleteReview({ exportReviewQueueStatus: "resolved", exportReviewStatus: "resolved" }), false);
  assert.equal(canCompleteReview(null), false);
  assert.equal(canCompleteReview(undefined), false);
});

test("P3-15 decideCompleteResult: success", () => {
  assert.deepEqual(
    decideCompleteResult({ statusCode: 200, body: { ok: true, data: { queueStatus: "resolved" }, warnings: [] } }),
    { kind: "success" },
  );
});

test("P3-15 decideCompleteResult: conflict_current_state_changed never becomes a success and never retries", () => {
  assert.deepEqual(
    decideCompleteResult({
      statusCode: 409,
      body: { ok: false, error: { code: "conflict_current_state_changed", message: "The packet changed." }, data: null },
    }),
    { kind: "conflict" },
  );
});

test("P3-15 decideCompleteResult: other safe failures render the existing generic error convention", () => {
  const result = decideCompleteResult({
    statusCode: 403,
    body: { ok: false, error: { code: "authorization_denied", message: "Not authorized." }, data: null },
  });
  assert.deepEqual(result, { kind: "error", message: "Not authorized." });
});

test("P3-15 decideCompleteResult: a 200/ok:true paired with an unrelated body is still success (never inspected for packet data)", () => {
  assert.equal(decideCompleteResult({ statusCode: 200, body: { ok: true, data: null, warnings: [] } }).kind, "success");
});

test("P3-15 exactly one Complete Review control is wired in the component, gated by canCompleteReview", () => {
  const buttonMatches = jsxSource.match(/>\s*Complete Review\s*</g) || [];
  assert.equal(buttonMatches.length, 1);
  assert.match(jsxSource, /showCompleteControl\s*=\s*canCompleteReview\(model\)/);
  assert.match(jsxSource, /showCompleteControl \? \(/);
});

test("P3-15 Start Review remains gated by canStartReview and is untouched by this ticket", () => {
  const buttonMatches = jsxSource.match(/>\s*Start Review\s*</g) || [];
  assert.equal(buttonMatches.length, 1);
  assert.match(jsxSource, /showStartControl\s*=\s*canStartReview\(model\)/);
});

test("P3-15 the mutation call site sends only expectedUpdatedAt sourced from the current packet, never actorContext/now/roles", () => {
  assert.match(jsxSource, /completeReviewRequest\(\s*\n?\s*completePath\(organizationId, generatedContentDraftId, exportReviewQueueItemId\),\s*\n?\s*outcome\.model\.exportReviewUpdatedAt,/);
  assert.doesNotMatch(jsxSource, /actorContext/i);
  assert.doesNotMatch(jsxSource, /\bnow\s*:/);
  assert.doesNotMatch(logicSource, /body:\s*JSON\.stringify\(\{[^}]*actorContext/i);
  assert.doesNotMatch(logicSource, /\bnow\s*:/);
});

test("P3-15 duplicate submissions are prevented: an in-flight completion guards re-entry and disables the button", () => {
  assert.match(jsxSource, /if \(completePending \|\| outcome\?\.kind !== "success" \|\| !outcome\.model\) return;/);
  assert.match(jsxSource, /disabled=\{completePending\}/);
});

test("P3-15 success and conflict both resolve by re-fetching the packet once, never by trusting the complete response as the new packet", () => {
  assert.match(
    jsxSource,
    /const decided = decideCompleteResult\(result\);\s*\n\s*if \(decided\.kind === "success" \|\| decided\.kind === "conflict"\) \{\s*\n\s*await loadPacket\(\);/,
  );
  assert.doesNotMatch(jsxSource, /setOutcome\(decideCompleteResult/);
});

test("P3-15 other safe complete failures render an error message without touching packet state", () => {
  assert.match(jsxSource, /setCompleteErrorMessage\(decided\.message\)/);
});

test("P3-15 exportReviewUpdatedAt remains internal and is never rendered via FieldRow", () => {
  assert.doesNotMatch(jsxSource, /FieldRow[^)]*exportReviewUpdatedAt/);
  const occurrences = jsxSource.match(/exportReviewUpdatedAt/g) || [];
  assert.equal(occurrences.length, 2, "exportReviewUpdatedAt must appear exactly twice: the startReviewRequest and completeReviewRequest arguments");
});

test("P3-15 frontend source still contains no approve/export/finalize/publish/manifest/download or other post-review authority tokens", () => {
  const forbidden = /\b(approve|reject|finalize|mark-ready|markReady|download|affirmativeHumanExportAuthority|finalGate|clientReviewed|client-reviewed|funder-ready|funderReady|public-ready|publicReady|manifest)\b/i;
  assert.doesNotMatch(jsxSource, forbidden);
  assert.doesNotMatch(logicSource, forbidden);
  assert.equal((jsxSource.match(/<button/g) || []).length, 2);
});

test("P3-15 P3-08 citation rendering ('Why can KAI say this?') is unchanged", () => {
  assert.match(jsxSource, /Why can KAI say this\?/);
});

test("P3-15 no new page route, navigation entry, or entry.jsx mount point was added", () => {
  const entrySource = readFileSync("frontend/entry.jsx", "utf8");
  const indexSource = readFileSync("index.js", "utf8");
  assert.match(entrySource, /window\.renderGkExportReviewDetail\s*=/);
  const gkExportMatches = entrySource.match(/window\.renderGkExportReviewDetail\s*=/g) || [];
  assert.equal(gkExportMatches.length, 1);
  const routeMatches = indexSource.match(/app\.get\(\s*\n?\s*"\/gk-admin\//g) || [];
  // KAI UAT-enablement package additively mounted a second /gk-admin page
  // route (the internal review cockpit host page) after this P3-15 control
  // was accepted; this assertion is updated additively to reflect that.
  assert.equal(routeMatches.length, 2);
});
