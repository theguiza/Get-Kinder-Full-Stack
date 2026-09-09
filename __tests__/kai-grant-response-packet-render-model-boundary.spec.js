import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  composeGrantResponsePacketRenderModel,
  __grantResponsePacketRenderModelServiceTestables,
} from "../Backend/kai/services/kaiGrantResponsePacketRenderModelService.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const ENGAGEMENT = "00000000-0000-4000-8000-000000000701";
const DRAFT_A = "00000000-0000-4000-8000-000000000911";
const DRAFT_B = "00000000-0000-4000-8000-000000000921";
const BLOCK_A1 = "00000000-0000-4000-8000-000000000931";
const BLOCK_A2 = "00000000-0000-4000-8000-000000000932";
const BLOCK_B1 = "00000000-0000-4000-8000-000000000933";
const CITATION_A1 = "00000000-0000-4000-8000-000000000941";
const CITATION_A2 = "00000000-0000-4000-8000-000000000942";
const CITATION_B1 = "00000000-0000-4000-8000-000000000943";
const CLAIM_A = "00000000-0000-4000-8000-000000000951";
const CLAIM_B = "00000000-0000-4000-8000-000000000952";
const CLAIM_C = "00000000-0000-4000-8000-000000000953";
const EVIDENCE_A = "00000000-0000-4000-8000-000000000961";
const EVIDENCE_B = "00000000-0000-4000-8000-000000000962";
const EVIDENCE_C = "00000000-0000-4000-8000-000000000963";
const SOURCE_A = "00000000-0000-4000-8000-000000000971";
const SOURCE_B = "00000000-0000-4000-8000-000000000972";
const SOURCE_C = "00000000-0000-4000-8000-000000000973";
const SOURCE_VERSION_A = "00000000-0000-4000-8000-000000000981";
const SOURCE_VERSION_B = "00000000-0000-4000-8000-000000000982";
const SOURCE_VERSION_C = "00000000-0000-4000-8000-000000000983";
const MANIFEST_A = "00000000-0000-4000-8000-000000000991";
const CANDIDATE_A = "00000000-0000-4000-8000-000000000992";

const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "90000000-0000-4000-8000-000000000001",
  organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "gk_admin" }],
});

function citation(overrides = {}) {
  return {
    generatedContentCitationId: CITATION_A1,
    claimId: CLAIM_A,
    evidenceItemId: EVIDENCE_A,
    sourceId: SOURCE_A,
    sourceVersionId: SOURCE_VERSION_A,
    supportStrength: "strong",
    claimReviewStatus: "approved",
    evidenceReviewStatus: "approved",
    currentEligible: true,
    blockerCodes: ["source_version_superseded"],
    affectedDimensionKeys: ["currency"],
    affectedObjectIds: ["source-version:1"],
    ...overrides,
  };
}

function member(overrides = {}) {
  return {
    generationRunId: "00000000-0000-4000-8000-000000000901",
    generatedContentDraftId: DRAFT_A,
    contentType: "evidence_summary",
    draftStatus: "draft",
    requestedAudience: "funder",
    reviewQueueItemId: "00000000-0000-4000-8000-000000000902",
    queueStatus: "resolved",
    reviewStatus: "resolved",
    reviewUpdatedAt: "2026-08-06T09:00:00.000Z",
    currentUseEligible: true,
    exportReviewVisible: true,
    exportReviewQueueItemId: "00000000-0000-4000-8000-000000000903",
    exportReviewQueueStatus: "resolved",
    exportReviewStatus: "resolved",
    exportManifestId: MANIFEST_A,
    exportManifestHistory: [{
      exportManifestId: MANIFEST_A,
      exportCandidateId: CANDIDATE_A,
      createdAt: "2026-08-07T09:00:00.000Z",
    }],
    blocks: [{
      generatedContentBlockId: BLOCK_A1,
      ordinal: 1,
      text: "First member, first block.",
      citations: [citation()],
    }, {
      generatedContentBlockId: BLOCK_A2,
      ordinal: 2,
      text: "First member, second block.",
      citations: [citation({
        generatedContentCitationId: CITATION_A2,
        claimId: CLAIM_B,
        evidenceItemId: EVIDENCE_B,
        sourceId: SOURCE_B,
        sourceVersionId: SOURCE_VERSION_B,
        blockerCodes: [],
        affectedDimensionKeys: [],
        affectedObjectIds: [],
      })],
    }],
    ...overrides,
  };
}

