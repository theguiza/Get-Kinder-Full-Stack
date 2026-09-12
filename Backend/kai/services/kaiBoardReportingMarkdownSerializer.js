// Board Reporting render-model -> Markdown pure text generation. No Board
// Markdown serializer existed before this file (unlike the Grant Response
// Packet track, which already had a PREVIEW_READ_ONLY Markdown serializer
// this manifest-bound delivery could reuse) - this mirrors the exact
// structural conventions of kaiGrantResponsePacketMarkdownSerializer.js
// (inline-code scalar formatting, additive markdownContractVersion/
// deliveryClass override options, one Markdown heading per member/block) so
// the two tracks stay recognizably the same repository "shape", but the
// content fields themselves are the Board render model's own fields
// (composeBoardReportingRenderModel output) - not the packet track's.
//
// This is the ONLY Board Markdown text-generation function - the manifest-
// bound FINAL delivery service below is the sole caller with a distinct
// deliveryClass; no other Board Markdown output exists to confuse it with.

const BOARD_REPORTING_MARKDOWN_CONTRACT_VERSION = "kai-sprint2-board-reporting-markdown-preview-v1";
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
  if (renderModel.packetAudience !== "internal") return false;
  if (!Array.isArray(renderModel.supportedContentTypes)) return false;
  if (!Array.isArray(renderModel.members)) return false;
  for (const member of renderModel.members) {
    if (!isNonArrayObject(member)) return false;
    if (typeof member.generatedContentDraftId !== "string") return false;
    if (member.requestedAudience !== "internal") return false;
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

export function serializeBoardReportingRenderModelToMarkdown(renderModel, options = {}) {
  if (!validateRenderModel(renderModel)) {
    throw new TypeError("A valid Board Reporting render-model DTO is required.");
  }

  // Additive, defaulting overrides only - a future PREVIEW_READ_ONLY caller
  // that passes no options would get this default label; the manifest-bound
  // FINAL delivery pipeline below supplies its own distinct contract
  // version/delivery-class so its output never mislabels itself as a
  // preview.
  const markdownContractVersion = typeof options.markdownContractVersion === "string"
    ? options.markdownContractVersion
    : BOARD_REPORTING_MARKDOWN_CONTRACT_VERSION;
  const deliveryClass = typeof options.deliveryClass === "string" ? options.deliveryClass : DELIVERY_CLASS;

  const lines = [
    "# Board Summary",
    "",
    `Markdown contract: ${markdownContractVersion}`,
    `Delivery class: ${inlineCode(deliveryClass)}`,
    `Render model contract: ${inlineCode(renderModel.renderModelContractVersion)}`,
    `Organization: ${inlineCode(renderModel.organizationId)}`,
    `Engagement: ${inlineCode(renderModel.engagementId)}`,
    `Packet audience: ${inlineCode(renderModel.packetAudience)}`,
    `Supported content types: ${formatCodes(renderModel.supportedContentTypes)}`,
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
      `Review queue: ${inlineCode(member.reviewQueueItemId)}`,
      `Review status: ${inlineCode(member.queueStatus)} / ${inlineCode(member.reviewStatus)}`,
      `Review updated at: ${inlineCode(member.reviewUpdatedAt)}`,
      `Current-use eligible: ${inlineCode(member.currentUseEligible)}`,
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

export const __boardReportingMarkdownSerializerTestables = Object.freeze({
  BOARD_REPORTING_MARKDOWN_CONTRACT_VERSION,
  DELIVERY_CLASS,
  validateRenderModel,
});
