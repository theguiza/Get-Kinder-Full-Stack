// P14-06 closure: proves the frontend/product wiring that exposes the now-
// complete packet export-review lifecycle (P14-05 REQUEST, P14-06A START,
// P14-06B COMPLETE) in the Impact Evidence Library Grant Response Packet
// card. Backend semantics are unchanged and are proven in their own
// dedicated suites - this file proves only: the pure lifecycle-state
// machine, the exact route/body builders, that the START/COMPLETE handlers
// act on the exact server-returned identity (never a guess), make exactly
// one mutation each, fabricate no queue state on failure, and preserve the
// existing engagement-switch/stale-response isolation - plus that no
// finalization/manifest/approval control was added anywhere.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  grantResponsePacketExportReviewStartPath,
  grantResponsePacketExportReviewCompletePath,
  grantResponsePacketExportReviewRequestPath,
  grantResponsePacketExportReviewLifecycleState,
  GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES,
  projectGrantResponsePacketExportReviewResult,
  reviewTransitionBody,
} from "../frontend/impactEvidenceLibraryLogic.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const engagementId = "00000000-0000-4000-8000-000000000401";
const candidateId = "00000000-0000-4000-8000-000000000b01";
const queueItemId = "00000000-0000-4000-8000-000000000901";
const reviewUpdatedAt = "2026-09-09T12:00:00.000Z";

const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

// ---------------------------------------------------------------------------
// Pure logic: route/body builders, response projection, lifecycle state
// ---------------------------------------------------------------------------

test("grantResponsePacketExportReviewStartPath builds the exact accepted route with organizationId + engagementId + candidateId + queueItemId, nothing else", () => {
  assert.equal(
    grantResponsePacketExportReviewStartPath(organizationId, engagementId, candidateId, queueItemId),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}`
      + `/engagements/${engagementId}/grant-response-packet/export-candidates`
      + `/${candidateId}/export-review-queue/${queueItemId}/start`,
  );
});

test("grantResponsePacketExportReviewCompletePath builds the exact accepted route with organizationId + engagementId + candidateId + queueItemId, nothing else", () => {
  assert.equal(
    grantResponsePacketExportReviewCompletePath(organizationId, engagementId, candidateId, queueItemId),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}`
      + `/engagements/${engagementId}/grant-response-packet/export-candidates`
      + `/${candidateId}/export-review-queue/${queueItemId}/complete`,
  );
});

test("grantResponsePacketExportReviewStartPath/CompletePath are distinct from grantResponsePacketExportReviewRequestPath (three exact sibling routes, never conflated)", () => {
  const requestPath = grantResponsePacketExportReviewRequestPath(organizationId, engagementId, candidateId);
  const startPath = grantResponsePacketExportReviewStartPath(organizationId, engagementId, candidateId, queueItemId);
  const completePath = grantResponsePacketExportReviewCompletePath(organizationId, engagementId, candidateId, queueItemId);
  assert.notEqual(requestPath, startPath);
  assert.notEqual(startPath, completePath);
  assert.notEqual(requestPath, completePath);
  assert.match(startPath, /\/start$/);
  assert.match(completePath, /\/complete$/);
});

test("reviewTransitionBody sends only expected_updated_at - no actorContext, now, or other authority data", () => {
  assert.deepEqual(reviewTransitionBody(reviewUpdatedAt), { expected_updated_at: reviewUpdatedAt });
  assert.deepEqual(Object.keys(reviewTransitionBody(reviewUpdatedAt)), ["expected_updated_at"]);
});

test("projectGrantResponsePacketExportReviewResult retains reviewUpdatedAt - the exact CAS token the next START/COMPLETE call must echo back", () => {
  const projected = projectGrantResponsePacketExportReviewResult({
    organizationId,
    engagementId,
    grantResponsePacketExportCandidateId: candidateId,
    reviewQueueItemId: queueItemId,
    queueStatus: "in_progress",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt,
    replayed: false,
  });
  assert.equal(projected.reviewUpdatedAt, reviewUpdatedAt);
  assert.equal(projected.grantResponsePacketExportCandidateId, candidateId);
  assert.equal(projected.reviewQueueItemId, queueItemId);
});