function packet(overrides = {}) {
  return {
    organizationId: ORG,
    engagementId: ENGAGEMENT,
    packetAudience: "funder",
    exportReviewVisible: true,
    grantResponsePacketExportCandidateId: null,
    reviewQueueItemId: null,
    queueStatus: null,
    reviewStatus: null,
    reviewUpdatedAt: null,
    drafts: [
      member(),
      member({
        generationRunId: "00000000-0000-4000-8000-000000000904",
        generatedContentDraftId: DRAFT_B,
        reviewQueueItemId: "00000000-0000-4000-8000-000000000905",
        exportReviewQueueItemId: null,
        exportReviewQueueStatus: null,
        exportReviewStatus: null,
        exportManifestId: null,
        exportManifestHistory: [],
        blocks: [{
          generatedContentBlockId: BLOCK_B1,
          ordinal: 1,
          text: "Second member block.",
          citations: [citation({
            generatedContentCitationId: CITATION_B1,
            claimId: CLAIM_C,
            evidenceItemId: EVIDENCE_C,
            sourceId: SOURCE_C,
            sourceVersionId: SOURCE_VERSION_C,
            blockerCodes: ["manual_review_required"],
            affectedDimensionKeys: ["method"],
            affectedObjectIds: ["claim:3"],
          })],
        }],
      }),
    ],
    ...overrides,
  };
}

function serviceInput() {
  return { organizationId: ORG, engagementId: ENGAGEMENT, actorContext };
}

test("Grant Response Packet render model composes one deterministic multi-member composite from the authoritative packet DTO", async () => {
  let reads = 0;
  const readGrantResponsePacket = async (input) => {
    reads += 1;
    assert.deepEqual(input, serviceInput());
    return { ok: true, data: packet(), error: null };
  };

  const first = await composeGrantResponsePacketRenderModel(serviceInput(), { readGrantResponsePacket });
  const second = await composeGrantResponsePacketRenderModel(serviceInput(), { readGrantResponsePacket });

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.data, second.data);
  assert.equal(reads, 2);
  assert.equal(first.data.renderModelContractVersion, "kai-sprint2-grant-response-packet-render-model-v1");
  assert.equal(first.data.organizationId, ORG);
  assert.equal(first.data.engagementId, ENGAGEMENT);
  assert.equal(first.data.packetAudience, "funder");
  assert.deepEqual(first.data.members.map((draft) => draft.generatedContentDraftId), [DRAFT_A, DRAFT_B]);
  assert.deepEqual(first.data.members.map((draft) => draft.contentType), ["evidence_summary", "evidence_summary"]);
  assert.deepEqual(first.data.members.map((draft) => draft.requestedAudience), ["funder", "funder"]);
  assert.deepEqual(first.data.members.map((draft) => draft.queueStatus), ["resolved", "resolved"]);
  assert.deepEqual(first.data.members.map((draft) => draft.reviewStatus), ["resolved", "resolved"]);
  assert.deepEqual(first.data.members.map((draft) => draft.currentUseEligible), [true, true]);
});

