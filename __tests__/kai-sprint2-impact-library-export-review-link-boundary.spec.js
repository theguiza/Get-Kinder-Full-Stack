import test from "node:test";
import assert from "node:assert/strict";

import {
  canRequestGeneratedDraftExportReview,
  exportReviewRequestBody,
  exportReviewRequestPath,
  gkExportReviewDetailPagePath,
  projectExportReviewRequestResult,
  projectGeneratedDraftPacket,
} from "../frontend/impactEvidenceLibraryLogic.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const generatedContentDraftId = "00000000-0000-4000-8000-000000000777";
const exportReviewQueueItemId = "00000000-0000-4000-8000-000000000901";

function packetWith(queueStatus, reviewStatus) {
  return projectGeneratedDraftPacket({
    generatedContentDraftId,
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedAudience: "internal",
    reviewQueueItemId: "00000000-0000-4000-8000-000000000301",
    queueStatus,
    reviewStatus,
    reviewUpdatedAt: "2026-08-15T10:00:00.000Z",
    currentUseEligible: true,
    blocks: [],
  });
}

test("exportReviewRequestPath builds the exact accepted export-review-request route for a draft", () => {
  assert.equal(
    exportReviewRequestPath(organizationId, generatedContentDraftId),
    `/api/kai/sprint2/intake/admin/organizations/${organizationId}`
      + `/generated-content-drafts/${generatedContentDraftId}/export-review-request`,
  );
});

test("exportReviewRequestBody carries exactly the one required field, matching the request schema's exact-key contract", () => {
  assert.deepEqual(exportReviewRequestBody("funder"), { requested_export_audience: "funder" });
  assert.equal(Object.keys(exportReviewRequestBody("internal")).length, 1);
});

test("gkExportReviewDetailPagePath builds the exact P3-08 page route already registered in index.js", () => {
  assert.equal(
    gkExportReviewDetailPagePath(organizationId, generatedContentDraftId, exportReviewQueueItemId),
    `/gk-admin/organizations/${organizationId}`
      + `/generated-content-drafts/${generatedContentDraftId}`
      + `/export-review-queue/${exportReviewQueueItemId}`,
  );
});

test("canRequestGeneratedDraftExportReview is true only once the generated-content review is fully resolved", () => {
  assert.equal(canRequestGeneratedDraftExportReview(packetWith("resolved", "resolved")), true);
  assert.equal(canRequestGeneratedDraftExportReview(packetWith("open", "needs_gk_review")), false);
  assert.equal(canRequestGeneratedDraftExportReview(packetWith("in_progress", "needs_gk_review")), false);
  assert.equal(canRequestGeneratedDraftExportReview(null), false);
});

test("projectExportReviewRequestResult projects an accepted result to exactly the fields this page renders", () => {
  const projected = projectExportReviewRequestResult({
    generatedContentDraftId,
    requestedExportAudience: "internal",
    exportReviewRequestAccepted: true,
    replayed: false,
    reviewQueueItemId: exportReviewQueueItemId,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    validatorResult: { severity: "pass" },
  });
  assert.deepEqual(projected, {
    accepted: true,
    exportReviewQueueItemId,
    validatorResult: { severity: "pass" },
  });
});

test("projectExportReviewRequestResult projects a blocked result with a null queue item id, never fabricating one", () => {
  const projected = projectExportReviewRequestResult({
    generatedContentDraftId,
    requestedExportAudience: "funder",
    exportReviewRequestAccepted: false,
    replayed: false,
    reviewQueueItemId: null,
    queueStatus: null,
    reviewStatus: null,
    validatorResult: { severity: "blocker", evidence: { failed_gates: ["requirement_authority_absent"] } },
  });
  assert.equal(projected.accepted, false);
  assert.equal(projected.exportReviewQueueItemId, null);
  assert.deepEqual(projected.validatorResult, { severity: "blocker", evidence: { failed_gates: ["requirement_authority_absent"] } });
});

test("projectExportReviewRequestResult returns null for a malformed/absent DTO rather than a partial object", () => {
  assert.equal(projectExportReviewRequestResult(null), null);
  assert.equal(projectExportReviewRequestResult(undefined), null);
  assert.equal(projectExportReviewRequestResult("not-an-object"), null);
});
