import { composeGrantResponsePacketRenderModel } from "./kaiGrantResponsePacketRenderModelService.js";

const GRANT_RESPONSE_PACKET_MARKDOWN_CONTRACT_VERSION = "kai-sprint2-grant-response-packet-markdown-preview-v1";
const DELIVERY_CLASS = "PREVIEW_READ_ONLY";

function isNonArrayObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeScalar(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function inlineCode(value) {
  return `\`${normalizeScalar(value).replaceAll("`", "\\`")}\``;
}

function formatCodes(codes) {
  if (!Array.isArray(codes) || codes.length === 0) return "none";
  return codes.map(inlineCode).join(", ");
}

function validateRenderModel(renderModel) {
  if (!isNonArrayObject(renderModel)) return false;
  if (typeof renderModel.renderModelContractVersion !== "string") return false;
  if (typeof renderModel.organizationId !== "string") return false;
  if (typeof renderModel.engagementId !== "string") return false;
  if (renderModel.packetAudience !== "funder") return false;
  if (!Array.isArray(renderModel.members)) return false;
  for (const member of renderModel.members) {
    if (!isNonArrayObject(member)) return false;
    if (typeof member.generatedContentDraftId !== "string") return false;
    if (member.requestedAudience !== "funder") return false;
    if (!Array.isArray(member.exportManifestHistory)) return false;
    if (!Array.isArray(member.blocks)) return false;
    for (const block of member.blocks) {
      if (!isNonArrayObject(block)) return false;
      if (typeof block.ordinal !== "number") return false;
      if (typeof block.text !== "string") return false;
      if (!Array.isArray(block.citations)) return false;
      for (const citation of block.citations) {
        if (!isNonArrayObject(citation)) return false;
        if (typeof citation.claimId !== "string") return false;
        if (typeof citation.evidenceItemId !== "string") return false;
        if (typeof citation.sourceId !== "string") return false;
        if (typeof citation.sourceVersionId !== "string") return false;
        if (!Array.isArray(citation.blockerCodes)) return false;
        if (!Array.isArray(citation.affectedDimensionKeys)) return false;
        if (!Array.isArray(citation.affectedObjectIds)) return false;
      }
    }
  }
  return true;
}

function formatCitation(citation, citationIndex) {
  const citationIdentity = Object.prototype.hasOwnProperty.call(citation, "generatedContentCitationId")
    ? `; citation ${inlineCode(citation.generatedContentCitationId)}`
    : "";
  return `  - Citation ${citationIndex}: claim ${inlineCode(citation.claimId)}; evidence ${inlineCode(citation.evidenceItemId)}; source ${inlineCode(citation.sourceId)}; source version ${inlineCode(citation.sourceVersionId)}${citationIdentity}; support ${inlineCode(citation.supportStrength)}; claim review ${inlineCode(citation.claimReviewStatus)}; evidence review ${inlineCode(citation.evidenceReviewStatus)}; current eligible ${inlineCode(citation.currentEligible)}; blockers ${formatCodes(citation.blockerCodes)}; affected dimensions ${formatCodes(citation.affectedDimensionKeys)}; affected objects ${formatCodes(citation.affectedObjectIds)}.`;
}

export function serializeGrantResponsePacketRenderModelToMarkdown(renderModel) {
  if (!validateRenderModel(renderModel)) {
    throw new TypeError("A valid Grant Response Packet render-model DTO is required.");
  }

  const lines = [
    "# Grant Response Packet",
    "",
    `Markdown contract: ${GRANT_RESPONSE_PACKET_MARKDOWN_CONTRACT_VERSION}`,
    `Delivery class: ${inlineCode(DELIVERY_CLASS)}`,
    `Render model contract: ${inlineCode(renderModel.renderModelContractVersion)}`,
    `Organization: ${inlineCode(renderModel.organizationId)}`,
    `Engagement: ${inlineCode(renderModel.engagementId)}`,
    `Packet audience: ${inlineCode(renderModel.packetAudience)}`,
    "",
    "## Members",
  ];

  if (renderModel.members.length === 0) {
    lines.push("", "- none");
  }

  for (const [memberIndex, member] of renderModel.members.entries()) {
    lines.push(
      "",
      `### Member ${memberIndex + 1}`,
      "",
      `Generation run: ${inlineCode(member.generationRunId)}`,
      `Generated content draft: ${inlineCode(member.generatedContentDraftId)}`,
      `Content type: ${inlineCode(member.contentType)}`,
      `Draft status: ${inlineCode(member.draftStatus)}`,
      `Requested audience: ${inlineCode(member.requestedAudience)}`,
      `Generated-content review queue: ${inlineCode(member.reviewQueueItemId)}`,
      `Generated-content review status: ${inlineCode(member.queueStatus)} / ${inlineCode(member.reviewStatus)}`,
      `Current-use eligible: ${inlineCode(member.currentUseEligible)}`,
      `Export review visible: ${inlineCode(member.exportReviewVisible)}`,
      `Export review queue: ${inlineCode(member.exportReviewQueueItemId)}`,
      `Export review status: ${inlineCode(member.exportReviewQueueStatus)} / ${inlineCode(member.exportReviewStatus)}`,
      `Member export manifest metadata: ${inlineCode(member.exportManifestId)}`,
      `Member export manifest history count: ${inlineCode(member.exportManifestHistory.length)}`,
      "",
      "#### Blocks",
    );

    for (const block of member.blocks) {
      const blockIdentity = Object.prototype.hasOwnProperty.call(block, "generatedContentBlockId")
        ? ` (${block.generatedContentBlockId})`
        : "";
      lines.push(
        "",
        `##### Block ${block.ordinal}${blockIdentity}`,
        "",
        normalizeScalar(block.text),
        "",
        "Citations:",
      );
      block.citations.forEach((citation, citationIndex) => {
        lines.push(formatCitation(citation, citationIndex + 1));
      });
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function serializeGrantResponsePacketToMarkdown(input, dependencies = {}) {
  const renderModelService =
    dependencies.composeGrantResponsePacketRenderModel || composeGrantResponsePacketRenderModel;
  const result = await renderModelService(input, dependencies.renderModelDependencies || dependencies);
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      markdownContractVersion: GRANT_RESPONSE_PACKET_MARKDOWN_CONTRACT_VERSION,
      deliveryClass: DELIVERY_CLASS,
      markdown: serializeGrantResponsePacketRenderModelToMarkdown(result.data),
    },
    error: null,
  };
}

export const __grantResponsePacketMarkdownSerializerTestables = Object.freeze({
  GRANT_RESPONSE_PACKET_MARKDOWN_CONTRACT_VERSION,
  DELIVERY_CLASS,
  validateRenderModel,
});
