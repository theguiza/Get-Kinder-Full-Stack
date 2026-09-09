import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  EXPORT_REVIEW_DISPLAY_STATES,
  exportReviewRequestBody,
  exportReviewRequestPath,
  generatedDraftExportReviewDisplayState,
  grantResponsePacketPath,
  grantResponsePacketMarkdownPath,
  projectGrantResponsePacket,
  projectExportReviewRequestResult,
  shouldApplyGrantResponsePacketResponse,
  gkExportReviewDetailPagePath,
} from "../frontend/impactEvidenceLibraryLogic.js";
import {
  exportManifestCsvPath,
  exportManifestDocxPath,
  exportManifestMarkdownPath,
  exportManifestPdfPath,
} from "../frontend/gkExportReviewDetailLogic.js";

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
const exportManifestIdA = "00000000-0000-4000-8000-000000000a01";
const exportManifestIdB = "00000000-0000-4000-8000-000000000a02";
const exportManifestIdOtherMember = "00000000-0000-4000-8000-000000000a03";
const exportCandidateIdA = "00000000-0000-4000-8000-000000000b01";
const exportCandidateIdB = "00000000-0000-4000-8000-000000000b02";
const requestedExportAudience = "funder";

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

test("grantResponsePacketMarkdownPath builds the exact existing PREVIEW_READ_ONLY packet-level Markdown route with organizationId + engagementId, nothing else", () => {
  assert.equal(
    grantResponsePacketMarkdownPath(organizationId, engagementIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}`
      + `/engagements/${engagementIdA}/grant-response-packet/markdown`,
  );
  assert.equal(
    grantResponsePacketMarkdownPath(organizationId, engagementIdB),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}`
      + `/engagements/${engagementIdB}/grant-response-packet/markdown`,
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

test("projectGrantResponsePacket preserves authorized exportManifestId separately from the exact exportManifestHistory records", () => {
  const history = [
    { exportManifestId: exportManifestIdA, exportCandidateId: exportCandidateIdA, createdAt: "2026-09-01T00:00:00.000Z" },
    { exportManifestId: exportManifestIdB, exportCandidateId: exportCandidateIdB, createdAt: "2026-09-02T00:00:00.000Z" },
  ];
  const projected = projectGrantResponsePacket({
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "funder",
    drafts: [{
      generatedContentDraftId: draftId,
      exportReviewVisible: true,
      exportManifestId: exportManifestIdB,
      exportManifestHistory: history,
      blocks: [],
    }],
  });

  assert.equal(projected.drafts[0].exportManifestId, exportManifestIdB);
  assert.deepEqual(projected.drafts[0].exportManifestHistory, history);
  assert.equal(projected.drafts[0].exportManifestHistory.length, 2);
});

test("projectGrantResponsePacket removes manifest identity/history for restricted actors, distinct from authorized empty history", () => {
  const restricted = projectGrantResponsePacket({
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "funder",
    drafts: [{
      generatedContentDraftId: draftId,
      exportReviewVisible: false,
      exportManifestId: exportManifestIdA,
      exportManifestHistory: [
        { exportManifestId: exportManifestIdA, exportCandidateId: exportCandidateIdA, createdAt: "2026-09-01T00:00:00.000Z" },
      ],
      blocks: [],
    }],
  });
  assert.equal(restricted.drafts[0].exportReviewVisible, false);
  assert.equal(restricted.drafts[0].exportManifestId, null);
  assert.deepEqual(restricted.drafts[0].exportManifestHistory, []);

  const authorizedEmpty = projectGrantResponsePacket({
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "funder",
    drafts: [{
      generatedContentDraftId: draftId,
      exportReviewVisible: true,
      exportManifestId: null,
      exportManifestHistory: [],
      blocks: [],
    }],
  });
  assert.equal(authorizedEmpty.drafts[0].exportReviewVisible, true);
  assert.equal(authorizedEmpty.drafts[0].exportManifestId, null);
  assert.deepEqual(authorizedEmpty.drafts[0].exportManifestHistory, []);
});

test("projectGrantResponsePacket preserves multiple manifest-history entries in server order and does not manufacture a duplicate for exportManifestId", () => {
  const projected = projectGrantResponsePacket({
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "funder",
    drafts: [{
      generatedContentDraftId: draftId,
      exportReviewVisible: true,
      exportManifestId: exportManifestIdB,
      exportManifestHistory: [
        { exportManifestId: exportManifestIdB, exportCandidateId: exportCandidateIdB, createdAt: "2026-09-02T00:00:00.000Z" },
        { exportManifestId: exportManifestIdA, exportCandidateId: exportCandidateIdA, createdAt: "2026-09-01T00:00:00.000Z" },
      ],
      blocks: [],
    }],
  });

  assert.deepEqual(
    projected.drafts[0].exportManifestHistory.map((entry) => entry.exportManifestId),
    [exportManifestIdB, exportManifestIdA],
  );
  assert.equal(projected.drafts[0].exportManifestHistory.length, 2);
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

test("Grant Response Packet request-control authority reuses the existing Generated Draft export-review display state exactly", () => {
  const requestable = {
    exportReviewVisible: true,
    exportReviewQueueItemId: null,
    queueStatus: "resolved",
    reviewStatus: "resolved",
  };
  assert.equal(generatedDraftExportReviewDisplayState(requestable), EXPORT_REVIEW_DISPLAY_STATES.requestable);

  const restricted = { ...requestable, exportReviewVisible: false };
  assert.equal(generatedDraftExportReviewDisplayState(restricted), EXPORT_REVIEW_DISPLAY_STATES.restricted);

  const existing = { ...requestable, exportReviewQueueItemId };
  assert.equal(generatedDraftExportReviewDisplayState(existing), EXPORT_REVIEW_DISPLAY_STATES.existing);
});

test("Grant Response Packet Request Export Review uses the existing exact single-draft endpoint and funder audience body", () => {
  assert.equal(
    exportReviewRequestPath(organizationId, draftId),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/generated-content-drafts/${draftId}/export-review-request`,
  );
  assert.deepEqual(exportReviewRequestBody(requestedExportAudience), { requested_export_audience: "funder" });
});

// ---------------------------------------------------------------------------
// Component wiring: exact single request, no per-member fan-out, no new
// approval/finalization authority, exact GK export-review nav reuse.
// ---------------------------------------------------------------------------

const uiSource = readFileSync("frontend/ImpactEvidenceLibrary.jsx", "utf8");

test("ImpactEvidenceLibrary.jsx calls grantResponsePacketPath from the initial packet load and the post-request authoritative refetch only - never a per-member/per-draft fetch loop", () => {
  const matches = uiSource.match(/grantResponsePacketPath\(/g) || [];
  assert.equal(matches.length, 2);
});

test("ImpactEvidenceLibrary.jsx imports and reuses the exact existing export-manifest download route builders", () => {
  assert.match(uiSource, /exportManifestMarkdownPath/);
  assert.match(uiSource, /exportManifestCsvPath/);
  assert.match(uiSource, /exportManifestPdfPath/);
  assert.match(uiSource, /exportManifestDocxPath/);
  assert.equal(
    exportManifestMarkdownPath(organizationId, exportManifestIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/export-manifests/${exportManifestIdA}/markdown`,
  );
  assert.equal(
    exportManifestCsvPath(organizationId, exportManifestIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/export-manifests/${exportManifestIdA}/csv`,
  );
  assert.equal(
    exportManifestPdfPath(organizationId, exportManifestIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/export-manifests/${exportManifestIdA}/pdf`,
  );
  assert.equal(
    exportManifestDocxPath(organizationId, exportManifestIdA),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}/export-manifests/${exportManifestIdA}/docx`,
  );
});

test("ImpactEvidenceLibrary.jsx imports and reuses grantResponsePacketMarkdownPath for the packet-level Markdown preview affordance", () => {
  assert.match(uiSource, /grantResponsePacketMarkdownPath/);
});

test("ImpactEvidenceLibrary.jsx Grant Response Packet section renders a packet-level Download Markdown preview action keyed by exactly organizationId + engagementId, never a member/manifest/candidate id", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  assert.notEqual(sectionStart, -1);
  assert.notEqual(sectionEnd, -1);
  const section = uiSource.slice(sectionStart, sectionEnd);

  assert.match(section, /Download Markdown preview/);
  assert.match(
    section,
    /href=\{grantResponsePacketMarkdownPath\(organizationId,\s*engagementId\)\}/,
  );

  const previewLinkIdx = section.indexOf("Download Markdown preview");
  const previewBlockStart = section.lastIndexOf("<a", previewLinkIdx);
  const previewBlockEnd = section.indexOf("</a>", previewLinkIdx) + "</a>".length;
  const previewBlock = section.slice(previewBlockStart, previewBlockEnd);
  assert.doesNotMatch(previewBlock, /generatedContentDraftId/);
  assert.doesNotMatch(previewBlock, /exportManifestId/);
  assert.doesNotMatch(previewBlock, /exportCandidateId/);
  assert.doesNotMatch(previewBlock, /draft\./);
  assert.doesNotMatch(previewBlock, /entry\./);
});

test("ImpactEvidenceLibrary.jsx Grant Response Packet packet-level preview affordance is explicit that it is a preview/draft, never final/approved/finalized wording, and issues no POST", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  const section = uiSource.slice(sectionStart, sectionEnd);

  const previewLinkIdx = section.indexOf("Download Markdown preview");
  assert.notEqual(previewLinkIdx, -1);
  const previewBlockStart = section.lastIndexOf("<div", section.lastIndexOf("<a", previewLinkIdx));
  const previewBlockEnd = section.indexOf("</div>", section.indexOf("</a>", previewLinkIdx)) + "</div>".length;
  const previewBlock = section.slice(previewBlockStart, previewBlockEnd);

  assert.match(previewBlock, /[Pp]review/);
  assert.doesNotMatch(previewBlock, /\bFinal\b/);
  assert.doesNotMatch(previewBlock, /Final export/i);
  assert.doesNotMatch(previewBlock, /Approved/i);
  assert.doesNotMatch(previewBlock, /Funder-ready export/i);
  assert.doesNotMatch(previewBlock, /Finalized packet/i);
  assert.doesNotMatch(previewBlock, /Export manifest/i);
  assert.doesNotMatch(previewBlock, /postJson/);
});

test("ImpactEvidenceLibrary.jsx Grant Response Packet packet-level preview link renders whenever an engagement is selected (reuses the card's own engagement-selected visibility, no separate packet-selection state)", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  const section = uiSource.slice(sectionStart, sectionEnd);

  const engagementGateIdx = section.indexOf("{engagementId ? (");
  const previewLinkIdx = section.indexOf("Download Markdown preview");
  assert.notEqual(engagementGateIdx, -1);
  assert.ok(
    engagementGateIdx < previewLinkIdx,
    "the Download Markdown preview link must be gated by the same engagementId truthiness check as the rest of the card",
  );
});

test("ImpactEvidenceLibrary.jsx Grant Response Packet packet-level preview link stays distinct from per-member export download links (different class, no exportManifestId/entry usage)", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  const section = uiSource.slice(sectionStart, sectionEnd);

  assert.match(section, /grant-response-packet-preview-markdown-link/);
  assert.match(section, /grant-response-packet-download-markdown-link/);
  assert.notEqual(
    (section.match(/grant-response-packet-preview-markdown-link/g) || []).length,
    0,
  );

  const previewLinkIdx = section.indexOf("grant-response-packet-preview-markdown-link");
  const previewBlockEnd = section.indexOf("</a>", previewLinkIdx) + "</a>".length;
  const previewBlock = section.slice(previewLinkIdx, previewBlockEnd);
  assert.doesNotMatch(previewBlock, /entry\.exportManifestId/);
  assert.doesNotMatch(previewBlock, /exportManifestMarkdownPath/);
});

test("ImpactEvidenceLibrary.jsx Grant Response Packet section adds Request/Start/Complete for the packet's own governed review lifecycle (P14-05/P14-06A/P14-06B), but no finalize/manifest/approval authority", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  assert.notEqual(sectionStart, -1);
  assert.notEqual(sectionEnd, -1);
  const section = uiSource.slice(sectionStart, sectionEnd);
  assert.match(section, /Request export review/);
  assert.match(section, /Start export review/);
  assert.match(section, /Complete export review/);
  assert.doesNotMatch(section, /Approve|Finalize|Create Export Manifest/);
});

test("ImpactEvidenceLibrary.jsx Grant Response Packet Request Export Review renders only for the existing requestable display state", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  const section = uiSource.slice(sectionStart, sectionEnd);
  assert.match(
    section,
    /generatedDraftExportReviewDisplayState\(draft\) === EXPORT_REVIEW_DISPLAY_STATES\.requestable/,
  );
  assert.match(section, /onClick=\{\(\) => requestGrantResponsePacketMemberExportReview\(draft\)\}/);
  assert.match(section, /disabled=\{grantResponsePacketExportReviewRequestPendingDraftId === draft\.generatedContentDraftId\}/);
  assert.doesNotMatch(section, /setGrantResponsePacket\([^)]*exportReviewQueueItemId/);
});

function grantPacketRequestHandlerSource() {
  const start = uiSource.indexOf("const requestGrantResponsePacketMemberExportReview = useCallback(async (draft) => {");
  assert.notEqual(start, -1, "could not locate Grant Response Packet member request handler");
  const endMarker = "  // Runs (or replays) the server-governed assessment";
  const end = uiSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, "could not locate end of Grant Response Packet member request handler block");
  return uiSource.slice(start, end);
}

test("Grant Response Packet member request handler targets the exact member draft and current organization, not engagement or a derived draft", () => {
  const handler = grantPacketRequestHandlerSource();
  assert.match(handler, /const requestOrganizationId = organizationId;/);
  assert.match(handler, /const requestEngagementId = engagementId;/);
  assert.match(
    handler,
    /postJson\(\s*exportReviewRequestPath\(requestOrganizationId, draft\.generatedContentDraftId\),\s*exportReviewRequestBody\(draft\.requestedAudience\),?\s*\)/,
  );
  assert.doesNotMatch(handler, /exportReviewRequestPath\([^)]*engagementId/);
  assert.doesNotMatch(handler, /selectedGeneratedDraftId|generatedDraftPacket\.generatedContentDraftId/);
});

test("Grant Response Packet member request handler makes one mutation and uses the POST response only for accepted/blocker branching", () => {
  const handler = grantPacketRequestHandlerSource();
  assert.equal((handler.match(/postJson\(/g) || []).length, 1);
  assert.match(handler, /const projected = projectExportReviewRequestResult\(result\.body\?\.data\);/);
  assert.match(handler, /if \(projected\?\.accepted\) \{/);
  assert.match(handler, /await refetchGrantResponsePacketAfterMemberExportReviewRequest\(requestOrganizationId, requestEngagementId\);/);
  assert.doesNotMatch(handler, /setGrantResponsePacket\(/);
  assert.doesNotMatch(handler, /setGrantResponsePacket\([^)]*(reviewQueueItemId|exportReviewQueueItemId|queueStatus|reviewStatus)/);
});

test("Grant Response Packet member request handler keeps failed mutations local, preserves current packet state, and fabricates no queue state", () => {
  const handler = grantPacketRequestHandlerSource();
  assert.match(handler, /if \(result\.statusCode !== 200 && result\.statusCode !== 201\) \{/);
  assert.match(handler, /setMessage\(errorText\(result\)\);/);
  assert.doesNotMatch(handler, /setGrantResponsePacket\(null\)[\s\S]*setMessage\(errorText\(result\)\)/);
  assert.doesNotMatch(handler, /setGrantResponsePacket\([^)]*(queue|review|manifest)/i);
});

test("Grant Response Packet authoritative refetch uses the existing organization/engagement late-response protection and supplies durable queue identity", () => {
  const refetchStart = uiSource.indexOf("const refetchGrantResponsePacketAfterMemberExportReviewRequest = useCallback(async (requestOrganizationId, requestEngagementId) => {");
  assert.notEqual(refetchStart, -1);
  const refetchEnd = uiSource.indexOf("const requestGrantResponsePacketMemberExportReview = useCallback", refetchStart);
  assert.notEqual(refetchEnd, -1);
  const refetch = uiSource.slice(refetchStart, refetchEnd);
  assert.match(refetch, /const requestGeneration = \+\+grantPacketRequestGenerationRef\.current;/);
  assert.match(refetch, /getJson\(grantResponsePacketPath\(requestOrganizationId, requestEngagementId\)\)/);
  assert.match(refetch, /shouldApplyGrantResponsePacketResponse\(\{/);
  assert.match(refetch, /currentOrganizationId: organizationIdRef\.current/);
  assert.match(refetch, /currentEngagementId: engagementIdRef\.current/);
  assert.match(refetch, /setGrantResponsePacket\(projectGrantResponsePacket\(result\.body\.data\)\)/);
  assert.doesNotMatch(refetch, /postJson|exportReviewRequestPath/);
});

test("Grant Response Packet request accepted DTO projection remains non-authoritative queue state for the packet card", () => {
  const projected = projectExportReviewRequestResult({
    exportReviewRequestAccepted: true,
    reviewQueueItemId: exportReviewQueueItemId,
    queueStatus: "open",
    reviewStatus: "needs_export_review",
    validatorResult: null,
  });
  assert.equal(projected.accepted, true);
  assert.equal(projected.exportReviewQueueItemId, exportReviewQueueItemId);
  const handler = grantPacketRequestHandlerSource();
  assert.doesNotMatch(handler, /projected\.exportReviewQueueItemId/);
  assert.doesNotMatch(handler, /projected\.(queueStatus|reviewStatus)/);
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

test("ImpactEvidenceLibrary.jsx Grant Response Packet section renders restricted and authorized-empty export history states distinctly", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  const section = uiSource.slice(sectionStart, sectionEnd);
  assert.match(section, /Existing exports/);
  assert.match(section, /Export history unavailable for your role/);
  assert.match(section, /No finalized export manifests for this packet member/);
  assert.match(section, /!draft\.exportReviewVisible/);
  assert.match(section, /draft\.exportReviewVisible && draft\.exportManifestHistory\.length === 0/);
});

test("ImpactEvidenceLibrary.jsx Grant Response Packet section renders every manifest-history entry in server order without latest/newest/current selection labels", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  const section = uiSource.slice(sectionStart, sectionEnd);
  assert.match(section, /draft\.exportManifestHistory\.map\(\(entry\) =>/);
  assert.doesNotMatch(section, /sort\(/);
  const existingExportsStart = section.indexOf("Existing exports");
  const blocksStart = section.indexOf("Blocks", existingExportsStart);
  const existingExportsSection = section.slice(existingExportsStart, blocksStart);
  assert.doesNotMatch(existingExportsSection, /latest|newest|current|preferred|canonical/i);
});

test("ImpactEvidenceLibrary.jsx Grant Response Packet download links use each history entry's exact exportManifestId for Markdown, CSV, PDF, and DOCX", () => {
  const sectionStart = uiSource.indexOf('<h5 className="mb-0">Grant Response Packet</h5>');
  const sectionEnd = uiSource.indexOf('<h5 className="mb-0">Generated Drafts</h5>');
  const section = uiSource.slice(sectionStart, sectionEnd);
  assert.match(section, /href=\{exportManifestMarkdownPath\(organizationId, entry\.exportManifestId\)\}/);
  assert.match(section, /href=\{exportManifestCsvPath\(organizationId, entry\.exportManifestId\)\}/);
  assert.match(section, /href=\{exportManifestPdfPath\(organizationId, entry\.exportManifestId\)\}/);
  assert.match(section, /href=\{exportManifestDocxPath\(organizationId, entry\.exportManifestId\)\}/);
  assert.doesNotMatch(section, /exportManifestMarkdownPath\(organizationId, draft\.exportManifestId\)/);
  assert.doesNotMatch(section, /exportManifestCsvPath\(organizationId, draft\.exportManifestId\)/);
  assert.doesNotMatch(section, /exportManifestPdfPath\(organizationId, draft\.exportManifestId\)/);
  assert.doesNotMatch(section, /exportManifestDocxPath\(organizationId, draft\.exportManifestId\)/);
  assert.doesNotMatch(section, /exportManifest(?:Markdown|Csv|Pdf|Docx)Path\(organizationId,\s*(?:draft\.generatedContentDraftId|draft\.engagementId|engagementId|index|0|1)\)/);
});

test("projectGrantResponsePacket keeps one packet member from substituting another member's manifest id", () => {
  const draftIdB = "00000000-0000-4000-8000-000000000778";
  const projected = projectGrantResponsePacket({
    organizationId,
    engagementId: engagementIdA,
    packetAudience: "funder",
    drafts: [
      {
        generatedContentDraftId: draftId,
        exportReviewVisible: true,
        exportManifestId: exportManifestIdA,
        exportManifestHistory: [
          { exportManifestId: exportManifestIdA, exportCandidateId: exportCandidateIdA, createdAt: "2026-09-01T00:00:00.000Z" },
        ],
        blocks: [],
      },
      {
        generatedContentDraftId: draftIdB,
        exportReviewVisible: true,
        exportManifestId: exportManifestIdOtherMember,
        exportManifestHistory: [
          { exportManifestId: exportManifestIdOtherMember, exportCandidateId: exportCandidateIdB, createdAt: "2026-09-03T00:00:00.000Z" },
        ],
        blocks: [],
      },
    ],
  });

  assert.deepEqual(
    projected.drafts.map((draft) => draft.exportManifestHistory.map((entry) => entry.exportManifestId)),
    [[exportManifestIdA], [exportManifestIdOtherMember]],
  );
  assert.notEqual(projected.drafts[0].exportManifestHistory[0].exportManifestId, projected.drafts[1].exportManifestHistory[0].exportManifestId);
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
  const setGrantResponsePacketExportReviewRequestPendingDraftId = (value) => stateLog.push(["memberRequestPending", value]);
  const setLoadingGrantResponsePacket = (value) => stateLog.push(["loading", value]);
  // P14-04: the export-candidate workflow-wiring state the same reset effect
  // now also clears on every engagement/organization switch.
  const setGrantResponsePacketExportCandidatePending = (value) => stateLog.push(["exportCandidatePending", value]);
  const setGrantResponsePacketExportCandidateResult = (value) => stateLog.push(["exportCandidateResult", value]);
  const setGrantResponsePacketExportCandidateError = (value) => stateLog.push(["exportCandidateError", value]);
  // P14-05: the export-review-request workflow state the same reset effect
  // now also clears on every engagement/organization switch.
  const setGrantResponsePacketExportReviewPending = (value) => stateLog.push(["exportReviewPending", value]);
  const setGrantResponsePacketExportReviewResult = (value) => stateLog.push(["exportReviewResult", value]);
  const setGrantResponsePacketExportReviewError = (value) => stateLog.push(["exportReviewError", value]);
  // P14-06 closure: the packet START/COMPLETE workflow state the same reset
  // effect now also clears on every engagement/organization switch.
  const setGrantResponsePacketExportReviewStartPending = (value) => stateLog.push(["exportReviewStartPending", value]);
  const setGrantResponsePacketExportReviewStartError = (value) => stateLog.push(["exportReviewStartError", value]);
  const setGrantResponsePacketExportReviewCompletePending = (value) => stateLog.push(["exportReviewCompletePending", value]);
  const setGrantResponsePacketExportReviewCompleteError = (value) => stateLog.push(["exportReviewCompleteError", value]);

  const buildUseEffect = new Function(
    "React",
    "organizationId",
    "engagementId",
    "grantPacketRequestGenerationRef",
    "setGrantResponsePacket",
    "setGrantResponsePacketError",
    "setGrantResponsePacketRequestState",
    "setGrantResponsePacketExportReviewRequestPendingDraftId",
    "setGrantResponsePacketExportCandidatePending",
    "setGrantResponsePacketExportCandidateResult",
    "setGrantResponsePacketExportCandidateError",
    "setGrantResponsePacketExportReviewPending",
    "setGrantResponsePacketExportReviewResult",
    "setGrantResponsePacketExportReviewError",
    "setGrantResponsePacketExportReviewStartPending",
    "setGrantResponsePacketExportReviewStartError",
    "setGrantResponsePacketExportReviewCompletePending",
    "setGrantResponsePacketExportReviewCompleteError",
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
    setGrantResponsePacketExportReviewRequestPendingDraftId,
    setGrantResponsePacketExportCandidatePending,
    setGrantResponsePacketExportCandidateResult,
    setGrantResponsePacketExportCandidateError,
    setGrantResponsePacketExportReviewPending,
    setGrantResponsePacketExportReviewResult,
    setGrantResponsePacketExportReviewError,
    setGrantResponsePacketExportReviewStartPending,
    setGrantResponsePacketExportReviewStartError,
    setGrantResponsePacketExportReviewCompletePending,
    setGrantResponsePacketExportReviewCompleteError,
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