test("projectGrantResponsePacketExportReviewResult never fabricates a reviewUpdatedAt when the server omits or malforms it", () => {
  assert.equal(projectGrantResponsePacketExportReviewResult({ queueStatus: "open" }).reviewUpdatedAt, null);
  assert.equal(projectGrantResponsePacketExportReviewResult({ reviewUpdatedAt: 12345 }).reviewUpdatedAt, null);
  assert.equal(projectGrantResponsePacketExportReviewResult(null), null);
});

test("grantResponsePacketExportReviewLifecycleState: no review result -> requestable (Request export review)", () => {
  assert.equal(
    grantResponsePacketExportReviewLifecycleState(null),
    GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.requestable,
  );
});

test("grantResponsePacketExportReviewLifecycleState: open/needs_gk_review -> startable (Start export review)", () => {
  assert.equal(
    grantResponsePacketExportReviewLifecycleState({ queueStatus: "open", reviewStatus: "needs_gk_review" }),
    GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.startable,
  );
});

test("grantResponsePacketExportReviewLifecycleState: in_progress/needs_gk_review -> completable (Complete export review)", () => {
  assert.equal(
    grantResponsePacketExportReviewLifecycleState({ queueStatus: "in_progress", reviewStatus: "needs_gk_review" }),
    GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.completable,
  );
});

test("grantResponsePacketExportReviewLifecycleState: resolved/resolved -> resolved (Export review complete display, no control)", () => {
  assert.equal(
    grantResponsePacketExportReviewLifecycleState({ queueStatus: "resolved", reviewStatus: "resolved" }),
    GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES.resolved,
  );
});

test("grantResponsePacketExportReviewLifecycleState: every state maps to exactly one control - no two states share a display", () => {
  const states = [
    grantResponsePacketExportReviewLifecycleState(null),
    grantResponsePacketExportReviewLifecycleState({ queueStatus: "open", reviewStatus: "needs_gk_review" }),
    grantResponsePacketExportReviewLifecycleState({ queueStatus: "in_progress", reviewStatus: "needs_gk_review" }),
    grantResponsePacketExportReviewLifecycleState({ queueStatus: "resolved", reviewStatus: "resolved" }),
  ];
  assert.equal(new Set(states).size, 4);
});

// ---------------------------------------------------------------------------
// JSX handler source proofs (static, same convention as
// grantPacketRequestHandlerSource in kai-sprint2-impact-library-grant-
// response-packet.spec.js): each handler is sliced out by its own unique
// start/end markers and inspected for the exact identity/CAS/guard/refetch
// shape it must have - not merely that matching text is present anywhere.
// ---------------------------------------------------------------------------

function startHandlerSource() {
  const start = uiSource.indexOf("const startGrantResponsePacketExportReview = useCallback(async () => {");
  assert.notEqual(start, -1, "could not locate startGrantResponsePacketExportReview");
  const end = uiSource.indexOf("const completeGrantResponsePacketExportReview = useCallback", start);
  assert.notEqual(end, -1, "could not locate end of startGrantResponsePacketExportReview block");
  return uiSource.slice(start, end);
}

function completeHandlerSource() {
  const start = uiSource.indexOf("const completeGrantResponsePacketExportReview = useCallback(async () => {");
  assert.notEqual(start, -1, "could not locate completeGrantResponsePacketExportReview");
  const end = uiSource.indexOf("const runAssessRequirement = useCallback", start);
  assert.notEqual(end, -1, "could not locate end of completeGrantResponsePacketExportReview block");
  return uiSource.slice(start, end);
}

