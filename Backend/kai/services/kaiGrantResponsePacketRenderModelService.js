import {
  getGrantResponsePacket,
  __grantResponsePacketServiceTestables,
} from "./kaiGrantResponsePacketService.js";

const RENDER_MODEL_CONTRACT_VERSION = "kai-sprint2-grant-response-packet-render-model-v1";

const { isGrantResponsePacketDto, isGetGrantResponsePacketInput } = __grantResponsePacketServiceTestables;

function copyOptionalUuidField(target, source, key) {
  if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
}

function composeBlockRenderModel(block) {
  const projected = {
    ordinal: block.ordinal,
    text: block.text,
    citations: block.citations.map((citation) => {
      const citationModel = {
        claimId: citation.claimId,
        evidenceItemId: citation.evidenceItemId,
        sourceId: citation.sourceId,
        sourceVersionId: citation.sourceVersionId,
        supportStrength: citation.supportStrength,
        claimReviewStatus: citation.claimReviewStatus,
        evidenceReviewStatus: citation.evidenceReviewStatus,
        currentEligible: citation.currentEligible,
        blockerCodes: [...citation.blockerCodes],
        affectedDimensionKeys: [...citation.affectedDimensionKeys],
        affectedObjectIds: [...citation.affectedObjectIds],
      };
      copyOptionalUuidField(citationModel, citation, "generatedContentCitationId");
      return citationModel;
    }),
  };
  copyOptionalUuidField(projected, block, "generatedContentBlockId");
  return projected;
}

function composeMemberRenderModel(member) {
  return {
    generationRunId: member.generationRunId,
    generatedContentDraftId: member.generatedContentDraftId,
    contentType: member.contentType,
    draftStatus: member.draftStatus,
    requestedAudience: member.requestedAudience,
    reviewQueueItemId: member.reviewQueueItemId,
    queueStatus: member.queueStatus,
    reviewStatus: member.reviewStatus,
    reviewUpdatedAt: member.reviewUpdatedAt,
    currentUseEligible: member.currentUseEligible,
    exportReviewVisible: member.exportReviewVisible,
    exportReviewQueueItemId: member.exportReviewQueueItemId,
    exportReviewQueueStatus: member.exportReviewQueueStatus,
    exportReviewStatus: member.exportReviewStatus,
    exportManifestId: member.exportManifestId,
    exportManifestHistory: member.exportManifestHistory.map((entry) => ({
      exportManifestId: entry.exportManifestId,
      exportCandidateId: entry.exportCandidateId,
      createdAt: entry.createdAt,
    })),
    blocks: member.blocks.map(composeBlockRenderModel),
  };
}

export function composeGrantResponsePacketRenderModelFromPacket(packet) {
  if (!isGrantResponsePacketDto(packet)) return null;
  if (packet.packetAudience !== "funder") return null;
  if (!packet.drafts.every((draft) => draft.requestedAudience === packet.packetAudience)) return null;

  return {
    renderModelContractVersion: RENDER_MODEL_CONTRACT_VERSION,
    organizationId: packet.organizationId,
    engagementId: packet.engagementId,
    packetAudience: packet.packetAudience,
    members: packet.drafts.map(composeMemberRenderModel),
  };
}

export async function composeGrantResponsePacketRenderModel(input, dependencies = {}) {
  if (!isGetGrantResponsePacketInput(input)) {
    return { ok: false, data: null, error: { code: "validation_blocker", status: 422 } };
  }
  const readGrantResponsePacket = dependencies.readGrantResponsePacket || getGrantResponsePacket;
  const packetResult = await readGrantResponsePacket(input, dependencies.grantResponsePacketDependencies || dependencies);
  if (!packetResult?.ok) return packetResult;

  const data = composeGrantResponsePacketRenderModelFromPacket(packetResult.data);
  if (!data) return { ok: false, data: null, error: { code: "system_error", status: 500 } };
  return { ok: true, data, error: null };
}

export const __grantResponsePacketRenderModelServiceTestables = Object.freeze({
  RENDER_MODEL_CONTRACT_VERSION,
  composeGrantResponsePacketRenderModelFromPacket,
});
