// P14-06E1 frontend read-model primitive: project and hydrate the exact
// candidate/export-review state returned by the authoritative P14-06D Grant
// Response Packet GET only. No initial-load wiring or mutation callbacks are
// exercised here.

import test from "node:test";
import assert from "node:assert/strict";

import {
  hydrateGrantResponsePacketExportReviewReadModel,
  projectGrantResponsePacket,
} from "../frontend/impactEvidenceLibraryLogic.js";

const organizationId = "00000000-0000-4000-8000-000000000001";
const engagementId = "00000000-0000-4000-8000-000000000401";
const candidateId = "00000000-0000-4000-8000-000000000b01";
const olderCandidateId = "00000000-0000-4000-8000-000000000b02";
const preferredCandidateId = "00000000-0000-4000-8000-000000000b03";
const reviewQueueItemId = "00000000-0000-4000-8000-000000000901";
const reviewUpdatedAt = "2026-09-09T12:00:00.000Z";

function dto(overrides = {}) {
  return {
    organizationId,
    engagementId,
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

function projectAndHydrate(overrides = {}) {
  return hydrateGrantResponsePacketExportReviewReadModel(projectGrantResponsePacket(dto(overrides)));
}

test("P14-06E1: no current candidate maps candidateResult and exportReviewResult to null", () => {
  const hydrated = projectAndHydrate();
  assert.equal(hydrated.packet.grantResponsePacketExportCandidateId, null);
  assert.equal(hydrated.candidateResult, null);
  assert.equal(hydrated.exportReviewResult, null);
});

test("P14-06E1: current candidate with no review maps to exact candidate and null review", () => {
  const hydrated = projectAndHydrate({
    grantResponsePacketExportCandidateId: candidateId,
  });

  assert.deepEqual(hydrated.candidateResult, {
    organizationId,
    engagementId,
    grantResponsePacketExportCandidateId: candidateId,
  });
  assert.equal(hydrated.exportReviewResult, null);
});

test("P14-06E1: open review hydrates exact queue state", () => {
  const hydrated = projectAndHydrate({
    grantResponsePacketExportCandidateId: candidateId,
    reviewQueueItemId,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt,
  });

  assert.deepEqual(hydrated.exportReviewResult, {
    organizationId,
    engagementId,
    grantResponsePacketExportCandidateId: candidateId,
    reviewQueueItemId,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt,
  });
});

test("P14-06E1: in_progress review hydrates exact queue state", () => {
  const hydrated = projectAndHydrate({
    grantResponsePacketExportCandidateId: candidateId,
    reviewQueueItemId,
    queueStatus: "in_progress",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt,
  });

  assert.equal(hydrated.exportReviewResult.queueStatus, "in_progress");
  assert.equal(hydrated.exportReviewResult.reviewStatus, "needs_gk_review");
});

test("P14-06E1: resolved review hydrates exact queue state", () => {
  const hydrated = projectAndHydrate({
    grantResponsePacketExportCandidateId: candidateId,
    reviewQueueItemId,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    reviewUpdatedAt,
  });

  assert.equal(hydrated.exportReviewResult.queueStatus, "resolved");
  assert.equal(hydrated.exportReviewResult.reviewStatus, "resolved");
});

test("P14-06E1: exact candidate id, queue id, and reviewUpdatedAt are preserved", () => {
  const hydrated = projectAndHydrate({
    grantResponsePacketExportCandidateId: candidateId,
    reviewQueueItemId,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt,
  });

  assert.equal(hydrated.candidateResult.grantResponsePacketExportCandidateId, candidateId);
  assert.equal(hydrated.exportReviewResult.grantResponsePacketExportCandidateId, candidateId);
  assert.equal(hydrated.exportReviewResult.reviewQueueItemId, reviewQueueItemId);
  assert.equal(hydrated.exportReviewResult.reviewUpdatedAt, reviewUpdatedAt);
});

test("P14-06E1: authoritative null clears candidate and review state", () => {
  const hydrated = projectAndHydrate({
    grantResponsePacketExportCandidateId: null,
    reviewQueueItemId: null,
    queueStatus: null,
    reviewStatus: null,
    reviewUpdatedAt: null,
  });

  assert.equal(hydrated.candidateResult, null);
  assert.equal(hydrated.exportReviewResult, null);
});

test("P14-06E1: authoritative null review clears review while preserving current candidate", () => {
  const hydrated = projectAndHydrate({
    grantResponsePacketExportCandidateId: candidateId,
    reviewQueueItemId: null,
    queueStatus: null,
    reviewStatus: null,
    reviewUpdatedAt: null,
  });

  assert.equal(hydrated.candidateResult.grantResponsePacketExportCandidateId, candidateId);
  assert.equal(hydrated.exportReviewResult, null);
});

test("P14-06E1: restricted or hidden identity remains null even if unsafe fields are present", () => {
  const projected = projectGrantResponsePacket(dto({
    exportReviewVisible: false,
    grantResponsePacketExportCandidateId: candidateId,
    reviewQueueItemId,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt,
  }));
  const hydrated = hydrateGrantResponsePacketExportReviewReadModel(projected);

  assert.equal(projected.exportReviewVisible, false);
  assert.equal(projected.grantResponsePacketExportCandidateId, null);
  assert.equal(projected.reviewQueueItemId, null);
  assert.equal(hydrated.candidateResult, null);
  assert.equal(hydrated.exportReviewResult, null);
});

test("P14-06E1: member, manifest, latest, newest, and preferred fields are never inferred as packet candidate state", () => {
  const hydrated = projectAndHydrate({
    grantResponsePacketExportCandidateId: null,
    latestGrantResponsePacketExportCandidateId: candidateId,
    newestGrantResponsePacketExportCandidateId: olderCandidateId,
    preferredGrantResponsePacketExportCandidateId: preferredCandidateId,
    drafts: [{
      generatedContentDraftId: "00000000-0000-4000-8000-000000000777",
      exportReviewVisible: true,
      exportManifestHistory: [
        { exportCandidateId: candidateId, createdAt: "2026-09-09T13:00:00.000Z" },
        { exportCandidateId: olderCandidateId, createdAt: "2026-09-08T13:00:00.000Z" },
      ],
      blocks: [],
    }],
  });

  assert.equal(hydrated.packet.grantResponsePacketExportCandidateId, null);
  assert.equal(hydrated.candidateResult, null);
  assert.equal(hydrated.exportReviewResult, null);
});

test("P14-06E1: unknown and unapproved fields are not promoted into packet, candidate, or review state", () => {
  const hydrated = projectAndHydrate({
    grantResponsePacketExportCandidateId: candidateId,
    reviewQueueItemId,
    queueStatus: "open",
    reviewStatus: "needs_gk_review",
    reviewUpdatedAt,
    finalEligibilityStatus: "approved",
    exportManifestId: "00000000-0000-4000-8000-000000000a01",
    latestGrantResponsePacketExportCandidateId: preferredCandidateId,
  });

  assert.deepEqual(Object.keys(hydrated.candidateResult), [
    "organizationId",
    "engagementId",
    "grantResponsePacketExportCandidateId",
  ]);
  assert.deepEqual(Object.keys(hydrated.exportReviewResult), [
    "organizationId",
    "engagementId",
    "grantResponsePacketExportCandidateId",
    "reviewQueueItemId",
    "queueStatus",
    "reviewStatus",
    "reviewUpdatedAt",
  ]);
  assert.equal("finalEligibilityStatus" in hydrated.packet, false);
  assert.equal("exportManifestId" in hydrated.packet, false);
  assert.equal("latestGrantResponsePacketExportCandidateId" in hydrated.packet, false);
});

test("P14-06E1: hydration is deterministic for the same projected packet input", () => {
  const projected = projectGrantResponsePacket(dto({
    grantResponsePacketExportCandidateId: candidateId,
    reviewQueueItemId,
    queueStatus: "resolved",
    reviewStatus: "resolved",
    reviewUpdatedAt,
  }));

  assert.deepEqual(
    hydrateGrantResponsePacketExportReviewReadModel(projected),
    hydrateGrantResponsePacketExportReviewReadModel(projected),
  );
});

test("P14-06E1: null packet projection hydrates to null packet, candidate, and review", () => {
  assert.deepEqual(hydrateGrantResponsePacketExportReviewReadModel(null), {
    packet: null,
    candidateResult: null,
    exportReviewResult: null,
  });
});