test("startGrantResponsePacketExportReview acts on the exact candidate id, queue item id, and reviewUpdatedAt CAS token from grantResponsePacketExportReviewResult - never a guess", () => {
  const handler = startHandlerSource();
  assert.match(handler, /const candidateId = grantResponsePacketExportReviewResult\?\.grantResponsePacketExportCandidateId;/);
  assert.match(handler, /const queueItemId = grantResponsePacketExportReviewResult\?\.reviewQueueItemId;/);
  assert.match(handler, /const expectedUpdatedAt = grantResponsePacketExportReviewResult\?\.reviewUpdatedAt;/);
  assert.match(
    handler,
    /grantResponsePacketExportReviewStartPath\(requestOrganizationId, requestEngagementId, candidateId, queueItemId\)/,
  );
  assert.match(handler, /reviewTransitionBody\(expectedUpdatedAt\)/);
});

test("startGrantResponsePacketExportReview only fires from the exact startable lifecycle state (open/needs_gk_review)", () => {
  const handler = startHandlerSource();
  assert.match(
    handler,
    /grantResponsePacketExportReviewLifecycleState\(grantResponsePacketExportReviewResult\)\s*\n?\s*!==\s*GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES\.startable/,
  );
});

test("startGrantResponsePacketExportReview makes exactly one mutation and refetches authoritative packet state only after success", () => {
  const handler = startHandlerSource();
  assert.equal((handler.match(/postJson\(/g) || []).length, 1);
  assert.match(handler, /await refetchGrantResponsePacketAfterMemberExportReviewRequest\(requestOrganizationId, requestEngagementId\);/);
});

test("startGrantResponsePacketExportReview fabricates no queue state on a failed or conflicting POST", () => {
  const handler = startHandlerSource();
  const failureBranchStart = handler.indexOf("if (result.statusCode !== 200 && result.statusCode !== 201) {");
  assert.notEqual(failureBranchStart, -1);
  const failureBranchEnd = handler.indexOf("return;", failureBranchStart) + "return;".length;
  const failureBranch = handler.slice(failureBranchStart, failureBranchEnd);
  assert.doesNotMatch(failureBranch, /setGrantResponsePacketExportReviewResult\(/);
  assert.match(failureBranch, /setGrantResponsePacketExportReviewStartError\(errorText\(result\)\);/);
});

test("startGrantResponsePacketExportReview uses the authoritative refetch as durable success state when the engagement/organization selection is still current", () => {
  const handler = startHandlerSource();
  assert.match(handler, /const stillCurrent = requestOrganizationId === organizationIdRef\.current\s*\n?\s*&& requestEngagementId === engagementIdRef\.current;/);
  assert.match(handler, /await refetchGrantResponsePacketAfterMemberExportReviewRequest\(requestOrganizationId, requestEngagementId\);/);
  assert.doesNotMatch(handler, /projectGrantResponsePacketExportReviewResult\(result\.body\?\.data\)/);
});

test("completeGrantResponsePacketExportReview acts on the exact candidate id, queue item id, and reviewUpdatedAt CAS token from grantResponsePacketExportReviewResult - never a guess", () => {
  const handler = completeHandlerSource();
  assert.match(handler, /const candidateId = grantResponsePacketExportReviewResult\?\.grantResponsePacketExportCandidateId;/);
  assert.match(handler, /const queueItemId = grantResponsePacketExportReviewResult\?\.reviewQueueItemId;/);
  assert.match(handler, /const expectedUpdatedAt = grantResponsePacketExportReviewResult\?\.reviewUpdatedAt;/);
  assert.match(
    handler,
    /grantResponsePacketExportReviewCompletePath\(requestOrganizationId, requestEngagementId, candidateId, queueItemId\)/,
  );
  assert.match(handler, /reviewTransitionBody\(expectedUpdatedAt\)/);
});

test("completeGrantResponsePacketExportReview only fires from the exact completable lifecycle state (in_progress/needs_gk_review)", () => {
  const handler = completeHandlerSource();
  assert.match(
    handler,
    /grantResponsePacketExportReviewLifecycleState\(grantResponsePacketExportReviewResult\)\s*\n?\s*!==\s*GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES\.completable/,
  );
});

test("completeGrantResponsePacketExportReview makes exactly one mutation and refetches authoritative packet state only after success", () => {
  const handler = completeHandlerSource();
  assert.equal((handler.match(/postJson\(/g) || []).length, 1);
  assert.match(handler, /await refetchGrantResponsePacketAfterMemberExportReviewRequest\(requestOrganizationId, requestEngagementId\);/);
});

test("completeGrantResponsePacketExportReview fabricates no queue state on a failed or conflicting POST", () => {
  const handler = completeHandlerSource();
  const failureBranchStart = handler.indexOf("if (result.statusCode !== 200 && result.statusCode !== 201) {");
  assert.notEqual(failureBranchStart, -1);
  const failureBranchEnd = handler.indexOf("return;", failureBranchStart) + "return;".length;
  const failureBranch = handler.slice(failureBranchStart, failureBranchEnd);
  assert.doesNotMatch(failureBranch, /setGrantResponsePacketExportReviewResult\(/);
  assert.match(failureBranch, /setGrantResponsePacketExportReviewCompleteError\(errorText\(result\)\);/);
});

test("completeGrantResponsePacketExportReview uses the authoritative refetch as durable success state when the engagement/organization selection is still current", () => {
  const handler = completeHandlerSource();
  assert.match(handler, /const stillCurrent = requestOrganizationId === organizationIdRef\.current\s*\n?\s*&& requestEngagementId === engagementIdRef\.current;/);
  assert.match(handler, /await refetchGrantResponsePacketAfterMemberExportReviewRequest\(requestOrganizationId, requestEngagementId\);/);
  assert.doesNotMatch(handler, /projectGrantResponsePacketExportReviewResult\(result\.body\?\.data\)/);
});

test("the engagement-switch reset effect also clears START/COMPLETE pending/error state (no stale control survives an engagement switch)", () => {
  const anchor = "grantPacketRequestGenerationRef.current += 1;";
  const anchorIdx = uiSource.indexOf(anchor);
  assert.notEqual(anchorIdx, -1);
  const tailMarker = "}, [organizationId, engagementId]);";
  const tailIdx = uiSource.indexOf(tailMarker, anchorIdx);
  assert.notEqual(tailIdx, -1);
  const resetEffect = uiSource.slice(anchorIdx, tailIdx);
  assert.match(resetEffect, /setGrantResponsePacketExportReviewStartPending\(false\);/);
  assert.match(resetEffect, /setGrantResponsePacketExportReviewStartError\(""\);/);
  assert.match(resetEffect, /setGrantResponsePacketExportReviewCompletePending\(false\);/);
  assert.match(resetEffect, /setGrantResponsePacketExportReviewCompleteError\(""\);/);
});

test("creating (or reusing) an export candidate also resets any prior START/COMPLETE state, distinct from just the REQUEST state", () => {
  const start = uiSource.indexOf("const createGrantResponsePacketExportCandidate = useCallback(async () => {");
  assert.notEqual(start, -1);
  const end = uiSource.indexOf("const requestGrantResponsePacketExportReview = useCallback", start);
  assert.notEqual(end, -1);
  const handler = uiSource.slice(start, end);
  assert.match(handler, /setGrantResponsePacketExportReviewStartPending\(false\);/);
  assert.match(handler, /setGrantResponsePacketExportReviewStartError\(""\);/);
  assert.match(handler, /setGrantResponsePacketExportReviewCompletePending\(false\);/);
  assert.match(handler, /setGrantResponsePacketExportReviewCompleteError\(""\);/);
});

// ---------------------------------------------------------------------------
// Render-block proofs: one control per lifecycle state, no finalization
// controls, distinct from member-level workflows, existing surfaces
// unchanged.
// ---------------------------------------------------------------------------

function grantResponsePacketSection() {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  assert.notEqual(sectionStart, -1);
  assert.notEqual(sectionEnd, -1);
  return uiSource.slice(sectionStart, sectionEnd);
}

test("the packet card renders the Request control only in the requestable lifecycle state, and Start/Complete controls only in their own exact states", () => {
  const section = grantResponsePacketSection();
  assert.match(
    section,
    /grantResponsePacketExportReviewLifecycleState\(grantResponsePacketExportReviewResult\)\s*\n?\s*=== GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES\.requestable/,
  );
  assert.match(
    section,
    /grantResponsePacketExportReviewLifecycleState\(grantResponsePacketExportReviewResult\)\s*\n?\s*=== GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES\.startable/,
  );
  assert.match(
    section,
    /grantResponsePacketExportReviewLifecycleState\(grantResponsePacketExportReviewResult\)\s*\n?\s*=== GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES\.completable/,
  );
  assert.match(
    section,
    /grantResponsePacketExportReviewLifecycleState\(grantResponsePacketExportReviewResult\)\s*\n?\s*=== GRANT_RESPONSE_PACKET_EXPORT_REVIEW_LIFECYCLE_STATES\.resolved/,
  );
});

test("the resolved lifecycle state renders a static display only - no onClick handler, no button", () => {
  const section = grantResponsePacketSection();
  const resolvedIdx = section.indexOf("grant-response-packet-export-review-resolved-badge");
  assert.notEqual(resolvedIdx, -1);
  const blockStart = section.lastIndexOf("<div className=\"mt-2\">", resolvedIdx);
  const blockEnd = section.indexOf("</div>\n                    ) : null}", blockStart);
  const block = section.slice(blockStart, blockEnd);
  assert.doesNotMatch(block, /onClick/);
  assert.doesNotMatch(block, /<button/);
});

test("the packet card adds no finalization, manifest, or approval control anywhere in its own section", () => {
  const section = grantResponsePacketSection();
  assert.doesNotMatch(section, /\bApprove\b|\bApproved\b|\bFinalize\b|Create Export Manifest|grant.*final.*release.*authority/i);
});

test("packet-level Start/Complete controls are visually and structurally distinct from member-level Request Export Review / GK export review links", () => {
  const section = grantResponsePacketSection();
  assert.doesNotMatch(section, /grant-response-packet-export-review-start-button[\s\S]{0,200}gkExportReviewDetailPagePath/);
  assert.doesNotMatch(section, /grant-response-packet-export-review-complete-button[\s\S]{0,200}gkExportReviewDetailPagePath/);
  assert.match(section, /grant-response-packet-export-review-start-button/);
  assert.match(section, /grant-response-packet-export-review-complete-button/);
});

test("the packet-level Markdown preview affordance is untouched by this package (still a plain download link, no POST, no lifecycle gating)", () => {
  const section = grantResponsePacketSection();
  const previewLinkIdx = section.indexOf("grant-response-packet-preview-markdown-link");
  assert.notEqual(previewLinkIdx, -1);
  const previewBlockEnd = section.indexOf("</a>", previewLinkIdx) + "</a>".length;
  const previewBlock = section.slice(previewLinkIdx, previewBlockEnd);
  assert.doesNotMatch(previewBlock, /postJson|grantResponsePacketExportReviewLifecycleState/);
});

test("the packet candidate-creation control is untouched by this package (still its own independent button, unconditioned on review lifecycle state)", () => {
  const section = grantResponsePacketSection();
  const candidateButtonIdx = section.indexOf("grant-response-packet-export-candidate-button");
  assert.notEqual(candidateButtonIdx, -1);
  const candidateBlockStart = section.lastIndexOf("<button", candidateButtonIdx);
  const candidateBlockEnd = section.indexOf("</button>", candidateBlockStart) + "</button>".length;
  const candidateBlock = section.slice(candidateBlockStart, candidateBlockEnd);
  assert.doesNotMatch(candidateBlock, /grantResponsePacketExportReviewLifecycleState/);
});