test("Grant Response Packet render model preserves member, block, citation, and limitation/blocker identity in place", () => {
  const model = __grantResponsePacketRenderModelServiceTestables.composeGrantResponsePacketRenderModelFromPacket(packet());

  assert.equal(model.members.length, 2);
  assert.deepEqual(model.members[0].blocks.map((block) => block.ordinal), [1, 2]);
  assert.deepEqual(model.members[0].blocks.map((block) => block.generatedContentBlockId), [BLOCK_A1, BLOCK_A2]);
  assert.equal(model.members[0].blocks[0].text, "First member, first block.");
  assert.equal(model.members[0].blocks[0].citations[0].generatedContentCitationId, CITATION_A1);
  assert.equal(model.members[0].blocks[0].citations[0].claimId, CLAIM_A);
  assert.equal(model.members[0].blocks[0].citations[0].evidenceItemId, EVIDENCE_A);
  assert.equal(model.members[0].blocks[1].citations[0].claimId, CLAIM_B);
  assert.equal(model.members[1].blocks[0].citations[0].generatedContentCitationId, CITATION_B1);
  assert.equal(model.members[1].blocks[0].citations[0].claimId, CLAIM_C);
  assert.notEqual(model.members[1].blocks[0].citations[0].claimId, CLAIM_A);
  assert.deepEqual(model.members[0].blocks[0].citations[0].blockerCodes, ["source_version_superseded"]);
  assert.deepEqual(model.members[1].blocks[0].citations[0].blockerCodes, ["manual_review_required"]);
  assert.deepEqual(model.members[1].blocks[0].citations[0].affectedDimensionKeys, ["method"]);
  assert.deepEqual(model.members[1].blocks[0].citations[0].affectedObjectIds, ["claim:3"]);
});

test("Grant Response Packet render model accepts an empty authoritative packet as a valid empty composite", () => {
  const model = __grantResponsePacketRenderModelServiceTestables.composeGrantResponsePacketRenderModelFromPacket(packet({ drafts: [] }));
  assert.equal(model.organizationId, ORG);
  assert.equal(model.engagementId, ENGAGEMENT);
  assert.equal(model.packetAudience, "funder");
  assert.deepEqual(model.members, []);
});

test("Grant Response Packet render model fails closed instead of introducing non-funder content or malformed packet state", async () => {
  const internal = await composeGrantResponsePacketRenderModel(serviceInput(), {
    readGrantResponsePacket: async () => ({
      ok: true,
      data: packet({ drafts: [member({ requestedAudience: "internal" })] }),
      error: null,
    }),
  });
  assert.equal(internal.ok, false);
  assert.equal(internal.error.code, "system_error");

  const malformed = await composeGrantResponsePacketRenderModel(serviceInput(), {
    readGrantResponsePacket: async () => ({
      ok: true,
      data: packet({ packetManifestId: MANIFEST_A }),
      error: null,
    }),
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, "system_error");
});

test("Grant Response Packet render model keeps per-member manifest history as member metadata only", () => {
  const model = __grantResponsePacketRenderModelServiceTestables.composeGrantResponsePacketRenderModelFromPacket(packet());

  assert.equal(Object.prototype.hasOwnProperty.call(model, "exportManifestId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(model, "exportManifestHistory"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(model, "packetManifestId"), false);
  assert.equal(model.members[0].exportManifestId, MANIFEST_A);
  assert.deepEqual(model.members[0].exportManifestHistory, [{
    exportManifestId: MANIFEST_A,
    exportCandidateId: CANDIDATE_A,
    createdAt: "2026-08-07T09:00:00.000Z",
  }]);
});

test("Grant Response Packet render model exposes no raw evidence, raw source bodies, artifact, write, or download fields", () => {
  const model = __grantResponsePacketRenderModelServiceTestables.composeGrantResponsePacketRenderModelFromPacket(packet());
  const serialized = JSON.stringify(model);
  for (const forbidden of [
    "rawEvidence",
    "evidenceBody",
    "sourceBody",
    "sourceText",
    "rawSource",
    "sourceContent",
    "artifact",
    "download",
    "markdown",
    "pdf",
    "docx",
    "csv",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("Grant Response Packet render model composition has no latest/newest/preferred selection or mutation path", () => {
  const source = readFileSync(
    new URL("../Backend/kai/services/kaiGrantResponsePacketRenderModelService.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /latest|newest|preferred|LIMIT\s+1|ORDER BY/i);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE)\b|FOR\s+UPDATE|audit/i);
});
