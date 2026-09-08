import { composeExportManifestRenderModel } from "./kaiExportManifestRenderModelService.js";

const MARKDOWN_CONTRACT_VERSION = "kai-sprint2-export-manifest-markdown-v1";

function isNonArrayObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeScalar(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function inlineCode(value) {
  return `\`${normalizeScalar(value).replaceAll("`", "\\`")}\``;
}

function citationMarker(citationRef) {
  return `[${normalizeScalar(citationRef)}]`;
}

function formatCitationRefs(citationRefs) {
  if (!Array.isArray(citationRefs) || citationRefs.length === 0) return "";
  return `\n\nReferences: ${citationRefs.map(citationMarker).join(" ")}`;
}

function formatLimitationCodes(codes) {
  if (!Array.isArray(codes) || codes.length === 0) return "none";
  return codes.map(inlineCode).join(", ");
}

function validateRenderModel(renderModel) {
  if (!isNonArrayObject(renderModel)) return false;
  if (typeof renderModel.renderModelContractVersion !== "string") return false;
  if (!isNonArrayObject(renderModel.exportCandidate)) return false;
  if (!isNonArrayObject(renderModel.content) || !Array.isArray(renderModel.content.blocks)) return false;
  if (!Array.isArray(renderModel.citations)) return false;
  if (!Array.isArray(renderModel.limitations)) return false;
  if (!isNonArrayObject(renderModel.methodNotes)) return false;
  if (!Array.isArray(renderModel.methodNotes.limitationEntries)) return false;
  return true;
}

export function serializeExportManifestRenderModelToMarkdown(renderModel) {
  if (!validateRenderModel(renderModel)) {
    throw new TypeError("A valid export manifest render-model DTO is required.");
  }

  const lines = [
    "# Export Manifest",
    "",
    `Markdown contract: ${MARKDOWN_CONTRACT_VERSION}`,
    `Render model contract: ${inlineCode(renderModel.renderModelContractVersion)}`,
    `Content type: ${inlineCode(renderModel.exportCandidate.contentType)}`,
    `Requested audience: ${inlineCode(renderModel.exportCandidate.requestedAudience)}`,
    "",
    "## Content",
  ];

  for (const block of renderModel.content.blocks) {
    lines.push(
      "",
      `### Block ${block.ordinal}`,
      "",
      `${normalizeScalar(block.text)}${formatCitationRefs(block.citationRefs)}`,
    );
  }

  lines.push("", "## Citation Appendix");
  for (const citation of renderModel.citations) {
    lines.push(
      "",
      `- ${citationMarker(citation.citationRef)} Claim ${inlineCode(citation.claimId)}; evidence ${inlineCode(citation.evidenceItemId)}; source ${inlineCode(citation.sourceId)}; source version ${inlineCode(citation.sourceVersionId)}.`,
    );
  }
  if (renderModel.citations.length === 0) lines.push("", "- none");

  lines.push("", "## Limitations and Method Notes");
  for (const entry of renderModel.methodNotes.limitationEntries) {
    const subject = entry.citationRef
      ? citationMarker(entry.citationRef)
      : `Claim ${inlineCode(entry.claimId)} / evidence ${inlineCode(entry.evidenceItemId)}`;
    lines.push("", `- ${subject} limitation codes: ${formatLimitationCodes(entry.limitationCodes)}.`);
  }
  if (renderModel.methodNotes.limitationEntries.length === 0) lines.push("", "- none");

  return `${lines.join("\n")}\n`;
}

export async function serializeExportManifestToMarkdown(input, dependencies = {}) {
  const renderModelService = dependencies.composeExportManifestRenderModel || composeExportManifestRenderModel;
  const result = await renderModelService(input, dependencies.renderModelDependencies || {});
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      markdownContractVersion: MARKDOWN_CONTRACT_VERSION,
      markdown: serializeExportManifestRenderModelToMarkdown(result.data),
    },
    error: null,
  };
}

export const __exportManifestMarkdownSerializerTestables = Object.freeze({
  MARKDOWN_CONTRACT_VERSION,
  validateRenderModel,
});
