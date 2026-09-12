import {
  getBoardReportingPacket,
  __boardReportingPacketServiceTestables,
} from "./kaiBoardReportingPacketService.js";

export const BOARD_REPORTING_RENDER_MODEL_CONTRACT_VERSION = "kai-sprint2-board-reporting-render-model-v1";

const { isBoardReportingPacketDto, isGetBoardReportingPacketInput } = __boardReportingPacketServiceTestables;

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
    blocks: member.blocks.map(composeBlockRenderModel),
  };
}

export function composeBoardReportingRenderModelFromPacket(packet) {
  if (!isBoardReportingPacketDto(packet)) return null;
  if (packet.packetAudience !== "internal") return null;
  if (!packet.members.every((member) => member.requestedAudience === packet.packetAudience)) return null;
  if (!packet.members.every((member) => packet.supportedContentTypes.includes(member.contentType))) return null;

  return {
    renderModelContractVersion: BOARD_REPORTING_RENDER_MODEL_CONTRACT_VERSION,
    organizationId: packet.organizationId,
    engagementId: packet.engagementId,
    packetAudience: packet.packetAudience,
    supportedContentTypes: [...packet.supportedContentTypes],
    members: packet.members.map(composeMemberRenderModel),
  };
}

export async function composeBoardReportingRenderModel(input, dependencies = {}) {
  if (!isGetBoardReportingPacketInput(input)) {
    return { ok: false, data: null, error: { code: "validation_blocker", status: 422 } };
  }
  const readBoardReportingPacket = dependencies.readBoardReportingPacket || getBoardReportingPacket;
  const packetResult = await readBoardReportingPacket(input, dependencies.boardReportingPacketDependencies || dependencies);
  if (!packetResult?.ok) return packetResult;

  const data = composeBoardReportingRenderModelFromPacket(packetResult.data);
  if (!data) return { ok: false, data: null, error: { code: "system_error", status: 500 } };
  return { ok: true, data, error: null };
}

export const __boardReportingRenderModelServiceTestables = Object.freeze({
  BOARD_REPORTING_RENDER_MODEL_CONTRACT_VERSION,
  composeBoardReportingRenderModelFromPacket,
});
